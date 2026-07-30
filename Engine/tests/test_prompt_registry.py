import pytest
from core.prompts.registry import PromptRegistry


class TestPromptRegistry:
    def test_load_system_prompt(self):
        registry = PromptRegistry()
        prompt = registry.load_system()
        assert "Vietnamese" in prompt
        assert "bedtime" in prompt.lower()

    def test_load_developer_prompt_3_4(self):
        registry = PromptRegistry()
        prompt = registry.load_developer(3)
        assert prompt is not None
        assert len(prompt) > 50

    def test_load_developer_prompt_5_6(self):
        registry = PromptRegistry()
        prompt = registry.load_developer(5)
        assert prompt is not None
        assert len(prompt) > 50

    def test_load_user_prompt(self):
        registry = PromptRegistry()
        prompt = registry.load_user()
        assert "Child information" in prompt

    def test_assembly(self):
        registry = PromptRegistry()
        prompts = registry.assemble(age=4, data={"childName": "An", "theme": "rồng", "age": "4", "goal": "", "mood": "vui vẻ", "memories": "[]", "gender": "boy", "favoriteCharacter": "Khủng long Rex"})
        assert "system" in prompts
        assert "developer" in prompts
        assert "user" in prompts
        assert "An" in prompts["user"]
        assert "rồng" in prompts["user"]
        assert "boy" in prompts["user"]
        assert "Khủng long Rex" in prompts["user"]

    def test_build_memory_context_empty(self):
        registry = PromptRegistry()
        assert registry.build_memory_context([]) == ""
        assert registry.build_memory_context("[]") == ""

    def test_build_memory_context_interests(self):
        registry = PromptRegistry()
        memories = [
            {"type": "interest", "value": "khủng long", "confidence": 0.9},
            {"type": "interest", "value": "công chúa", "confidence": 0.7},
        ]
        result = registry.build_memory_context(memories)
        assert "khủng long" in result
        assert "công chúa" in result

    def test_build_memory_context_all_types(self):
        registry = PromptRegistry()
        memories = [
            {"type": "interest", "value": "khủng long", "confidence": 0.9},
            {"type": "recent_theme", "value": "Động vật"},
            {"type": "preference", "value": "Gấu Pooh", "confidence": 0.8},
            {"type": "behavior", "value": "Thích câu chuyện có tương tác"},
        ]
        result = registry.build_memory_context(memories)
        assert "khủng long" in result
        assert "Gấu Pooh" in result

    def test_build_memory_context_from_json_string(self):
        registry = PromptRegistry()
        json_str = '[{"type": "interest", "value": "rồng", "confidence": 0.8}]'
        result = registry.build_memory_context(json_str)
        assert "rồng" in result
