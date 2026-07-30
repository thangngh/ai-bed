# Phase 4B Spec — Prompt Quality & Story Structure

> **Date:** 2026-07-30
> **Status:** Draft
> **Scope:** Nâng chất lượng prompt templates (developer, planner, writer, reviewer) + thêm quality gates (Vietnamese purity, section depth, Vietnamese blocklist)

---

## 1. Overview

Phase 4B giải quyết gap về chất lượng truyện: cốt truyện còn đơn giản, thiếu cấu trúc arc rõ ràng, interaction points chưa tự nhiên, reviewer còn sơ sài.

**Đã xong (từ Phase 4 — không làm lại):**
- `user/default.txt` — đã có `{memoryContext}` + `build_memory_context()`
- `registry.py:assemble()` — đã build 3-tier prompt
- Memory injection vào prompt

**4B sẽ làm:**
1. Enhance developer templates (3-4.txt, 5-6.txt) — 7-step story arc
2. Tách planner/writer/reviewer prompts thành template files
3. Thêm Vietnamese blocklist + purity + section depth checks vào validator
4. Cập nhật pipeline dùng template files
5. Cập nhật tests

---

## 2. Architecture Changes

```
Engine hiện tại:                    Engine mới:
─────────────────                   ────────────
prompts/templates/                   prompts/templates/
├── developer/3-4.txt                ├── developer/3-4.txt    [enhanced]
├── developer/5-6.txt                ├── developer/5-6.txt    [enhanced]
├── system/default.txt               ├── system/default.txt   [unchanged]
├── user/default.txt                 ├── user/default.txt     [unchanged]
                                     ├── planner/default.txt  [NEW]
                                     ├── writer/default.txt   [NEW]
                                     └── reviewer/default.txt [NEW]

pipeline.py                          pipeline.py
├── planner prompt (hardcoded)       ├── load planner template
├── writer prompt (hardcoded)        ├── load writer template
├── reviewer prompt (hardcoded)      ├── load reviewer template
├── _build_writer_prompt()           ├── _build_writer_prompt()   [simplified]
└── _review_story()                  └── _review_story()          [use template]

validator.py                         validator.py
├── BLOCKLIST_WORDS (12 EN)          ├── BLOCKLIST_WORDS (12 EN + 20 VI)
├── validate_planner()               ├── validate_planner()       [unchanged]
├── validate_writer()                ├── validate_writer()
├── validate_sections()              ├── validate_sections()
├── has_blocklist_word()             ├── has_blocklist_word()
                                     ├── check_vietnamese_purity()   [NEW]
                                     └── check_section_depth()      [NEW]

registry.py                          registry.py
├── load_system()                    ├── (unchanged)
├── load_developer(age)              ├── (unchanged)
├── load_user()                      ├── (unchanged)
├── build_memory_context()           ├── (unchanged)
├── assemble()                       ├── (unchanged)
                                     ├── load_planner()             [NEW]
                                     ├── load_writer()              [NEW]
                                     └── load_reviewer()            [NEW]
```

---

## 3. Template Changes

### 3.1 Developer Templates

**Current state:** 2 templates (3-4.txt, 5-6.txt) — basic instructions, no story arc, no output schema.

**Enhanced structure (both ages, age-adjusted):**

```
Storytelling strategy for age X-Y:
- (age-specific guidance)

Story arc structure (7 steps):
1. Opening (2-3 paragraphs): Introduce main character, setting, mood
2. Context (2-3 paragraphs): Build world, establish relationships
3. Challenge (3-4 paragraphs): Present main problem/conflict
4. Rising action (2-3 paragraphs): Character attempts, faces obstacles
5. Climax (2-3 paragraphs): Key resolution moment
6. Resolution (2-3 paragraphs): Problem solved, lesson learned
7. Moral summary (1-2 paragraphs): Gentle lesson reinforcement

Vietnamese language guidance:
- Use "bé" and "con" appropriately for child character
- Rich imagery using Vietnamese từ láy (rì rào, lấp lánh, bồng bềnh)
- No English words except proper names

Interaction point design:
- Natural pauses in story flow
- Open-ended questions referencing child's name
- Conversational tone (as if parent speaking)
- 1-2 interactions for age 3-4, 2-3 for age 5-6

Character development guidance:
- Age 3-4: Simple, clear personality traits
- Age 5-6: Slightly nuanced, can show growth
```

