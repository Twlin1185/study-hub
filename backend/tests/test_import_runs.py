"""반입 건(import runs) 단위 테스트 (S56 — F63 · M40 · R48, 설계 §4.34).

계약 고정 항목(지시서 B-9):
  ① 시작 5경로 run 생성·응답 `run_id`(잡 실행은 모킹 — 실 LLM 0)
  ② 전이 — `job_started`·`preview_ready`·`job_failed(error_kind)`·`job_cancelled`
  ③ 분할 run 조각 누적 → 전 조각 커밋 시 `committed`
  ④ 커밋 한 트랜잭션 — commit 도중 예외 → run 상태·events 미갱신
  ⑤ dismiss 진행 중 409 · 완료 run 200 · 재dismiss 404
  ⑥ adopt — previewId 있음·미커밋만 생성 · 중복 skip · counts
  ⑦ `expire_stale_runs` 대상·비대상
  ⑧ 목록 페이지네이션·비활성 제외·status 필터
  ⑨ 응답 JSON에 `answer`·`explanation` 키 부재(불변 규칙 1)

DB는 tmp_path 파일 SQLite — 워커 훅 세션 팩토리(`import_run_service._session_factory`)도
같은 엔진으로 바꾼다(실 study.db 무접촉). `sources/`·`import/auto/`·`import/split/`·
`improve/`는 tmp_path로 격리. TestClient는 컨텍스트 매니저 없이 써서 lifespan(자동 백업·
기동 정리)을 돌리지 않는다.
"""
from __future__ import annotations

import json
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import main
import models
from database import Base, get_db
from schemas.import_schema import CommitRequest, ImportDecision
from services import convert_service as cs
from services import (
    import_run_service,
    import_service,
    improve_service,
    preview_store,
    split_service,
)


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------
@pytest.fixture()
def Session(tmp_path, monkeypatch):
    # 파일 DB(tmp_path) — 워커 스레드 훅과 테스트 스레드가 커넥션을 공유하지 않게 한다
    # (StaticPool 단일 커넥션이면 한쪽 rollback이 다른 쪽 미커밋 쓰기를 지운다).
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'runs.db').as_posix()}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(import_run_service, "_session_factory", factory)

    auto_dir = tmp_path / "import" / "auto"
    sources_dir = tmp_path / "sources"
    auto_dir.mkdir(parents=True)
    sources_dir.mkdir(parents=True)
    monkeypatch.setattr(preview_store, "AUTO_DIR", auto_dir)
    monkeypatch.setattr(preview_store, "SOURCES_DIR", sources_dir)
    monkeypatch.setattr(import_service, "SOURCES_DIR", sources_dir)
    monkeypatch.setattr(split_service, "SPLIT_DIR", tmp_path / "import" / "split")
    monkeypatch.setattr(improve_service, "CASES_DIR", tmp_path / "improve" / "cases")
    monkeypatch.setattr(improve_service, "PROPOSALS_DIR", tmp_path / "improve" / "proposals")
    import_service._PREVIEW_CACHE.clear()
    import_service._COMMITTED.clear()
    split_service._STATE.clear()
    yield factory
    import_service._PREVIEW_CACHE.clear()
    import_service._COMMITTED.clear()
    split_service._STATE.clear()
    engine.dispose()


