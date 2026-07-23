"""공통 애플리케이션 예외.

설계 §3 에러 포맷을 지키기 위해, 라우터/서비스는 HTTPException 대신 이 예외들을
발생시킨다. main.py의 예외 핸들러가 최종적으로
`{"error": {"code", "message", "detail"}}` 형태로 변환한다.
"""
from __future__ import annotations

from typing import Any


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int,
        detail: Any | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.detail = detail
        super().__init__(message)


class NotFoundError(AppError):
    def __init__(self, message: str = "찾을 수 없습니다", detail: Any | None = None) -> None:
        super().__init__("NOT_FOUND", message, 404, detail)


class ConflictError(AppError):
    def __init__(self, message: str = "요청을 처리할 수 없습니다", detail: Any | None = None) -> None:
        super().__init__("CONFLICT", message, 409, detail)


class ValidationAppError(AppError):
    def __init__(self, message: str = "입력값이 올바르지 않습니다", detail: Any | None = None) -> None:
        super().__init__("VALIDATION_ERROR", message, 422, detail)
