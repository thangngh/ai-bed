import pytest
from core.llm.client import EmptyCompletionError
from core.llm.custom_client import CustomClient
from core.llm.custom_client import parse_sse_response, DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_SECONDS


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

    def test_default_max_tokens_sufficient_for_reasoning_model(self):
        # The proxy's opencode model is a reasoning model: it consumes
        # reasoning tokens before producing content. The default budget must
        # leave room for the story content, or the writer stage gets
        # truncated JSON (empty content) and falls back.
        assert DEFAULT_MAX_TOKENS >= 4096

    def test_default_timeout_sufficient_for_reasoning_model(self):
        # The writer stage (full story, 4096 tokens, reasoning) exceeds 180s.
        # A shorter httpx timeout aborts mid-generation and the router logs
        # "Provider custom failed: " with an empty message -> fallback.
        assert DEFAULT_TIMEOUT_SECONDS >= 300


class TestParseSseResponse:
    def test_plain_json(self):
        body = '{"choices": [{"message": {"content": "hi"}}]}'
        assert parse_sse_response(body) == "hi"

    def test_single_data_event(self):
        body = 'data: {"choices": [{"message": {"content": "hi"}}]}\n\n'
        assert parse_sse_response(body) == "hi"

    def test_data_event_with_done(self):
        body = (
            '{"id":"x","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"Xin chào"}}]}\n'
            'data: [DONE]\n\n'
        )
        assert parse_sse_response(body) == "Xin chào"

    def test_returns_empty_when_no_choices(self):
        # A well-formed envelope with no content yields "", not the envelope.
        # Returning the body is how a 13KB raw SSE response once became the
        # story text; the caller now raises EmptyCompletionError instead.
        body = '{"id":"x","object":"chat.completion","choices":[]}'
        assert parse_sse_response(body) == ""

    def test_returns_body_for_non_json(self):
        # Plain-text answers are legitimate content and must survive.
        assert parse_sse_response("just some text") == "just some text"

    def test_joins_streamed_delta_frames(self):
        # Some proxy models (e.g. the `gpt` alias) stream `delta` chunks
        # instead of a single assembled `message`; the parts must be joined
        # or the raw SSE body leaks through as story content.
        body = (
            'data: {"choices":[{"index":0,"delta":{"content":"Xin "}}]}\n\n'
            'data: {"choices":[{"index":0,"delta":{"content":"chào"}}]}\n\n'
            'data: [DONE]\n\n'
        )
        assert parse_sse_response(body) == "Xin chào"

    def test_bare_response_key(self):
        assert parse_sse_response('{"response": "hi"}') == "hi"


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


@pytest.mark.asyncio
async def test_complete_raises_on_empty_content(monkeypatch):
    # A 200 with no usable text must not be reported as success: the router
    # would have no reason to try the next provider, and the pipeline would
    # spend a retry parsing nothing. One measured writer call took 294s to
    # return an empty body and was retried instead of failed over.
    import httpx as _httpx
    monkeypatch.setenv("CUSTOM_LLM_URL", "http://proxy/v1/chat/completions")
    monkeypatch.setenv("CUSTOM_LLM_MODEL", "m")

    body = '{"choices":[{"message":{"role":"assistant","content":""}}]}'
    _mock_async_client(monkeypatch, lambda req: _httpx.Response(200, text=body))

    client = CustomClient()
    with pytest.raises(EmptyCompletionError):
        await client.complete("hi", stage="writer")


@pytest.mark.asyncio
async def test_complete_raises_on_whitespace_only_content(monkeypatch):
    import httpx as _httpx
    monkeypatch.setenv("CUSTOM_LLM_URL", "http://proxy/v1/chat/completions")
    monkeypatch.setenv("CUSTOM_LLM_MODEL", "m")

    body = '{"choices":[{"message":{"role":"assistant","content":"   \\n  "}}]}'
    _mock_async_client(monkeypatch, lambda req: _httpx.Response(200, text=body))

    with pytest.raises(EmptyCompletionError):
        await CustomClient().complete("hi")


class TestModelAndTuning:
    def test_default_model_is_a_concrete_backend(self, monkeypatch):
        # Not `opencode`: that is a 9router combo that round-robins over
        # backends measured at 5.9s, 7.2s and 40.7s, one of which ignored the
        # Vietnamese-only instruction. A default must be predictable.
        monkeypatch.setenv("CUSTOM_LLM_URL", "http://proxy/v1/chat/completions")
        monkeypatch.delenv("CUSTOM_LLM_MODEL", raising=False)
        assert CustomClient().model != "opencode"

    def test_custom_tuning_env_wins_over_openai_names(self, monkeypatch):
        import httpx as _httpx
        monkeypatch.setenv("CUSTOM_LLM_URL", "http://proxy/v1/chat/completions")
        monkeypatch.setenv("OPENAI_MAX_TOKENS", "1024")
        monkeypatch.setenv("CUSTOM_LLM_MAX_TOKENS", "4096")

        seen = {}

        def handler(request):
            import json as _json
            seen.update(_json.loads(request.content))
            return _httpx.Response(200, text='{"choices":[{"message":{"content":"ok"}}]}')

        _mock_async_client(monkeypatch, handler)

        import asyncio
        asyncio.run(CustomClient().complete("hi"))
        assert seen["max_tokens"] == 4096

    def test_falls_back_to_openai_names(self, monkeypatch):
        # Deployments that only set the old OPENAI_* names keep working.
        import httpx as _httpx
        monkeypatch.setenv("CUSTOM_LLM_URL", "http://proxy/v1/chat/completions")
        monkeypatch.delenv("CUSTOM_LLM_MAX_TOKENS", raising=False)
        monkeypatch.setenv("OPENAI_MAX_TOKENS", "2048")

        seen = {}

        def handler(request):
            import json as _json
            seen.update(_json.loads(request.content))
            return _httpx.Response(200, text='{"choices":[{"message":{"content":"ok"}}]}')

        _mock_async_client(monkeypatch, handler)

        import asyncio
        asyncio.run(CustomClient().complete("hi"))
        assert seen["max_tokens"] == 2048
