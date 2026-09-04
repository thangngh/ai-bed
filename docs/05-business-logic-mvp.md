# Business Logic Document — Bedtime Story Companion (MVP)

> **Version:** 1.0  
> **Ngày:** 2026-07-27  
> **Phạm vi:** Chỉ core flow sinh truyện + memory logic

---

## 1. Core Workflow: Story Generation

### 1.1 High-level Flow

```
[Input] → [Normalize] → [Validate] → [Build Context] → [Assemble Prompts]
    → [Planner] → [Writer] → [Reviewer] → [Extract Memory] → [Save] → [Response]

Table groups (all live in the one Postgres `core` datasource; "private" vs
"user-visible" is a naming convention carried over from the old two-file
SQLite split, not separate storage — see docs/04 §1):
  Validate:           tenants + child_profiles  → private tables
  Build Context:      memories                  → user-visible tables
  Save Story:         stories + sections        → user-visible tables
  Save Feedback:      feedbacks                 → private tables
```

### 1.2 Detailed Logic per Stage

#### Stage 1: Input Normalization (NestJS)

```
Input:
{
  child_name: string,
  age: number,
  theme: string,
  goal?: string,
  mood?: string,
  language?: 'vi',
  tenant_id: string (from header)
}

Output:
{
  normalized: {
    childName: string.trim().capitalize(),
    age: Math.round(age),
    theme: theme.trim().toLowerCase(),
    goal: goal?.trim() || null,
    mood: mood?.trim() || 'neutral',
    language: 'vi',
    tenantId: tenant_id
  },
  errors?: ValidationError[]
}
```

**Business rules:**
- `childName`: trim whitespace, capitalize first letter, max 50 chars
- `age`: must be integer, clamp not allowed — reject if out of range
- `theme`: lowercase, max 200 chars, strip HTML tags
- `goal`: optional, max 500 chars
- `mood`: if provided, must be one of `['vui vẻ', 'dịu dàng', 'phiêu lưu', 'hài hước', 'neutral']`
- `language`: default `'vi'`

#### Stage 2: Validation (NestJS)

**Business rule checks (sequential, fail fast):**

```
1. age < 3 or age > 6  →  ERROR "AGE_OUT_OF_RANGE"
2. childName empty       →  ERROR "NAME_REQUIRED"
3. theme empty           →  ERROR "THEME_REQUIRED"
4. childName length > 50 →  ERROR "NAME_TOO_LONG"
5. theme length > 200    →  ERROR "THEME_TOO_LONG"
6. goal length > 500     →  ERROR "GOAL_TOO_LONG"
7. mood not in allowed   →  ERROR "INVALID_MOOD"
8. language != 'vi'      →  ERROR "LANGUAGE_NOT_SUPPORTED" (MVP)
9. Content safety scan   →  ERROR "CONTENT_POLICY_VIOLATION"
```

#### Stage 3: Build Context (NestJS → Engine)

**Logic:**

```
function buildContext(normalized, tenantId):
  // ─── private tables: tenants, child_profiles ───
  1. Query child profile by tenantId + childName
  2. If profile exists → load:
     - interests
     - preferredCharacters
     - bedtimeGoal
     - previous themes (last 5)
  3. If NO profile → create one (private tables) with basic info

  // ─── user-visible tables: memory_items, stories ───
  4. Query active memories (top 5 by confidence):
     - memoryType in ['interest', 'character', 'feedback']
     - filter: tenantId, childId, isActive=true
  5. Query last 2 stories (user-visible tables, for continuity)
  6. Build context object:
     {
       child: { name, age, interests, previousThemes, ... },
       memories: [...],
       recentStories: [...],
       tenantId
     }
  7. Return context

Rule: Không nhét toàn bộ history — tối đa 5 memories + 2 recent stories
Private tables: tenant + child profile
User-visible tables: memories + stories
```

#### Stage 4: Assemble Prompts (Engine)

**Nguyên tắc:** Prompt instruction = **English**, Story output = **Vietnamese (thuần Việt)**

```
System Prompt (FIXED — never changes per session):
  "You are a Vietnamese children's bedtime storyteller for ages 3-6.
   Tone: gentle, warm, rich in imagery.
   Language: ALL story content MUST be in Vietnamese — pure, simple,
   beautiful Vietnamese suitable for young children.

   Safety: STRICTLY FORBIDDEN — no violence, blood, horror,
   sexual content, adult themes, profanity, discrimination,
   politics, religion, or disguised advertising.

   Output format: Respond ONLY with valid JSON following the
   requested schema. Never add text outside the JSON block."

Developer Prompt (STRATEGY — configurable per story version):
  "Storytelling strategy:
   - Opening: introduce the main character (named after the child) and setting
   - Development: a gentle conflict, 2-3 child interaction points
   - Ending: warm, with a light moral lesson
   - Length: 300-500 words
   - Style: use vivid adjectives, onomatopoeia (Vietnamese: từ láy),
     short simple sentences appropriate for age 3-6
   - IMPORTANT: The child's name MUST be the main character's name
   - Every section must be written in Vietnamese (thuần Việt)"

User Prompt (DATA — dynamic per request, in English structure):
  "Child information:
   - Name: {childName}
   - Age: {age}
   - Theme: {theme}
   - Lesson goal: {goal}
   - Mood: {mood}
   - Memory context: {memories}

   Generate a story following the structure defined in the system prompt.
   The story itself MUST be in Vietnamese, thuần Việt style."
```

