import asyncio
import time

import pytest
from core.pipeline import StoryPipeline, FALLBACK_STORY, DEFAULT_BUDGET_SECONDS
from core.llm.client import BaseLLMClient


class MockRouter:
    def __init__(self, responses: dict):
        self.responses = responses
        self.call_count = 0
        self.prompts = []

    async def complete(self, prompt: str, stage: str = ""):
        self.call_count += 1
        self.prompts.append(stage)
        return self.responses.get(stage, "{}")


class TestStoryPipeline:
    @pytest.mark.asyncio
    async def test_happy_path(self):
        router = MockRouter({
            "planner": '{"title": "Test", "story_structure": {"opening": "...", "sections": [{"order": 0, "type": "opening", "description": "..."}, {"order": 1, "type": "context", "description": "..."}], "moral": "good", "key_characters": ["An"]}}',
            "writer": '{"title": "Test", "content": [{"type": "opening", "text": "Xin chào bạn nhỏ\\n\\nHôm nay chúng ta có một câu chuyện", "order": 0}, {"type": "context", "text": "Ngày xưa có một cô bé\\n\\nCô bé sống trong ngôi làng nhỏ", "order": 1}, {"type": "conflict", "text": "Một ngày nọ biến cố xảy ra\\n\\nCô bé phải đối mặt với thử thách", "order": 2}, {"type": "interaction", "text": "Hỏi", "prompt": "Con nghĩ?", "order": 3}, {"type": "resolution", "text": "Cuối cùng mọi chuyện ổn thỏa\\n\\nCô bé học được bài học quý giá", "order": 4}], "word_count": 150}',
            "reviewer": '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}',
        })
        pipeline = StoryPipeline(router)

        result = await pipeline.run({})
        assert result.success is True
        assert result.safety_verdict == "APPROVED"
        assert result.title == "Test"

    @pytest.mark.asyncio
    async def test_fallback_on_all_failures(self):
        class FailingRouter:
            async def complete(self, prompt, stage=""):
                raise Exception("LLM down")

        pipeline = StoryPipeline(FailingRouter())
        result = await pipeline.run({})
        assert result.success is True
        assert result.is_fallback is True
        assert result.title == "Câu chuyện bất ngờ"

    @pytest.mark.asyncio
    async def test_survives_noisy_json_output(self):
        """Real reasoning LLMs (e.g. opencode via proxy) wrap JSON in markdown
        fences or append trailing prose. The pipeline must extract the JSON
        object instead of failing json.loads -> fallback."""
        planner = (
            '```json\n'
            '{"title": "Chú mèo dũng cảm", '
            '"story_structure": {"sections": [{"order": 0, "type": "opening", "description": "..."}, {"order": 1, "type": "context", "description": "..."}], "moral": "hãy dũng cảm"}, '
            '"key_characters": ["Mèo"]}\n'
            '```\n'
            'Đây là outline cho bé An.'
        )
        writer = (
            '{"title": "Chú mèo dũng cảm", "content": [{"type": "opening", "text": "Ngày xửa ngày xưa\\n\\nCó một chú mèo con", "order": 0}, {"type": "context", "text": "Chú mèo sống trong khu rừng\\n\\nMột buổi sáng đẹp trời", "order": 1}, {"type": "conflict", "text": "Chú mèo lạc đường\\n\\nChú phải tìm đường về", "order": 2}, {"type": "interaction", "text": "Hỏi", "prompt": "Con nghĩ?", "order": 3}, {"type": "resolution", "text": "Chú mèo tìm được nhà\\n\\nMọi người vui mừng", "order": 4}], "word_count": 150}'
            '\n\nKết thúc câu chuyện ở đây.'
        )
        router = MockRouter({
            "planner": planner,
            "writer": writer,
            "reviewer": '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}',
        })
        pipeline = StoryPipeline(router)

        result = await pipeline.run({})
        assert result.success is True
        assert result.is_fallback is False
        assert result.title == "Chú mèo dũng cảm"


    @pytest.mark.asyncio
    async def test_writer_retry_appends_interaction_hint(self):
        """When the writer omits the required 'interaction' section, the retry
        prompt must tell the model to add one (strict policy: keep the
        requirement, guide the model on retry)."""
        class HintRouter:
            def __init__(self):
                self.prompts = []
                self.writer_calls = 0

            async def complete(self, prompt, stage=""):
                self.prompts.append((stage, prompt))
                if stage == "planner":
                    return '{"title": "Test", "story_structure": {"sections": [{"order": 0, "type": "opening", "description": "..."}, {"order": 1, "type": "context", "description": "..."}], "moral": "good"}}'
                if stage == "writer":
                    self.writer_calls += 1
                    if self.writer_calls == 1:
                        return '{"title": "Test", "content": [{"type": "opening", "text": "A\\n\\nB", "order": 0}], "word_count": 150}'
                    return ('{"title": "Test", "content": ['
                            '{"type": "opening", "text": "A\\n\\nB", "order": 0}, '
                            '{"type": "context", "text": "C\\n\\nD", "order": 1}, '
                            '{"type": "conflict", "text": "E\\n\\nF", "order": 2}, '
                            '{"type": "resolution", "text": "G\\n\\nH", "order": 3}, '
                            '{"type": "interaction", "text": "Con nghĩ sao?", "prompt": "?", "order": 4}], '
                            '"word_count": 150}')
                return '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}'

        router = HintRouter()
        pipeline = StoryPipeline(router)

        result = await pipeline.run({"user": "Child info"})
        # First writer call returned no interaction -> retry with hint -> success
        assert result.success is True
        assert result.is_fallback is False

        writer_prompts = [p for (stage, p) in router.prompts if stage == "writer"]
        assert len(writer_prompts) >= 2
        assert "interaction" in writer_prompts[-1].lower()



