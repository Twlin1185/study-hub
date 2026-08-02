"""LLM 엔진 레지스트리 · 진단 · API 키 관리 · 오류 구조화 공통 로직
(F34→F41, 설계 §4.17 — S15에서 `cli|api` 이항 가정을 엔진 레지스트리로 일반화).

- **엔진 레지스트리**: 엔진 id 3종(`claude-cli`·`claude-api`·`codex-cli`) — 표시명·과금
  형태(`billing`)·설치 가능 여부(`installable`)를 `ENGINE_REGISTRY`에 고정한다. 진단·호출·
  분류기는 엔진 종류(CLI형/API형)에 따라 이 모듈(claude-cli)과 `services.codex_adapter`
  (codex-cli)로 나뉘고, 이 모듈의 `diagnose_engine`/`classify_engine_failure`/
  `is_engine_available`이 단일 진입점 역할을 한다.
- **legacy 별칭**: 옛 설정값 `'cli'|'api'`는 **읽기 시에만** `'claude-cli'|'claude-api'`로
  매핑한다(마이그레이션 없는 하위 호환) — 쓰기는 항상 신 id.
- **폴백 = 우선순위 목록**: `llm.priority`는 엔진 id 배열(순서 = 시도 순서)로 저장한다.
  "다음 후보"는 항상 배열에서 찾는다 — `other = "api" if engine == "cli" else "cli"` 류의
  이항 분기는 여기에도, 호출부(convert_service)에도 두지 않는다.
- 키 저장은 루트 `secrets.json` **단일 출처** — **DB/settings 금지**(백업(F27) zip·git 추적
  대상 아님). 설정 화면에서 사용자가 직접 입력·등록한 값만 사용한다(환경변수·외부 프로필
  파일 등 다른 경로로의 폴백 없음 — 단순함·예측 가능성 우선, 사용자 결정). codex-cli는
  자격증명이 전역 `~/.codex` 공유라 이 파일에 항목 자체가 없다.
- CLI/API/Codex 오류 원문(JSON·스택트레이스)은 절대 사용자 응답에 노출하지 않는다 — 항상
  분류기를 거쳐 사람이 읽는 `error_info`로 변환한다. 원문은 서버 로그(`logging`)에만 남긴다.
- 진단(`diagnose_engine`)은 실제 CLI를 초경량 호출로 두드리므로 TTL(60초) 캐시로 연속 호출을
  막는다(엔진 id를 키로 사용 — S15 일반화).
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
import shutil
import subprocess
import threading
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from database import BASE_DIR
from exceptions import ConflictError, ValidationAppError
from services import secrets_store, settings_service

logger = logging.getLogger(__name__)

# S14: secrets.json 접근은 `services.secrets_store` 단일 유틸로 공유한다(qnet 서비스키와
# 파일을 공유하므로 **병합 저장** 필수 — 통째 덮어쓰면 상대 키가 사라진다).
SECRETS_PATH = secrets_store.SECRETS_PATH
ANTHROPIC_KEY_NAME = "anthropic_api_key"

DEFAULT_API_MODEL = "claude-sonnet-5"

# ---------------------------------------------------------------------------
# 엔진 레지스트리 (설계 §4.17 ①)
# ---------------------------------------------------------------------------
ENGINE_CLAUDE_CLI = "claude-cli"
ENGINE_CLAUDE_API = "claude-api"
ENGINE_CODEX_CLI = "codex-cli"

# 등록 순서 = "배열에 없는 등록 엔진을 목록 끝에 보충"할 때의 순서(설계 §4.17 ①).
ENGINE_ORDER: tuple[str, ...] = (ENGINE_CLAUDE_CLI, ENGINE_CLAUDE_API, ENGINE_CODEX_CLI)

# 각 엔진의 진단 방식(`kind`): 'cli' = 설치+로그인 진단, 'api' = 키 등록 진단.
# `models`/`default_model`(설계 §4.23 ⓑ, D4 — 무과금 확정): claude-cli는 `claude --help`가
# 명시하는 별칭('sonnet'|'opus')만 수용값으로 쓴다(전체 id도 되지만 별칭이 더 안정적).
# claude-api는 현행 `DEFAULT_API_MODEL` 승계 + 즉석 검증 가능한 최신 소목록. codex-cli는
# `codex exec --help`로 `-m` 플래그 존재만 확인됐고 모델 id는 무과금으로 확정할 수 없어
# 소목록을 빈 배열로 둔다(추측 하드코딩 금지) — 셋 다 `default_model=None`이면 플래그
# 미전달(무설정 시 동작 불변).
ENGINE_REGISTRY: Dict[str, Dict[str, Any]] = {
    ENGINE_CLAUDE_CLI: {
        "label": "Claude CLI",
        "billing": "subscription",
        "installable": False,
        "kind": "cli",
        "models": [{"id": "sonnet", "label": "Sonnet"}, {"id": "opus", "label": "Opus"}],
        "default_model": None,
    },
    ENGINE_CLAUDE_API: {
        "label": "Claude API",
        "billing": "metered",
        "installable": False,
        "kind": "api",
        "models": [
            {"id": "claude-sonnet-5", "label": "Sonnet 5"},
            {"id": "claude-opus-5", "label": "Opus 5"},
            {"id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5"},
        ],
        "default_model": DEFAULT_API_MODEL,
    },
    ENGINE_CODEX_CLI: {
        "label": "Codex CLI",
        "billing": "subscription",
        "installable": True,
        "kind": "cli",
        "models": [],
        "default_model": None,
    },
}

_LEGACY_ENGINE_ALIASES = {"cli": ENGINE_CLAUDE_CLI, "api": ENGINE_CLAUDE_API}
_LEGACY_PRIORITY_SCALAR = {
    "cli": [ENGINE_CLAUDE_CLI, ENGINE_CLAUDE_API],
    "api": [ENGINE_CLAUDE_API, ENGINE_CLAUDE_CLI],
}


def normalize_engine_id(value: Optional[str]) -> Optional[str]:
    """legacy 별칭(`'cli'|'api'`)을 신 id로, 그 외 값은 그대로 반환(읽기 시에만 적용)."""
    if value is None:
        return None
    return _LEGACY_ENGINE_ALIASES.get(value, value)


def normalize_priority(raw: Any) -> List[str]:
    """`llm.priority` 설정값 정규화 — legacy 스칼라(`'cli'|'api'`)는 동치 배열로, 배열이면
    요소별 별칭 매핑 + 미등록 id 무시, 마지막에 레지스트리 등록 순서대로 누락 보충
    (설계 §4.17 ① — codex-cli가 나중에 추가돼도 기존 설정이 깨지지 않는다)."""
    base: List[str] = []
    if isinstance(raw, str):
        base = list(_LEGACY_PRIORITY_SCALAR.get(raw, []))
    elif isinstance(raw, list):
        for item in raw:
            if not isinstance(item, str):
                continue
            eid = normalize_engine_id(item)
            if eid in ENGINE_REGISTRY and eid not in base:
                base.append(eid)
    for eid in ENGINE_ORDER:
        if eid not in base:
            base.append(eid)
    return base


def get_priority(db: Session) -> List[str]:
    """`GET /api/llm/status`의 `priority`(유효 배열) — settings 원값은 그대로 두고
    읽기 시에만 정규화한다(쓰기는 설정 화면 저장 시 신 배열로 자연 수렴)."""
    raw = settings_service.get_setting(db, "llm.priority", "cli")
    return normalize_priority(raw)


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
    return secrets_store.load_secrets()


def _save_secrets(data: Dict[str, Any]) -> None:
    secrets_store.save_secrets(data)


def get_api_key() -> Optional[str]:
    """secrets.json의 `anthropic_api_key` 단일 출처 — 설정 화면에서 사용자가 등록한 값만
    사용한다(환경변수·외부 프로필 폴백 없음)."""
    return secrets_store.get_secret(ANTHROPIC_KEY_NAME)


def api_key_status() -> Dict[str, Any]:
    """status 응답용 — secrets.json에 등록된 키가 있으면 registered=True(단일 출처와 정확히
    일치). 원문 키는 절대 반환하지 않는다(마지막 4자리만)."""
    return secrets_store.key_status(ANTHROPIC_KEY_NAME)


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
    # 병합 저장 — 같은 파일의 qnet 서비스키를 훼손하지 않는다(S14).
    secrets_store.set_secret(ANTHROPIC_KEY_NAME, key)
    record_engine_result(ENGINE_CLAUDE_API, success=True)
    return key[-4:]


def delete_api_key() -> None:
    secrets_store.delete_secret(ANTHROPIC_KEY_NAME)


# ---------------------------------------------------------------------------
# CLI 진단 — 설치(`claude --version`) + 로그인/호출 가능(초경량 호출)
# ---------------------------------------------------------------------------
def _find_claude_executable() -> Optional[str]:
    for name in ("claude", "claude.exe", "claude.cmd"):
        path = shutil.which(name)
        if path:
            return path
    return None


def _check_claude_cli_login() -> tuple[bool, Optional[str]]:
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


def _diagnose_claude_cli() -> Dict[str, Any]:
    exe = _find_claude_executable()
    installed = exe is not None
    logged_in = False
    error_kind: Optional[str] = None
    if installed:
        logged_in, error_kind = _check_claude_cli_login()

    if error_kind and error_kind not in ("rate_limit",):
        record_engine_result(ENGINE_CLAUDE_CLI, success=False, error_kind=error_kind)
    elif logged_in:
        record_engine_result(ENGINE_CLAUDE_CLI, success=True)
    return {"installed": installed, "logged_in": logged_in}


def _diagnose_codex_cli() -> Dict[str, Any]:
    from services import codex_adapter

    result = codex_adapter.diagnose()
    if result.get("installed") and not result.get("logged_in"):
        record_engine_result(ENGINE_CODEX_CLI, success=False, error_kind="auth")
    elif result.get("logged_in"):
        record_engine_result(ENGINE_CODEX_CLI, success=True)
    return result


_DIAG_CACHE_TTL = dt.timedelta(seconds=60)
_diag_lock = threading.Lock()
_diag_cache: Dict[str, Dict[str, Any]] = {}


def diagnose_engine(engine_id: str, *, force: bool = False) -> Dict[str, Any]:
    """CLI형 엔진(`claude-cli`·`codex-cli`) 진단 — `{"installed": bool, "logged_in": bool}`.
    TTL(60초) 캐시는 엔진 id를 키로 쓴다(S15 일반화). API형(`claude-api`)은 이 함수 대상이
    아니다(키 등록 여부는 `api_key_status()`가 담당)."""
    engine_id = normalize_engine_id(engine_id) or engine_id
    with _diag_lock:
        cached = _diag_cache.get(engine_id)
        if not force and cached is not None:
            if dt.datetime.now() - cached["at"] < _DIAG_CACHE_TTL:
                return cached["result"]

    if engine_id == ENGINE_CLAUDE_CLI:
        result = _diagnose_claude_cli()
    elif engine_id == ENGINE_CODEX_CLI:
        result = _diagnose_codex_cli()
    else:
        result = {"installed": False, "logged_in": False}

    with _diag_lock:
        _diag_cache[engine_id] = {"result": result, "at": dt.datetime.now()}
    return result


def diagnose_cli(*, force: bool = False) -> Dict[str, Any]:
    """legacy 이름 유지(claude-cli 진단) — 신규 코드는 `diagnose_engine`을 직접 쓴다."""
    return diagnose_engine(ENGINE_CLAUDE_CLI, force=force)


# ---------------------------------------------------------------------------
# 엔진 설치 (installable 엔진만 — 현재 codex-cli)
# ---------------------------------------------------------------------------
def install_engine(engine_id: str) -> Dict[str, Any]:
    engine_id = normalize_engine_id(engine_id) or engine_id
    meta = ENGINE_REGISTRY.get(engine_id)
    if meta is None or not meta["installable"]:
        raise ValidationAppError("설치를 지원하지 않는 엔진입니다", detail={"engine": engine_id})

    from services import codex_adapter

    result = codex_adapter.install_or_raise_upstream()
    with _diag_lock:
        _diag_cache.pop(engine_id, None)  # 설치 직후 진단 캐시 무효화
    return result


# ---------------------------------------------------------------------------
# 엔진 헬스(최근 성공/실패) — 인메모리(잡 큐와 동일 원칙, 서버 재시작 시 소실 허용)
# ---------------------------------------------------------------------------
_HEALTH_LOCK = threading.Lock()
_ENGINE_HEALTH: Dict[str, Dict[str, Any]] = {
    eid: {"last_success_at": None, "last_error_kind": None} for eid in ENGINE_ORDER
}


def record_engine_result(engine: str, *, success: bool, error_kind: Optional[str] = None) -> None:
    engine = normalize_engine_id(engine) or engine
    with _HEALTH_LOCK:
        state = _ENGINE_HEALTH.setdefault(engine, {"last_success_at": None, "last_error_kind": None})
        if success:
            state["last_success_at"] = dt.datetime.now()
            state["last_error_kind"] = None
        else:
            state["last_error_kind"] = error_kind


def engine_health(engine: str) -> Dict[str, Any]:
    engine = normalize_engine_id(engine) or engine
    with _HEALTH_LOCK:
        state = _ENGINE_HEALTH.get(engine, {"last_success_at": None, "last_error_kind": None})
        return dict(state)


def is_engine_available(engine: str) -> bool:
    """폴백 후보 자격(설계 §4.17 ①) — CLI형: 설치됨, API형: 키 등록됨. `available()`은
    로그인 여부까지는 요구하지 않는다(기존 cli 동작과 동치 — 로그인 안 된 CLI로도 실제
    호출을 시도해 그 실패를 classify가 사람이 읽는 안내로 바꾼다)."""
    engine = normalize_engine_id(engine) or engine
    meta = ENGINE_REGISTRY.get(engine)
    if meta is None:
        return False
    if meta["kind"] == "cli":
        return diagnose_engine(engine).get("installed", False)
    return get_api_key() is not None


# ---------------------------------------------------------------------------
# 활성 토글 (설계 §4.23 ① — settings `llm.disabled`, 부정 목록)
# ---------------------------------------------------------------------------
def get_disabled_engines(db: Session) -> List[str]:
    """settings `llm.disabled`(비활성 엔진 id 배열) 읽기 — 키 부재·빈 배열 = 전 엔진 활성.
    알 수 없는 id는 무시(전방 호환), legacy 별칭(`'cli'|'api'`)은 읽기 시 매핑(§4.17 ① 관례).
    쓰기는 설정 화면 저장(settings PUT) 경유뿐 — 이 함수는 읽기만 한다."""
    raw = settings_service.get_setting(db, "llm.disabled", [])
    if not isinstance(raw, list):
        return []
    result: List[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        eid = normalize_engine_id(item)
        if eid in ENGINE_REGISTRY and eid not in result:
            result.append(eid)
    return result


def is_engine_enabled(db: Session, engine: str) -> bool:
    """`llm.disabled`에 없으면 활성(설계 §4.23 ①·②) — `available()`과 직교하는 사용자 의사
    축이다(꺼진 엔진도 진단·카드 표시는 정상, 켜면 즉시 복귀)."""
    engine = normalize_engine_id(engine) or engine
    return engine not in get_disabled_engines(db)


def is_engine_candidate(db: Session, engine: str) -> bool:
    """후보 자격(설계 §4.23 ②) = `available()` && enabled — auto 해석·폴백 다음 후보·
    `error_info.fallback_available`/`fallback_engine` 파생이 전부 이 함수 하나를 경유한다
    (호출처별 개별 판정 금지). `available()` 자체 의미는 불변(진단·카드 표시는 꺼진 엔진도
    정상)."""
    engine = normalize_engine_id(engine) or engine
    return is_engine_available(engine) and is_engine_enabled(db, engine)


# ---------------------------------------------------------------------------
# 엔진별 모델 선택 (설계 §4.23 ⓑ)
# ---------------------------------------------------------------------------
def get_selected_model(db: Session, engine: str) -> Optional[str]:
    """유효 선택 모델 = `llm.models[엔진id]`가 그 엔진의 소목록에 있으면 그 값, 아니면
    `default_model`(소목록 밖 값·구 설정 잔존은 조용히 기본값 폴백 — 전방 호환).
    `claude-api`는 `llm.models['claude-api']` 부재 시 legacy `llm.api_model`을 읽기
    별칭으로 쓴다(쓰기는 항상 `llm.models`). CLI형 기본값 `None` = 모델 플래그 미전달
    (현행 동작 그대로)."""
    engine = normalize_engine_id(engine) or engine
    meta = ENGINE_REGISTRY.get(engine)
    if meta is None:
        return None
    valid_ids = {m["id"] for m in meta.get("models") or []}
    default_model = meta.get("default_model")

    raw_map = settings_service.get_setting(db, "llm.models", {})
    if not isinstance(raw_map, dict):
        raw_map = {}
    selected = raw_map.get(engine)
    if selected is None and engine == ENGINE_CLAUDE_API:
        selected = settings_service.get_setting(db, "llm.api_model", None)
    if isinstance(selected, str) and selected in valid_ids:
        return selected
    return default_model


# ---------------------------------------------------------------------------
# 엔진 선택 (auto|엔진id, 설계 §4.17 ③ · §4.23 ②)
# ---------------------------------------------------------------------------
def resolve_engine(db: Session, requested: str) -> str:
    """`requested`가 등록된 엔진 id(legacy 별칭 포함)면 그대로 쓴다. `auto`(그 외 값 포함)는
    priority 배열 순서대로 첫 후보(`available()` && enabled) 엔진 — 전부 불가면 배열 첫
    엔진을 그대로 반환해(기존 동작처럼) 그 엔진의 실패를 통해 사람이 읽는 안내가 나가게
    한다."""
    normalized = normalize_engine_id(requested)
    if normalized in ENGINE_REGISTRY:
        return normalized
    priority = get_priority(db)
    for eid in priority:
        if is_engine_candidate(db, eid):
            return eid
    return priority[0] if priority else ENGINE_CLAUDE_CLI


def next_fallback_engine(db: Session, engine: str) -> Optional[str]:
    """실패(또는 한도 기억 적중)한 `engine`의 priority 배열상 **다음 위치부터** 순서대로 첫
    후보(`available()` && enabled) 엔진(설계 §4.17 ③·§4.23 ② — wraparound 없음, 배열
    끝까지 없으면 후보 없음)."""
    engine = normalize_engine_id(engine) or engine
    priority = get_priority(db)
    try:
        idx = priority.index(engine)
    except ValueError:
        idx = -1
    for candidate in priority[idx + 1 :]:
        if is_engine_candidate(db, candidate):
            return candidate
    return None


# ---------------------------------------------------------------------------
# 명시 지정 422 방어 (설계 §4.23 ⓒ·결정 ⑥) — 공통 헬퍼 1개, 8곳 잡 시작 지점이 공유
# ---------------------------------------------------------------------------
def assert_engine_selectable(db: Session, engine: str) -> None:
    """`engine`이 auto가 아닌 명시 엔진 id(legacy 별칭 포함)이고 그 엔진이 비활성·비가용이면
    잡 생성 전 422(§3 `VALIDATION_ERROR`)로 거부한다. `auto`·미등록 값은 검증하지 않는다
    (auto의 후보 산출 자체가 `is_engine_candidate`를 경유하므로 비활성 엔진은 애초에
    후보가 아니다 — '422 아님' 계약은 값 형식에 대한 것). 이 후보·상태 판정은 위
    `is_engine_enabled`/`is_engine_available`만 재사용한다(검증 로직 이원화 금지)."""
    normalized = normalize_engine_id(engine)
    if normalized not in ENGINE_REGISTRY:
        return
    meta = ENGINE_REGISTRY[normalized]
    label = meta["label"]
    if not is_engine_enabled(db, normalized):
        raise ValidationAppError(
            f"{label} 엔진이 '사용 안 함' 상태입니다 — 설정에서 켜거나 다른 엔진을 선택하세요",
            detail={"engine": normalized, "reason": "disabled"},
        )
    if not is_engine_available(normalized):
        if meta["kind"] == "cli":
            message = f"{label} 엔진이 설치되어 있지 않습니다 — 설치하거나 다른 엔진을 선택하세요"
            reason = "not_installed"
        else:
            message = (
                f"{label} 엔진에 API 키가 등록되어 있지 않습니다 — 설정에서 키를 등록하거나 "
                "다른 엔진을 선택하세요"
            )
            reason = "key_not_registered"
        raise ValidationAppError(message, detail={"engine": normalized, "reason": reason})


# ---------------------------------------------------------------------------
# 오류 구조화 — 엔진별 분류기 단일 진입점
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
    """claude CLI 실패 원문(stdout/stderr/result 문자열)을 사람이 읽는 error_info 조각으로
    변환. 반환 dict에는 fallback_available이 없다 — 호출부(build_error_info)가 채운다.
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
            "action": "잠시 후 다시 시도하거나 다른 엔진으로 전환해 계속하세요.",
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
            "action": "Claude Code를 설치하거나 다른 엔진으로 전환하세요.",
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
        "action": "잠시 후 다시 시도하거나 다른 엔진으로 전환하세요.",
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
            "action": exc.action or "API 키를 확인하거나 다른 엔진으로 전환하세요.",
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
            "action": "잠시 후 다시 시도하거나 다른 엔진으로 전환하세요.",
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
        "action": "잠시 후 다시 시도하거나 다른 엔진으로 전환하세요.",
    }


