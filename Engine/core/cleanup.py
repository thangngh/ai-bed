import json
from typing import Any


def extract_json_block(text: str) -> Any:
    """
    Return the first valid JSON block (dict or list) found in ``text``.

    Ignores leading/trailing prose and trailing SSE markers such as
    ``data: [DONE]``. Raises ValueError if no valid JSON block is found.
    """
    decoder = json.JSONDecoder()
    text = text.strip()

    for match in range(len(text)):
        if text[match] not in ("{", "["):
            continue
        try:
            value, _ = decoder.raw_decode(text[match:])
            return value
        except json.JSONDecodeError:
            continue

    raise ValueError("No valid JSON block found in text")