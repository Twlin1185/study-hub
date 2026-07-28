"""루트 `secrets.json` 단일 접근점 (F34 전례 — S14에서 공유 유틸로 추출).

**단일 출처 원칙**: API 키·서비스키는 오직 이 파일에만 저장한다 — DB·settings 저장 금지,
백업(F27) zip·git 추적 대상 아님(.gitignore). 값은 **write-only**로 다룬다: 어떤 응답·로그·
오류 메시지에도 원문을 담지 않고, 필요하면 `key_suffix()`(마지막 4자리)만 노출한다.

**병합 저장**: `set_secret`/`delete_secret`은 항상 파일 전체를 읽어 해당 키만 바꿔 다시 쓴다 —
서로 다른 키(`anthropic_api_key`·`qnet_service_key`)가 같은 파일을 공유하므로 통째 덮어쓰기는
다른 키를 훼손한다(F34/S14 공유 계약).
"""
from __future__ import annotations

import json
import threading
from typing import Any, Dict, Optional

from database import BASE_DIR

SECRETS_PATH = BASE_DIR / "secrets.json"

_LOCK = threading.Lock()


def load_secrets() -> Dict[str, Any]:
    if not SECRETS_PATH.exists():
        return {}
    try:
        data = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_secrets(data: Dict[str, Any]) -> None:
    SECRETS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_secret(name: str) -> Optional[str]:
    """등록된 값(공백 제거)이 있으면 반환, 없으면 None. 환경변수·외부 프로필 폴백 없음."""
    value = load_secrets().get(name)
    return value.strip() if isinstance(value, str) and value.strip() else None


def set_secret(name: str, value: str) -> None:
    """**병합 저장** — 같은 파일의 다른 키를 훼손하지 않는다."""
    with _LOCK:
        secrets = load_secrets()
        secrets[name] = value
        save_secrets(secrets)


def delete_secret(name: str) -> None:
    with _LOCK:
        secrets = load_secrets()
        if name in secrets:
            del secrets[name]
            save_secrets(secrets)


def key_suffix(value: Optional[str]) -> Optional[str]:
    """응답에 노출해도 되는 유일한 형태 — 마지막 4자리."""
    if not value:
        return None
    return value[-4:]


def key_status(name: str) -> Dict[str, Any]:
    """`{key_registered, key_suffix}` — 원문 키는 절대 반환하지 않는다."""
    value = get_secret(name)
    return {"key_registered": value is not None, "key_suffix": key_suffix(value)}
