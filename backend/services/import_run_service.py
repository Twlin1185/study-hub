"""반입 건(import runs) — 영속·타임라인·레거시 이관 (S56 — F63 · M40 · R48, 설계 §4.34).

잡 큐(§4.10·§4.24 — 인메모리·TTL 1h·동시 1개)·미리보기(§4.3 — TTL 1h + `import/auto/`
50건 R18)·분할(§4.25)은 **무변** — 이 모듈은 그 위에 "반입 1건"의 영속 실체(run)를 얹는다.
run은 포인터(`job_id`·`preview_id`·`split_id`·`answer_key_id`)와 요약(`summary_json`)만 들고
preview 본문은 테이블화하지 않는다.

두 종류의 진입점:
  ① 같은 세션 함수(`create_run`·`record_event`·`set_status`·`mark_committed`·
     `mark_answer_key_applied` 등) — flush만 하고 commit은 호출자 몫. 커밋·답지 적용 훅은
     호출자의 기존 `db.commit()` 1회에 포함된다(불변 규칙 2 관례 — 실패 시 run 미갱신).
  ② 워커 훅(`hook_*`) — 잡 워커 스레드에서 호출. 별도 세션(`_new_session()`)을 열고 전부
     try/except + 경고 로그(best-effort — 잡 결과 무영향 · 설계 §4.34 ③).

응답 직렬화(`run_to_dict`·`event_to_dict`)는 id·수치·서버 완성 문구만 싣는다 — 정답·해설·
LLM 산출 원문 필드 0(불변 규칙 1).
"""
from __future__ import annotations

import datetime as dt
import json
import logging
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from exceptions import ConflictError, NotFoundError

_LOGGER = logging.getLogger(__name__)

RUN_KINDS = ("convert_file", "convert_url", "fetch", "json_upload", "answer_key")
RUN_STATUSES = (
    "queued",
    "converting",
    "splitting",
    "review_ready",
    "committing",
    "committed",
    "failed",
    "cancelled",
    "expired",
)
IN_PROGRESS_STATUSES = ("queued", "converting", "splitting", "committing")

# 워커 훅이 여는 세션 팩토리 — 기본은 database.SessionLocal(현행 워커 관례 convert_service
# `_handle_engine_failure`). 테스트는 이 값을 인메모리 세션 팩토리로 바꾼다(실 study.db 무접촉).
_session_factory: Optional[Callable[[], Session]] = None


def _new_session() -> Session:
    if _session_factory is not None:
        return _session_factory()
    from database import SessionLocal

    return SessionLocal()


def _utcnow() -> dt.datetime:
    """SQLite CURRENT_TIMESTAMP(서버 기본값 — UTC)와 같은 기준의 naive 시각."""
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def _iso(value: Optional[dt.datetime]) -> Optional[str]:
    return value.isoformat() if value is not None else None


# ---------------------------------------------------------------------------
# summary_json — 서버가 쓰고 서버가 읽는 JSON(§4.34 ① · 정답·해설 0)
# ---------------------------------------------------------------------------
def _empty_summary() -> dict:
    return {"previews": [], "commits": [], "document_ids": [], "category_ids": []}


def load_summary(run: models.ImportRun) -> dict:
    summary = _empty_summary()
    if run.summary_json:
        try:
            data = json.loads(run.summary_json)
        except (TypeError, ValueError):
            data = None
        if isinstance(data, dict):
            summary.update(data)
    for key in ("previews", "commits", "document_ids", "category_ids"):
        if not isinstance(summary.get(key), list):
            summary[key] = []
    return summary


def _save_summary(run: models.ImportRun, summary: dict) -> None:
    run.summary_json = json.dumps(summary, ensure_ascii=False)


def _union_ints(base: Iterable[Any], extra: Iterable[Any]) -> List[int]:
    out: List[int] = []
    for value in list(base) + list(extra):
        if isinstance(value, int) and value not in out:
            out.append(value)
    return out


# ---------------------------------------------------------------------------
# 같은 세션 기본 연산(flush만 — commit은 호출자)
# ---------------------------------------------------------------------------
def _touch(run: models.ImportRun) -> None:
    # 이벤트만 추가돼도 목록 정렬(updated_at DESC)이 따라오도록 명시 갱신 — onupdate는
    # 행이 실제로 UPDATE될 때만 동작한다(값을 같이 바꾸면 onupdate 대신 이 값이 쓰인다).
    run.updated_at = _utcnow()


def create_run(
    db: Session,
    *,
    kind: str,
    label: str,
    status: str,
    source_name: Optional[str] = None,
    source_url: Optional[str] = None,
    category_path: Optional[str] = None,
    event_type: str = "created",
    event_message: Optional[str] = None,
    event_detail: Optional[dict] = None,
    summary: Optional[dict] = None,
    **ids: Any,
) -> models.ImportRun:
    """run 1행 + 첫 이벤트(`created` 기본)를 같은 세션에 추가하고 flush한다.
    `ids` = `job_id`·`preview_id`·`split_id`·`answer_key_id`(선택)."""
    run = models.ImportRun(
        kind=kind,
        label=label,
        source_name=source_name,
        source_url=source_url,
        category_path=category_path,
        status=status,
        job_id=ids.get("job_id"),
        preview_id=ids.get("preview_id"),
        split_id=ids.get("split_id"),
        answer_key_id=ids.get("answer_key_id"),
        is_active=1,
    )
    _save_summary(run, summary or _empty_summary())
    db.add(run)
    db.flush()
    record_event(
        db,
        run.id,
        event_type,
        event_message or f"{label} — 접수했습니다",
        event_detail,
        run=run,
    )
    return run


