"""LLM 작업 센터 단위 테스트 (S22 F48, 설계 §4.24 — 전역 잡 목록·취소·대기열 일시정지·
요청 단위 모델).

실 LLM 호출은 하지 않는다 — 잡 레코드는 `convert_service._JOBS`에 직접 구성해(목킹/
인메모리) 취소 상태 전이·레이스·pause/resume·목록 파생·model 검증을 검증한다.

예외 1건: `_terminate_process_tree`의 Windows 프로세스 트리 종료 실측은 claude/codex
CLI 대신 무해한 파이썬 서브프로세스로 부모→자식 트리를 재현해 확인한다(R24 실측 — LLM
0, 실제 LLM 엔진을 스폰하지 않는다).
"""
from __future__ import annotations

import datetime as dt
import subprocess
import sys
import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from exceptions import ConflictError, NotFoundError, ValidationAppError
from services import convert_service as cs
from services import llm_engine_service as engine_svc
from services import settings_service


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _make_question_document(db, doc_no: str):
    import models

    doc = models.Document(doc_no=doc_no, type="question", title="제목", content="내용")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@pytest.fixture()
def clean_current_job():
    """각 테스트가 `_CURRENT_JOB_ID`를 건드려도 다른 테스트에 새지 않도록 정리한다."""
    yield
    with cs._JOBS_LOCK:
        cs._CURRENT_JOB_ID = None


@pytest.fixture()
def restore_queue_paused():
    """pause/resume 테스트가 실패해도 큐가 paused 상태로 남아 다른 테스트를 막지 않게 한다."""
    yield
    cs.resume_queue()


def _fake_job(kind: str, **overrides) -> dict:
    job = cs._new_job_base(kind, resolved_engine="claude-cli", requested_engine="claude-cli", model=None)
    job.update(overrides)
    return job


def _register_job(job_id: str, job: dict) -> None:
    with cs._JOBS_LOCK:
        cs._JOBS[job_id] = job


def _drop_jobs(*job_ids: str) -> None:
    with cs._JOBS_LOCK:
        for jid in job_ids:
            cs._JOBS.pop(jid, None)


# ---------------------------------------------------------------------------
# ① 취소 상태 전이 — queued 제거·running 중단·done/error/cancelled=409·미존재=404·
#    전이 후 목록 반영
# ---------------------------------------------------------------------------
def test_cancel_missing_job_raises_404():
    with pytest.raises(NotFoundError):
        cs.cancel_job("does-not-exist-job-id")


def test_cancel_queued_job_marks_cancelled_and_worker_skips_it(monkeypatch, restore_queue_paused):
    """queued(아직 워커가 집지 않은 잡) 취소 = 큐 제거 취급(LLM 0) — 실제로 워커가 나중에
    이 job_id를 뽑아도 처리하지 않고 건너뛴다(§4.24 ② "queued → cancelled = 큐 제거")."""
    cs._ensure_worker()
    cs.pause_queue()  # 워커가 절대 픽업하지 못하게 확실히 막아둔 채로 취소부터 확정한다

    calls: list[str] = []

    def _fake_do_explain(job_id: str, job: dict) -> dict:
        calls.append(job_id)
        return {"draft": {"explanation": "x", "answer": None}}

    monkeypatch.setattr(cs, "_do_explain_job", _fake_do_explain)

    job_id = "exp_cancel_queued_test"
    job = _fake_job("explain", document_id=1, _label="취소 대상")
    _register_job(job_id, job)
    try:
        result = cs.cancel_job(job_id)
        assert result == {"status": "cancelled", "usage": None}
        with cs._JOBS_LOCK:
            assert cs._JOBS[job_id]["status"] == "cancelled"

        cs._QUEUE.put(job_id)
        cs.resume_queue()
        time.sleep(0.3)  # 워커가 큐를 소비할 시간을 준다
        assert calls == []  # 취소된 잡은 실행되지 않는다(LLM 0)

        overview = cs.list_jobs_overview()
        item = next(it for it in overview["items"] if it["job_id"] == job_id)
        assert item["status"] == "cancelled"
        assert item["error_info"] is None  # 취소는 오류가 아니다
    finally:
        _drop_jobs(job_id)


