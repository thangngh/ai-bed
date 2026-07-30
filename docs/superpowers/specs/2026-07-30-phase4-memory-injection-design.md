# Phase 4 Spec — Memory Context Injection into Prompt

> **Date:** 2026-07-30
> **Status:** Draft
> **Scope:** Engine-only: parse memories JSON → natural-language summary → inject into user prompt

---

## 1. Overview

Phase 4 giải quyết: BE đã gửi memories array sang Engine, nhưng Engine dump raw JSON vào prompt (`{memories}`) → LLM đọc khó, không tận dụng được.

**Fix:** Parse memories JSON, build natural-language summary, inject vào user/default.txt.

**Scope giới hạn:**
- Engine-only changes (2 files)
- Không BE change
- Không FE change
- Không entity/schema change

---

## 2. Architecture

```
BE → Engine POST /generate
  └─ memories: [{type:"interest", key:"theme", value:"khủng long", confidence:0.9}, ...]
                      ↓
Engine orchestrator.py — pass memories vào data dict (đã có sẵn)
                      ↓
PromptRegistry.assemble() — gọi build_memory_context()
                      ↓
build_memory_context(memories):
  - Parse array, group by type
  - Sort by confidence (desc)
  - Build natural language lines
  - Return formatted string
                      ↓
user/default.txt nhận {memoryContext}
  "Known interests: khủng long, công chúa
   Favorite characters: Gấu Pooh
   Recently enjoyed: Động vật, Phiêu lưu"
                      ↓
LLM thấy context sạch → câu chuyện cá nhân hóa hơn
```

## 3. Engine Changes

### 3.1 `Engine/core/prompts/registry.py` — New method

```python
def build_memory_context(self, memories: list[dict] | str) -> str:
    # Handle both raw list and JSON string (orchestrator passes json.dumps)
    if isinstance(memories, str):
        try:
            memories = json.loads(memories) if memories else []
        except json.JSONDecodeError:
            memories = []
    if not memories:
        return ""

    # Group by type
    by_type: dict[str, list[dict]] = {}
    for m in memories:
        t = m.get("type", "other")
        by_type.setdefault(t, []).append(m)

    lines = []

    # Interests — top 5 by confidence
    interests = sorted(by_type.get("interest", []), key=lambda m: m.get("confidence", 0), reverse=True)[:5]
    if interests:
        values = [m["value"] for m in interests if m.get("value")]
        if values:
            lines.append(f"Known interests: {', '.join(values)}")

    # Recent themes — last 3
    themes = by_type.get("recent_theme", [])[-3:]
    if themes:
        values = [m["value"] for m in themes if m.get("value")]
        if values:
            lines.append(f"Recently enjoyed themes: {', '.join(values)}")

    # Preferences (characters, etc.)
    prefs = sorted(by_type.get("preference", []), key=lambda m: m.get("confidence", 0), reverse=True)[:3]
    if prefs:
        values = [m["value"] for m in prefs if m.get("value")]
        if values:
            lines.append(f"Character preferences: {', '.join(values)}")

    # Behavior notes
    behaviors = by_type.get("behavior", [])[-2:]
    if behaviors:
        for b in behaviors:
            if b.get("value"):
                lines.append(f"Behavior note: {b['value']}")

    return "\n".join(lines) if lines else ""
```

### 3.2 `Engine/core/prompts/registry.py` — Updated assemble()

```python
def assemble(self, age: int, data: dict) -> dict[str, str]:
    user_template = self.load_user()

    # Build memory context from memories (string from orchestrator or raw list)
    memories_raw = data.get("memories", [])
    memory_context = self.build_memory_context(memories_raw)
    data["memoryContext"] = memory_context

    user_prompt = user_template.format(**data)
    return {
        "system": self.load_system(),
        "developer": self.load_developer(age, data),
        "user": user_prompt,
    }
```

### 3.3 `Engine/core/prompts/templates/user/default.txt`

**Current:**
```
- Memory context: {memories}
```

**New:**
```
Memory context:
{memoryContext}
```

## 4. Testing

```python
# Engine/tests/test_prompt_registry.py — add

def test_build_memory_context_empty(registry):
    assert registry.build_memory_context([]) == ""

def test_build_memory_context_interests(registry):
    memories = [
        {"type": "interest", "key": "theme", "value": "khủng long", "confidence": 0.9},
        {"type": "interest", "key": "theme", "value": "công chúa", "confidence": 0.7},
    ]
    result = registry.build_memory_context(memories)
    assert "khủng long" in result
    assert "công chúa" in result

def test_build_memory_context_all_types(registry):
    memories = [
        {"type": "interest", "value": "khủng long", "confidence": 0.9},
        {"type": "recent_theme", "value": "Động vật"},
        {"type": "preference", "value": "Gấu Pooh", "confidence": 0.8},
        {"type": "behavior", "value": "Thích câu chuyện có tương tác"},
    ]
    result = registry.build_memory_context(memories)
    assert "khủng long" in result
    assert "Gấu Pooh" in result

def test_assembled_prompt_contains_memory_context(registry):
    prompts = registry.assemble(4, {
        "childName": "An", "age": "4", "theme": "Động vật",
        "goal": "", "mood": "vui vẻ", "memories": [
            {"type": "interest", "value": "khủng long", "confidence": 0.9}
        ],
        "gender": "unspecified", "favoriteCharacter": "",
    })
    assert "khủng long" in prompts["user"]
```

## 5. Files Changed Summary

| File | Change |
|------|--------|
| `Engine/core/prompts/registry.py` | Add `build_memory_context()`, update `assemble()` |
| `Engine/core/prompts/templates/user/default.txt` | Replace `{memories}` with `{memoryContext}` |
| `Engine/tests/test_prompt_registry.py` | Add 4 test cases |

**Total: 3 files, ~50 lines new code**

## 6. Success Criteria

- [ ] Memory context appears in assembled prompt as natural language (not raw JSON)
- [ ] Empty memories → empty string (no crash)
- [ ] All memory types (interest, recent_theme, preference, behavior) are formatted correctly
- [ ] Existing prompt assembly still works for all age groups
