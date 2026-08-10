import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any
from .validator import OutputValidator, ValidationResult
from .cleanup import extract_json_block
from .llm.router import LLMRouter
from .prompts.registry import PromptRegistry

logger = logging.getLogger(__name__)

# Whole-generation deadline. Without one, the worst case is planner x3 +
# writer x3 + reviewer + writer-retry x2 + reviewer = 10 LLM calls, each
# allowed 300s by the client -- a ~50 minute ceiling, long after BE has given
# up and returned a 502. Staying under BE's ENGINE_TIMEOUT_MS means a slow run
# degrades to a fallback story instead of an error page.
DEFAULT_BUDGET_SECONDS = 45.0

# Don't start a stage that cannot plausibly finish; spend the remaining time
# returning the fallback instead.
MIN_STAGE_SECONDS = 5.0

# The reviewer is the only safety gate on generated text, so it must not be
# the stage that loses the race for the budget. Earlier stages are capped at
# (remaining - REVIEW_RESERVE_SECONDS), which guarantees that whenever the
# writer succeeded there is still time to review what it wrote.
REVIEW_RESERVE_SECONDS = 8.0

# A review that flags only language, structure or quality is not a safety
# signal; failing closed on those would trade availability for nothing.
BLOCKING_ISSUE_TYPES = {"safety"}
BLOCKING_SEVERITIES = {"high"}

# Sent back to the reviewer once when its first reply could not be parsed as
# a JSON object, before giving up and treating the story as UNREVIEWED.
REVIEW_RETRY_HINT = (
    "Your previous reply could not be parsed. Reply with the JSON object "
    "only -- no prose, no code fences."
)


class BudgetExhausted(Exception):
    """The generation ran out of its time budget."""


def _budget_from_env() -> float:
    raw = os.getenv("PIPELINE_BUDGET_SECONDS", "").strip()
    if not raw:
        return DEFAULT_BUDGET_SECONDS
    try:
        value = float(raw)
    except ValueError:
        logger.warning("Invalid PIPELINE_BUDGET_SECONDS=%r, using %s", raw, DEFAULT_BUDGET_SECONDS)
        return DEFAULT_BUDGET_SECONDS
    if value <= 0:
        logger.warning("PIPELINE_BUDGET_SECONDS=%s is not positive, using %s", value, DEFAULT_BUDGET_SECONDS)
        return DEFAULT_BUDGET_SECONDS
    return value


@dataclass
class PipelineResult:
    success: bool
    title: str = ""
    content: list[dict] = field(default_factory=list)
    safety_verdict: str = "PENDING"
    llm_calls: int = 0
    is_fallback: bool = False
    error: str = ""


FALLBACK_STORY = {
    "title": "Câu chuyện bất ngờ",
    "content": [{
        "type": "opening",
        "text": "Xin lỗi bạn nhỏ, hôm nay máy kể chuyện hơi mệt một chút. Bạn hãy thử lại sau nhé! Hãy tưởng tượng một câu chuyện thật đẹp trước khi ngủ nào.",
        "order": 0
    }],
    "word_count": 30,
}


