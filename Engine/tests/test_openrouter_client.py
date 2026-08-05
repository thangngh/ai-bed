import pytest
from core.llm.openrouter_client import OpenRouterClient
from core.llm.openai_client import AllKeysExhausted

class TestOpenRouterClient:
    def test_init_raises_without_key(self, monkeypatch):
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
        monkeypatch.delenv("OPENROUTER_API_KEYS", raising=False)
        with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
            OpenRouterClient()

    def test_init_with_single_key(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-key")
        monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-oss-20b:free")
        client = OpenRouterClient()
        assert client.keys == ["sk-or-test-key"]
        assert client.model == "openai/gpt-oss-20b:free"

    def test_init_with_multiple_keys(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEYS", "sk-or-1, sk-or-2 ,sk-or-3")
        client = OpenRouterClient()
        assert client.keys == ["sk-or-1", "sk-or-2", "sk-or-3"]

    def test_key_rotation_cycles(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEYS", "sk-or-1,sk-or-2")
        client = OpenRouterClient()
        assert client._get_next_key() == "sk-or-1"
        assert client._get_next_key() == "sk-or-2"
        assert client._get_next_key() == "sk-or-1"

    def test_key_disabled_after_max_failures(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEYS", "sk-or-1,sk-or-2")
        client = OpenRouterClient()
        client.max_failures = 2
        for _ in range(2):
            client._key_failures["sk-or-1"] = client._key_failures.get("sk-or-1", 0) + 1
        # sk-or-1 is disabled, so rotation skips to sk-or-2 and back.
        assert client._get_next_key() == "sk-or-2"
        assert client._get_next_key() == "sk-or-2"

    def test_all_keys_exhausted_raises(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEYS", "sk-or-1")
        client = OpenRouterClient()
        client.max_failures = 1
        client._key_failures["sk-or-1"] = 1
        with pytest.raises(AllKeysExhausted):
            client._get_next_key()
