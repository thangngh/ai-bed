import importlib
import os
import pytest
from httpx import AsyncClient, ASGITransport

import main
from main import app
from core.orchestrator import StoryOrchestrator

PROXY_URL = os.getenv("E2E_LLM_URL", "http://localhost:20128/v1/chat/completions")
PROXY_MODEL = os.getenv("E2E_LLM_MODEL", "open-code")


def _proxy_available() -> bool:
    import httpx
    base = PROXY_URL.replace("/v1/chat/completions", "")
    try:
        r = httpx.get(f"{base}/v1/models", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _proxy_available(),
    reason="LLM proxy not reachable (start proxy on localhost:20128)",
)


@pytest.fixture(autouse=True)
def _set_llm_env(monkeypatch):
    monkeypatch.setenv("PRIMARY_LLM", "")
    monkeypatch.setenv("FALLBACK_LLM", "")
    monkeypatch.setenv("CUSTOM_LLM_URL", PROXY_URL)
    monkeypatch.setenv("CUSTOM_LLM_MODEL", PROXY_MODEL)
    monkeypatch.setenv("CUSTOM_LLM_API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEYS", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")


@pytest.mark.asyncio
async def test_orchestrator_pipeline_through_real_proxy():
    """Full planner → writer → reviewer → memory extraction through the real proxy."""
    orch = StoryOrchestrator()
    result = await orch.generate({
        "child_name": "An",
        "age": 4,
        "theme": "Động vật",
        "goal": "Dũng cảm",
        "mood": "vui vẻ",
        "language": "vi",
    })
    assert result["title"]
    assert isinstance(result["content"], list)
    assert len(result["content"]) > 0
    assert result["safety_status"] in ("APPROVED", "FLAGGED", "FALLBACK")
    assert isinstance(result["llm_calls"], int)


@pytest.mark.asyncio
async def test_generate_endpoint_via_proxy():
    """POST /generate returns a valid schema through the real LLM."""
    importlib.reload(main)
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/generate", json={
            "child_name": "An",
            "age": 4,
            "theme": "Động vật",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "title" in data
        assert "content" in data
        assert "safety_status" in data
        assert "is_fallback" in data


@pytest.mark.asyncio
async def test_health_still_ok():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
