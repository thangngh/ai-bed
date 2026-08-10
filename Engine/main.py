import hmac
import os
import logging
from typing import Any
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
import uvicorn

# Must run before `core.orchestrator` is imported: StoryOrchestrator is
# instantiated at module scope below, and LLMRouter reads the provider env
# vars in its constructor. Loading the file any later (e.g. under
# `if __name__ == "__main__"`) would leave the router already built from
# whatever the launching shell happened to export -- which is exactly how a
# CUSTOM_LLM_URL that appears nowhere in .env ended up serving traffic.
load_dotenv()

# Nothing configured the root logger, so it sat at WARNING: every
# `logger.info` in the pipeline and the router was dropped, and `docker logs`
# showed only failures with no trace of which provider or stage produced them.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

from core.orchestrator import StoryOrchestrator
app = FastAPI(title="Bedtime Story Engine")
orchestrator = StoryOrchestrator()
logger = logging.getLogger(__name__)

if not os.getenv("ENGINE_API_KEY", "").strip():
    logger.warning(
        "ENGINE_API_KEY is not set: /generate accepts any caller that can reach "
        "this port. Fine for local development; set it in any deployment."
    )


@app.exception_handler(RequestValidationError)
async def validation_handler(request, exc):
    return JSONResponse(
        status_code=422,
        content={
            "error": {"code": "VALIDATION_ERROR", "message": "Missing required fields"},
            "request_id": "",
        }
    )


def require_engine_key(x_engine_key: str = Header(default="", alias="X-Engine-Key")):
    """Shared secret between the BE and the Engine.

    The compose stack no longer publishes port 8000, so this is the second
    lock rather than the first: it is what stops anything else that lands on
    the compose network from spending the LLM budget directly, past the BE's
    rate limiter and past nginx's.

    Enforced only when ENGINE_API_KEY is set, so a bare `python main.py` still
    works for local development -- an unset key is logged loudly at startup.
    """
    expected = os.getenv("ENGINE_API_KEY", "").strip()
    if not expected:
        return
    if not hmac.compare_digest(x_engine_key or "", expected):
        raise HTTPException(
            status_code=401,
            detail={"error": {"code": "UNAUTHORIZED", "message": "Invalid engine key"}},
        )


# Caps mirror core/prompts/sanitize.py. The sanitizer is what makes a value
# safe; this is what stops an oversized one from being paid for at all.
class MemoryIn(BaseModel):
    # Unknown keys are dropped rather than rejected: the BE stores memories
    # written by earlier Engine versions, and a stale extra field is not a
    # reason to fail a whole generation.
    model_config = ConfigDict(extra="ignore")

    type: str = Field(default="other", max_length=32)
    key: str = Field(default="", max_length=40)
    value: str = Field(default="", max_length=120)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class GenerateRequest(BaseModel):
    child_name: str = Field(min_length=1, max_length=40)
    age: int = Field(ge=3, le=6)
    theme: str = Field(min_length=1, max_length=60)
    goal: str = Field(default="", max_length=200)
    mood: str = Field(default="vui vẻ", max_length=30)
    language: str = Field(default="vi", max_length=8)
    memories: list[MemoryIn] = Field(default_factory=list, max_length=20)
    # Never read by the pipeline; bounded so it cannot be used to inflate a
    # request body either.
    recent_stories: list[Any] = Field(default_factory=list, max_length=10)
    gender: str = Field(default="", max_length=20)
    favorite_character: str = Field(default="", max_length=60)


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


@app.post("/generate", response_model=GenerateResponse,
          dependencies=[Depends(require_engine_key)])
async def generate(req: GenerateRequest):
    logger.debug("Generate request received")
    result = await orchestrator.generate(req.model_dump())
    return GenerateResponse(**result)


if __name__ == "__main__":
    port = int(os.getenv("ENGINE_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
