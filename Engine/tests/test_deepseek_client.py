import pytest
from core.llm.client import EmptyCompletionError
from core.llm.deepseek_client import DeepSeekClient


class FakeMessage:
    def __init__(self, content):
        self.content = content


class FakeChoice:
    def __init__(self, content):
        self.message = FakeMessage(content)


class FakeResponse:
    def __init__(self, content):
        self.choices = [FakeChoice(content)]


class FakeCompletions:
    def __init__(self, response=None, exc=None):
        self.response = response
        self.exc = exc
        self.kwargs = None

    async def create(self, **kwargs):
        self.kwargs = kwargs
        if self.exc:
            raise self.exc
        return self.response


class FakeChat:
    def __init__(self, completions):
        self.completions = completions


class FakeClient:
    def __init__(self, completions):
        self.chat = FakeChat(completions)


def _client(monkeypatch, completions):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-ds-test")
    c = DeepSeekClient()
    c._client = FakeClient(completions)
    return c


class TestDeepSeekClient:
    def test_requires_key(self, monkeypatch):
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        with pytest.raises(ValueError, match="DEEPSEEK_API_KEY"):
            DeepSeekClient()

    def test_reads_env(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-ds-test")
        monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-reasoner")
        monkeypatch.setenv("DEEPSEEK_BASE_URL", "http://localhost:20128")
        monkeypatch.setenv("DEEPSEEK_MAX_TOKENS", "4096")
        c = DeepSeekClient()
        assert c.model == "deepseek-reasoner"
        assert c.base_url == "http://localhost:20128"
        assert c.max_tokens == 4096

    @pytest.mark.asyncio
    async def test_returns_content(self, monkeypatch):
        completions = FakeCompletions(response=FakeResponse("hello"))
        c = _client(monkeypatch, completions)
        assert await c.complete("hi", stage="planner") == "hello"
        assert completions.kwargs["model"] == "deepseek-chat"

    @pytest.mark.asyncio
    async def test_empty_content_raises(self, monkeypatch):
        completions = FakeCompletions(response=FakeResponse(""))
        c = _client(monkeypatch, completions)
        with pytest.raises(EmptyCompletionError):
            await c.complete("hi", stage="writer")

    @pytest.mark.asyncio
    async def test_api_error_propagates_for_router_fallback(self, monkeypatch):
        # The router treats any exception as a failure and moves to the next
        # provider, so rate limits and 5xx must surface rather than be eaten.
        class Boom(Exception):
            pass

        completions = FakeCompletions(exc=Boom("upstream 429"))
        c = _client(monkeypatch, completions)
        with pytest.raises(Boom):
            await c.complete("hi")
