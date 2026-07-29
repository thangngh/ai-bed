# Engine Design — Python/Mastra (MVP)

> **Version:** 1.0  
> **Ngày:** 2026-07-27  
> **Tech:** Python (FastAPI) / Mastra.ai  
> **Status:** Draft — MVP Core

---

## 1. Vai trò của Engine Layer

Engine là **bộ não** của hệ thống — nơi điều phối LLM, quản lý prompt, và đảm bảo output chất lượng.

**Engine KHÔNG làm:**
- Routing, tenant isolation, validation đầu vào (NestJS lo)
- Lưu DB, quản lý session (NestJS lo)
- FE communication

**Engine CHỈ làm:**
- Prompt assembly & management
- LLM call orchestration (Planner → Writer → Reviewer)
- Output validation & safety filtering
- Memory extraction
- Retry & fallback logic

---

## 2. Kiến trúc Engine

```
FastAPI Server (port 8000)
│
├── POST /generate
│   └── Orchestrator
│       ├── Stage 1: ContextBuilder
│       ├── Stage 2: PromptAssembler
│       ├── Stage 3: Pipeline
│       │   ├── PlannerAgent
│       │   ├── WriterAgent
│       │   ├── ReviewerAgent
│       │   └── MemoryExtractor
│       └── Stage 4: OutputValidator
│
├── POST /health
│
└── Config
    ├── Prompt Templates (system/dev/user)
    ├── LLM Client (OpenAI / Claude)
    └── Pipeline Config (retry, timeout, schema)
```

## 3. Component Details

### 3.1 Orchestrator — Pipeline Controller

```python
# core/orchestrator.py

class StoryOrchestrator:
    """Điều phối pipeline 4-stage cho story generation."""
    
    def __init__(self, llm_client, prompt_registry, config):
        self.planner = PlannerAgent(llm_client, prompt_registry)
        self.writer = WriterAgent(llm_client, prompt_registry)
        self.reviewer = ReviewerAgent(llm_client, prompt_registry)
        self.memory_extractor = MemoryExtractor(llm_client, prompt_registry)
        self.validator = OutputValidator(config.schema_dir)
        self.config = config
    
    async def generate(
        self, 
        child_name: str,
        age: int,
        theme: str,
        goal: str | None = None,
        mood: str | None = None,
        memories: list[MemoryContext] | None = None,
        recent_stories: list[StorySummary] | None = None,
    ) -> EngineResponse:
        
        start_time = time.monotonic()
        llm_call_count = 0
        total_retries = 0
        
        # Stage 1: Outline (Planner)
        outline, calls, retries = await self._with_retry(
            self.planner.generate_outline,
            max_retries=self.config.planner_retries,
            child_name=child_name, age=age, theme=theme,
            goal=goal, mood=mood, memories=memories,
        )
        llm_call_count += calls
        total_retries += retries
        
        if not outline:
            return self._fallback_response(start_time, llm_call_count, total_retries)
        
        # Stage 2: Story (Writer)
        story, calls, retries = await self._with_retry(
            self.writer.write_story,
            max_retries=self.config.writer_retries,
            outline=outline,
            child_name=child_name, age=age,
            theme=theme, goal=goal, mood=mood,
            memories=memories,
        )
        llm_call_count += calls
        total_retries += retries
        
        if not story:
            return self._fallback_response(start_time, llm_call_count, total_retries)
        
        # Stage 3: Review (Reviewer)
        review, calls, retries = await self._with_retry(
            self.reviewer.review_story,
            max_retries=self.config.reviewer_retries,
            story=story,
        )
        llm_call_count += calls
        total_retries += retries
        
        if review.safety_verdict == "REJECTED":
            # One more try with explicit error context
            story, calls, retries = await self._with_retry(
                self.writer.write_story_with_feedback,
                max_retries=1,
                outline=outline,
                review_feedback=review.issues,
                child_name=child_name, age=age,
                theme=theme, goal=goal, mood=mood,
            )
            llm_call_count += calls
            total_retries += retries
            
            if not story:
                return self._fallback_response(start_time, llm_call_count, total_retries)
            
            # Re-review
            review, calls, retries = await self._with_retry(
                self.reviewer.review_story,
                max_retries=1,
                story=story,
            )
            llm_call_count += calls
            total_retries += retries
        
        # Validate output schema
        validation = self.validator.validate(story)
        if not validation.is_valid:
            if validation.has_safety_issue:
                return self._fallback_response(start_time, llm_call_count, total_retries,
                                               error="SAFETY_REJECTED")
            # Format fix
            story = self.validator.auto_fix(story)
        
        # Stage 4: Extract memory (optional, không retry)
        extracted_memories = await self.memory_extractor.extract(
            story, child_name, theme
        )
        llm_call_count += 1  # memory extraction call
        
        latency_ms = int((time.monotonic() - start_time) * 1000)
        
        return EngineResponse(
            request_id=str(uuid.uuid4()),
            title=story["title"],
            content=story["content"],
            structure=outline.get("story_structure"),
            safety_status=review.safety_verdict if review else "APPROVED",
            memories=extracted_memories,
            llm_calls=llm_call_count,
            retry_count=total_retries,
            latency_ms=latency_ms,
            word_count=sum(len(s["text"]) for s in story["content"]),
            is_fallback=False,
        )
    
    async def _with_retry(self, fn, max_retries, **kwargs):
        """Execute function with retry logic."""
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                result = await asyncio.wait_for(
                    fn(**kwargs),
                    timeout=self.config.stage_timeout_ms / 1000,
                )
                return result, 1 + attempt, attempt
            except (TimeoutError, ValidationError) as e:
                last_error = e
                continue
        return None, max_retries + 1, max_retries
    
    def _fallback_response(self, start_time, llm_calls, retries, error=None):
        latency_ms = int((time.monotonic() - start_time) * 1000)
        return EngineResponse(
            request_id=str(uuid.uuid4()),
            title="Câu chuyện bất ngờ",
            content=[{
                "type": "opening",
                "text": "Xin lỗi bạn nhỏ, hôm nay máy kể chuyện hơi mệt một chút...",
                "order": 0,
            }],
            safety_status="FALLBACK",
            llm_calls=llm_calls,
            retry_count=retries,
            latency_ms=latency_ms,
            word_count=0,
            is_fallback=True,
        )
```

