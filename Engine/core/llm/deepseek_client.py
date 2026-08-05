import os
import logging
from openai import AsyncOpenAI
from .client import BaseLLMClient, EmptyCompletionError

logger = logging.getLogger(__name__)

class DeepSeekClient(BaseLLMClient):
    """DeepSeek, OpenAI-compatible.

    Defaults to the hosted API (https://api.deepseek.com). Point
    DEEPSEEK_BASE_URL at a local OpenAI-compatible proxy -- e.g. 9router's
    `deepsteak` combo -- to run the same client through the HA stack instead.

    The OpenAI SDK client is built lazily on first use (the OpenAIClient
    pattern): constructing it eagerly breaks in environments whose httpx
    already dropped the `proxies` kwarg.
    """

    def __init__(self):
        self.api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        if not self.api_key:
            raise ValueError("DEEPSEEK_API_KEY not configured")
        self.base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
        self.model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip()
        self.max_tokens = int(
            os.getenv("DEEPSEEK_MAX_TOKENS", os.getenv("OPENAI_MAX_TOKENS", "1024"))
        )
        self.temperature = float(
            os.getenv("DEEPSEEK_TEMPERATURE", os.getenv("OPENAI_TEMPERATURE", "0.7"))
        )
        self._client = None

    def _get_client(self):
        if self._client is None:
            self._client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        return self._client

    async def complete(self, prompt: str, stage: str = "") -> str:
        try:
            response = await self._get_client().chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=self.max_tokens,
                temperature=self.temperature,
            )
            content = response.choices[0].message.content or ""
            if not content.strip():
                raise EmptyCompletionError(
                    f"{self.model} returned no content for stage={stage or '?'}"
                )
            return content
        except EmptyCompletionError:
            raise
        except Exception as e:
            logger.error(f"DeepSeek API error stage={stage}: {e}")
            raise
