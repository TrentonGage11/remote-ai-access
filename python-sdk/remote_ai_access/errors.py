from __future__ import annotations

from typing import Any, Optional


class RemoteAIAccessError(RuntimeError):
    def __init__(self, message: str, *, status_code: Optional[int] = None, details: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.details = details


class TransportError(RemoteAIAccessError):
    pass


class ApiError(RemoteAIAccessError):
    pass


class AuthenticationError(ApiError):
    pass


class AuthorizationError(ApiError):
    pass


class ValidationError(ApiError):
    pass


class NotFoundError(ApiError):
    pass


class RateLimitError(ApiError):
    pass


class ServerError(ApiError):
    pass


def error_from_http(status_code: int, payload: Any, default_message: str) -> ApiError:
    message = default_message
    if isinstance(payload, dict):
        message = str(payload.get("error") or payload.get("message") or default_message)

    kwargs = {"status_code": status_code, "details": payload}
    if status_code == 401:
        return AuthenticationError(message, **kwargs)
    if status_code == 403:
        return AuthorizationError(message, **kwargs)
    if status_code == 404:
        return NotFoundError(message, **kwargs)
    if status_code == 429:
        return RateLimitError(message, **kwargs)
    if 400 <= status_code < 500:
        return ValidationError(message, **kwargs)
    if status_code >= 500:
        return ServerError(message, **kwargs)
    return ApiError(message, **kwargs)
