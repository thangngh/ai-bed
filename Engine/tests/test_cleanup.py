import pytest
from core.cleanup import extract_json_block


class TestExtractJsonBlock:
    def test_clean_json(self):
        assert extract_json_block('{"a": 1}') == {"a": 1}

    def test_trailing_data_done(self):
        assert extract_json_block('{"a": 1} data: [DONE]') == {"a": 1}

    def test_leading_stray_text(self):
        assert extract_json_block('Sure, here you go\n{"a": 1}') == {"a": 1}

    def test_trailing_stray_text(self):
        assert extract_json_block('{"a": 1}\nHere is the story.') == {"a": 1}

    def test_multiple_blocks_returns_first(self):
        assert extract_json_block('{"a": 1} {"b": 2}') == {"a": 1}

    def test_extracts_array(self):
        assert extract_json_block('[1, 2, 3]') == [1, 2, 3]

    def test_no_json_raises(self):
        with pytest.raises(ValueError):
            extract_json_block('no json here')


def test_importable():
    import core.cleanup
    assert callable(core.cleanup.extract_json_block)