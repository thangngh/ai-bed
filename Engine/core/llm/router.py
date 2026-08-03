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


# After this many consecutive failures a provider is dropped from the chain
# for the life of the process. Without this, a dead provider is retried on
# every LLM call -- and a single generation makes up to 10 of them, so a
# misconfigured primary costs 10 wasted round trips per story.
MAX_CONSECUTIVE_FAILURES = 3


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
            # Registering OpenAI without usable keys puts a guaranteed failure
            # at the head of the chain, and every call pays for it before
            # reaching a provider that works. Skip it, the way Gemini and the
            # others already do when their credentials are missing.
            if os.getenv("OPENAI_API_KEYS", "").strip():
                self.providers["openai"] = OpenAIClient(
                    model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                    max_tokens=int(os.getenv("OPENAI_MAX_TOKENS", "1024")),
                    temperature=float(os.getenv("OPENAI_TEMPERATURE", "0.7")),
                )
                order.append("openai")
            else:
                logger.warning("OpenAI not available: OPENAI_API_KEYS not configured")

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
        self._consecutive_failures: dict[str, int] = {}
        logger.info(f"LLM fallback chain: {' -> '.join(order) if order else '(empty)'}")

    def _drop(self, provider_name: str, reason: str):
        if provider_name not in self.fallback_order:
            return
        if len(self.fallback_order) == 1:
            # Never empty the chain. A broken sole provider still beats no
            # provider at all: keep retrying it so the Engine recovers on its
            # own when the outage ends, instead of needing a restart.
            logger.warning(
                f"Provider {provider_name} keeps failing ({reason}) but is the only one "
                f"left; keeping it in the chain"
            )
            return

        self.fallback_order.remove(provider_name)
        logger.warning(
            f"Dropping provider {provider_name} from the chain ({reason}). "
            f"Remaining: {' -> '.join(self.fallback_order)}"
        )

    async def complete(self, prompt: str, stage: str = "") -> str:
        last_error = None
        # Iterate over a copy: a provider may be dropped mid-loop.
        for provider_name in list(self.fallback_order):
            try:
                provider = self.providers[provider_name]
                logger.info(f"LLM call: provider={provider_name} stage={stage}")
                result = await provider.complete(prompt, stage)
                self._consecutive_failures[provider_name] = 0
                return result
            except AllKeysExhausted as e:
                last_error = str(e)
                # Definitive: no key will start working on its own.
                self._drop(provider_name, "all keys exhausted")
                continue
            except Exception as e:
                last_error = str(e)
                count = self._consecutive_failures.get(provider_name, 0) + 1
                self._consecutive_failures[provider_name] = count
                logger.warning(
                    f"Provider {provider_name} failed ({count}/{MAX_CONSECUTIVE_FAILURES}): {e}, trying fallback"
                )
                if count >= MAX_CONSECUTIVE_FAILURES:
                    self._drop(provider_name, f"{count} consecutive failures")
                continue

        raise FallbackTriggered(f"All providers failed: {last_error}")
