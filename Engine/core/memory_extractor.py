import json
import logging
from .cleanup import extract_json_block
from .llm.router import LLMRouter

logger = logging.getLogger(__name__)


class MemoryExtractor:
    def __init__(self, router: LLMRouter):
        self.router = router

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
            raw = await self.router.complete(prompt, "memory_ext")
            # Same parser as every other stage. Plain json.loads() rejected the
            # ```json fences and the prose the models actually wrap around the
            # object, so extraction silently returned [] for every story and the
            # child's memory never filled up.
            data = extract_json_block(raw)
            memories = data if isinstance(data, list) else data.get("memories", [])
            filtered = [m for m in memories if isinstance(m, dict) and m.get("confidence", 0) >= 0.3]
            logger.info(f"Extracted {len(filtered)} memories from story")
            return filtered
        except Exception as e:
            logger.warning(f"Memory extraction failed: {e}")
            return []
