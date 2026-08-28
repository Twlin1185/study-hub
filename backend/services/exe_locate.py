"""CLI 실행 파일 탐색 공용 부품 — 서버 재시작 없이 "방금 설치된" CLI를 찾는다.

배경(사용자 실사용 2026-08-29): CLI를 설치한 뒤에도 앱이 "미설치"로 남아 서버를 껐다 켜야
했다. 원인 = Windows에서 실행 중인 프로세스의 PATH는 **시작 시점의 값으로 고정**돼, 설치기가
사용자 PATH를 갱신하거나 새 폴더(`%USERPROFILE%\\.local\\bin`)에 넣어도 `shutil.which`가
보지 못한다. 그래서 탐색 순서를 넓힌다:

  1. `shutil.which` (프로세스 PATH — 종전 동작)
  2. 레지스트리의 **현재** 사용자/시스템 PATH(HKCU `Environment`·HKLM `Session Manager\\Environment`)
  3. 호출부가 넘긴 잘 알려진 설치 폴더(예: `~/.local/bin`, npm 전역 bin)

호출부(claude_cli_adapter·codex_adapter)는 격리 설치본(`tools/…`)을 먼저 보고 이 함수를 부른다.
Windows가 아니면 1·3만 수행한다(winreg 부재). 결과는 캐시하지 않는다 — 진단 자체가 60초
TTL 캐시라 비용은 무시할 수준이고, 캐시하면 이 함수의 존재 이유(신선함)가 사라진다.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Iterable, List, Optional

_WINDOWS = os.name == "nt"
# Windows에서 확장자 없는 이름으로 검색할 때 붙여 볼 후보(PATHEXT 축약 — CLI 배포 형태만).
_WIN_EXTS = ("", ".exe", ".cmd", ".bat")


def _registry_path_dirs() -> List[Path]:
    """HKCU·HKLM의 PATH를 지금 읽어 디렉터리 목록으로(환경변수 확장). 실패·비Windows = []."""
    if not _WINDOWS:
        return []
    try:
        import winreg  # noqa: WPS433 - Windows 전용
    except ImportError:  # pragma: no cover
        return []
    values: List[str] = []
    for hive, key in (
        (winreg.HKEY_CURRENT_USER, r"Environment"),
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    ):
        try:
            with winreg.OpenKey(hive, key) as handle:
                raw, _kind = winreg.QueryValueEx(handle, "Path")
        except OSError:
            continue
        if isinstance(raw, str):
            values.append(raw)
    dirs: List[Path] = []
    for raw in values:
        for piece in raw.split(os.pathsep):
            piece = os.path.expandvars(piece.strip().strip('"'))
            if piece:
                dirs.append(Path(piece))
    return dirs


def _candidate_files(directory: Path, names: Iterable[str]) -> Iterable[Path]:
    for name in names:
        if _WINDOWS and not Path(name).suffix:
            for ext in _WIN_EXTS:
                yield directory / f"{name}{ext}"
        else:
            yield directory / name


def find_executable(names: Iterable[str], *, well_known_dirs: Iterable[Path] = ()) -> Optional[str]:
    """`names`(예: ("claude", "claude.exe", "claude.cmd")) 중 첫 실행 파일 경로. 없으면 None."""
    names = tuple(names)
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    seen: set = set()
    for directory in [*_registry_path_dirs(), *well_known_dirs]:
        try:
            key = os.path.normcase(str(directory.resolve()))
        except OSError:
            key = os.path.normcase(str(directory))
        if key in seen:
            continue
        seen.add(key)
        if not directory.is_dir():
            continue
        for candidate in _candidate_files(directory, names):
            if candidate.is_file():
                return str(candidate)
    return None


def user_home() -> Path:
    return Path(os.environ.get("USERPROFILE") or Path.home())


def npm_global_bin() -> Path:
    """npm 전역 설치 bin — Windows `%APPDATA%\\npm`(claude.cmd·codex.cmd가 여기 생긴다)."""
    appdata = os.environ.get("APPDATA")
    return Path(appdata) / "npm" if appdata else user_home() / "AppData" / "Roaming" / "npm"
