from abc import ABC, abstractmethod


class EmptyCompletionError(Exception):
    """A provider returned HTTP success but no usable text.

    Treating an empty body as a valid answer hides a failure from the router:
    it has no reason to try the next provider, and the pipeline instead burns
    its retries parsing nothing. One measured writer call spent 294s to return
    an empty body and was retried rather than failed over.
    """


def build_messages(prompt: str, system: str = "") -> list[dict]:
    """Chat messages for the OpenAI-compatible providers.

    The system turn is omitted rather than sent empty: a proxy that forwards
    an empty system message verbatim can have the upstream model reject the
    request, and there is nothing to gain from sending one.
    """
    messages: list[dict] = []
    if system and system.strip():
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    return messages


class BaseLLMClient(ABC):
    """Abstract base for all LLM providers."""

    @abstractmethod
    async def complete(self, prompt: str, stage: str = "", system: str = "") -> str:
        """
        Send a prompt to the LLM and return the response text.

        `system` and `prompt` must stay separate all the way down to the wire.
        Concatenating them -- which is what every client used to receive -- puts
        the operator's safety rules and the parent's free text in one
        indistinguishable blob under a single `user` turn, so the model has no
        structural reason to rank the rules above the data. Implementations map
        `system` onto the provider's own system channel and leave it out
        entirely when it is empty.

        Args:
            prompt: The user turn: the task plus untrusted, fenced data.
            stage: 'planner', 'writer', 'reviewer', or 'memory_ext'
            system: Operator instructions for the provider's system channel.

        Returns:
            Raw, non-empty response text from the LLM.

        Raises:
            EmptyCompletionError: the provider answered with no usable text.
                Implementations must raise rather than return "" so that
                LLMRouter can fall through to the next provider.
        """
        raise NotImplementedError
