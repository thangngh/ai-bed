import os
import json
import logging
import httpx
from .client import BaseLLMClient, EmptyCompletionError, build_messages
from .openai_client import AllKeysExhausted

logger = logging.getLogger(__name__)


class OpenRouterClient(BaseLLMClient):
    """OpenRouter with key rotation across free-tier accounts.

    OPENROUTER_API_KEYS is a comma-separated list (2-3 free accounts is the
    intended production shape); OPENROUTER_API_KEY still works as a single
    key. A key that answers 401/429 is disabled for this process after
    max_failures, and the next key is tried -- the OpenAIClient pattern.
    """

    def __init__(self, model: str = "google/gemma-4-26b-a4b-it:free", max_tokens: int = 4000, temperature: float = 0.7):
        keys_env = os.getenv("OPENROUTER_API_KEYS", "")
        self.keys = [k.strip() for k in keys_env.split(",") if k.strip()]
        single = os.getenv("OPENROUTER_API_KEY", "").strip()
        if single and single not in self.keys:
            self.keys.append(single)
        if not self.keys:
            raise ValueError("OPENROUTER_API_KEY(S) not configured")
        self.model = os.getenv("OPENROUTER_MODEL", model)
        self.max_tokens = max_tokens
        self.temperature = temperature
        self._index = 0
        self._key_failures: dict[str, int] = {}
        self.max_failures = 3

    def _get_next_key(self) -> str:
        if not self.keys:
            raise AllKeysExhausted("No OpenRouter keys configured")
        for _ in range(len(self.keys)):
            key = self.keys[self._index]
            self._index = (self._index + 1) % len(self.keys)
            if self._key_failures.get(key, 0) < self.max_failures:
                return key
        raise AllKeysExhausted("All OpenRouter keys exhausted")

    async def complete(self, prompt: str, stage: str = "", system: str = "") -> str:
        key = self._get_next_key()
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        }
        payload = {
            "model": self.model,
            "messages": build_messages(prompt, system),
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
        }

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                body = response.text.strip()

                if body.endswith("data: [DONE]"):
                    body = body[: -len("data: [DONE]")].rstrip()

                data = json.loads(body)
                if "choices" in data:
                    content = data["choices"][0]["message"]["content"] or ""
                elif "response" in data:
                    content = data["response"] or ""
                else:
                    # Don't hand str(data) to the pipeline as if it were a story --
                    # it parses as neither JSON nor prose and only wastes a retry.
                    content = ""

                if not content.strip():
                    raise EmptyCompletionError(
                        f"{self.model} returned no content for stage={stage or '?'}"
                    )
                self._key_failures[key] = 0
                return content
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 429):
                self._key_failures[key] = self._key_failures.get(key, 0) + 1
                logger.warning(
                    f"OpenRouter key ...{key[-4:]} failed with {e.response.status_code}; "
                    f"trying next key"
                )
                return await self.complete(prompt, stage, system)
            raise
