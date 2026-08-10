import os
import logging
from .client import BaseLLMClient, EmptyCompletionError

logger = logging.getLogger(__name__)


class GeminiClient(BaseLLMClient):
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY", "")
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
        self.max_tokens = int(os.getenv("OPENAI_MAX_TOKENS", "1024"))
        self.temperature = float(os.getenv("OPENAI_TEMPERATURE", "0.7"))

        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not configured")

    async def complete(self, prompt: str, stage: str = "", system: str = "") -> str:
        try:
            from google import genai
            from google.genai import types as genai_types

            client = genai.Client(api_key=self.api_key)
            # Gemini has no `system` message role; `system_instruction` is the
            # equivalent channel, and it is what keeps the operator rules out
            # of `contents` alongside the parent's text.
            config = genai_types.GenerateContentConfig(
                max_output_tokens=self.max_tokens,
                temperature=self.temperature,
                system_instruction=system if system and system.strip() else None,
            )
            response = client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=config,
            )
            content = response.text or ""
            if not content.strip():
                raise EmptyCompletionError(
                    f"{self.model} returned no content for stage={stage or '?'}"
                )
            return content

        except Exception as e:
            logger.error(f"Gemini API error stage={stage}: {e}")
            raise
