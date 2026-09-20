"""Puertos de entrada: contratos de los casos de uso de autenticación."""
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..entities.biometric_sample import BiometricSample
    from ..entities.user import User


class RegisterFaceUseCase(ABC):
    @abstractmethod
    def execute(
        self,
        username: str,
        image: Any,
        liveness_images: list[Any] | None = None,
        liveness_actions: list[str] | None = None,
        liveness_verified: bool = False,
    ) -> "User":
        raise NotImplementedError


class LoginFaceUseCase(ABC):
    @abstractmethod
    def execute(
        self,
        image: Any,
        liveness_images: list[Any] | None = None,
        liveness_actions: list[str] | None = None,
        liveness_verified: bool = False,
    ) -> tuple[str, float]:
        """Retorna (username, distance). Falla con ValueError/PermissionError."""
        raise NotImplementedError


class RegisterFingerprintUseCase(ABC):
    @abstractmethod
    def execute(
        self, username: str, sample_format: int | None, data_base64: str, quality: int | None
    ) -> "BiometricSample":
        raise NotImplementedError


class LoginFingerprintUseCase(ABC):
    @abstractmethod
    def execute(self, query_image: Any) -> tuple[str, int]:
        """Retorna (username, score). Falla con ValueError/PermissionError."""
        raise NotImplementedError
