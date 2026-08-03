import pytest
from core.llm.openrouter_client import OpenRouterClient


class TestOpenRouterClient:
    def test_init_raises_without_key(self, monkeypatch):
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
        with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
            OpenRouterClient()

    def test_init_with_env(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-key")
        monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-oss-20b:free")
        client = OpenRouterClient()
        assert client.api_key == "sk-or-test-key"
        assert client.model == "openai/gpt-oss-20b:free"