def classify_engine_failure(engine: str, exc: Exception) -> Dict[str, Any]:
    """엔진별 분류기 단일 진입점(설계 §4.17 ① `classify()`) — engine kind로 분기하되
    이항(2값)이 아니라 레지스트리 3종을 전부 다룬다. convert_service는 이 함수만 부른다."""
    engine = normalize_engine_id(engine) or engine
    if engine == ENGINE_CLAUDE_CLI:
        return classify_cli_failure(str(exc))
    if engine == ENGINE_CODEX_CLI:
        from services import codex_adapter

        return codex_adapter.classify_codex_failure(str(exc))
    if engine == ENGINE_CLAUDE_API:
        return classify_api_exception(exc)
    return {
        "kind": "other",
        "limit_kind": None,
        "resets_at": None,
        "message": "알 수 없는 엔진에서 오류가 발생했습니다.",
        "action": "잠시 후 다시 시도하세요.",
    }


def build_error_info(db: Session, engine: str, base: Dict[str, Any]) -> Dict[str, Any]:
    """base(kind/limit_kind/resets_at/message/action)에 fallback_available·fallback_engine을
    채워 반환한다. fallback_available = 다음 후보 엔진이 실제로 있고, 폴백 정책이 'off'가
    아닐 때(설계 §4.17 ③) — `fallback_engine`은 그 다음 후보 엔진 id(없으면 None)."""
    fallback_policy = settings_service.get_setting(db, "llm.fallback", "ask")
    next_engine = next_fallback_engine(db, engine) if fallback_policy != "off" else None
    return {**base, "fallback_available": next_engine is not None, "fallback_engine": next_engine}


