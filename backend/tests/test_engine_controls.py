"""엔진 운용 제어 단위 테스트 (S21 F47, 설계 §4.23 — 활성 토글·모델 선택·422 방어).

기존 `test_llm_engine_registry.py`(S15 F41)를 건드리지 않고 인접 신규 파일로 확장한다
(지시서 6절). DB가 필요한 부분은 in-memory SQLite, 순수 함수는 DB 없이 검증한다. 실제
claude/codex CLI 호출은 하지 않는다(스모크는 별도).
"""
from __future__ import annotations

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
def test_assert_engine_selectable_auto_never_raises(db, monkeypatch):
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: False)
    settings_service.update_settings(db, {"llm.disabled": ["claude-cli", "claude-api", "codex-cli"]})
    engine_svc.assert_engine_selectable(db, "auto")  # 예외 없음


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
