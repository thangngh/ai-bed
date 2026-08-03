import asyncio
import json
import logging
import time
from .prompts.registry import PromptRegistry
from .pipeline import StoryPipeline
from .memory_extractor import MemoryExtractor
from .llm.router import LLMRouter

logger = logging.getLogger(__name__)


class StoryOrchestrator:
    def __init__(self):
        self.registry = PromptRegistry()
        self.router = LLMRouter()
        self.pipeline = StoryPipeline(self.router)
        self.extractor = MemoryExtractor(self.router)

    async def generate(self, data: dict) -> dict:
        start = time.time()

        prompts = self.registry.assemble(age=data.get("age", 4), data={
            "childName": data.get("child_name", "Bé"),
            "age": str(data.get("age", 4)),
            "theme": data.get("theme", "phiêu lưu"),
            "goal": data.get("goal", ""),
            "mood": data.get("mood", "vui vẻ"),
            "memories": json.dumps(data.get("memories", []), ensure_ascii=False),
            "gender": data.get("gender", "unspecified"),
            "favoriteCharacter": data.get("favorite_character", ""),
        })
        # DEBUG, not WARNING: this fires on every request and dumps the whole
        # assembled prompt, which contains the child's name and memories.
        logger.debug("Assembled prompts: %s", prompts)
        result = await self.pipeline.run(prompts)
        memories = []
        if result.success and not result.is_fallback:
            story_data = {"title": result.title, "content": result.content}
            memories = await self.extractor.extract(story_data, data.get("language", "vi"), is_fallback=result.is_fallback)

        elapsed = int((time.time() - start) * 1000)

        return {
            "request_id": data.get("request_id", ""),
            "title": result.title,
            "content": result.content,
            "safety_status": result.safety_verdict,
            "memories": memories,
            "llm_calls": result.llm_calls,
            "word_count": sum(len(s.get("text", "").split()) for s in result.content),
            "is_fallback": result.is_fallback,
            "latency_ms": elapsed,
            "error": result.error,
        }
