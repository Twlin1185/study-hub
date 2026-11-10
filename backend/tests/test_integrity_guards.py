"""stage-58 데이터 무결성 회귀 (FB-38) — 잡 TTL · 시험 중복 문항 · 복원 안전.
LLM 0 · 실 study.db/sources/backups 무접촉(임시 경로 + 인메모리 DB)."""
from __future__ import annotations

import datetime as dt
import sqlite3
import types

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from exceptions import ConflictError, ValidationAppError
from schemas.exam import ExamAnswerItem, ExamSessionRequest, ExamSubjectRequest, ExamSubmitRequest
from services import applied_exam_service, backup_service, exam_service
from services import convert_service as cs


# ---------------------------------------------------------------------------
# ⓖ 잡 TTL — 종료 잡만, 종료 시각 기준
# ---------------------------------------------------------------------------
def _job(status, created_ago, finished_ago=None):
    now = dt.datetime.now()
    return {
        "status": status,
        "created_at": now - created_ago,
        "_finished_at": (now - finished_ago) if finished_ago is not None else None,
    }


def test_purge_keeps_waiting_and_recently_finished_deletes_old_finished(monkeypatch):
    two_h = dt.timedelta(hours=2)
    jobs = {
        "waiting": _job("running", two_h),
        "old_done": _job("done", two_h, two_h),
        "fresh_done": _job("done", two_h, dt.timedelta(minutes=10)),
        "old_err": _job("error", two_h, two_h),
        "old_cancelled": _job("cancelled", two_h, two_h),
        "legacy_done_no_finished": _job("done", two_h),  # 폴백 created_at
    }
    monkeypatch.setattr(cs, "_JOBS", jobs)
    cs._purge_expired_jobs()
    assert set(jobs) == {"waiting", "fresh_done"}


def test_has_active_jobs(monkeypatch):
    monkeypatch.setattr(cs, "_JOBS", {"a": _job("done", dt.timedelta(minutes=1), dt.timedelta(0))})
    assert cs.has_active_jobs() is False
    monkeypatch.setattr(cs, "_JOBS", {"a": _job("running", dt.timedelta(minutes=1))})
    assert cs.has_active_jobs() is True


# ---------------------------------------------------------------------------
# ⓗ 시험 — 세션 dedupe · 제출 중복 422
# ---------------------------------------------------------------------------
@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _seed(db):
    cat_a = models.Category(name="과목A")
    cat_b = models.Category(name="과목B")
    db.add_all([cat_a, cat_b])
    docs = []
    for i in range(3):
        d = models.Document(
            doc_no=f"Q-{i}", type="question", title=f"t{i}", content="c", answer="1",
            choices='["a","b"]',
        )
        db.add(d)
        docs.append(d)
    db.commit()
    shared, only_a, only_b = docs
    for cat, doc in ((cat_a, shared), (cat_a, only_a), (cat_b, shared), (cat_b, only_b)):
        db.add(models.CategoryDocument(category_id=cat.id, document_id=doc.id))
    db.commit()
    return cat_a, cat_b, shared, only_a, only_b


def test_session_dedupes_document_across_subjects(db):
    cat_a, cat_b, shared, only_a, only_b = _seed(db)
    resp = exam_service.build_exam_session(
        db,
        ExamSessionRequest(
            subjects=[ExamSubjectRequest(category_id=cat_a.id), ExamSubjectRequest(category_id=cat_b.id)],
            order="sequential",
        ),
    )
    ids = [q.document_id for s in resp.subjects for q in s.items]
    assert len(ids) == len(set(ids)) == 3
    assert ids.count(shared.id) == 1
    assert resp.total_count == 3


def test_session_dedupe_refills_cap_with_remaining(db):
    cat_a, cat_b, shared, only_a, only_b = _seed(db)
    resp = exam_service.build_exam_session(
        db,
        ExamSessionRequest(
            subjects=[
                ExamSubjectRequest(category_id=cat_a.id),
                ExamSubjectRequest(category_id=cat_b.id, count=2),
            ],
            order="sequential",
        ),
    )
    b_items = [q.document_id for q in resp.subjects[1].items]
    assert b_items == [only_b.id]  # shared는 첫 과목 귀속 → B는 남은 문항만


def _dup_payload(cat_id, doc_id):
    return ExamSubmitRequest(
        answers=[
            ExamAnswerItem(document_id=doc_id, subject_category_id=cat_id, my_answer="1"),
            ExamAnswerItem(document_id=doc_id, subject_category_id=cat_id, my_answer="2"),
        ]
    )


