"""LLM 엔진 진단 · API 키 관리 · 오류 구조화 공통 로직 (F34, 설계 §4.11).

- 키 저장은 루트 `secrets.json` 전용 — **DB/settings 금지**(백업(F27) zip·git 추적 대상 아님).
  키 해석 순서: secrets.json → 환경변수(`ANTHROPIC_API_KEY`) → `ant` 프로필
  (`~/.anthropic/config.json`이 있으면 읽고, 없으면 조용히 건너뜀 — 없어도 오류 아님).
- CLI/API 오류 원문(JSON·스택트레이스)은 절대 사용자 응답에 노출하지 않는다 — 항상
  `classify_cli_failure`/`classify_api_exception`을 거쳐 사람이 읽는 `error_info`로 변환한다.
  원문은 서버 로그(`logging`)에만 남긴다.
- 진단(`diagnose_cli`)은 실제 CLI를 초경량 호출로 두드리므로 TTL(60초) 캐시로 연속 호출을 막는다.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from database import BASE_DIR
from exceptions import ConflictError, ValidationAppError
from services import settings_service

logger = logging.getLogger(__name__)

SECRETS_PATH = BASE_DIR / "secrets.json"
ANT_PROFILE_PATH = Path.home() / ".anthropic" / "config.json"

DEFAULT_API_MODEL = "claude-sonnet-5"

_DIAG_CACHE_TTL = dt.timedelta(seconds=60)
_diag_lock = threading.Lock()
_diag_cache: Dict[str, Any] = {"cli": None, "cli_at": None}

_HEALTH_LOCK = threading.Lock()
_ENGINE_HEALTH: Dict[str, Dict[str, Any]] = {
    "cli": {"last_success_at": None, "last_error_kind": None},
    "api": {"last_success_at": None, "last_error_kind": None},
}


class ApiEngineError(Exception):
    """API 엔진(anthropic SDK) 호출 실패 — 사용자에게는 항상 classify_api_exception을 거쳐
    노출한다. kind가 이미 확정된 경우(SDK 미설치·키 없음) 미리 채워 둘 수 있다.

    `original`: anthropic SDK가 던진 원본 예외(있으면) — classify_api_exception이 여기서
    RateLimitError/AuthenticationError 등 정확한 타입을 판별한다(kind가 비어 있을 때만)."""

    def __init__(
        self,
        message: str,
        *,
        kind: Optional[str] = None,
        action: Optional[str] = None,
        original: Optional[Exception] = None,
    ) -> None:
        self.message = message
        self.kind = kind
        self.action = action
        self.original = original
        super().__init__(message)


# ---------------------------------------------------------------------------
# secrets.json — API 키 저장소 (루트, DB/settings 아님)
# ---------------------------------------------------------------------------
def _load_secrets() -> Dict[str, Any]:
    if not SECRETS_PATH.exists():
        return {}
    try:
        data = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_secrets(data: Dict[str, Any]) -> None:
    SECRETS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _ant_profile_key() -> Optional[str]:
    """`ant` 프로필 — `~/.anthropic/config.json`이 있으면 읽는다(3순위, 없어도 오류 아님).

    가정: Study Hub 자체 규약이 아니라 사용자 환경의 anthropic 설정 파일을 재사용하는
    선택적 3순위이므로, 파일이 없거나 파싱 실패해도 조용히 None을 반환한다."""
    if not ANT_PROFILE_PATH.exists():
        return None
    try:
        data = json.loads(ANT_PROFILE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    key = data.get("api_key") or data.get("ANTHROPIC_API_KEY")
    return key if isinstance(key, str) and key.strip() else None


def get_api_key() -> Optional[str]:
    """키 해석 순서: secrets.json → 환경변수 → `ant` 프로필."""
    secrets = _load_secrets()
    key = secrets.get("anthropic_api_key")
    if isinstance(key, str) and key.strip():
        return key.strip()
    env_key = os.environ.get("ANTHROPIC_API_KEY")
    if env_key and env_key.strip():
        return env_key.strip()
    return _ant_profile_key()


def api_key_status() -> Dict[str, Any]:
    """status 응답용 — 어느 경로로든(secrets.json/환경변수/ant 프로필) 키를 쓸 수 있으면
    registered=True. 원문 키는 절대 반환하지 않는다(마지막 4자리만)."""
    key = get_api_key()
    if not key:
        return {"key_registered": False, "key_suffix": None}
    return {"key_registered": True, "key_suffix": key[-4:]}


def validate_api_key(key: str, *, model: str) -> None:
    """즉석 연결 테스트 — 초경량 SDK 호출(max_tokens=1). 실패 시 ValidationAppError."""
    key = (key or "").strip()
    if not key:
        raise ValidationAppError("API 키를 입력하세요")
    try:
        import anthropic
    except ImportError as exc:
        raise ValidationAppError(
            "서버에 anthropic SDK가 설치되어 있지 않습니다. `pip install anthropic`을 실행하세요."
        ) from exc

    client = anthropic.Anthropic(api_key=key)
    try:
        client.messages.create(
            model=model,
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
    except anthropic.AuthenticationError as exc:
        logger.info("API 키 검증 실패(인증): %s", exc)
        raise ValidationAppError("API 키가 올바르지 않습니다", detail={"reason": "authentication_failed"}) from exc
    except anthropic.RateLimitError as exc:
        logger.info("API 키 검증 중 사용량 한도: %s", exc)
        raise ValidationAppError(
            "API 키 형식은 확인되지만 지금 사용량 한도에 걸려 연결 테스트를 완료하지 못했습니다. "
            "잠시 후 다시 시도하세요",
            detail={"reason": "rate_limited"},
        ) from exc
    except anthropic.APIError as exc:
        logger.info("API 키 검증 중 오류: %s", exc)
        raise ValidationAppError(f"API 키 검증 중 오류가 발생했습니다: {exc}") from exc


def save_api_key(key: str, *, model: str) -> str:
    """즉석 연결 테스트 성공 시에만 secrets.json에 저장. 반환값은 key_suffix(마지막 4자리)뿐."""
    key = (key or "").strip()
    validate_api_key(key, model=model)
    secrets = _load_secrets()
    secrets["anthropic_api_key"] = key
    _save_secrets(secrets)
    record_engine_result("api", success=True)
    return key[-4:]


def delete_api_key() -> None:
    secrets = _load_secrets()
    if "anthropic_api_key" in secrets:
        del secrets["anthropic_api_key"]
        _save_secrets(secrets)


# ---------------------------------------------------------------------------
# CLI 진단 — 설치(`claude --version`) + 로그인/호출 가능(초경량 호출)
# ---------------------------------------------------------------------------
def _find_claude_executable() -> Optional[str]:
    for name in ("claude", "claude.exe", "claude.cmd"):
        path = shutil.which(name)
        if path:
            return path
    return None


def _check_cli_login() -> tuple[bool, Optional[str]]:
    """초경량 CLI 호출(`ping`, max-turns 1)로 로그인·호출 가능 여부 확인.
    반환: (logged_in, error_kind or None)."""
    exe = _find_claude_executable()
    if exe is None:
        return False, "not_installed"
    try:
        proc = subprocess.run(
            [exe, "-p", "ping", "--output-format", "json", "--max-turns", "1"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            cwd=str(BASE_DIR),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.info("claude CLI 진단 호출 실패: %s", exc)
        return False, "timeout"

    combined = f"{proc.stdout}\n{proc.stderr}"
    if proc.returncode != 0:
        info = classify_cli_failure(combined)
        return (info["kind"] != "auth" and info["kind"] != "not_installed"), info["kind"]

    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return True, None
    if isinstance(envelope, dict) and envelope.get("is_error"):
        info = classify_cli_failure(str(envelope.get("result", "")))
        if info["kind"] == "auth":
            return False, "auth"
        # rate_limit 등은 "로그인은 됐지만 지금 호출은 실패"로 취급
        return True, info["kind"]
    return True, None


def diagnose_cli(*, force: bool = False) -> Dict[str, Any]:
    with _diag_lock:
        cached = _diag_cache.get("cli")
        cached_at = _diag_cache.get("cli_at")
        if not force and cached is not None and cached_at is not None:
            if dt.datetime.now() - cached_at < _DIAG_CACHE_TTL:
                return cached

    exe = _find_claude_executable()
    installed = exe is not None
    logged_in = False
    error_kind: Optional[str] = None
    if installed:
        logged_in, error_kind = _check_cli_login()

    result = {"installed": installed, "logged_in": logged_in}
    with _diag_lock:
        _diag_cache["cli"] = result
        _diag_cache["cli_at"] = dt.datetime.now()

    if error_kind and error_kind not in ("rate_limit",):
        record_engine_result("cli", success=False, error_kind=error_kind)
    elif logged_in:
        record_engine_result("cli", success=True)
    return result


# ---------------------------------------------------------------------------
# 엔진 헬스(최근 성공/실패) — 인메모리(잡 큐와 동일 원칙, 서버 재시작 시 소실 허용)
# ---------------------------------------------------------------------------
def record_engine_result(engine: str, *, success: bool, error_kind: Optional[str] = None) -> None:
    with _HEALTH_LOCK:
        state = _ENGINE_HEALTH.setdefault(engine, {"last_success_at": None, "last_error_kind": None})
        if success:
            state["last_success_at"] = dt.datetime.now()
            state["last_error_kind"] = None
        else:
            state["last_error_kind"] = error_kind


def engine_health(engine: str) -> Dict[str, Any]:
    with _HEALTH_LOCK:
        state = _ENGINE_HEALTH.get(engine, {"last_success_at": None, "last_error_kind": None})
        return dict(state)


def is_engine_available(engine: str) -> bool:
    if engine == "cli":
        return diagnose_cli().get("installed", False)
    if engine == "api":
        return get_api_key() is not None
    return False


# ---------------------------------------------------------------------------
# 엔진 선택 (auto|cli|api)
# ---------------------------------------------------------------------------
def resolve_engine(db: Session, requested: str) -> str:
    if requested in ("cli", "api"):
        return requested
    priority = settings_service.get_setting(db, "llm.priority", "cli")
    return priority if priority in ("cli", "api") else "cli"


# ---------------------------------------------------------------------------
# 오류 구조화 — CLI 429/오류 문자열 파싱
# ---------------------------------------------------------------------------
_LIMIT_KIND_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"5[\s-]*hour", re.I), "session"),
    (re.compile(r"\bsession\b", re.I), "session"),
    (re.compile(r"\bweek(ly)?\b", re.I), "weekly"),
    (re.compile(r"\bdaily\b|\bday\b", re.I), "daily"),
    (re.compile(r"\bmodel\b", re.I), "model"),
]

_LIMIT_KIND_LABELS = {
    "session": "세션(5시간)",
    "daily": "일일",
    "weekly": "주간",
    "model": "모델별",
    "overall": "전체",
}

_RESET_TIME_RE = re.compile(
    r"resets?\s*(?:at)?\s*[:\-]?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", re.I
)


def _detect_limit_kind(text: str) -> Optional[str]:
    for pattern, kind in _LIMIT_KIND_RULES:
        if pattern.search(text):
            return kind
    return None


def _parse_resets_at(text: str, *, now: Optional[dt.datetime] = None) -> Optional[dt.datetime]:
    now = now or dt.datetime.now()
    match = _RESET_TIME_RE.search(text)
    if not match:
        return None
    try:
        hour = int(match.group(1))
        minute = int(match.group(2) or 0)
    except ValueError:
        return None
    if not (0 <= hour <= 23) or not (0 <= minute <= 59):
        return None
    ampm = (match.group(3) or "").lower()
    if ampm == "pm" and hour != 12:
        hour += 12
    elif ampm == "am" and hour == 12:
        hour = 0
    candidate = now.replace(hour=hour % 24, minute=minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += dt.timedelta(days=1)
    return candidate


def _humanize_limit_message(limit_kind: Optional[str], resets_at: Optional[dt.datetime]) -> str:
    label = _LIMIT_KIND_LABELS.get(limit_kind or "", "사용")
    base = f"Claude 구독 {label} 한도를 초과했습니다"
    if resets_at is None:
        return base + "."
    today = dt.datetime.now().date()
    when = "오늘" if resets_at.date() == today else "내일"
    return f"{base} — {when} {resets_at.strftime('%H:%M')} 리셋"


def classify_cli_failure(raw_text: str) -> Dict[str, Any]:
    """CLI 실패 원문(stdout/stderr/result 문자열)을 사람이 읽는 error_info 조각으로 변환.
    반환 dict에는 fallback_available이 없다 — 호출부(build_error_info)가 채운다.
    원문은 로그에만 남기고 반환값에는 포함하지 않는다."""
    text = raw_text or ""
    logger.info("claude CLI 오류 원문(로그 전용): %s", text[:4000])
    lower = text.lower()

    if any(kw in lower for kw in ("usage limit", "rate limit", "limit reached", "429", "too many requests")):
        # 종류를 특정하지 못해도 kind='rate_limit'인 이상 limit_kind는 항상 채운다
        # ('overall'로 대체) — 프론트 계약(LlmLimitInfo.kind: string, not-null)과 일치.
        limit_kind = _detect_limit_kind(text) or "overall"
        resets_at = _parse_resets_at(text)
        return {
            "kind": "rate_limit",
            "limit_kind": limit_kind,
            "resets_at": resets_at.isoformat() if resets_at else None,
            "message": _humanize_limit_message(limit_kind, resets_at),
            "action": "잠시 후 다시 시도하거나 API 엔진으로 전환해 계속하세요.",
        }
    if any(kw in lower for kw in ("not logged in", "please run", "authentication", "unauthorized", "invalid api key", "login")):
        return {
            "kind": "auth",
            "limit_kind": None,
            "resets_at": None,
            "message": "Claude CLI 로그인이 필요합니다.",
            "action": "터미널에서 `claude`를 실행해 로그인한 뒤 [다시 확인]을 눌러주세요.",
        }
    if "찾을 수 없습니다" in text or "찾지 못했습니다" in text or "not found" in lower:
        return {
            "kind": "not_installed",
            "limit_kind": None,
            "resets_at": None,
            "message": "Claude CLI가 설치되어 있지 않거나 PATH에서 찾을 수 없습니다.",
            "action": "Claude Code를 설치하거나 API 엔진으로 전환하세요.",
        }
    if "타임아웃" in text or "timeout" in lower:
        return {
            "kind": "timeout",
            "limit_kind": None,
            "resets_at": None,
            "message": "Claude CLI 응답이 지연되어 시간 초과되었습니다.",
            "action": "잠시 후 다시 시도하세요.",
        }
    return {
        "kind": "other",
        "limit_kind": None,
        "resets_at": None,
        "message": "Claude CLI 실행 중 알 수 없는 오류가 발생했습니다.",
        "action": "잠시 후 다시 시도하거나 API 엔진으로 전환하세요.",
    }


def _extract_retry_after(exc: Exception) -> Optional[dt.datetime]:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) if response is not None else None
    if not headers:
        return None
    retry_after = headers.get("retry-after")
    if not retry_after:
        return None
    try:
        seconds = int(float(retry_after))
    except (TypeError, ValueError):
        return None
    return dt.datetime.now() + dt.timedelta(seconds=max(seconds, 0))


def classify_api_exception(exc: Exception) -> Dict[str, Any]:
    """anthropic SDK 예외(또는 ApiEngineError)를 사람이 읽는 error_info 조각으로 변환.
    원문은 로그에만 남긴다."""
    logger.info("API 엔진 오류 원문(로그 전용): %s", repr(exc)[:4000])

    if isinstance(exc, ApiEngineError) and exc.kind:
        return {
            "kind": exc.kind,
            "limit_kind": None,
            "resets_at": None,
            "message": exc.message,
            "action": exc.action or "API 키를 확인하거나 CLI 엔진으로 전환하세요.",
        }

    # kind가 아직 없으면 원본 SDK 예외(있으면 그쪽)를 기준으로 타입 판별한다.
    target: Exception = exc
    if isinstance(exc, ApiEngineError) and exc.original is not None:
        target = exc.original

    try:
        import anthropic
    except ImportError:
        anthropic = None  # type: ignore[assignment]

    status_code = getattr(target, "status_code", None)

    if (anthropic is not None and isinstance(target, anthropic.RateLimitError)) or status_code == 429:
        resets_at = _extract_retry_after(target)
        return {
            "kind": "rate_limit",
            "limit_kind": "overall",
            "resets_at": resets_at.isoformat() if resets_at else None,
            "message": _humanize_limit_message("overall", resets_at),
            "action": "잠시 후 다시 시도하거나 CLI 엔진으로 전환하세요.",
        }
    if (anthropic is not None and isinstance(target, anthropic.AuthenticationError)) or status_code == 401:
        return {
            "kind": "auth",
            "limit_kind": None,
            "resets_at": None,
            "message": "API 키가 유효하지 않습니다.",
            "action": "설정에서 API 키를 다시 등록하세요.",
        }
    if anthropic is not None and isinstance(target, anthropic.APITimeoutError):
        return {
            "kind": "timeout",
            "limit_kind": None,
            "resets_at": None,
            "message": "API 응답이 지연되어 시간 초과되었습니다.",
            "action": "잠시 후 다시 시도하세요.",
        }
    return {
        "kind": "other",
        "limit_kind": None,
        "resets_at": None,
        "message": "API 엔진 호출 중 오류가 발생했습니다.",
        "action": "잠시 후 다시 시도하거나 CLI 엔진으로 전환하세요.",
    }


def build_error_info(db: Session, engine: str, base: Dict[str, Any]) -> Dict[str, Any]:
    """base(kind/limit_kind/resets_at/message/action)에 fallback_available을 채워 반환.
    fallback_available = 다른 엔진이 실제로 쓸 수 있고, 폴백 정책이 'off'가 아닐 때."""
    other = "api" if engine == "cli" else "cli"
    fallback_policy = settings_service.get_setting(db, "llm.fallback", "ask")
    available = is_engine_available(other) and fallback_policy != "off"
    return {**base, "fallback_available": available}


# ---------------------------------------------------------------------------
# 한도 기억 (settings: llm.last_limit)
# ---------------------------------------------------------------------------
def remember_limit(db: Session, engine: str, error_info: Dict[str, Any]) -> None:
    """리셋 시각을 모르면 "리셋 전 재시도 차단" 판단 자체가 불가능하므로 기억하지 않는다
    (프론트 계약 `LlmLimitInfo{kind,resets_at}`도 둘 다 non-null을 기대한다).
    해당 잡의 `error_info`에는 여전히 메시지가 실리므로 사용자에게는 그대로 노출된다."""
    if error_info.get("kind") != "rate_limit" or not error_info.get("resets_at"):
        return
    settings_service.update_settings(
        db,
        {
            "llm.last_limit": {
                "engine": engine,
                "limit_kind": error_info.get("limit_kind") or "overall",
                "resets_at": error_info.get("resets_at"),
            }
        },
    )


def _get_remembered_limit_raw(db: Session) -> Optional[Dict[str, Any]]:
    raw = settings_service.get_setting(db, "llm.last_limit", None)
    if not raw or not isinstance(raw, dict):
        return None
    resets_at_str = raw.get("resets_at")
    if resets_at_str:
        try:
            resets_at = dt.datetime.fromisoformat(resets_at_str)
        except ValueError:
            resets_at = None
        if resets_at is not None and resets_at <= dt.datetime.now():
            # 리셋 시각 경과 — 자동 무효화
            settings_service.update_settings(db, {"llm.last_limit": None})
            return None
    return raw


def get_remembered_limit(db: Session) -> Optional[Dict[str, Any]]:
    """`GET /api/llm/status`의 `limit` 필드용 — {kind, resets_at}만 노출."""
    raw = _get_remembered_limit_raw(db)
    if raw is None:
        return None
    return {"kind": raw.get("limit_kind"), "resets_at": raw.get("resets_at")}


def check_remembered_limit_or_raise(db: Session, engine: str) -> None:
    """리셋 전 같은 엔진으로 재시도하면 잡을 만들기 전에 즉시 경고 응답(409)으로 막는다."""
    raw = _get_remembered_limit_raw(db)
    if raw is None or raw.get("engine") != engine:
        return
    resets_at_str = raw.get("resets_at")
    resets_at = None
    if resets_at_str:
        try:
            resets_at = dt.datetime.fromisoformat(resets_at_str)
        except ValueError:
            resets_at = None
    message = _humanize_limit_message(raw.get("limit_kind"), resets_at)
    other = "api" if engine == "cli" else "cli"
    fallback_policy = settings_service.get_setting(db, "llm.fallback", "ask")
    raise ConflictError(
        message,
        detail={
            "kind": "rate_limit",
            "limit_kind": raw.get("limit_kind"),
            "resets_at": resets_at_str,
            "message": message,
            "action": "잠시 후 다시 시도하거나 다른 엔진으로 전환하세요.",
            "fallback_available": is_engine_available(other) and fallback_policy != "off",
        },
    )


# ---------------------------------------------------------------------------
# 종합 진단 응답
# ---------------------------------------------------------------------------
def get_status(db: Session) -> Dict[str, Any]:
    cli_diag = diagnose_cli()
    cli_health = engine_health("cli")
    api_info = api_key_status()
    api_health = engine_health("api")
    limit = get_remembered_limit(db)
    priority = settings_service.get_setting(db, "llm.priority", "cli")
    fallback = settings_service.get_setting(db, "llm.fallback", "ask")

    def _iso(value: Optional[dt.datetime]) -> Optional[str]:
        return value.isoformat() if isinstance(value, dt.datetime) else None

    return {
        "cli": {
            "installed": cli_diag["installed"],
            "logged_in": cli_diag["logged_in"],
            "last_success_at": _iso(cli_health.get("last_success_at")),
            "last_error_kind": cli_health.get("last_error_kind"),
        },
        "api": {
            "key_registered": api_info["key_registered"],
            "key_suffix": api_info["key_suffix"],
            "last_success_at": _iso(api_health.get("last_success_at")),
        },
        "limit": limit,
        "priority": priority if priority in ("cli", "api") else "cli",
        "fallback_policy": fallback if fallback in ("auto", "ask", "off") else "ask",
    }
