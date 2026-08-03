import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any
from .validator import OutputValidator, ValidationResult
from .cleanup import extract_json_block
from .llm.router import LLMRouter
from .prompts.registry import PromptRegistry

logger = logging.getLogger(__name__)


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

    def _count_call(self):
        self.llm_calls += 1

    async def _call_llm(self, prompt: str, stage: str) -> str:
        self._count_call()
        return await self.router.complete(prompt, stage)

    async def run(self, prompts: dict[str, str]) -> PipelineResult:
        try:
            planner_prompt = self.registry.load_planner()
            planner_raw = await self._call_retry(
                {"system": planner_prompt, "developer": "", "user": prompts.get("user", "")},
                "planner", max_retries=2,
                validator=lambda d: self.validator.validate_planner(d)
            )
            if not planner_raw:
                return self._fallback("Planner failed after retries")

            outline = json.loads(planner_raw)

            writer_prompt = self._build_writer_prompt(outline)
            writer_raw = await self._call_retry(
                {"system": "", "user": writer_prompt}, "writer", max_retries=2,
                validator=lambda d: self._validate_writer_full(d),
                retry_hint=(
                    "Your previous story was rejected because it is missing an "
                    "'interaction' section. Add at least one content item with "
                    '{"type": "interaction", "text": "...", "prompt": "...", "order": N} '
                    "that asks the child a question by name."
                ),
            )
            if not writer_raw:
                return self._fallback("Writer failed after retries")

            story = json.loads(writer_raw)

            review = await self._review_story(story)

            if review.get("safety_verdict") == "REJECTED":
                logger.warning("Story REJECTED, retrying writer...")
                writer_raw = await self._call_retry(
                    {"system": "", "user": writer_prompt}, "writer", max_retries=1,
                    validator=lambda d: self.validator.validate_writer(d)
                )
                if writer_raw:
                    story = json.loads(writer_raw)
                    review = await self._review_story(story)

            verdict = review.get("safety_verdict", "FLAGGED")
            if verdict == "REJECTED":
                return self._fallback("Story still rejected after retry")

            return PipelineResult(
                success=True,
                title=story.get("title", outline.get("title", "")),
                content=story.get("content", []),
                safety_verdict=verdict,
                llm_calls=self.llm_calls,
            )

        except Exception as e:
            logger.error(f"Pipeline failed: {e}")
            return self._fallback(str(e))

    async def _call_retry(self, prompts: dict, stage: str, max_retries: int, validator, retry_hint: str = "") -> str | None:
        for attempt in range(max_retries + 1):
            try:
                combined = "\n\n".join([prompts.get("system", ""), prompts.get("developer", ""), prompts.get("user", "")])
                if attempt > 0 and retry_hint:
                    combined = f"{combined}\n\n{retry_hint}"
                raw = await self._call_llm(combined, stage)
                data = extract_json_block(raw)
                result = validator(data)
                if result.valid:
                    return json.dumps(result.fixed_data or data)
                else:
                    logger.warning(f"{stage} validation failed attempt {attempt}: {result.errors}")
            except Exception as e:
                logger.warning(f"{stage} attempt {attempt} error: {e}")
        return None

    def _build_writer_prompt(self, outline: dict) -> str:
        template = self.registry.load_writer()
        return template.format(outline=json.dumps(outline, ensure_ascii=False))

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

    async def _review_story(self, story: dict) -> dict:
        review_prompt = self.registry.load_reviewer().format(
            story=json.dumps(story, ensure_ascii=False)
        )
        raw = await self._call_llm(review_prompt, "reviewer")
        try:
            return extract_json_block(raw)
        except Exception:
            return {"safety_verdict": "FLAGGED", "issues": [{"type": "format", "severity": "low", "detail": "Cannot parse review"}], "quality_score": 3}

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