def record_event(
    db: Session,
    run_id: int,
    type: str,  # noqa: A002 - 설계 컬럼명 그대로
    message: str,
    detail: Optional[dict] = None,
    *,
    run: Optional[models.ImportRun] = None,
) -> models.ImportRunEvent:
    event = models.ImportRunEvent(
        run_id=run_id,
        at=_utcnow(),
        type=type,
        message=message,
        detail_json=json.dumps(detail, ensure_ascii=False) if detail else None,
    )
    db.add(event)
    target = run if run is not None else db.get(models.ImportRun, run_id)
    if target is not None:
        _touch(target)
    db.flush()
    return event


def set_status(db: Session, run_id: int, status: str, **fields: Any) -> Optional[models.ImportRun]:
    run = db.get(models.ImportRun, run_id)
    if run is None:
        return None
    run.status = status
    for key, value in fields.items():
        setattr(run, key, value)
    _touch(run)
    db.flush()
    return run


def find_by_job_id(db: Session, job_id: str) -> Optional[models.ImportRun]:
    if not job_id:
        return None
    return db.scalars(
        select(models.ImportRun)
        .where(models.ImportRun.job_id == job_id)
        .order_by(models.ImportRun.id.desc())
    ).first()


def find_by_split_id(db: Session, split_id: str) -> Optional[models.ImportRun]:
    if not split_id:
        return None
    return db.scalars(
        select(models.ImportRun)
        .where(models.ImportRun.split_id == split_id)
        .order_by(models.ImportRun.id.desc())
    ).first()


def find_by_answer_key_id(db: Session, key_id: str) -> Optional[models.ImportRun]:
    if not key_id:
        return None
    return db.scalars(
        select(models.ImportRun)
        .where(models.ImportRun.answer_key_id == key_id)
        .order_by(models.ImportRun.id.desc())
    ).first()


def find_by_preview_id(db: Session, preview_id: str) -> Optional[models.ImportRun]:
    """preview_id → run 역조회 — `import_runs.preview_id` 일치 ∪ 분할 run의
    `summary.previews[]` 포함(활성 run 중 `split_id IS NOT NULL`만 Python 측 스캔 · 소량).
    없으면 None(레거시 preview — 훅 조용히 생략)."""
    if not preview_id:
        return None
    run = db.scalars(
        select(models.ImportRun)
        .where(models.ImportRun.preview_id == preview_id)
        .order_by(models.ImportRun.id.desc())
    ).first()
    if run is not None:
        return run
    split_runs = db.scalars(
        select(models.ImportRun)
        .where(models.ImportRun.split_id.is_not(None), models.ImportRun.is_active == 1)
        .order_by(models.ImportRun.id.desc())
    ).all()
    for candidate in split_runs:
        for entry in load_summary(candidate)["previews"]:
            if isinstance(entry, dict) and entry.get("preview_id") == preview_id:
                return candidate
    return None


def find_run_id_safely(finder: Callable[[], Optional[models.ImportRun]]) -> Optional[int]:
    """역조회 best-effort — 실패(세션 없음·DB 오류) = None(연결 없이 원 흐름 진행)."""
    try:
        run = finder()
    except Exception:  # noqa: BLE001 - 역조회 실패가 잡 시작을 막으면 안 된다
        _LOGGER.warning("반입 건 역조회 실패(연결 없이 진행)", exc_info=True)
        return None
    return run.id if run is not None else None


def chunks_total(db: Session, run_id: Optional[int]) -> int:
    """분할 run에 지금까지 투입된 조각 수(summary.chunks_total) — enqueue 조각 번호의 기준."""
    if run_id is None:
        return 0
    run = db.get(models.ImportRun, run_id)
    if run is None:
        return 0
    value = load_summary(run).get("chunks_total")
    return value if isinstance(value, int) else 0


def attach_preview(
    db: Session, run_id: int, preview_id: str, chunk_index: Optional[int] = None
) -> Optional[models.ImportRun]:
    """완료 preview를 run에 붙인다 — 비분할 run은 `preview_id` 컬럼, 분할 run은
    `summary.previews[]` 누적(병합 preview가 생기기 전까지 컬럼은 비워 둔다 — §6.2 주석)."""
    run = db.get(models.ImportRun, run_id)
    if run is None:
        return None
    summary = load_summary(run)
    previews = summary["previews"]
    if not any(isinstance(p, dict) and p.get("preview_id") == preview_id for p in previews):
        entry: Dict[str, Any] = {"preview_id": preview_id}
        if chunk_index is not None:
            entry["chunk_index"] = chunk_index
        previews.append(entry)
    _save_summary(run, summary)
    if run.split_id is None:
        run.preview_id = preview_id
    _touch(run)
    db.flush()
    return run


# ---------------------------------------------------------------------------
# 커밋·답지 적용 훅 — 호출자 트랜잭션 안(flush만)
# ---------------------------------------------------------------------------
def _committed_message(created: int, merged: int, skipped: int, prefix: str = "반입을 마쳤습니다") -> str:
    return f"{prefix} — 새 문서 {created}건 · 병합 {merged}건 · 건너뜀 {skipped}건"


