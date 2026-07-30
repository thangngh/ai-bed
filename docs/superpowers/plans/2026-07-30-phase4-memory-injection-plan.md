# Phase 4 — Memory Context Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse raw memories JSON in Engine, build natural-language summary, inject into user prompt instead of raw JSON dump.

**Architecture:** Engine-only: `PromptRegistry.assemble()` parses `data["memories"]` (JSON string), builds `memoryContext` via new `build_memory_context()`, formats template with `{memoryContext}` instead of `{memories}`. No BE/FE changes.

**Tech Stack:** Python 3.11+, PromptRegistry (existing)

**File structure:**

| File | Responsibility |
|------|---------------|
| `Engine/core/prompts/registry.py` | New `build_memory_context()` method, updated `assemble()` |
| `Engine/core/prompts/templates/user/default.txt` | Replace `{memories}` → `{memoryContext}` |
| `Engine/tests/test_prompt_registry.py` | 4 new test cases |

## Global Constraints

- `data["memories"]` arrives as JSON string from orchestrator (`json.dumps()`)
- `build_memory_context()` must handle: empty list, single type, mixed types, invalid JSON
- `assemble()` output must not contain raw JSON in user prompt
- Existing test `test_assembly` must still pass after change
- No changes to orchestrator.py or any BE code

---

### Task 1: Test — build_memory_context edge cases

**Files:**
- Modify: `Engine/tests/test_prompt_registry.py`
- Add 4 test methods to existing `TestPromptRegistry` class

**Interfaces:**
- Consumes: `PromptRegistry.build_memory_context(memories: list | str) -> str`
- Produces: Verified behavior for empty, single-type, mixed-type, and string input

- [ ] **Step 1: Write failing tests**

Add inside `TestPromptRegistry` class:

```python
def test_build_memory_context_empty(self):
    registry = PromptRegistry()
    assert registry.build_memory_context([]) == ""
    assert registry.build_memory_context("[]") == ""

def test_build_memory_context_interests(self):
    registry = PromptRegistry()
    memories = [
        {"type": "interest", "value": "khủng long", "confidence": 0.9},
        {"type": "interest", "value": "công chúa", "confidence": 0.7},
    ]
    result = registry.build_memory_context(memories)
    assert "khủng long" in result
    assert "công chúa" in result

def test_build_memory_context_all_types(self):
    registry = PromptRegistry()
    memories = [
        {"type": "interest", "value": "khủng long", "confidence": 0.9},
        {"type": "recent_theme", "value": "Động vật"},
        {"type": "preference", "value": "Gấu Pooh", "confidence": 0.8},
        {"type": "behavior", "value": "Thích câu chuyện có tương tác"},
    ]
    result = registry.build_memory_context(memories)
    assert "khủng long" in result
    assert "Gấu Pooh" in result

def test_build_memory_context_from_json_string(self):
    registry = PromptRegistry()
    json_str = '[{"type": "interest", "value": "rồng", "confidence": 0.8}]'
    result = registry.build_memory_context(json_str)
    assert "rồng" in result
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Engine && python -m pytest tests/test_prompt_registry.py::TestPromptRegistry::test_build_memory_context_empty tests/test_prompt_registry.py::TestPromptRegistry::test_build_memory_context_interests tests/test_prompt_registry.py::TestPromptRegistry::test_build_memory_context_all_types tests/test_prompt_registry.py::TestPromptRegistry::test_build_memory_context_from_json_string -v`

Expected: FAIL with `AttributeError: 'PromptRegistry' object has no attribute 'build_memory_context'`

- [ ] **Step 3: Implement build_memory_context**

In `Engine/core/prompts/registry.py`, add after `load_user()`:

```python
def build_memory_context(self, memories: list | str) -> str:
    if isinstance(memories, str):
        try:
            memories = json.loads(memories) if memories else []
        except json.JSONDecodeError:
            memories = []
    if not memories:
        return ""

    by_type: dict[str, list[dict]] = {}
    for m in memories:
        t = m.get("type", "other")
        by_type.setdefault(t, []).append(m)

    lines = []

    interests = sorted(by_type.get("interest", []), key=lambda m: m.get("confidence", 0), reverse=True)[:5]
    if interests:
        values = [m["value"] for m in interests if m.get("value")]
        if values:
            lines.append(f"Known interests: {', '.join(values)}")

    themes = by_type.get("recent_theme", [])[-3:]
    if themes:
        values = [m["value"] for m in themes if m.get("value")]
        if values:
            lines.append(f"Recently enjoyed: {', '.join(values)}")

    prefs = sorted(by_type.get("preference", []), key=lambda m: m.get("confidence", 0), reverse=True)[:3]
    if prefs:
        values = [m["value"] for m in prefs if m.get("value")]
        if values:
            lines.append(f"Character preferences: {', '.join(values)}")

    behaviors = by_type.get("behavior", [])[-2:]
    for b in behaviors:
        if b.get("value"):
            lines.append(f"Behavior note: {b['value']}")

    return "\n".join(lines) if lines else ""
```

