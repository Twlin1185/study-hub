"""claude-cli 설치 어댑터 단위 테스트 (stage-42 후속 B5).

실제 네트워크 다운로드는 하지 않는다 — `urllib.request.urlopen`을 가짜 응답으로 대체한다.
codex_adapter 설치 테스트가 아직 없어(신규 파일 확인) 이 파일이 claude-cli 설치의
첫 회귀 세트다.
"""
from __future__ import annotations

import hashlib
import io
import json

import pytest

from exceptions import UpstreamError, ValidationAppError
from services import claude_cli_adapter, exe_locate, llm_engine_service as engine_svc

BASE = claude_cli_adapter.DOWNLOAD_BASE_URL
PLATFORM = claude_cli_adapter.PLATFORM
FAKE_VERSION = "2.1.250"
FAKE_BINARY = b"fake-claude-exe-binary-content" * 100


class _FakeResponse:
    """`with urlopen(...) as resp:` 및 `shutil.copyfileobj(resp, f)` 양쪽에 필요한
    최소 인터페이스(컨텍스트 매니저 + read())만 흉내 낸다."""

    def __init__(self, data: bytes) -> None:
        self._buf = io.BytesIO(data)

    def read(self, *args, **kwargs) -> bytes:
        return self._buf.read(*args, **kwargs)

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *exc) -> bool:
        return False


def _manifest_bytes(checksum: str, size: int) -> bytes:
    return json.dumps({"platforms": {PLATFORM: {"checksum": checksum, "size": size}}}).encode("utf-8")


def _make_fake_urlopen(*, latest: bytes, manifest: bytes, binary: bytes, calls: list):
    latest_url = f"{BASE}/latest"
    manifest_url = f"{BASE}/{FAKE_VERSION}/manifest.json"
    binary_url = f"{BASE}/{FAKE_VERSION}/{PLATFORM}/claude.exe"

    def fake_urlopen(req, timeout=None, context=None):  # noqa: ANN001 - urllib 시그니처 흉내
        url = req.full_url
        calls.append(url)
        if url == latest_url:
            return _FakeResponse(latest)
        if url == manifest_url:
            return _FakeResponse(manifest)
        if url == binary_url:
            return _FakeResponse(binary)
        raise AssertionError(f"예상치 못한 URL 호출: {url}")

    return fake_urlopen


@pytest.fixture(autouse=True)
def _isolate_install(monkeypatch, tmp_path):
    """모든 테스트 공통: tools 디렉터리를 tmp_path로 격리하고 재시도 sleep을 없앤다.

    `exe_locate`의 레지스트리 PATH·잘 알려진 폴더 탐색도 격리한다 — 이 개발 머신에는
    실제 `claude.exe`가 `~/.local/bin`에 있어(후속 B6 원인 실측), 격리 없이는 아래
    "미설치" 가정 테스트들이 실제로 그 경로를 찾아내 깨진다."""
    monkeypatch.setattr(claude_cli_adapter, "TOOLS_DIR", tmp_path)
    monkeypatch.setattr(claude_cli_adapter, "CLAUDE_EXE_PATH", tmp_path / "claude.exe")
    monkeypatch.setattr(claude_cli_adapter.time, "sleep", lambda *_: None)
    monkeypatch.setattr(exe_locate, "_registry_path_dirs", lambda: [])
    monkeypatch.setattr(exe_locate, "user_home", lambda: tmp_path / "home")
    monkeypatch.setattr(exe_locate, "npm_global_bin", lambda: tmp_path / "npm")


