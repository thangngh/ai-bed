import pytest
from core.llm.client import EmptyCompletionError
from core.llm.custom_client import CustomClient
from core.llm.custom_client import (
    parse_sse_response,
    iter_stream_frames,
    DEFAULT_MAX_TOKENS,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_STREAM_IDLE_SECONDS,
)


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

    def test_stream_idle_timeout_is_far_above_the_observed_gap(self):
        # Largest measured gap between chunks on a streamed writer call was
        # 1.7s (reasoning_content keeps arriving while the model thinks), so
        # this fires on a dead stream and never on a slow one.
        assert DEFAULT_STREAM_IDLE_SECONDS >= 30

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


# The frames below are the shapes 9router actually put on the wire for
# `oc/deepseek-v4-flash-free`, trimmed but not reworded. Inventing a tidier
# stream is how a reader ends up handling only the frames it imagined.
OPENING_FRAME = (
    'data: {"id":"718e","object":"chat.completion.chunk","created":1785862533,'
    '"model":"deepseek-v4-flash-free","choices":[{"index":0,"finish_reason":null,'
    '"logprobs":null,"delta":{"role":"assistant","content":null,'
    '"reasoning_content":""}}],"usage":null}'
)
CLOSING_FRAME = (
    'data: {"choices":[],"cost":"0","object":"chat.completion.chunk",'
    '"created":1785862535}'
)


def _delta(text=None, reasoning=None, finish_reason=None):
    import json as _json
    delta = {"content": text, "reasoning_content": reasoning}
    payload = {
        "object": "chat.completion.chunk",
        "choices": [{"index": 0, "finish_reason": finish_reason, "delta": delta}],
    }
    return "data: " + _json.dumps(payload)


def _sse(*frames):
    # Real streams separate frames with a blank line and close with [DONE].
    return "\n\n".join([*frames, "data: [DONE]"]) + "\n\n"


class TestIterStreamFrames:
    def test_opening_frame_has_null_content(self):
        # `"content": null`, not absent -- .get("content", "") would still
        # return None and break the join downstream.
        frames = list(iter_stream_frames([OPENING_FRAME]))
        assert len(frames) == 1
        assert frames[0].content == ""
        assert frames[0].reasoning == ""

    def test_closing_frame_has_no_choices(self):
        # `"choices": []`, so choices[0] raises IndexError on a naive reader.
        frames = list(iter_stream_frames([CLOSING_FRAME]))
        assert frames[0].content == ""
        assert frames[0].finish_reason is None

    def test_stops_at_done(self):
        lines = [_delta("a"), "data: [DONE]", _delta("b")]
        assert [f.content for f in iter_stream_frames(lines)] == ["a"]

    def test_skips_blank_separators_and_junk(self):
        lines = [_delta("a"), "", "   ", ": keep-alive", _delta("b")]
        assert "".join(f.content for f in iter_stream_frames(lines)) == "ab"

    def test_undecodable_frame_does_not_discard_what_arrived(self):
        # A truncated final frame is the normal shape of an interrupted
        # stream; the content already received is still worth returning.
        lines = [_delta("Xin "), 'data: {"choices":[{"delta":{"cont', _delta("chào")]
        assert "".join(f.content for f in iter_stream_frames(lines)) == "Xin chào"

    def test_reads_reasoning_separately_from_content(self):
        frames = list(iter_stream_frames([_delta(None, reasoning="thinking")]))
        assert frames[0].content == ""
        assert frames[0].reasoning == "thinking"

    def test_reads_a_whole_message_frame(self):
        # A proxy that assembles the answer itself sends `message`, not `delta`.
        body = 'data: {"choices":[{"message":{"role":"assistant","content":"hi"}}]}'
        assert list(iter_stream_frames([body]))[0].content == "hi"


