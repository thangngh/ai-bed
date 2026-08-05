import pytest
from core.llm.router import LLMRouter, FallbackTriggered
from core.llm.client import BaseLLMClient


class MockClient(BaseLLMClient):
    def __init__(self, name: str, should_fail: bool = False):
        self.name = name
        self.should_fail = should_fail

    async def complete(self, prompt: str, stage: str = "") -> str:
        if self.should_fail:
            raise Exception(f"{self.name} failed")
        return f"{self.name}:{prompt[:20]}"


class TestLLMRouter:
    def test_successful_primary(self):
        router = LLMRouter()
        router.providers = {"primary": MockClient("primary")}
        router.fallback_order = ["primary"]

        import asyncio
        result = asyncio.run(router.complete("test prompt"))
        assert result == "primary:test prompt"

    def test_fallback_on_failure(self):
        router = LLMRouter()
        router.providers = {
            "primary": MockClient("primary", should_fail=True),
            "fallback": MockClient("fallback"),
        }
        router.fallback_order = ["primary", "fallback"]

        import asyncio
        result = asyncio.run(router.complete("test prompt"))
        assert result == "fallback:test prompt"

    def test_all_providers_fail(self):
        router = LLMRouter()
        router.providers = {
            "p1": MockClient("p1", should_fail=True),
        }
        router.fallback_order = ["p1"]

        import asyncio
        with pytest.raises(FallbackTriggered):
            asyncio.run(router.complete("test"))

    def test_skips_openai_without_keys(self, monkeypatch):
        # Registering OpenAI with no keys puts a guaranteed failure at the head
        # of the chain, and a single generation makes up to 10 LLM calls -- so
        # that is 10 wasted round trips per story.
        monkeypatch.setenv("PRIMARY_LLM", "openai")
        monkeypatch.setenv("OPENAI_API_KEYS", "")
        monkeypatch.setenv("FALLBACK_LLM", "")
        monkeypatch.setenv("CUSTOM_LLM_URL", "")
        monkeypatch.setenv("OPENROUTER_API_KEY", "")
        router = LLMRouter()
        assert "openai" not in router.fallback_order

    def test_drops_provider_after_repeated_failures(self):
        import asyncio
        router = LLMRouter()
        router.providers = {
            "broken": MockClient("broken", should_fail=True),
            "good": MockClient("good"),
        }
        router.fallback_order = ["broken", "good"]
        router._consecutive_failures = {}

        for _ in range(3):
            asyncio.run(router.complete("test"))

        assert router.fallback_order == ["good"]

    def test_success_resets_the_failure_count(self):
        import asyncio
        flaky = MockClient("flaky")
        router = LLMRouter()
        router.providers = {"flaky": flaky, "good": MockClient("good")}
        router.fallback_order = ["flaky", "good"]
        router._consecutive_failures = {}

        # Two failures, then a success, then two more: never three in a row.
        for fail in (True, True, False, True, True):
            flaky.should_fail = fail
            asyncio.run(router.complete("test"))

        assert "flaky" in router.fallback_order

    def test_never_drops_the_last_provider(self):
        # A broken sole provider still beats an empty chain: keep retrying so
        # the Engine recovers by itself instead of needing a restart.
        import asyncio
        router = LLMRouter()
        router.providers = {"only": MockClient("only", should_fail=True)}
        router.fallback_order = ["only"]
        router._consecutive_failures = {}

        for _ in range(5):
            with pytest.raises(FallbackTriggered):
                asyncio.run(router.complete("test"))

        assert router.fallback_order == ["only"]

    def test_loads_openrouter_when_key_present(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
        monkeypatch.setenv("PRIMARY_LLM", "")
        monkeypatch.setenv("FALLBACK_LLM", "")
        monkeypatch.setenv("CUSTOM_LLM_URL", "")
        monkeypatch.setenv("GEMINI_API_KEY", "")
        monkeypatch.setenv("OPENAI_API_KEYS", "")
        router = LLMRouter()
        assert "openrouter" in router.providers
        assert router.fallback_order == ["openrouter"]


class TestChainOverride:
    """LLM_CHAIN, so a deployment picks the order instead of the code."""

    @pytest.fixture(autouse=True)
    def two_providers(self, monkeypatch):
        # custom then openrouter, which is the registration order.
        monkeypatch.setenv("PRIMARY_LLM", "")
        monkeypatch.setenv("FALLBACK_LLM", "")
        monkeypatch.setenv("OPENAI_API_KEYS", "")
        monkeypatch.setenv("GEMINI_API_KEY", "")
        monkeypatch.setenv("CUSTOM_LLM_URL", "http://9router-lb:20128/v1/chat/completions")
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
        monkeypatch.delenv("LLM_CHAIN", raising=False)

    def test_default_order_is_registration_order(self):
        assert LLMRouter().fallback_order == ["custom", "openrouter"]

    def test_reorders_the_chain(self, monkeypatch):
        monkeypatch.setenv("LLM_CHAIN", "openrouter,custom")
        assert LLMRouter().fallback_order == ["openrouter", "custom"]

    def test_restricts_the_chain(self, monkeypatch):
        monkeypatch.setenv("LLM_CHAIN", "openrouter")
        assert LLMRouter().fallback_order == ["openrouter"]
        # The excluded provider is still constructed, so flipping the variable
        # back needs no other change.
        assert "custom" in LLMRouter().providers

    def test_ignores_names_that_are_not_configured(self, monkeypatch):
        monkeypatch.setenv("LLM_CHAIN", "gemini,openrouter")
        assert LLMRouter().fallback_order == ["openrouter"]

    def test_a_typo_does_not_empty_the_chain(self, monkeypatch):
        # An override that selects nothing would take the Engine down for a
        # spelling mistake; the registration order stands instead.
        monkeypatch.setenv("LLM_CHAIN", "openrouterr")
        assert LLMRouter().fallback_order == ["custom", "openrouter"]

    def test_blank_override_is_ignored(self, monkeypatch):
        monkeypatch.setenv("LLM_CHAIN", "   ")
        assert LLMRouter().fallback_order == ["custom", "openrouter"]


class RecordingClient(BaseLLMClient):
    """Remembers every call, so a test can assert on which provider served."""

    def __init__(self, name: str, log: list, should_fail: bool = False):
        self.name = name
        self.log = log
        self.should_fail = should_fail

    async def complete(self, prompt: str, stage: str = "") -> str:
        self.log.append(self.name)
        if self.should_fail:
            raise Exception(f"{self.name} failed")
        return self.name


class TestRotation:
    """LLM_ROTATE, so one provider does not carry every request.

    Entering the chain at its head every time is what exhausted the OpenRouter
    free tier's daily cap in a single afternoon of testing: the head answered
    100% of calls while the rest of the chain sat idle.
    """

    @staticmethod
    def _router(names, log, failing=(), rotate=True):
        router = LLMRouter()
        router.providers = {
            n: RecordingClient(n, log, should_fail=n in failing) for n in names
        }
        router.fallback_order = list(names)
        router._consecutive_failures = {}
        router.rotate = rotate
        router._rotation = 0
        return router

    def test_without_rotation_the_head_serves_everything(self):
        import asyncio
        log = []
        router = self._router(["a", "b"], log, rotate=False)
        for _ in range(4):
            asyncio.run(router.complete("test"))
        assert log == ["a", "a", "a", "a"]

    def test_rotation_advances_the_entry_point(self):
        import asyncio
        log = []
        router = self._router(["a", "b", "c"], log)
        for _ in range(4):
            asyncio.run(router.complete("test"))
        # One call each, then wrap -- not a random pick.
        assert log == ["a", "b", "c", "a"]

    def test_rotation_still_falls_through_to_the_others(self):
        import asyncio
        log = []
        # Rotation starts at "a", which is broken; the call must still be
        # served rather than failing because the entry point happened to be bad.
        router = self._router(["a", "b"], log, failing={"a"})
        assert asyncio.run(router.complete("test")) == "b"
        assert log == ["a", "b"]

    def test_rotation_reorders_the_chain_but_never_shortens_it(self):
        import asyncio
        log = []
        router = self._router(["a", "b", "c"], log, failing={"a", "b", "c"})
        router._rotation = 1  # enter at "b"
        with pytest.raises(FallbackTriggered):
            asyncio.run(router.complete("test"))
        assert log == ["b", "c", "a"]

    def test_a_dropped_provider_is_not_resurrected_by_rotation(self):
        import asyncio
        log = []
        router = self._router(["a", "b"], log, failing={"a"})
        for _ in range(6):
            asyncio.run(router.complete("test"))

        # Three consecutive failures retire "a"; rotation over what is left
        # must keep working rather than indexing off the end of the old chain.
        assert router.fallback_order == ["b"]
        assert log[-2:] == ["b", "b"]

    def test_rotation_is_off_unless_asked_for(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
        monkeypatch.setenv("PRIMARY_LLM", "")
        monkeypatch.setenv("FALLBACK_LLM", "")
        monkeypatch.setenv("CUSTOM_LLM_URL", "")
        monkeypatch.setenv("OPENAI_API_KEYS", "")

        monkeypatch.delenv("LLM_ROTATE", raising=False)
        assert LLMRouter().rotate is False
        # A disabled-looking value must not read as enabled.
        monkeypatch.setenv("LLM_ROTATE", "false")
        assert LLMRouter().rotate is False
        monkeypatch.setenv("LLM_ROTATE", "true")
        assert LLMRouter().rotate is True
        monkeypatch.setenv("LLM_ROTATE", "1")
        assert LLMRouter().rotate is True
