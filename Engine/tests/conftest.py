import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture(autouse=True)
def isolate_named_custom_adapters(monkeypatch):
    """Unit tests opt into the named-adapter mode explicitly.

    Docker Compose loads the production Engine/.env into test containers. A
    machine's active FPT/9router selection must not change tests written for
    the backward-compatible single custom endpoint.
    """
    monkeypatch.delenv("CUSTOM_LLM_ADAPTERS", raising=False)
