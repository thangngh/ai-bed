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
