import os
import logging
import httpx
from .client import BaseLLMClient

logger = logging.getLogger(__name__)


class CustomClient(BaseLLMClient):
    def __init__(self):
        self.api_url = os.getenv("CUSTOM_LLM_URL", "")
        self.api_key = os.getenv("CUSTOM_LLM_API_KEY", "")
        self.model = os.getenv("CUSTOM_LLM_MODEL", "default")

        if not self.api_url:
            raise ValueError("CUSTOM_LLM_URL not configured")

    async def complete(self, prompt: str, stage: str = "") -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": int(os.getenv("OPENAI_MAX_TOKENS", "1024")),
            "temperature": float(os.getenv("OPENAI_TEMPERATURE", "0.7")),
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(self.api_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

            if "choices" in data:
                return data["choices"][0]["message"]["content"]
            if "response" in data:
                return data["response"]
            return str(data)
