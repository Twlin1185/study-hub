"""웹 임베드 북마크 카드 — 메타데이터 조회 라우터 (S37, 설계 §4.30).

DB 세션 의존성 없음 — 순수 조회(DB 쓰기 0 · 파일 쓰기 0 · LLM 0). 라우터는 얇게 유지하고
가드·파싱은 전부 `services/web_embed_service.py`가 담당한다.
"""
from __future__ import annotations

from fastapi import APIRouter

from schemas.web_embed import WebEmbedPreviewRequest, WebEmbedPreviewResponse
from services import web_embed_service

router = APIRouter(prefix="/api/web-embed", tags=["web-embed"])


@router.post("/preview", response_model=WebEmbedPreviewResponse)
def preview_web_embed(payload: WebEmbedPreviewRequest) -> WebEmbedPreviewResponse:
    result = web_embed_service.fetch_preview(payload.url)
    return WebEmbedPreviewResponse(**result)