def test_cancel_running_job_kills_real_process_and_reports_usage(clean_current_job):
    """running 잡 취소 — 실제(무해한) 서브프로세스를 등록해 두고 취소 시 실제로 종료되는지,
    마지막 usage가 응답에 실리는지 확인한다(부분 과금 정직 표기)."""
    job_id = "cvt_cancel_running_test"
    job = _fake_job(
        "convert",
        _label="취소 진행 중 테스트",
        _usage={"input_tokens": 120, "output_tokens": 40, "cost_usd": 0.01},
    )
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    job["_proc"] = proc
    _register_job(job_id, job)
    with cs._JOBS_LOCK:
        cs._CURRENT_JOB_ID = job_id
    try:
        result = cs.cancel_job(job_id)
        assert result["status"] == "cancelled"
        assert result["usage"] == {"input_tokens": 120, "output_tokens": 40, "cost_usd": 0.01}
        with cs._JOBS_LOCK:
            assert cs._JOBS[job_id]["status"] == "cancelled"

        time.sleep(0.5)
        assert proc.poll() is not None  # 실제로 종료됨(Windows taskkill /F /T 실측)
    finally:
        _drop_jobs(job_id)
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


def test_cancel_running_job_without_usage_reports_none(clean_current_job):
    """진행 중 usage가 전혀 쌓이지 않은 잡(예: 다운로드 단계에서 즉시 취소)은 usage=None."""
    job_id = "cvt_cancel_no_usage_test"
    job = _fake_job("convert", _label="취소 진행 중(usage 없음)")
    _register_job(job_id, job)
    with cs._JOBS_LOCK:
        cs._CURRENT_JOB_ID = job_id
    try:
        result = cs.cancel_job(job_id)
        assert result == {"status": "cancelled", "usage": None}
    finally:
        _drop_jobs(job_id)


@pytest.mark.parametrize("terminal_status", ["done", "error", "cancelled"])
def test_cancel_terminal_job_raises_409(terminal_status):
    job_id = f"cvt_cancel_terminal_{terminal_status}"
    job = _fake_job("convert", _label="종료된 잡", status=terminal_status)
    if terminal_status == "done":
        job["result"] = {"result_preview_id": "prev_keep"}
    _register_job(job_id, job)
    try:
        with pytest.raises(ConflictError) as excinfo:
            cs.cancel_job(job_id)
        assert "이미 완료된 작업" in str(excinfo.value)
        # 결과 보존 확인 — 취소 시도가 기존 상태·결과를 훼손하지 않는다.
        with cs._JOBS_LOCK:
            assert cs._JOBS[job_id]["status"] == terminal_status
            if terminal_status == "done":
                assert cs._JOBS[job_id]["result"]["result_preview_id"] == "prev_keep"
    finally:
        _drop_jobs(job_id)


# ---------------------------------------------------------------------------
# ② 레이스 — 완료 선착 = 409 + 결과 보존 · 취소 선착 = 후착 산출물 폐기
# ---------------------------------------------------------------------------
def test_race_completion_wins_when_done_reaches_lock_first():
    """완료가 먼저 상태를 'done'으로 확정한 뒤 취소가 도착하면 409 + 결과 보존."""
    job_id = "cvt_race_done_first"
    job = _fake_job("convert", _label="레이스: 완료 선착", status="done")
    job["result"] = {"result_preview_id": "prev_race_done"}
    _register_job(job_id, job)
    try:
        with pytest.raises(ConflictError):
            cs.cancel_job(job_id)
        with cs._JOBS_LOCK:
            assert cs._JOBS[job_id]["status"] == "done"
            assert cs._JOBS[job_id]["result"]["result_preview_id"] == "prev_race_done"
    finally:
        _drop_jobs(job_id)