@pytest.mark.asyncio
async def test_pipeline_accepts_dirty_json_responses():
    router = MockRouter({
        "planner": 'Here is the plan\n{"title": "Dirty", "story_structure": {"opening": "...", "sections": [{"order": 0, "type": "opening", "description": "..."}, {"order": 1, "type": "context", "description": "..."}], "moral": "good", "key_characters": ["An"]}} data: [DONE]',
        "writer": '{"title": "Dirty", "content": [{"type": "opening", "text": "Xin chao ban nho\\n\\nHom nay chung ta co mot cau chuyen", "order": 0}, {"type": "context", "text": "Ngay xua co mot co be\\n\\nCo be song trong ngoi lang nho", "order": 1}, {"type": "conflict", "text": "Mot ngay no bien co xay ra\\n\\nCo be phai doi mat voi thu thach", "order": 2}, {"type": "interaction", "text": "Hoi", "prompt": "Con nghi?", "order": 3}, {"type": "resolution", "text": "Cuoi cung moi chuyen on thoa\\n\\nCo be hoc duoc bai hoc quy gia", "order": 4}], "word_count": 150} trailing junk',
        "reviewer": '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}',
    })
    pipeline = StoryPipeline(router)
    result = await pipeline.run({})
    assert result.success is True
    assert result.title == "Dirty"


@pytest.mark.asyncio
async def test_pipeline_writer_interaction_section():
    """Writer output with interaction section passes full validation."""
    router = MockRouter({
        "planner": '{"title":"Test","story_structure":{"opening":"..","sections":[{"type":"opening","description":".."},{"type":"interaction","description":".."}],"moral":"good","key_characters":["An"]}}',
        "writer": '{"title":"Test","content":[{"type":"opening","text":"Xin chao ban nho\\n\\nHom nay chung ta co mot cau chuyen","order":0},{"type":"context","text":"Ngay xua co mot co be\\n\\nCo be song trong ngoi lang nho","order":1},{"type":"conflict","text":"Mot ngay no bien co xay ra\\n\\nCo be phai doi mat voi thu thach","order":2},{"type":"interaction","text":"An oi ban nghi sao?","prompt":"Con nghi sao?","order":3},{"type":"resolution","text":"Cuoi cung moi chuyen on thoa\\n\\nCo be hoc duoc bai hoc quy gia","order":4}],"word_count":150}',
        "reviewer": '{"safety_verdict":"APPROVED","issues":[],"quality_score":4}',
    })
    pipeline = StoryPipeline(router)
    result = await pipeline.run({})
    assert result.success is True
    assert result.title == "Test"