def test_submit_exam_duplicate_is_422_and_writes_nothing(db):
    cat_a, _, shared, _, _ = _seed(db)
    with pytest.raises(ValidationAppError) as ei:
        exam_service.submit_exam(db, _dup_payload(cat_a.id, shared.id))
    assert ei.value.detail == {"document_id": shared.id}
    assert db.execute(select(func.count()).select_from(models.Attempt)).scalar() == 0


def test_submit_applied_exam_duplicate_is_422(db):
    cat_a, _, shared, _, _ = _seed(db)
    with pytest.raises(ValidationAppError) as ei:
        applied_exam_service.submit_applied_exam(db, _dup_payload(cat_a.id, shared.id))
    assert ei.value.detail == {"document_id": shared.id}
    assert db.execute(select(func.count()).select_from(models.Attempt)).scalar() == 0


# ---------------------------------------------------------------------------
# ⓘ 복원 안전
# ---------------------------------------------------------------------------
class _EngineStub:
    """복원 후처리(engine.dispose·verify)가 실 study.db를 건드리지 않게 대체."""

    def dispose(self):
        pass

    def connect(self):
        class _Ctx:
            def __enter__(self_inner):
                return types.SimpleNamespace(execute=lambda *_a, **_k: None)

            def __exit__(self_inner, *exc):
                return False

        return _Ctx()


@pytest.fixture()
def restore_env(tmp_path, monkeypatch):
    db_path = tmp_path / "study.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("CREATE TABLE t (v TEXT)")
    conn.execute("INSERT INTO t VALUES ('original')")
    conn.commit()
    conn.close()
    monkeypatch.setattr(backup_service, "DB_PATH", db_path)
    monkeypatch.setattr(backup_service, "BACKUPS_DIR", tmp_path / "backups")
    monkeypatch.setattr(backup_service, "SOURCES_DIR", tmp_path / "sources")
    monkeypatch.setattr(backup_service, "engine", _EngineStub())
    monkeypatch.setattr(cs, "_JOBS", {})
    return db_path


def _read_v(db_path):
    conn = sqlite3.connect(str(db_path))
    try:
        return conn.execute("SELECT v FROM t").fetchone()[0]
    finally:
        conn.close()


def test_restore_rejected_with_active_job_leaves_db_untouched(restore_env, monkeypatch):
    backup = backup_service.create_backup(label="manual")
    before = restore_env.stat().st_mtime_ns
    cs._JOBS["j1"] = _job("running", dt.timedelta(minutes=1))
    with pytest.raises(ConflictError):
        backup_service.restore_backup(backup["id"], "RESTORE")
    assert restore_env.stat().st_mtime_ns == before
    assert _read_v(restore_env) == "original"
    assert not list(backup_service.BACKUPS_DIR.glob("*pre_restore*"))  # 스냅숏 이전에 거부


def _fake_sqlite(row=None, error=None):
    real = sqlite3

    def connect(path, *a, **k):
        if error is not None:
            raise error
        return types.SimpleNamespace(
            execute=lambda *_a, **_k: types.SimpleNamespace(fetchone=lambda: row),
            close=lambda: None,
        )

    return types.SimpleNamespace(connect=connect, Error=real.Error)


def test_restore_checkpoint_busy_is_409_and_does_not_overwrite(restore_env, monkeypatch):
    backup = backup_service.create_backup(label="manual")
    conn = sqlite3.connect(str(restore_env))
    conn.execute("UPDATE t SET v='changed'")
    conn.commit()
    conn.close()
    monkeypatch.setattr(backup_service, "create_backup", lambda **k: {"id": "pre"})
    monkeypatch.setattr(backup_service, "sqlite3", _fake_sqlite(row=(1, 0, 0)))
    with pytest.raises(ConflictError):
        backup_service.restore_backup(backup["id"], "RESTORE")
    monkeypatch.setattr(backup_service, "sqlite3", _fake_sqlite(error=sqlite3.OperationalError("locked")))
    with pytest.raises(ConflictError):
        backup_service.restore_backup(backup["id"], "RESTORE")
    assert _read_v(restore_env) == "changed"


def test_restore_normal_path_overwrites(restore_env):
    backup = backup_service.create_backup(label="manual")
    conn = sqlite3.connect(str(restore_env))
    conn.execute("UPDATE t SET v='changed'")
    conn.commit()
    conn.close()
    result = backup_service.restore_backup(backup["id"], "RESTORE")
    assert result["restored_from"] == backup["id"]
    assert _read_v(restore_env) == "original"
