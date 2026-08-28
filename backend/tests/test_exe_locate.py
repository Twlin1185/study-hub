"""`services/exe_locate.py` 공용 탐색기 단위 테스트 (stage-42 후속 B6).

레지스트리 읽기(`_registry_path_dirs`)는 실제 레지스트리를 건드리지 않고 모킹한다.
`shutil.which`도 모킹해 이 머신의 실제 PATH/설치 상태에 좌우되지 않게 격리한다.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services import claude_cli_adapter, exe_locate


@pytest.fixture(autouse=True)
def _isolate_which(monkeypatch):
    """기본값: PATH에서 아무것도 찾지 못한다(각 테스트가 필요 시 재정의)."""
    monkeypatch.setattr(exe_locate.shutil, "which", lambda name: None)
    monkeypatch.setattr(exe_locate, "_registry_path_dirs", lambda: [])


def test_finds_via_registry_path_when_which_fails(tmp_path, monkeypatch):
    reg_dir = tmp_path / "reg"
    reg_dir.mkdir()
    (reg_dir / "claude.exe").write_bytes(b"")
    monkeypatch.setattr(exe_locate, "_registry_path_dirs", lambda: [reg_dir])

    found = exe_locate.find_executable(("claude", "claude.exe", "claude.cmd"))

    assert found == str(reg_dir / "claude.exe")


def test_finds_via_well_known_dir_when_registry_empty(tmp_path):
    well_known = tmp_path / "local_bin"
    well_known.mkdir()
    (well_known / "claude.exe").write_bytes(b"")

    found = exe_locate.find_executable(
        ("claude", "claude.exe", "claude.cmd"), well_known_dirs=(well_known,)
    )

    assert found == str(well_known / "claude.exe")


def test_returns_none_when_nowhere_found(tmp_path):
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()

    found = exe_locate.find_executable(
        ("claude", "claude.exe", "claude.cmd"), well_known_dirs=(empty_dir,)
    )

    assert found is None


def test_windows_extension_expansion_finds_cmd_variant(tmp_path):
    well_known = tmp_path / "npm"
    well_known.mkdir()
    (well_known / "claude.cmd").write_bytes(b"")

    # names에 확장자 없는 "claude"만 넘겨도 .cmd까지 탐색해야 한다(PATHEXT 축약).
    found = exe_locate.find_executable(("claude",), well_known_dirs=(well_known,))

    assert found == str(well_known / "claude.cmd")


def test_claude_cli_adapter_prefers_isolated_path_over_registry_and_well_known(
    tmp_path, monkeypatch
):
    isolated = tmp_path / "tools" / "claude.exe"
    isolated.parent.mkdir(parents=True, exist_ok=True)
    isolated.write_bytes(b"isolated")
    monkeypatch.setattr(claude_cli_adapter, "CLAUDE_EXE_PATH", isolated)

    # 격리본이 존재하므로 registry/well-known 탐색까지 가면 안 된다(호출되면 실패시켜 확인).
    def boom():
        raise AssertionError("격리본이 있으면 exe_locate.find_executable을 부르면 안 된다")

    monkeypatch.setattr(exe_locate, "find_executable", lambda *a, **k: boom())

    assert claude_cli_adapter.find_executable() == str(isolated)
