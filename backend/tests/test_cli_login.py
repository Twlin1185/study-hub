"""CLI 로그인 엔드포인트 단위 테스트 (stage-42 후속 B6).

실제 `claude`/`codex` 프로세스는 절대 띄우지 않는다 — `subprocess.Popen`을 가짜로
대체한다. `diagnose_engine`·어댑터 `find_executable`도 모킹해 이 머신의 실제 설치
상태에 좌우되지 않게 한다.
"""
from __future__ import annotations

import datetime as dt
import os
import subprocess
import threading
import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, BASE_DIR
from exceptions import UpstreamError, ValidationAppError
from services import claude_cli_adapter, codex_adapter, llm_engine_service as engine_svc


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


class _FakePopen:
    """`Popen(argv, **kwargs).poll()`/`.wait()` 최소 흉내 — 실제 프로세스 없음."""

    def __init__(self, argv, **kwargs) -> None:
        self.argv = list(argv)
        self.kwargs = kwargs
        self._done = threading.Event()

    def poll(self):
        return None if not self._done.is_set() else 0

    def wait(self, timeout=None):
        self._done.wait(timeout)
        return 0

    def finish(self) -> None:
        self._done.set()


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """로그인 상태(모듈 전역 dict)를 테스트 간 격리한다."""
    monkeypatch.setattr(engine_svc, "_LOGIN_PROCS", {})
    with engine_svc._diag_lock:
        engine_svc._diag_cache.clear()
    yield
    with engine_svc._diag_lock:
        engine_svc._diag_cache.clear()


@pytest.fixture()
def fake_popen(monkeypatch):
    created: list[_FakePopen] = []

    def factory(argv, **kwargs):
        proc = _FakePopen(argv, **kwargs)
        created.append(proc)
        return proc

    monkeypatch.setattr(engine_svc.subprocess, "Popen", factory)
    return created