def mark_committed(
    db: Session,
    preview_id: str,
    result: Any,
    *,
    document_ids: Sequence[int] = (),
    category_ids: Sequence[int] = (),
    errored: int = 0,
) -> Optional[models.ImportRun]:
    """`commit_import` 성공 직전(같은 세션 · `db.commit()` 1회 이전) — run 전이 기록.
    flush만 한다(commit은 호출자). 역조회 실패 = None(레거시 preview — 조용히 생략).

    비분할 run = 즉시 `committed` + `committed_at` · 분할 run = 조각 커밋마다 이벤트 +
    `previews[].committed_at` · 전 조각(또는 병합 preview) 커밋 완료 시 `committed`."""
    run = find_by_preview_id(db, preview_id)
    if run is None:
        return None
    created = int(getattr(result, "created", 0) or 0)
    merged = int(getattr(result, "merged", 0) or 0)
    skipped = int(getattr(result, "skipped", 0) or 0)
    doc_ids = [int(d) for d in document_ids]
    cat_ids = [int(c) for c in category_ids]
    now = _utcnow()

    summary = load_summary(run)
    commit_entry = {
        "preview_id": preview_id,
        "created": created,
        "merged": merged,
        "skipped": skipped,
        "errored": int(errored),
        "document_ids": doc_ids,
        "category_ids": cat_ids,
    }
    summary["commits"].append(commit_entry)
    summary["document_ids"] = _union_ints(summary["document_ids"], doc_ids)
    summary["category_ids"] = _union_ints(summary["category_ids"], cat_ids)

    done = True
    message = _committed_message(created, merged, skipped)
    for entry in summary["previews"]:  # 비분할·병합 preview도 해당 항목에 커밋 시각 기록
        if isinstance(entry, dict) and entry.get("preview_id") == preview_id:
            entry["committed_at"] = now.isoformat()
    if run.split_id is not None and preview_id != run.preview_id:
        # 분할 조각 preview 커밋 — 해당 조각에 committed_at 기록 후 전 조각 완료 판정.
        chunk_index: Optional[int] = None
        for entry in summary["previews"]:
            if isinstance(entry, dict) and entry.get("preview_id") == preview_id:
                entry["committed_at"] = now.isoformat()
                chunk_index = entry.get("chunk_index")
        total = summary.get("chunks_total") if isinstance(summary.get("chunks_total"), int) else 0
        failed = summary.get("chunks_failed") if isinstance(summary.get("chunks_failed"), int) else 0
        previews = [p for p in summary["previews"] if isinstance(p, dict)]
        committed_count = sum(1 for p in previews if p.get("committed_at"))
        all_previews_committed = bool(previews) and committed_count == len(previews)
        done = all_previews_committed and committed_count + failed >= max(total, len(previews))
        if chunk_index is not None and total:
            message = _committed_message(
                created, merged, skipped, prefix=f"조각 {chunk_index}/{total} 반입을 마쳤습니다"
            )
        else:
            message = _committed_message(created, merged, skipped, prefix="조각 반입을 마쳤습니다")
    _save_summary(run, summary)
    if done:
        run.status = "committed"
        run.committed_at = now
    _touch(run)
    record_event(db, run.id, "committed", message, commit_entry, run=run)
    db.flush()
    return run


def mark_answer_key_applied(
    db: Session, key_id: str, *, applied: int, document_ids: Sequence[int]
) -> Optional[models.ImportRun]:
    """`apply_answer_key` 성공 직전(같은 세션 · flush만) — `review_ready → committed`."""
    run = find_by_answer_key_id(db, key_id)
    if run is None:
        return None
    doc_ids = [int(d) for d in document_ids]
    summary = load_summary(run)
    summary["document_ids"] = _union_ints(summary["document_ids"], doc_ids)
    _save_summary(run, summary)
    run.status = "committed"
    run.committed_at = _utcnow()
    record_event(
        db,
        run.id,
        "answer_key_applied",
        f"답지를 적용했습니다 — 문서 {applied}건",
        {"applied": int(applied), "document_ids": doc_ids},
        run=run,
    )
    return run


# ---------------------------------------------------------------------------
# 요청 흐름 best-effort 훅(같은 db 세션 · 실패 시 롤백 + 경고 — 원 흐름 무영향)
# ---------------------------------------------------------------------------
def _best_effort(db: Session, what: str, fn: Callable[[], Any]) -> Any:
    try:
        out = fn()
        db.commit()
        return out
    except Exception:  # noqa: BLE001 - run 기록 실패가 원 흐름을 막으면 안 된다
        db.rollback()
        _LOGGER.warning("반입 건 기록 실패(%s — 원 흐름 영향 없음)", what, exc_info=True)
        return None


def open_run(db: Session, **kwargs: Any) -> Optional[int]:
    """시작 API용 — `create_run` + commit. 실패 시 None(시작 자체는 계속 — run_id 없이)."""

    def _do() -> int:
        return create_run(db, **kwargs).id

    return _best_effort(db, "create_run", _do)


def abandon_run(db: Session, run_id: Optional[int], message: str) -> None:
    """시작 API가 run을 연 뒤 잡 등록 자체가 거부된 경우(엔진 미가용 등 동기 오류) —
    사용자는 이미 에러 응답을 받으므로 목록에서 감춘다(소프트 · 상태 failed)."""
    if run_id is None:
        return

    def _do() -> None:
        run = set_status(db, run_id, "failed", error_message=message, is_active=0)
        if run is not None:
            record_event(db, run_id, "job_failed", f"작업을 시작하지 못했습니다 — {message}", None, run=run)

    _best_effort(db, "abandon_run", _do)