@pytest.fixture()
def client(Session):
    def _override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def fake_jobs(monkeypatch):
    """시작 함수 모킹 — 잡 레코드만 `_JOBS`에 등록(큐 투입 0 · LLM 0)."""
    created: list = []

    def _register(kind: str, job_label: str, **kw) -> str:
        job_id = f"tst_{uuid.uuid4().hex[:8]}"
        job = cs._new_job_base(kind, resolved_engine="claude-cli", requested_engine="auto", model=None)
        job["_run_id"] = kw.get("run_id")
        job["_label"] = job_label
        job["_split_id"] = kw.get("split_id")
        job["_split_chunk_index"] = kw.get("split_chunk_index")
        with cs._JOBS_LOCK:
            cs._JOBS[job_id] = job
        created.append((job_id, kw))
        return job_id

    monkeypatch.setattr(
        cs,
        "start_convert_job",
        lambda **kw: _register("convert", kw.get("label") or f"『{kw['upload_filename']}』 변환", **kw),
    )
    monkeypatch.setattr(
        cs,
        "start_convert_job_from_url",
        lambda **kw: _register("convert", f"『{kw['url'].strip()}』 변환", **kw),
    )
    monkeypatch.setattr(
        cs,
        "start_fetch_job",
        lambda **kw: _register("fetch", f"『{kw['cert_ref']} {kw['exam_ref']}』 사이트 반입", **kw),
    )
    monkeypatch.setattr(
        cs,
        "start_answer_key_job",
        lambda db, **kw: _register("answer_key", f"『{kw['source_filename']}』 답지 가공", **kw),
    )
    yield created
    with cs._JOBS_LOCK:
        for job_id, _ in created:
            cs._JOBS.pop(job_id, None)


def _payload(n: int = 2, *, tag: str = "a") -> bytes:
    docs = [
        {
            "type": "past_question",
            "title": f"{tag}-{i}번 문항",
            "content": f"본문 {tag} {i}",
            "answer": "1",
            "explanation": "해설 텍스트",
        }
        for i in range(1, n + 1)
    ]
    return json.dumps({"format_version": 1, "source": {}, "documents": docs}, ensure_ascii=False).encode()


def _run(Session, run_id: int) -> models.ImportRun:
    with Session() as db:
        run = db.get(models.ImportRun, run_id)
        db.expunge(run)
        return run


def _event_types(Session, run_id: int) -> list:
    with Session() as db:
        return [
            e.type
            for e in db.scalars(
                select(models.ImportRunEvent)
                .where(models.ImportRunEvent.run_id == run_id)
                .order_by(models.ImportRunEvent.id)
            ).all()
        ]


def _summary(Session, run_id: int) -> dict:
    with Session() as db:
        return import_run_service.load_summary(db.get(models.ImportRun, run_id))


def _new_run(Session, **kw) -> int:
    with Session() as db:
        base = {"kind": "convert_file", "label": "『t.txt』 변환", "status": "queued"}
        base.update(kw)
        run = import_run_service.create_run(db, **base)
        db.commit()
        return run.id


def _assert_no_answer_keys(obj) -> None:
    if isinstance(obj, dict):
        for key, value in obj.items():
            assert key not in ("answer", "explanation"), f"응답에 {key} 키가 있으면 안 된다"
            _assert_no_answer_keys(value)
    elif isinstance(obj, list):
        for value in obj:
            _assert_no_answer_keys(value)


