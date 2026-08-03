from abc import ABC, abstractmethod


class EmptyCompletionError(Exception):
    """A provider returned HTTP success but no usable text.

    Treating an empty body as a valid answer hides a failure from the router:
    it has no reason to try the next provider, and the pipeline instead burns
    its retries parsing nothing. One measured writer call spent 294s to return
    an empty body and was retried rather than failed over.
    """


class BaseLLMClient(ABC):
    """Abstract base for all LLM providers."""

    @abstractmethod
    async def complete(self, prompt: str, stage: str = "") -> str:
        """
        Send a prompt to the LLM and return the response text.

        Args:
            prompt: Full prompt with system + user context
            stage: 'planner', 'writer', 'reviewer', or 'memory_ext'

        Returns:
            Raw, non-empty response text from the LLM.

        Raises:
            EmptyCompletionError: the provider answered with no usable text.
                Implementations must raise rather than return "" so that
                LLMRouter can fall through to the next provider.
        """
        raise NotImplementedError
