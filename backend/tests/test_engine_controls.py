"""엔진 운용 제어 단위 테스트 (S21 F47, 설계 §4.23 — 활성 토글·모델 선택·422 방어).

기존 `test_llm_engine_registry.py`(S15 F41)를 건드리지 않고 인접 신규 파일로 확장한다
(지시서 6절). DB가 필요한 부분은 in-memory SQLite, 순수 함수는 DB 없이 검증한다. 실제
claude/codex CLI 호출은 하지 않는다(스모크는 별도).
"""
from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from exceptions import ValidationAppError
from services import llm_engine_service as engine_svc, settings_service


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


# ---------------------------------------------------------------------------
# ① 후보 자격 — disabled 엔진이 auto·다음 후보·fallback_engine에서 배제
# ---------------------------------------------------------------------------
def test_get_disabled_engines_empty_by_default(db):
    assert engine_svc.get_disabled_engines(db) == []


def test_get_disabled_engines_maps_legacy_alias_and_ignores_unknown(db):
    settings_service.update_settings(db, {"llm.disabled": ["cli", "not-a-real-engine"]})
    assert engine_svc.get_disabled_engines(db) == ["claude-cli"]


def test_is_engine_enabled_false_when_disabled(db):
    settings_service.update_settings(db, {"llm.disabled": ["claude-api"]})
    assert engine_svc.is_engine_enabled(db, "claude-api") is False
    assert engine_svc.is_engine_enabled(db, "claude-cli") is True


def test_is_engine_candidate_requires_available_and_enabled(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    settings_service.update_settings(db, {"llm.disabled": ["claude-api"]})
    assert engine_svc.is_engine_candidate(db, "claude-cli") is True
    assert engine_svc.is_engine_candidate(db, "claude-api") is False  # enabled=False


def test_is_engine_candidate_false_when_unavailable_even_if_enabled(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: False)
    assert engine_svc.is_engine_candidate(db, "claude-cli") is False


def test_resolve_engine_auto_skips_disabled_engine(db, monkeypatch):
    """disabled 엔진은 available()이 True여도 auto 해석에서 제외된다."""
    settings_service.update_settings(
        db, {"llm.priority": ["claude-cli", "claude-api"], "llm.disabled": ["claude-cli"]}
    )
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    assert engine_svc.resolve_engine(db, "auto") == "claude-api"


def test_resolve_engine_auto_returns_to_disabled_engine_once_reenabled(db, monkeypatch):
    """꺼진 엔진을 다시 켜면 즉시 후보로 복귀한다."""
    settings_service.update_settings(
        db, {"llm.priority": ["claude-cli", "claude-api"], "llm.disabled": ["claude-cli"]}
    )
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    assert engine_svc.resolve_engine(db, "auto") == "claude-api"

    settings_service.update_settings(db, {"llm.disabled": []})
    assert engine_svc.resolve_engine(db, "auto") == "claude-cli"


def test_resolve_engine_no_candidate_falls_back_to_first_enabled_ignoring_available(db, monkeypatch):
    """설계 §4.23 결정 ② ⓐ(2026-08-03 검토 반영) — 후보(available && enabled) 0이지만
    enabled 엔진은 있는 '비가용-전멸'은 최종 폴백이 `available()`을 무시하고 첫 enabled
    엔진을 반환한다(꺼진 엔진을 반환하면 안 됨)."""
    settings_service.update_settings(
        db, {"llm.priority": ["claude-api", "claude-cli"], "llm.disabled": ["claude-api"]}
    )
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: False)
    # claude-api는 disabled(제외 대상), claude-cli는 enabled(비가용) — 최종 폴백은 claude-cli
    assert engine_svc.resolve_engine(db, "auto") == "claude-cli"


def test_resolve_engine_defensive_head_when_all_engines_disabled(db, monkeypatch):
    """전부 꺼짐('꺼짐-포함 전멸')은 정상 흐름에서 `assert_engine_selectable`이 잡 생성
    전에 이미 막으므로 이 함수까지 도달하지 않아야 하지만, 방어적 반환값이 최소한
    안정적인지만 확인한다(우연히 도달해도 크래시하지 않음)."""
    settings_service.update_settings(
        db, {"llm.priority": ["claude-api", "claude-cli"], "llm.disabled": ["claude-api", "claude-cli", "codex-cli"]}
    )
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: False)
    assert engine_svc.resolve_engine(db, "auto") == "claude-api"  # priority 첫 값(방어적)