### 3.2 Prompt Registry

```python
# core/prompts/registry.py

class PromptRegistry:
    """Quản lý template prompts — load từ file, versioned."""
    
    def __init__(self, templates_dir: str = "core/prompts/templates"):
        self.templates_dir = templates_dir
        self._cache: dict[str, str] = {}
    
    def get_system_prompt(self, variant: str = "default") -> str:
        return self._load("system", variant)
    
    def get_developer_prompt(self, age_group: str = "3-4") -> str:
        return self._load("developer", age_group)
    
    def build_user_prompt(self, context: UserContext) -> str:
        template = self._load("user", "default")
        return template.format(
            child_name=context.child_name,
            age=context.age,
            theme=context.theme,
            goal=context.goal or "không có",
            mood=context.mood or "vui vẻ",
            memory_context=self._format_memories(context.memories),
        )
    
    def _load(self, prompt_type: str, variant: str) -> str:
        cache_key = f"{prompt_type}:{variant}"
        if cache_key not in self._cache:
            path = f"{self.templates_dir}/{prompt_type}/{variant}.txt"
            with open(path, "r", encoding="utf-8") as f:
                self._cache[cache_key] = f.read()
        return self._cache[cache_key]
    
    def _format_memories(self, memories: list[MemoryContext]) -> str:
        if not memories:
            return "No prior memory about the child."
        lines = [f"- {m.key}: {m.value}" for m in memories]
        return "\n".join(lines)
```

### 3.3 Agents

#### PlannerAgent

