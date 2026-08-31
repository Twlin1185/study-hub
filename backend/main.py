"""FastAPI 앱 진입점.

라우터 등록 + frontend/dist 정적 서빙 + 공통 에러 핸들러(설계 §3).
실행: uvicorn main:app --host 0.0.0.0 --port 8000 (backend/ 에서)
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from database import SessionLocal
from exceptions import AppError
from routers import (
    applied_exam,
    backups,
    categories,
    convert,
    documents,
    exam,
    fetch,
    imports,
    improve,
    llm,
    notes,
    quiz,
    review_notes,
    search,
    settings,
    split,
    srs,
    stats,
    study,
    suggestions,
    tag_rules,
    tags,
    uploads,
    web_embed,
)
from services import backup_service, settings_service


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


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    _maybe_auto_backup()
    yield


app = FastAPI(title="Study Hub API", lifespan=_lifespan)

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
app.include_router(applied_exam.router)
app.include_router(improve.router)
app.include_router(split.router)
app.include_router(uploads.router)
app.include_router(notes.router)
app.include_router(web_embed.router)


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


# --- 앱 버전 확인 (설계 §4.16) ---
# 이미 열려 있는 탭은 서버를 재시작하고 새로 빌드해도 **옛 JS를 그대로 실행**한다
# (새로고침 전까지 화면만 구버전 — 2026-07-26 실사용 확인). 실행 중인 번들 파일명과
# 서버가 지금 서빙하는 번들 파일명을 비교할 수 있게 후자를 알려준다. 빌드마다 파일명
# 해시가 바뀌므로 별도 버전 파일·빌드 상수 없이 이것만으로 판별된다.
_ASSET_SRC_RE = re.compile(r'src="[^"]*/assets/(index-[A-Za-z0-9_-]+\.js)"')

# 앱 버전의 단일 출처는 루트 `VERSION` 파일(stage-45 결정 ④ — 발행 시에만 갱신).
# 기동 시 1회 읽는다 — 부재·읽기 실패는 null 허용(표시용 부가 정보라 앱 동작과 무관).
VERSION_FILE = Path(__file__).resolve().parent.parent / "VERSION"
try:
    APP_VERSION: str | None = VERSION_FILE.read_text(encoding="utf-8").strip() or None
except OSError:
    APP_VERSION = None


@app.get("/api/app-version", include_in_schema=False)
async def get_app_version():
    asset: str | None = None
    if INDEX_HTML.exists():
        try:
            m = _ASSET_SRC_RE.search(INDEX_HTML.read_text(encoding="utf-8"))
            asset = m.group(1) if m else None
        except OSError:
            asset = None
    return {"asset": asset, "version": APP_VERSION}


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


# 아래 두 상수·해시 계산은 frontend/scripts/source-hash.mjs 와 **동일 알고리즘**이어야 한다
# (입력 목록 · CRLF→LF 정규화 · `상대경로\0내용\0` 연결 · sha256). 한쪽을 바꾸면 반드시 같이 바꿀 것.
# 경고 전용 복제라 어긋나도 피해는 오탐/미탐 안내 한 줄이다(빌드 판정의 정본은 여전히 mjs 쪽).
_HASH_INPUT_DIRS = ("src", "public")
_HASH_INPUT_FILES = (
    "index.html",
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "tailwind.config.js",
    "postcss.config.js",
)


def _compute_frontend_source_hash() -> str:
    frontend = FRONTEND_SRC.parent
    files: list[Path] = []
    for d in _HASH_INPUT_DIRS:
        p = frontend / d
        if p.exists():
            files.extend(q for q in p.rglob("*") if q.is_file())
    for f in _HASH_INPUT_FILES:
        p = frontend / f
        if p.exists():
            files.append(p)
    rel = sorted(p.relative_to(frontend).as_posix() for p in files)
    h = hashlib.sha256()
    for r in rel:
        h.update(r.encode("utf-8"))
        h.update(b"\0")
        h.update((frontend / r).read_bytes().replace(b"\r\n", b"\n"))
        h.update(b"\0")
    return h.hexdigest()


def _warn_if_frontend_stale() -> None:
    """dist 빌드가 소스와 다르면 기동 로그에 눈에 띄게 알린다.

    배포 빌드(dist)를 FastAPI가 그대로 서빙하므로, 프론트 코드를 고치고 `npm run build`를
    빠뜨리면 **서버는 최신인데 화면만 옛 버전**이 된다(2026-07-26 실사용: dist가 하루 이상
    묵어 새 화면이 없는 채로 운영됨). 서버가 빌드를 대신 실행하지는 않는다 — 안내만 하고,
    자동 빌드는 시작 스크립트 3종(`ensure-frontend-build.ps1`)이 담당한다.

    판정은 시작 스크립트와 같은 소스 내용 해시 vs `dist/.source-hash` 스탬프다. 종전 mtime
    비교는 git pull/체크아웃이 파일 시각을 다시 써 **빌드가 최신인데도 오탐**을 냈다
    (2026-09-01 실사용 보고 — 자동 빌드가 안 도는 것처럼 보이게 한 원인). 경고 전용이므로
    어떤 실패든 조용히 넘어간다.
    """
    if not INDEX_HTML.exists():
        print("[!] frontend/dist 없음 - 화면이 뜨지 않습니다. frontend 폴더에서 `npm run build`를 실행하세요.")
        return
    if not FRONTEND_SRC.exists():
        return
    stamp = FRONTEND_DIST / ".source-hash"
    try:
        recorded = stamp.read_text(encoding="utf-8").strip() if stamp.exists() else ""
        if recorded and recorded == _compute_frontend_source_hash():
            return
    except OSError:
        return
    if recorded:
        print(
            "[!] frontend 소스가 마지막 빌드 이후 변경됐습니다 - 화면에 최신 변경이 반영되지 않습니다.\n"
            "    시작 스크립트(1_Setup/2_StartServer/Dev_StartServer)로 실행하면 자동 빌드됩니다.\n"
            "    수동: frontend 폴더에서 `npm run build` 후 새로고침."
        )
    else:
        print(
            "[!] frontend/dist 에 빌드 스탬프(.source-hash)가 없습니다 - 옛 빌드일 수 있습니다.\n"
            "    frontend 폴더에서 `npm run build`를 한 번 실행하면 스탬프가 기록됩니다."
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
