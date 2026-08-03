"""LLM 엔진 관리 라우터 (F34→F41, 설계 §4.17) — 레지스트리 진단·API 키 등록/삭제·설치."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from starlette import status

from database import get_db
from exceptions import ValidationAppError
from schemas.llm import (
    ApiKeyRequest,
    ApiKeySaved,
    InstallEngineResponse,
    JobCancelResult,
    JobListResponse,
    LlmStatus,
    QueuePauseResult,
)
from services import convert_service, llm_engine_service

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.get("/status", response_model=LlmStatus)
def get_status(
    refresh: bool = Query(default=False, description="CLI형 엔진 진단 캐시를 무시하고 다시 확인"),
    db: Session = Depends(get_db),
) -> LlmStatus:
    if refresh:
        for engine_id, meta in llm_engine_service.ENGINE_REGISTRY.items():
            if meta["kind"] == "cli":
                llm_engine_service.diagnose_engine(engine_id, force=True)
    return LlmStatus(**llm_engine_service.get_status(db))


@router.post("/api-key", response_model=ApiKeySaved)
def register_api_key(payload: ApiKeyRequest, db: Session = Depends(get_db)) -> ApiKeySaved:
    """즉석 연결 테스트 성공 시에만 저장(secrets.json, DB/settings 금지). 응답은 key_suffix만.
    검토 지적 ⑤ — 핑 모델은 사용자가 고른 유효 선택 모델(legacy `llm.api_model` 별칭·
    소목록 폴백 포함)을 그대로 쓴다(§4.23 ⓑ)."""
    model = llm_engine_service.get_selected_model(db, llm_engine_service.ENGINE_CLAUDE_API)
    suffix = llm_engine_service.save_api_key(payload.key, model=model)
    return ApiKeySaved(key_suffix=suffix)


@router.delete("/api-key", status_code=status.HTTP_204_NO_CONTENT)
def remove_api_key() -> None:
    llm_engine_service.delete_api_key()


@router.post("/engines/{engine_id}/install", response_model=InstallEngineResponse)
def install_engine(engine_id: str) -> InstallEngineResponse:
    """`installable:true` 엔진만(현재 codex-cli) — 그 외는 422(설계 §4.17 ④). 동기 처리,
    실패는 §3 포맷(다운로드 실패 = 502)."""
    normalized = llm_engine_service.normalize_engine_id(engine_id)
    meta = llm_engine_service.ENGINE_REGISTRY.get(normalized)
    if meta is None or not meta["installable"]:
        raise ValidationAppError("설치를 지원하지 않는 엔진입니다", detail={"engine": engine_id})
    result = llm_engine_service.install_engine(normalized)
    return InstallEngineResponse(**result)


# ---------------------------------------------------------------------------
# S22(F48, 설계 §4.24) — LLM 작업 센터: 전역 잡 목록·취소·대기열 일시정지
# 신규 엔드포인트 4개 — 전부 LLM 0·DB 0(인메모리 조회·플래그 전환뿐).
# ---------------------------------------------------------------------------
@router.get("/jobs", response_model=JobListResponse)
def list_jobs() -> JobListResponse:
    """전역 잡 목록 — 정렬: running → queued(등록순) → 종료(최신순). 페이지네이션 없음
    (잡 TTL 1시간 내 레코드뿐 — 상한 자연 형성)."""
    return JobListResponse(**convert_service.list_jobs_overview())


@router.post("/jobs/{job_id}/cancel", response_model=JobCancelResult)
def cancel_job(job_id: str) -> JobCancelResult:
    """취소 — queued=큐 제거(비용 0) / running=실행 중단(부분 과금 가능 — 마지막 usage
    표기). 이미 종료된 작업은 409, 미존재·TTL 만료는 404(설계 §4.24 ⓐⓑ)."""
    return JobCancelResult(**convert_service.cancel_job(job_id))


@router.post("/queue/pause", response_model=QueuePauseResult)
def pause_queue() -> QueuePauseResult:
    """대기열 일시정지 — 다음 잡 시작만 보류(running 잡은 계속). 멱등."""
    return QueuePauseResult(paused=convert_service.pause_queue())


@router.post("/queue/resume", response_model=QueuePauseResult)
def resume_queue() -> QueuePauseResult:
    """재개 — 보류 해제, 대기 순서대로 실행. 멱등."""
    return QueuePauseResult(paused=convert_service.resume_queue())
