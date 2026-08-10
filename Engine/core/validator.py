import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

# The only lexical content gate in the system. It is not a classifier and does
# not pretend to be one -- the reviewer LLM is the semantic layer. What this
# catches is the blunt case: a story, or a request, that names the thing
# outright.
#
# Two gaps closed here that the OWASP review called out (LLM09):
#
#   * The list had "sát hại" and "chết" but not "giết", which is the ordinary
#     Vietnamese verb -- the one word a real request would use. The additions
#     below fill in the everyday register alongside the formal one, and cover
#     self-harm, sexual content, substances and horror, which had one token
#     each or none.
#   * Matching was `word in text.lower()` on the raw string, so `ｋｉｌｌ`
#     passed (fullwidth), and `dao` fired on `dao động`. Matching now runs on
#     NFKC-folded text at word boundaries -- see `_blocklist_pattern`.
BLOCKLIST_WORDS = [
    # English
    "sex", "sexual", "porn", "nude", "naked", "erotic", "nsfw", "rape",
    "violence", "blood", "kill", "murder", "death", "corpse", "behead",
    "stab", "shoot", "torture", "abuse", "terrorist", "kidnap",
    "weapon", "gun", "knife", "drug", "heroin", "cocaine", "alcohol",
    "cigarette", "gambling", "suicide", "self-harm", "demon", "devil",
    # Vietnamese -- violence and death
    "máu", "chết", "giết", "sát hại", "đâm chém", "chém giết", "bạo lực",
    "tra tấn", "hành hạ", "đánh nhau", "thi thể", "xác chết", "đầu độc",
    "khủng bố", "bắt cóc", "súng", "dao", "vũ khí",
    # Vietnamese -- self-harm
    "tự tử", "tự sát", "tự hại",
    # Vietnamese -- sexual
    "khiêu dâm", "ấu dâm", "hiếp dâm", "cưỡng hiếp", "khỏa thân",
    "trần truồng", "gợi dục",
    # Vietnamese -- substances and vice
    "hút thuốc", "thuốc lá", "rượu", "bia rượu", "ma túy", "cần sa",
    "nghiện", "cờ bạc", "cá độ",
    # Vietnamese -- horror and hate
    "kinh dị", "ma quỷ", "quỷ dữ", "kỳ thị", "phân biệt", "đả kích",
    "thù hận",
]


def _blocklist_pattern(words: list[str]) -> re.Pattern:
    """One alternation, anchored at word boundaries.

    `(?<!\\w)`/`(?!\\w)` rather than `\\b` because several entries end in a
    non-word character (`self-harm`) where `\\b` anchors in the wrong place.
    Longest-first so `sát hại` is reported instead of a shorter overlap.
    """
    ordered = sorted(words, key=len, reverse=True)
    alternation = "|".join(re.escape(w) for w in ordered)
    return re.compile(rf"(?<!\w)(?:{alternation})(?!\w)", re.IGNORECASE)


_BLOCKLIST_RE = _blocklist_pattern(BLOCKLIST_WORDS)

REQUIRED_SECTION_TYPES = {"opening", "context", "conflict", "resolution"}
OPTIONAL_SECTION_TYPES = {"interaction_1", "interaction_2", "interaction_3", "interaction", "moral"}

# Stories are Vietnamese only. English is out of scope until MVP 2.1, which is
# what makes an English word in the output a defect rather than a preference:
# nothing here is written to review an English story, so one that arrives half
# in English is half unreviewed.
#
# High-frequency function words plus the vocabulary a bedtime story reaches for.
# Function words are the useful signal -- a model that drifts into English
# drifts there in whole clauses, and "the"/"and"/"with" appear in essentially
# every one, while a lone borrowed noun (`robot`, `pizza`) is ordinary
# Vietnamese and deliberately absent.
ENGLISH_LEAK_BLOCKLIST = [
    # function words
    "the", "and", "but", "because", "very", "really", "also", "then",
    "when", "what", "who", "why", "how", "this", "that", "these", "those",
    "they", "them", "their", "where", "there", "here", "with", "without",
    "from", "into", "about", "for", "was", "were", "are", "have", "has",
    "had", "will", "would", "could", "should", "not", "you", "your",
    # bedtime-story vocabulary
    "story", "character", "friend", "happy", "sad", "love", "night",
    "sleep", "dream", "moon", "star", "forest", "magic",
    "big", "small", "little", "good", "bad", "nice", "beautiful",
    "start", "end", "once", "upon", "time", "said", "went", "came",
]

