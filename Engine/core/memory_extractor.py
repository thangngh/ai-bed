import asyncio
import json
import logging
import os
from .cleanup import extract_json_block
from .llm.router import LLMRouter

logger = logging.getLogger(__name__)

# Extraction runs *after* the pipeline, so PIPELINE_BUDGET_SECONDS does not
# cover it: a slow provider added its full latency on top of an
# already-finished story (measured 15.1s), and BE's ENGINE_TIMEOUT_MS had no
# bound to be set against. The story is already written by then, so the right
# trade is to give up on the memories rather than make the child wait.
DEFAULT_TIMEOUT_SECONDS = 20.0


def _timeout_from_env() -> float:
    raw = os.getenv("MEMORY_EXTRACT_TIMEOUT_SECONDS", "").strip()
    if not raw:
        return DEFAULT_TIMEOUT_SECONDS
    try:
        value = float(raw)
    except ValueError:
        logger.warning(
            "Invalid MEMORY_EXTRACT_TIMEOUT_SECONDS=%r, using %s", raw, DEFAULT_TIMEOUT_SECONDS
        )
        return DEFAULT_TIMEOUT_SECONDS
    if value <= 0:
        logger.warning(
            "MEMORY_EXTRACT_TIMEOUT_SECONDS=%s is not positive, using %s",
            value,
            DEFAULT_TIMEOUT_SECONDS,
        )
        return DEFAULT_TIMEOUT_SECONDS
    return value


class MemoryExtractor:
    def __init__(self, router: LLMRouter):
        self.router = router
        self.timeout_seconds = _timeout_from_env()

    async def extract(self, story: dict, language: str, is_fallback: bool = False) -> list[dict]:
        if is_fallback:
            return []

        prompt = (
            f"Extract personalized memory items from this children's story.\n"
            f"Story: {json.dumps(story, ensure_ascii=False)}\n\n"
            f"Return JSON: memories array with type (interest/character/theme/feedback), "
            f"key, value (in Vietnamese), confidence (0-1), source text.\n"
            f"Only include memories with confidence >= 0.3."
        )

        try:
            raw = await asyncio.wait_for(
                self.router.complete(prompt, "memory_ext"), timeout=self.timeout_seconds
            )
            # Same parser as every other stage. Plain json.loads() rejected the
            # ```json fences and the prose the models actually wrap around the
            # object, so extraction silently returned [] for every story and the
            # child's memory never filled up.
            data = extract_json_block(raw)
            memories = data if isinstance(data, list) else data.get("memories", [])
            filtered = [m for m in memories if isinstance(m, dict) and m.get("confidence", 0) >= 0.3]
            logger.info(f"Extracted {len(filtered)} memories from story")
            return filtered
        except asyncio.TimeoutError:
            logger.warning(
                f"Memory extraction gave up after {self.timeout_seconds:.0f}s; "
                f"the story is unaffected"
            )
            return []
        except Exception as e:
            logger.warning(f"Memory extraction failed: {e}")
            return []