def test_race_cancel_wins_discards_later_success_result(monkeypatch, clean_current_job):
    """취소가 먼저 확정된 뒤(예: 처리 도중 레이스) 완료 산출물이 도착해도 `_process_job`은
    그 결과를 버린다(취소가 완료 결과를 지우는 경로는 있어도, 완료가 취소 확정을 지우는
    경로는 0이어야 한다)."""
    job_id = "cvt_race_cancel_first"
    job = _fake_job("convert", _label="레이스: 취소 선착")
    _register_job(job_id, job)
    with cs._JOBS_LOCK:
        cs._CURRENT_JOB_ID = job_id

    def _fake_do_convert(jid: str, j: dict) -> dict:
        # 처리 도중 취소가 레이스로 먼저 확정되는 상황을 그대로 재현(같은 cancel_job 경유).
        cs.cancel_job(jid)
        return {"result_preview_id": "should_be_discarded"}

    monkeypatch.setattr(cs, "_do_convert", _fake_do_convert)
    try:
        cs._process_job(job_id)  # 워커가 실제로 부르는 함수 그대로 호출
        with cs._JOBS_LOCK:
            final = cs._JOBS.get(job_id)
        assert final["status"] == "cancelled"
        assert final["result"] is None  # 완료 산출물 폐기 확인
    finally:
        _drop_jobs(job_id)


def test_race_cancel_wins_does_not_record_error_from_kill_byproduct(monkeypatch, clean_current_job):
    """취소 확정 후 도착하는 예외(킬로 인한 비정상 종료의 부산물)는 오류로 기록되지 않는다
    (폴백 시도·사례 수집도 하지 않는다 — `_process_job`이 워커를 멈추지 않아야 한다)."""
    job_id = "cvt_race_error_after_cancel"
    job = _fake_job("convert", _label="레이스: 취소 후 예외")
    _register_job(job_id, job)
    with cs._JOBS_LOCK:
        cs._CURRENT_JOB_ID = job_id

    def _fake_do_convert(jid: str, j: dict) -> dict:
        cs.cancel_job(jid)
        raise cs.ClaudeCliError("킬로 인한 비정상 종료(부산물)")

    monkeypatch.setattr(cs, "_do_convert", _fake_do_convert)
    try:
        cs._process_job(job_id)  # 예외를 밖으로 던지면 안 된다(워커 스레드가 계속 돌아야 함)
        with cs._JOBS_LOCK:
            final = cs._JOBS.get(job_id)
        assert final["status"] == "cancelled"
        assert final["error"] is None
        assert final["_error_info"] is None
    finally:
        _drop_jobs(job_id)


def test_handle_engine_failure_skips_fallback_when_cancelled():
    """`_handle_engine_failure`는 취소 확정 잡에서 분류·폴백·한도 기억을 전혀 하지 않고
    즉시 False를 반환한다(취소를 엔진 실패로 오분류해 다른 엔진으로 재시도하면 취소가
    무력화된다)."""
    job = _fake_job("convert", _label="취소 중 폴백 방지", _cancel_requested=True)
    retry = cs._handle_engine_failure("job_x", job, "claude-cli", Exception("boom"), False)
    assert retry is False
    assert job["_error_info"] is None  # 분류 자체가 일어나지 않았다


# ---------------------------------------------------------------------------
# ③ pause/resume — 다음 잡 시작 보류·running 무영향·멱등·paused 중 등록 = 대기 적재
# ---------------------------------------------------------------------------
def test_pause_resume_idempotent_and_reflected_in_queue_state(restore_queue_paused):
    assert cs.pause_queue() is True
    assert cs.pause_queue() is True  # 멱등
    assert cs.is_queue_paused() is True
    assert cs.list_jobs_overview()["queue"]["paused"] is True

    assert cs.resume_queue() is False
    assert cs.resume_queue() is False  # 멱등
    assert cs.is_queue_paused() is False
    assert cs.list_jobs_overview()["queue"]["paused"] is False


