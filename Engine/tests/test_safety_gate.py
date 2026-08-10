import json
import time

import pytest
from core.pipeline import (
    BudgetExhausted,
    FALLBACK_STORY,
    StoryPipeline,
)
from core.prompts.registry import PromptRegistry

PLANNER_OK = (
    '{"title": "Test", "story_structure": {"sections": ['
    '{"order": 0, "type": "opening", "description": "..."}, '
    '{"order": 1, "type": "context", "description": "..."}], '
    '"moral": "good", "key_characters": ["An"]}}'
)
WRITER_OK = (
    '{"title": "Test", "content": ['
    '{"type": "opening", "text": "Xin chào bạn nhỏ\\n\\nHôm nay chúng ta có một câu chuyện", "order": 0}, '
    '{"type": "context", "text": "Ngày xưa có một cô bé\\n\\nCô bé sống trong ngôi làng nhỏ", "order": 1}, '
    '{"type": "conflict", "text": "Một ngày nọ biến cố xảy ra\\n\\nCô bé phải đối mặt với thử thách", "order": 2}, '
    '{"type": "interaction", "text": "Hỏi", "prompt": "Con nghĩ?", "order": 3}, '
    '{"type": "resolution", "text": "Cuối cùng mọi chuyện ổn thỏa\\n\\nCô bé học được bài học quý giá", "order": 4}], '
    '"word_count": 150}'
)
REVIEW_APPROVED = '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}'


class RecordingRouter:
    """Captures the exact prompt text per stage.

    MockRouter in test_pipeline.py records the stage name, not the prompt, so
    it cannot show whether the safety rules reached the model.
    """

    def __init__(self, responses: dict):
        self.responses = responses
        self.calls: list[tuple[str, str]] = []

    async def complete(self, prompt: str, stage: str = "", accept=None):
        self.calls.append((stage, prompt))
        value = self.responses.get(stage, "{}")
        return value(len([s for s, _ in self.calls if s == stage])) if callable(value) else value

    def prompts_for(self, stage: str) -> list[str]:
        return [p for (s, p) in self.calls if s == stage]

    def count(self, stage: str) -> int:
        return len(self.prompts_for(stage))


def real_prompts(age: int = 4) -> dict:
    """The three tiers exactly as the orchestrator builds them."""
    return PromptRegistry().assemble(age=age, data={
        "childName": "An", "age": str(age), "theme": "rồng", "goal": "",
        "mood": "vui vẻ", "memories": "[]", "gender": "boy",
        "favoriteCharacter": "",
    })


SAFETY_MARKER = "STRICTLY FORBIDDEN"
AGE_MARKER = "3-6 words per sentence"      # developer/3-4.txt


class TestGuardrailsReachTheModel:
    @pytest.mark.asyncio
    async def test_every_writing_stage_receives_the_safety_rules(self):
        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": WRITER_OK, "reviewer": REVIEW_APPROVED,
        })
        result = await StoryPipeline(router).run(real_prompts())

        assert result.is_fallback is False
        assert SAFETY_MARKER in router.prompts_for("planner")[0]
        assert SAFETY_MARKER in router.prompts_for("writer")[0]
        assert SAFETY_MARKER in router.prompts_for("reviewer")[0]

    @pytest.mark.asyncio
    async def test_writer_receives_the_age_rules(self):
        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": WRITER_OK, "reviewer": REVIEW_APPROVED,
        })
        await StoryPipeline(router).run(real_prompts(age=4))

        assert AGE_MARKER in router.prompts_for("writer")[0]
        assert AGE_MARKER in router.prompts_for("planner")[0]

    @pytest.mark.asyncio
    async def test_reviewer_gets_safety_rules_but_not_the_arc_spec(self):
        # The reviewer judges safety and language; the 7-step arc is a writer
        # instruction and would only cost tokens on the largest prompt.
        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": WRITER_OK, "reviewer": REVIEW_APPROVED,
        })
        await StoryPipeline(router).run(real_prompts(age=4))

        reviewer_prompt = router.prompts_for("reviewer")[0]
        assert SAFETY_MARKER in reviewer_prompt
        assert AGE_MARKER not in reviewer_prompt

    @pytest.mark.asyncio
    async def test_writer_retry_still_carries_the_safety_rules(self):
        # First writer reply has no interaction section -> retry.
        def writer(call_n):
            if call_n == 1:
                return '{"title": "T", "content": [{"type": "opening", "text": "A\\n\\nB", "order": 0}], "word_count": 150}'
            return WRITER_OK

        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": writer, "reviewer": REVIEW_APPROVED,
        })
        await StoryPipeline(router).run(real_prompts())

        writer_prompts = router.prompts_for("writer")
        assert len(writer_prompts) >= 2
        assert all(SAFETY_MARKER in p for p in writer_prompts)

    @pytest.mark.asyncio
    async def test_empty_tiers_produce_no_blank_blocks(self):
        # run({}) is what most existing tests pass; it must not grow leading
        # blank separators now that the system slot can be empty.
        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": WRITER_OK, "reviewer": REVIEW_APPROVED,
        })
        await StoryPipeline(router).run({})

        assert not router.prompts_for("planner")[0].startswith("\n")


