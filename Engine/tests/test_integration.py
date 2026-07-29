import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_generate_returns_200():
    """Even without API keys, should return 200 with fallback."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/generate", json={
            "child_name": "Test", "age": 4, "theme": "Động vật",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "title" in data


@pytest.mark.asyncio
async def test_generate_validates_required_fields():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/generate", json={"age": 4})
        assert resp.status_code == 422