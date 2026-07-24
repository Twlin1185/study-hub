"""Claude CLI 연동 변환·재생성 (F23·F30, 계획서 §13-B, 설계 §4.10).

엔진: `claude -p --output-format json` 서브프로세스(R9 — CLI headless). 잡은 인메모리 +
TTL(1시간)로 관리하며(서버 재시작 시 소실 허용 — 로컬 개인용), **동시 1개**만 실행되도록
전용 워커 스레드 1개가 큐를 순차 소비한다(convert·regenerate 공용 — 지시서 요구사항).

claude CLI가 없거나 실패하면 ClaudeCliError로 명확히 실패시키고, 라우터가 이를
CONFLICT/에러로 변환해 "수동 반입(A방식)"을 안내할 수 있게 한다.
"""
from __future__ import annotations

import datetime as dt
import json
import queue
import re
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

import models
from database import BASE_DIR, SessionLocal
from exceptions import ConflictError, NotFoundError, ValidationAppError
from schemas.import_schema import PreviewResponse
from services import document_service, import_service, tag_rule_service

PROMPTS_DIR = BASE_DIR / "prompts"
CONVERT_PROMPT_PATH = PROMPTS_DIR / "convert.md"
CONVERT_TMP_DIR = BASE_DIR / "convert_tmp"

DEFAULT_TIMEOUT_SECONDS = 600  # 기본 10분 (지시서)
JOB_TTL = dt.timedelta(hours=1)

_JOBS: Dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()
_QUEUE: "queue.Queue[str]" = queue.Queue()
_WORKER_LOCK = threading.Lock()
_WORKER_STARTED = False


class ClaudeCliError(Exception):
    """claude CLI 실행 실패/부재 — 사용자에게 그대로 노출해도 되는 명확한 메시지."""


# ---------------------------------------------------------------------------
# claude CLI 실행
# ---------------------------------------------------------------------------
def _find_claude_executable() -> str:
    for name in ("claude", "claude.exe", "claude.cmd"):
        path = shutil.which(name)
        if path:
            return path
    raise ClaudeCliError(
        "claude CLI를 찾을 수 없습니다. Claude Code가 설치되어 PATH에 등록돼 있는지 확인하세요. "
        "설치 전까지는 반입 화면에서 JSON을 직접 만들어 수동으로 반입해 주세요(A방식)."
    )


def _run_claude_cli(prompt: str, *, timeout_seconds: int) -> str:
    exe = _find_claude_executable()
    args = [exe, "-p", "--output-format", "json", "--permission-mode", "bypassPermissions"]
    try:
        proc = subprocess.run(
            args,
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            cwd=str(BASE_DIR),
        )
    except FileNotFoundError as exc:
        raise ClaudeCliError(f"claude CLI 실행 파일을 찾지 못했습니다: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise ClaudeCliError(
            f"claude CLI 실행이 {timeout_seconds}초 내에 끝나지 않았습니다(타임아웃). "
            "파일이 너무 크거나 응답이 지연되고 있을 수 있습니다."
        ) from exc

    if proc.returncode != 0:
        raise ClaudeCliError(
            f"claude CLI 실행 실패(exit={proc.returncode}): "
            f"{(proc.stderr or proc.stdout or '').strip()[:4000]}"
        )
    return proc.stdout


def _extract_text_result(cli_stdout: str) -> str:
    """`--output-format json`은 실행 메타데이터로 감싼 봉투를 낸다:
    {"type":"result","subtype":"success","is_error":bool,"result":"<본문 텍스트>",...}
    본문(result)을 꺼낸다. 예상과 다른 출력이면 원문을 그대로 반환해 아래 JSON 파싱
    단계가 실패 사유를 명확히 낼 수 있게 한다."""
    try:
        envelope = json.loads(cli_stdout)
    except (json.JSONDecodeError, TypeError):
        return cli_stdout
    if isinstance(envelope, dict) and "result" in envelope:
        if envelope.get("is_error"):
            raise ClaudeCliError(
                f"claude 실행 결과가 오류를 반환했습니다: {str(envelope.get('result'))[:2000]}"
            )
        result = envelope.get("result")
        return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
    return cli_stdout