# `str(data)` of the writer's payload carries the JSON scaffolding -- key names
# like `title`, `content`, `type`, `order`, and section labels like `opening`
# and `resolution`. Those are English words the model was *instructed* to emit,
# so a purity check that reads them is checking our own schema. It survived
# only because no key happened to collide with the list above; adding a section
# type called `the-end` would have made every story fail. The check now runs on
# the prose alone, which is what a reader would ever see.
STORY_TEXT_FIELDS = ("title", "text", "prompt", "moral")


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str] = field(default_factory=list)
    fixed_data: dict | None = None


def _not_an_object(stage: str, data: Any) -> ValidationResult:
    """A parsed payload that is not a JSON object is a rejected attempt.

    extract_json_block returns the first JSON block it finds, which is a list
    whenever the model answers with a bare array or puts one ahead of the
    object. Reaching into it with .get() raised AttributeError/ValueError out
    of the validator, so the caller saw an internal error rather than an
    invalid response -- and could not report which stage produced it.
    """
    return ValidationResult(
        valid=False,
        errors=[f"{stage} must return a JSON object, got {type(data).__name__}"],
    )


class OutputValidator:
    def validate_planner(self, data: Any) -> ValidationResult:
        if not isinstance(data, dict):
            return _not_an_object("planner", data)

        errors = []

        if not data.get("title"):
            errors.append("title is required")

        data = self._normalize_planner(data)
        structure = data.get("story_structure")
        if not structure:
            errors.append("story_structure is required")
        else:
            sections = structure.get("sections", [])
            if len(sections) < 2:
                errors.append("at least 2 sections required")
            if not structure.get("moral"):
                errors.append("moral is required")

        return ValidationResult(valid=len(errors) == 0, errors=errors, fixed_data=data)

    def _normalize_planner(self, data: dict) -> dict:
        """Map the shape real reasoning models actually return into the
        internal story_structure schema.

        opencode (via the local proxy) responds with `steps` + `lesson`
        instead of `story_structure.sections` + `story_structure.moral`.
        Accept that shape rather than failing validation and falling back.
        """
        if data.get("story_structure"):
            return data

        steps = data.get("steps")
        if not steps or not isinstance(steps, list) or len(steps) < 2:
            return data

        sections = []
        type_map = {
            "mở đầu": "opening",
            "bối cảnh": "context",
            "xung đột": "conflict",
            "cao trào": "climax",
            "kết thúc": "resolution",
            "bài học": "moral",
        }
        for order, step in enumerate(steps):
            label = (step.get("step") or "").strip().lower() if isinstance(step, dict) else ""
            sections.append({
                "order": order,
                "type": type_map.get(label, "context"),
                "description": step.get("content", "") if isinstance(step, dict) else str(step),
            })

        fixed = dict(data)
        fixed["story_structure"] = {
            "sections": sections,
            "moral": data.get("lesson") or sections[-1].get("description", ""),
            "key_characters": data.get("key_characters", []),
        }
        return fixed

    def validate_writer(self, data: Any) -> ValidationResult:
        if not isinstance(data, dict):
            return _not_an_object("writer", data)

        errors = []
        data = self._auto_fix(data)

        if not data.get("title"):
            errors.append("title is required")

        content = data.get("content", [])
        if not content:
            errors.append("content is required")
        else:
            types = [s.get("type") for s in content]
            if "interaction" not in types:
                errors.append("at least 1 interaction section required")

        if data.get("word_count", 0) < 100:
            errors.append(f"word_count too low: {data.get('word_count')}")

        full_text = str(data)
        if self.has_blocklist_word(full_text):
            errors.append("content contains blocked words")

        return ValidationResult(valid=len(errors) == 0, errors=errors, fixed_data=data)

    def validate_sections(self, sections: list[dict]) -> ValidationResult:
        """Validate that required section types are present."""
        errors = []
        present_types = {s.get("type") for s in sections if s.get("type")}
        missing = REQUIRED_SECTION_TYPES - present_types
        if missing:
            errors.append(f"Missing required sections: {', '.join(sorted(missing))}")
        for idx, s in enumerate(sections):
            if not s.get("type"):
                errors.append(f"Section {idx}: missing 'type'")
            if not s.get("text") and s.get("type") not in OPTIONAL_SECTION_TYPES:
                errors.append(f"Section {idx} ({s.get('type')}): missing 'text'")
        return ValidationResult(valid=len(errors) == 0, errors=errors)

    def find_blocklist_word(self, text: str) -> str:
        """The first blocked term in `text`, or "" if there is none.

        NFKC first, for the same reason `core.prompts.sanitize` does it: a
        model reads `ｋｉｌｌ` as `kill`, so a gate that reads it as five
        unrelated compatibility codepoints is not gating anything. Returned
        rather than a bool so a rejection can say which word it objected to.
        """
        folded = unicodedata.normalize("NFKC", text or "")
        match = _BLOCKLIST_RE.search(folded)
        return match.group(0).lower() if match else ""

    def has_blocklist_word(self, text: str) -> bool:
        return bool(self.find_blocklist_word(text))

    @staticmethod
    def story_text(data: Any) -> str:
        """Just the prose: the title, the section bodies, the interaction lines.

        Everything a child would hear, and nothing a schema made us write. See
        STORY_TEXT_FIELDS for why reading the raw payload was wrong.
        """
        parts: list[str] = []

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if key in STORY_TEXT_FIELDS and isinstance(value, str):
                        parts.append(value)
                    else:
                        walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(data)
        return "\n".join(parts)

    def check_vietnamese_purity(self, text: str) -> ValidationResult:
        """English words in the story prose.

        `\\b[a-zA-Z]{3,}\\b` matches undecorated Latin runs, so Vietnamese words
        that carry any diacritic never reach the comparison at all. Words that
        do not -- `con`, `bao`, `hoa` -- are compared against a list of English
        words, which none of them are on.
        """
        errors = []
        words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
        found = {w for w in words if w in ENGLISH_LEAK_BLOCKLIST}
        if found:
            errors.append(f"Có từ tiếng Anh trong truyện: {', '.join(sorted(found)[:10])}")
        return ValidationResult(valid=len(errors) == 0, errors=errors)

    def check_section_depth(self, sections: list[dict]) -> ValidationResult:
        errors = []
        for s in sections:
            text = s.get("text", "")
            # Measured 2026-08-05: the anonymous free tier (oc/deepseek-v4-flash-free,
            # 21s, valid JSON, 10 sections) writes every section as ONE paragraph,
            # so min 2 made the writer fail 100% of runs and fall back. A
            # single-paragraph section is still a complete short story; the writer
            # template keeps asking for 2-3 where the model can comply.
            paragraphs = [p for p in text.split("\n\n") if p.strip()]
            if s.get("type") in REQUIRED_SECTION_TYPES and len(paragraphs) < 1:
                errors.append(f"Section '{s.get('type')}' has {len(paragraphs)} paragraph(s), minimum 1")
        return ValidationResult(valid=len(errors) == 0, errors=errors)

    def _auto_fix(self, data: dict) -> dict:
        fixed = dict(data)
        if fixed.get("title"):
            fixed["title"] = fixed["title"].strip()
        content = fixed.get("content", [])
        if content:
            for section in content:
                if "text" in section:
                    section["text"] = section["text"].strip()
        return fixed
