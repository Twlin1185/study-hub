"""LLM 엔진 관리 스키마 (F34, 설계 §4.11)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

EngineChoice = Literal["auto", "cli", "api"]
EnginePriority = Literal["cli", "api"]
FallbackPolicy = Literal["auto", "ask", "off"]


class CliStatus(BaseModel):
    installed: bool
    logged_in: bool
    last_success_at: Optional[str] = None
    last_error_kind: Optional[str] = None


class ApiStatus(BaseModel):
    key_registered: bool
    key_suffix: Optional[str] = None
    last_success_at: Optional[str] = None


class LimitStatus(BaseModel):
    kind: Optional[str] = None
    resets_at: Optional[str] = None


class LlmStatus(BaseModel):
    cli: CliStatus
    api: ApiStatus
    limit: Optional[LimitStatus] = None
    priority: EnginePriority
    fallback_policy: FallbackPolicy


class ApiKeyRequest(BaseModel):
    key: str = Field(min_length=8, max_length=500)


class ApiKeySaved(BaseModel):
    key_suffix: str
