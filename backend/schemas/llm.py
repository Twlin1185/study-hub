"""LLM 엔진 관리 스키마 (F34→F41, 설계 §4.17 — 엔진 배열 계약).

`GET /api/llm/status`는 고정 `cli`/`api` 필드가 아니라 **엔진 배열**을 반환한다(설계 §4.17 ②
— 기존 톱레벨 `cli`/`api` 필드는 호환 유지 없이 제거 확정). 엔진마다 CLI형(`installed`·
`logged_in`)/API형(`key_registered`·`key_suffix`) 중 해당 없는 필드는 `null`이다."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

# 요청 파라미터(`POST /api/convert` 등)는 'auto' + 등록 엔진 id + legacy 별칭('cli'|'api')을
# 계속 수용한다(422 아님 — 별칭 매핑은 읽기 시에만, 설계 §4.17 ③). 타입은 str로 느슨하게
# 받고, 실제 검증·정규화는 llm_engine_service.resolve_engine이 담당한다.
EngineChoice = str
Billing = Literal["subscription", "metered"]
FallbackPolicy = Literal["auto", "ask", "off"]


class EngineModel(BaseModel):
    """엔진별 선택 가능 모델 소목록 항목(설계 §4.23 ⓑ — 하드코딩, 자유 텍스트 입력 없음)."""

    id: str
    label: str


class EngineStatus(BaseModel):
    """엔진 배열의 항목 하나 — CLI형은 installed/logged_in만, API형은 key_registered/
    key_suffix만 의미가 있고 해당 없는 쪽은 null(프론트는 null 필드를 렌더하지 않는다).
    `enabled`·`models`·`default_model`·`selected_model`은 S21(F47, 설계 §4.23 ⑤) 순수
    추가 — 기존 필드·톱레벨은 불변."""

    id: str
    label: str
    billing: Billing
    installable: bool
    available: bool
    enabled: bool
    installed: Optional[bool] = None
    logged_in: Optional[bool] = None
    key_registered: Optional[bool] = None
    key_suffix: Optional[str] = None
    last_success_at: Optional[str] = None
    last_error_kind: Optional[str] = None
    models: List[EngineModel] = Field(default_factory=list)
    default_model: Optional[str] = None
    selected_model: Optional[str] = None


class LimitStatus(BaseModel):
    kind: Optional[str] = None
    resets_at: Optional[str] = None


class LlmStatus(BaseModel):
    engines: List[EngineStatus]
    limit: Optional[LimitStatus] = None
    priority: List[str]
    fallback_policy: FallbackPolicy


class ApiKeyRequest(BaseModel):
    key: str = Field(min_length=8, max_length=500)


class ApiKeySaved(BaseModel):
    key_suffix: str


class InstallEngineResponse(BaseModel):
    """`POST /api/llm/engines/{id}/install` 응답(설계 §4.17 ④) — 동기 처리."""

    installed: bool
    version: Optional[str] = None