class StoryPipeline:
    def __init__(self, router: LLMRouter):
        self.router = router
        self.validator = OutputValidator()
        self.registry = PromptRegistry()
        self.llm_calls = 0
        self.budget_seconds = _budget_from_env()
        self._deadline: float | None = None

    def _count_call(self):
        self.llm_calls += 1

    def _remaining(self) -> float:
        """Seconds left in the budget, or infinity outside a `run()`."""
        if self._deadline is None:
            return float("inf")
        return self._deadline - time.monotonic()

    def _stage_allowance(self, reserve: float) -> float:
        """Seconds a stage may take, holding `reserve` back for the reviewer.

        The reserve is only meaningful when the *whole* budget could ever
        honour it, so the decision is made once against the fixed
        `budget_seconds` -- never against `remaining`. Comparing against
        `remaining` would stand the reserve down mid-run whenever a stage is
        simply running late, which is exactly the case a reserved stage must
        yield in.

        A budget that cannot leave a startable stage after the reserve stands
        it down entirely: the reserve is never the reason a stage does not
        start. A budget that is merely running low keeps the subtraction, and
        `_call_llm` refuses to start the stage so the reviewer keeps its share
        of the clock.
        """
        remaining = self._remaining()
        if self.budget_seconds - reserve < MIN_STAGE_SECONDS:
            return remaining
        return remaining - reserve

    @staticmethod
    def _guardrails(prompts: dict[str, str]) -> str:
        """Safety + language rules plus the age-specific storytelling rules.

        registry.assemble() has always built these, but run() read only
        prompts["user"], so system/default.txt ("STRICTLY FORBIDDEN -- no
        violence, blood, horror ...") and developer/{3-4,5-6}.txt never
        reached a model, leaving the 27-word blocklist in validator.py as the
        only content guardrail.
        """
        tiers = (prompts.get("system", ""), prompts.get("developer", ""))
        return "\n\n".join(t for t in tiers if t.strip())

    @staticmethod
    def _acceptor(validator):
        """Turn a stage validator into the router's `accept` test.

        The router cannot judge a body on its own -- only the stage knows what
        shape it asked for -- and it must never see this raise: an exception
        here would be counted as a transport failure and could retire the
        provider. Anything unparseable is simply "not usable".
        """
        def accept(raw: str) -> bool:
            try:
                return bool(validator(extract_json_block(raw)).valid)
            except Exception:
                return False
        return accept

    async def _call_llm(self, prompt: str, stage: str, reserve: float = 0.0, accept=None) -> str:
        allowance = self._stage_allowance(reserve)
        if allowance < MIN_STAGE_SECONDS:
            raise BudgetExhausted(
                f"only {max(allowance, 0):.1f}s left before the {self.budget_seconds:.0f}s "
                f"budget expires; not starting stage={stage}"
            )

        self._count_call()
        # Cap the call at whatever is left, so a single slow provider cannot
        # outlive the whole generation.
        # Only stages that can judge their own output pass a test; the call
        # stays a plain two-argument one otherwise.
        call = (
            self.router.complete(prompt, stage, accept=accept)
            if accept is not None
            else self.router.complete(prompt, stage)
        )
        return await asyncio.wait_for(call, timeout=allowance)

    async def run(self, prompts: dict[str, str]) -> PipelineResult:
        # The orchestrator holds one pipeline for the process lifetime, so
        # without this the counter accumulates across requests and every
        # response reports the running total instead of its own call count.
        self.llm_calls = 0
        self._deadline = time.monotonic() + self.budget_seconds
        try:
            guardrails = self._guardrails(prompts)
            planner_raw = await self._call_retry(
                {"system": guardrails,
                 "developer": self.registry.load_planner(),
                 "user": prompts.get("user", "")},
                "planner", max_retries=2,
                validator=lambda d: self.validator.validate_planner(d),
                reserve=REVIEW_RESERVE_SECONDS,
            )
            if not planner_raw:
                return self._fallback("Planner failed after retries")

            outline = json.loads(planner_raw)

            writer_prompt = self._build_writer_prompt(outline)
            writer_raw = await self._call_retry(
                {"system": guardrails, "user": writer_prompt}, "writer", max_retries=2,
                validator=lambda d: self._validate_writer_full(d),
                retry_hint=(
                    "Your previous story was rejected because it is missing an "
                    "'interaction' section. Add at least one content item with "
                    '{"type": "interaction", "text": "...", "prompt": "...", "order": N} '
                    "that asks the child a question by name."
                ),
                reserve=REVIEW_RESERVE_SECONDS,
            )
            if not writer_raw:
                return self._fallback("Writer failed after retries")

            story = json.loads(writer_raw)

            review = await self._review_story(story, prompts.get("system", ""))
            verdict, blocked = self._gate_verdict(review)

            if blocked:
                logger.warning("Story not approved (%s: %s), retrying writer...", verdict, blocked)
                writer_raw = await self._call_retry(
                    {"system": guardrails, "user": writer_prompt}, "writer", max_retries=1,
                    reserve=REVIEW_RESERVE_SECONDS,
                    validator=lambda d: self.validator.validate_writer(d)
                )
                if writer_raw:
                    story = json.loads(writer_raw)
                    review = await self._review_story(story, prompts.get("system", ""))
                    verdict, blocked = self._gate_verdict(review)

            if blocked:
                return self._fallback(f"story not approved: {blocked}")

            return PipelineResult(
                success=True,
                title=story.get("title", outline.get("title", "")),
                content=story.get("content", []),
                safety_verdict=verdict,
                llm_calls=self.llm_calls,
            )

        except (asyncio.TimeoutError, BudgetExhausted) as e:
            reason = str(e) or f"generation exceeded its {self.budget_seconds:.0f}s budget"
            logger.warning(f"Pipeline out of budget after {self.llm_calls} call(s): {reason}")
            return self._fallback(reason)

        except Exception as e:
            logger.error(f"Pipeline failed: {e}")
            return self._fallback(str(e))

    async def _call_retry(self, prompts: dict, stage: str, max_retries: int, validator, retry_hint: str = "", reserve: float = 0.0) -> str | None:
        for attempt in range(max_retries + 1):
            try:
                combined = "\n\n".join(
                    p for p in (prompts.get("system", ""), prompts.get("developer", ""),
                                prompts.get("user", "")) if p.strip()
                )
                if attempt > 0 and retry_hint:
                    combined = f"{combined}\n\n{retry_hint}"
                raw = await self._call_llm(
                    combined, stage, reserve=reserve, accept=self._acceptor(validator)
                )
                data = extract_json_block(raw)
                result = validator(data)
                if result.valid:
                    return json.dumps(result.fixed_data or data)
                else:
                    logger.warning(f"{stage} validation failed attempt {attempt}: {result.errors}")
            except (asyncio.TimeoutError, BudgetExhausted):
                # Out of time. A retry would take at least as long as the
                # attempt that just ran out, so it can only make things worse;
                # let run() fall back while there is still time to answer.
                raise
            except Exception as e:
                logger.warning(f"{stage} attempt {attempt} error: {e}")
        return None

    def _build_writer_prompt(self, outline: dict) -> str:
        template = self.registry.load_writer()
        return template.format(outline=json.dumps(outline, ensure_ascii=False))

    def _gate_verdict(self, review: dict) -> tuple[str, str]:
        """(verdict, block_reason); block_reason is empty when it may ship.

        Allow-list, not deny-list. The old check blocked only REJECTED, so a
        FLAGGED story, an unparseable review and a review that never ran all
        reached the child. "Could not check" is not "is fine".
        """
        verdict = str(review.get("safety_verdict") or "").upper()

        if verdict == "APPROVED":
            return verdict, ""

        if verdict == "FLAGGED":
            issues = [i for i in (review.get("issues") or []) if isinstance(i, dict)]
            if not issues:
                return verdict, "flagged without a stated reason"
            for issue in issues:
                if str(issue.get("type", "")).lower() in BLOCKING_ISSUE_TYPES:
                    return verdict, "flagged a safety issue"
                if str(issue.get("severity", "")).lower() in BLOCKING_SEVERITIES:
                    return verdict, "flagged a high-severity issue"
            return verdict, ""

        if verdict == "REJECTED":
            return verdict, "review rejected the story"

        return verdict or "UNREVIEWED", f"no usable safety verdict ({verdict or 'missing'})"

    def _validate_writer_full(self, data: dict):
        schema_result = self.validator.validate_writer(data)
        if not schema_result.valid:
            return schema_result
        content = data.get("content", [])
        sections_result = self.validator.validate_sections(content)
        if not sections_result.valid:
            return ValidationResult(valid=False, errors=sections_result.errors)
        depth_result = self.validator.check_section_depth(content)
        if not depth_result.valid:
            return ValidationResult(valid=False, errors=depth_result.errors)
        full_text = str(data)
        purity_result = self.validator.check_vietnamese_purity(full_text)
        if not purity_result.valid:
            logger.warning(f"Vietnamese purity: {purity_result.errors}")
        return schema_result

    async def _review_story(self, story: dict, safety_rules: str = "") -> dict:
        """Ask the reviewer, re-asking once if the reply cannot be parsed.

        `_gate_verdict` blocks on UNREVIEWED, so every failure path here
        returns that shape rather than FLAGGED -- "could not check" must not
        be treated as "checked and fine".
        """
        review_prompt = self.registry.load_reviewer().format(
            story=json.dumps(story, ensure_ascii=False)
        )
        base = "\n\n".join(p for p in (safety_rules, review_prompt) if p.strip())

        for attempt in range(2):
            prompt = base if attempt == 0 else f"{base}\n\n{REVIEW_RETRY_HINT}"
            try:
                # The reviewer is the safety gate, so it is the worst stage to
                # strand on one provider: an unparseable review is UNREVIEWED,
                # which blocks, which ships the fallback story. A reply that
                # is not a JSON object is no verdict at all -- ask the next
                # tier before spending the re-ask.
                raw = await self._call_llm(
                    prompt, "reviewer",
                    accept=self._acceptor(
                        lambda d: ValidationResult(valid=isinstance(d, dict))
                    ),
                )
            except (asyncio.TimeoutError, BudgetExhausted):
                # No safety signal at all. UNREVIEWED is blocking in
                # _gate_verdict: an unreviewed story is exactly what the
                # reviewer exists to stop, and the old code shipped it.
                logger.warning("Reviewer skipped: out of budget")
                return {
                    "safety_verdict": "UNREVIEWED",
                    "issues": [{"type": "budget", "severity": "high",
                                "detail": "Review skipped: out of time budget"}],
                    "quality_score": 0,
                }
            try:
                parsed = extract_json_block(raw)
            except Exception:
                logger.warning("Reviewer attempt %d returned no parseable JSON", attempt)
                continue
            if isinstance(parsed, dict):
                return parsed
            logger.warning("Reviewer attempt %d returned %s, not an object",
                           attempt, type(parsed).__name__)

        return {
            "safety_verdict": "UNREVIEWED",
            "issues": [{"type": "format", "severity": "high",
                        "detail": "Cannot parse review"}],
            "quality_score": 0,
        }

    def _fallback(self, reason: str) -> PipelineResult:
        return PipelineResult(
            success=True,
            title=FALLBACK_STORY["title"],
            content=FALLBACK_STORY["content"],
            safety_verdict="FALLBACK",
            llm_calls=self.llm_calls,
            is_fallback=True,
            error=reason,
        )