# ---------------------------------------------------------------------------
# 한도 기억 (settings: llm.last_limit)
# ---------------------------------------------------------------------------
def remember_limit(db: Session, engine: str, error_info: Dict[str, Any]) -> None:
    """리셋 시각을 모르면 "리셋 전 재시도 차단" 판단 자체가 불가능하므로 기억하지 않는다
    (프론트 계약 `LlmLimitInfo{kind,resets_at}`도 둘 다 non-null을 기대한다).
    해당 잡의 `error_info`에는 여전히 메시지가 실리므로 사용자에게는 그대로 노출된다."""
    if error_info.get("kind") != "rate_limit" or not error_info.get("resets_at"):
        return
    engine = normalize_engine_id(engine) or engine
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


def apply_remembered_limit(db: Session, engine: str) -> str:
    """리셋 전 같은 엔진 재시도를 잡 생성 전에 처리한다.
    - 기억된 한도가 없거나 다른 엔진 대상이면 engine을 그대로 반환한다.
    - 폴백 정책이 'auto'이고 priority상 다음 available 엔진이 있으면 **조용히 그 엔진으로
      전환**해 반환한다(409 없음) — 호출부는 반환값이 engine과 다르면 사전 전환이 일어났다고
      판단하면 된다(예: `job["_fallback_used"] = True`로 런타임 재전환 낭비를 막는다).
    - 그 외(ask/off/대체 엔진 불가)는 기존과 동일하게 즉시 409 ConflictError로 경고한다."""
    engine = normalize_engine_id(engine) or engine
    raw = _get_remembered_limit_raw(db)
    if raw is None or normalize_engine_id(raw.get("engine")) != engine:
        return engine

    fallback_policy = settings_service.get_setting(db, "llm.fallback", "ask")
    if fallback_policy == "auto":
        candidate = next_fallback_engine(db, engine)
        if candidate:
            return candidate

    resets_at_str = raw.get("resets_at")
    resets_at = None
    if resets_at_str:
        try:
            resets_at = dt.datetime.fromisoformat(resets_at_str)
        except ValueError:
            resets_at = None
    message = _humanize_limit_message(raw.get("limit_kind"), resets_at)
    fallback_candidate = next_fallback_engine(db, engine) if fallback_policy != "off" else None
    raise ConflictError(
        message,
        detail={
            "kind": "rate_limit",
            "limit_kind": raw.get("limit_kind"),
            "resets_at": resets_at_str,
            "message": message,
            "action": "잠시 후 다시 시도하거나 다른 엔진으로 전환하세요.",
            "fallback_available": fallback_candidate is not None,
            "fallback_engine": fallback_candidate,
        },
    )