```python
# core/agents/planner.py

class PlannerAgent:
    """Sinh outline và cấu trúc cho câu chuyện."""
    
    PROMPT_TEMPLATE = """
You are a story planner for Vietnamese children's stories.

Given the following information, create a detailed story outline.
The FINAL STORY must be in Vietnamese (thuần Việt), so plan accordingly.

Child info:
- Name: {child_name}
- Age: {age}
- Theme: {theme}
- Lesson goal: {goal}

Outline requirements:
1. Opening: introduce the main character (the child's name) and setting
2. 4-5 logically ordered sections
3. At least 1 interaction point for the child
4. A warm ending with a moral/lesson
5. Key characters should include the child's name as the protagonist

Return JSON (titles and descriptions in Vietnamese):
{{
  "title": "Story title in Vietnamese (thuần Việt)",
  "story_structure": {{
    "opening": "Opening description in Vietnamese",
    "sections": [{{ "order": int, "type": "opening|context|conflict|interaction|resolution", "description": "Vietnamese description" }}],
    "moral": "Bài học in Vietnamese",
    "key_characters": ["Main character named '{child_name}'", "other characters"]
  }}
}}
"""
    
    def __init__(self, llm_client, prompt_registry):
        self.llm = llm_client
        self.prompts = prompt_registry
    
    async def generate_outline(self, child_name, age, theme, goal, mood, memories=None) -> dict | None:
        system_prompt = self.prompts.get_system_prompt()
        user_prompt = self.prompts.build_user_prompt(UserContext(
            child_name=child_name, age=age, theme=theme,
            goal=goal, mood=mood, memories=memories,
        ))
        planner_prompt = self.PROMPT_TEMPLATE.format(
            child_name=child_name, age=age, theme=theme, goal=goal or "không có",
        )
        
        response = await self.llm.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"{user_prompt}\n\n{planner_prompt}"},
            ],
            response_format={"type": "json_object"},
        )
        
        return self._parse_and_validate(response)
    
    def _parse_and_validate(self, response) -> dict | None:
        try:
            data = json.loads(response)
            # Validate required fields
            if not data.get("title") or not data.get("story_structure"):
                return None
            sections = data["story_structure"].get("sections", [])
            if len(sections) < 4:
                return None
            return data
        except (json.JSONDecodeError, KeyError):
            return None
```

#### WriterAgent

```python
# core/agents/writer.py

class WriterAgent:
    """Viết câu chuyện dựa trên outline từ Planner."""
    
    WRITER_PROMPT = """
Based on the outline below, write a complete children's story.

THE STORY MUST BE WRITTEN IN VIETNAMESE (thuần Việt).
Use gentle, image-rich language appropriate for a {age}-year-old.

OUTLINE:
{outline_json}

ADDITIONAL INFO:
- Child name: {child_name}
- Age: {age}
- Theme: {theme}
- Lesson: {goal}
- Mood: {mood}

REQUIREMENTS:
1. Every section must have content appropriate for the child's age
2. Each "interaction" section MUST include a "prompt" field — a question in Vietnamese for the child
3. Total: 300-500 words, pure Vietnamese
4. Tone: gentle, warm, rich in imagery with từ láy
5. The child's name ({child_name}) is the main character

Return JSON:
{{
  "title": "string (in Vietnamese)",
  "content": [
    {{ "type": "opening|context|conflict|interaction|resolution", "text": "Vietnamese story text", "prompt?": "Vietnamese question (for interaction only)", "order": int }}
  ],
  "word_count": int
}}
"""
    
    async def write_story(self, outline, child_name, age, theme, goal, mood, memories=None) -> dict | None:
        # Implementation tương tự PlannerAgent
        ...
    
    async def write_story_with_feedback(self, outline, review_feedback: list, **kwargs) -> dict | None:
        """Rewrite story with review feedback context."""
        feedback_text = "\n".join([f"- {f['detail']}" for f in review_feedback])
        # Append feedback to prompt
        ...
```

#### ReviewerAgent

```python
# core/agents/reviewer.py

class ReviewerAgent:
    """Review câu chuyện — safety + quality check."""
    
    REVIEWER_SYSTEM_PROMPT = """
You are a content reviewer for Vietnamese children's bedtime stories.

YOUR TASKS:
1. Safety check: does the content violate any prohibited rules?
2. Quality check: is it appropriate for children aged 3-6?
3. Structure check: does it have all required sections, an ending?
4. Language check: is the Vietnamese pure (thuần Việt) and child-appropriate?

PROHIBITED CONTENT:
- Violence, blood, gore, horror
- Sexual content, adult themes
- Profanity or coarse language
- Politics, religion
- Advertising

NOTE: The story content itself is in Vietnamese. Your review response should be in English.

Return JSON:
{{
  "safety_verdict": "APPROVED|REJECTED|FLAGGED",
  "issues": [{{ "type": "violence|content|format|age_appropriateness", "severity": "low|medium|high", "detail": "string (describe in English)" }}],
  "quality_score": int (1-5),
  "suggestions": ["string (in English or Vietnamese as appropriate)"]
}}
"""
    
    async def review_story(self, story: dict) -> ReviewResult | None:
        response = await self.llm.chat(
            messages=[
                {"role": "system", "content": "You are a children's story safety reviewer. The story content is in Vietnamese. Review it against the safety rules and return a JSON verdict."},
                {"role": "user", "content": json.dumps(story, ensure_ascii=False)},
            ],
            response_format={"type": "json_object"},
        )
        return self._parse(response)
    
    def _parse(self, response) -> ReviewResult | None:
        # Parse + validate schema
        ...
```