def test_next_fallback_engine_skips_disabled_candidate(db, monkeypatch):
    settings_service.update_settings(
        db,
        {
            "llm.priority": ["claude-cli", "codex-cli", "claude-api"],
            "llm.disabled": ["codex-cli"],
        },
    )
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    assert engine_svc.next_fallback_engine(db, "claude-cli") == "claude-api"


def test_build_error_info_fallback_engine_excludes_disabled(db, monkeypatch):
    settings_service.update_settings(
        db,
        {
            "llm.fallback": "ask",
            "llm.priority": ["claude-cli", "codex-cli", "claude-api"],
            "llm.disabled": ["codex-cli"],
        },
    )
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    info = engine_svc.build_error_info(db, "claude-cli", {"kind": "timeout", "message": "m", "action": "a"})
    assert info["fallback_available"] is True
    assert info["fallback_engine"] == "claude-api"  # codex-cli(disabled) 건너뜀


def test_resolve_engine_explicit_id_ignores_enabled_state(db, monkeypatch):
    """명시 지정(auto 아님)은 resolve_engine 자체에서 후보 판정을 하지 않는다(검증은
    별도 헬퍼 `assert_engine_selectable`이 담당 — ③절 테스트)."""
    settings_service.update_settings(db, {"llm.disabled": ["claude-api"]})
    assert engine_svc.resolve_engine(db, "claude-api") == "claude-api"


# ---------------------------------------------------------------------------
# ② 모델 유효 선택 — 소목록 밖 값 폴백·llm.api_model 별칭·null=미전달
# ---------------------------------------------------------------------------
def test_get_selected_model_default_when_unset(db):
    assert engine_svc.get_selected_model(db, "claude-cli") is None  # CLI형 기본 null
    assert engine_svc.get_selected_model(db, "claude-api") == engine_svc.DEFAULT_API_MODEL
    assert engine_svc.get_selected_model(db, "codex-cli") is None  # 소목록 빈 배열


def test_get_selected_model_valid_choice_applied(db):
    settings_service.update_settings(db, {"llm.models": {"claude-cli": "opus"}})
    assert engine_svc.get_selected_model(db, "claude-cli") == "opus"


def test_get_selected_model_out_of_list_value_falls_back_to_default(db):
    """소목록 개정 뒤 구 설정 잔존 — 조용히 기본값 폴백(전방 호환)."""
    settings_service.update_settings(db, {"llm.models": {"claude-api": "claude-3-ancient"}})
    assert engine_svc.get_selected_model(db, "claude-api") == engine_svc.DEFAULT_API_MODEL


def test_get_selected_model_legacy_api_model_alias(db):
    """`llm.models['claude-api']` 부재 시 legacy `llm.api_model`을 읽기 별칭으로 쓴다."""
    settings_service.update_settings(db, {"llm.api_model": "claude-opus-5"})
    assert engine_svc.get_selected_model(db, "claude-api") == "claude-opus-5"


def test_get_selected_model_llm_models_takes_precedence_over_legacy(db):
    settings_service.update_settings(
        db, {"llm.api_model": "claude-opus-5", "llm.models": {"claude-api": "claude-haiku-4-5-20251001"}}
    )
    assert engine_svc.get_selected_model(db, "claude-api") == "claude-haiku-4-5-20251001"


def test_get_selected_model_unknown_engine_returns_none(db):
    assert engine_svc.get_selected_model(db, "nope") is None


# ---------------------------------------------------------------------------
# ③ 422 방어 — 명시 지정 비활성·비가용 거부, auto 무검증, 공통 헬퍼 경유
# ---------------------------------------------------------------------------
def test_assert_engine_selectable_auto_never_raises_when_some_engine_enabled(db, monkeypatch):
    """auto는 상태 검증 대상이 아니다 — 단, 엔진이 하나라도 켜져 있는 한(비가용이어도)
    422를 던지지 않는다(명시 예외는 전부 꺼짐일 때뿐 — 아래 별도 테스트)."""
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: False)
    settings_service.update_settings(db, {"llm.disabled": ["claude-api", "codex-cli"]})
    engine_svc.assert_engine_selectable(db, "auto")  # claude-cli는 켜져 있음 — 예외 없음


