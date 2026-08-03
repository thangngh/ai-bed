import os
import json
import logging
import httpx
from .client import BaseLLMClient

logger = logging.getLogger(__name__)


class OpenRouterClient(BaseLLMClient):
    def __init__(self, model: str = "google/gemma-4-26b-a4b-it:free", max_tokens: int = 4000, temperature: float = 0.7):
        self.api_key = os.getenv("OPENROUTER_API_KEY", "")
        self.model = os.getenv("OPENROUTER_MODEL", model)
        self.max_tokens = max_tokens
        self.temperature = temperature

        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY not configured")

    async def complete(self, prompt: str, stage: str = "") -> str:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
        }

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
                return data["choices"][0]["message"]["content"]
            if "response" in data:
                return data["response"]
            return str(data)