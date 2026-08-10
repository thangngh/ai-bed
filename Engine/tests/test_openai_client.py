import pytest
from core.llm.openai_client import OpenAIClient


@pytest.fixture(autouse=True)
def no_ambient_openai_keys(monkeypatch):
    """Start every test from a machine with no OpenAI credentials.

    See the matching fixture in test_openrouter_client.py: `main.py` calls
    `load_dotenv()` at import, so a developer's real `Engine/.env` leaks into
    `os.environ` for the whole session and these tests end up describing that
    file rather than the client.
    """
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEYS", raising=False)


class TestOpenAIClient:
    def test_load_keys_from_env(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1,sk-key2,sk-key3")
        client = OpenAIClient()
        assert len(client.keys) == 3
        assert client.keys[0] == "sk-key1"

    def test_round_robin_rotation(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1,sk-key2")
        client = OpenAIClient()

        key1, _ = client._get_next_key()
        key2, _ = client._get_next_key()
        key3, _ = client._get_next_key()

        assert key1 == "sk-key1"
        assert key2 == "sk-key2"
        assert key3 == "sk-key1"

    def test_key_disabled_after_max_failures(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1,sk-key2")
        client = OpenAIClient()
        client.max_failures = 2

        client._record_failure("sk-key1")
        client._record_failure("sk-key1")

        assert client._is_key_disabled("sk-key1") is True

    def test_key_skipped_if_disabled(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1,sk-key2")
        client = OpenAIClient()
        client.max_failures = 1
        client._record_failure("sk-key1")

        key, _ = client._get_next_key()
        assert key == "sk-key2"

    def test_all_keys_exhausted_raises(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1")
        client = OpenAIClient()
        client.max_failures = 1
        client._record_failure("sk-key1")

        with pytest.raises(Exception, match="All OpenAI keys exhausted"):
            client._get_next_key()
