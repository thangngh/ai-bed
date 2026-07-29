import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.mark.asyncio
async def test_generate_with_gender():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/generate", json={
            "child_name": "Test", "age": 4, "theme": "Động vật",
            "gender": "boy", "favorite_character": "Khủng long Rex",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "title" in data


@pytest.mark.asyncio
async def test_generate_without_gender():
    """Should work with defaults when gender not provided."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/generate", json={
            "child_name": "Test", "age": 4, "theme": "Động vật",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "title" in data