#### MemoryExtractor

```python
# core/agents/memory_extractor.py

class MemoryExtractor:
    """Trích xuất memory từ story content sau khi approved."""
    
    EXTRACT_PROMPT = """
From the following Vietnamese children's story, extract information that can
be used to personalize future stories.

Story content (in Vietnamese): {story_content}
Child's name: {child_name}
Theme: {theme}

Only extract information that:
- Has value for future storytelling sessions
- Is durable (not temporary/one-time)
- Is not overly sensitive/private

The story itself is in Vietnamese, but your extracted values should be
in Vietnamese (the original language from the story).

Return JSON:
{{
  "memories": [
    {{
      "type": "interest|character|theme|behavior",
      "key": "string (e.g., favorite_animal, preferred_theme)",
      "value": "string (in Vietnamese, e.g., thỏ trắng, công chúa)",
      "confidence": float (0.0-1.0)
    }}
  ]
}}

Only return memories with confidence >= 0.3.
"""
    
    async def extract(self, story: dict, child_name: str, theme: str) -> list:
        response = await self.llm.chat(
            messages=[
                {"role": "system", "content": "You are a memory extraction specialist. Extract durable, useful information from Vietnamese children's stories for personalization. Output keys in English, values in Vietnamese."},
                {"role": "user", "content": self.EXTRACT_PROMPT.format(
                    story_content=json.dumps(story, ensure_ascii=False),
                    child_name=child_name,
                    theme=theme,
                )},
            ],
            response_format={"type": "json_object"},
        )
        
        try:
            data = json.loads(response)
            return [
                m for m in data.get("memories", [])
                if m.get("confidence", 0) >= 0.3
            ]
        except (json.JSONDecodeError, KeyError):
            return []
```

### 3.4 Output Validator

```python
# core/validation/validator.py

class OutputValidator:
    """Validate và auto-fix output từ LLM."""
    
    REQUIRED_SECTION_TYPES = {"opening", "resolution"}
    MAX_SECTION_COUNT = 7
    MIN_SECTION_COUNT = 3
    MIN_WORD_COUNT = 100
    
    # Safety blocklist
    BLOCKED_PATTERNS = [
        r"\b(giết|chết|đánh|đấm|máu|chửi|đụ|đĩ|sex|khỏa thân)\b",
        r"http[s]?://",
    ]
    
    def validate(self, story: dict) -> ValidationResult:
        issues = []
        
        # Check title
        if not story.get("title"):
            issues.append(Issue("title_missing", severity="high"))
        
        # Check content
        content = story.get("content", [])
        if not content:
            issues.append(Issue("content_empty", severity="high"))
            return ValidationResult(False, issues)
        
        # Check required section types
        types = {s["type"] for s in content}
        missing = self.REQUIRED_SECTION_TYPES - types
        if missing:
            issues.append(Issue(f"missing_sections: {missing}", severity="medium"))
        
        # Check section count
        if len(content) < self.MIN_SECTION_COUNT:
            issues.append(Issue(f"too_few_sections: {len(content)}", severity="high"))
        elif len(content) > self.MAX_SECTION_COUNT:
            issues.append(Issue(f"too_many_sections: {len(content)}", severity="low"))
        
        # Check interaction points
        interactions = [s for s in content if s["type"] == "interaction"]
        if interactions:
            for i, sec in enumerate(interactions):
                if not sec.get("prompt"):
                    issues.append(Issue(f"interaction_{i}_no_prompt", severity="medium"))
        
        # Check word count
        total_words = sum(len(s.get("text", "").split()) for s in content)
        if total_words < self.MIN_WORD_COUNT:
            issues.append(Issue(f"too_short: {total_words} words", severity="medium"))
        
        # Safety scan
        full_text = json.dumps(story, ensure_ascii=False)
        for pattern in self.BLOCKED_PATTERNS:
            if re.search(pattern, full_text, re.IGNORECASE):
                issues.append(Issue(f"safety_violation: matched '{pattern}'", severity="high"))
        
        has_safety = any(i.severity == "high" and "safety" in i.message for i in issues)
        return ValidationResult(
            is_valid=len([i for i in issues if i.severity == "high"]) == 0,
            issues=issues,
            has_safety_issue=has_safety,
        )
    
    def auto_fix(self, story: dict) -> dict:
        """Auto-fix các lỗi format nhỏ (không fix safety)."""
        fixed = deepcopy(story)
        
        # Ensure all sections have 'order'
        content = fixed.get("content", [])
        for i, sec in enumerate(content):
            sec["order"] = i
            if sec["type"] == "interaction" and "prompt" not in sec:
                sec["prompt"] = "Con nghĩ sao?"
        
        # Remove null/empty sections
        fixed["content"] = [s for s in content if s.get("text")]
        
        return fixed
```