def test_pause_defers_next_job_start_but_registration_still_queues(monkeypatch, restore_queue_paused):
    """paused 중에도 잡 등록(시작 API 호출 = `_JOBS`에 레코드 생성 + 큐 적재)은 허용된다 —
    보류되는 것은 "워커의 다음 잡 시작"뿐이다."""
    cs._ensure_worker()
    cs.pause_queue()

    calls: list[str] = []

    def _fake_do_explain(job_id: str, job: dict) -> dict:
        calls.append(job_id)
        return {"draft": {"explanation": "x", "answer": None}}

    monkeypatch.setattr(cs, "_do_explain_job", _fake_do_explain)

    job_id = "exp_pause_defer_test"
    job = _fake_job("explain", document_id=99, _label="일시정지 중 등록")
    _register_job(job_id, job)
    cs._QUEUE.put(job_id)
    try:
        time.sleep(0.3)
        assert calls == []  # 다음 잡 시작이 보류됐다
        overview = cs.list_jobs_overview()
        item = next(it for it in overview["items"] if it["job_id"] == job_id)
        assert item["status"] == "queued"  # 대기 적재는 됐다(등록 자체는 허용)

        cs.resume_queue()
        for _ in range(50):
            if calls:
                break
            time.sleep(0.05)
        assert calls == [job_id]  # 재개 후 정상 처리
    finally:
        _drop_jobs(job_id)


def test_pause_does_not_affect_already_running_job(clean_current_job):
    """paused는 이미 워커가 처리 중인(현재) 잡에는 영향이 없다 — 목록에서도 계속
    'running'으로 보인다(§4.24 결정 ③ "running 잡은 완료까지 진행")."""
    job_id = "cvt_running_unaffected_by_pause"
    job = _fake_job("convert", _label="실행 중 — pause 무영향")
    _register_job(job_id, job)
    with cs._JOBS_LOCK:
        cs._CURRENT_JOB_ID = job_id
    try:
        cs.pause_queue()
        overview = cs.list_jobs_overview()
        item = next(it for it in overview["items"] if it["job_id"] == job_id)
        assert item["status"] == "running"
    finally:
        cs.resume_queue()
        _drop_jobs(job_id)


# ---------------------------------------------------------------------------
# ④ model 검증 — auto+model 422 · 소목록 밖 422 · 유효값 적용 · 미지정 폴백 불변 ·
#    폴백 시 재산출 · settings 무변경 · 9개 진입점 공통 헬퍼 경유
# ---------------------------------------------------------------------------
def test_assert_engine_selectable_model_with_auto_raises_422(db):
    with pytest.raises(ValidationAppError) as excinfo:
        engine_svc.assert_engine_selectable(db, "auto", model="opus")
    assert "엔진을 먼저 선택" in str(excinfo.value)
    assert excinfo.value.detail["reason"] == "model_requires_explicit_engine"


def test_assert_engine_selectable_model_with_unregistered_engine_raises_422(db):
    with pytest.raises(ValidationAppError) as excinfo:
        engine_svc.assert_engine_selectable(db, "not-a-real-engine", model="opus")
    assert excinfo.value.detail["reason"] == "model_requires_explicit_engine"


