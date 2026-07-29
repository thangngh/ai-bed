from abc import ABC, abstractmethod


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
            Raw response text from LLM
        """
        raise NotImplementedError
