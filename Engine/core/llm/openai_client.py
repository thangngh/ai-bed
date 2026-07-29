import os
import logging
from typing import Optional
from openai import AsyncOpenAI, RateLimitError, AuthenticationError
from .client import BaseLLMClient

logger = logging.getLogger(__name__)


class AllKeysExhausted(Exception):
    """All OpenAI keys have been disabled."""
    pass


class OpenAIClient(BaseLLMClient):
    def __init__(self, model: str = "gpt-4o-mini", max_tokens: int = 1024, temperature: float = 0.7):
        keys_env = os.getenv("OPENAI_API_KEYS", "")
        self.keys = [k.strip() for k in keys_env.split(",") if k.strip()]
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature
        self._index = 0
        self._key_failures: dict[str, int] = {}
        self.max_failures = 3

    def _record_failure(self, key: str):
        self._key_failures[key] = self._key_failures.get(key, 0) + 1

    def _record_success(self, key: str):
        self._key_failures[key] = 0

    def _is_key_disabled(self, key: str) -> bool:
        return self._key_failures.get(key, 0) >= self.max_failures

    def _get_next_key(self) -> tuple[str, AsyncOpenAI]:
        if not self.keys:
            raise AllKeysExhausted("No OpenAI keys configured")

        for _ in range(len(self.keys)):
            key = self.keys[self._index]
            self._index = (self._index + 1) % len(self.keys)

            if not self._is_key_disabled(key):
                client = AsyncOpenAI(api_key=key)
                return key, client

        raise AllKeysExhausted("All OpenAI keys exhausted")

    async def complete(self, prompt: str, stage: str = "") -> str:
        key = None
        try:
            key, client = self._get_next_key()
            logger.info(f"OpenAI call with key ...{key[-4:]} stage={stage}")

            response = await client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=self.max_tokens,
                temperature=self.temperature,
            )

            self._record_success(key)
            return response.choices[0].message.content or ""

        except (RateLimitError, AuthenticationError) as e:
            if key:
                self._record_failure(key)
                logger.warning(f"OpenAI key ...{key[-4:]} failed: {e}. Trying next key...")
            return await self.complete(prompt, stage)
        except Exception as e:
            logger.error(f"OpenAI unexpected error: {e}")
            raise
