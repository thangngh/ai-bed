import os
import json
import logging
import httpx
from .client import BaseLLMClient, EmptyCompletionError

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


def _env(preferred: str, legacy: str) -> str:
    """Read `preferred`, falling back to `legacy` then to the caller's default.

    The custom client used to read OPENAI_MAX_TOKENS / OPENAI_TEMPERATURE --
    another provider's settings. Deployments that set only the OPENAI_* names
    keep working, but CUSTOM_LLM_* now wins where present.
    """
    value = os.getenv(preferred, "").strip()
    if value:
        return value
    return os.getenv(legacy, "").strip()


def _int_env(preferred: str, legacy: str, default: int) -> int:
    raw = _env(preferred, legacy)
    try:
        return int(raw) if raw else default
    except ValueError:
        logger.warning("Invalid %s=%r, using %d", preferred, raw, default)
        return default


def _float_env(preferred: str, legacy: str, default: float) -> float:
    raw = _env(preferred, legacy)
    try:
        return float(raw) if raw else default
    except ValueError:
        logger.warning("Invalid %s=%r, using %s", preferred, raw, default)
        return default


def _content_from_payload(parsed: dict) -> str:
    """Pull assistant text out of a decoded completion object.

    Handles the OpenAI `choices[].message.content` shape, the streaming
    `choices[].delta.content` shape, and the bare `{"response": ...}` shape
    some proxies use.
    """
    choices = parsed.get("choices")
    if choices:
        choice = choices[0]
        message = choice.get("message") or choice.get("delta") or {}
        content = message.get("content")
        if content:
            return content
    response = parsed.get("response")
    if response:
        return response
    return ""


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
        # SSE can be one complete JSON per frame (the proxy assembles the
        # answer itself) or a stream of `delta` chunks that must be joined.
        decoded = []
        for frame in frames:
            try:
                decoded.append(json.loads(frame))
            except json.JSONDecodeError:
                continue

        # Prefer a frame that already carries the whole message.
        for parsed in reversed(decoded):
            choices = parsed.get("choices") or [{}]
            if (choices[0].get("message") or {}).get("content"):
                return choices[0]["message"]["content"]

        # Otherwise concatenate the streamed deltas in arrival order.
        streamed = "".join(_content_from_payload(parsed) for parsed in decoded)
        if streamed:
            return streamed

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
                except json.JSONDecodeError:
                    # Not JSON at all -- some proxies answer in plain text,
                    # which is legitimate content.
                    return body
                # Parsed fine but carries no content: return "" so the caller
                # raises. Returning `body` here is what leaked a 13KB raw SSE
                # envelope into a story.
                return _content_from_payload(parsed)

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return body
    return _content_from_payload(parsed)


class CustomClient(BaseLLMClient):
    def __init__(self):
        self.api_url = os.getenv("CUSTOM_LLM_URL", "")
        self.api_key = os.getenv("CUSTOM_LLM_API_KEY", "")
        # Pin a concrete backend, not the `opencode` combo: that combo
        # round-robins over heterogeneous models (measured 5.9s, 7.2s and
        # 40.7s on identical prompts, the slowest ignoring the Vietnamese-only
        # instruction), so one name gives unpredictable latency and quality.
        #
        # Not an `oc/` free model either. Those are reasoning models that spend
        # the entire token budget on `reasoning_content` and return
        # `content: ""` with `finish_reason: "length"` -- measured on all three
        # at both 4096 and 16000 max_tokens, never once producing a story.
        self.model = os.getenv("CUSTOM_LLM_MODEL", "ag/gemini-3-flash-agent")

        if not self.api_url:
            raise ValueError("CUSTOM_LLM_URL not configured")

    async def complete(self, prompt: str, stage: str = "") -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": _int_env("CUSTOM_LLM_MAX_TOKENS", "OPENAI_MAX_TOKENS", DEFAULT_MAX_TOKENS),
            "temperature": _float_env("CUSTOM_LLM_TEMPERATURE", "OPENAI_TEMPERATURE", 0.7),
        }

        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = await client.post(self.api_url, json=payload, headers=headers)
            response.raise_for_status()

        content = parse_sse_response(response.text)
        if not content.strip():
            raise EmptyCompletionError(
                f"{self.model} returned no content for stage={stage or '?'} "
                f"(HTTP {response.status_code}, {len(response.text)} bytes)"
            )
        return content