**Prompt assembly rules:**
1. System prompt: hoàn toàn cố định, load từ file/template — English instructions
2. Developer prompt: có thể có variant theo age group (3-4 vs 5-6) — English instructions
3. User prompt: data-structured in English, nhưng dữ liệu variables là tiếng Việt
4. Memory context: inject vào user prompt, tối đa 200 tokens — English header
5. Output schema instruction: trong system prompt (English)

**Language policy:**
```
Instruction prompts (system/dev/planner/writer/reviewer/extractor) = ENGLISH
Story output (title, content, interaction questions, memory values) = VIETNAMESE (thuần Việt)
Reviewer verdict + issue details = ENGLISH
Fallback story text = VIETNAMESE
```

#### Stage 5: Planner (LLM Call #1)

**Input:** System + Developer + User prompts  
**Output (schema):**
```json
{
  "title": "string",
  "story_structure": {
    "opening": "string",
    "sections": [
      { "order": 0, "type": "opening", "description": "..." },
      { "order": 1, "type": "context", "description": "..." },
      { "order": 2, "type": "conflict", "description": "..." },
      { "order": 3, "type": "interaction", "description": "..." },
      { "order": 4, "type": "resolution", "description": "..." }
    ],
    "moral": "string",
    "key_characters": ["character1", "character2"]
  }
}
```

**Business rules:**
- `title`: max 100 chars, tiếng Việt, không dấu câu đặc biệt
- `sections`: tối thiểu 4 sections, tối đa 7
- `moral`: match với goal nếu có
- Validate output schema → nếu fail → retry (max 2)

#### Stage 6: Writer (LLM Call #2)

**Input:** System prompt + Outline (từ Planner) + User data  
**Output (schema):**
```json
{
  "title": "string",
  "content": [
    { "type": "opening", "text": "...", "order": 0 },
    { "type": "context", "text": "...", "order": 1 },
    { "type": "conflict", "text": "...", "order": 2 },
    { "type": "interaction", "text": "...", "prompt": "...", "order": 3 },
    { "type": "resolution", "text": "...", "order": 4 }
  ],
  "word_count": 350
}
```

**Business rules:**
- `word_count` >= 100 (quá ngắn → retry)
- Section order phải khớp outline
- Ít nhất 1 `type: "interaction"` section
- Interaction prompt phải là câu hỏi cho trẻ
- Nội dung không chứa URL, email, số điện thoại
- Không chứa HTML tags

#### Stage 7: Reviewer (LLM Call #3)

**Input:** System prompt (Reviewer variant) + Story content  
**Output (schema):**
```json
{
  "safety_verdict": "APPROVED" | "REJECTED" | "FLAGGED",
  "issues": [
    { "type": "violence" | "content" | "format" | "age_appropriateness",
      "severity": "low" | "medium" | "high",
      "detail": "..." }
  ],
  "quality_score": 4,
  "suggestions": ["thêm tương tác ở section 2"]
}
```

**Review rules:**
1. `REJECTED` = có issue `severity: high` → không được dùng output
2. `FLAGGED` = có issue `severity: medium` → cần review thủ công (ở MVP: auto-approve nếu chỉ low)
3. `APPROVED` = không có issue medium/high
4. Nếu REJECTED → retry writer (tối đa 1 lần)
5. Nếu vẫn REJECTED → fallback response

#### Stage 8: Memory Extraction (Engine, optional call #4)

**Input:** Final story content (approved)  
**Output (schema):**
```json
{
  "memories": [
    {
      "type": "interest" | "character" | "theme" | "feedback",
      "key": "string",
      "value": "string",
      "confidence": 0.85,
      "source": "text excerpt"
    }
  ]
}
```

**Memory write policy (→ `memory_items`, user-visible tables):**
- Chỉ lưu memory với `confidence >= 0.3`
- `type: "feedback"` chỉ lưu khi đến từ explicit feedback (không extract từ story)
- De-duplicate: nếu `key` đã tồn tại và có `confidence` cao hơn → update
- `type: "child_name"` → chỉ lưu nếu chưa có
- Giới hạn 10 memories active per child (oldest bị deactivate)
- Memory → `memory_items` (user-visible tables)
- Feedback → `feedbacks` (private tables, ẩn design)

---

## 2. Feedback Processing Flow