def test_assert_engine_selectable_auto_raises_422_when_all_engines_disabled(db, monkeypatch):
    """설계 §4.23 결정 ②ⓑ·⑥ 명시 예외(2026-08-03 검토 반영) — enabled 엔진이 0이면
    auto도 잡 생성 전 422로 막는다(그렇지 않으면 resolve_engine의 최종 폴백이 꺼진
    엔진을 실행해 DoD 1을 위반한다)."""
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    settings_service.update_settings(db, {"llm.disabled": ["claude-cli", "claude-api", "codex-cli"]})
    with pytest.raises(ValidationAppError) as excinfo:
        engine_svc.assert_engine_selectable(db, "auto")
    assert "모든 엔진이 꺼져" in str(excinfo.value)
    assert excinfo.value.detail["reason"] == "all_disabled"


def test_assert_engine_selectable_unregistered_value_raises_when_all_disabled(db, monkeypatch):
    """등록되지 않은 임의 값도 auto와 같은 분기(정규화 실패 → 미등록 취급)를 타므로
    전부 꺼짐이면 마찬가지로 422다."""
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    settings_service.update_settings(db, {"llm.disabled": ["claude-cli", "claude-api", "codex-cli"]})
    with pytest.raises(ValidationAppError):
        engine_svc.assert_engine_selectable(db, "definitely-not-registered")


