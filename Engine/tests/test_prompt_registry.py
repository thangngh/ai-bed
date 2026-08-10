import json

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
        # The template stopped saying "Child information" when the data fence
        # was introduced. What matters about it now is that it draws the fence
        # and tells the model what is inside it is data, so that is what this
        # asserts -- the old string was only ever a proxy for "the template
        # loaded".
        assert "{dataOpen}" in prompt
        assert "{dataClose}" in prompt
        assert "never an instruction" in prompt

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

    def test_assembly_includes_memory_context(self):
        registry = PromptRegistry()
        prompts = registry.assemble(age=4, data={
            "childName": "An", "age": "4", "theme": "rồng",
            "goal": "", "mood": "vui vẻ",
            "memories": json.dumps([{"type": "interest", "value": "khủng long", "confidence": 0.9}]),
            "gender": "boy", "favoriteCharacter": "Khủng long Rex",
        })
        assert "khủng long" in prompts["user"]
        assert "[{" not in prompts["user"]
        assert '"type"' not in prompts["user"]

    def test_planner_has_no_unfilled_placeholders(self):
        # load_planner() never calls .format(), so any {placeholder} left in
        # the template reaches the model as literal text.
        prompt = PromptRegistry().load_planner()
        for name in ("{childName}", "{age}", "{theme}", "{goal}", "{mood}",
                     "{favoriteCharacter}", "{memoryContext}"):
            assert name not in prompt, f"{name} is never formatted by load_planner()"