**Key differences between ages:**

| Aspect | 3-4.txt | 5-6.txt |
|--------|---------|---------|
| Sentence length | 3-6 words | 5-10 words |
| Total words | 150-250 | 300-500 |
| Interaction points | 1-2 | 2-3 |
| Conflict complexity | Simple, easily resolved | Mild conflict with clear lesson |
| Vocabulary | Basic, repetitive | Richer, more varied |
| Story arc detail | 5 steps (merge rising+climax) | Full 7 steps |

### 3.2 Planner Template — NEW

Extracted from pipeline.py (currently inline), enhanced with richer outline structure:

```
You are a story planner for Vietnamese children's bedtime stories.

Given the child's profile and memory context, create a story outline with:
1. title — engaging Vietnamese title (5-10 words)
2. story_structure.sections — array of 4-6 ordered sections, each with:
   - type: one of {opening, context, conflict, rising_action, climax, resolution, interaction, moral}
   - description: 1-2 sentence outline of this section's content
3. story_structure.moral — the lesson (1 sentence)
4. key_characters — array of character names

Child info: {childName}, age {age}, theme {theme}, goal {goal}, mood {mood}.
{favoriteCharacter}
{memoryContext}

Output ONLY JSON matching this schema. Never add text outside JSON.
```

### 3.3 Writer Template — NEW

Extracted from pipeline.py, enhanced with section requirements:

```
You are a writer of Vietnamese children's bedtime stories.

Write a story following this outline: {outline}

Story structure requirements:
1. Opening (2-3 paragraphs): Introduce main character, setting, mood
2. Context (2-3 paragraphs): Build the world, establish character relationships
3. Challenge (3-4 paragraphs): Present the main problem/conflict
4. Rising action (2-3 paragraphs): Character attempts to solve, faces obstacles
5. Climax (2-3 paragraphs): Key moment of resolution
6. Resolution (2-3 paragraphs): Problem solved, lessons learned
7. Moral summary (1-2 paragraphs): Gentle lesson reinforcement

Each interaction point must:
- Be a natural pause in the story
- Ask the child a question
- Reference the child's name
- Be written conversationally

Output JSON: { "title": "...", "content": [{ "type": "...", "text": "...", "prompt": "..."?, "order": 0 }], "word_count": N }

All content MUST be in Vietnamese (thuần Việt). No English words except proper names.
```

### 3.4 Reviewer Template — NEW

Extracted from pipeline.py, enhanced with quality criteria:

```
Review this children's story for safety and quality:

{story}

Evaluate:
1. Safety — any violence, adult themes, inappropriate content?
2. Vietnamese language purity — any English words (except proper names)?
3. Story structure — are all 7 arc steps present?
4. Section depth — does each section have >1 paragraph?
5. Interaction quality — natural-sounding, age-appropriate?
6. Moral clarity — is lesson explicit enough for parent discussion?

Return JSON:
{
  "safety_verdict": "APPROVED" | "REJECTED" | "FLAGGED",
  "issues": [{ "type": "safety" | "language" | "structure" | "depth" | "quality", "severity": "low" | "medium" | "high", "detail": "..." }],
  "quality_score": 1-5
}
```

---

## 4. Pipeline Changes

### 4.1 Current flow (pipeline.py)

- `_call_retry()` combines system+developer+user → sends LLM
- Planner prompt: not a template, just the combined system+developer+user
- Writer prompt: built in `_build_writer_prompt()` — hardcoded format string
- Reviewer prompt: built in `_review_story()` — hardcoded format string

### 4.2 New flow

- `PromptRegistry` gains: `load_planner()`, `load_writer()`, `load_reviewer()`
- `_call_retry` for `"planner"` → uses planner template (with placeholder substitution)
- `_build_writer_prompt()` → uses writer template with `{outline}` substitution
- `_review_story()` → uses reviewer template with `{story}` substitution

### 4.3 `_build_writer_prompt()` simplification

**Before:**
```python
def _build_writer_prompt(self, prompts: dict, outline: dict) -> str:
    return f"System: {prompts.get('system', '')}\n\nOutline: {json.dumps(outline, ensure_ascii=False)}\n\n{prompts.get('user', '')}"
```

