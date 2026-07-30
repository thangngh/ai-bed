import pytest
from core.pipeline import StoryPipeline, FALLBACK_STORY
from core.llm.client import BaseLLMClient


class MockRouter:
    def __init__(self, responses: dict):
        self.responses = responses
        self.call_count = 0
        self.prompts = []

    async def complete(self, prompt: str, stage: str = ""):
        self.call_count += 1
        self.prompts.append(stage)
        return self.responses.get(stage, "{}")


class TestStoryPipeline:
    @pytest.mark.asyncio
    async def test_happy_path(self):
        router = MockRouter({
            "planner": '{"title": "Test", "story_structure": {"opening": "...", "sections": [{"order": 0, "type": "opening", "description": "..."}, {"order": 1, "type": "context", "description": "..."}], "moral": "good", "key_characters": ["An"]}}',
            "writer": '{"title": "Test", "content": [{"type": "opening", "text": "Xin chào bạn nhỏ\\n\\nHôm nay chúng ta có một câu chuyện", "order": 0}, {"type": "context", "text": "Ngày xưa có một cô bé\\n\\nCô bé sống trong ngôi làng nhỏ", "order": 1}, {"type": "conflict", "text": "Một ngày nọ biến cố xảy ra\\n\\nCô bé phải đối mặt với thử thách", "order": 2}, {"type": "interaction", "text": "Hỏi", "prompt": "Con nghĩ?", "order": 3}, {"type": "resolution", "text": "Cuối cùng mọi chuyện ổn thỏa\\n\\nCô bé học được bài học quý giá", "order": 4}], "word_count": 150}',
            "reviewer": '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}',
        })
        pipeline = StoryPipeline(router)

        result = await pipeline.run({})
        assert result.success is True
        assert result.safety_verdict == "APPROVED"
        assert result.title == "Test"

    @pytest.mark.asyncio
    async def test_fallback_on_all_failures(self):
        class FailingRouter:
            async def complete(self, prompt, stage=""):
                raise Exception("LLM down")

        pipeline = StoryPipeline(FailingRouter())
        result = await pipeline.run({})
        assert result.success is True
        assert result.is_fallback is True
        assert result.title == "Câu chuyện bất ngờ"