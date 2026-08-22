import os
import json
import logging
import time
import httpx
from .client import BaseLLMClient, EmptyCompletionError, build_messages

logger = logging.getLogger(__name__)

# The proxy's reasoning models (e.g. opencode) spend tokens on chain-of-thought
# before producing content. A 1024 budget leaves no room for the actual story
# (empty content -> truncated JSON -> fallback). 4096 fits reasoning + ~150
# Vietnamese words.
#
# The retired deepseek-v4 free backend once exhausted both 4096 and 8192 even
# with `reasoning_effort: none`. The current HA profile pins nemotron with
# thinking disabled; measured planner/writer replies use about 600 output
# tokens each, so the conservative 4096 ceiling has ample room without leaving
# an unnecessarily large allowance.
DEFAULT_MAX_TOKENS = 4096

# Reasoning models can take several minutes per call (the writer stage emits a
# full story after chain-of-thought); keep a generous httpx timeout so the
# planner/writer stages don't abort mid-generation.
DEFAULT_TIMEOUT_SECONDS = 300

# How long a *stream* may go silent before we give up on it. This is the point
# of streaming here, and it is not about speed: streamed and buffered runs of
# the same writer prompt averaged 33.2s and 35.3s, which is the same number.
# What changes is what silence means. Buffered, the connection says nothing at
# all until the answer is complete -- measured gaps of 26.4s, 39.1s and 40.3s
# -- so the only safe timeout is one sized for the slowest possible generation,
# and a provider that has genuinely died still costs the full 300s before the
# router can fall back. Streamed, the largest gap between chunks on those same
# runs was 1.1-1.7s, because `reasoning_content` deltas arrive while the model
# is still only thinking. 60s is roughly 35x the observed worst gap, so it
# fires on a dead stream and never on a slow one.
DEFAULT_STREAM_IDLE_SECONDS = 60


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


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


class StreamFrame:
    """One decoded `data:` frame of a chat-completion stream.

    Frames are not uniform, and assuming they are is how a stream reader
    breaks. Measured against 9router serving `oc/deepseek-v4-flash-free`:

      - the opening frame carries `delta.role` with `"content": null` --
        `null`, not absent, so `.get("content", "")` still yields None;
      - middle frames carry `delta.content` *or* `delta.reasoning_content`,
        the latter while the model is only thinking;
      - the closing frame is `{"choices": [], "cost": "0", ...}` with an empty
        choices list, so `choices[0]` raises IndexError;
      - a proxy that ignores `stream: true` answers with one whole
        `chat.completion` object instead, i.e. `message.content`, not a delta.
    """

    __slots__ = ("content", "reasoning", "finish_reason", "usage")

    def __init__(self, parsed: dict):
        choices = parsed.get("choices") or []
        choice = choices[0] if choices else {}
        delta = choice.get("delta") or {}
        message = choice.get("message") or {}
        # `or ""` rather than a default: the value is explicitly null on some
        # frames, and None would break the concatenation below.
        self.content = delta.get("content") or message.get("content") or ""
        self.reasoning = delta.get("reasoning_content") or delta.get("reasoning") or ""
        self.finish_reason = choice.get("finish_reason")
        self.usage = parsed.get("usage")


