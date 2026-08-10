"""Stories are Vietnamese only; English is deferred to MVP 2.1.

`check_vietnamese_purity` existed before this and was called on every story,
but `_validate_writer_full` logged its result and returned success anyway --
so an English sentence reached the child and left a warning in a log. These
tests pin the check to a decision rather than a log line.
"""

import json

import pytest

from core.pipeline import StoryPipeline
from core.validator import OutputValidator

VIETNAMESE_STORY = {
    "title": "Chú thỏ và mặt trăng",
    "content": [
        {"type": "opening", "text": "Xin chào bạn nhỏ, đêm nay trời thật êm.", "order": 0},
        {"type": "context", "text": "Ngày xưa có một chú thỏ nhỏ sống ven rừng.", "order": 1},
        {"type": "conflict", "text": "Một đêm chú thỏ lạc mất đường về nhà.", "order": 2},
        {"type": "interaction", "text": "Đố bé nhé", "prompt": "Bé nghĩ chú thỏ nên làm gì?", "order": 3},
        {"type": "resolution", "text": "Chú thỏ tìm được đường về và ngủ thật ngon.", "order": 4},
    ],
    "word_count": 150,
}


def with_english(field_path: str) -> dict:
    """A copy of the story with one English clause spliced into `field_path`."""
    story = json.loads(json.dumps(VIETNAMESE_STORY))
    if field_path == "title":
        story["title"] = "The rabbit and the moon"
    elif field_path == "text":
        story["content"][1]["text"] = "Once upon a time there was a little rabbit."
    elif field_path == "prompt":
        story["content"][3]["prompt"] = "What do you think the rabbit should do?"
    return story


class TestStoryTextExtraction:
    """The check reads the prose, not the schema we told the model to emit."""

    def test_schema_keys_are_not_read_as_story_words(self):
        # `str(data)` carried `title`, `content`, `type`, `order` and the
        # section labels. Those are English words the model was instructed to
        # write, so reading them means checking our own schema. This passed
        # before only because no key happened to collide with the word list --
        # a section type called `the-end` would have failed every story.
        text = OutputValidator().story_text(VIETNAMESE_STORY)
        for key in ("content", "type", "order", "word_count", "opening", "resolution"):
            assert key not in text

    def test_every_prose_field_is_read(self):
        text = OutputValidator().story_text(VIETNAMESE_STORY)
        assert "Chú thỏ và mặt trăng" in text          # title
        assert "sống ven rừng" in text                  # section text
        assert "Bé nghĩ chú thỏ nên làm gì?" in text    # interaction prompt


class TestPurityCheck:
    def test_a_vietnamese_story_passes(self):
        validator = OutputValidator()
        result = validator.check_vietnamese_purity(validator.story_text(VIETNAMESE_STORY))
        assert result.valid, result.errors

    @pytest.mark.parametrize("field", ["title", "text", "prompt"])
    def test_english_is_caught_in_any_prose_field(self, field):
        validator = OutputValidator()
        result = validator.check_vietnamese_purity(
            validator.story_text(with_english(field))
        )
        assert not result.valid

    def test_diacritics_keep_vietnamese_out_of_the_comparison(self):
        # The pattern matches undecorated Latin runs only, so a Vietnamese word
        # carrying any tone or vowel mark never reaches the word list at all.
        validator = OutputValidator()
        assert validator.check_vietnamese_purity("chào bạn nhỏ, đêm nay êm").valid

    def test_undecorated_vietnamese_words_are_not_false_positives(self):
        # Vietnamese words that happen to carry no diacritic do reach the
        # comparison. None of them are English words, and the list must stay
        # short enough to keep it that way.
        validator = OutputValidator()
        assert validator.check_vietnamese_purity("con cho nho di ra vao trong nha").valid


class MockRouter:
    def __init__(self, responses: dict):
        self.responses = responses
        self.systems: list[tuple[str, str]] = []

    async def complete(self, prompt: str, stage: str = "", accept=None, system: str = ""):
        self.systems.append((stage, system))
        value = self.responses.get(stage, "{}")
        n = len([s for s, _ in self.systems if s == stage])
        return value(n) if callable(value) else value


PLANNER_OK = (
    '{"title": "Test", "story_structure": {"sections": ['
    '{"order": 0, "type": "opening", "description": "..."}, '
    '{"order": 1, "type": "context", "description": "..."}], '
    '"moral": "good", "key_characters": ["An"]}}'
)
REVIEW_APPROVED = '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}'


class TestPurityBlocksInThePipeline:
    @pytest.mark.asyncio
    async def test_an_english_story_is_regenerated_not_shipped(self):
        """The whole point: rejection triggers a retry, not a log line."""
        def writer(call_n):
            # First attempt drifts into English; the retry answers in Vietnamese.
            story = with_english("text") if call_n == 1 else VIETNAMESE_STORY
            return json.dumps(story, ensure_ascii=False)

        router = MockRouter({
            "planner": PLANNER_OK, "writer": writer, "reviewer": REVIEW_APPROVED,
        })
        result = await StoryPipeline(router).run({})

        assert result.is_fallback is False
        assert len([s for s, _ in router.systems if s == "writer"]) == 2
        assert "Once upon a time" not in json.dumps(result.content, ensure_ascii=False)

    @pytest.mark.asyncio
    async def test_the_retry_hint_names_the_language_rule(self):
        def writer(call_n):
            story = with_english("text") if call_n == 1 else VIETNAMESE_STORY
            return json.dumps(story, ensure_ascii=False)

        router = MockRouter({
            "planner": PLANNER_OK, "writer": writer, "reviewer": REVIEW_APPROVED,
        })
        await StoryPipeline(router).run({})

        # A hint that only mentions the missing interaction section would send
        # the writer after the wrong defect.
        retry_system = [s for stage, s in router.systems if stage == "writer"][1]
        assert "must be Vietnamese" in retry_system

    @pytest.mark.asyncio
    async def test_a_writer_that_never_answers_in_vietnamese_falls_back(self):
        router = MockRouter({
            "planner": PLANNER_OK,
            "writer": json.dumps(with_english("text"), ensure_ascii=False),
            "reviewer": REVIEW_APPROVED,
        })
        result = await StoryPipeline(router).run({})

        assert result.is_fallback is True

    @pytest.mark.asyncio
    async def test_a_vietnamese_story_is_not_retried(self):
        router = MockRouter({
            "planner": PLANNER_OK,
            "writer": json.dumps(VIETNAMESE_STORY, ensure_ascii=False),
            "reviewer": REVIEW_APPROVED,
        })
        result = await StoryPipeline(router).run({})

        assert result.is_fallback is False
        assert len([s for s, _ in router.systems if s == "writer"]) == 1


class TestRequestSchema:
    def test_only_vietnamese_is_accepted(self):
        from pydantic import ValidationError
        from main import GenerateRequest

        base = {"child_name": "An", "age": 4, "theme": "rồng"}
        assert GenerateRequest(**base).language == "vi"
        assert GenerateRequest(**base, language="vi").language == "vi"

        # English output is MVP 2.1; until then it is not a language choice,
        # it is unreviewed output.
        for rejected in ("en", "EN", "fr", "vi-VN"):
            with pytest.raises(ValidationError):
                GenerateRequest(**base, language=rejected)