```
[User submits feedback] → [Validate] → [Update Memory] → [Update Story] → [Response]
```

**Logic:**

```
function processFeedback(input):
  1. Validate: story_id tồn tại? → `stories` (user-visible tables)
     Tenant tồn tại? → `tenants` (private tables)
  2. Lưu feedback record → `feedbacks` (private tables, analytics)
  3. Nếu rating >= 4:
     - memory_item (user-visible tables): type='feedback', key='liked_theme', value=story.theme
     - memory_item (user-visible tables): type='feedback', key='liked_character', value=extracted
  4. Nếu rating <= 2:
     - memory_item (user-visible tables): type='feedback', key='disliked_theme', value=story.theme

Rule: FEEDBACK → `feedbacks` (private tables, ẩn design)
       MEMORY update → `memory_items` (user-visible tables)
       Feedback KHÔNG modify story content.
       Feedback chỉ ảnh hưởng đến lần sinh truyện SAU.
```

---

## 3. Memory Read Policy (Context Building)

```
Priority queue (top N):
  Tier 1: child_name, age (always included)
  Tier 2: interests, preferred_characters (từ profile)
  Tier 3: recent_feedback (từ feedbacks, last 3)
  Tier 4: previous_themes (từ stories, last 5 unique)

Token budget for memory: max 200 tokens
Sliding window: chỉ lấy memories từ 30 ngày gần nhất
```

---

## 4. Error Handling

### Error Codes (Business Logic)

| Code | HTTP | Khi nào | Xử lý |
|---|---|---|---|
| `VALIDATION_ERROR` | 422 | Input sai business rules | Trả field lỗi chi tiết |
| `TENANT_REQUIRED` | 400 | Thiếu tenant-id header | Tự sinh + retry |
| `RATE_LIMIT_EXCEEDED` | 429 | Vượt quota | Retry-After header |
| `ENGINE_TIMEOUT` | 502 | LLM call timeout | Retry 2x, fallback |
| `ENGINE_ERROR` | 502 | LLM trả lỗi | Retry 2x, fallback |
| `SAFETY_REJECTED` | 422 | Content bị reject | User thấy "nội dung không phù hợp" |
| `STORY_NOT_FOUND` | 404 | Story id không tồn tại | — |
| `TENANT_MISMATCH` | 403 | Truy cập cross-tenant | — |

### Fallback Response (khi tất cả retry fail)

```json
{
  "title": "Câu chuyện bất ngờ",
  "content": [{
    "type": "opening",
    "text": "Xin lỗi bạn nhỏ, hôm nay máy kể chuyện hơi mệt một chút. Bạn hãy thử lại sau nhé! Hãy tưởng tượng một câu chuyện thật đẹp trước khi ngủ nào.",
    "order": 0
  }],
  "is_fallback": true,
  "error_code": "ENGINE_FALLBACK"
}
```

---

## 5. Rate Limit Logic

```
Token Bucket Algorithm:
  - capacity: 10 tokens / tenant
  - refill rate: 1 token / 6 seconds (10 req/min)
  - cost per request: 1 token
  - LLM retry: counts as same request (không tiêu thêm token)

Middleware check flow:
  1. Parse tenant_id
  2. Get bucket state from cache (in-memory)
  3. If bucket empty → 429
  4. Else consume token → proceed
```

---

## 6. Content Safety Rules

### Check list (applied in Validation Layer)

```
BLOCKLIST_WORDS = [...chửi thề, từ nhạy cảm...]
BLOCKLIST_TOPICS = ['sex', 'violence_detail', 'drug', 'politics', 'adult']

function contentSafetyCheck(text):
  1. lowercase + normalize text
  2. Scan for blocklist words → flag with position
  3. Semantic check via LLM (reviewer stage)
  4. If blocklist match → REJECTED (no retry)
  5. If LLM flags → REVIEWER verdict
```

---

## 7. Tenant Lifecycle

```
TENANT CREATION:
  - Trigger: first request từ device mới
  - Generate UUID v4
  - Lưu vào tenants table
  - Set cookie / return header

TENANT ACTIVITY:
  - Mọi request gắn tenant_id
  - BE validate tenant tồn tại
  - Auto-create nếu chưa có (lazy init)

TENANT DATA:
  - Không có "delete tenant" trong MVP
  - Có thể soft-deactivate
```

---

## 8. Key Decision Records

| Decision | Option chọn | Lý do |
|---|---|---|
| Tenant isolation | Row-level (tenant_id column) | Đơn giản, đủ cho MVP |
| Memory storage | Postgres table (`memory_items`) | Không cần vector DB ở MVP |
| LLM retry | Tối đa 2 lần/stage | Balance cost vs quality |
| Fallback | Story mẫu tĩnh | Không để user thấy error trần |
| Prompt storage | File templates | Dễ edit, version control |
| Output format | JSON schema | Validate được, parse nhanh |