def note_split_started(
    db: Session,
    *,
    run_id: Optional[int],
    split_id: str,
    chunks: int,
    kind: str,
    label: str,
    source_name: Optional[str],
    source_url: Optional[str],
) -> Optional[int]:
    """`POST /api/import/split` 성공 — 기존 run 연결 또는 신설 + `split_started`."""
    message = f"분할 반입을 시작했습니다 — 조각 {chunks}개 제안"
    detail = {"split_id": split_id, "chunks": chunks}

    def _do() -> int:
        if run_id is not None:
            run = set_status(db, run_id, "splitting", split_id=split_id, error_kind=None, error_message=None)
            if run is None:
                raise NotFoundError("반입 건을 찾을 수 없습니다", detail={"run_id": run_id})
            record_event(db, run_id, "split_started", message, detail, run=run)
            return run_id
        run = create_run(
            db,
            kind=kind,
            label=label,
            status="splitting",
            source_name=source_name,
            source_url=source_url,
            split_id=split_id,
        )
        record_event(db, run.id, "split_started", message, detail, run=run)
        return run.id

    return _best_effort(db, "split_started", _do)


def assert_split_attachable(db: Session, run_id: int) -> None:
    """`split?run_id=` 연결 허용 = `failed` + `error_kind='too_large'`만(§4.34 ② · ⑤)."""
    run = db.get(models.ImportRun, run_id)
    if run is None:
        raise NotFoundError("반입 건을 찾을 수 없습니다", detail={"run_id": run_id})
    if run.status != "failed" or run.error_kind != "too_large":
        raise ConflictError(
            "이 반입 건은 분할 반입으로 이어갈 수 없습니다",
            detail={"reason": "bad_transition", "run_id": run_id, "status": run.status},
        )


def note_split_enqueued(db: Session, run_id: Optional[int], job_ids: Sequence[str]) -> None:
    if run_id is None:
        return

    def _do() -> None:
        run = db.get(models.ImportRun, run_id)
        if run is None:
            return
        summary = load_summary(run)
        base = summary.get("chunks_total") if isinstance(summary.get("chunks_total"), int) else 0
        summary["chunks_total"] = base + len(job_ids)
        _save_summary(run, summary)
        if job_ids:
            run.job_id = job_ids[-1]
        record_event(
            db,
            run_id,
            "split_enqueued",
            f"조각 {len(job_ids)}개를 변환 대기열에 넣었습니다",
            {"chunks": len(job_ids), "job_ids": list(job_ids)},
            run=run,
        )

    _best_effort(db, "split_enqueued", _do)


def note_preview_merged(db: Session, preview_ids: Sequence[str], merged_preview_id: str) -> None:
    def _do() -> None:
        run = None
        for pid in preview_ids:
            run = find_by_preview_id(db, pid)
            if run is not None:
                break
        if run is None:
            return
        run.preview_id = merged_preview_id
        record_event(
            db,
            run.id,
            "preview_merged",
            f"조각 미리보기 {len(preview_ids)}개를 하나로 합쳤습니다 — 미리보기에서 검토하세요",
            {"preview_ids": list(preview_ids), "merged_preview_id": merged_preview_id},
            run=run,
        )

    _best_effort(db, "preview_merged", _do)


def note_preview_recovered(db: Session, preview_id: str) -> None:
    def _do() -> None:
        run = find_by_preview_id(db, preview_id)
        if run is None:
            return
        record_event(
            db,
            run.id,
            "preview_recovered",
            "보존본에서 미리보기를 복구했습니다",
            {"preview_id": preview_id},
            run=run,
        )

    _best_effort(db, "preview_recovered", _do)


def note_job_assigned(db: Session, run_id: Optional[int], job_id: str) -> None:
    """답지 가공 등 run 생성 이후 잡이 붙는 경로 — `run.job_id` 갱신(이벤트 0)."""
    if run_id is None:
        return

    def _do() -> None:
        run = db.get(models.ImportRun, run_id)
        if run is not None:
            run.job_id = job_id
            _touch(run)

    _best_effort(db, "job_assigned", _do)


# ---------------------------------------------------------------------------
# 워커 훅 — 별도 세션 · best-effort(§4.34 ③ "잡 결과 무영향")
# ---------------------------------------------------------------------------
def _run_hook(what: str, fn: Callable[[Session], None]) -> None:
    db: Optional[Session] = None
    try:
        db = _new_session()
        fn(db)
        db.commit()
    except Exception:  # noqa: BLE001 - 훅 실패가 잡 처리를 막으면 안 된다
        if db is not None:
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass
        _LOGGER.warning("반입 건 훅 실패(%s — 잡 결과 영향 없음)", what, exc_info=True)
    finally:
        if db is not None:
            db.close()


_STARTED_MESSAGES = {
    "convert": "변환을 시작했습니다",
    "fetch": "사이트에서 받아 변환을 시작했습니다",
    "answer_key": "답지 가공을 시작했습니다",
    "split_analyze": "분할 정밀 분석을 시작했습니다",
}


