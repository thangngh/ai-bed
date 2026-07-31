import os
from typing import Optional
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

from core.orchestrator import StoryOrchestrator

app = FastAPI(title="Bedtime Story Engine")
orchestrator = StoryOrchestrator()


@app.exception_handler(RequestValidationError)
async def validation_handler(request, exc):
    return JSONResponse(
        status_code=422,
        content={
            "error": {"code": "VALIDATION_ERROR", "message": "Missing required fields"},
            "request_id": "",
        }
    )


class GenerateRequest(BaseModel):
    child_name: str
    age: int
    theme: str
    goal: Optional[str] = ""
    mood: Optional[str] = "vui vẻ"
    language: Optional[str] = "vi"
    memories: Optional[list] = []
    recent_stories: Optional[list] = []
    gender: Optional[str] = ""
    favorite_character: Optional[str] = ""


class GenerateResponse(BaseModel):
    request_id: str = ""
    title: str
    content: list
    safety_status: str
    memories: list = []
    llm_calls: int = 0
    word_count: int = 0
    is_fallback: bool = False
    latency_ms: int = 0
    error: str = ""


@app.get("/health")
async def health():
    return {"status": "ok", "service": "Bedtime Story Engine"}


@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    result = await orchestrator.generate(req.model_dump())
    return GenerateResponse(**result)


if __name__ == "__main__":
    port = int(os.getenv("ENGINE_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
