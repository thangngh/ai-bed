import pytest
from core.llm.custom_client import CustomClient


class TestCustomClient:
    def test_init_with_env(self, monkeypatch):
        monkeypatch.setenv("CUSTOM_LLM_URL", "https://my-llm.example.com/v1/chat/completions")
        monkeypatch.setenv("CUSTOM_LLM_API_KEY", "ck-custom-key")
        monkeypatch.setenv("CUSTOM_LLM_MODEL", "my-model")
        client = CustomClient()
        assert client.api_url == "https://my-llm.example.com/v1/chat/completions"
        assert client.api_key == "ck-custom-key"
        assert client.model == "my-model"

    def test_init_raises_without_url(self, monkeypatch):
        monkeypatch.delenv("CUSTOM_LLM_URL", raising=False)
        with pytest.raises(ValueError, match="CUSTOM_LLM_URL"):
            CustomClient()
