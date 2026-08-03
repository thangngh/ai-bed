import pytest
from core.pipeline import StoryPipeline, FALLBACK_STORY, extract_json
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

    @pytest.mark.asyncio
    async def test_survives_noisy_json_output(self):
        """Real reasoning LLMs (e.g. opencode via proxy) wrap JSON in markdown
        fences or append trailing prose. The pipeline must extract the JSON
        object instead of failing json.loads -> fallback."""
        planner = (
            '```json\n'
            '{"title": "Chú mèo dũng cảm", '
            '"story_structure": {"sections": [{"order": 0, "type": "opening", "description": "..."}, {"order": 1, "type": "context", "description": "..."}], "moral": "hãy dũng cảm"}, '
            '"key_characters": ["Mèo"]}\n'
            '```\n'
            'Đây là outline cho bé An.'
        )
        writer = (
            '{"title": "Chú mèo dũng cảm", "content": [{"type": "opening", "text": "Ngày xửa ngày xưa\\n\\nCó một chú mèo con", "order": 0}, {"type": "context", "text": "Chú mèo sống trong khu rừng\\n\\nMột buổi sáng đẹp trời", "order": 1}, {"type": "conflict", "text": "Chú mèo lạc đường\\n\\nChú phải tìm đường về", "order": 2}, {"type": "interaction", "text": "Hỏi", "prompt": "Con nghĩ?", "order": 3}, {"type": "resolution", "text": "Chú mèo tìm được nhà\\n\\nMọi người vui mừng", "order": 4}], "word_count": 150}'
            '\n\nKết thúc câu chuyện ở đây.'
        )
        router = MockRouter({
            "planner": planner,
            "writer": writer,
            "reviewer": '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}',
        })
        pipeline = StoryPipeline(router)

        result = await pipeline.run({})
        assert result.success is True
        assert result.is_fallback is False
        assert result.title == "Chú mèo dũng cảm"


    @pytest.mark.asyncio
    async def test_writer_retry_appends_interaction_hint(self):
        """When the writer omits the required 'interaction' section, the retry
        prompt must tell the model to add one (strict policy: keep the
        requirement, guide the model on retry)."""
        class HintRouter:
            def __init__(self):
                self.prompts = []
                self.writer_calls = 0

            async def complete(self, prompt, stage=""):
                self.prompts.append((stage, prompt))
                if stage == "planner":
                    return '{"title": "Test", "story_structure": {"sections": [{"order": 0, "type": "opening", "description": "..."}, {"order": 1, "type": "context", "description": "..."}], "moral": "good"}}'
                if stage == "writer":
                    self.writer_calls += 1
                    if self.writer_calls == 1:
                        return '{"title": "Test", "content": [{"type": "opening", "text": "A\\n\\nB", "order": 0}], "word_count": 150}'
                    return ('{"title": "Test", "content": ['
                            '{"type": "opening", "text": "A\\n\\nB", "order": 0}, '
                            '{"type": "context", "text": "C\\n\\nD", "order": 1}, '
                            '{"type": "conflict", "text": "E\\n\\nF", "order": 2}, '
                            '{"type": "resolution", "text": "G\\n\\nH", "order": 3}, '
                            '{"type": "interaction", "text": "Con nghĩ sao?", "prompt": "?", "order": 4}], '
                            '"word_count": 150}')
                return '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}'

        router = HintRouter()
        pipeline = StoryPipeline(router)

        result = await pipeline.run({"user": "Child info"})
        # First writer call returned no interaction -> retry with hint -> success
        assert result.success is True
        assert result.is_fallback is False

        writer_prompts = [p for (stage, p) in router.prompts if stage == "writer"]
        assert len(writer_prompts) >= 2
        assert "interaction" in writer_prompts[-1].lower()


class TestExtractJson:
    def test_extracts_plain_json(self):
        assert extract_json('{"a": 1}') == '{"a": 1}'

    def test_extracts_from_markdown_fence(self):
        assert extract_json('```json\n{"a": 1}\n```') == '{"a": 1}'

    def test_extracts_with_trailing_prose(self):
        raw = '{"a": 1}\n\nĐây là câu chuyện cho bé.'
        assert extract_json(raw) == '{"a": 1}'

    def test_returns_original_when_no_json(self):
        assert extract_json('no json here') == 'no json here'