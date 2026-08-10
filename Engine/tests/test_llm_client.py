import pytest
from core.llm.client import BaseLLMClient


class ConcreteClient(BaseLLMClient):
    async def complete(self, prompt: str, stage: str = "", system: str = "") -> str:
        return f"response:{prompt[:10]}"


@pytest.mark.asyncio
async def test_base_client_can_instantiate():
    client = ConcreteClient()
    result = await client.complete("hello world")
    assert result == "response:hello worl"


@pytest.mark.asyncio
async def test_base_client_raises_if_not_implemented():
    with pytest.raises(TypeError):
        class BadClient(BaseLLMClient):
            pass
        BadClient()
