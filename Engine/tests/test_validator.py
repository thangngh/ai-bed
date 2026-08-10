import pytest
from core.validator import OutputValidator


class TestOutputValidator:
    def test_valid_planner_output(self):
        validator = OutputValidator()
        data = {
            "title": "Câu chuyện của bé",
            "story_structure": {
                "opening": "Mở đầu",
                "sections": [
                    {"order": 0, "type": "opening", "description": "..."},
                    {"order": 1, "type": "resolution", "description": "..."},
                ],
                "moral": "Bài học",
                "key_characters": ["Bé An"]
            }
        }
        result = validator.validate_planner(data)
        assert result.valid is True
        assert len(result.errors) == 0

    def test_invalid_planner_missing_title(self):
        validator = OutputValidator()
        data = {"story_structure": {"sections": []}}
        result = validator.validate_planner(data)
        assert result.valid is False

    def test_planner_accepts_real_model_steps_shape(self):
        """The opencode reasoning model returns steps/lesson instead of
        story_structure/moral. Validation must normalize that shape and pass."""
        validator = OutputValidator()
        data = {
            "title": "Bé An và chú thỏ dũng cảm",
            "child_name": "An",
            "theme": "động vật",
            "lesson": "dũng cảm",
            "steps": [
                {"step": "mở đầu", "content": "Trời chiều êm ả"},
                {"step": "bối cảnh", "content": "Bé An gặp chú thỏ"},
                {"step": "xung đột", "content": "Thỏ con sợ"},
                {"step": "kết thúc", "content": "Bé An giúp thỏ"},
            ],
            "interaction_points": [
                {"position": "sau khi thỏ nói sợ", "question": "Con nghĩ sao?"}
            ],
        }
        result = validator.validate_planner(data)
        assert result.valid is True
        structure = result.fixed_data.get("story_structure", {})
        assert len(structure.get("sections", [])) >= 2
        assert structure.get("moral") == "dũng cảm"

    def test_valid_writer_output(self):
        validator = OutputValidator()
        data = {
            "title": "Truyện hay",
            "content": [
                {"type": "opening", "text": "Nội dung tiếng Việt", "order": 0},
                {"type": "interaction", "text": "Hỏi bé điều gì", "prompt": "Con nghĩ sao?", "order": 1},
                {"type": "resolution", "text": "Kết thúc", "order": 2},
            ],
            "word_count": 200
        }
        result = validator.validate_writer(data)
        assert result.valid is True

    def test_writer_too_short(self):
        validator = OutputValidator()
        data = {
            "title": "Truyện",
            "content": [{"type": "opening", "text": "Ngắn", "order": 0}],
            "word_count": 20
        }
        result = validator.validate_writer(data)
        assert result.valid is False

    def test_safety_blocklist(self):
        validator = OutputValidator()
        assert validator.has_blocklist_word("nội dung bình thường") is False
        assert validator.has_blocklist_word("nội dung sex") is True

    def test_validate_sections_missing_required(self):
        validator = OutputValidator()
        sections = [
            {"type": "opening", "text": "Mở đầu", "order": 0},
        ]
        result = validator.validate_sections(sections)
        assert not result.valid
        assert any("context" in e for e in result.errors)

    def test_validate_sections_complete(self):
        validator = OutputValidator()
        sections = [
            {"type": "opening", "text": "A", "order": 0},
            {"type": "context", "text": "B", "order": 1},
            {"type": "conflict", "text": "C", "order": 2},
            {"type": "resolution", "text": "D", "order": 3},
        ]
        result = validator.validate_sections(sections)
        assert result.valid

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

    def test_section_depth_empty_fails(self):
        # The floor is one non-empty paragraph: the free tier writes single-
        # paragraph sections (measured), which is still a complete story.
        validator = OutputValidator()
        sections = [
            {"type": "opening", "text": ""},
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


class TestNonObjectPayloads:
    """extract_json_block returns the first JSON block, which may be a list.

    A model that answers with a bare array -- or with prose containing a
    bracketed list before the object -- used to crash the validator with
    "'list' object has no attribute 'get'". That AttributeError is not a
    validation result: it escapes as an internal error instead of a rejected
    attempt, so the caller cannot tell a bad payload from a broken validator.
    """

    def test_planner_rejects_a_list_payload(self):
        result = OutputValidator().validate_planner([{"title": "Test"}])
        assert result.valid is False
        assert result.errors

    def test_writer_rejects_a_list_payload(self):
        result = OutputValidator().validate_writer([{"type": "opening"}])
        assert result.valid is False
        assert result.errors
