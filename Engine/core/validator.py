import re
from dataclasses import dataclass, field
from typing import Any

BLOCKLIST_WORDS = [
    "sex", "porn", "violence", "blood", "kill", "death",
    "weapon", "gun", "drug", "suicide", "demon", "devil",
    "máu", "chết", "súng", "dao", "đánh nhau",
    "hút thuốc", "rượu", "ma túy", "sát hại", "bạo lực",
    "cấm", "kỳ thị", "phân biệt", "đả kích", "thù hận",
]

REQUIRED_SECTION_TYPES = {"opening", "context", "conflict", "resolution"}
OPTIONAL_SECTION_TYPES = {"interaction_1", "interaction_2", "interaction_3", "interaction", "moral"}

ENGLISH_LEAK_BLOCKLIST = [
    "the", "and", "but", "because", "very", "really", "also",
    "story", "character", "friend", "happy", "sad", "love",
    "big", "small", "little", "good", "bad", "nice", "beautiful",
    "start", "end", "once", "upon", "time", "they", "them",
    "their", "where", "there", "here", "with", "without",
]


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str] = field(default_factory=list)
    fixed_data: dict | None = None


class OutputValidator:
    def validate_planner(self, data: dict) -> ValidationResult:
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

    def validate_writer(self, data: dict) -> ValidationResult:
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

    def has_blocklist_word(self, text: str) -> bool:
        text_lower = text.lower()
        return any(word in text_lower for word in BLOCKLIST_WORDS)

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