def _wait_until(predicate, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


# --- started: claude ------------------------------------------------------
def test_start_login_claude_spawns_auth_login_with_console_flag(monkeypatch, fake_popen):
    monkeypatch.setattr(claude_cli_adapter, "find_executable", lambda: "C:/tools/claude.exe")
    monkeypatch.setattr(
        engine_svc, "diagnose_engine", lambda eid, force=False: {"installed": True, "logged_in": False}
    )

    result = engine_svc.start_login("claude-cli")

    assert result == {"status": "started"}
    assert len(fake_popen) == 1
    proc = fake_popen[0]
    assert proc.argv == ["C:/tools/claude.exe", "auth", "login"]
    assert proc.kwargs.get("cwd") == str(BASE_DIR)
    if os.name == "nt":
        assert proc.kwargs.get("creationflags") == subprocess.CREATE_NEW_CONSOLE


# --- started: codex ---------------------------------------------------------
def test_start_login_codex_spawns_login_only(monkeypatch, fake_popen):
    monkeypatch.setattr(codex_adapter, "find_executable", lambda: "C:/tools/codex.exe")
    monkeypatch.setattr(
        engine_svc, "diagnose_engine", lambda eid, force=False: {"installed": True, "logged_in": False}
    )

    result = engine_svc.start_login("codex-cli")

    assert result == {"status": "started"}
    assert fake_popen[0].argv == ["C:/tools/codex.exe", "login"]


# --- in_progress on second call --------------------------------------------
def test_start_login_second_call_returns_in_progress_without_spawning_again(monkeypatch, fake_popen):
    monkeypatch.setattr(claude_cli_adapter, "find_executable", lambda: "C:/tools/claude.exe")
    monkeypatch.setattr(
        engine_svc, "diagnose_engine", lambda eid, force=False: {"installed": True, "logged_in": False}
    )

    first = engine_svc.start_login("claude-cli")
    second = engine_svc.start_login("claude-cli")

    assert first == {"status": "started"}
    assert second == {"status": "in_progress"}
    assert len(fake_popen) == 1  # 두 번째 호출은 새 프로세스를 띄우지 않는다


# --- already_logged_in -------------------------------------------------------
def test_start_login_already_logged_in_skips_spawn(monkeypatch, fake_popen):
    monkeypatch.setattr(claude_cli_adapter, "find_executable", lambda: "C:/tools/claude.exe")
    monkeypatch.setattr(
        engine_svc, "diagnose_engine", lambda eid, force=False: {"installed": True, "logged_in": True}
    )

    result = engine_svc.start_login("claude-cli")

    assert result == {"status": "already_logged_in"}
    assert fake_popen == []


# --- 422: claude-api는 로그인 대상이 아니다 ------------------------------------
def test_start_login_claude_api_rejected():
    with pytest.raises(ValidationAppError):
        engine_svc.start_login("claude-api")


# --- 422: 실행 파일 미발견 = 먼저 설치하라는 안내 ------------------------------
def test_start_login_not_installed_rejected(monkeypatch, fake_popen):
    monkeypatch.setattr(claude_cli_adapter, "find_executable", lambda: None)

    with pytest.raises(ValidationAppError) as excinfo:
        engine_svc.start_login("claude-cli")

    assert excinfo.value.detail["reason"] == "not_installed"
    assert fake_popen == []


# --- Popen 자체가 실패하면 UpstreamError(502) ---------------------------------
def test_start_login_popen_oserror_wrapped_as_upstream(monkeypatch):
    monkeypatch.setattr(claude_cli_adapter, "find_executable", lambda: "C:/tools/claude.exe")
    monkeypatch.setattr(
        engine_svc, "diagnose_engine", lambda eid, force=False: {"installed": True, "logged_in": False}
    )

    def boom(argv, **kwargs):
        raise OSError("실행 파일을 찾을 수 없습니다")

    monkeypatch.setattr(engine_svc.subprocess, "Popen", boom)

    with pytest.raises(UpstreamError):
        engine_svc.start_login("claude-cli")


# --- login_pending: true → false 전환 + 진단 캐시 무효화 -----------------------
def test_login_pending_flips_false_and_clears_diag_cache_after_finish(monkeypatch, fake_popen):
    monkeypatch.setattr(claude_cli_adapter, "find_executable", lambda: "C:/tools/claude.exe")
    monkeypatch.setattr(
        engine_svc, "diagnose_engine", lambda eid, force=False: {"installed": True, "logged_in": False}
    )

    result = engine_svc.start_login("claude-cli")
    assert result == {"status": "started"}
    assert engine_svc.login_pending("claude-cli") is True

    # 감시 스레드가 무효화할 진단 캐시가 실제로 있음을 미리 심어 확인한다.
    with engine_svc._diag_lock:
        engine_svc._diag_cache["claude-cli"] = {
            "result": {"installed": True, "logged_in": False},
            "at": dt.datetime.now(),
        }

    fake_popen[0].finish()

    def _cache_cleared() -> bool:
        with engine_svc._diag_lock:
            return "claude-cli" not in engine_svc._diag_cache

    # 진단 캐시 무효화는 감시 스레드 전용 동작이므로 먼저 이걸로 완료를 기다린 뒤
    # (login_pending 자신도 독립적으로 끝난 프로세스를 리핑하므로 순서가 뒤바뀔 수 있다)
    # pending 플래그가 false로 떨어졌는지 확인한다.
    assert _wait_until(_cache_cleared)
    assert engine_svc.login_pending("claude-cli") is False


# --- get_status()에 login_pending 반영 ---------------------------------------
def test_get_status_includes_login_pending_for_cli_engines(db, monkeypatch, fake_popen):
    monkeypatch.setattr(
        engine_svc, "diagnose_engine", lambda eid, force=False: {"installed": True, "logged_in": False}
    )

    status = engine_svc.get_status(db)
    by_id = {e["id"]: e for e in status["engines"]}

    assert by_id["claude-cli"]["login_pending"] is False
    assert by_id["codex-cli"]["login_pending"] is False
    assert by_id["claude-api"]["login_pending"] is None

    monkeypatch.setattr(claude_cli_adapter, "find_executable", lambda: "C:/tools/claude.exe")
    engine_svc.start_login("claude-cli")

    status2 = engine_svc.get_status(db)
    by_id2 = {e["id"]: e for e in status2["engines"]}
    assert by_id2["claude-cli"]["login_pending"] is True