def hook_job_started(run_id: int, *, job_id: str, job_kind: str, is_split_piece: bool) -> None:
    """워커 dequeue — `job_started` · `queued → converting`(분할 run = 이벤트만)."""

    def _do(db: Session) -> None:
        run = db.get(models.ImportRun, run_id)
        if run is None:
            return
        message = "조각 변환을 시작했습니다" if is_split_piece else _STARTED_MESSAGES.get(job_kind, "작업을 시작했습니다")
        # 다른 kind는 queued → converting만 · answer_key는 재가공(같은 key_id로 재실행) 경로라
        # review_ready·failed·cancelled에서도 converting으로 되돌린다.
        allowed = ("queued", "review_ready", "failed", "cancelled") if job_kind == "answer_key" else ("queued",)
        if run.split_id is None and run.status in allowed:
            run.status = "converting"
            run.error_kind = None
            run.error_message = None
        run.job_id = job_id
        record_event(db, run_id, "job_started", message, {"job_id": job_id}, run=run)

    _run_hook("job_started", _do)


def hook_job_done(
    run_id: int,
    *,
    job_id: str,
    job_kind: str,
    preview_id: Optional[str] = None,
    chunk_index: Optional[int] = None,
    chunks: Optional[int] = None,
) -> None:
    """`_process_job` done — convert·fetch → `preview_ready` · answer_key → `preview_ready`
    (매칭 결과 검토) · split_analyze → `split_analyzed`(상태 무변)."""

    def _do(db: Session) -> None:
        run = db.get(models.ImportRun, run_id)
        if run is None:
            return
        if job_kind == "split_analyze":
            record_event(
                db,
                run_id,
                "split_analyzed",
                f"분할 정밀 분석이 끝났습니다 — 조각 {chunks or 0}개",
                {"job_id": job_id, "chunks": chunks or 0},
                run=run,
            )
            return
        if job_kind == "answer_key":
            if run.status in ("queued", "converting"):
                run.status = "review_ready"
            record_event(
                db,
                run_id,
                "preview_ready",
                "답지 가공이 끝났습니다 — 매칭 결과를 검토하세요",
                {"job_id": job_id, "key_id": run.answer_key_id},
                run=run,
            )
            return
        if not preview_id:
            return
        attach_preview(db, run_id, preview_id, chunk_index)
        if run.status in ("queued", "converting", "splitting"):
            run.status = "review_ready"
        detail: Dict[str, Any] = {"job_id": job_id, "preview_id": preview_id}
        if chunk_index is not None:
            detail["chunk_index"] = chunk_index
            total = load_summary(run).get("chunks_total")
            suffix = f" {chunk_index}/{total}" if isinstance(total, int) and total else f" {chunk_index}"
            message = f"조각{suffix} 변환이 끝났습니다 — 미리보기에서 검토하세요"
        else:
            message = "변환이 끝났습니다 — 미리보기에서 검토하세요"
        record_event(db, run_id, "preview_ready", message, detail, run=run)

    _run_hook("job_done", _do)


def _split_piece_ended(run: models.ImportRun, final_status: str) -> None:
    """분할 조각 잡이 실패·취소로 끝남 — 조각 실패 수 누적. 산출 preview가 하나도 없고 전
    조각이 끝났으면 run 자체를 그 상태로 닫는다(남은 조각이 있으면 상태 무변)."""
    summary = load_summary(run)
    failed = summary.get("chunks_failed") if isinstance(summary.get("chunks_failed"), int) else 0
    summary["chunks_failed"] = failed + 1
    _save_summary(run, summary)
    total = summary.get("chunks_total") if isinstance(summary.get("chunks_total"), int) else 0
    previews = [p for p in summary["previews"] if isinstance(p, dict)]
    if not previews and total and summary["chunks_failed"] >= total and run.status == "splitting":
        run.status = final_status


def hook_job_failed(
    run_id: int,
    *,
    job_id: str,
    job_kind: str,
    error_kind: Optional[str],
    error_message: Optional[str],
    is_split_piece: bool,
) -> None:
    """`_process_job` error — `job_failed {error_kind, message}` · `→ failed`.
    분할 run의 조각 잡·정밀 분석 잡 실패는 run 전체를 닫지 않는다(다른 조각·휴리스틱안이
    남아 있다 — 조각 실패만 누적)."""

    def _do(db: Session) -> None:
        run = db.get(models.ImportRun, run_id)
        if run is None:
            return
        human = error_message or "작업이 실패했습니다"
        if is_split_piece:
            _split_piece_ended(run, "failed")
        elif job_kind == "split_analyze" or run.split_id is not None:
            pass  # 정밀 분석 실패 = 휴리스틱 분할안으로 계속 가능(상태 무변)
        else:
            run.status = "failed"
            run.error_kind = error_kind
            run.error_message = human
        record_event(
            db,
            run_id,
            "job_failed",
            f"작업이 실패했습니다 — {human}",
            {"job_id": job_id, "error_kind": error_kind, "message": human},
            run=run,
        )

    _run_hook("job_failed", _do)