def test_assert_engine_selectable_model_not_in_list_raises_422(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    with pytest.raises(ValidationAppError) as excinfo:
        engine_svc.assert_engine_selectable(db, "claude-cli", model="not-a-real-model")
    assert excinfo.value.detail["reason"] == "model_not_in_list"
    assert "선택할 수 없는 모델" in str(excinfo.value)


def test_assert_engine_selectable_model_valid_choice_passes(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    engine_svc.assert_engine_selectable(db, "claude-cli", model="opus")  # 예외 없음


def test_assert_engine_selectable_model_none_leaves_existing_behavior_unchanged(db, monkeypatch):
    """model 미지정 시 기존 동작과 바이트 수준 동일(예외 없음 — S21 회귀 없음)."""
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    engine_svc.assert_engine_selectable(db, "claude-cli")  # model 인자 자체를 생략


def test_resolve_engine_and_model_override_applied(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    resolved, model, pre_fallback = cs._resolve_engine_and_model(db, "claude-cli", "opus")
    assert resolved == "claude-cli"
    assert model == "opus"
    assert pre_fallback is False


def test_resolve_engine_and_model_unspecified_falls_back_to_settings_value(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    settings_service.update_settings(db, {"llm.models": {"claude-cli": "sonnet"}})
    resolved, model, pre_fallback = cs._resolve_engine_and_model(db, "claude-cli", None)
    assert resolved == "claude-cli"
    assert model == "sonnet"
    assert pre_fallback is False


def test_resolve_engine_and_model_pre_fallback_discards_requested_model(db, monkeypatch):
    """사전 폴백(원격 한도 기억)이 엔진을 바꾸면 요청 model은 버리고 새 엔진의 설정값으로
    재산출한다(설계 §4.24 결정 ④ⓓ)."""
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    monkeypatch.setattr(engine_svc, "apply_remembered_limit", lambda _db, engine: "claude-api")
    resolved, model, pre_fallback = cs._resolve_engine_and_model(db, "claude-cli", "opus")
    assert resolved == "claude-api"
    assert pre_fallback is True
    assert model == engine_svc.DEFAULT_API_MODEL  # 'opus'(claude-cli 전용 값)가 아니다


def test_resolve_engine_and_model_does_not_write_settings(db, monkeypatch):
    """1회성 — settings `llm.models`는 요청 model 오버라이드로 쓰기가 발생하지 않는다."""
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    before = settings_service.get_setting(db, "llm.models", {})
    cs._resolve_engine_and_model(db, "claude-cli", "opus")
    after = settings_service.get_setting(db, "llm.models", {})
    assert before == after == {}


def _register_fake_split_state(split_id: str) -> None:
    """S23(F49) — `split_service._STATE`에 최소 유효 상태를 직접 주입(진짜 분할 시작 파이프
    라인 없이 `start_split_analyze_job`의 공통 헬퍼 경유만 검증하는 목적, `_fake_job` 전례)."""
    from services import split_service

    with split_service._STATE_LOCK:
        split_service._STATE[split_id] = {
            "split_id": split_id,
            "created_at": dt.datetime.now().isoformat(),
            "source_filename": "huge.txt",
            "source_hash12": "0" * 12,
            "source_chars": 300_000,
            "confidence": "uncertain",
            "chunks": [],
            "heuristic_chunks": [],
            "status": "ready",
            "analyze_job_id": None,
            "analyze_estimate": {"approx_input_tokens": 100, "assumed": False},
            "duplicate_of": None,
            "head_sample": "",
            "tail_sample": "",
            "tail_start": 0,
            "allowed_ranges": [],
            "boundary_excerpts": [],
            "_mem_since": dt.datetime.now(),
        }


def test_nine_entrypoints_apply_requested_model_via_common_helper(
    db, monkeypatch, restore_queue_paused, tmp_path
):
    """10개 진입점 전부가 `_resolve_engine_and_model`(→ `assert_engine_selectable`)을 거쳐
    요청 model을 `job['_model']`에 반영한다 — 실제 워커가 집어가 진짜 CLI를 부르지 못하도록
    큐를 일시정지한 채로 잡 레코드만 즉시 검사하고 치운다.

    S23(F49, 설계 §4.25) — `split_analyze`가 10번째 지점으로 합류(§4.23 ⓒ·§4.24 ⓒ 표 갱신).
    `split_service.SPLIT_DIR`을 tmp_path로 격리해 실제 프로젝트 `import/split/`를
    오염시키지 않는다(F40-① 전례 — `set_analyze_job`이 상태를 디스크에 저장하기 때문)."""
    from services import split_service

    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    monkeypatch.setattr(split_service, "SPLIT_DIR", tmp_path / "import" / "split")
    cs.pause_queue()

    doc_regen = _make_question_document(db, "q-regen-model")
    doc_explain = _make_question_document(db, "q-explain-model")
    _register_fake_split_state("spl_entrypoint_test")

    starters = {
        "convert": lambda: cs.start_convert_job(
            db=db, upload_filename="a.txt", upload_bytes=b"hello", engine="claude-cli", model="opus"
        ),
        "convert_from_url": lambda: cs.start_convert_job_from_url(
            db=db, url="https://example.com/a.pdf", engine="claude-cli", model="opus"
        ),
        "fetch": lambda: cs.start_fetch_job(
            db=db, adapter_id="qnet", cert_ref="x", exam_ref="y", engine="claude-cli", model="opus"
        ),
        "regenerate": lambda: cs.start_regenerate_job(
            db, doc_regen.id, "사유", engine="claude-cli", model="opus"
        ),
        "answer_key": lambda: cs.start_answer_key_job(
            db, source_filename="a.txt", source_bytes=b"hello", engine="claude-cli", model="opus"
        ),
        "explain": lambda: cs.start_explain_job(db, doc_explain.id, engine="claude-cli", model="opus"),
        "applied_exam": lambda: cs.start_applied_exam_job(
            db=db, gen_id="g1", scope_label="s", requested_count=1, basis_docs=[], engine="claude-cli", model="opus"
        ),
        "improve_proposal": lambda: cs.start_improve_proposal_job(
            db=db, gen_id="g1", prompt="p", case_ids=[], engine="claude-cli", model="opus"
        ),
        "improve_regression": lambda: cs.start_improve_regression_job(
            db=db, reg_id="r1", case_ids=[], engine="claude-cli", model="opus"
        ),
        "split_analyze": lambda: cs.start_split_analyze_job(
            db, split_id="spl_entrypoint_test", engine="claude-cli", model="opus"
        ),
    }
    assert len(starters) == 10

    created_job_ids: list[str] = []
    try:
        for name, starter in starters.items():
            job_id = starter()
            created_job_ids.append(job_id)
            with cs._JOBS_LOCK:
                assert cs._JOBS[job_id]["_model"] == "opus", f"{name} 진입점이 model을 반영하지 않음"
    finally:
        _drop_jobs(*created_job_ids)
        split_service._STATE.pop("spl_entrypoint_test", None)


# ---------------------------------------------------------------------------
# ⑤ 잡 목록 — 전 kind 파생·정렬·ref·label에 정답·해설·원문 부재
# ---------------------------------------------------------------------------
def test_list_jobs_derives_status_ref_and_label_per_kind(clean_current_job):
    created: list[str] = []
    try:
        j_convert = _fake_job(
            "convert",
            _label="『a.pdf』 변환",
            status="done",
            result={"result_preview_id": "prev_1"},
            _finished_at=dt.datetime.now(),
        )
        _register_job("j_convert", j_convert)
        created.append("j_convert")

        j_regen = _fake_job("regenerate", document_id=42, _label="『DOC-0001 제목』 재생성")
        _register_job("j_regen", j_regen)
        created.append("j_regen")
        with cs._JOBS_LOCK:
            cs._CURRENT_JOB_ID = "j_regen"

        j_answer_key = _fake_job("answer_key", _key_id="ak_1", _label="『key.pdf』 답지 가공")
        _register_job("j_answer_key", j_answer_key)
        created.append("j_answer_key")

        j_applied = _fake_job(
            "applied_exam",
            gen_id="gen_x1",
            _label="AI 응용 문항 생성 — 통계적 품질관리 (16문항)",
            status="error",
            _error_info={
                "kind": "other",
                "limit_kind": None,
                "resets_at": None,
                "message": "실패했습니다",
                "action": "다시 시도하세요",
                "fallback_available": False,
            },
            _finished_at=dt.datetime.now(),
        )
        _register_job("j_applied", j_applied)
        created.append("j_applied")

        j_improve_gen = _fake_job("improve_proposal", gen_id="gen_ip1", _label="반입 개선 제안 생성 — 사례 3건")
        _register_job("j_improve_gen", j_improve_gen)
        created.append("j_improve_gen")

        j_improve_reg = _fake_job("improve_regression", _reg_id="reg_1", _label="반입 개선 회귀 재검증 — 사례 2건")
        _register_job("j_improve_reg", j_improve_reg)
        created.append("j_improve_reg")

        overview = cs.list_jobs_overview()
        by_id = {it["job_id"]: it for it in overview["items"] if it["job_id"] in created}

        assert by_id["j_convert"]["ref"] == {"preview_id": "prev_1"}
        assert by_id["j_convert"]["status"] == "done"
        assert by_id["j_convert"]["label"] == "『a.pdf』 변환"

        assert by_id["j_regen"]["ref"] == {"document_id": 42}
        assert by_id["j_regen"]["status"] == "running"
        assert by_id["j_regen"]["progress"] is not None

        assert by_id["j_answer_key"]["ref"] == {"key_id": "ak_1"}
        assert by_id["j_answer_key"]["status"] == "queued"
        assert by_id["j_answer_key"]["progress"] is None

        assert by_id["j_applied"]["ref"] == {"gen_id": "gen_x1"}
        assert by_id["j_applied"]["status"] == "error"
        assert by_id["j_applied"]["error_info"] is not None

        assert by_id["j_improve_gen"]["ref"] == {"gen_id": "gen_ip1"}
        assert by_id["j_improve_reg"]["ref"] == {"reg_id": "reg_1"}

        # 불변 규칙 1 — 정답·해설·LLM 산출 원문은 목록 응답의 어떤 필드에도 없다.
        forbidden_keys = {"answer", "explanation", "content", "choices", "draft", "result", "items"}
        for item in overview["items"]:
            assert not (forbidden_keys & set(item.keys()))
            assert not (forbidden_keys & set(item["ref"].keys()))
    finally:
        _drop_jobs(*created)


def test_list_jobs_sort_order_running_then_queued_registration_order_then_terminal_latest_first(
    clean_current_job,
):
    created: list[str] = []
    try:
        now = dt.datetime.now()

        q1 = _fake_job("explain", document_id=1, _label="q1", created_at=now - dt.timedelta(seconds=10))
        _register_job("q1", q1)
        created.append("q1")

        q2 = _fake_job("explain", document_id=2, _label="q2", created_at=now - dt.timedelta(seconds=5))
        _register_job("q2", q2)
        created.append("q2")

        running1 = _fake_job("explain", document_id=3, _label="running1")
        _register_job("running1", running1)
        created.append("running1")
        with cs._JOBS_LOCK:
            cs._CURRENT_JOB_ID = "running1"

        old_done = _fake_job(
            "explain",
            document_id=4,
            _label="old_done",
            status="done",
            result={"draft": None},
            _finished_at=now - dt.timedelta(seconds=100),
        )
        _register_job("old_done", old_done)
        created.append("old_done")

        new_done = _fake_job(
            "explain",
            document_id=5,
            _label="new_done",
            status="done",
            result={"draft": None},
            _finished_at=now - dt.timedelta(seconds=1),
        )
        _register_job("new_done", new_done)
        created.append("new_done")

        overview = cs.list_jobs_overview()
        ids_in_order = [it["job_id"] for it in overview["items"] if it["job_id"] in created]
        assert ids_in_order == ["running1", "q1", "q2", "new_done", "old_done"]
    finally:
        _drop_jobs(*created)


def test_list_jobs_queue_concurrency_is_always_one():
    overview = cs.list_jobs_overview()
    assert overview["queue"]["concurrency"] == 1


# ---------------------------------------------------------------------------
# ⑥ 취소 확정~저장 사이의 창(검토 지적) — LLM 반환 후 취소가 먼저 확정되면 저장(DB
#    finalize_generation / 사례 파일 append_regression)이 호출되지 않아야 한다.
# ---------------------------------------------------------------------------
def test_applied_exam_finalize_not_called_when_cancelled_after_llm_return(monkeypatch, clean_current_job):
    """LLM 반환 직후~`finalize_generation`(DB 저장) 사이에 취소가 확정되는 레이스를
    재현한다 — 저장 직전 체크포인트가 없으면 취소된 잡의 산출물이 DB에 저장된다."""
    from services import applied_exam_service

    job_id = "apx_cancel_before_save_test"
    job = _fake_job(
        "applied_exam",
        gen_id="gen_cancel_1",
        _prompt="테스트 프롬프트",
        _basis_docs=[],
        _requested_count=1,
        _label="취소 저장 직전 테스트",
    )
    _register_job(job_id, job)
    with cs._JOBS_LOCK:
        cs._CURRENT_JOB_ID = job_id

    def _fake_llm(prompt, *, timeout_seconds, job_id, model=None):
        # LLM이 결과를 반환하는 시점에 레이스로 취소가 먼저 확정되는 상황을 재현한다.
        cs.cancel_job(job_id)
        return '{"items": [{"content": "q", "choices": ["a", "b"], "answer": "a", "basis": []}]}'

    monkeypatch.setattr(cs, "_run_claude_cli_streaming", _fake_llm)

    finalize_calls: list = []
    monkeypatch.setattr(
        applied_exam_service, "finalize_generation", lambda j, items: finalize_calls.append(items)
    )

    try:
        with pytest.raises(cs._JobCancelled):
            cs._do_applied_exam_job(job_id, job)
        assert finalize_calls == []  # 저장(DB 트랜잭션)이 호출되지 않았다
        with cs._JOBS_LOCK:
            assert cs._JOBS[job_id]["status"] == "cancelled"
    finally:
        _drop_jobs(job_id)


def test_improve_regression_append_not_called_when_cancelled_after_llm_return(
    monkeypatch, clean_current_job
):
    """LLM 반환 직후~`append_regression`(사례 파일 저장) 사이에 취소가 확정되는 레이스를
    재현한다 — 저장 직전 체크포인트가 없으면 취소된 잡의 사례 결과가 저장된다."""
    from services import improve_service

    job_id = "irg_cancel_before_save_test"
    job = _fake_job(
        "improve_regression",
        _reg_id="reg_cancel_1",
        _case_ids=["case_1"],
        _label="취소 저장 직전 테스트(회귀)",
    )
    _register_job(job_id, job)
    with cs._JOBS_LOCK:
        cs._CURRENT_JOB_ID = job_id

    monkeypatch.setattr(improve_service, "get_case_or_404", lambda case_id: {"case_id": case_id})

    def _fake_run_case(jid, j, record):
        # LLM(재변환)이 결과를 반환하는 시점에 레이스로 취소가 먼저 확정되는 상황을 재현한다.
        cs.cancel_job(jid)
        return "passed", "재변환 완료(구조화 오류 없음)"

    monkeypatch.setattr(cs, "_regression_run_case", _fake_run_case)

    append_calls: list = []
    monkeypatch.setattr(
        improve_service,
        "append_regression",
        lambda case_id, *, reg_id, outcome: append_calls.append((case_id, reg_id, outcome)),
    )

    try:
        with pytest.raises(cs._JobCancelled):
            cs._do_improve_regression_job(job_id, job)
        assert append_calls == []  # 사례 저장(파일 IO)이 호출되지 않았다
        with cs._JOBS_LOCK:
            assert cs._JOBS[job_id]["status"] == "cancelled"
    finally:
        _drop_jobs(job_id)


# ---------------------------------------------------------------------------
# 부록 — Windows 프로세스 트리 종료 실측(R24, LLM 0 — claude/codex를 스폰하지 않는다)
# ---------------------------------------------------------------------------
def test_terminate_process_tree_kills_real_child_process_on_windows():
    """부모 파이썬 프로세스가 자식 파이썬 프로세스를 하나 더 띄우는 실제 트리를 재현해
    `taskkill /F /T`가 자식까지 종료하는지 확인한다(claude/codex 대신 무해한 스폰 — 지시서
    "실 LLM 호출 절대 금지" 준수)."""
    child_script = (
        "import subprocess,sys,time;"
        "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)']);"
        "print(p.pid, flush=True);"
        "time.sleep(30)"
    )
    parent = subprocess.Popen(
        [sys.executable, "-c", child_script],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        line = parent.stdout.readline()
        child_pid = int(line.strip())

        cs._terminate_process_tree(parent)

        time.sleep(0.5)
        assert parent.poll() is not None  # 부모 종료 확인

        check = subprocess.run(
            ["tasklist", "/FI", f"PID eq {child_pid}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert str(child_pid) not in check.stdout  # 자식도 트리 종료로 함께 죽었다
    finally:
        if parent.poll() is None:
            parent.kill()
            parent.wait(timeout=5)
