"""LLM 엔진 레지스트리·우선순위 폴백·codex 오류 분류 단위 테스트
(S15 F41, 지시서 1·2절 — 설계 §4.17 ①③④).

DB가 필요한 부분(설정 읽기/쓰기)은 in-memory SQLite로 검증하고, 순수 함수(정규화·분류기)는
DB 없이 검증한다. 실제 codex/claude CLI 호출은 하지 않는다(스모크는 별도).
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from services import codex_adapter, llm_engine_service as engine_svc, settings_service


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


# --- ① 엔진 id·priority 정규화(legacy 별칭, 읽기 시에만 매핑) -------------------
def test_normalize_engine_id_maps_legacy_aliases():
    assert engine_svc.normalize_engine_id("cli") == "claude-cli"
    assert engine_svc.normalize_engine_id("api") == "claude-api"
    assert engine_svc.normalize_engine_id("codex-cli") == "codex-cli"
    assert engine_svc.normalize_engine_id(None) is None


def test_normalize_priority_legacy_scalar_cli_is_claude_first():
    assert engine_svc.normalize_priority("cli") == ["claude-cli", "claude-api", "codex-cli"]


def test_normalize_priority_legacy_scalar_api_is_claude_api_first():
    assert engine_svc.normalize_priority("api") == ["claude-api", "claude-cli", "codex-cli"]


def test_normalize_priority_array_maps_aliases_and_dedupes():
    assert engine_svc.normalize_priority(["cli", "claude-cli", "codex-cli"]) == [
        "claude-cli",
        "codex-cli",
        "claude-api",
    ]


def test_normalize_priority_unknown_ids_ignored():
    assert engine_svc.normalize_priority(["not-a-real-engine", "codex-cli"]) == [
        "codex-cli",
        "claude-cli",
        "claude-api",
    ]


def test_normalize_priority_missing_engines_appended_in_registration_order():
    """codex-cli가 나중에 추가돼도 기존 저장값(codex-cli 없는 배열)이 깨지지 않는다."""
    assert engine_svc.normalize_priority(["claude-api"]) == ["claude-api", "claude-cli", "codex-cli"]


def test_normalize_priority_none_falls_back_to_registration_order():
    assert engine_svc.normalize_priority(None) == list(engine_svc.ENGINE_ORDER)


# --- ② resolve_engine — 명시 요청은 그대로, auto는 priority 첫 available -------
def test_resolve_engine_explicit_id_passthrough(db):
    assert engine_svc.resolve_engine(db, "codex-cli") == "codex-cli"


def test_resolve_engine_explicit_legacy_alias_maps(db):
    assert engine_svc.resolve_engine(db, "cli") == "claude-cli"
    assert engine_svc.resolve_engine(db, "api") == "claude-api"


def test_resolve_engine_auto_picks_first_available(db, monkeypatch):
    settings_service.update_settings(db, {"llm.priority": ["codex-cli", "claude-api", "claude-cli"]})
    monkeypatch.setattr(
        engine_svc,
        "is_engine_available",
        lambda eid: eid == "claude-api",  # codex-cli 불가, claude-api만 가능
    )
    assert engine_svc.resolve_engine(db, "auto") == "claude-api"


def test_resolve_engine_auto_none_available_falls_back_to_priority_head(db, monkeypatch):
    settings_service.update_settings(db, {"llm.priority": ["codex-cli", "claude-cli"]})
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: False)
    assert engine_svc.resolve_engine(db, "auto") == "codex-cli"


# --- ③ next_fallback_engine — priority 배열상 다음 위치부터, wraparound 없음 ---
def test_next_fallback_engine_scans_forward_only(db, monkeypatch):
    settings_service.update_settings(db, {"llm.priority": ["claude-cli", "codex-cli", "claude-api"]})
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: eid in ("codex-cli", "claude-api"))
    assert engine_svc.next_fallback_engine(db, "claude-cli") == "codex-cli"


def test_next_fallback_engine_skips_unavailable_candidates(db, monkeypatch):
    settings_service.update_settings(db, {"llm.priority": ["claude-cli", "codex-cli", "claude-api"]})
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: eid == "claude-api")
    assert engine_svc.next_fallback_engine(db, "claude-cli") == "claude-api"


def test_next_fallback_engine_none_when_last_in_priority(db, monkeypatch):
    settings_service.update_settings(db, {"llm.priority": ["claude-cli", "codex-cli", "claude-api"]})
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    assert engine_svc.next_fallback_engine(db, "claude-api") is None  # 배열 끝 — wraparound 없음


def test_next_fallback_engine_no_binary_bias_codex_before_api(db, monkeypatch):
    """이항 가정 해체 확인 — priority가 codex-cli를 claude-api보다 앞에 두면 그 순서를 따른다
    ('나머지 하나'로 자동 귀결되는 이항 로직이면 이 테스트가 실패한다)."""
    settings_service.update_settings(db, {"llm.priority": ["claude-cli", "codex-cli", "claude-api"]})
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    assert engine_svc.next_fallback_engine(db, "claude-cli") == "codex-cli"


# --- ④ build_error_info — fallback_available·fallback_engine ------------------
def test_build_error_info_off_policy_disables_fallback(db, monkeypatch):
    settings_service.update_settings(db, {"llm.fallback": "off", "llm.priority": ["claude-cli", "codex-cli"]})
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: True)
    info = engine_svc.build_error_info(db, "claude-cli", {"kind": "timeout", "message": "m", "action": "a"})
    assert info["fallback_available"] is False
    assert info["fallback_engine"] is None


def test_build_error_info_ask_policy_reports_candidate_without_switching(db, monkeypatch):
    settings_service.update_settings(db, {"llm.fallback": "ask", "llm.priority": ["claude-cli", "codex-cli"]})
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: eid == "codex-cli")
    info = engine_svc.build_error_info(db, "claude-cli", {"kind": "timeout", "message": "m", "action": "a"})
    assert info["fallback_available"] is True
    assert info["fallback_engine"] == "codex-cli"


# --- ⑤ apply_remembered_limit — auto 정책 조용한 전환 / ask·off는 409 -----------
def test_apply_remembered_limit_no_memory_passthrough(db):
    assert engine_svc.apply_remembered_limit(db, "claude-cli") == "claude-cli"


def test_apply_remembered_limit_auto_policy_switches_silently(db, monkeypatch):
    settings_service.update_settings(
        db,
        {
            "llm.fallback": "auto",
            "llm.priority": ["claude-cli", "codex-cli"],
            "llm.last_limit": {
                "engine": "claude-cli",
                "limit_kind": "session",
                "resets_at": "2099-01-01T00:00:00",
            },
        },
    )
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: eid == "codex-cli")
    assert engine_svc.apply_remembered_limit(db, "claude-cli") == "codex-cli"


def test_apply_remembered_limit_ask_policy_raises_conflict_with_candidate(db, monkeypatch):
    from exceptions import ConflictError

    settings_service.update_settings(
        db,
        {
            "llm.fallback": "ask",
            "llm.priority": ["claude-cli", "codex-cli"],
            "llm.last_limit": {
                "engine": "claude-cli",
                "limit_kind": "session",
                "resets_at": "2099-01-01T00:00:00",
            },
        },
    )
    monkeypatch.setattr(engine_svc, "is_engine_available", lambda eid: eid == "codex-cli")
    with pytest.raises(ConflictError) as excinfo:
        engine_svc.apply_remembered_limit(db, "claude-cli")
    assert excinfo.value.detail["fallback_available"] is True
    assert excinfo.value.detail["fallback_engine"] == "codex-cli"


def test_apply_remembered_limit_recognizes_legacy_engine_key(db, monkeypatch):
    """한도 기억이 legacy 'cli' 키로 저장돼 있어도(구버전 데이터) 신 id로 인식한다."""
    settings_service.update_settings(
        db,
        {
            "llm.fallback": "off",
            "llm.last_limit": {"engine": "cli", "limit_kind": "session", "resets_at": "2099-01-01T00:00:00"},
        },
    )
    from exceptions import ConflictError

    with pytest.raises(ConflictError):
        engine_svc.apply_remembered_limit(db, "claude-cli")


# --- ⑥ get_status — 엔진 배열 계약(설계 §4.17 ②), 톱레벨 cli/api 필드 없음 -----
# 이 dev 환경에는 실제 claude CLI가 설치돼 있을 수 있어(Claude Code 자체 실행 환경) diagnose를
# 그대로 두면 get_status가 진짜 CLI를 호출해(사용량 소모·수십 초 지연) 위험하다 — CLI형 진단을
# 통째로 모킹해 순수 배열 조립 로직만 검증한다.
@pytest.fixture()
def no_real_cli_diagnosis(monkeypatch):
    monkeypatch.setattr(engine_svc, "diagnose_engine", lambda eid, force=False: {"installed": False, "logged_in": False})


def test_get_status_returns_engine_array_not_legacy_fields(db, no_real_cli_diagnosis):
    status = engine_svc.get_status(db)
    assert "cli" not in status
    assert "api" not in status
    ids = [e["id"] for e in status["engines"]]
    assert ids == ["claude-cli", "claude-api", "codex-cli"]
    assert status["priority"] == ["claude-cli", "claude-api", "codex-cli"]  # 기본값(legacy 'cli' 정규화)


def test_get_status_engine_fields_null_by_kind(db, no_real_cli_diagnosis):
    status = engine_svc.get_status(db)
    by_id = {e["id"]: e for e in status["engines"]}
    # CLI형은 key_registered/key_suffix가 null
    assert by_id["claude-cli"]["key_registered"] is None
    assert by_id["codex-cli"]["key_registered"] is None
    # API형은 installed/logged_in이 null
    assert by_id["claude-api"]["installed"] is None
    assert by_id["claude-api"]["logged_in"] is None


# --- ⑦ classify_engine_failure — 3종 분류기 단일 진입점 -------------------------
def test_classify_engine_failure_dispatches_by_engine():
    cli_info = engine_svc.classify_engine_failure("claude-cli", Exception("not logged in"))
    assert cli_info["kind"] == "auth"

    codex_info = engine_svc.classify_engine_failure("codex-cli", Exception("codex CLI를 찾을 수 없습니다"))
    assert codex_info["kind"] == "not_installed"

    unknown_info = engine_svc.classify_engine_failure("nope", Exception("x"))
    assert unknown_info["kind"] == "other"


# --- ⑧ codex_adapter — classify_codex_failure (미실측 한도는 보수적 kind='other') --
def test_classify_codex_failure_not_installed():
    info = codex_adapter.classify_codex_failure("codex CLI를 찾을 수 없습니다")
    assert info["kind"] == "not_installed"
    assert info["limit_kind"] is None


def test_classify_codex_failure_auth():
    info = codex_adapter.classify_codex_failure("Error: not logged in. Run `codex login`.")
    assert info["kind"] == "auth"


def test_classify_codex_failure_timeout():
    info = codex_adapter.classify_codex_failure("codex CLI 실행이 600초 내에 끝나지 않았습니다(타임아웃).")
    assert info["kind"] == "timeout"


def test_classify_codex_failure_rate_limit_is_conservative_other():
    """429·한도 메시지 형식은 미실측 — kind는 'rate_limit'이 아니라 보수적 'other'로
    고정하고, 한도 관련 문구('사용량 한도')는 안내에 담는다(설계 §4.17 ④)."""
    info = codex_adapter.classify_codex_failure("Error 429: rate limit exceeded")
    assert info["kind"] == "other"
    assert "한도" in info["message"]
    assert info["limit_kind"] is None
    assert info["resets_at"] is None


def test_classify_codex_failure_generic_other():
    info = codex_adapter.classify_codex_failure("something unexpected happened")
    assert info["kind"] == "other"


def test_classify_codex_failure_never_leaks_raw_in_message():
    info = codex_adapter.classify_codex_failure("SECRET_TOKEN_MARKER not logged in")
    assert "SECRET_TOKEN_MARKER" not in info["message"]
    assert "SECRET_TOKEN_MARKER" not in info["action"]


# --- ⑨ codex_adapter.build_text_for_prompt — 이미지 미지원 명시 --------------
def test_build_text_for_prompt_rejects_images(tmp_path):
    from exceptions import ValidationAppError

    img = tmp_path / "photo.png"
    img.write_bytes(b"\x89PNG\r\n")
    with pytest.raises(ValidationAppError):
        codex_adapter.build_text_for_prompt(img)


def test_build_text_for_prompt_reads_plain_text(tmp_path):
    txt = tmp_path / "note.txt"
    txt.write_text("안녕하세요 원본 텍스트", encoding="utf-8")
    assert codex_adapter.build_text_for_prompt(txt) == "안녕하세요 원본 텍스트"