def hook_job_cancelled(run_id: int, *, job_id: str, job_kind: str, is_split_piece: bool) -> None:
    """`cancel_job` 확정 — `job_cancelled` · `→ cancelled`(분할 run은 조각 단위 누적)."""

    def _do(db: Session) -> None:
        run = db.get(models.ImportRun, run_id)
        if run is None:
            return
        if is_split_piece:
            _split_piece_ended(run, "cancelled")
        elif job_kind == "split_analyze" or run.split_id is not None:
            pass
        elif run.status in IN_PROGRESS_STATUSES:
            run.status = "cancelled"
        record_event(db, run_id, "job_cancelled", "작업을 취소했습니다", {"job_id": job_id}, run=run)

    _run_hook("job_cancelled", _do)


# ---------------------------------------------------------------------------
# 기동 정리(B-7) — 잡 재발견 0
# ---------------------------------------------------------------------------
def expire_stale_runs(db: Optional[Session] = None) -> int:
    """`queued|converting|splitting|committing` → `expired` + 이벤트 `expired`.
    인메모리 잡은 재시작으로 소멸했으므로 진행 중으로 남은 run을 닫는다(R48 ②)."""
    own = db is None
    session = _new_session() if own else db
    try:
        runs = session.scalars(
            select(models.ImportRun).where(models.ImportRun.status.in_(IN_PROGRESS_STATUSES))
        ).all()
        for run in runs:
            run.status = "expired"
            record_event(
                session,
                run.id,
                "expired",
                "서버가 다시 시작되어 진행이 중단됐습니다 — 다시 시도하세요",
                {"reason": "server_restart"},
                run=run,
            )
        session.commit()
        return len(runs)
    finally:
        if own:
            session.close()


# ---------------------------------------------------------------------------
# 조회·제어(B-5)
# ---------------------------------------------------------------------------
def _summary_public(summary: dict) -> dict:
    """응답용 summary — 구조화 필드만(정답·해설·LLM 원문 0)."""
    previews = []
    for p in summary.get("previews") or []:
        if not isinstance(p, dict) or not p.get("preview_id"):
            continue
        previews.append(
            {
                "preview_id": p.get("preview_id"),
                "chunk_index": p.get("chunk_index"),
                "committed_at": p.get("committed_at"),
            }
        )
    commits = []
    for c in summary.get("commits") or []:
        if not isinstance(c, dict):
            continue
        commits.append(
            {
                "preview_id": c.get("preview_id"),
                "created": int(c.get("created") or 0),
                "merged": int(c.get("merged") or 0),
                "skipped": int(c.get("skipped") or 0),
                "errored": int(c.get("errored") or 0),
                "document_ids": [d for d in c.get("document_ids") or [] if isinstance(d, int)],
                "category_ids": [d for d in c.get("category_ids") or [] if isinstance(d, int)],
            }
        )
    total = summary.get("chunks_total")
    failed = summary.get("chunks_failed")
    fetch_request = summary.get("fetch_request")
    if isinstance(fetch_request, dict):
        fetch_request = {
            key: fetch_request.get(key)
            for key in ("adapter", "cert_ref", "exam_ref", "source_url", "exam_key")
        }
    else:
        fetch_request = None
    return {
        "previews": previews,
        "commits": commits,
        "document_ids": [d for d in summary.get("document_ids") or [] if isinstance(d, int)],
        "category_ids": [d for d in summary.get("category_ids") or [] if isinstance(d, int)],
        "chunks_total": total if isinstance(total, int) else None,
        "chunks_failed": failed if isinstance(failed, int) else None,
        "fetch_request": fetch_request,
    }


def event_to_dict(event: models.ImportRunEvent) -> dict:
    detail: Optional[dict] = None
    if event.detail_json:
        try:
            parsed = json.loads(event.detail_json)
            detail = parsed if isinstance(parsed, dict) else None
        except (TypeError, ValueError):
            detail = None
    return {
        "id": event.id,
        "type": event.type,
        "message": event.message,
        "at": _iso(event.at),
        "detail": detail,
    }


def _last_events(db: Session, run_ids: Sequence[int]) -> Dict[int, models.ImportRunEvent]:
    if not run_ids:
        return {}
    rows = db.scalars(
        select(models.ImportRunEvent)
        .where(models.ImportRunEvent.run_id.in_(list(run_ids)))
        .order_by(models.ImportRunEvent.run_id, models.ImportRunEvent.id)
    ).all()
    out: Dict[int, models.ImportRunEvent] = {}
    for row in rows:
        out[row.run_id] = row  # id 오름차순 — 마지막 값이 최신
    return out


def run_to_dict(run: models.ImportRun, last_event: Optional[models.ImportRunEvent] = None) -> dict:
    return {
        "id": run.id,
        "kind": run.kind,
        "label": run.label,
        "source_name": run.source_name,
        "source_url": run.source_url,
        "category_path": run.category_path,
        "status": run.status,
        "job_id": run.job_id,
        "preview_id": run.preview_id,
        "split_id": run.split_id,
        "answer_key_id": run.answer_key_id,
        "error_kind": run.error_kind,
        "error_message": run.error_message,
        "summary": _summary_public(load_summary(run)),
        "is_active": bool(run.is_active),
        "created_at": _iso(run.created_at),
        "updated_at": _iso(run.updated_at),
        "committed_at": _iso(run.committed_at),
        "last_event": (
            {"type": last_event.type, "message": last_event.message, "at": _iso(last_event.at)}
            if last_event is not None
            else None
        ),
    }


