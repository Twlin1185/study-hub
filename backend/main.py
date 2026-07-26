"""FastAPI 앱 진입점.

라우터 등록 + frontend/dist 정적 서빙 + 공통 에러 핸들러(설계 §3).
실행: uvicorn main:app --host 0.0.0.0 --port 8000 (backend/ 에서)
"""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from database import SessionLocal
from exceptions import AppError
from routers import (
    backups,
    categories,
    convert,
    documents,
    exam,
    fetch,
    imports,
    llm,
    quiz,
    review_notes,
    search,
    settings,
    srs,
    stats,
    study,
    suggestions,
    tag_rules,
    tags,
)
from services import backup_service, settings_service

app = FastAPI(title="Study Hub API")

app.include_router(categories.router)
app.include_router(documents.router)
app.include_router(imports.router)
app.include_router(tags.router)
app.include_router(study.router)
app.include_router(quiz.router)
app.include_router(review_notes.router)
app.include_router(srs.router)
app.include_router(stats.router)
app.include_router(settings.router)
app.include_router(tag_rules.router)
app.include_router(suggestions.router)
app.include_router(search.router)
app.include_router(convert.router)
app.include_router(backups.router)
app.include_router(llm.router)
app.include_router(fetch.router)
app.include_router(exam.router)


@app.on_event("startup")
def _maybe_auto_backup() -> None:
    """`settings:backup.auto == 'daily'`이면 앱 기동 시 마지막 백업이 24h 지났을 때
    자동으로 백업 1개를 만든다(설계 §4.10). 실패해도 앱 기동은 막지 않는다."""
    db = SessionLocal()
    try:
        auto = settings_service.get_setting(db, "backup.auto", False)
        if auto != "daily":
            return
        latest = backup_service.latest_backup_at()
        if latest is None or (dt.datetime.now() - latest) > dt.timedelta(hours=24):
            backup_service.create_backup(label="auto")
    except Exception:  # noqa: BLE001 - 백업 실패가 앱 기동을 막아서는 안 된다
        pass
    finally:
        db.close()


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


# --- 사용자 매뉴얼 서빙 (F39, 설계 §4.15, S12) ---
# `docs/manual/user-manual.html` 원본이 단일 출처 — 빌드 복사·번들 포함 없음(파일 수정 →
# 서버 재시작 없이 새로고침만으로 반영). 읽기 전용: 이 파일을 쓰거나 수정하는 코드는 없다.
# SPA catch-all(아래)보다 먼저 등록해야 `/manual`이 index.html에 가려지지 않는다.
MANUAL_HTML = Path(__file__).resolve().parent.parent / "docs" / "manual" / "user-manual.html"


@app.get("/manual", include_in_schema=False)
async def get_manual():
    if not MANUAL_HTML.exists():
        raise StarletteHTTPException(status_code=404, detail="사용 설명서를 찾을 수 없습니다")
    return FileResponse(MANUAL_HTML, media_type="text/html; charset=utf-8")


# --- 수집 이미지 서빙 (F35-2, 설계 §4.13, S12 검토 후속) ---
# 사이트 반입(FetchedExam 경로)이 `sources/images/`에 저장한 그림 문제 이미지를 문서
# 본문의 `/images/{filename}` 절대 링크로 서빙한다 — 읽기 전용(sources/ 원본 불변 규칙,
# 쓰기·삭제 코드 없음). 파일명은 `_save_fetch_images`가 만드는 `{sha256[:16]}.{ext}`
# 형식만 허용해 경로 탈출을 차단한다(`../` 등은 정규식 자체가 거부). `:path` 컨버터를
# 써서 인코딩된 슬래시(`%2F`) 등으로 인한 다중 세그먼트 요청도 이 라우트가 직접 받아
# 404로 거부한다(단순 `{filename}`이면 슬래시 포함 경로가 매칭 실패해 아래 SPA
# catch-all로 새어 들어간다 — 정적 index.html만 반환되어 파일 유출은 아니지만 404가
# 아니므로 결정적이지 않다). SPA catch-all보다 먼저 등록(위 /manual 전례).
IMAGES_DIR = Path(__file__).resolve().parent.parent / "sources" / "images"
_IMAGE_FILENAME_RE = re.compile(r"^[0-9a-f]{16}\.(gif|png|jpg|jpeg|webp)$")


@app.get("/images/{filename:path}", include_in_schema=False)
async def get_source_image(filename: str):
    if not _IMAGE_FILENAME_RE.fullmatch(filename):
        raise StarletteHTTPException(status_code=404, detail="Not Found")
    images_root = IMAGES_DIR.resolve()
    candidate = (IMAGES_DIR / filename).resolve()
    if not candidate.is_relative_to(images_root) or not candidate.is_file():
        raise StarletteHTTPException(status_code=404, detail="Not Found")
    return FileResponse(candidate)


# --- 정적 파일 서빙 (frontend/dist) + SPA 라우트 폴백 ---
# React Router SPA이므로 /api·정적 자산이 아닌 GET 경로는 전부 index.html을 반환해야
# 새로고침/직접 접속(/explore, /docs/1, /settings ...)이 404가 아닌 앱으로 뜬다.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
INDEX_HTML = FRONTEND_DIST / "index.html"
FRONTEND_SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"


def _warn_if_frontend_stale() -> None:
    """dist가 없거나 src보다 오래됐으면 기동 로그에 눈에 띄게 알린다.

    배포 빌드(dist)를 FastAPI가 그대로 서빙하므로, 프론트 코드를 고치고 `npm run build`를
    빠뜨리면 **서버는 최신인데 화면만 옛 버전**이 된다(2026-07-26 실사용: dist가 하루 이상
    묵어 새 화면이 없는 채로 운영됨). 서버가 빌드를 대신 실행하지는 않는다 — 안내만 하고,
    자동 빌드는 시작 스크립트(`서버시작.bat`)가 담당한다.
    """
    if not INDEX_HTML.exists():
        print("[!] frontend/dist 없음 - 화면이 뜨지 않습니다. frontend 폴더에서 `npm run build`를 실행하세요.")
        return
    if not FRONTEND_SRC.exists():
        return
    try:
        built_at = INDEX_HTML.stat().st_mtime
        newest_src = max(
            (p.stat().st_mtime for p in FRONTEND_SRC.rglob("*") if p.is_file()),
            default=0.0,
        )
    except OSError:
        return
    if newest_src > built_at:
        print(
            "[!] frontend/dist 가 소스보다 오래됐습니다 - 화면에 최신 변경이 반영되지 않습니다.\n"
            "    frontend 폴더에서 `npm run build` 후 새로고침하세요."
        )


_warn_if_frontend_stale()

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

        # 경로 탈출 차단: `full_path`는 `:path` 컨버터라 퍼센트 인코딩된 `..`(%2e%2e)이
        # 정규화 없이 그대로 들어온다. 검사 없이 이으면 dist 밖 임의 파일(study.db·소스·
        # OS 파일)이 서빙된다 — 실측 확인(2026-07-26 S12 검토). 탈출 시도는 오류가 아니라
        # 평범한 SPA 라우트처럼 index.html로 돌려보낸다(정보 노출 최소화).
        try:
            candidate = (FRONTEND_DIST / full_path).resolve()
            inside_dist = candidate.is_relative_to(FRONTEND_DIST.resolve())
        except (OSError, ValueError):  # 잘못된 경로 문자·드라이브 문자 등
            inside_dist = False

        if full_path and inside_dist and candidate.is_file():
            return FileResponse(candidate)

        return FileResponse(INDEX_HTML)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