def _parse_json_payload(text: str) -> Any:
    """앞뒤 설명·코드펜스가 섞여 있어도 최대한 JSON 하나를 뽑아낸다."""
    cleaned = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ValidationAppError(
                "claude 출력이 올바른 JSON이 아닙니다", detail={"raw": cleaned[:2000]}
            ) from exc
    raise ValidationAppError(
        "claude 출력에서 JSON을 찾을 수 없습니다", detail={"raw": cleaned[:2000]}
    )


def _safe_name(name: str) -> str:
    base = Path(name).name.replace("\\", "_").replace("/", "_").strip()
    return base or "source"


# ---------------------------------------------------------------------------
# 잡 큐 (convert·regenerate 공용, 동시 1개)
# ---------------------------------------------------------------------------
def _purge_expired_jobs() -> None:
    now = dt.datetime.now()
    with _JOBS_LOCK:
        stale = [jid for jid, job in _JOBS.items() if now - job["created_at"] > JOB_TTL]
        for jid in stale:
            _JOBS.pop(jid, None)


def _ensure_worker() -> None:
    global _WORKER_STARTED
    with _WORKER_LOCK:
        if not _WORKER_STARTED:
            thread = threading.Thread(target=_worker_loop, daemon=True, name="convert-worker")
            thread.start()
            _WORKER_STARTED = True


def _worker_loop() -> None:
    while True:
        job_id = _QUEUE.get()
        _process_job(job_id)


def _process_job(job_id: str) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None:
        return  # TTL 만료로 이미 지워졌으면 조용히 무시
    try:
        if job["kind"] == "convert":
            result = _do_convert(job)
        else:
            result = _do_regenerate(job)
        with _JOBS_LOCK:
            job = _JOBS.get(job_id)
            if job is not None:
                job["status"] = "done"
                job["result"] = result
    except Exception as exc:  # noqa: BLE001 - 잡 실패를 기록하고 워커는 계속 돈다
        with _JOBS_LOCK:
            job = _JOBS.get(job_id)
            if job is not None:
                job["status"] = "error"
                job["error"] = str(exc)
    finally:
        tmp_path = job.get("_tmp_path") if job else None
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# 변환(F23) — 원본 파일 업로드 → claude CLI → 반입 preview로 자동 연결
# ---------------------------------------------------------------------------
def _do_convert(job: dict) -> dict:
    cli_stdout = _run_claude_cli(job["_prompt"], timeout_seconds=job["_timeout"])
    text_result = _extract_text_result(cli_stdout)
    payload = _parse_json_payload(text_result)
    json_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    db = SessionLocal()
    try:
        preview: PreviewResponse = import_service.create_preview(
            db,
            json_bytes=json_bytes,
            source_filename=job.get("_source_filename"),
            source_bytes=job.get("_source_bytes"),
        )
    finally:
        db.close()
    return {"result_preview_id": preview.preview_id}


