"""claude-cli 설치 어댑터 (stage-42 후속 B5) — `services.codex_adapter`의 설치 부분을
claude-cli용으로 이식한 것.

- 실행 파일은 루트 `tools/claude/claude.exe`(격리 설치, PATH 불변)를 우선 찾고, 없으면
  PATH의 `claude`/`claude.exe`/`claude.cmd`를 채택한다 — PATH에 이미 Claude Code CLI가
  있으면 재설치하지 않는다(codex-cli와 동일 관례, 설계 §4.17 ④).
- 호출(실행)부는 이 모듈이 아니라 `services.convert_service`/`services.llm_engine_service`가
  각자 담당한다 — 이 모듈은 **설치 전용**(진단·호출은 다루지 않는다).
- 다운로드 대상은 Anthropic 공식 배포처(`DOWNLOAD_BASE_URL`)의 최신 버전 문자열 →
  매니페스트(JSON, 플랫폼별 체크섬·크기) → 해당 플랫폼 바이너리 순으로 3단계 조회한다.
  체크섬(sha256) 불일치 시 설치하지 않고 실패로 처리한다.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import threading
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

from database import BASE_DIR
from exceptions import UpstreamError
from services import exe_locate, net_safety

logger = logging.getLogger(__name__)

TOOLS_DIR = BASE_DIR / "tools" / "claude"
CLAUDE_EXE_PATH = TOOLS_DIR / "claude.exe"

DOWNLOAD_BASE_URL = "https://downloads.claude.ai/claude-code-releases"
PLATFORM = "win32-x64"
USER_AGENT = "study-hub-claude-install/1.0"
INSTALL_MAX_ATTEMPTS = 2
DOWNLOAD_TIMEOUT_SECONDS = 300

_INSTALL_LOCK = threading.Lock()
VERSION_CHECK_TIMEOUT_SECONDS = 30

_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(-[^\s]+)?$")


class ClaudeInstallError(Exception):
    """설치 실패(다운로드·매니페스트 조회·체크섬 불일치) — 라우터가 502(UpstreamError)로
    변환한다."""


# ---------------------------------------------------------------------------
# 실행 파일 탐색 — 격리 설치본(tools/claude/) 우선, 없으면 PATH
# ---------------------------------------------------------------------------
def find_executable() -> Optional[str]:
    """격리본 → 프로세스 PATH → 레지스트리 최신 PATH → 잘 알려진 설치 폴더(공식 설치기의
    `~/.local/bin`, npm 전역 bin). 서버 재시작 없이 방금 설치된 CLI를 인식한다(`exe_locate`)."""
    if CLAUDE_EXE_PATH.exists():
        return str(CLAUDE_EXE_PATH)
    return exe_locate.find_executable(
        ("claude", "claude.exe", "claude.cmd"),
        well_known_dirs=(exe_locate.user_home() / ".local" / "bin", exe_locate.npm_global_bin()),
    )


def _read_version(exe: str) -> Optional[str]:
    try:
        proc = subprocess.run(
            [exe, "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=VERSION_CHECK_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    output = ((proc.stdout or "") + (proc.stderr or "")).strip()
    if not output:
        return None
    # 실측 출력 예: "2.1.250 (Claude Code)" → 첫 공백 토큰만 버전으로 취급
    return output.split()[0]


# ---------------------------------------------------------------------------
# 설치 — {BASE}/latest → {BASE}/{version}/manifest.json → {BASE}/{version}/{PLATFORM}/claude.exe
# ---------------------------------------------------------------------------
def _fetch_latest_version() -> str:
    req = urllib.request.Request(
        f"{DOWNLOAD_BASE_URL}/latest",
        headers={"User-Agent": USER_AGENT, "Accept": "text/plain"},
    )
    with urllib.request.urlopen(req, timeout=30, context=net_safety.ssl_context()) as resp:
        raw = resp.read().decode("utf-8", errors="replace").strip()
    if not _VERSION_RE.match(raw):
        raise ClaudeInstallError(f"Claude Code 최신 버전 형식을 인식하지 못했습니다: {raw[:200]!r}")
    return raw


def _fetch_manifest(version: str) -> dict:
    req = urllib.request.Request(
        f"{DOWNLOAD_BASE_URL}/{version}/manifest.json",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30, context=net_safety.ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _pick_platform_asset(manifest: dict) -> dict:
    platforms = manifest.get("platforms") if isinstance(manifest, dict) else None
    asset = platforms.get(PLATFORM) if isinstance(platforms, dict) else None
    if not isinstance(asset, dict) or "checksum" not in asset or "size" not in asset:
        raise ClaudeInstallError(f"매니페스트에 {PLATFORM} 플랫폼 정보가 없습니다")
    return asset


def _download_binary(version: str, dest: Path) -> None:
    url = f"{DOWNLOAD_BASE_URL}/{version}/{PLATFORM}/claude.exe"
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream"}
    )
    with urllib.request.urlopen(
        req, timeout=DOWNLOAD_TIMEOUT_SECONDS, context=net_safety.ssl_context()
    ) as resp, open(dest, "wb") as f:
        shutil.copyfileobj(resp, f)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def install() -> Dict[str, Any]:
    """이미 감지된 실행 파일(격리 설치본 또는 PATH)이 있으면 다운로드 없이 채택한다
    (codex-cli와 동일 관례). 없으면 공식 배포처에서 Windows x64 바이너리를 내려받아
    `tools/claude/`에 격리 설치한다(PATH 불변). 체크섬(sha256) 검증 실패·다운로드 실패는
    `ClaudeInstallError` — 호출부(라우터)가 502로 변환한다.
    반환: `{"installed": True, "version": str|None}`."""
    existing = find_executable()
    if existing:
        return {"installed": True, "version": _read_version(existing)}

    # 동시 [설치] 요청(새로고침 후 재클릭 등)이 같은 임시 파일에 겹쳐 쓰지 않도록 직렬화 +
    # 시도마다 유니크한 .part 이름(검토 경미 1). 락을 잡은 뒤 다시 감지 — 앞선 요청이 방금
    # 설치를 끝냈으면 다운로드 없이 채택.
    with _INSTALL_LOCK:
        existing = find_executable()
        if existing:
            return {"installed": True, "version": _read_version(existing)}
        return _install_locked()


def _install_locked() -> Dict[str, Any]:
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    last_error = ""
    for attempt in range(1, INSTALL_MAX_ATTEMPTS + 1):
        fd, tmp_name = tempfile.mkstemp(dir=TOOLS_DIR, prefix="claude-", suffix=".part")
        os.close(fd)
        part_path = Path(tmp_name)
        try:
            version = _fetch_latest_version()
            manifest = _fetch_manifest(version)
            asset = _pick_platform_asset(manifest)
            _download_binary(version, part_path)
            expected_size = asset.get("size")
            if isinstance(expected_size, int) and part_path.stat().st_size != expected_size:
                raise ClaudeInstallError(
                    f"다운로드 크기 불일치({part_path.stat().st_size} != {expected_size})"
                )
            digest = _sha256_file(part_path)
            if digest != str(asset["checksum"]).strip().lower():
                raise ClaudeInstallError("체크섬 불일치")
            os.replace(part_path, CLAUDE_EXE_PATH)
            return {"installed": True, "version": _read_version(str(CLAUDE_EXE_PATH))}
        except ClaudeInstallError as exc:
            last_error = str(exc)
            logger.warning("claude 설치 시도 %d/%d 실패: %s", attempt, INSTALL_MAX_ATTEMPTS, last_error)
        except Exception as exc:  # noqa: BLE001 - 다운로드·네트워크 오류를 재시도 대상으로 흡수
            last_error = f"{type(exc).__name__}: {exc}"
            logger.warning("claude 설치 시도 %d/%d 실패: %s", attempt, INSTALL_MAX_ATTEMPTS, last_error)
        finally:
            if part_path.exists():
                try:
                    part_path.unlink()
                except OSError:
                    pass
        if attempt < INSTALL_MAX_ATTEMPTS:
            time.sleep(2)
    raise ClaudeInstallError(f"Claude Code CLI 다운로드에 실패했습니다: {last_error}")


def install_or_raise_upstream() -> Dict[str, Any]:
    """라우터 전용 래퍼 — 설치 실패를 설계 §3 규약(§4.17 ④ "다운로드 실패 = 502")대로
    `UpstreamError`(502·code INTERNAL)로 변환한다. 원문 예외는 로그에만 남는다."""
    try:
        return install()
    except ClaudeInstallError as exc:
        raise UpstreamError(f"Claude Code CLI 설치에 실패했습니다: {exc}") from exc
