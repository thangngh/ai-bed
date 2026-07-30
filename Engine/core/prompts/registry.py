import json
import os
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent / "templates"


class PromptRegistry:
    def __init__(self):
        self.templates_dir = TEMPLATES_DIR

    def load_system(self) -> str:
        path = self.templates_dir / "system" / "default.txt"
        return path.read_text(encoding="utf-8")

    def load_developer(self, age: int) -> str:
        """Load age-appropriate developer prompt."""
        candidates = [
            f"{age}.txt",
            "3-4.txt" if age <= 4 else "5-6.txt",
        ]
        for name in candidates:
            path = self.templates_dir / "developer" / name
            if path.exists():
                return path.read_text(encoding="utf-8")
        return self.load_developer(3)

    def load_user(self) -> str:
        path = self.templates_dir / "user" / "default.txt"
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

    def assemble(self, age: int, data: dict) -> dict[str, str]:
        """Build all three prompt tiers."""
        user_template = self.load_user()
        # Ensure all expected keys exist with defaults
        defaults = {"gender": "unspecified", "favoriteCharacter": ""}
        for k, v in defaults.items():
            data.setdefault(k, v)
        user_prompt = user_template.format(**data)

        return {
            "system": self.load_system(),
            "developer": self.load_developer(age),
            "user": user_prompt,
        }