Also add the `import json` at the top of `registry.py` (if not already present):

```python
import json
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Engine && python -m pytest tests/test_prompt_registry.py::TestPromptRegistry::test_build_memory_context_empty tests/test_prompt_registry.py::TestPromptRegistry::test_build_memory_context_interests tests/test_prompt_registry.py::TestPromptRegistry::test_build_memory_context_all_types tests/test_prompt_registry.py::TestPromptRegistry::test_build_memory_context_from_json_string -v`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add Engine/core/prompts/registry.py Engine/tests/test_prompt_registry.py
git commit -m "feat: add build_memory_context to parse memories into natural language"
```

---

### Task 2: Wire memoryContext into prompt assembly

**Files:**
- Modify: `Engine/core/prompts/registry.py` — update `assemble()`
- Modify: `Engine/core/prompts/templates/user/default.txt` — update template
- Modify: `Engine/tests/test_prompt_registry.py` — add integration test

**Interfaces:**
- Consumes: `data["memories"]` JSON string from orchestrator
- Produces: `data["memoryContext"]` set before template formatting, template uses `{memoryContext}`

- [ ] **Step 1: Write failing integration test**

Add to `TestPromptRegistry`:

```python
def test_assembly_includes_memory_context(self):
    registry = PromptRegistry()
    prompts = registry.assemble(age=4, data={
        "childName": "An", "age": "4", "theme": "rồng",
        "goal": "", "mood": "vui vẻ",
        "memories": json.dumps([{"type": "interest", "value": "khủng long", "confidence": 0.9}]),
        "gender": "boy", "favoriteCharacter": "Khủng long Rex",
    })
    assert "khủng long" in prompts["user"]
    # Ensure no raw JSON array in output
    assert "[{" not in prompts["user"]
    assert '"type"' not in prompts["user"]
```

Add at top: `import json`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Engine && python -m pytest tests/test_prompt_registry.py::TestPromptRegistry::test_assembly_includes_memory_context -v`

Expected: FAIL — template still contains `{memories}`, not `{memoryContext}`

- [ ] **Step 3: Update user/default.txt**

Replace line 9:
```
- Memory context: {memories}
```
with:
```
Memory context:
{memoryContext}
```

- [ ] **Step 4: Update assemble() in registry.py**

Replace `data.setdefault(k, v)` loop section to inject memoryContext before formatting:

```python
def assemble(self, age: int, data: dict) -> dict[str, str]:
    user_template = self.load_user()
    defaults = {"gender": "unspecified", "favoriteCharacter": ""}
    for k, v in defaults.items():
        data.setdefault(k, v)

    memories_raw = data.get("memories", [])
    data["memoryContext"] = self.build_memory_context(memories_raw)

    user_prompt = user_template.format(**data)

    return {
        "system": self.load_system(),
        "developer": self.load_developer(age),
        "user": user_prompt,
    }
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd Engine && python -m pytest tests/test_prompt_registry.py -v`

Expected: ALL 7 tests PASS (3 old + 4 new)

- [ ] **Step 6: Commit**

```bash
git add Engine/core/prompts/registry.py Engine/core/prompts/templates/user/default.txt Engine/tests/test_prompt_registry.py
git commit -m "feat: wire memoryContext into prompt assembly, replace raw JSON in template"
```

---

### Task 3: Verify no regressions in pipeline

**Files:**
- Run: `Engine/tests/test_integration.py`
- Run: `Engine/tests/test_validator.py`

- [ ] **Step 1: Run full test suite**

Run: `cd Engine && python -m pytest tests/ -v`

Expected: ALL PASS (all existing tests + new memory context tests)

- [ ] **Step 2: Manual smoke test**

Run: `cd Engine && python -c "from core.prompts.registry import PromptRegistry; r = PromptRegistry(); p = r.assemble(4, {'childName':'An','age':'4','theme':'rồng','goal':'','mood':'vui vẻ','memories':'[]','gender':'boy','favoriteCharacter':''}); print(p['user'][:500])"`

Expected: Prints user prompt without raw JSON, with `Memory context:` line present (empty after colon since no memories)

- [ ] **Step 3: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: verify no regressions after memory context injection"
```
