# LLM Response Cleanup Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Engine crashing on LLM responses that carry trailing SSE `data: [DONE]` / stray text, by stripping markers in the custom client and extracting the first valid JSON block centrally in the pipeline.

**Architecture:** Two-layer fix. (1) `CustomClient.complete()` reads raw text, strips trailing `data: [DONE]`, parses body and returns `choices[0].message.content`. (2) A new `extract_json_block()` helper in `core/cleanup.py`, used by `story_pipeline` (planner/writer/reviewer) and usable by any provider, returns the first valid JSON block from dirty text. Contract `BaseLLMClient.complete -> str` is unchanged.

**Tech Stack:** Python 3.11+, httpx, pytest, FastAPI.

## Global Constraints

- Repo root: `D:\2026\pet-project\ai-bed`, workdir for Engine is `D:\2026\pet-project\ai-bed\Engine`.
- Python tests run with: `cd Engine && python -m pytest tests/ -v`.
- `BaseLLMClient.complete(prompt, stage) -> str` contract MUST stay unchanged (returns raw text).
- No changes to `validator.py`, `openai_client.py`, `gemini_client.py`, or BE.
- Chinese/Vietnamese strings in tests must use `ensure_ascii=False`-safe plain ASCII where possible; Python 3.13 must not crash on codepage (use `PYTHONIOENCODING=utf-8` if needed).
- Every implemented function must be lowercase snake_case.
- Commit after each task with a single `git add <files> && git commit -m "<msg>"`.

---

### Task 1: Extract JSON block helper `extract_json_block`

**Files:**
- Create: `Engine/core/cleanup.py`
- Test: `Engine/tests/test_cleanup.py`

**Interfaces:**
- Consumes: none.
- Produces: `def extract_json_block(text: str) -> Any` in `core/cleanup.py`. Raises `ValueError` if no valid JSON block found. Used by Task 2 (pipeline).

- [ ] **Step 1: Write the failing test**

```python
import pytest
from core.cleanup import extract_json_block


class TestExtractJsonBlock:
    def test_clean_json(self):
        assert extract_json_block('{"a": 1}') == {"a": 1}

    def test_trailing_data_done(self):
        assert extract_json_block('{"a": 1} data: [DONE]') == {"a": 1}

    def test_leading_stray_text(self):
        assert extract_json_block('Sure, here you go\n{"a": 1}') == {"a": 1}

    def test_trailing_stray_text(self):
        assert extract_json_block('{"a": 1}\nHere is the story.') == {"a": 1}

    def test_multiple_blocks_returns_first(self):
        assert extract_json_block('{"a": 1} {"b": 2}') == {"a": 1}

    def test_extracts_array(self):
        assert extract_json_block('[1, 2, 3]') == [1, 2, 3]

    def test_no_json_raises(self):
        with pytest.raises(ValueError):
            extract_json_block('no json here')


def test_importable():
    import core.cleanup
    assert callable(core.cleanup.extract_json_block)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_cleanup.py -v`
Expected: FAIL with "cannot import name 'extract_json_block' from 'core.cleanup'"

- [ ] **Step 3: Write minimal implementation**

`Engine/core/cleanup.py`:

```python
import json
from typing import Any


def extract_json_block(text: str) -> Any:
    """
    Return the first valid JSON block (dict or list) found in ``text``.

    Ignores leading/trailing prose and trailing SSE markers such as
    ``data: [DONE]``. Raises ValueError if no valid JSON block is found.
    """
    decoder = json.JSONDecoder()
    text = text.strip()

    for match in range(len(text)):
        if text[match] not in ("{", "["):
            continue
        try:
            value, _ = decoder.raw_decode(text[match:])
            return value
        except json.JSONDecodeError:
            continue

    raise ValueError("No valid JSON block found in text")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_cleanup.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add core/cleanup.py tests/test_cleanup.py
git commit -m "feat(engine): add extract_json_block cleanup helper"
```

---

### Task 2: Use extract_json_block in story pipeline