def start_convert_job(
    *,
    upload_filename: str,
    upload_bytes: bytes,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> str:
    _purge_expired_jobs()
    if not CONVERT_PROMPT_PATH.exists():
        raise ValidationAppError(
            "prompts/convert.md 프롬프트 파일을 찾을 수 없습니다",
            detail={"path": str(CONVERT_PROMPT_PATH)},
        )
    convert_md = CONVERT_PROMPT_PATH.read_text(encoding="utf-8")

    CONVERT_TMP_DIR.mkdir(exist_ok=True)
    job_id = f"cvt_{uuid.uuid4().hex[:8]}"
    tmp_path = CONVERT_TMP_DIR / f"{job_id}_{_safe_name(upload_filename)}"
    tmp_path.write_bytes(upload_bytes)

    prompt = (
        f"{convert_md}\n\n---\n\n"
        "## 이번 변환 대상\n"
        f"다음 경로의 원본 파일을 위 지시(§0~§8)에 따라 반입 JSON으로 변환하라.\n"
        f"파일 경로: {tmp_path.resolve()}\n"
        "Read 도구로 파일을 직접 읽어 내용을 파악하라(PDF·이미지 포함). "
        "최종 출력은 설명 문장·코드펜스 없이 순수 JSON 객체 하나만 출력하라."
    )

    with _JOBS_LOCK:
        _JOBS[job_id] = {
            "kind": "convert",
            "status": "running",
            "created_at": dt.datetime.now(),
            "document_id": None,
            "result": None,
            "error": None,
            "_prompt": prompt,
            "_timeout": timeout_seconds,
            "_source_filename": upload_filename,
            "_source_bytes": upload_bytes,
            "_tmp_path": str(tmp_path),
        }
    _ensure_worker()
    _QUEUE.put(job_id)
    return job_id


def get_convert_job(job_id: str) -> dict:
    _purge_expired_jobs()
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None or job["kind"] != "convert":
            raise NotFoundError(
                "변환 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"job_id": job_id}
            )
        result = job.get("result") or {}
        return {
            "job_id": job_id,
            "status": job["status"],
            "result_preview_id": result.get("result_preview_id"),
            "error": job.get("error"),
        }


# ---------------------------------------------------------------------------
# 재생성(F30) — 문제 오류 신고 → 해당 문서만 재생성 초안 → 비교 → 승인 교체
# ---------------------------------------------------------------------------
def _build_regenerate_prompt(
    document: models.Document,
    tags: List[str],
    choices: Optional[List[str]],
    reason: str,
    source_note: Optional[str],
) -> str:
    lines = [
        "너는 Study Hub의 문서 재생성기다. 아래 기존 문서에 오류 신고가 접수되었다.",
        "신고 사유를 반영해 문서를 다시 작성하라. 없는 정보를 지어내지 말고,",
        "신고와 무관한 부분은 최대한 원래 내용을 보존하라(전면 재작성 금지).",
        "",
        "## 기존 문서",
        f"- id: {document.id}, doc_no: {document.doc_no}, type: {document.type}",
        f"- title: {document.title}",
        f"- content:\n{document.content or '(없음)'}",
        f"- choices: {json.dumps(choices, ensure_ascii=False) if choices else '(없음)'}",
        f"- answer: {document.answer or '(없음)'}",
        f"- explanation: {document.explanation or '(없음)'}",
        f"- difficulty: {document.difficulty if document.difficulty is not None else '(없음)'}",
        f"- tags: {', '.join(tags) if tags else '(없음)'}",
        "",
        "## 신고 사유",
        reason,
    ]
    if source_note:
        lines += [
            "",
            "## 원본 출처",
            source_note,
            "원본 파일이 프로젝트 안에 있으면 Read 도구로 직접 읽어 대조하라(R7 — 원본 대조).",
        ]
    lines += [
        "",
        "## 출력 형식(엄수)",
        "코드펜스·설명 문장 없이, 아래 필드를 가진 JSON 객체 하나만 출력하라:",
        '{"title": "...", "content": "...", "choices": ["...", ...] | null, '
        '"answer": "..." | null, "explanation": "..." | null, "difficulty": 1~5 | null, '
        '"tags": ["...", ...]}',
        "개념(concept) 문서처럼 정답이 없는 타입이면 choices/answer는 null로 둔다.",
        "type은 바꾸지 않는다 — 이 문서는 계속 같은 type이다.",
    ]
    return "\n".join(lines)


def _normalize_regenerate_draft(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValidationAppError("재생성 결과가 JSON 객체가 아닙니다")

    def _opt_str(key: str) -> Optional[str]:
        value = payload.get(key)
        return value if isinstance(value, str) else None

    choices = payload.get("choices")
    if choices is not None and not (
        isinstance(choices, list) and all(isinstance(c, str) for c in choices)
    ):
        raise ValidationAppError("재생성 결과의 'choices'는 문자열 배열이어야 합니다")

    difficulty = payload.get("difficulty")
    if difficulty is not None and (
        not isinstance(difficulty, int) or isinstance(difficulty, bool) or not (1 <= difficulty <= 5)
    ):
        difficulty = None  # 애매하면 비워둔다(§2 규칙과 동일 원칙)

    tags = payload.get("tags") or []
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        tags = []
    norm_tags: List[str] = []
    seen = set()
    for t in tags:
        clean = t.strip()
        if clean and clean not in seen:
            seen.add(clean)
            norm_tags.append(clean)

    return {
        "title": _opt_str("title"),
        "content": _opt_str("content"),
        "choices": choices,
        "answer": _opt_str("answer"),
        "explanation": _opt_str("explanation"),
        "difficulty": difficulty,
        "tags": norm_tags,
    }


def _do_regenerate(job: dict) -> dict:
    cli_stdout = _run_claude_cli(job["_prompt"], timeout_seconds=job["_timeout"])
    text_result = _extract_text_result(cli_stdout)
    payload = _parse_json_payload(text_result)
    draft = _normalize_regenerate_draft(payload)
    return {"draft": draft}


def start_regenerate_job(
    db: Session, document_id: int, reason: str, *, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS
) -> str:
    _purge_expired_jobs()
    document = document_service.get_document_or_404(db, document_id)
    tags = document_service._tags_for_document(db, document_id)
    choices = json.loads(document.choices) if document.choices else None

    source_note: Optional[str] = None
    if document.source_id is not None:
        source = db.get(models.Source, document.source_id)
        if source is not None:
            note_part = f" ({source.note})" if source.note else ""
            source_note = f"원본 파일: sources/{source.filename}{note_part}"
    if document.source_detail:
        source_note = f"{source_note + chr(10) if source_note else ''}원본 위치: {document.source_detail}"

    prompt = _build_regenerate_prompt(document, tags, choices, reason, source_note)

    job_id = f"rgn_{uuid.uuid4().hex[:8]}"
    with _JOBS_LOCK:
        _JOBS[job_id] = {
            "kind": "regenerate",
            "status": "running",
            "created_at": dt.datetime.now(),
            "document_id": document_id,
            "result": None,
            "error": None,
            "_prompt": prompt,
            "_timeout": timeout_seconds,
            "_tmp_path": None,
        }
    _ensure_worker()
    _QUEUE.put(job_id)
    return job_id


def get_regenerate_job(document_id: int, job_id: str) -> dict:
    _purge_expired_jobs()
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None or job["kind"] != "regenerate" or job["document_id"] != document_id:
        raise NotFoundError(
            "재생성 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"job_id": job_id}
        )
    result = job.get("result") or {}
    return {
        "job_id": job_id,
        "status": job["status"],
        "draft": result.get("draft"),
        "error": job.get("error"),
    }


def apply_regenerate_job(db: Session, document_id: int, job_id: str) -> models.Document:
    """초안 승인 — 기존 문서를 PATCH 방식으로 교체. 같은 id·doc_no 유지(불변 규칙 —
    attempts·오답노트·SRS 이력 보존). 자동 덮어쓰기 없음(R7) — 이 함수 호출이 유일한 승인 경로."""
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None or job["kind"] != "regenerate" or job["document_id"] != document_id:
        raise NotFoundError(
            "재생성 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"job_id": job_id}
        )
    if job["status"] == "running":
        raise ConflictError("재생성 작업이 아직 진행 중입니다", detail={"status": job["status"]})
    if job["status"] == "error":
        raise ConflictError(
            "재생성 작업이 실패했습니다. 새로 신고해 다시 시도하세요",
            detail={"error": job.get("error")},
        )
    draft = (job.get("result") or {}).get("draft")
    if not draft:
        raise ConflictError("재생성 초안이 없습니다")

    document = document_service.get_document_or_404(db, document_id)
    if draft.get("title"):
        document.title = draft["title"]
    document.content = draft.get("content")
    document.choices = (
        json.dumps(draft["choices"], ensure_ascii=False) if draft.get("choices") else None
    )
    document.answer = draft.get("answer")
    document.explanation = draft.get("explanation")
    document.difficulty = draft.get("difficulty")

    document_service._apply_tag_replacement(db, document, draft.get("tags") or [])
    tag_rule_service.scan_document(db, document.id)

    db.commit()
    db.refresh(document)

    with _JOBS_LOCK:
        _JOBS.pop(job_id, None)  # 적용 완료된 잡은 캐시에서 제거(재적용 방지)

    return document