---

## 4. ⚡ Language Policy: English Prompt → Vietnamese Output

**Nguyên tắc cốt lõi:**

```
┌────────────────────────────────────────────┐
│  ALL instruction prompts = ENGLISH         │
│  (system, developer, planner, writer,      │
│   reviewer, extractor — every instruction) │
├────────────────────────────────────────────┤
│  ALL story output = VIETNAMESE (thuần Việt) │
│  (story content, titles, interaction       │
│   prompts for the child, memory values)    │
├────────────────────────────────────────────┤
│  Reviewer verdict = ENGLISH                │
│  (safety_verdict, issue descriptions)      │
└────────────────────────────────────────────┘
```

**Lý do:**
1. LLM instruction bằng English → accuracy cao hơn, ít ambiguous
2. Output tiếng Việt → đúng target audience (trẻ em Việt Nam)
3. Tách biệt instruction language khỏi content language → tránh leak
4. Dễ maintain prompt hơn (English prompt ecosystem lớn hơn)

**Quy tắc trong code:**
- `.format()` trong prompt template: variables chứa tiếng Việt (child_name, theme...)
- Header/section labels trong prompt: English
- Output schema field descriptions: English
- Story content fields: Vietnamese (the actual generated story)

## 5. Prompt Template Files

### Thư mục templates

```
core/prompts/templates/
├── system/
│   ├── default.txt          # System prompt mặc định
│   └── reviewer.txt         # System prompt cho reviewer
├── developer/
│   ├── 3-4.txt              # Developer prompt cho bé 3-4 tuổi
│   └── 5-6.txt              # Developer prompt cho bé 5-6 tuổi
└── user/
    └── default.txt          # User prompt template
```

### system/default.txt

```
You are a Vietnamese children's bedtime storyteller, specialized in creating
personalized stories for children aged 3-6.

ROLE:
- A warm, gentle bedtime storyteller
- Target audience: Vietnamese children aged 3-6
- ALL story content MUST be in Vietnamese — pure, simple, beautiful
  Vietnamese suitable for young children

SAFETY RULES (STRICTLY FORBIDDEN):
- No violence, blood, gore, or horror
- No sexual content or adult themes
- No profanity or coarse language
- No gender, racial, or cultural discrimination
- No politics or religion
- No product placement or disguised advertising

VIETNAMESE LANGUAGE RULES:
- Use pure Vietnamese (thuần Việt), simple words a child can understand
- Short sentences, slow rhythm
- Rich in imagery: colors, sounds, emotions
- Use Vietnamese onomatopoeia and reduplicatives (từ láy: rì rào, lấp lánh, êm đềm)
- The child's name MUST be the main character's name throughout the story

OUTPUT FORMAT:
Always respond with valid JSON following the requested schema.
Never include text outside the JSON block. Do not wrap in markdown code fences.
```

### developer/3-4.txt

```
STORYTELLING STRATEGY FOR CHILDREN AGED 3-4:

1. STRUCTURE:
   - Opening: "Ngày xửa ngày xưa..." (Once upon a time) or similar classic opener
   - Main character = the child's name (repeated throughout)
   - Simple situation, easy to follow
   - 2-3 short sections (3-5 sentences each)
   - 1 simple interaction point (yes/no question)
   - Warm ending, may include a light lesson

2. LANGUAGE (MUST BE VIETNAMESE — thuần Việt):
   - 5-8 words per sentence, avoid complex sentences
   - Basic, concrete vocabulary
   - Repeat sentence patterns so the child can follow
   - Rich imagery: colors, animal sounds, nature

3. LENGTH: 200-300 words total

4. INTERACTION:
   - Simple question: "Con có thấy bạn thỏ dễ thương không?" (Do you think the bunny is cute?)
   - Allow pause for child to answer before continuing
```

### developer/5-6.txt

