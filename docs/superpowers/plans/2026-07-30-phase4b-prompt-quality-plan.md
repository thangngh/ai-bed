# Phase 4B — Prompt Quality & Story Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng chất lượng prompt templates (developer, planner, writer, reviewer) + thêm quality gates (Vietnamese purity, section depth, Vietnamese blocklist).

**Architecture:** Templates là `.txt` files trong `Engine/core/prompts/templates/`, loaded bởi `PromptRegistry`, consumed bởi `StoryPipeline`. Validator là class riêng trong `validator.py`. Tests dùng pytest-asyncio.

**Tech Stack:** Python 3.13, pytest, asyncio

## Global Constraints

- All templates use Python `str.format()` placeholder syntax (`{variable}`)
- Template files must be UTF-8 without BOM
- Pipeline returns `PipelineResult` even on failure (fallback story)
- Tests use `MockRouter` (not real LLM calls)
- Vietnamese purity check is warning-level only (doesn't reject)
- Blocklist check rejects on match (existing behavior)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `Engine/core/prompts/templates/planner/default.txt` | **NEW** — Planner prompt with outline structure |
| `Engine/core/prompts/templates/writer/default.txt` | **NEW** — Writer prompt with section requirements |
| `Engine/core/prompts/templates/reviewer/default.txt` | **NEW** — Reviewer prompt with quality criteria |
| `Engine/core/prompts/templates/developer/3-4.txt` | **Enhance** — Add story arc, Vietnamese guidance, interaction points |
| `Engine/core/prompts/templates/developer/5-6.txt` | **Enhance** — Same structure, age-adjusted |
| `Engine/core/prompts/registry.py` | Add `load_planner()`, `load_writer()`, `load_reviewer()` |
| `Engine/core/pipeline.py` | Use template files, simplify `_build_writer_prompt` and `_review_story` |
| `Engine/core/validator.py` | Add VI blocklist, `check_vietnamese_purity()`, `check_section_depth()` |
| `Engine/tests/test_prompt_registry.py` | Add 3 tests for new load methods |
| `Engine/tests/test_validator.py` | Add 5 tests for new checks |
| `Engine/tests/test_pipeline.py` | Update mock expectations |

---

### Task 1: Template Files + Registry

**Files:**
- Create: `Engine/core/prompts/templates/planner/default.txt`
- Create: `Engine/core/prompts/templates/writer/default.txt`
- Create: `Engine/core/prompts/templates/reviewer/default.txt`
- Modify: `Engine/core/prompts/templates/developer/3-4.txt`
- Modify: `Engine/core/prompts/templates/developer/5-6.txt`
- Modify: `Engine/core/prompts/registry.py`
- Test: `Engine/tests/test_prompt_registry.py`

**Interfaces:**
- Produces: `PromptRegistry.load_planner() -> str`, `PromptRegistry.load_writer() -> str`, `PromptRegistry.load_reviewer() -> str`

- [ ] **Step 1: Create planner template**

Write `Engine/core/prompts/templates/planner/default.txt`:

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

- [ ] **Step 2: Create writer template**

Write `Engine/core/prompts/templates/writer/default.txt`:

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

- [ ] **Step 3: Create reviewer template**

Write `Engine/core/prompts/templates/reviewer/default.txt`:

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

- [ ] **Step 4: Enhance developer/3-4.txt**

Write `Engine/core/prompts/templates/developer/3-4.txt`:

```
Storytelling strategy for age 3-4:
- VERY simple sentences, 3-6 words per sentence
- Repeat key phrases for comfort
- Story length: 150-250 words
- Lots of sound words (onomatopoeia like "tích tắc", "ào ào", "róc rách")
- Main character is the child
- Simple gentle conflict easily resolved
- The FINAL STORY must be in Vietnamese (thuần Việt)

Story arc structure (5 steps — rising action + climax merged for simplicity):
1. Opening (2-3 paragraphs): Introduce main character, setting, mood
2. Context (2-3 paragraphs): Build the world, establish relationships
3. Challenge (2-3 paragraphs): Present the main problem
4. Resolution (2-3 paragraphs): Problem solved, lessons learned
5. Moral summary (1-2 paragraphs): Gentle lesson reinforcement

Interaction points:
- 1-2 natural pauses in the story
- Simple yes/no questions or "con nghĩ sao?"
- Reference the child's name
- Conversational tone (as if parent speaking to child)

Vietnamese language:
- Use "bé" and "con" appropriately for child character
- Rich imagery using Vietnamese từ láy (rì rào, lấp lánh, bồng bềnh)
- NO English words — pure Vietnamese only

If the child's gender is known (boy/girl), use appropriate Vietnamese pronouns (bé trai/bé gái).
If a favorite character is named, make that character the main companion in the story.
If no favorite character is given, use a gentle animal friend (thỏ con, mèo con, gấu nhỏ).
```

- [ ] **Step 5: Enhance developer/5-6.txt**

Write `Engine/core/prompts/templates/developer/5-6.txt`:

```
Storytelling strategy for age 5-6:
- Richer vocabulary but still clear
- Story length: 300-500 words
- Mild conflict with a clear lesson
- 2-3 interaction points for parent to ask child
- Vivid descriptions using Vietnamese từ láy
- Main character is the child
- Ending with a warm moral lesson
- The FINAL STORY must be in Vietnamese (thuần Việt)

Story arc structure (7 steps):
1. Opening (2-3 paragraphs): Introduce main character, setting, mood
2. Context (2-3 paragraphs): Build the world, establish character relationships
3. Challenge (3-4 paragraphs): Present the main problem/conflict
4. Rising action (2-3 paragraphs): Character attempts to solve, faces obstacles
5. Climax (2-3 paragraphs): Key moment of resolution
6. Resolution (2-3 paragraphs): Problem solved, lessons learned
7. Moral summary (1-2 paragraphs): Gentle lesson reinforcement

Interaction points:
- Natural pauses in story flow
- Open-ended questions ("Con sẽ làm gì?", "Con nghĩ điều gì sẽ xảy ra?")
- Reference the child's name
- Conversational tone (as if parent speaking to child)

Vietnamese language:
- Use "bé" and "con" appropriately for child character
- Rich imagery using Vietnamese từ láy (rì rào, lấp lánh, bồng bềnh)
- NO English words — pure Vietnamese only

If the child's gender is known (boy/girl), use appropriate Vietnamese pronouns (bé trai/bé gái).
If a favorite character is named, make that character the main companion in the story.
If no favorite character is given, use a gentle animal friend (thỏ con, mèo con, gấu nhỏ).
```

- [ ] **Step 6: Add load methods to PromptRegistry**

In `Engine/core/prompts/registry.py`, add after `load_user()`:

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

- [ ] **Step 7: Add registry tests**

In `Engine/tests/test_prompt_registry.py`, add inside `TestPromptRegistry`:

```python
def test_load_planner(self):
    registry = PromptRegistry()
    prompt = registry.load_planner()
    assert "planner" in prompt.lower()
    assert len(prompt) > 50

def test_load_writer(self):
    registry = PromptRegistry()
    prompt = registry.load_writer()
    assert "writer" in prompt.lower() or "story" in prompt.lower()
    assert "outline" in prompt
    assert len(prompt) > 50

def test_load_reviewer(self):
    registry = PromptRegistry()
    prompt = registry.load_reviewer()
    assert "review" in prompt.lower()
    assert "safety_verdict" in prompt
```

- [ ] **Step 8: Run tests**

```bash
cd D:\2026\pet-project\ai-bed\Engine && python -m pytest tests/test_prompt_registry.py -v 2>&1
```

Expected: all tests pass (including 3 new ones).

- [ ] **Step 9: Commit**

```bash
cd D:\2026\pet-project\ai-bed
git add Engine/core/prompts/templates/planner/default.txt Engine/core/prompts/templates/writer/default.txt Engine/core/prompts/templates/reviewer/default.txt Engine/core/prompts/templates/developer/3-4.txt Engine/core/prompts/templates/developer/5-6.txt Engine/core/prompts/registry.py Engine/tests/test_prompt_registry.py
git commit -m "feat: add planner/writer/reviewer templates, enhance developer templates"
```

---

### Task 2: Pipeline — Use Template Files

**Files:**
- Modify: `Engine/core/pipeline.py`
- Test: `Engine/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `PromptRegistry.load_planner()`, `PromptRegistry.load_writer()`, `PromptRegistry.load_reviewer()`
- Consumes: `StoryPipeline.__init__` now takes optional `PromptRegistry` parameter

- [ ] **Step 1: Write failing pipeline test (expects new behavior)**

Modify the pipeline test to verify the new template flow. The mock needs to return text that looks like template output.

In `Engine/tests/test_pipeline.py`, update `TestStoryPipeline`:

```python
@pytest.mark.asyncio
async def test_happy_path(self):
    router = MockRouter({
        "planner": '{"title": "Test", "story_structure": {"opening": "...", "sections": [{"order": 0, "type": "opening", "description": "..."}], "moral": "good", "key_characters": ["An"]}}',
        "writer": '{"title": "Test", "content": [{"type": "opening", "text": "Xin chào", "order": 0}, {"type": "interaction", "text": "Hỏi", "prompt": "Con nghĩ?", "order": 1}, {"type": "resolution", "text": "Hết", "order": 2}], "word_count": 150}',
        "reviewer": '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}',
    })
    pipeline = StoryPipeline(router)

    result = await pipeline.run({})
    assert result.success is True
    assert result.safety_verdict == "APPROVED"
    assert result.title == "Test"

@pytest.mark.asyncio
async def test_fallback_on_all_failures(self):
    class FailingRouter:
        async def complete(self, prompt, stage=""):
            raise Exception("LLM down")

    pipeline = StoryPipeline(FailingRouter())
    result = await pipeline.run({})
    assert result.success is True
    assert result.is_fallback is True
    assert result.title == "Câu chuyện bất ngờ"
```

The same tests should still pass because pipeline behavior doesn't change — only how prompts are built changes.

- [ ] **Step 2: Modify pipeline.py to use templates**

First, at the top of `Engine/core/pipeline.py`, add import:

```python
from .prompts.registry import PromptRegistry
```

In `__init__`, store registry:

```python
def __init__(self, router: LLMRouter):
    self.router = router
    self.validator = OutputValidator()
    self.registry = PromptRegistry()
    self.llm_calls = 0
```

Update `_build_writer_prompt`:

```python
def _build_writer_prompt(self, outline: dict) -> str:
    template = self.registry.load_writer()
    return template.format(outline=json.dumps(outline, ensure_ascii=False))
```

Update `_review_story`:

```python
async def _review_story(self, story: dict) -> dict:
    review_prompt = self.registry.load_reviewer().format(
        story=json.dumps(story, ensure_ascii=False)
    )
    raw = await self._call_llm(review_prompt, "reviewer")
    try:
        return json.loads(raw)
    except Exception:
        return {"safety_verdict": "FLAGGED", "issues": [{"type": "format", "severity": "low", "detail": "Cannot parse review"}], "quality_score": 3}
```

In `run()`, update the writer prompt call (line 57):
```python
# Before:
writer_prompt = self._build_writer_prompt(prompts, outline)
# After:
writer_prompt = self._build_writer_prompt(outline)
```

- [ ] **Step 3: Run pipeline tests**

```bash
cd D:\2026\pet-project\ai-bed\Engine && python -m pytest tests/test_pipeline.py -v 2>&1
```

Expected: 2 tests pass.

- [ ] **Step 4: Run full test suite**

```bash
cd D:\2026\pet-project\ai-bed\Engine && python -m pytest -v 2>&1
```

Expected: all tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
cd D:\2026\pet-project\ai-bed
git add Engine/core/pipeline.py Engine/tests/test_pipeline.py
git commit -m "feat: use template files for planner/writer/reviewer prompts"
```

---

### Task 3: Validator — VI Blocklist + Purity + Section Depth

**Files:**
- Modify: `Engine/core/validator.py`
- Test: `Engine/tests/test_validator.py`

- [ ] **Step 1: Write failing tests**

Add to `Engine/tests/test_validator.py` inside `TestOutputValidator`:

```python
def test_vietnamese_blocklist(self):
    validator = OutputValidator()
    assert validator.has_blocklist_word("nội dung bình thường") is False
    assert validator.has_blocklist_word("nội dung sex") is True
    assert validator.has_blocklist_word("có máu") is True
    assert validator.has_blocklist_word("đánh nhau") is True

def test_vietnamese_purity_clean(self):
    validator = OutputValidator()
    result = validator.check_vietnamese_purity("Bé An đi chơi công viên")
    assert result.valid

def test_vietnamese_purity_english_leak(self):
    validator = OutputValidator()
    result = validator.check_vietnamese_purity("Bé An is happy")
    assert not result.valid
    assert "is" in result.errors[0] or "happy" in result.errors[0]

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

def test_writer_includes_vietnamese_purity_warning(self):
    """Vietnamese purity check doesn't fail validation (warning only)."""
    validator = OutputValidator()
    data = {
        "title": "Truyện hay",
        "content": [
            {"type": "opening", "text": "Nội dung tiếng Việt", "order": 0},
            {"type": "interaction", "text": "Con nghĩ sao?", "prompt": "?", "order": 1},
            {"type": "resolution", "text": "Kết thúc", "order": 2},
        ],
        "word_count": 200
    }
    result = validator.validate_writer(data)
    assert result.valid  # purity is warning, not rejection
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:\2026\pet-project\ai-bed\Engine && python -m pytest tests/test_validator.py -v 2>&1
```

Expected: 5 new tests FAIL (function not found / blocklist changes).

- [ ] **Step 3: Implement VI blocklist + purity + section depth**

In `Engine/core/validator.py`:

Update `BLOCKLIST_WORDS`:

```python
BLOCKLIST_WORDS = [
    "sex", "porn", "violence", "blood", "kill", "death",
    "weapon", "gun", "drug", "suicide", "demon", "devil",
    "máu", "chết", "súng", "dao", "đánh nhau",
    "hút thuốc", "rượu", "ma túy", "sát hại", "bạo lực",
    "cấm", "kỳ thị", "phân biệt", "đả kích", "thù hận",
]
```

Add after `has_blocklist_word`:

```python
ENGLISH_LEAK_BLOCKLIST = [
    "the", "and", "but", "because", "very", "really", "also",
    "story", "character", "friend", "happy", "sad", "love",
    "big", "small", "little", "good", "bad", "nice", "beautiful",
    "start", "end", "once", "upon", "time", "they", "them",
    "their", "where", "there", "here", "with", "without",
]

def check_vietnamese_purity(self, text: str) -> ValidationResult:
    errors = []
    words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    found = set()
    for w in words:
        if w in ENGLISH_LEAK_BLOCKLIST:
            found.add(w)
    if found:
        errors.append(f"Có thể có từ tiếng Anh: {', '.join(sorted(found)[:10])}")
    return ValidationResult(valid=len(errors) == 0, errors=errors)

def check_section_depth(self, sections: list[dict]) -> ValidationResult:
    errors = []
    for s in sections:
        text = s.get("text", "")
        paragraphs = [p for p in text.split("\n\n") if p.strip()]
        if s.get("type") in REQUIRED_SECTION_TYPES and len(paragraphs) < 2:
            errors.append(f"Section '{s.get('type')}' has {len(paragraphs)} paragraph(s), minimum 2")
    return ValidationResult(valid=len(errors) == 0, errors=errors)
```

- [ ] **Step 4: Add purity warning to _validate_writer_full**

In `Engine/core/pipeline.py`, update `_validate_writer_full` to include purity check as warning:

```python
def _validate_writer_full(self, data: dict):
    schema_result = self.validator.validate_writer(data)
    if not schema_result.valid:
        return schema_result
    content = data.get("content", [])
    sections_result = self.validator.validate_sections(content)
    if not sections_result.valid:
        from .validator import ValidationResult
        return ValidationResult(valid=False, errors=sections_result.errors)
    depth_result = self.validator.check_section_depth(content)
    if not depth_result.valid:
        from .validator import ValidationResult
        return ValidationResult(valid=False, errors=depth_result.errors)
    full_text = str(data)
    purity_result = self.validator.check_vietnamese_purity(full_text)
    if not purity_result.valid:
        logger.warning(f"Vietnamese purity: {purity_result.errors}")
    return schema_result
```

- [ ] **Step 5: Run tests**

```bash
cd D:\2026\pet-project\ai-bed\Engine && python -m pytest tests/test_validator.py -v 2>&1
```

Expected: 10 tests pass (5 existing + 5 new).

- [ ] **Step 6: Run full test suite**

```bash
cd D:\2026\pet-project\ai-bed\Engine && python -m pytest -v 2>&1
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd D:\2026\pet-project\ai-bed
git add Engine/core/validator.py Engine/core/pipeline.py Engine/tests/test_validator.py
git commit -m "feat: add vietnamese blocklist, purity check, section depth validator"
```

---

## Self-Review

- **Spec coverage:**
  - Section 3.1 developer templates ✅ Task 1 steps 4-5
  - Section 3.2 planner template ✅ Task 1 step 1
  - Section 3.3 writer template ✅ Task 1 step 2
  - Section 3.4 reviewer template ✅ Task 1 step 3
  - Section 4 pipeline changes ✅ Task 2
  - Section 5.1 VI blocklist ✅ Task 3 step 3
  - Section 5.2 purity check ✅ Task 3 step 3
  - Section 5.3 section depth ✅ Task 3 step 3
  - Section 5.4 integration ✅ Task 3 step 4
  - Section 6 registry changes ✅ Task 1 step 6
  - Section 7 tests ✅ Task 1 step 7, Task 2 step 1, Task 3 step 1
- **Placeholders:** None
- **Type consistency:** `load_planner()`/`load_writer()`/`load_reviewer()` defined in Task 1, consumed in Task 2. `check_vietnamese_purity()`/`check_section_depth()` defined in Task 3. Consistent.