class TestStreaming:
    @staticmethod
    def _client(monkeypatch, body, seen=None, status=200):
        import httpx as _httpx
        import json as _json
        monkeypatch.setenv("CUSTOM_LLM_URL", "http://proxy/v1/chat/completions")
        monkeypatch.setenv("CUSTOM_LLM_MODEL", "m")

        def handler(request):
            if seen is not None:
                seen.update(_json.loads(request.content))
            return _httpx.Response(status, text=body)

        _mock_async_client(monkeypatch, handler)
        return CustomClient()

    @pytest.mark.asyncio
    async def test_asks_for_a_stream_by_default(self, monkeypatch):
        seen = {}
        client = self._client(monkeypatch, _sse(_delta("ok")), seen=seen)
        await client.complete("hi")
        assert seen["stream"] is True

    @pytest.mark.asyncio
    async def test_thinking_disabled_by_default(self, monkeypatch):
        # Measured on the 9router stack: the oc/ reasoning backends complete
        # faster with thinking off, and nemotron returns 400 with it on.
        seen = {}
        client = self._client(monkeypatch, _sse(_delta("ok")), seen=seen)
        await client.complete("hi")
        assert seen["thinking"] == {"type": "disabled"}

    @pytest.mark.asyncio
    async def test_thinking_mode_is_configurable(self, monkeypatch):
        monkeypatch.setenv("CUSTOM_LLM_THINKING", "enabled")
        seen = {}
        client = self._client(monkeypatch, _sse(_delta("ok")), seen=seen)
        await client.complete("hi")
        assert seen["thinking"] == {"type": "enabled"}

    @pytest.mark.asyncio
    async def test_thinking_param_can_be_omitted(self, monkeypatch):
        monkeypatch.setenv("CUSTOM_LLM_THINKING", "")
        seen = {}
        client = self._client(monkeypatch, _sse(_delta("ok")), seen=seen)
        await client.complete("hi")
        assert "thinking" not in seen

    @pytest.mark.asyncio
    async def test_assembles_delta_frames(self, monkeypatch):
        body = _sse(
            OPENING_FRAME,
            _delta(None, reasoning="đang nghĩ"),
            _delta("Xin "),
            _delta("chào"),
            _delta(None, finish_reason="stop"),
            CLOSING_FRAME,
        )
        client = self._client(monkeypatch, body)
        assert await client.complete("hi", stage="writer") == "Xin chào"

    @pytest.mark.asyncio
    async def test_reasoning_only_stream_raises(self, monkeypatch):
        # The budget went on chain-of-thought and nothing was emitted. This
        # must fail rather than return "", or the router has no reason to try
        # the next provider.
        body = _sse(
            OPENING_FRAME,
            _delta(None, reasoning="x" * 50),
            _delta(None, finish_reason="length"),
        )
        client = self._client(monkeypatch, body)
        with pytest.raises(EmptyCompletionError) as excinfo:
            await client.complete("hi", stage="writer")
        # The message has to name the cause: this exact failure was first
        # diagnosed as a network problem.
        assert "CUSTOM_LLM_MAX_TOKENS" in str(excinfo.value)

    @pytest.mark.asyncio
    async def test_falls_back_when_the_proxy_ignores_stream(self, monkeypatch):
        # `stream: true` is a request, not a guarantee. A proxy that answers
        # with a single buffered object must still work.
        body = '{"choices":[{"message":{"role":"assistant","content":"buffered"}}]} data: [DONE]'
        client = self._client(monkeypatch, body)
        assert await client.complete("hi") == "buffered"

    @pytest.mark.asyncio
    async def test_http_error_still_surfaces(self, monkeypatch):
        import httpx as _httpx
        client = self._client(monkeypatch, "rate limited", status=429)
        with pytest.raises(_httpx.HTTPStatusError):
            await client.complete("hi")

    @pytest.mark.asyncio
    async def test_stream_can_be_turned_off(self, monkeypatch):
        monkeypatch.setenv("CUSTOM_LLM_STREAM", "false")
        seen = {}
        body = '{"choices":[{"message":{"content":"ok"}}]}'
        client = self._client(monkeypatch, body, seen=seen)
        assert client.stream is False
        assert await client.complete("hi") == "ok"
        assert "stream" not in seen