# --- (a) 성공: claude.exe가 정확한 바이트로 생성되고 버전이 반환된다 -----------------
def test_install_success_writes_exe_and_returns_version(monkeypatch):
    checksum = hashlib.sha256(FAKE_BINARY).hexdigest()
    calls: list = []
    fake_urlopen = _make_fake_urlopen(
        latest=f"{FAKE_VERSION}\n".encode("utf-8"),
        manifest=_manifest_bytes(checksum, len(FAKE_BINARY)),
        binary=FAKE_BINARY,
        calls=calls,
    )
    monkeypatch.setattr(claude_cli_adapter.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(claude_cli_adapter, "_read_version", lambda exe: FAKE_VERSION)
    monkeypatch.setattr(claude_cli_adapter.shutil, "which", lambda name: None)

    result = claude_cli_adapter.install()

    assert result == {"installed": True, "version": FAKE_VERSION}
    assert claude_cli_adapter.CLAUDE_EXE_PATH.exists()
    assert claude_cli_adapter.CLAUDE_EXE_PATH.read_bytes() == FAKE_BINARY
    assert list(claude_cli_adapter.TOOLS_DIR.glob("*.part")) == []


# --- (b) 체크섬 불일치 → ClaudeInstallError, claude.exe·.part 잔존 없음 ---------------
def test_install_checksum_mismatch_raises_and_leaves_no_files(monkeypatch):
    calls: list = []
    fake_urlopen = _make_fake_urlopen(
        latest=f"{FAKE_VERSION}\n".encode("utf-8"),
        manifest=_manifest_bytes("0" * 64, len(FAKE_BINARY)),  # 고의로 틀린 체크섬
        binary=FAKE_BINARY,
        calls=calls,
    )
    monkeypatch.setattr(claude_cli_adapter.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(claude_cli_adapter.shutil, "which", lambda name: None)

    with pytest.raises(claude_cli_adapter.ClaudeInstallError):
        claude_cli_adapter.install()

    assert not claude_cli_adapter.CLAUDE_EXE_PATH.exists()
    assert list(claude_cli_adapter.TOOLS_DIR.glob("*.part")) == []


# --- (c) latest 응답이 버전 형식이 아니면(HTML 등) manifest를 조회하지 않는다 -----------
def test_install_invalid_latest_content_skips_manifest_fetch(monkeypatch):
    calls: list = []
    fake_urlopen = _make_fake_urlopen(
        latest=b"<html>not a version</html>",
        manifest=b"{}",
        binary=b"",
        calls=calls,
    )
    monkeypatch.setattr(claude_cli_adapter.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(claude_cli_adapter.shutil, "which", lambda name: None)

    with pytest.raises(claude_cli_adapter.ClaudeInstallError):
        claude_cli_adapter.install()

    manifest_url = f"{BASE}/{FAKE_VERSION}/manifest.json"
    assert manifest_url not in calls
    binary_url = f"{BASE}/{FAKE_VERSION}/{PLATFORM}/claude.exe"
    assert binary_url not in calls


# --- (d) find_executable은 격리 설치본(claude.exe)을 PATH보다 우선한다 -----------------
def test_find_executable_prefers_isolated_over_path(monkeypatch, tmp_path):
    claude_cli_adapter.CLAUDE_EXE_PATH.parent.mkdir(parents=True, exist_ok=True)
    claude_cli_adapter.CLAUDE_EXE_PATH.write_bytes(b"isolated-exe")
    monkeypatch.setattr(claude_cli_adapter.shutil, "which", lambda name: "C:/somewhere/claude.exe")

    assert claude_cli_adapter.find_executable() == str(claude_cli_adapter.CLAUDE_EXE_PATH)


# --- (e) PATH에 이미 claude가 있으면 install()은 urlopen을 전혀 호출하지 않는다 ----------
def test_install_returns_existing_without_network_when_on_path(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("urlopen이 호출되면 안 된다(이미 설치본이 있음)")

    monkeypatch.setattr(claude_cli_adapter.urllib.request, "urlopen", boom)
    monkeypatch.setattr(claude_cli_adapter.shutil, "which", lambda name: "C:/somewhere/claude.exe")
    monkeypatch.setattr(claude_cli_adapter, "_read_version", lambda exe: FAKE_VERSION)

    result = claude_cli_adapter.install()

    assert result == {"installed": True, "version": FAKE_VERSION}


# --- (f) llm_engine_service.install_engine("claude-cli")가 어댑터로 위임 + 캐시 무효화 --
def test_install_engine_claude_cli_routes_to_adapter_and_invalidates_cache(monkeypatch):
    import datetime as dt

    monkeypatch.setattr(
        claude_cli_adapter,
        "install_or_raise_upstream",
        lambda: {"installed": True, "version": "9.9.9"},
    )
    with engine_svc._diag_lock:
        engine_svc._diag_cache["claude-cli"] = {
            "result": {"installed": True, "logged_in": True},
            "at": dt.datetime.now(),
        }

    result = engine_svc.install_engine("claude-cli")

    assert result == {"installed": True, "version": "9.9.9"}
    with engine_svc._diag_lock:
        assert "claude-cli" not in engine_svc._diag_cache


# --- (g) claude-api는 여전히 설치 불가(422 상당의 ValidationAppError) -------------------
def test_install_engine_claude_api_still_rejected():
    with pytest.raises(ValidationAppError):
        engine_svc.install_engine("claude-api")


# --- install_or_raise_upstream이 ClaudeInstallError를 UpstreamError(502)로 감싼다 -------
def test_install_or_raise_upstream_wraps_install_error(monkeypatch):
    def boom():
        raise claude_cli_adapter.ClaudeInstallError("네트워크 실패")

    monkeypatch.setattr(claude_cli_adapter, "install", boom)

    with pytest.raises(UpstreamError):
        claude_cli_adapter.install_or_raise_upstream()


# --- 검토 경미 5 보강: 재시도·크기 검증·체크섬 표기·installable 잠금 ---------------------
def _std_setup(monkeypatch, fake_urlopen):
    monkeypatch.setattr(claude_cli_adapter.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(claude_cli_adapter, "_read_version", lambda exe: FAKE_VERSION)
    monkeypatch.setattr(claude_cli_adapter.shutil, "which", lambda name: None)


def test_install_retries_after_transient_network_error(monkeypatch):
    import urllib.error

    checksum = hashlib.sha256(FAKE_BINARY).hexdigest()
    calls: list = []
    inner = _make_fake_urlopen(
        latest=f"{FAKE_VERSION}\n".encode("utf-8"),
        manifest=_manifest_bytes(checksum, len(FAKE_BINARY)),
        binary=FAKE_BINARY,
        calls=calls,
    )
    state = {"failed_once": False}

    def flaky(req, timeout=None, context=None):  # noqa: ANN001
        if req.full_url.endswith("/claude.exe") and not state["failed_once"]:
            state["failed_once"] = True
            calls.append(req.full_url)  # inner가 기록하기 전에 실패하므로 직접 기록
            raise urllib.error.URLError("connection reset")
        return inner(req, timeout=timeout, context=context)

    _std_setup(monkeypatch, flaky)
    result = claude_cli_adapter.install()
    assert result == {"installed": True, "version": FAKE_VERSION}
    assert claude_cli_adapter.CLAUDE_EXE_PATH.read_bytes() == FAKE_BINARY
    assert list(claude_cli_adapter.TOOLS_DIR.glob("*.part")) == []
    assert sum(1 for u in calls if u.endswith("/claude.exe")) == 2


def test_install_size_mismatch_fails_before_checksum(monkeypatch):
    checksum = hashlib.sha256(FAKE_BINARY).hexdigest()
    fake = _make_fake_urlopen(
        latest=f"{FAKE_VERSION}\n".encode("utf-8"),
        manifest=_manifest_bytes(checksum, len(FAKE_BINARY) + 1),
        binary=FAKE_BINARY,
        calls=[],
    )
    _std_setup(monkeypatch, fake)
    monkeypatch.setattr(claude_cli_adapter, "_sha256_file", lambda p: (_ for _ in ()).throw(AssertionError("해싱 전에 실패해야 함")))
    with pytest.raises(claude_cli_adapter.ClaudeInstallError) as excinfo:
        claude_cli_adapter.install()
    assert "크기 불일치" in str(excinfo.value)
    assert not claude_cli_adapter.CLAUDE_EXE_PATH.exists()
    assert list(claude_cli_adapter.TOOLS_DIR.glob("*.part")) == []


def test_install_accepts_uppercase_checksum_with_whitespace(monkeypatch):
    checksum = "  " + hashlib.sha256(FAKE_BINARY).hexdigest().upper() + "\n"
    fake = _make_fake_urlopen(
        latest=f"{FAKE_VERSION}\n".encode("utf-8"),
        manifest=_manifest_bytes(checksum, len(FAKE_BINARY)),
        binary=FAKE_BINARY,
        calls=[],
    )
    _std_setup(monkeypatch, fake)
    assert claude_cli_adapter.install()["installed"] is True


def test_claude_cli_registry_is_installable():
    assert engine_svc.ENGINE_REGISTRY["claude-cli"]["installable"] is True
    assert engine_svc.ENGINE_REGISTRY["codex-cli"]["installable"] is True
    assert engine_svc.ENGINE_REGISTRY["claude-api"]["installable"] is False