```
STORYTELLING STRATEGY FOR CHILDREN AGED 5-6:

1. STRUCTURE:
   - Opening with clear setting and context
   - Main character = the child's name (throughout)
   - Gentle conflict (losing something, getting lost, helping a friend)
   - 4-5 sections
   - 2 interaction points (open-ended questions)
   - Ending with a clear moral lesson linked to the parent's goal

2. LANGUAGE (MUST BE VIETNAMESE — thuần Việt):
   - 7-12 words per sentence
   - Richer vocabulary appropriate for older preschoolers
   - May use simple compound sentences
   - Use Vietnamese reduplicatives (từ láy) for vividness

3. LENGTH: 350-500 words total

4. INTERACTION:
   - Open-ended: "Con nghĩ bạn ấy sẽ làm gì tiếp theo?" (What do you think they'll do next?)
   - Encourage the child to think and predict
```

---

## 6. Mastra Integration (Optional)

Nếu dùng Mastra.ai thay vì custom Python:

```python
# mastra/workflows/story_generation.py
from mastra import Workflow, step

story_workflow = Workflow("story-generation")

@step()
async def planner_step(context):
    outline = await planner_agent.generate(context.input)
    return {"outline": outline}

@step()
async def writer_step(context):
    story = await writer_agent.write(context.prev.outline)
    return {"story": story}

@step()
async def reviewer_step(context):
    review = await reviewer_agent.review(context.prev.story)
    return {"review": review}

@step()
async def memory_step(context):
    memories = await memory_agent.extract(context.prev.story)
    return {"memories": memories}

story_workflow.add(planner_step)
story_workflow.add(writer_step)
story_workflow.add(reviewer_step)
story_workflow.add(memory_step)
```

---

## 7. Configuration

```python
# config.py

class EngineConfig:
    # LLM
    llm_provider: str = "openai"  # | "anthropic"
    llm_model: str = "gpt-4o-mini"  # cost-effective for MVP
    llm_temperature: float = 0.7
    llm_max_tokens: int = 2000
    
    # Pipeline
    planner_retries: int = 2
    writer_retries: int = 2
    reviewer_retries: int = 1
    stage_timeout_ms: int = 30000  # 30s per LLM call
    
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
```

---

## 8. API Contract (FastAPI)

```python
# main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Bedtime Story Engine")

class GenerateRequest(BaseModel):
    child_name: str
    age: int
    theme: str
    goal: str | None = None
    mood: str | None = None
    memories: list[MemoryContext] | None = None
    recent_stories: list[StorySummary] | None = None
    tenant_id: str

class GenerateResponse(BaseModel):
    request_id: str
    title: str
    content: list[StorySection]
    structure: dict | None = None
    safety_status: str
    memories: list[ExtractedMemory] = []
    llm_calls: int
    retry_count: int
    latency_ms: int
    word_count: int
    is_fallback: bool

@app.post("/generate", response_model=GenerateResponse)
async def generate_story(req: GenerateRequest):
    orchestrator = StoryOrchestrator(...)
    return await orchestrator.generate(
        child_name=req.child_name,
        age=req.age,
        theme=req.theme,
        goal=req.goal,
        mood=req.mood,
        memories=req.memories,
        recent_stories=req.recent_stories,
    )
```

---

## 9. LLM Client Abstraction

```python
# core/llm/client.py

class LLMClient(ABC):
    @abstractmethod
    async def chat(
        self,
        messages: list[dict],
        response_format: dict | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> str: ...

class OpenAIClient(LLMClient):
    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        self.client = OpenAI(api_key=api_key)
        self.model = model
    
    async def chat(self, messages, response_format=None, temperature=0.7, max_tokens=2000):
        kwargs = dict(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if response_format:
            kwargs["response_format"] = response_format
        
        response = await self.client.chat.completions.create(**kwargs)
        return response.choices[0].message.content

class AnthropicClient(LLMClient):
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514"):
        self.client = Anthropic(api_key=api_key)
        self.model = model
    
    async def chat(self, messages, response_format=None, temperature=0.7, max_tokens=2000):
        # Convert OpenAI-style messages to Anthropic format
        system = None
        anthropic_messages = []
        for m in messages:
            if m["role"] == "system":
                system = m["content"]
            else:
                anthropic_messages.append(m)
        
        response = await self.client.messages.create(
            model=self.model,
            system=system,
            messages=anthropic_messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.content[0].text
```

---

## 10. Error Handling Strategy

| Situation | Behavior | User sees |
|---|---|---|
| LLM timeout | Retry 2x | Story generation |
| LLM invalid JSON | Retry 2x | Story generation |
| Safety violation | Reject, fallback | "Fallback story" |
| All retries exhausted | Return fallback | "Hãy thử lại sau" |
| Memory extract fail | Skip memory, continue | Story OK |
| Reviewer fail | Approve with warning | Story OK |