def iter_stream_frames(lines):
    """Decode the `data:` lines of an SSE stream into StreamFrames.

    Skips blank separator lines, stops at the `[DONE]` sentinel, and ignores
    frames that do not decode -- a truncated final frame should not discard
    the content that already arrived.
    """
    for line in lines:
        line = line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if not payload:
            continue
        if payload == "[DONE]":
            return
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            yield StreamFrame(parsed)


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
        # Some `oc/` free models spend the token budget on reasoning before
        # content. Pin a model known to work and disable reasoning in the
        # deployment profile; otherwise an undersized budget can return empty
        # content with finish_reason="length".
        self.model = os.getenv("CUSTOM_LLM_MODEL", "ag/gemini-3-flash-agent")

        # Ask for a stream by default. It costs nothing when the proxy does not
        # support it -- an ignored `stream: true` comes back as an ordinary
        # single-object body, which _read_stream still parses -- and it buys an
        # inactivity timeout on the providers that do. See
        # DEFAULT_STREAM_IDLE_SECONDS.
        self.stream = _bool_env("CUSTOM_LLM_STREAM", True)
        self.stream_idle = _int_env(
            "CUSTOM_LLM_STREAM_IDLE_SECONDS", "", DEFAULT_STREAM_IDLE_SECONDS
        )

        if not self.api_url:
            raise ValueError("CUSTOM_LLM_URL not configured")

    def _payload(self, prompt: str, system: str = "") -> dict:
        payload = {
            "model": self.model,
            "messages": build_messages(prompt, system),
            "max_tokens": _int_env("CUSTOM_LLM_MAX_TOKENS", "OPENAI_MAX_TOKENS", DEFAULT_MAX_TOKENS),
            "temperature": _float_env("CUSTOM_LLM_TEMPERATURE", "OPENAI_TEMPERATURE", 0.7),
        }
        # Measured on the 9router HA stack (scripts/probe-stream-thinking.py,
        # 2026-08-05): the `oc/*-free` backends answer COMPLETE stories faster
        # with thinking off (deepseek 10.3s vs 11.8s, nemotron 400 -> 200), and
        # the reasoning channel is never used by the Engine anyway. Proxies
        # that do not understand the param ignore it.
        thinking = os.getenv("CUSTOM_LLM_THINKING", "disabled").strip().lower()
        if thinking in {"enabled", "disabled"}:
            payload["thinking"] = {"type": thinking}

        # OpenAI-style reasoning models do not necessarily understand the
        # Anthropic-style `thinking` object above. 9router's OpenCode path is
        # one of them: `thinking: disabled` was ignored and a planner spent
        # 135s/33k characters reasoning, while the same request with
        # `reasoning_effort: none` completed in 7.7s. Keep this opt-in so a
        # stricter OpenAI-compatible proxy that rejects unknown fields is not
        # broken; the 9router HA deployment enables it explicitly.
        reasoning_effort = os.getenv("CUSTOM_LLM_REASONING_EFFORT", "").strip().lower()
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort
        return payload

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def complete(self, prompt: str, stage: str = "", system: str = "") -> str:
        if self.stream:
            content, detail = await self._complete_streaming(prompt, stage, system)
        else:
            content, detail = await self._complete_buffered(prompt, system)

        if not content.strip():
            raise EmptyCompletionError(
                f"{self.model} returned no content for stage={stage or '?'} ({detail})"
            )
        return content

    async def _complete_streaming(self, prompt: str, stage: str, system: str = "") -> tuple[str, str]:
        payload = dict(self._payload(prompt, system), stream=True)
        # `read` is per-chunk in streaming mode, so it is an inactivity timeout
        # rather than a deadline for the whole generation -- which is exactly
        # the distinction a buffered request cannot make.
        timeout = httpx.Timeout(
            connect=15.0, read=float(self.stream_idle), write=30.0, pool=15.0
        )

        chunks: list[str] = []
        reasoning_chars = 0
        frames = 0
        finish_reason = None
        usage = None
        raw: list[str] = []
        started = time.monotonic()
        first_content_at = None

        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST", self.api_url, json=payload, headers=self._headers()
            ) as response:
                if response.status_code >= 400:
                    # The body has not been read yet in streaming mode, and
                    # raise_for_status alone would report the status without
                    # the proxy's explanation of it.
                    await response.aread()
                    response.raise_for_status()

                async for line in response.aiter_lines():
                    raw.append(line)
                    # A stream that dribbles a byte forever never trips the
                    # idle timeout, so keep an absolute ceiling as well.
                    if time.monotonic() - started > DEFAULT_TIMEOUT_SECONDS:
                        logger.warning(
                            "Stream for stage=%s exceeded %ds; using what arrived",
                            stage or "?", DEFAULT_TIMEOUT_SECONDS,
                        )
                        break
                    for frame in iter_stream_frames([line]):
                        frames += 1
                        if frame.content:
                            if first_content_at is None:
                                first_content_at = time.monotonic() - started
                            chunks.append(frame.content)
                        reasoning_chars += len(frame.reasoning)
                        if frame.finish_reason:
                            finish_reason = frame.finish_reason
                        if frame.usage:
                            usage = frame.usage

        content = "".join(chunks)
        if not content and frames == 0:
            # The proxy ignored `stream: true` and answered with a plain body.
            # Not an error -- parse it the way a buffered reply is parsed.
            content = parse_sse_response("\n".join(raw))

        if content:
            logger.info(
                "Stream stage=%s: %d frames, %d reasoning chars, first content at %s, "
                "finish_reason=%s",
                stage or "?", frames, reasoning_chars,
                f"{first_content_at:.1f}s" if first_content_at is not None else "never",
                finish_reason,
            )

        detail = (
            f"streamed {frames} frames, {reasoning_chars} reasoning chars, "
            f"finish_reason={finish_reason}"
        )
        if finish_reason == "length" and not content:
            # The failure mode this codebase has already paid for once: the
            # whole token budget spent on chain-of-thought, nothing emitted.
            # Name it, so the next reader does not go looking for a network bug.
            detail += (
                f" -- the token budget was spent on reasoning before any content "
                f"was emitted; raise CUSTOM_LLM_MAX_TOKENS (currently "
                f"{payload['max_tokens']})"
            )
        if usage:
            detail += f", usage={usage}"
        return content, detail

    async def _complete_buffered(self, prompt: str, system: str = "") -> tuple[str, str]:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = await client.post(
                self.api_url, json=self._payload(prompt, system), headers=self._headers()
            )
            response.raise_for_status()

        return (
            parse_sse_response(response.text),
            f"HTTP {response.status_code}, {len(response.text)} bytes",
        )
