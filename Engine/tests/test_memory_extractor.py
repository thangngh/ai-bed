import asyncio
import pytest
from core.memory_extractor import MemoryExtractor
from core.orchestrator import StoryOrchestrator, _memory_extract_enabled
from core.pipeline import PipelineResult


class MockRouter:
    async def complete(self, prompt, stage="", system=""):
        return '{"memories": [{"type": "interest", "key": "favorite_theme", "value": "rồng", "confidence": 0.8, "source": "..."}]}'


def test_memory_extraction_flag_defaults_on(monkeypatch):
    monkeypatch.delenv("MEMORY_EXTRACT_ENABLED", raising=False)
    assert _memory_extract_enabled() is True


def test_memory_extraction_can_be_disabled_to_save_an_llm_call(monkeypatch):
    monkeypatch.setenv("MEMORY_EXTRACT_ENABLED", "false")
    assert _memory_extract_enabled() is False


@pytest.mark.asyncio
async def test_disabled_memory_extraction_skips_the_fourth_llm_call():
    class Registry:
        def assemble(self, age, data):
            return {"system": "", "developer": "", "user": ""}

    class Pipeline:
        async def run(self, prompts):
            return PipelineResult(
                success=True,
                title="Truyện ngắn",
                content=[{"type": "opening", "text": "Ngày xửa ngày xưa.", "order": 0}],
                safety_verdict="APPROVED",
                llm_calls=3,
            )

    class ExtractorThatMustNotRun:
        async def extract(self, *args, **kwargs):
            raise AssertionError("memory extractor made an unnecessary fourth LLM call")

    orchestrator = StoryOrchestrator.__new__(StoryOrchestrator)
    orchestrator.registry = Registry()
    orchestrator.pipeline = Pipeline()
    orchestrator.extractor = ExtractorThatMustNotRun()
    orchestrator.memory_extract_enabled = False

    result = await orchestrator.generate({"child_name": "An", "age": 4, "theme": "Rừng"})

    assert result["llm_calls"] == 3
    assert result["memories"] == []


class TestMemoryExtractor:
    @pytest.mark.asyncio
    async def test_extract_memories(self):
        extractor = MemoryExtractor(MockRouter())
        result = await extractor.extract({"title": "Test"}, "vi")
        assert len(result) > 0
        assert result[0]["type"] == "interest"
        assert result[0]["confidence"] >= 0.3

    @pytest.mark.asyncio
    async def test_filter_low_confidence(self):
        class LowConfRouter:
            async def complete(self, prompt, stage="", system=""):
                return '{"memories": [{"type": "interest", "key": "bad", "value": "low", "confidence": 0.1, "source": "..."}]}'

        extractor = MemoryExtractor(LowConfRouter())
        result = await extractor.extract({"title": "Test"}, "vi")
        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_extractor_skip_if_fallback(self):
        extractor = MemoryExtractor(MockRouter())
        result = await extractor.extract({"title": "Test"}, "vi", is_fallback=True)
        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_extract_from_fenced_json(self):
        """What the models actually return: a ```json block wrapped in prose."""
        class FencedRouter:
            async def complete(self, prompt, stage="", system=""):
                return (
                    'Here are the memories:\n```json\n'
                    '{"memories": [{"type": "character", "key": "favorite", '
                    '"value": "gấu nhỏ", "confidence": 0.9, "source": "..."}]}\n'
                    '```\n'
                )

        extractor = MemoryExtractor(FencedRouter())
        result = await extractor.extract({"title": "Test"}, "vi")
        assert [m["value"] for m in result] == ["gấu nhỏ"]

    @pytest.mark.asyncio
    async def test_extract_from_bare_array(self):
        class ArrayRouter:
            async def complete(self, prompt, stage="", system=""):
                return '[{"type": "theme", "key": "t", "value": "biển", "confidence": 0.7}]'

        extractor = MemoryExtractor(ArrayRouter())
        result = await extractor.extract({"title": "Test"}, "vi")
        assert [m["value"] for m in result] == ["biển"]

    @pytest.mark.asyncio
    async def test_unparseable_response_yields_no_memories(self):
        class ProseRouter:
            async def complete(self, prompt, stage="", system=""):
                return 'I could not find any memories in this story.'

        extractor = MemoryExtractor(ProseRouter())
        assert await extractor.extract({"title": "Test"}, "vi") == []

    @pytest.mark.asyncio
    async def test_gives_up_rather_than_delaying_a_finished_story(self, monkeypatch):
        # Extraction runs after the pipeline, outside PIPELINE_BUDGET_SECONDS,
        # so an unbounded call adds its whole latency to a story that is
        # already written.
        monkeypatch.setenv("MEMORY_EXTRACT_TIMEOUT_SECONDS", "0.05")

        class SlowRouter:
            async def complete(self, prompt, stage="", system=""):
                await asyncio.sleep(5)
                return '{"memories": []}'

        extractor = MemoryExtractor(SlowRouter())
        started = asyncio.get_event_loop().time()
        assert await extractor.extract({"title": "Test"}, "vi") == []
        assert asyncio.get_event_loop().time() - started < 1

    @pytest.mark.asyncio
    async def test_invalid_timeout_falls_back_to_the_default(self, monkeypatch):
        monkeypatch.setenv("MEMORY_EXTRACT_TIMEOUT_SECONDS", "soon")
        assert MemoryExtractor(MockRouter()).timeout_seconds == 20.0
