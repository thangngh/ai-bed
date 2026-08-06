import json
import time

import pytest
from core.pipeline import (
    BudgetExhausted,
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

    async def complete(self, prompt: str, stage: str = ""):
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