# ---------------------------------------------------------------------------
# 종합 진단 응답 — GET /api/llm/status (설계 §4.17 ②, 엔진 배열로 교체)
# ---------------------------------------------------------------------------
def _iso(value: Optional[dt.datetime]) -> Optional[str]:
    return value.isoformat() if isinstance(value, dt.datetime) else None


def _engine_status(db: Session, engine_id: str) -> Dict[str, Any]:
    meta = ENGINE_REGISTRY[engine_id]
    health = engine_health(engine_id)
    entry: Dict[str, Any] = {
        "id": engine_id,
        "label": meta["label"],
        "billing": meta["billing"],
        "installable": meta["installable"],
        "available": is_engine_available(engine_id),
        # 설계 §4.23 ⑤ — 순수 추가 4종(톱레벨·기존 필드 불변).
        "enabled": is_engine_enabled(db, engine_id),
        "models": list(meta.get("models") or []),
        "default_model": meta.get("default_model"),
        "selected_model": get_selected_model(db, engine_id),
        "installed": None,
        "logged_in": None,
        "key_registered": None,
        "key_suffix": None,
        "last_success_at": _iso(health.get("last_success_at")),
        "last_error_kind": health.get("last_error_kind"),
    }
    if meta["kind"] == "cli":
        diag = diagnose_engine(engine_id)
        entry["installed"] = diag.get("installed")
        entry["logged_in"] = diag.get("logged_in")
    else:
        info = api_key_status()
        entry["key_registered"] = info["key_registered"]
        entry["key_suffix"] = info["key_suffix"]
    return entry


def get_status(db: Session) -> Dict[str, Any]:
    priority = get_priority(db)
    fallback = settings_service.get_setting(db, "llm.fallback", "ask")
    return {
        "engines": [_engine_status(db, eid) for eid in ENGINE_ORDER],
        "limit": get_remembered_limit(db),
        "priority": priority,
        "fallback_policy": fallback if fallback in ("auto", "ask", "off") else "ask",
    }
