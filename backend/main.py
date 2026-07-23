"""FastAPI 앱 진입점.

라우터 등록 + frontend/dist 정적 서빙 + 공통 에러 핸들러(설계 §3).
실행: uvicorn main:app --host 0.0.0.0 --port 8000 (backend/ 에서)
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from exceptions import AppError
from routers import (
    categories,
    documents,
    imports,
    quiz,
    review_notes,
    settings,
    stats,
    study,
    tags,
)

app = FastAPI(title="Study Hub API")

app.include_router(categories.router)
app.include_router(documents.router)
app.include_router(imports.router)
app.include_router(tags.router)
app.include_router(study.router)
app.include_router(quiz.router)
app.include_router(review_notes.router)
app.include_router(stats.router)
app.include_router(settings.router)


def _error_body(code: str, message: str, detail: object | None = None) -> dict:
    return {"error": {"code": code, "message": message, "detail": detail}}


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(exc.code, exc.message, exc.detail),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_error_body(
            "VALIDATION_ERROR",
            "입력값이 올바르지 않습니다",
            jsonable_encoder(exc.errors()),
        ),
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    code = "NOT_FOUND" if exc.status_code == 404 else "VALIDATION_ERROR"
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(code, str(exc.detail), None),
    )


@app.exception_handler(Exception)
async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=_error_body("INTERNAL", "서버 내부 오류가 발생했습니다", str(exc)),
    )


# --- 정적 파일 서빙 (frontend/dist) + SPA 라우트 폴백 ---
# React Router SPA이므로 /api·정적 자산이 아닌 GET 경로는 전부 index.html을 반환해야
# 새로고침/직접 접속(/explore, /docs/1, /settings ...)이 404가 아닌 앱으로 뜬다.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
INDEX_HTML = FRONTEND_DIST / "index.html"

if FRONTEND_DIST.exists() and INDEX_HTML.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        # 빌드 산출물(해시된 JS/CSS)은 StaticFiles로 직접 서빙 (캐시 헤더 등 정석 처리)
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # /api/* 는 이 catch-all이 가로채지 않는다 — 라우터에 없는 api 경로는
        # 기존 NOT_FOUND JSON 포맷 그대로 유지.
        if full_path == "api" or full_path.startswith("api/"):
            raise StarletteHTTPException(status_code=404, detail="Not Found")

        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)

        return FileResponse(INDEX_HTML)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
