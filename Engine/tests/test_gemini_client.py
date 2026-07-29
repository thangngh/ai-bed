import pytest
from core.llm.gemini_client import GeminiClient


class TestGeminiClient:
    def test_init_with_env_key(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "test-key-abc")
        monkeypatch.setenv("GEMINI_MODEL", "gemini-2.0-flash")
        client = GeminiClient()
        assert client.api_key == "test-key-abc"
        assert client.model == "gemini-2.0-flash"

    def test_init_raises_without_key(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        with pytest.raises(ValueError, match="GEMINI_API_KEY"):
            GeminiClient()
