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


def _mock_async_client(monkeypatch, handler):
    """Make CustomClient.complete use httpx.MockTransport to avoid network."""
    import httpx as _httpx

    class Fake(_httpx.AsyncClient):
        def __init__(self, *a, **k):
            super().__init__(*a, **k, transport=_httpx.MockTransport(handler))

    monkeypatch.setattr(_httpx, "AsyncClient", Fake)


@pytest.mark.asyncio
async def test_complete_returns_content_stripping_data_done(monkeypatch):
    import httpx as _httpx
    monkeypatch.setenv("CUSTOM_LLM_URL", "http://proxy/v1/chat/completions")
    monkeypatch.setenv("CUSTOM_LLM_MODEL", "m")

    body = '{"choices":[{"message":{"role":"assistant","content":"{\\"title\\":\\"Hi\\"}"}}]} data: [DONE]'

    _mock_async_client(monkeypatch, lambda req: _httpx.Response(200, text=body))

    client = CustomClient()
    out = await client.complete("hi")
    assert out == '{"title":"Hi"}'
