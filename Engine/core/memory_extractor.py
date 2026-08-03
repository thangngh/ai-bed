import json
import logging
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
            data = json.loads(raw)
            memories = data.get("memories", [])
            filtered = [m for m in memories if m.get("confidence", 0) >= 0.3]
            logger.info(f"Extracted {len(filtered)} memories from story")
            return filtered
        except Exception as e:
            logger.warning(f"Memory extraction failed: {e}")
            return []
