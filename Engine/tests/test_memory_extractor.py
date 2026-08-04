import pytest
from core.memory_extractor import MemoryExtractor


class MockRouter:
    async def complete(self, prompt, stage=""):
        return '{"memories": [{"type": "interest", "key": "favorite_theme", "value": "rồng", "confidence": 0.8, "source": "..."}]}'


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
            async def complete(self, prompt, stage=""):
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
            async def complete(self, prompt, stage=""):
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
            async def complete(self, prompt, stage=""):
                return '[{"type": "theme", "key": "t", "value": "biển", "confidence": 0.7}]'

        extractor = MemoryExtractor(ArrayRouter())
        result = await extractor.extract({"title": "Test"}, "vi")
        assert [m["value"] for m in result] == ["biển"]

    @pytest.mark.asyncio
    async def test_unparseable_response_yields_no_memories(self):
        class ProseRouter:
            async def complete(self, prompt, stage=""):
                return 'I could not find any memories in this story.'

        extractor = MemoryExtractor(ProseRouter())
        assert await extractor.extract({"title": "Test"}, "vi") == []