def _wait(predicate, timeout: float = 5.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


# ---------------------------------------------------------------------------
# ① 시작 5경로 — run 생성 + 응답 run_id
# ---------------------------------------------------------------------------
def test_convert_file_and_url_start_creates_queued_run_with_run_id(client, Session, fake_jobs):
    res = client.post(
        "/api/convert",
        files={"file": ("기출.txt", b"1. question", "text/plain")},
        data={"category_path": "기사/2023"},
    )
    assert res.status_code == 202, res.text
    body = res.json()
    run = _run(Session, body["run_id"])
    assert (run.kind, run.status, run.job_id) == ("convert_file", "queued", body["job_id"])
    assert run.label == "『기출.txt』 변환" and run.source_name == "기출.txt"
    assert run.category_path == "기사/2023"
    with cs._JOBS_LOCK:
        assert cs._JOBS[body["job_id"]]["_run_id"] == run.id  # 큐 투입 전에 심긴다
    assert _event_types(Session, run.id) == ["created"]

    res = client.post("/api/convert", json={"url": " https://example.com/a.pdf "})
    assert res.status_code == 202, res.text
    run = _run(Session, res.json()["run_id"])
    assert (run.kind, run.source_url, run.label) == (
        "convert_url",
        "https://example.com/a.pdf",
        "『https://example.com/a.pdf』 변환",
    )


def test_fetch_start_creates_fetch_run_with_round_label(client, Session, fake_jobs):
    res = client.post(
        "/api/fetch/import",
        json={"adapter": "qnet", "cert_ref": "정보처리기사", "exam_ref": "2023-2", "exam_key": "k1"},
    )
    assert res.status_code == 202, res.text
    run = _run(Session, res.json()["run_id"])
    assert (run.kind, run.status, run.source_name) == ("fetch", "queued", "정보처리기사 2023-2")
    assert _summary(Session, run.id)["fetch_request"]["exam_key"] == "k1"


def test_json_upload_preview_creates_review_ready_run(client, Session):
    res = client.post(
        "/api/import/preview", files={"file": ("mine.json", _payload(2), "application/json")}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    run = _run(Session, body["run_id"])
    assert (run.kind, run.status, run.preview_id) == ("json_upload", "review_ready", body["preview_id"])
    # 캐시 응답은 오염되지 않는다(조회 응답 run_id = null).
    again = client.get(f"/api/import/preview/{body['preview_id']}").json()
    assert again["run_id"] is None


def test_answer_key_upload_creates_queued_run_and_process_attaches_job(client, Session, fake_jobs):
    with Session() as db:
        root = models.Category(name="정보처리기사")
        db.add(root)
        db.flush()
        child = models.Category(name="2023", parent_id=root.id)
        db.add(child)
        db.commit()
        child_id = child.id
    res = client.post(
        "/api/import/answer-key",
        files={"file": ("답지.txt", "1. ① 2. ③".encode("utf-8"), "text/plain")},
        data={"category_id": str(child_id)},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    run = _run(Session, body["run_id"])
    assert (run.kind, run.status, run.answer_key_id) == ("answer_key", "queued", body["key_id"])
    assert run.category_path == "정보처리기사/2023"

    res = client.post(f"/api/import/answer-key/{body['key_id']}/process", json={})
    assert res.status_code == 202, res.text
    job_id = res.json()["job_id"]
    with cs._JOBS_LOCK:
        assert cs._JOBS[job_id]["_run_id"] == run.id
    assert _run(Session, run.id).job_id == job_id


def _big_text() -> bytes:
    body_a = "가" * 110_000
    body_b = "나" * 110_000
    return f"1과목 재료역학\n{body_a}\n\n2과목 유체역학\n{body_b}".encode("utf-8")


def test_split_start_creates_splitting_run_and_attach_rules(client, Session):
    res = client.post("/api/import/split", files={"file": ("원본.txt", _big_text(), "text/plain")})
    assert res.status_code == 200, res.text
    body = res.json()
    run = _run(Session, body["run_id"])
    assert (run.kind, run.status, run.split_id) == ("convert_file", "splitting", body["split_id"])
    assert _event_types(Session, run.id) == ["created", "split_started"]

    # 연결 허용 = failed + too_large만 — 그 외 409 bad_transition.
    queued_id = _new_run(Session)
    res = client.post(
        f"/api/import/split?run_id={queued_id}", files={"file": ("원본.txt", _big_text(), "text/plain")}
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"
    assert res.json()["error"]["detail"]["reason"] == "bad_transition"

    too_large_id = _new_run(Session, status="failed")
    with Session() as db:
        db.get(models.ImportRun, too_large_id).error_kind = "too_large"
        db.commit()
    res = client.post(
        f"/api/import/split?run_id={too_large_id}", files={"file": ("원본.txt", _big_text(), "text/plain")}
    )
    assert res.status_code == 200, res.text
    assert res.json()["run_id"] == too_large_id
    linked = _run(Session, too_large_id)
    assert linked.status == "splitting" and linked.split_id == res.json()["split_id"]
    assert linked.error_kind is None

    assert client.post(
        "/api/import/split?run_id=99999", files={"file": ("원본.txt", _big_text(), "text/plain")}
    ).status_code == 404


def test_start_rejected_hides_run_and_reraises(client, Session, monkeypatch):
    from exceptions import ValidationAppError

    def _boom(**kw):
        raise ValidationAppError("엔진을 쓸 수 없습니다")

    monkeypatch.setattr(cs, "start_convert_job", _boom)
    res = client.post("/api/convert", files={"file": ("x.txt", b"abc", "text/plain")})
    assert res.status_code == 422
    with Session() as db:
        runs = db.scalars(select(models.ImportRun)).all()
        assert len(runs) == 1 and runs[0].is_active == 0 and runs[0].status == "failed"
    assert client.get("/api/import/runs").json()["total"] == 0


# ---------------------------------------------------------------------------
# ② 전이 — 실제 워커 경유(_do_convert 모킹) + 취소
# ---------------------------------------------------------------------------
def _enqueue_fake_convert(run_id: int) -> str:
    job_id = f"tst_{uuid.uuid4().hex[:8]}"
    job = cs._new_job_base("convert", resolved_engine="claude-cli", requested_engine="auto", model=None)
    job["_run_id"] = run_id
    with cs._JOBS_LOCK:
        cs._JOBS[job_id] = job
    cs._ensure_worker()
    cs._QUEUE.put(job_id)
    return job_id


def test_worker_done_records_job_started_and_preview_ready(Session, monkeypatch):
    monkeypatch.setattr(cs, "_do_convert", lambda job_id, job: {"result_preview_id": "pv_done01"})
    run_id = _new_run(Session)
    job_id = _enqueue_fake_convert(run_id)
    try:
        assert _wait(lambda: _run(Session, run_id).status == "review_ready")
        run = _run(Session, run_id)
        assert run.preview_id == "pv_done01" and run.job_id == job_id
        assert _event_types(Session, run_id) == ["created", "job_started", "preview_ready"]
        with Session() as db:
            last = db.scalars(
                select(models.ImportRunEvent).where(models.ImportRunEvent.run_id == run_id)
                .order_by(models.ImportRunEvent.id.desc())
            ).first()
            assert last.message == "변환이 끝났습니다 — 미리보기에서 검토하세요"
        # 잡 목록 항목에 run_id(DB 조회 0 — 잡 레코드 값 그대로).
        with cs._JOBS_LOCK:
            item = cs._job_list_item(job_id, cs._JOBS[job_id], current_job_id=None)
        assert item["run_id"] == run_id
    finally:
        with cs._JOBS_LOCK:
            cs._JOBS.pop(job_id, None)


def test_worker_error_records_job_failed_with_error_kind(Session, monkeypatch):
    from exceptions import ValidationAppError

    def _fail(job_id, job):
        with cs._JOBS_LOCK:
            job["_error_info"] = {"kind": "too_large", "message": "원본이 너무 큽니다 — 분할 반입을 이용하세요"}
        raise ValidationAppError("원본이 너무 큽니다")

    monkeypatch.setattr(cs, "_do_convert", _fail)
    run_id = _new_run(Session)
    job_id = _enqueue_fake_convert(run_id)
    try:
        assert _wait(lambda: _run(Session, run_id).status == "failed")
        run = _run(Session, run_id)
        assert run.error_kind == "too_large"
        assert run.error_message == "원본이 너무 큽니다 — 분할 반입을 이용하세요"
        assert _event_types(Session, run_id)[-1] == "job_failed"
        with Session() as db:
            ev = db.scalars(
                select(models.ImportRunEvent).where(models.ImportRunEvent.type == "job_failed")
            ).first()
            assert json.loads(ev.detail_json)["error_kind"] == "too_large"
    finally:
        with cs._JOBS_LOCK:
            cs._JOBS.pop(job_id, None)


def test_cancel_job_records_job_cancelled(Session):
    run_id = _new_run(Session)
    job_id = f"tst_{uuid.uuid4().hex[:8]}"
    job = cs._new_job_base("convert", resolved_engine="claude-cli", requested_engine="auto", model=None)
    job["_run_id"] = run_id
    with cs._JOBS_LOCK:
        cs._JOBS[job_id] = job
    try:
        cs.cancel_job(job_id)
        run = _run(Session, run_id)
        assert run.status == "cancelled"
        assert _event_types(Session, run_id) == ["created", "job_cancelled"]
    finally:
        with cs._JOBS_LOCK:
            cs._JOBS.pop(job_id, None)


def test_job_without_run_id_skips_hooks(Session):
    """레거시 잡(`_run_id` 없음) — 훅 스냅샷 None(DB 접근 0)."""
    job = cs._new_job_base("convert", resolved_engine="claude-cli", requested_engine="auto", model=None)
    assert cs._run_hook_snapshot("x", job) is None


# ---------------------------------------------------------------------------
# ③ 분할 run 조각 누적 → 전 조각 커밋 시 committed
# ---------------------------------------------------------------------------
def _commit(client, preview_id: str, n: int = 1):
    req = {"preview_id": preview_id, "decisions": [{"index": i, "action": "new"} for i in range(n)]}
    return client.post("/api/import/commit", json=req)


def test_split_run_accumulates_chunks_and_commits_after_all(client, Session, fake_jobs):
    body = client.post("/api/import/split", files={"file": ("원본.txt", _big_text(), "text/plain")}).json()
    run_id = body["run_id"]
    chunk_ids = [c["chunk_id"] for c in body["chunks"]]
    res = client.post(
        f"/api/import/split/{body['split_id']}/enqueue", json={"selections": [[cid] for cid in chunk_ids]}
    )
    assert res.status_code == 200, res.text
    job_ids = [j["job_id"] for j in res.json()["jobs"]]
    assert [kw.get("run_id") for _, kw in fake_jobs] == [run_id, run_id]
    assert [kw.get("split_chunk_index") for _, kw in fake_jobs] == [1, 2]
    summary = _summary(Session, run_id)
    assert summary["chunks_total"] == 2
    assert _event_types(Session, run_id)[-1] == "split_enqueued"

    # 조각 잡 완료 — 실제 preview 2개를 만들고 done 훅으로 붙인다.
    with Session() as db:
        pv1 = import_service.create_preview(db, source_filename=None, source_bytes=None, json_bytes=_payload(1, tag="c1")).preview_id
        pv2 = import_service.create_preview(db, source_filename=None, source_bytes=None, json_bytes=_payload(1, tag="c2")).preview_id
    import_run_service.hook_job_started(run_id, job_id=job_ids[0], job_kind="convert", is_split_piece=True)
    assert _run(Session, run_id).status == "splitting"  # 조각 잡 = 이벤트만
    import_run_service.hook_job_done(run_id, job_id=job_ids[0], job_kind="convert", preview_id=pv1, chunk_index=1)
    assert _run(Session, run_id).status == "review_ready"  # 첫 조각부터
    import_run_service.hook_job_done(run_id, job_id=job_ids[1], job_kind="convert", preview_id=pv2, chunk_index=2)
    previews = _summary(Session, run_id)["previews"]
    assert [(p["preview_id"], p["chunk_index"]) for p in previews] == [(pv1, 1), (pv2, 2)]
    assert _run(Session, run_id).preview_id is None  # 병합 전 컬럼은 비워 둔다

    assert _commit(client, pv1).status_code == 200
    run = _run(Session, run_id)
    assert run.status == "review_ready" and run.committed_at is None
    assert _commit(client, pv2).status_code == 200
    run = _run(Session, run_id)
    assert run.status == "committed" and run.committed_at is not None
    summary = _summary(Session, run_id)
    assert len(summary["commits"]) == 2 and len(summary["document_ids"]) == 2
    assert all(p.get("committed_at") for p in summary["previews"])


def test_split_merge_then_commit_merged_marks_committed(client, Session):
    body = client.post("/api/import/split", files={"file": ("원본.txt", _big_text(), "text/plain")}).json()
    run_id = body["run_id"]
    with Session() as db:
        pv1 = import_service.create_preview(db, source_filename=None, source_bytes=None, json_bytes=_payload(1, tag="m1")).preview_id
        pv2 = import_service.create_preview(db, source_filename=None, source_bytes=None, json_bytes=_payload(1, tag="m2")).preview_id
    import_run_service.hook_job_done(run_id, job_id="j1", job_kind="convert", preview_id=pv1, chunk_index=1)
    import_run_service.hook_job_done(run_id, job_id="j2", job_kind="convert", preview_id=pv2, chunk_index=2)
    res = client.post("/api/import/preview/merge", json={"preview_ids": [pv1, pv2]})
    assert res.status_code == 200, res.text
    merged_id = res.json()["preview_id"]
    assert _run(Session, run_id).preview_id == merged_id
    assert _event_types(Session, run_id)[-1] == "preview_merged"
    assert _commit(client, merged_id, n=2).status_code == 200
    assert _run(Session, run_id).status == "committed"


# ---------------------------------------------------------------------------
# ④ 커밋 한 트랜잭션 — commit 도중 예외 → run·events 미갱신
# ---------------------------------------------------------------------------
def test_commit_failure_rolls_back_run_transition(client, Session):
    body = client.post(
        "/api/import/preview", files={"file": ("mine.json", _payload(1), "application/json")}
    ).json()
    run_id, preview_id = body["run_id"], body["preview_id"]
    before_events = _event_types(Session, run_id)

    db = Session()
    try:
        def _raise():
            raise RuntimeError("commit 도중 실패 주입")

        db.commit = _raise  # 인스턴스 속성 — mark_committed(flush) 이후 commit 1회에서 실패
        with pytest.raises(RuntimeError):
            import_service.commit_import(
                db, CommitRequest(preview_id=preview_id, decisions=[ImportDecision(index=0, action="new")])
            )
    finally:
        db.close()

    run = _run(Session, run_id)
    assert run.status == "review_ready" and run.committed_at is None
    assert _event_types(Session, run_id) == before_events
    with Session() as check:
        assert check.scalars(select(models.Document)).all() == []

    # 정상 커밋은 같은 트랜잭션으로 run을 committed로 올린다.
    assert _commit(client, preview_id).status_code == 200
    run = _run(Session, run_id)
    assert run.status == "committed"
    assert _event_types(Session, run_id)[-1] == "committed"


# ---------------------------------------------------------------------------
# ⑤ dismiss
# ---------------------------------------------------------------------------
def test_dismiss_rules(client, Session):
    queued = _new_run(Session)
    res = client.post(f"/api/import/runs/{queued}/dismiss")
    assert res.status_code == 409
    assert res.json()["error"]["detail"]["reason"] == "bad_transition"

    done = _new_run(Session, status="committed")
    res = client.post(f"/api/import/runs/{done}/dismiss")
    assert res.status_code == 200 and res.json() == {"id": done, "is_active": False}
    run = _run(Session, done)
    assert run.status == "committed" and run.is_active == 0  # 상태 무변 · 소프트
    assert _event_types(Session, done)[-1] == "dismissed"

    assert client.post(f"/api/import/runs/{done}/dismiss").status_code == 404
    assert client.post("/api/import/runs/99999/dismiss").status_code == 404
    # 비활성 run도 상세 조회 가능.
    assert client.get(f"/api/import/runs/{done}").status_code == 200


# ---------------------------------------------------------------------------
# ⑥ adopt
# ---------------------------------------------------------------------------
def test_adopt_creates_only_uncommitted_with_preview_and_is_idempotent(client, Session):
    entries = [
        {"id": "q1", "jobId": "cvt_1", "sourceKind": "file", "fileName": "a.pdf", "previewId": "pv_a1",
         "categoryPath": "기사/1", "createdAt": 1, "unknown": "x"},
        {"id": "q2", "jobId": "cvt_2", "sourceKind": "url", "url": "https://e.com/b", "previewId": "pv_b1",
         "createdAt": 2},
        {"id": "q3", "jobId": "cvt_3", "sourceKind": "file", "fileName": "c.pdf", "createdAt": 3},
        {"id": "q4", "jobId": "cvt_4", "sourceKind": "split", "fileName": "d.txt", "previewId": "pv_d1",
         "committed": True, "createdAt": 4},
    ]
    res = client.post("/api/import/runs/adopt", json={"entries": entries})
    assert res.status_code == 200, res.text
    assert res.json() == {"created": 2, "skipped": 2}
    items = client.get("/api/import/runs").json()["items"]
    by_preview = {i["preview_id"]: i for i in items}
    assert set(by_preview) == {"pv_a1", "pv_b1"}
    assert by_preview["pv_a1"]["kind"] == "convert_file"
    assert by_preview["pv_a1"]["label"] == "『a.pdf』 변환(이관)"
    assert by_preview["pv_a1"]["category_path"] == "기사/1"
    assert by_preview["pv_a1"]["status"] == "review_ready"
    assert by_preview["pv_a1"]["last_event"]["type"] == "adopted"
    assert by_preview["pv_b1"]["kind"] == "convert_url"
    # 재이관 = 같은 preview_id run 존재 → 전부 skip.
    assert client.post("/api/import/runs/adopt", json={"entries": entries}).json() == {"created": 0, "skipped": 4}
    assert client.post("/api/import/runs/adopt", json={"entries": "x"}).status_code == 422


# ---------------------------------------------------------------------------
# ⑦ expire_stale_runs
# ---------------------------------------------------------------------------
def test_expire_stale_runs_targets_only_in_progress(Session):
    ids = {status: _new_run(Session, status=status) for status in import_run_service.RUN_STATUSES}
    assert import_run_service.expire_stale_runs() == 4
    for status, run_id in ids.items():
        run = _run(Session, run_id)
        if status in ("queued", "converting", "splitting", "committing"):
            assert run.status == "expired"
            assert _event_types(Session, run_id)[-1] == "expired"
        else:
            assert run.status == status
            assert _event_types(Session, run_id) == ["created"]


# ---------------------------------------------------------------------------
# ⑧ 목록 — 페이지네이션 · 비활성 제외 · status 필터 · 422
# ---------------------------------------------------------------------------
def test_list_pagination_inactive_excluded_and_status_filter(client, Session):
    a = _new_run(Session, status="review_ready")
    b = _new_run(Session, status="failed")
    c = _new_run(Session, status="review_ready")
    d = _new_run(Session, status="committed")
    client.post(f"/api/import/runs/{d}/dismiss")

    res = client.get("/api/import/runs?size=2&page=1").json()
    assert (res["total"], res["page"], res["size"], len(res["items"])) == (3, 1, 2, 2)
    page2 = client.get("/api/import/runs?size=2&page=2").json()
    ids = [i["id"] for i in res["items"]] + [i["id"] for i in page2["items"]]
    assert sorted(ids) == sorted([a, b, c]) and d not in ids
    assert ids[0] == c  # updated_at DESC(동률 id DESC)

    filtered = client.get("/api/import/runs?status=review_ready").json()
    assert {i["id"] for i in filtered["items"]} == {a, c}
    bad = client.get("/api/import/runs?status=dismissed")
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.get("/api/import/runs/99999").status_code == 404


# ---------------------------------------------------------------------------
# ⑨ 응답에 정답·해설 키 부재 + 상세(documents·failure_cases·preview_available)
# ---------------------------------------------------------------------------
def test_detail_documents_failure_cases_and_no_answer_keys(client, Session, monkeypatch):
    body = client.post(
        "/api/import/preview", files={"file": ("mine.json", _payload(2), "application/json")}
    ).json()
    run_id = body["run_id"]
    detail = client.get(f"/api/import/runs/{run_id}").json()
    assert detail["preview_available"] is True  # 캐시 존재(복구 호출 0)
    _assert_no_answer_keys(detail)

    assert _commit(client, body["preview_id"], n=2).status_code == 200
    with Session() as db:
        doc_ids = [d.id for d in db.scalars(select(models.Document)).all()]
    # FB-31 — run_id 사례 + 생성 문서 신고 사례는 연결, 무관 신고는 제외.
    improve_service._record_case(origin="convert_job", kind="invalid_output", detail={"m": 1}, run_id=run_id)
    improve_service.collect_report_case(
        document_id=doc_ids[0], doc_no="D1", title="t", reason="오답", source_detail=None
    )
    improve_service.collect_report_case(
        document_id=doc_ids[0], doc_no="D1", title="t", reason="오답2", source_detail=None
    )
    improve_service.collect_report_case(
        document_id=99999, doc_no="DX", title="x", reason="무관", source_detail=None
    )

    detail = client.get(f"/api/import/runs/{run_id}").json()
    assert detail["preview_available"] is False  # 커밋 완료 preview = 다시 검토 불가
    assert sorted(d["id"] for d in detail["documents"]) == sorted(doc_ids)
    cases = {c["kind"]: c for c in detail["failure_cases"]}
    assert set(cases) == {"invalid_output", "user_report"}
    assert cases["user_report"]["count"] == 2  # 같은 문서 재신고 = count+1(새 사례 아님)
    assert [e["type"] for e in detail["events"]] == ["created", "committed"]
    assert detail["run"]["summary"]["commits"][0]["created"] == 2
    _assert_no_answer_keys(detail)
    _assert_no_answer_keys(client.get("/api/import/runs").json())

    # 문서 소프트 삭제 후에도 documents에 남는다(휴지통 배지용).
    with Session() as db:
        db.get(models.Document, doc_ids[0]).is_active = 0
        db.commit()
    docs = client.get(f"/api/import/runs/{run_id}").json()["documents"]
    assert {d["id"]: d["is_active"] for d in docs}[doc_ids[0]] is False


def test_answer_key_apply_marks_committed_in_same_transaction(Session, monkeypatch):
    from services import answer_key_service

    with Session() as db:
        run = import_run_service.create_run(
            db, kind="answer_key", label="『k.txt』 답지 가공", status="review_ready", answer_key_id="akk_t1"
        )
        db.commit()
        run_id = run.id
    # 매칭·병합 로직은 대상 아님 — 빈 적용(updated 0)이어도 전이·이벤트는 같은 commit에 실린다.
    answer_key_service._KEYS["akk_t1"] = {
        "created_at": __import__("datetime").datetime.now(),
        "filename": "k.txt",
        "file_type": "txt",
        "category_id": 1,
        "source_bytes": b"1. 1",
        "job_id": "ak_t1",
    }
    monkeypatch.setattr(cs, "get_answer_key_job", lambda job_id: {"status": "done", "items": []})
    try:
        with Session() as db:
            answer_key_service.apply_answer_key(db, "akk_t1", [])
        run = _run(Session, run_id)
        assert run.status == "committed"
        assert _event_types(Session, run_id)[-1] == "answer_key_applied"
    finally:
        answer_key_service._KEYS.pop("akk_t1", None)
