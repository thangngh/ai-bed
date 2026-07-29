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