**After:**
```python
def _build_writer_prompt(self, outline: dict) -> str:
    template = self.registry.load_writer()
    return template.format(outline=json.dumps(outline, ensure_ascii=False))
```

### 4.4 `_review_story()` simplification

**Before:** Hardcoded format string in method body.

**After:**
```python
async def _review_story(self, story: dict) -> dict:
    review_prompt = self.registry.load_reviewer().format(story=json.dumps(story, ensure_ascii=False))
    raw = await self._call_llm(review_prompt, "reviewer")
    ...
```

---

## 5. Validator Changes

### 5.1 Vietnamese Blocklist

Add to `BLOCKLIST_WORDS`:

```python
BLOCKLIST_WORDS = [
    # English (existing)
    "sex", "porn", "violence", "blood", "kill", "death",
    "weapon", "gun", "drug", "suicide", "demon", "devil",
    # Vietnamese (new)
    "máu", "chết", "súng", "dao", "đánh nhau",
    "hút thuốc", "rượu", "ma túy", "sát hại", "bạo lực",
    "cấm", "kỳ thị", "phân biệt", "đả kích", "thù hận",
]
```

### 5.2 Vietnamese Purity Check — NEW

Detect common English words that leak into Vietnamese story output.

**Approach:** Maintain a small blocklist of ~30 high-frequency English words that shouldn't appear in a thuần Việt story (e.g., "and", "the", "but", "because", "very", "really", "story", "character", "friend", "happy", "sad", "love", "big", "small"). Check by substring/token match. This avoids the engineering problem of distinguishing Latin-alphabet Vietnamese from English, which is NP-hard without a full dictionary.

```python
ENGLISH_LEAK_BLOCKLIST = [
    "the", "and", "but", "because", "very", "really", "also",
    "story", "character", "friend", "happy", "sad", "love",
    "big", "small", "little", "good", "bad", "nice", "beautiful",
    "start", "end", "once", "upon", "time", "they", "them",
    "their", "where", "there", "here", "with", "without",
]

def check_vietnamese_purity(self, text: str) -> ValidationResult:
    """Check for English word leaks."""
    errors = []
    # Tokenize by splitting on non-word characters, skip short tokens
    words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    # Check if token is a Vietnamese diacritic word (common VI words like 'anh', 'em', 'con' use diacritics or are 2-3 chars)
    found = set()
    for w in words:
        if w in ENGLISH_LEAK_BLOCKLIST:
            found.add(w)
    if found:
        errors.append(f"Có thể có từ tiếng Anh: {', '.join(sorted(found)[:10])}")
    return ValidationResult(valid=len(errors) == 0, errors=errors)
```

**Known limitation:** False positives possible for Vietnamese homographs (e.g., "cảm ơn" uses only VI chars, but short words like "em", "anh" without diacritics could match). The blocklist is intentionally focused on clear English-only tokens like "the", "and", "because".

**Integration:** Vietnamese purity check is a **warning** (not rejection) — it logs but doesn't fail validation. This prevents pipeline blocking on false positives.

### 5.3 Section Depth Check — NEW

```python
def check_section_depth(self, sections: list[dict]) -> ValidationResult:
    """Check that each required section has >1 paragraph."""
    errors = []
    for s in sections:
        text = s.get("text", "")
        paragraphs = [p for p in text.split("\n\n") if p.strip()]
        if s.get("type") in REQUIRED_SECTION_TYPES and len(paragraphs) < 2:
            errors.append(f"Section '{s.get('type')}' has {len(paragraphs)} paragraph(s), minimum 2")
    return ValidationResult(valid=len(errors) == 0, errors=errors)
```

### 5.4 Integration

- `validate_writer()` currently checks: title, content, interactions, word_count, blocklist
- **New:** Thêm `_vietnamese_purity` check vào `_validate_writer_full()` (cảnh báo, không reject)
- **New:** Thêm `check_section_depth` vào `_validate_writer_full()` (reject nếu fail)
- Blocklist check vẫn keep (chặn cả EN + VI)

---

## 6. Registry Changes

Add 3 methods to `PromptRegistry`:

```python
def load_planner(self) -> str:
    path = self.templates_dir / "planner" / "default.txt"
    return path.read_text(encoding="utf-8")

def load_writer(self) -> str:
    path = self.templates_dir / "writer" / "default.txt"
    return path.read_text(encoding="utf-8")

def load_reviewer(self) -> str:
    path = self.templates_dir / "reviewer" / "default.txt"
    return path.read_text(encoding="utf-8")
```

---

## 7. Test Changes

| File | Change |
|------|--------|
| `test_prompt_registry.py` | Add 3 tests: load_planner, load_writer, load_reviewer |
| `test_validator.py` | Add test_vietnamese_purity, test_vietnamese_blocklist, test_section_depth |
| `test_pipeline.py` | Update mock expectations (planner/writer/reviewer now use templates) |

### test_validator.py additions:

```python
def test_vietnamese_blocklist(self):
    validator = OutputValidator()
    assert validator.has_blocklist_word("nội dung bình thường") is False
    assert validator.has_blocklist_word("nội dung sex") is True
    assert validator.has_blocklist_word("có máu") is True       # NEW
    assert validator.has_blocklist_word("đánh nhau") is True    # NEW

def test_vietnamese_purity_clean(self):
    validator = OutputValidator()
    result = validator.check_vietnamese_purity("Bé An đi chơi công viên")
    assert result.valid

def test_vietnamese_purity_english(self):
    validator = OutputValidator()
    result = validator.check_vietnamese_purity("Bé An đi park")
    assert not result.valid
    assert "park" in result.errors[0]

def test_section_depth_ok(self):
    validator = OutputValidator()
    sections = [
        {"type": "opening", "text": "Đoạn 1\n\nĐoạn 2"},
        {"type": "resolution", "text": "A\n\nB"},
    ]
    result = validator.check_section_depth(sections)
    assert result.valid

def test_section_depth_too_shallow(self):
    validator = OutputValidator()
    sections = [
        {"type": "opening", "text": "Chỉ một đoạn"},
    ]
    result = validator.check_section_depth(sections)
    assert not result.valid
```

---

## 8. Files Changed Summary

| File | Change |
|------|--------|
| `Engine/core/prompts/templates/developer/3-4.txt` | Enhance: story arc, Vietnamese guidance, interaction points |
| `Engine/core/prompts/templates/developer/5-6.txt` | Enhance: same structure, age-adjusted complexity |
| `Engine/core/prompts/templates/planner/default.txt` | **NEW** — planner prompt with outline structure |
| `Engine/core/prompts/templates/writer/default.txt` | **NEW** — writer prompt with section requirements |
| `Engine/core/prompts/templates/reviewer/default.txt` | **NEW** — reviewer prompt with quality criteria |
| `Engine/core/prompts/registry.py` | Add load_planner(), load_writer(), load_reviewer() |
| `Engine/core/pipeline.py` | Use template files, simplify _build_writer_prompt and _review_story |
| `Engine/core/validator.py` | Add VI blocklist, check_vietnamese_purity(), check_section_depth() |
| `Engine/tests/test_prompt_registry.py` | Add 3 tests for new load methods |
| `Engine/tests/test_validator.py` | Add 5 tests for new checks |
| `Engine/tests/test_pipeline.py` | Update mock expectations |

---

## 9. Implementation Order

1. Tạo 3 template files mới (planner, writer, reviewer) + enhance developer templates
2. Thêm load methods vào PromptRegistry
3. Cập nhật pipeline.py dùng template files
4. Thêm VI blocklist + purity + section depth vào validator
5. Cập nhật tests
6. Chạy test suite verify

---

## 10. Error & Edge Cases

| Scenario | Handling |
|----------|----------|
| Template file missing | Registry trả về fallback string, log warning |
| Reviewer returns unparseable JSON | Fallback về `{"safety_verdict": "FLAGGED"}` (đã có) |
| Vietnamese purity check false positive (proper names) | ALLOWED_ENGLISH set, heuristic diacritic check |
| Section depth check on optional sections | Bỏ qua optional (interaction, moral) |
| Mixed EN/VI blocklist words | Cả 2 đều bị bắt bởi has_blocklist_word() |
| Age gap (e.g., age 7) | Developer template fallback về 5-6 (đã có) |
