"""사이트 어댑터 반입 스키마 (F35-2, 설계 §4.13)."""
from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from schemas.convert import EngineChoice


class AdapterInfo(BaseModel):
    id: str
    name: str
    priority: int
    available: bool
    notice: str
    # S14(qnet): 서비스키 등록 상태 — `available`은 이 값을 반영한다. 기존 응답의 상위
    # 호환이라 프론트 분기는 불요하다. **원문 키는 어떤 경우에도 담기지 않는다.**
    key_registered: Optional[bool] = None
    key_suffix: Optional[str] = None


class CertSource(BaseModel):
    adapter: str
    cert_ref: str


class CertItem(BaseModel):
    name: str
    sources: List[CertSource] = Field(default_factory=list)


class ExamsRequest(BaseModel):
    sources: List[CertSource] = Field(default_factory=list)
    # S14: 안내문 게시물(공개문제가 아닌 안내·집행 공지)은 기본 숨김 — "안내문 N건 보기"
    # 토글이 이 값을 true로 보내면 같은 24h 캐시에서 그대로 반환한다(API 재호출 0건).
    include_notices: bool = False


class EstimateInfo(BaseModel):
    questions_assumed: int
    approx_input_tokens: int
    assumed: bool


class ExamItem(BaseModel):
    exam_key: str
    label: str
    adapter: str
    cert_ref: Optional[str] = None
    exam_ref: str
    # 어댑터별 exam_ref 맵(대안 어댑터 재시도용). exam_ref == refs[adapter] (하위 호환).
    refs: Dict[str, str] = Field(default_factory=dict)
    also_on: List[str] = Field(default_factory=list)
    question_count: Optional[int] = None
    imported: bool = False
    estimate: EstimateInfo
    # S14: 안내문 게시물 여부(기본 목록에는 False만 온다 — include_notices=true일 때만 섞인다)
    is_notice: bool = False


class QnetKeyRequest(BaseModel):
    """큐넷 오픈API 서비스키 등록 — 원문 키는 요청에만 존재하고 응답·로그에는 남지 않는다."""

    key: str = Field(min_length=1, max_length=500)


class QnetKeyResponse(BaseModel):
    key_registered: bool
    key_suffix: Optional[str] = None


class FetchImportRequest(BaseModel):
    adapter: str
    cert_ref: str
    exam_ref: str
    source_url: Optional[str] = None
    engine: EngineChoice = "auto"
    # 병합 대표 키(fetch/exams 응답의 exam_key 그대로 전달, S12) — 서버가 수집 결과의
    # exam_key를 이 값으로 덮어써 목록 표기·분류 경로·imported 판정을 일치시킨다.
    # 미지정 시 기존 동작 완전 불변(§4.13).
    exam_key: Optional[str] = None


class FetchJobStart(BaseModel):
    job_id: str