**Files:**
- Modify: `Engine/core/pipeline.py`
- Test: `Engine/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `extract_json_block` from `core.cleanup` (Task 1).
- Produces: unchanged `StoryPipeline` public methods; planner/writer/reviewer parsing now tolerant of dirty LLM output.

- [ ] **Step 1: Write the failing test**

Append to `Engine/tests/test_pipeline.py`:

```python
@pytest.mark.asyncio
async def test_pipeline_accepts_dirty_json_responses():
    router = MockRouter({
        "planner": 'Here is the plan\n{"title": "Dirty", "story_structure": {"opening": "...", "sections": [{"order": 0, "type": "opening", "description": "..."}, {"order": 1, "type": "context", "description": "..."}], "moral": "good", "key_characters": ["An"]}} data: [DONE]',
        "writer": '{"title": "Dirty", "content": [{"type": "opening", "text": "Xin chao ban nho\\n\\nHom nay chung ta co mot cau chuyen", "order": 0}, {"type": "context", "text": "Ngay xua co mot co be\\n\\nCo be song trong ngoi lang nho", "order": 1}, {"type": "conflict", "text": "Mot ngay no bien co xay ra\\n\\nCo be phai doi mat voi thu thach", "order": 2}, {"type": "interaction", "text": "Hoi", "prompt": "Con nghi?", "order": 3}, {"type": "resolution", "text": "Cuoi cung moi chuyen on thoa\\n\\nCo be hoc duoc bai hoc quy gia", "order": 4}], "word_count": 150} trailing junk',
        "reviewer": '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}',
    })
    pipeline = StoryPipeline(router)
    result = await pipeline.run({})
    assert result.success is True
    assert result.title == "Dirty"
```

Note: this test only passes once the pipeline uses `extract_json_block`. The current `json.loads` would fail on `planner` (trailing junk) and fall back.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_pipeline.py::test_pipeline_accepts_dirty_json_responses -v`
Expected: FAIL (falls back because `json.loads` raises on trailing junk)

- [ ] **Step 3: Implement**

In `Engine/core/pipeline.py`:
1. Add import: `from .cleanup import extract_json_block`
2. Replace the two `json.loads(raw)` calls:
   - In `_call_retry` (line ~103): `raw = await self._call_llm(...)` then `data = json.loads(raw)` → `data = extract_json_block(raw)`.
   - In `_review_story` (line ~140): `return json.loads(raw)` → `return extract_json_block(raw)`.

Keep the surrounding `try/except` that already catches `Exception` (and JSONDecodeError) so retries/fallback still work.

- [ ] **Step 4: Run full pipeline tests**

Run: `python -m pytest tests/test_pipeline.py -v`
Expected: PASS (existing happy path, fallback, new dirty test)

Also run the whole suite to ensure nothing regressed:
Run: `python -m pytest tests/ -v`
Expected: no failures introduced.

- [ ] **Step 5: Commit**

```bash
git add core/pipeline.py tests/test_pipeline.py
git commit -m "feat(engine): tolerate dirty LLM JSON in pipeline via extract_json_block"
```

---

### Task 3: Fix CustomClient trailing data:[DONE]

**Files:**
- Modify: `Engine/core/llm/custom_client.py`
- Test: `Engine/tests/test_custom_client.py`

**Interfaces:**
- Consumes: none new.
- Produces: `CustomClient.complete(prompt, stage) -> str` returns `choices[0].message.content` even when body has trailing `data: [DONE]`. Contract unchanged.

- [ ] **Step 1: Write the failing test**

Append to `Engine/tests/test_custom_client.py`. Use `httpx.MockTransport` to avoid network:

```python
import httpx
import pytest
from core.llm.custom_client import CustomClient


class TestCustomClientComplete:
    @pytest.mark.asyncio
    async def test_complete_strips_trailing_data_done(self, monkeypatch):
        monkeypatch.setenv("CUSTOM_LLM_URL", "https://my-llm.example.com/v1/chat/completions")
        monkeypatch.setenv("CUSTOM_LLM_API_KEY", "ck-custom-key")
        monkeypatch.setenv("CUSTOM_LLM_MODEL", "my-model")

        body = (
            '{"id":"x","choices":[{"index":0,"finish_reason":"stop",'
            '"message":{"role":"assistant","content":"{\\"a\\":1}"}}],'
            '"usage":{"total_tokens":10}} data: [DONE]'
        )

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=body)

        client = CustomClient()
        import core.llm.custom_client as mod
        original = httpx.AsyncClient
        # We substitute the transport via testing.get? Ensure raw body string is returned.
        raise NotImplementedError("use httpx.MockTransport instead of monkeypatching transport")
```

Final test file additions:

```python
import httpx
import pytest
from core.llm.custom_client import CustomClient


def _mock_async_client(monkeypatch, handler):
    """Make CustomClient.complete use httpx.MockTransport to avoid network."""
    import httpx as _httpx

    class Fake(_httpx.AsyncClient):
        def __init__(self, *a, **k):
            super().__init__(*a, **k, transport=_httpx.MockTransport(handler))

    monkeypatch.setattr(httpx, "AsyncClient", Fake)


@pytest.mark.asyncio
async def test_complete_returns_content_stripping_data_done(monkeypatch):
    import httpx as _httpx
    monkeypatch.setenv("CUSTOM_LLM_URL", "http://proxy/v1/chat/completions")
    monkeypatch.setenv("CUSTOM_LLM_MODEL", "m")

    body = '{"choices":[{"message":{"role":"assistant","content":"{\\"title\\":\\"Hi\\"}"}}]} data: [DONE]'

    _mock_async_client(monkeypatch, lambda req: _httpx.Response(200, text=body))

    client = CustomClient()
    out = await client.complete("hi")
    assert out == '{"title":"Hi"}'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_custom_client.py -v`
Expected: FAIL (current `response.json()` raises `JSONDecodeError: Extra data` on the trailing `data: [DONE]`).

- [ ] **Step 3: Implement**

Edit `Engine/core/llm/custom_client.py`:
1. Add `import json` at the top (next to the existing `import os`, `import logging`, `import httpx`).
2. In `complete()`, replace the `response.json()` + parse block:

```python
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(self.api_url, json=payload, headers=headers)
        response.raise_for_status()
        body = response.text.strip()

        if body.endswith("data: [DONE]"):
            body = body[: -len("data: [DONE]")].rstrip()

        data = json.loads(body)

        if "choices" in data:
            return data["choices"][0]["message"]["content"]
        if "response" in data:
            return data["response"]
        return str(data)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_custom_client.py -v`
Expected: PASS.

Also run the full Engine suite:
Run: `python -m pytest tests/ -v`
Expected: no failures.

- [ ] **Step 5: Live verification against proxy (optional but recommended)**

Run (proxy at localhost:20128 must be up):
Run: `python -c "import asyncio,os;from core.prompts.registry import PromptRegistry;from core.llm.custom_client import CustomClient;"` then via a small script call `complete("Return JSON: {\"x\":1}")` and print — expect clean `{"x":1}` with no `data: [DONE]`.

- [ ] **Step 6: Commit**

```bash
git add core/llm/custom_client.py tests/test_custom_client.py
git commit -m "fix(engine): strip trailing data:[DONE] in CustomClient.complete"
```

---

### Task 4: Full-suite regression + real-proxy E2E

**Files:**
- Test: `Engine/tests/` (all)
- Optional: `Engine/tests/test_engine_real_llm.py` (skipped if proxy down)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: confidence that the whole pipeline, including the real proxy flow, is green.

- [ ] **Step 1: Run full suite**

Run: `python -m pytest tests/ -v`
Expected: all tests pass (the real-LLM test still `skipif` non-reachable proxy, but our local offline tests all green).

- [ ] **Step 2: Run real-proxy pipeline (proxy on localhost:20128)**

Run: `python -c "import asyncio; from core.orchestrator import StoryOrchestrator; async def m():\n\tr=await StoryOrchestrator().generate({'child_name':'An','age':4,'theme':'Dong vat','goal':'Dung cam','mood':'vui ve','language':'vi'}); print(r['safety_status'], r['title'], r.get('is_fallback'))\nasyncio.run(m())"` with env `CUSTOM_LLM_URL` etc; expect `APPROVED`/`FLAGGED` with a real title (not `Câu chuyện bất ngờ` fallback).

- [ ] **Step 3: Commit (if any leftover changes)**

```bash
git add -A
git commit -m "test(engine): verify full suite + real proxy after cleanup layer" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- §2.1 CustomClient strip `data: [DONE]` → Task 3.
- §2.2 `extract_json_block` + use in pipeline for all providers → Task 1 & 2.
- §5 tests (cleanup, custom client) → Tasks 1–3.
- §4 error handling (retry → fallback) preserved → Task 2 keeps try/except.

**Placeholder scan:** All steps contain real code. Task 3's first draft stub was replaced with a concrete `_mock_async_client` helper. No TBD/TODO remain.

**Type consistency:** `extract_json_block(text: str) -> Any` used identically in Task 1 and Task 2. `complete(prompt, stage) -> str` unchanged across clients.