import os
import logging
import time
from .client import BaseLLMClient
from .openai_client import OpenAIClient, AllKeysExhausted
from .gemini_client import GeminiClient
from .custom_client import CustomClient
from .deepseek_client import DeepSeekClient
from .openrouter_client import OpenRouterClient

logger = logging.getLogger(__name__)


class FallbackTriggered(Exception):
    """All providers in the fallback chain failed."""
    pass


class UnusableResponse(Exception):
    """A provider answered, but the caller cannot use what it said."""
    pass


# After this many consecutive failures a provider is dropped from the chain
# for the life of the process. Without this, a dead provider is retried on
# every LLM call -- and a single generation makes up to 10 of them, so a
# misconfigured primary costs 10 wasted round trips per story.
MAX_CONSECUTIVE_FAILURES = 3


def _rotate_enabled() -> bool:
    return os.getenv("LLM_ROTATE", "").strip().lower() in {"1", "true", "yes", "on"}


class LLMRouter:
    def __init__(self):
        self.providers: dict[str, BaseLLMClient] = {}
        self.fallback_order: list[str] = []
        # Round-robin the *starting* provider instead of always entering the
        # chain at its head. See _next_chain.
        self.rotate = _rotate_enabled()
        self._rotation = 0
        self._load_providers()

    def _load_providers(self):
        primary = os.getenv("PRIMARY_LLM", "").strip()
        fallback = os.getenv("FALLBACK_LLM", "").strip()
        custom_url = os.getenv("CUSTOM_LLM_URL", "").strip()
        custom_adapters = os.getenv("CUSTOM_LLM_ADAPTERS")
        custom_configured = bool(
            custom_url
            or (custom_adapters is not None and custom_adapters.strip())
        )
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

        if custom_configured:
            try:
                self.providers["custom"] = CustomClient()
                order.append("custom")
            except ValueError as e:
                logger.warning(f"Custom LLM not available: {e}")

        if os.getenv("DEEPSEEK_API_KEY", "").strip():
            try:
                self.providers["deepseek"] = DeepSeekClient()
                order.append("deepseek")
            except ValueError as e:
                logger.warning(f"DeepSeek not available: {e}")

        if openrouter_key or os.getenv("OPENROUTER_API_KEYS", "").strip():
            try:
                self.providers["openrouter"] = OpenRouterClient()
                order.append("openrouter")
            except ValueError as e:
                logger.warning(f"OpenRouter not available: {e}")

        self.fallback_order = self._apply_chain_override(order)
        self._consecutive_failures: dict[str, int] = {}
        logger.info(
            f"LLM fallback chain: "
            f"{' -> '.join(self.fallback_order) if self.fallback_order else '(empty)'}"
            f"{' (rotating)' if self.rotate else ''}"
        )

    def _apply_chain_override(self, order: list[str]) -> list[str]:
        """Let deployment decide the order, rather than the registration code.

        Registration order is fixed (openai, gemini, custom, deepseek,
        openrouter), so a
        deployment that configures both a local proxy and a hosted provider
        gets the proxy first whether or not that is the faster path. LLM_CHAIN
        is a comma-separated list of provider names that reorders -- and
        restricts -- the chain, e.g. `LLM_CHAIN=openrouter,custom` to keep a
        9router HA stack as failover rather than as primary.
        """
        raw = os.getenv("LLM_CHAIN", "").strip()
        if not raw:
            return order

        wanted = [name.strip() for name in raw.split(",") if name.strip()]
        chosen = [name for name in wanted if name in self.providers]

        unknown = [name for name in wanted if name not in self.providers]
        if unknown:
            logger.warning(
                f"LLM_CHAIN names providers that are not configured: {', '.join(unknown)}"
            )
        if not chosen:
            # An override that empties the chain would take the Engine down for
            # a typo. Fall back to the registration order and say so.
            logger.warning(
                f"LLM_CHAIN={raw!r} selected no configured provider; "
                f"keeping the default order instead"
            )
            return order

        dropped = [name for name in order if name not in chosen]
        if dropped:
            logger.info(f"LLM_CHAIN excludes configured provider(s): {', '.join(dropped)}")
        return chosen

    def _next_chain(self) -> list[str]:
        """The order to try for this one call.

        Without rotation every call enters the chain at its head, so the first
        provider serves 100% of requests and the rest are dead weight until it
        breaks. On free tiers that is how you find the daily cap: the head
        provider answered every request until it started returning 429 and the
        Engine fell back for the rest of the day (measured, docs/08 §3b).

        With LLM_ROTATE the *entry point* advances one position per call and
        wraps, so N providers each carry roughly 1/N of the load while every
        one of them stays available as a fallback for the others -- the order
        is rotated, never shortened.

        Rotation is off by default because it is only a win when the providers
        are interchangeable. Where one is markedly better or faster, entering
        the chain at a worse provider spends its whole timeout before falling
        through, and pays that on every 1/N of calls.
        """
        chain = list(self.fallback_order)
        if not self.rotate or len(chain) < 2:
            return chain
        offset = self._rotation % len(chain)
        self._rotation = offset + 1
        return chain[offset:] + chain[:offset]

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

    async def complete(self, prompt: str, stage: str = "", accept=None, system: str = "") -> str:
        """Ask the chain until one provider gives an answer the caller accepts.

        `accept(raw) -> bool` is optional and stage-specific: only the caller
        knows what a planner or a writer reply has to look like. Without it,
        the chain stops at the first provider that returns 200 -- which is how
        an OpenRouter reply carrying a JSON array instead of the planner
        object ended the call, leaving the configured `custom` (9router) tier
        untried. A rejected body is a failure of that provider for this call,
        not of the request.

        `system` is passed through untouched: the router must never merge it
        into `prompt`, because the separation between operator rules and
        untrusted data is exactly what the provider's system channel encodes.
        """
        last_error = None
        # A snapshot, for two reasons: a provider may be dropped mid-loop, and
        # under rotation this call's order is not self.fallback_order.
        for provider_name in self._next_chain():
            if provider_name not in self.fallback_order:
                # Dropped by an earlier provider's failure handling in this
                # same loop; do not resurrect it from the snapshot.
                continue
            try:
                provider = self.providers[provider_name]
                logger.info(f"LLM call: provider={provider_name} stage={stage}")
                started = time.monotonic()
                result = await provider.complete(prompt, stage, system)
                if accept is not None and not accept(result):
                    raise UnusableResponse(
                        f"{provider_name} returned a response {stage or 'the caller'} "
                        f"cannot use ({len(result)} chars)"
                    )
                # The elapsed time is the whole point of the budget work in
                # docs/09; without it a fallback tells you nothing about which
                # stage spent the time.
                logger.info(
                    f"LLM done: provider={provider_name} stage={stage} "
                    f"in {time.monotonic() - started:.1f}s, {len(result)} chars"
                )
                self._consecutive_failures[provider_name] = 0
                return result
            except UnusableResponse as e:
                # Deliberately not counted towards MAX_CONSECUTIVE_FAILURES.
                # Model output is stochastic, so three unusable replies say
                # much less about a provider than three transport failures do,
                # and retiring it for the life of the process on that evidence
                # would shrink the chain for a bad afternoon of sampling.
                last_error = str(e)
                logger.warning(f"{e}, trying fallback")
                continue
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
