import json
import os
from pathlib import Path

from .sanitize import (
    DATA_FENCE_CLOSE,
    DATA_FENCE_OPEN,
    CHARACTER_LIMIT,
    GENDER_LIMIT,
    GOAL_LIMIT,
    MEMORY_CONTEXT_LIMIT,
    MEMORY_VALUE_LIMIT,
    MOOD_LIMIT,
    NAME_LIMIT,
    THEME_LIMIT,
    sanitize_field,
)

TEMPLATES_DIR = Path(__file__).parent / "templates"

# The audience. Not a tuning knob: the developer templates, the system prompt's
# safety rules and every review criterion are written for this band, so an age
# outside it has no reviewed behaviour to fall back on.
MIN_AGE = 3
MAX_AGE = 6

# Per-field caps for the user tier. Every one of these is parent-supplied text
# that ends up in the prompt, so none of them may carry a newline or a fence
# character into the template.
FIELD_LIMITS = {
    "childName": NAME_LIMIT,
    "age": 4,
    "gender": GENDER_LIMIT,
    "theme": THEME_LIMIT,
    "goal": GOAL_LIMIT,
    "mood": MOOD_LIMIT,
    "favoriteCharacter": CHARACTER_LIMIT,
}


class PromptRegistry:
    def __init__(self):
        self.templates_dir = TEMPLATES_DIR

    def load_system(self) -> str:
        path = self.templates_dir / "system" / "default.txt"
        return path.read_text(encoding="utf-8")

    @staticmethod
    def _clamp_age(age) -> int:
        """The audience's age, as an int in 3..6.

        `age` reaches this function from a request body and is then
        interpolated into a *filename*. The request schema bounds it, but this
        is the one place where a value that slipped that bound would stop
        being data and start being a path -- an `age` of `../../../../etc/passwd`
        reads a file, and one of `9` silently selects the wrong safety rules
        for a 3-year-old. Neither is worth leaving to a check in another
        module, so the coercion happens where the risk is.

        Clamping rather than raising: this is the second line, and a story
        told with the 3-4 rules is the safe way to be wrong.
        """
        try:
            value = int(age)
        except (TypeError, ValueError):
            return MIN_AGE
        return max(MIN_AGE, min(MAX_AGE, value))

    def load_developer(self, age: int) -> str:
        """Load age-appropriate developer prompt."""
        safe_age = self._clamp_age(age)
        candidates = [
            f"{safe_age}.txt",
            "3-4.txt" if safe_age <= 4 else "5-6.txt",
            "3-4.txt",
        ]
        for name in candidates:
            path = self.templates_dir / "developer" / name
            if path.exists():
                return path.read_text(encoding="utf-8")
        raise FileNotFoundError(
            f"no developer template for age {safe_age} in {self.templates_dir / 'developer'}"
        )

    def load_user(self) -> str:
        path = self.templates_dir / "user" / "default.txt"
        return path.read_text(encoding="utf-8")

    def load_planner(self) -> str:
        path = self.templates_dir / "planner" / "default.txt"
        return path.read_text(encoding="utf-8")

    def load_writer(self) -> str:
        path = self.templates_dir / "writer" / "default.txt"
        return path.read_text(encoding="utf-8")

    def load_reviewer(self) -> str:
        path = self.templates_dir / "reviewer" / "default.txt"
        return path.read_text(encoding="utf-8")

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
            if not isinstance(m, dict):
                continue
            t = m.get("type", "other")
            by_type.setdefault(t, []).append(m)

        lines = []

        # Memory values are model-written and then stored, so they are the one
        # input an attacker can plant once and have replayed into every later
        # generation. They get the same flattening as a typed-in field.
        def values_of(items: list[dict]) -> list[str]:
            cleaned = (sanitize_field(m.get("value"), MEMORY_VALUE_LIMIT) for m in items)
            return [v for v in cleaned if v]

        interests = sorted(by_type.get("interest", []), key=lambda m: m.get("confidence", 0), reverse=True)[:5]
        if interests:
            values = values_of(interests)
            if values:
                lines.append(f"Known interests: {', '.join(values)}")

        themes = by_type.get("recent_theme", [])[-3:]
        if themes:
            values = values_of(themes)
            if values:
                lines.append(f"Recently enjoyed: {', '.join(values)}")

        prefs = sorted(by_type.get("preference", []), key=lambda m: m.get("confidence", 0), reverse=True)[:3]
        if prefs:
            values = values_of(prefs)
            if values:
                lines.append(f"Character preferences: {', '.join(values)}")

        behaviors = by_type.get("behavior", [])[-2:]
        for b in behaviors:
            value = sanitize_field(b.get("value"), MEMORY_VALUE_LIMIT)
            if value:
                lines.append(f"Behavior note: {value}")

        context = "\n".join(lines)
        # A whole-block cap on top of the per-value one: 20 active memories per
        # child (memory.service.ts) times the value cap is still more prompt
        # than the profile itself.
        if len(context) > MEMORY_CONTEXT_LIMIT:
            context = context[:MEMORY_CONTEXT_LIMIT].rsplit("\n", 1)[0]
        return context

    def assemble(self, age: int, data: dict) -> dict[str, str]:
        """Build all three prompt tiers.

        Every value that reaches the template is flattened first: nothing the
        parent typed and nothing the extractor stored may open a new line, a
        markdown fence, or the data fence the template draws.
        """
        user_template = self.load_user()
        # Ensure all expected keys exist with defaults
        defaults = {"gender": "unspecified", "favoriteCharacter": ""}
        for k, v in defaults.items():
            data.setdefault(k, v)

        # The age the prompt *states* and the age the prompt is *selected by*
        # have to be the same number, or the story is written to one set of
        # rules and labelled with another.
        safe_age = self._clamp_age(age)
        data["age"] = str(safe_age)

        fields = {
            key: sanitize_field(data.get(key), limit)
            for key, limit in FIELD_LIMITS.items()
        }
        memories_raw = data.get("memories", [])
        fields["memoryContext"] = self.build_memory_context(memories_raw) or "(none)"
        # The template draws the fence itself, around the data block only --
        # the "now write a story" line has to stay outside it, or the model is
        # told to disregard its own task.
        user_prompt = user_template.format(
            **fields, dataOpen=DATA_FENCE_OPEN, dataClose=DATA_FENCE_CLOSE
        )

        return {
            "system": self.load_system(),
            "developer": self.load_developer(safe_age),
            "user": user_prompt,
        }