class SlowRouter:
    """Router whose every call takes longer than the whole budget allows."""

    def __init__(self, delay: float):
        self.delay = delay
        self.call_count = 0

    async def complete(self, prompt: str, stage: str = ""):
        self.call_count += 1
        await asyncio.sleep(self.delay)
        return "{}"


class TestTimeBudget:
    @pytest.mark.asyncio
    async def test_returns_fallback_within_budget(self):
        # Without a budget the worst case is 10 calls x the client's 300s
        # timeout. The generation must give up while BE is still listening.
        pipeline = StoryPipeline(SlowRouter(delay=30))
        pipeline.budget_seconds = 6

        started = time.monotonic()
        result = await pipeline.run({})
        elapsed = time.monotonic() - started

        assert result.is_fallback is True
        assert elapsed < 10, f"took {elapsed:.1f}s, budget was 6s"

    @pytest.mark.asyncio
    async def test_does_not_retry_after_timeout(self):
        # A stage that ran out of time will run out again; retrying it only
        # spends budget that the fallback needs.
        router = SlowRouter(delay=30)
        pipeline = StoryPipeline(router)
        # Must exceed MIN_STAGE_SECONDS so the first call actually starts and
        # then times out -- that is the path under test.
        pipeline.budget_seconds = 6

        await pipeline.run({})

        assert router.call_count == 1, f"retried a timed-out stage {router.call_count} times"

    @pytest.mark.asyncio
    async def test_no_call_started_without_time_left(self):
        router = SlowRouter(delay=30)
        pipeline = StoryPipeline(router)
        # Already past the deadline before the first stage.
        pipeline.budget_seconds = 0.001

        result = await pipeline.run({})

        assert result.is_fallback is True
        assert router.call_count == 0

    @pytest.mark.asyncio
    async def test_budget_read_from_env(self, monkeypatch):
        monkeypatch.setenv("PIPELINE_BUDGET_SECONDS", "12")
        assert StoryPipeline(SlowRouter(delay=1)).budget_seconds == 12

    @pytest.mark.asyncio
    async def test_invalid_budget_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("PIPELINE_BUDGET_SECONDS", "not-a-number")
        assert StoryPipeline(SlowRouter(delay=1)).budget_seconds == DEFAULT_BUDGET_SECONDS


from core.pipeline import BudgetExhausted, REVIEW_RESERVE_SECONDS


class TestReviewerReserve:
    def _pipeline(self, budget: float) -> StoryPipeline:
        pipeline = StoryPipeline(MockRouter({}))
        pipeline.budget_seconds = budget
        pipeline._deadline = time.monotonic() + budget
        return pipeline

    def test_reserve_is_held_back_from_writing_stages(self):
        pipeline = self._pipeline(150)
        allowance = pipeline._stage_allowance(REVIEW_RESERVE_SECONDS)
        assert 150 - REVIEW_RESERVE_SECONDS - 1 <= allowance <= 150 - REVIEW_RESERVE_SECONDS

    def test_reviewer_gets_the_whole_remainder(self):
        pipeline = self._pipeline(150)
        assert 149 <= pipeline._stage_allowance(0.0) <= 150

    def test_reserve_is_ignored_when_the_budget_cannot_honour_it(self):
        # A 6s budget cannot spare 8s. Holding it back would turn every run
        # into a fallback without ever reaching the reviewer either, so the
        # reserve stands down -- this is what keeps the four TestTimeBudget
        # tests above valid.
        pipeline = self._pipeline(6)
        assert 5 <= pipeline._stage_allowance(REVIEW_RESERVE_SECONDS) <= 6

    @pytest.mark.asyncio
    async def test_a_reserved_stage_yields_to_the_reviewer(self):
        pipeline = self._pipeline(45)
        pipeline._deadline = time.monotonic() + 10        # 10s left of 45

        with pytest.raises(BudgetExhausted):
            await pipeline._call_llm("x", "writer", reserve=REVIEW_RESERVE_SECONDS)

        # Same 10s, no reserve: the reviewer still runs.
        assert await pipeline._call_llm("x", "reviewer") == "{}"

