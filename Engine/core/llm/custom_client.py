import os
import json
import logging
import httpx
from .client import BaseLLMClient

logger = logging.getLogger(__name__)

# The proxy's reasoning models (e.g. opencode) spend tokens on chain-of-thought
# before producing content. A 1024 budget leaves no room for the actual story
# (empty content -> truncated JSON -> fallback). 4096 fits reasoning + ~150
# Vietnamese words.
DEFAULT_MAX_TOKENS = 4096

# Reasoning models can take several minutes per call (the writer stage emits a
# full story after chain-of-thought); keep a generous httpx timeout so the
# planner/writer stages don't abort mid-generation.
DEFAULT_TIMEOUT_SECONDS = 300


def parse_sse_response(body: str) -> str:
    """Extract assistant content from a proxy response body.

    The local proxy returns `text/event-stream` (SSE) even for plain
    POST /v1/chat/completions: either one `data: {...}` event per line, or a
    single JSON `chat.completion` object immediately followed by
    `data: [DONE]`. Fall back to parsing the body as plain JSON when no SSE
    data frames are present.
    """
    if not body:
        return ""

    # 1. Try SSE frames: lines starting with "data: ".
    frames = [
        line[len("data: "):].strip()
        for line in body.splitlines()
        if line.startswith("data: ") and line.strip() != "data: [DONE]"
    ]
    if frames:
        # SSE can be one complete JSON per frame or split across frames;
        # the last non-DONE frame is the assembled chunk in the proxy's case.
        for frame in reversed(frames):
            try:
                parsed = json.loads(frame)
                content = parsed["choices"][0]["message"]["content"]
                if content:
                    return content
            except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                continue

    # 2. Plain JSON body, possibly followed by trailing SSE markers such as
    #    "data: [DONE]" (the proxy emits one JSON object then "data: [DONE]").
    #    Scan for the first balanced JSON object and parse just that.
    depth = 0
    start = -1
    in_string = False
    escape = False
    for i, ch in enumerate(body):
        if escape:
            escape = False
            continue
        if in_string:
            if ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                obj = body[start:i + 1]
                try:
                    parsed = json.loads(obj)
                    return parsed["choices"][0]["message"]["content"]
                except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                    return body

    try:
        parsed = json.loads(body)
        return parsed["choices"][0]["message"]["content"]
    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
        return body


class CustomClient(BaseLLMClient):
    def __init__(self):
        self.api_url = os.getenv("CUSTOM_LLM_URL", "http://localhost:20128")
        self.api_key = os.getenv("CUSTOM_LLM_API_KEY", "")
        self.model = os.getenv("CUSTOM_LLM_MODEL", "opencode")

        if not self.api_url:
            raise ValueError("CUSTOM_LLM_URL not configured")

    async def complete(self, prompt: str, stage: str = "") -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": int(os.getenv("OPENAI_MAX_TOKENS", str(DEFAULT_MAX_TOKENS))),
            "temperature": float(os.getenv("OPENAI_TEMPERATURE", "0.7")),
        }

        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = await client.post(self.api_url, json=payload, headers=headers)
            response.raise_for_status()
            return parse_sse_response(response.text)
