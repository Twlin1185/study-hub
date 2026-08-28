"""codex-cli 어댑터 (F41, 설계 §4.17 ④) — 진단·설치·호출·오류 분류.

- 자격증명은 전역 `~/.codex`를 그대로 쓴다(격리 설치본도 재로그인 불필요 — PoC T1 실측).
  `secrets.json`에 codex 항목을 두지 않는다(지시서·설계 §4.17 원칙).
- 실행 파일은 루트 `tools/codex/codex.exe`(격리 설치, PATH 불변)를 우선 찾고, 없으면 PATH의
  `codex`를 채택한다 — 설치 여부와 무관하게 사용자가 이미 codex CLI를 갖고 있으면 재설치하지
  않는다(설계 §4.17 ④ "PATH 등 기존 설치본이 감지되면 다운로드 없이 그것을 채택").
- 호출 규칙(PoC 확정 플래그 + 2026-07-28 통합 스모크 결함 수정 반영, `codex exec --help`
  실측): `codex exec --json --skip-git-repo-check -C <작업디렉터리> -o <최종메시지파일> -`
  — **프롬프트는 위치 인자가 아니라 stdin으로 전달한다**(마지막 `-`가 "stdin에서 읽어라"
  표시). 최종 메시지는 **-o 파일이 1차**, JSONL 이벤트 스캔은 폴백(PoC 검증에서 두 경로
  산출 동일 확인). **stdin 전환 사유(실측)**: PoC/G2는 네이티브 `codex.exe`로만 검증했는데,
  npm으로 설치된 `codex`(PATH의 `.cmd` 배치 셸)에 긴 다줄 프롬프트를 위치 인자로 넘기면
  Windows가 `.cmd`를 `cmd.exe /c`로 경유 실행하면서 인자를 셸 메타문자로 재해석해
  프롬프트가 훼손된다(통합 스모크에서 재현 — 모델이 원본을 못 받은 것처럼 응답). stdin
  경로는 실행 파일 종류와 무관하게 안전하고, Windows 명령줄 길이 상한도 구조적으로
  피한다(`run_exec` 문서화 참조).
- **G2 재실험 실증(2026-07-28, `Desktop\\codex_engine_g2\\results\\G2_report.md`)**: codex의
  직접 PDF 읽기는 샌드박스 제약으로 재현 불안정 — 이 모듈은 원본을 pypdf로 추출한 텍스트를
  프롬프트에 삽입하는 방식을 정본으로 삼는다(`build_text_for_prompt`, convert_service가 호출).
- 오류 원문(stderr·stdout)은 절대 사용자 응답에 노출하지 않는다 — 항상
  `classify_codex_failure`를 거쳐 사람이 읽는 `error_info` 조각으로 변환한다. 원문은 서버
  로그에만 남긴다.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from database import BASE_DIR
from exceptions import UpstreamError, ValidationAppError
from services import exe_locate, net_safety, source_match

logger = logging.getLogger(__name__)

TOOLS_DIR = BASE_DIR / "tools" / "codex"
CODEX_EXE_PATH = TOOLS_DIR / "codex.exe"

GITHUB_RELEASE_API = "https://api.github.com/repos/openai/codex/releases/latest"
USER_AGENT = "study-hub-codex-install/1.0"
INSTALL_MAX_ATTEMPTS = 2
DOWNLOAD_TIMEOUT_SECONDS = 180
VERSION_CHECK_TIMEOUT_SECONDS = 30
LOGIN_CHECK_TIMEOUT_SECONDS = 30

# PDF·이미지 등 텍스트가 아닌 원본 중 codex 경로에서 아직 지원하지 않는 확장자 —
# G2 실증에 따라 pypdf 추출만 정본이므로 이미지는 별도 OCR 없이는 지원하지 않는다.
_UNSUPPORTED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}


class CodexCliError(Exception):
    """codex exec 실행 실패/부재 — classify_codex_failure로 error_info로 변환되기 전까지
    원문을 사용자에게 노출하지 않는다."""


class CodexInstallError(Exception):
    """설치 실패(다운로드·자산 탐색·압축 해제) — 라우터가 502(UpstreamError)로 변환한다."""


# ---------------------------------------------------------------------------
# 실행 파일 탐색 — 격리 설치본(tools/codex/) 우선, 없으면 PATH
# ---------------------------------------------------------------------------
def find_executable() -> Optional[str]:
    """격리본 → 프로세스 PATH → 레지스트리 최신 PATH → npm 전역 bin(`codex.cmd`). 서버 재시작
    없이 방금 설치된 CLI를 인식한다(`exe_locate` — claude_cli_adapter와 같은 순서)."""
    if CODEX_EXE_PATH.exists():
        return str(CODEX_EXE_PATH)
    return exe_locate.find_executable(
        ("codex", "codex.exe", "codex.cmd"), well_known_dirs=(exe_locate.npm_global_bin(),)
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
    return ((proc.stdout or "") + (proc.stderr or "")).strip() or None


# ---------------------------------------------------------------------------
# 진단 — 설치(`--version`) + 로그인(`login status` 텍스트 파싱, --json 없음)
# ---------------------------------------------------------------------------
def diagnose() -> Dict[str, Any]:
    """`{"installed": bool, "logged_in": bool}` — 캐시(TTL)는 llm_engine_service가
    다른 CLI형 엔진과 공통 관례로 관리한다(이 함수 자체는 캐시하지 않음)."""
    exe = find_executable()
    installed = exe is not None
    logged_in = False
    if installed:
        logged_in, _kind = _check_login(exe)  # type: ignore[arg-type]
    return {"installed": installed, "logged_in": logged_in}


def _check_login(exe: str) -> tuple[bool, Optional[str]]:
    """`codex login status` 텍스트 파싱(PoC `check_login_status()` 이식) — `--json` 없음.
    rc==0 && 출력에 "logged in"(대소문자 무관) 포함 → 로그인됨."""
    try:
        proc = subprocess.run(
            [exe, "login", "status"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=LOGIN_CHECK_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.info("codex 로그인 진단 호출 실패: %s", exc)
        return False, "timeout"
    output = ((proc.stdout or "") + (proc.stderr or "")).strip()
    logged_in = proc.returncode == 0 and "logged in" in output.lower()
    return logged_in, (None if logged_in else "auth")


# ---------------------------------------------------------------------------
# 설치 — GitHub 릴리스에서 Windows x64 단일 바이너리 (PoC setup_codex.py 이식)
# ---------------------------------------------------------------------------
def _fetch_latest_release() -> dict:
    req = urllib.request.Request(
        GITHUB_RELEASE_API,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req, timeout=30, context=net_safety.ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _pick_windows_x64_asset(release: dict) -> dict:
    """Windows x64 단일 실행파일 zip 자산 선택 — npm 패키지·심볼·helper 실행파일(sandbox-setup·
    command-runner)·app-server 등은 제외하고 'codex-<target>.exe.zip' 패턴만 남긴다(PoC 실증
    2026-07-27, rust-v0.145.0 태그 — 릴리스마다 이름이 바뀔 수 있어 정확한 파일명이 아니라
    패턴으로 탐색)."""
    assets = release.get("assets", [])
    exclude_markers = (
        "-package-",
        "npm",
        "symbols",
        "app-server",
        "responses-api-proxy",
        "command-runner",
        "sandbox-setup",
        "argument-comment-lint",
        "sigstore",
        "sha256sums",
    )

    def is_candidate(name: str) -> bool:
        lower = name.lower()
        if "x86_64-pc-windows-msvc" not in lower:
            return False
        if not lower.startswith("codex-"):
            return False
        if any(marker in lower for marker in exclude_markers):
            return False
        return lower.endswith(".exe.zip") or lower.endswith(".exe.zst")

    candidates = [a for a in assets if is_candidate(a.get("name", ""))]
    if not candidates:
        names = [a.get("name") for a in assets]
        raise CodexInstallError(f"Windows x64 codex 실행파일 자산을 찾지 못했습니다(자산 목록: {names})")

    # .zip을 .zst보다 우선(표준 zipfile로 해제 가능, 외부 도구 불필요)
    candidates.sort(key=lambda a: (not a["name"].lower().endswith(".exe.zip"), len(a["name"])))
    return candidates[0]


def _download_asset(asset: dict, dest: Path) -> None:
    url = asset["browser_download_url"]
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(
        req, timeout=DOWNLOAD_TIMEOUT_SECONDS, context=net_safety.ssl_context()
    ) as resp, open(dest, "wb") as f:
        shutil.copyfileobj(resp, f)


def _extract_codex_exe(archive_path: Path, dest_exe: Path) -> None:
    if archive_path.suffix.lower() != ".zip":
        raise CodexInstallError(f"미지원 압축 형식입니다: {archive_path.suffix}")
    with zipfile.ZipFile(archive_path) as z:
        main = None
        for info in z.infolist():
            base = Path(info.filename).name.lower()
            if not (base.startswith("codex-") and base.endswith(".exe")):
                continue
            if "sandbox-setup" in base or "command-runner" in base:
                continue
            if main is None or info.file_size > main.file_size:
                main = info
        if main is None:
            raise CodexInstallError(f"압축 안에서 codex 실행 파일을 찾지 못했습니다: {z.namelist()}")
        with z.open(main) as src, open(dest_exe, "wb") as dst:
            shutil.copyfileobj(src, dst)


def install() -> Dict[str, Any]:
    """이미 감지된 실행 파일(격리 설치본 또는 PATH)이 있으면 다운로드 없이 채택한다.
    없으면 GitHub 릴리스에서 Windows x64 단일 바이너리를 내려받아 `tools/codex/`에
    격리 설치한다(PATH 불변). 실패(다운로드·자산 탐색·압축 해제)는 `CodexInstallError` —
    호출부(라우터)가 502로 변환한다. 반환: `{"installed": True, "version": str|None}`."""
    existing = find_executable()
    if existing:
        return {"installed": True, "version": _read_version(existing)}

    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    last_error = ""
    for attempt in range(1, INSTALL_MAX_ATTEMPTS + 1):
        archive_path: Optional[Path] = None
        try:
            release = _fetch_latest_release()
            asset = _pick_windows_x64_asset(release)
            archive_path = TOOLS_DIR / asset["name"]
            _download_asset(asset, archive_path)
            _extract_codex_exe(archive_path, CODEX_EXE_PATH)
            return {"installed": True, "version": _read_version(str(CODEX_EXE_PATH))}
        except CodexInstallError as exc:
            last_error = str(exc)
            logger.warning("codex 설치 시도 %d/%d 실패: %s", attempt, INSTALL_MAX_ATTEMPTS, last_error)
        except Exception as exc:  # noqa: BLE001 - 다운로드·네트워크 오류를 재시도 대상으로 흡수
            last_error = f"{type(exc).__name__}: {exc}"
            logger.warning("codex 설치 시도 %d/%d 실패: %s", attempt, INSTALL_MAX_ATTEMPTS, last_error)
        finally:
            if archive_path is not None and archive_path.exists():
                try:
                    archive_path.unlink()
                except OSError:
                    pass
        if attempt < INSTALL_MAX_ATTEMPTS:
            time.sleep(2)
    raise CodexInstallError(f"Codex CLI 다운로드에 실패했습니다: {last_error}")


def install_or_raise_upstream() -> Dict[str, Any]:
    """라우터 전용 래퍼 — 설치 실패를 설계 §3 규약(§4.17 ④ "다운로드 실패 = 502")대로
    `UpstreamError`(502·code INTERNAL)로 변환한다. 원문 예외는 로그에만 남는다."""
    try:
        return install()
    except CodexInstallError as exc:
        raise UpstreamError(f"Codex CLI 설치에 실패했습니다: {exc}") from exc


# ---------------------------------------------------------------------------
# 원본 → 프롬프트 텍스트 (G2 실증 — pypdf 추출이 정본, 직접 PDF 읽기는 사용하지 않는다)
# ---------------------------------------------------------------------------
def build_text_for_prompt(tmp_path: Path, *, group: Optional[str] = None) -> str:
    """codex 경로 전용 원본 텍스트화. PDF는 pypdf로 추출(레이아웃 붕괴 가능성을 프롬프트에서
    안내), 텍스트 계열(txt/md/html 등)은 원문 그대로 읽는다. 이미지는 아직 지원하지 않는다
    (OCR 없이는 codex가 내용을 판단할 수 없다 — Claude 엔진 사용을 안내).

    `group`은 convert_service 판별 계층(설계 §4.18 ①②③)의 매직 바이트 판정 결과다 —
    지정되면 확장자 재분기 없이 이 값이 pdf/이미지 여부를 가른다(내용 판별이 정본,
    §4.18 ②-3 — S16 검토 적발: 확장자 없는 `%PDF`·PNG가 확장자 재분기로 텍스트 폴백에
    새던 결함의 수정). **미지정(기본값 None)이면 기존처럼 확장자로 판별**한다 — 이 함수를
    판별 정보 없이 직접 호출하는 기존 테스트·경로와의 하위 호환 유지.

    S15: PDF 추출 구현은 `services.source_match.extract_pdf_text` **단일 출처**를 쓴다 —
    프롬프트에 넣는 텍스트와 원문 대조에 쓰는 텍스트가 같아야 판정이 일관된다(중복 구현 금지)."""
    ext = tmp_path.suffix.lower().lstrip(".")
    is_pdf = (group == "pdf") if group is not None else (ext == "pdf")
    is_image = (group == "image") if group is not None else (ext in _UNSUPPORTED_EXTENSIONS)
    if is_pdf:
        text = source_match.extract_pdf_text(tmp_path.read_bytes())
        if text is None:
            raise ValidationAppError(
                "원본 PDF에서 텍스트를 추출하지 못했습니다(암호화·이미지 PDF이거나 서버에 "
                "pypdf·cryptography가 없을 수 있습니다). 다른 엔진을 사용하거나 서버 의존성을 확인하세요."
            )
        return text
    if is_image:
        raise ValidationAppError(
            "Codex 엔진은 이미지 원본을 아직 지원하지 않습니다. Claude CLI/API 엔진을 사용하세요.",
            detail={"extension": ext},
        )
    return tmp_path.read_text(encoding="utf-8", errors="replace")


# ---------------------------------------------------------------------------
# 호출 — codex exec --json --skip-git-repo-check -C <cwd> -o <file> <prompt>
# ---------------------------------------------------------------------------
def _extract_from_jsonl(stdout_text: str) -> str:
    """`-o` 파일이 비어 있을 때만 쓰는 폴백(PoC 검증에서 두 경로 산출 동일 확인).
    실측 스키마: `{"type":"item.completed","item":{"type":"agent_message","text":"..."}}`
    — 여러 번 나오면(멀티턴) 마지막 것을 최종 메시지로 본다."""
    matches: List[str] = []
    for line in stdout_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        item = event.get("item") if isinstance(event, dict) else None
        if isinstance(item, dict) and item.get("type") == "agent_message":
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                matches.append(text)
    return matches[-1] if matches else ""


def run_exec(
    prompt: str,
    *,
    cwd: Path,
    timeout_seconds: int,
    on_activity: Optional[Callable[[], None]] = None,
    model: Optional[str] = None,
    on_process_start: Optional[Callable[[subprocess.Popen], None]] = None,
) -> str:
    """codex exec 실행 — 반환값은 최종 agent 메시지 텍스트. 실패는 `CodexCliError`
    (원문은 로그에만, `classify_codex_failure`를 거쳐야 사용자에게 노출된다).

    **프롬프트는 stdin으로 전달한다(위치 인자 아님)** — 통합 스모크 실측(2026-07-28)으로
    확정: `codex` 실행 파일이 npm 설치본(`.cmd` 배치 셸)일 때, 여러 줄·따옴표·백틱이 섞인
    긴 프롬프트를 CLI 위치 인자로 넘기면 Windows가 `.cmd`를 `cmd.exe /c`로 경유 실행하며
    그 과정에서 인자가 셸 메타문자로 재해석돼 프롬프트가 훼손된다(Node.js `child_process`의
    `.cmd`/`.bat` 인자 주입 취약점(CVE-2024-27980)과 같은 부류의 Windows 고유 함정 — 재현:
    같은 프롬프트를 네이티브 `codex.exe`에 위치 인자로 넘기면 정상 동작, `.cmd` 셸에 위치
    인자로 넘기면 모델이 원본을 못 받은 것처럼 반응). `codex exec --help`가 명시하는
    "PROMPT를 생략하거나 `-`를 주면 stdin에서 읽는다" 경로로 전환하면 `.cmd`/`.exe` 어느
    쪽이든 동일하게 안전하고, **Windows 명령줄 길이 상한(약 32,767자)도 구조적으로
    회피**한다(대형 원본 추출 텍스트가 길어져도 인자 길이 문제가 발생하지 않는다).

    `model`(설계 §4.23 ⓑ) — 지정되면 `-m {model}`을 추가한다. `None`이면 플래그를
    전달하지 않는다(codex-cli 소목록이 비어 있는 한 항상 이 경로 — 현행 동작 불변).

    `on_process_start`(S22 F48 ②) — Popen 생성 직후 그 핸들로 1회 호출된다. 호출부
    (convert_service)가 이 핸들을 잡 레코드에 등록해 취소 엔드포인트가 다른 스레드에서
    프로세스(트리)를 종료할 수 있게 한다. `None`이면 기존 동작 그대로(등록 없음)."""
    exe = find_executable()
    if exe is None:
        raise CodexCliError(
            "codex CLI를 찾을 수 없습니다. 설정에서 [설치]를 실행하거나 PATH를 확인하세요."
        )

    with tempfile.TemporaryDirectory(prefix="codex_out_") as tmp_dir:
        last_msg_path = Path(tmp_dir) / "last_message.txt"
        args = [
            exe,
            "exec",
            "--json",
            "--skip-git-repo-check",
            "-C",
            str(cwd),
            "-o",
            str(last_msg_path),
        ]
        if model:
            args.extend(["-m", model])
        args.append("-")  # stdin에서 프롬프트를 읽으라는 명시 표시(codex exec --help)
        try:
            proc = subprocess.Popen(
                args,
                cwd=str(cwd),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except OSError as exc:
            raise CodexCliError(f"codex CLI 실행 파일을 찾지 못했습니다: {exc}") from exc

        if on_process_start is not None:
            on_process_start(proc)

        stdout_lines: List[str] = []
        stderr_lines: List[str] = []

        def _stdin_writer() -> None:
            try:
                if proc.stdin is not None:
                    proc.stdin.write(prompt)
                    proc.stdin.close()
            except (BrokenPipeError, OSError):
                pass

        def _stdout_reader() -> None:
            if proc.stdout is None:
                return
            for line in proc.stdout:
                stdout_lines.append(line)
                if on_activity:
                    on_activity()

        def _stderr_reader() -> None:
            if proc.stderr is None:
                return
            for line in proc.stderr:
                stderr_lines.append(line)

        # stdin 쓰기·stdout·stderr 읽기를 전부 별도 스레드로 동시에 수행한다 — 큰 프롬프트를
        # 메인 스레드에서 stdin에 다 쓰기 전에 자식이 먼저 stdout을 채워 버리면(우리가 아직
        # 그 stdout을 읽는 스레드를 시작하지 않았다면) 양쪽 파이프가 서로를 기다리는 교착
        # 상태가 된다 — 세 스레드를 함께 돌려 이를 원천 차단한다(claude CLI 스트리밍은 stdin
        # 쓰기를 메인 스레드에서 먼저 끝내는데, 그 프롬프트는 짧은 지시문뿐이라 안전하지만
        # codex는 수만 자짜리 추출 텍스트가 프롬프트에 통째로 들어가므로 이 완화가 필요하다).
        in_thread = threading.Thread(target=_stdin_writer, daemon=True)
        out_thread = threading.Thread(target=_stdout_reader, daemon=True)
        err_thread = threading.Thread(target=_stderr_reader, daemon=True)
        in_thread.start()
        out_thread.start()
        err_thread.start()

        try:
            proc.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            proc.kill()
            proc.wait()
            raise CodexCliError(
                f"codex CLI 실행이 {timeout_seconds}초 내에 끝나지 않았습니다(타임아웃). "
                "원본이 너무 크거나 응답이 지연되고 있을 수 있습니다."
            ) from exc
        in_thread.join(timeout=5)
        out_thread.join(timeout=5)
        err_thread.join(timeout=5)

        stdout_text = "".join(stdout_lines)
        stderr_text = "".join(stderr_lines)

        text_result = ""
        if last_msg_path.exists():
            text_result = last_msg_path.read_text(encoding="utf-8", errors="replace").strip()
        if not text_result:
            text_result = _extract_from_jsonl(stdout_text)

        if not text_result:
            if proc.returncode != 0:
                raise CodexCliError(
                    f"codex 실행 실패(exit={proc.returncode}): {stderr_text.strip()[:4000]}"
                )
            raise CodexCliError("codex 실행 결과에서 최종 메시지를 찾지 못했습니다.")
        return text_result


# ---------------------------------------------------------------------------
# 오류 분류 — classify_codex_failure(설계 §4.17 ④)
# ---------------------------------------------------------------------------
def classify_codex_failure(raw_text: str) -> Dict[str, Any]:
    """codex 실패 원문(stdout/stderr 문자열)을 사람이 읽는 error_info 조각으로 변환.
    반환 dict에는 fallback_available/fallback_engine이 없다 — 호출부(build_error_info)가
    채운다. 원문은 로그에만 남기고 반환값에는 포함하지 않는다.

    **429·한도 메시지 형식은 미실측**(PoC 미조우) — 실측 전에는 보수적으로 kind='other' +
    "Codex 사용량 한도일 수 있습니다" 안내로 고정한다(설계 §4.17 ④)."""
    text = raw_text or ""
    logger.info("codex CLI 오류 원문(로그 전용): %s", text[:4000])
    lower = text.lower()

    if "찾을 수 없습니다" in text or "찾지 못했습니다" in text or "not found" in lower:
        return {
            "kind": "not_installed",
            "limit_kind": None,
            "resets_at": None,
            "message": "Codex CLI가 설치되어 있지 않거나 PATH에서 찾을 수 없습니다.",
            "action": "설정에서 [설치]를 실행하거나 다른 엔진으로 전환하세요.",
        }
    if "타임아웃" in text or "timeout" in lower:
        return {
            "kind": "timeout",
            "limit_kind": None,
            "resets_at": None,
            "message": "Codex CLI 응답이 지연되어 시간 초과되었습니다.",
            "action": "잠시 후 다시 시도하세요.",
        }
    if any(kw in lower for kw in ("not logged in", "login required", "unauthorized", "authentication", "please run")):
        return {
            "kind": "auth",
            "limit_kind": None,
            "resets_at": None,
            "message": "Codex CLI 로그인이 필요합니다.",
            "action": "터미널에서 `codex login`을 실행해 브라우저로 로그인한 뒤 [다시 확인]을 눌러주세요.",
        }
    if any(kw in lower for kw in ("usage limit", "rate limit", "limit reached", "429", "too many requests")):
        # 미실측 — 보수적 안내(설계 §4.17 ④). limit_kind·resets_at은 채우지 않는다(추정 금지).
        return {
            "kind": "other",
            "limit_kind": None,
            "resets_at": None,
            "message": "Codex 사용량 한도일 수 있습니다 — 정확한 리셋 시각은 확인되지 않았습니다.",
            "action": "잠시 후 다시 시도하거나 다른 엔진으로 전환하세요.",
        }
    return {
        "kind": "other",
        "limit_kind": None,
        "resets_at": None,
        "message": "Codex CLI 실행 중 알 수 없는 오류가 발생했습니다.",
        "action": "잠시 후 다시 시도하거나 다른 엔진으로 전환하세요.",
    }
