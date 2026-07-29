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