def test_assert_engine_selectable_disabled_raises_422_with_server_sentence(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    settings_service.update_settings(db, {"llm.disabled": ["claude-api"]})
    with pytest.raises(ValidationAppError) as excinfo:
        engine_svc.assert_engine_selectable(db, "claude-api")
    assert "사용 안 함" in str(excinfo.value)
    assert excinfo.value.detail["reason"] == "disabled"


def test_assert_engine_selectable_unavailable_cli_raises_422(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: False)
    with pytest.raises(ValidationAppError) as excinfo:
        engine_svc.assert_engine_selectable(db, "codex-cli")
    assert "설치" in str(excinfo.value)
    assert excinfo.value.detail["reason"] == "not_installed"


def test_assert_engine_selectable_unavailable_api_raises_422(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: False)
    with pytest.raises(ValidationAppError) as excinfo:
        engine_svc.assert_engine_selectable(db, "claude-api")
    assert "키" in str(excinfo.value)
    assert excinfo.value.detail["reason"] == "key_not_registered"


def test_assert_engine_selectable_available_and_enabled_passes(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    engine_svc.assert_engine_selectable(db, "claude-cli")  # 예외 없음


def test_assert_engine_selectable_legacy_alias_checked_after_mapping(db, monkeypatch):
    """legacy 별칭(`'cli'`)도 매핑된 신 id 기준으로 같은 검증을 받는다(값 형식 수용은
    별개 계약 — 상태 검증과 혼동 금지)."""
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    settings_service.update_settings(db, {"llm.disabled": ["claude-cli"]})
    with pytest.raises(ValidationAppError):
        engine_svc.assert_engine_selectable(db, "cli")


def test_assert_engine_selectable_unknown_value_not_validated(db):
    """등록되지 않은 임의 문자열은 검증 대상이 아니다(별도 경로에서 이미 값 형식 검증을
    수행 — 라우터 `_ENGINE_CHOICES`)."""
    engine_svc.assert_engine_selectable(db, "definitely-not-registered")  # 예외 없음


def test_assert_engine_selectable_disabled_takes_priority_over_unavailable(db, monkeypatch):
    """비활성이면서 동시에 비가용이어도 '사용 안 함' 사유가 우선한다(설계 §4.23 ⓒ)."""
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: False)
    settings_service.update_settings(db, {"llm.disabled": ["claude-api"]})
    with pytest.raises(ValidationAppError) as excinfo:
        engine_svc.assert_engine_selectable(db, "claude-api")
    assert excinfo.value.detail["reason"] == "disabled"


# ---------------------------------------------------------------------------
# ④ status 필드 4종 — 기존 필드·톱레벨 불변, 순수 추가만
# ---------------------------------------------------------------------------
@pytest.fixture()
def no_real_cli_diagnosis(monkeypatch):
    monkeypatch.setattr(
        engine_svc, "diagnose_engine", lambda eid, force=False: {"installed": False, "logged_in": False}
    )


def test_get_status_engines_include_new_fields(db, no_real_cli_diagnosis):
    status = engine_svc.get_status(db)
    by_id = {e["id"]: e for e in status["engines"]}
    for eid in ("claude-cli", "claude-api", "codex-cli"):
        assert "enabled" in by_id[eid]
        assert "models" in by_id[eid]
        assert "default_model" in by_id[eid]
        assert "selected_model" in by_id[eid]

    assert by_id["claude-cli"]["enabled"] is True
    assert by_id["claude-cli"]["models"] == [{"id": "sonnet", "label": "Sonnet"}, {"id": "opus", "label": "Opus"}]
    assert by_id["claude-cli"]["default_model"] is None
    assert by_id["claude-api"]["default_model"] == engine_svc.DEFAULT_API_MODEL
    assert by_id["codex-cli"]["models"] == []


def test_get_status_enabled_reflects_llm_disabled_setting(db, no_real_cli_diagnosis):
    settings_service.update_settings(db, {"llm.disabled": ["claude-api"]})
    status = engine_svc.get_status(db)
    by_id = {e["id"]: e for e in status["engines"]}
    assert by_id["claude-api"]["enabled"] is False
    assert by_id["claude-cli"]["enabled"] is True


def test_get_status_existing_fields_and_top_level_unchanged(db, no_real_cli_diagnosis):
    """S15 계약(§4.17 ②) 회귀 무영향 — 톱레벨 4개 키, 엔진 필드 기존 10종 그대로."""
    status = engine_svc.get_status(db)
    assert set(status.keys()) == {"engines", "limit", "priority", "fallback_policy"}
    entry = status["engines"][0]
    existing_keys = {
        "id",
        "label",
        "billing",
        "installable",
        "available",
        "installed",
        "logged_in",
        "key_registered",
        "key_suffix",
        "last_success_at",
        "last_error_kind",
    }
    assert existing_keys <= set(entry.keys())


# ---------------------------------------------------------------------------
# ⑤ 런타임 폴백 시 선택 모델 갱신 (검토 지적 ① — 이전 엔진의 모델 id가 새 엔진으로
#    누출되면 존재하지 않는 모델로 호출되는 사고가 난다)
# ---------------------------------------------------------------------------
def test_handle_engine_failure_auto_fallback_updates_model_for_new_engine(monkeypatch):
    from services import convert_service

    fallback_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(fallback_engine)
    TestSessionLocal = sessionmaker(bind=fallback_engine, autoflush=False, autocommit=False)

    setup_db = TestSessionLocal()
    try:
        settings_service.update_settings(
            setup_db,
            {
                "llm.fallback": "auto",
                "llm.priority": ["claude-cli", "claude-api"],
                "llm.models": {"claude-cli": "opus", "claude-api": "claude-opus-5"},
            },
        )
    finally:
        setup_db.close()

    monkeypatch.setattr(convert_service, "SessionLocal", TestSessionLocal)
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)

    job = {"_engine": "claude-cli", "_model": "opus", "_fallback_used": False}
    retry = convert_service._handle_engine_failure(
        "job_model_leak", job, "claude-cli", Exception("boom"), False
    )

    assert retry is True
    assert job["_engine"] == "claude-api"
    # 수정 전엔 이 값이 여전히 "opus"(claude-cli 기준)로 남아 claude-api에 존재하지 않는
    # 모델 id로 호출되는 사고가 났다 — 새 엔진(claude-api) 기준 선택값으로 갱신돼야 한다.
    assert job["_model"] == "claude-opus-5"


def test_handle_engine_failure_no_fallback_leaves_model_untouched(monkeypatch):
    """폴백이 일어나지 않으면(ask/off 정책 등) `_model`도 건드리지 않는다."""
    from services import convert_service

    fallback_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(fallback_engine)
    TestSessionLocal = sessionmaker(bind=fallback_engine, autoflush=False, autocommit=False)

    setup_db = TestSessionLocal()
    try:
        settings_service.update_settings(setup_db, {"llm.fallback": "ask", "llm.priority": ["claude-cli", "claude-api"]})
    finally:
        setup_db.close()

    monkeypatch.setattr(convert_service, "SessionLocal", TestSessionLocal)
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)

    job = {"_engine": "claude-cli", "_model": "opus", "_fallback_used": False}
    retry = convert_service._handle_engine_failure(
        "job_no_fallback", job, "claude-cli", Exception("boom"), False
    )

    assert retry is False
    assert job["_engine"] == "claude-cli"
    assert job["_model"] == "opus"
    assert job["_error_info"] is not None


