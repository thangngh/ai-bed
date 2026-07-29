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
