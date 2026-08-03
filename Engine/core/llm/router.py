import os
import logging
from .client import BaseLLMClient
from .openai_client import OpenAIClient, AllKeysExhausted
from .gemini_client import GeminiClient
from .custom_client import CustomClient
from .openrouter_client import OpenRouterClient

logger = logging.getLogger(__name__)


class FallbackTriggered(Exception):
    """All providers in the fallback chain failed."""
    pass


class LLMRouter:
    def __init__(self):
        self.providers: dict[str, BaseLLMClient] = {}
        self.fallback_order: list[str] = []
        self._load_providers()

    def _load_providers(self):
        primary = os.getenv("PRIMARY_LLM", "").strip()
        fallback = os.getenv("FALLBACK_LLM", "").strip()
        custom_url = os.getenv("CUSTOM_LLM_URL", "").strip()
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()

        order = []

        if primary == "openai":
            self.providers["openai"] = OpenAIClient()
            order.append("openai")

        if fallback == "gemini":
            try:
                self.providers["gemini"] = GeminiClient()
                order.append("gemini")
            except ValueError as e:
                logger.warning(f"Gemini not available: {e}")

        if custom_url:
            try:
                self.providers["custom"] = CustomClient()
                order.append("custom")
            except ValueError as e:
                logger.warning(f"Custom LLM not available: {e}")

        if openrouter_key:
            try:
                self.providers["openrouter"] = OpenRouterClient()
                order.append("openrouter")
            except ValueError as e:
                logger.warning(f"OpenRouter not available: {e}")

        self.fallback_order = order

    async def complete(self, prompt: str, stage: str = "") -> str:
        last_error = None
        for provider_name in self.fallback_order:
            try:
                provider = self.providers[provider_name]
                logger.info(f"LLM call: provider={provider_name} stage={stage}")
                return await provider.complete(prompt, stage)
            except AllKeysExhausted as e:
                last_error = str(e)
                logger.warning(f"Provider {provider_name} keys exhausted, trying fallback")
                continue
            except Exception as e:
                last_error = str(e)
                logger.warning(f"Provider {provider_name} failed: {e}, trying fallback")
                continue

        raise FallbackTriggered(f"All providers failed: {last_error}")