# ---------------------------------------------------------------------------
# ⑥ 진입점 — 헬퍼 경유 회귀 (검토 지적 ⑦) — 9개 `start_*_job` 진입점이 공통 헬퍼를
#    실제로 호출하는지: 헬퍼가 예외를 던지면 잡 생성(큐 투입) 전에 반드시 전파돼야 한다
#    (진입점이 헬퍼를 우회하면 이 테스트가 실패한다).
# ---------------------------------------------------------------------------
def _make_question_document(db, doc_no: str):
    import models

    doc = models.Document(doc_no=doc_no, type="question", title="제목", content="내용")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_all_nine_entrypoints_propagate_assert_engine_selectable(db, monkeypatch):
    from services import convert_service, split_service

    def _boom(_db, _engine, *, model=None):
        # S22(F48 ④·ⓒ) — assert_engine_selectable가 model 키워드 인자를 받도록 확장됐다
        # (10개 진입점이 전부 model=... 키워드로 호출 — 이 목도 같은 시그니처를 받는다).
        raise ValidationAppError("entrypoint gate test boom")

    monkeypatch.setattr(convert_service.llm_engine_service, "assert_engine_selectable", _boom)

    doc_regen = _make_question_document(db, "q-regen-gate")
    doc_explain = _make_question_document(db, "q-explain-gate")

    # S23(F49, 설계 §4.25) — split_analyze도 10번째 지점으로 이 목에 합류하려면 유효한
    # 분할 상태가 먼저 있어야 한다(get_state_or_404가 헬퍼 호출보다 먼저라 404가 아니라
    # 이 목의 ValidationAppError까지 도달하는지 확인하려면 상태가 있어야 한다).
    with split_service._STATE_LOCK:
        split_service._STATE["spl_gate_test"] = {
            "split_id": "spl_gate_test",
            "created_at": "2026-01-01T00:00:00",
            "source_filename": "huge.txt",
            "source_hash12": "1" * 12,
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

    jobs_before = dict(convert_service._JOBS)

    calls = {
        "convert": lambda: convert_service.start_convert_job(
            db=db, upload_filename="a.txt", upload_bytes=b"hello", engine="claude-cli"
        ),
        "convert_from_url": lambda: convert_service.start_convert_job_from_url(
            db=db, url="https://example.com/a.pdf", engine="claude-cli"
        ),
        "fetch": lambda: convert_service.start_fetch_job(
            db=db, adapter_id="qnet", cert_ref="x", exam_ref="y", engine="claude-cli"
        ),
        "regenerate": lambda: convert_service.start_regenerate_job(
            db, doc_regen.id, "사유", engine="claude-cli"
        ),
        "answer_key": lambda: convert_service.start_answer_key_job(
            db, source_filename="a.txt", source_bytes=b"hello", engine="claude-cli"
        ),
        "explain": lambda: convert_service.start_explain_job(db, doc_explain.id, engine="claude-cli"),
        "applied_exam": lambda: convert_service.start_applied_exam_job(
            db=db, gen_id="g1", scope_label="s", requested_count=1, basis_docs=[], engine="claude-cli"
        ),
        "improve_proposal": lambda: convert_service.start_improve_proposal_job(
            db=db, gen_id="g1", prompt="p", case_ids=[], engine="claude-cli"
        ),
        "improve_regression": lambda: convert_service.start_improve_regression_job(
            db=db, reg_id="r1", case_ids=[], engine="claude-cli"
        ),
        "split_analyze": lambda: convert_service.start_split_analyze_job(
            db, split_id="spl_gate_test", engine="claude-cli"
        ),
    }

    try:
        assert len(calls) == 10
        for name, call in calls.items():
            with pytest.raises(ValidationAppError):
                call()

        # 예외가 잡 생성 전에 전파됐으니 전역 잡 큐에 새 항목이 하나도 남지 않아야 한다
        # (진입점이 헬퍼를 우회하고 잡을 큐에 넣었다면 이 비교가 실패한다).
        assert dict(convert_service._JOBS) == jobs_before
    finally:
        split_service._STATE.pop("spl_gate_test", None)