class TestVerdictGate:
    """Unit-level: every outcome the reviewer can produce."""

    def _gate(self, review: dict):
        return StoryPipeline(RecordingRouter({}))._gate_verdict(review)

    def test_approved_ships(self):
        assert self._gate({"safety_verdict": "APPROVED", "issues": []}) == ("APPROVED", "")

    def test_rejected_blocks(self):
        verdict, blocked = self._gate({"safety_verdict": "REJECTED"})
        assert (verdict, bool(blocked)) == ("REJECTED", True)

    def test_flagged_for_language_only_ships(self):
        verdict, blocked = self._gate({"safety_verdict": "FLAGGED", "issues": [
            {"type": "language", "severity": "low", "detail": "English word"},
        ]})
        assert (verdict, blocked) == ("FLAGGED", "")

    def test_flagged_with_a_safety_issue_blocks(self):
        _, blocked = self._gate({"safety_verdict": "FLAGGED", "issues": [
            {"type": "safety", "severity": "low", "detail": "mild peril"},
        ]})
        assert blocked

    def test_flagged_with_a_high_severity_issue_blocks(self):
        _, blocked = self._gate({"safety_verdict": "FLAGGED", "issues": [
            {"type": "quality", "severity": "high", "detail": "incoherent"},
        ]})
        assert blocked

    def test_flagged_without_a_reason_blocks(self):
        # A reviewer that flags a story but will not say why has given no
        # reason to trust it.
        _, blocked = self._gate({"safety_verdict": "FLAGGED", "issues": []})
        assert blocked

    def test_missing_verdict_blocks(self):
        verdict, blocked = self._gate({"issues": []})
        assert (verdict, bool(blocked)) == ("UNREVIEWED", True)

    def test_unknown_verdict_blocks(self):
        _, blocked = self._gate({"safety_verdict": "APPROVED_WITH_NOTES"})
        assert blocked

    def test_verdict_is_case_insensitive(self):
        assert self._gate({"safety_verdict": "approved"}) == ("APPROVED", "")


class TestGateEndToEnd:
    @pytest.mark.asyncio
    async def test_safety_flag_falls_back_instead_of_shipping(self):
        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": WRITER_OK,
            "reviewer": '{"safety_verdict": "FLAGGED", "issues": [{"type": "safety", "severity": "medium", "detail": "scary"}], "quality_score": 3}',
        })
        result = await StoryPipeline(router).run(real_prompts())

        assert result.is_fallback is True
        assert result.safety_verdict == "FALLBACK"
        assert result.title == FALLBACK_STORY["title"]
        # One writer retry was attempted before giving up.
        assert router.count("writer") >= 2

    @pytest.mark.asyncio
    async def test_language_flag_still_ships(self):
        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": WRITER_OK,
            "reviewer": '{"safety_verdict": "FLAGGED", "issues": [{"type": "language", "severity": "low", "detail": "English word"}], "quality_score": 3}',
        })
        result = await StoryPipeline(router).run(real_prompts())

        assert result.is_fallback is False
        assert result.safety_verdict == "FLAGGED"
        assert router.count("writer") == 1

    @pytest.mark.asyncio
    async def test_unreviewed_story_is_not_shipped(self):
        # Budget too small for the reviewer, but large enough for planner and
        # writer: the old code shipped this as FLAGGED.
        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": WRITER_OK, "reviewer": REVIEW_APPROVED,
        })
        pipeline = StoryPipeline(router)
        pipeline.budget_seconds = 45

        original = pipeline._review_story

        async def unreviewed(story, safety_rules=""):
            return {"safety_verdict": "UNREVIEWED",
                    "issues": [{"type": "budget", "severity": "high", "detail": "skipped"}],
                    "quality_score": 0}

        pipeline._review_story = unreviewed
        result = await pipeline.run(real_prompts())

        assert result.is_fallback is True


class TestUnparseableReview:
    @pytest.mark.asyncio
    async def test_reviewer_is_re_asked_exactly_once(self):
        # The writer retry is made to fail so the run has a single review
        # round: two reviewer calls total means one re-ask.
        def writer(call_n):
            return WRITER_OK if call_n == 1 else "{}"

        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": writer, "reviewer": "I think it is fine!",
        })
        result = await StoryPipeline(router).run(real_prompts())

        assert router.count("reviewer") == 2
        assert "JSON object" in router.prompts_for("reviewer")[1]
        assert result.is_fallback is True

    @pytest.mark.asyncio
    async def test_review_returning_a_json_array_does_not_raise(self):
        # extract_json_block happily returns a list; review.get() then raised
        # AttributeError, which surfaced as a fallback carrying the exception
        # text in the error field.
        def writer(call_n):
            return WRITER_OK if call_n == 1 else "{}"

        router = RecordingRouter({
            "planner": PLANNER_OK, "writer": writer,
            "reviewer": '[{"safety_verdict": "APPROVED"}]',
        })
        result = await StoryPipeline(router).run(real_prompts())

        assert result.is_fallback is True
        assert "AttributeError" not in result.error
        assert "not approved" in result.error