def list_runs(
    db: Session, status: Optional[str], page: int, size: int
) -> Tuple[List[dict], int]:
    """활성 run 목록 — `updated_at DESC`(동률은 id DESC) · §3 페이지네이션."""
    base = select(models.ImportRun).where(models.ImportRun.is_active == 1)
    if status:
        base = base.where(models.ImportRun.status == status)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    runs = db.scalars(
        base.order_by(models.ImportRun.updated_at.desc(), models.ImportRun.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    ).all()
    last = _last_events(db, [r.id for r in runs])
    return [run_to_dict(r, last.get(r.id)) for r in runs], total


def _get_run_or_404(db: Session, run_id: int) -> models.ImportRun:
    run = db.get(models.ImportRun, run_id)
    if run is None:
        raise NotFoundError("반입 건을 찾을 수 없습니다", detail={"run_id": run_id})
    return run


def _preview_exists(preview_id: Optional[str]) -> bool:
    """캐시 또는 `import/auto/` 보존본 **존재 검사만**(복구 호출 0). 커밋을 마친 preview는
    다시 검토할 수 없으므로(§4.3 409) 없음으로 본다."""
    if not preview_id:
        return False
    from services import import_service, preview_store

    if preview_id in import_service._COMMITTED:
        return False
    if preview_id in import_service._PREVIEW_CACHE:
        return True
    return preview_store.find(preview_id) is not None


def _failure_cases_for(run: models.ImportRun, document_ids: Sequence[int]) -> List[dict]:
    """§4.22 실패 사례 중 `run_id == id` ∪ (`kind=='user_report'` ∧ `document.id ∈
    summary.document_ids`) — 사례 파일 읽기만(쓰기 0 · FB-31)."""
    from services import improve_service

    doc_set = set(document_ids)
    out: List[dict] = []
    try:
        records = improve_service.list_case_records_readonly()
    except Exception:  # noqa: BLE001 - 사례 파일 손상이 상세 조회를 막으면 안 된다
        _LOGGER.warning("실패 사례 읽기 실패(상세의 failure_cases 생략)", exc_info=True)
        return out
    for record in records:
        if not isinstance(record, dict) or not record.get("case_id"):
            continue
        document = record.get("document") or {}
        linked = record.get("run_id") == run.id or (
            record.get("kind") == "user_report"
            and isinstance(document, dict)
            and document.get("id") in doc_set
        )
        if not linked:
            continue
        out.append(
            {
                "case_id": record.get("case_id"),
                "kind": record.get("kind"),
                "count": int(record.get("count") or 1),
                "last_seen_at": record.get("last_seen_at") or record.get("created_at"),
            }
        )
    out.sort(key=lambda c: c.get("last_seen_at") or "", reverse=True)
    return out


def get_detail(db: Session, run_id: int) -> dict:
    """`GET /api/import/runs/{id}` — 비활성 run도 조회 가능."""
    run = _get_run_or_404(db, run_id)
    events = db.scalars(
        select(models.ImportRunEvent)
        .where(models.ImportRunEvent.run_id == run.id)
        .order_by(models.ImportRunEvent.at, models.ImportRunEvent.id)
    ).all()
    summary = load_summary(run)
    doc_ids = [d for d in summary["document_ids"] if isinstance(d, int)]
    documents: List[dict] = []
    if doc_ids:
        rows = db.scalars(select(models.Document).where(models.Document.id.in_(doc_ids))).all()
        by_id = {d.id: d for d in rows}
        for doc_id in doc_ids:
            doc = by_id.get(doc_id)
            if doc is None:
                continue
            documents.append(
                {"id": doc.id, "doc_no": doc.doc_no, "title": doc.title, "is_active": bool(doc.is_active)}
            )
    if run.preview_id:
        preview_available = _preview_exists(run.preview_id)
    else:
        preview_available = any(
            _preview_exists(p.get("preview_id"))
            for p in summary["previews"]
            if isinstance(p, dict) and not p.get("committed_at")
        )
    return {
        "run": run_to_dict(run, events[-1] if events else None),
        "events": [event_to_dict(e) for e in events],
        "documents": documents,
        "failure_cases": _failure_cases_for(run, doc_ids),
        "preview_available": preview_available,
    }


def _has_active_job(job_id: Optional[str]) -> bool:
    """인메모리 잡 레코드가 있고 종료 전(목록 파생 상태 queued|running — 내부 literal 'running')."""
    if not job_id:
        return False
    from services import convert_service

    with convert_service._JOBS_LOCK:
        job = convert_service._JOBS.get(job_id)
        return job is not None and job.get("status") not in ("done", "error", "cancelled")


def dismiss_run(db: Session, run_id: int) -> dict:
    """[목록에서 지우기] — `is_active=0` + `dismissed`(상태 무변 · 소프트 — 불변 규칙 3)."""
    run = db.get(models.ImportRun, run_id)
    if run is None or not run.is_active:
        raise NotFoundError("반입 건을 찾을 수 없습니다", detail={"run_id": run_id})
    detail: Optional[dict] = None
    if run.status in IN_PROGRESS_STATUSES:
        # 409는 "진행 중 ∧ 연결된 활성 잡 존재"만 — 잡 없이 진행 중으로 남은 run(분할 위저드
        # 닫음 · 답지 업로드 직후 · 훅 실패 잔존)은 지울 수 있어야 한다(굳음 방지).
        if _has_active_job(run.job_id):
            raise ConflictError(
                "진행 중인 반입 건은 목록에서 지울 수 없습니다 — 먼저 취소하세요",
                detail={"reason": "bad_transition", "run_id": run_id, "status": run.status},
            )
        detail = {"reason": "no_active_job"}
    run.is_active = 0
    record_event(db, run.id, "dismissed", "목록에서 지웠습니다", detail, run=run)
    db.commit()
    return {"id": run.id, "is_active": False}


# ---------------------------------------------------------------------------
# 레거시 localStorage 큐 1회 이관(B-5 adopt)
# ---------------------------------------------------------------------------
_LEGACY_KIND_MAP = {
    "file": "convert_file",
    "url": "convert_url",
    "fetch": "fetch",
    "split": "convert_file",  # 조각 개별 run · 병합 복원 0
}


def _str_or_none(value: Any) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _legacy_label(kind: str, entry: dict) -> Tuple[str, Optional[str], Optional[str]]:
    file_name = _str_or_none(entry.get("fileName"))
    url = _str_or_none(entry.get("url"))
    fetch_label = _str_or_none(entry.get("fetchLabel"))
    if kind == "convert_url":
        name = url or file_name or "URL"
        return f"『{name}』 변환(이관)", file_name, url
    if kind == "fetch":
        name = fetch_label or file_name or "사이트 회차"
        return f"『{name}』 사이트 반입(이관)", fetch_label or file_name, None
    name = file_name or "파일"
    return f"『{name}』 변환(이관)", file_name, None


def adopt_legacy(db: Session, entries: Sequence[Any]) -> dict:
    """`previewId` 있고 `committed` 아닌 항목만 `review_ready` run 생성 · 같은 preview_id run
    존재 = skip(멱등) · 나머지(진행 중·실패·커밋 완료)는 버림 — 응답 `{created, skipped}`."""
    created = 0
    skipped = 0
    seen: set = set()
    for raw in entries:
        if not isinstance(raw, dict):
            skipped += 1
            continue
        preview_id = _str_or_none(raw.get("previewId"))
        if not preview_id or raw.get("committed") is True:
            skipped += 1
            continue
        if preview_id in seen or find_by_preview_id(db, preview_id) is not None:
            skipped += 1
            continue
        source_kind = raw.get("sourceKind")
        kind = _LEGACY_KIND_MAP.get(source_kind if isinstance(source_kind, str) else "", "convert_file")
        label, source_name, source_url = _legacy_label(kind, raw)
        legacy_id = raw.get("id") if isinstance(raw.get("id"), (str, int)) else None
        category_path = _str_or_none(raw.get("categoryPath"))
        create_run(
            db,
            kind=kind,
            label=label,
            status="review_ready",
            source_name=source_name,
            source_url=source_url,
            category_path=category_path,
            event_type="adopted",
            event_message="이전 대기열에서 옮겨 왔습니다 — 미리보기에서 검토하세요",
            event_detail={"legacy_id": legacy_id, "preview_id": preview_id},
            summary={**_empty_summary(), "previews": [{"preview_id": preview_id}]},
            preview_id=preview_id,
            job_id=_str_or_none(raw.get("jobId")),
        )
        seen.add(preview_id)
        created += 1
    db.commit()
    return {"created": created, "skipped": skipped}


# ---------------------------------------------------------------------------
# 시작 API 공용(B-3) — run을 먼저 열고(커밋) 잡을 등록한다. 잡 레코드에 `_run_id`가 큐 투입
# 전에 심어지므로 워커 dequeue 훅과의 경합이 없다. 잡 등록이 동기 오류(엔진 미가용 등)로
# 거부되면 run은 소프트로 감추고(abandon_run) 원 오류를 그대로 올린다.
# ---------------------------------------------------------------------------
def start_with_run(
    db: Session, start: Callable[[Optional[int]], str], **run_kwargs: Any
) -> Tuple[str, Optional[int]]:
    run_id = open_run(db, **run_kwargs)
    try:
        job_id = start(run_id)
    except Exception as exc:  # noqa: BLE001 - 원 오류는 그대로 다시 올린다
        message = getattr(exc, "message", None) or "작업을 시작하지 못했습니다"
        abandon_run(db, run_id, str(message))
        raise
    if run_id is not None:
        from services import convert_service

        label = convert_service.job_label(job_id)

        def _do() -> None:
            run = db.get(models.ImportRun, run_id)
            if run is None:
                return
            run.job_id = job_id
            if label:
                run.label = label  # 잡 `_label`과 같은 서버 완성 문구(§4.10 관례)
            _touch(run)

        _best_effort(db, "job_assigned", _do)
    return job_id, run_id


def preview_summary(preview_id: str) -> dict:
    """비분할 run의 첫 summary(`previews[]` 1건)."""
    return {**_empty_summary(), "previews": [{"preview_id": preview_id}]}


def fetch_summary(
    *,
    adapter: str,
    cert_ref: str,
    exam_ref: str,
    source_url: Optional[str],
    exam_key: Optional[str],
) -> dict:
    """사이트 반입 run의 첫 summary — [다시 시도](= 새 run · 같은 요청 재제출, D-I6)의 근거로
    시작 요청 값(id·라벨 수준)을 `fetch_request`에 보관한다(정답·해설 0)."""
    return {
        **_empty_summary(),
        "fetch_request": {
            "adapter": adapter,
            "cert_ref": cert_ref,
            "exam_ref": exam_ref,
            "source_url": source_url,
            "exam_key": exam_key,
        },
    }
