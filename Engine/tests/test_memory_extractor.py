import pytest
from core.memory_extractor import MemoryExtractor


class MockRouter:
    async def complete(self, prompt, stage=""):
        return '{"memories": [{"type": "interest", "key": "favorite_theme", "value": "rồng", "confidence": 0.8, "source": "..."}]}'


class TestMemoryExtractor:
    def test_extract_memories(self):
        extractor = MemoryExtractor(MockRouter())
        result = extractor.extract({"title": "Test"}, "vi")
        assert len(result) > 0
        assert result[0]["type"] == "interest"
        assert result[0]["confidence"] >= 0.3

    def test_filter_low_confidence(self):
        class LowConfRouter:
            async def complete(self, prompt, stage=""):
                return '{"memories": [{"type": "interest", "key": "bad", "value": "low", "confidence": 0.1, "source": "..."}]}'

        extractor = MemoryExtractor(LowConfRouter())
        result = extractor.extract({"title": "Test"}, "vi")
        assert len(result) == 0

    def test_extractor_skip_if_fallback(self):
        extractor = MemoryExtractor(MockRouter())
        result = extractor.extract({"title": "Test"}, "vi", is_fallback=True)
        assert len(result) == 0
