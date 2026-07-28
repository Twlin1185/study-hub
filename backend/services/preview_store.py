"""변환 결과(반입 JSON) 디스크 보존·복구 저장소 (S13 F40-①, 설계 §4.3).

왜: 변환 산출 JSON이 `import_service._PREVIEW_CACHE`(프로세스 메모리, TTL 1시간)에만
존재해 시간 초과·서버 재시작 시 LLM 비용을 치른 결과가 복구 수단 없이 사라진다.

계약(설계 §4.3 — **파일명 규칙이 곧 복구 계약**):
    import/auto/{preview_id}__{source_hash12|nosrc}__{원본파일명}.json
  - `source_hash12` = 원본 바이트 SHA-256 앞 12자 (= `sources/` 저장 파일명 접두어와
    동일 규칙 — 이 접두어로 원본 바이트를 되읽어 원본 연결·duplicate_source 판정을
    최초와 동일하게 재구성한다). 원본이 없으면 `nosrc`.
  - **별도 인덱스·DB 레코드를 두지 않는다(DDL 0건).**
  - 보존 정책: 최근 50건만 유지(초과 시 오래된 것부터 삭제). git 제외 · **백업(F27)
    대상 아님**(백업 = study.db + sources/) — 손실 시 대가는 "재변환 비용"뿐이다.

이 모듈은 파일 입출력만 담당한다(preview 재생성은 `import_service`가 오케스트레이션).
`sources/` 원본은 **읽기 전용**으로만 접근한다(불변 규칙 4).
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from database import BASE_DIR

IMPORT_DIR = BASE_DIR / "import"
AUTO_DIR = IMPORT_DIR / "auto"  # 사람이 넣은 파일(import/ 최상위)과 앱 산출물을 분리
SOURCES_DIR = BASE_DIR / "sources"

KEEP_MAX = 50  # 최근 50건 유지 (설계 §4.3 보존 정책)
NO_SOURCE = "nosrc"
# S15(F41): 신뢰 게이트 경고 사이드카 키 — §8.2 규격 밖(재반입 시 무시되는 부가 정보)
WARNINGS_KEY = "preview_warnings"
_NAME_MAX = 80  # 원본 파일명 성분 길이 상한 (Windows 경로 길이 방어)

_PREVIEW_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_HASH12_RE = re.compile(r"^[0-9a-f]{12}$")

_LOGGER = logging.getLogger(__name__)


def _safe_component(name: str) -> str:
    """파일명 성분 정리 — 경로 성분 제거 + 구분자(`__`) 충돌·위험 문자 제거."""
    base = Path(name).name.replace("\\", "_").replace("/", "_").strip()
    base = re.sub(r'[:*?"<>|\x00-\x1f]', "_", base)
    # 구분자(`__`)와 충돌 방지 — 1패스 replace는 "a____b" → "a__b"로 구분자를 되살리므로
    # 연속 밑줄을 한 번에 하나로 접는다. 위험 문자 치환이 만든 밑줄까지 접도록 **치환 뒤**
    # 실행한다 (split('__', 2) 안정성).
    base = re.sub(r"_{2,}", "_", base)
    if len(base) > _NAME_MAX:
        stem, dot, ext = base.rpartition(".")
        if dot and len(ext) <= 8:
            base = stem[: _NAME_MAX - len(ext) - 1] + "." + ext
        else:
            base = base[:_NAME_MAX]
    return base or "preview"


def is_valid_preview_id(preview_id: Optional[str]) -> bool:
    return bool(preview_id) and bool(_PREVIEW_ID_RE.match(preview_id or ""))


def save(
    preview_id: str,
    json_bytes: bytes,
    *,
    source_filename: Optional[str] = None,
    source_hash: Optional[str] = None,
    warnings: Optional[Dict[int, List[str]]] = None,
) -> Optional[Path]:
    """반입 JSON을 보존한다. 실패는 예외를 올리지 않고 None을 반환한다 —
    보존 실패가 변환 결과(이미 성공한 preview) 자체를 버리게 만들면 안 된다.

    S15(F41): 최초 preview에서 계산한 변환 신뢰 게이트 경고를 **`preview_warnings`
    사이드카 키**(`{"항목 index": ["solved_answer", ...]}`)로 같은 파일에 함께 남긴다
    (설계 §4.17 DDL 재확인 항목 "preview JSON 필드(warnings — 메모리 + `import/auto/`
    파일)"). 복구는 **상태 복원이지 재판정이 아니므로** 이 값이 정본이다 — 원본 파일이
    없는 경로(사이트 반입의 구조화 텍스트)에서 복구 시 `fabrication_suspect`가
    `match_unavailable`로 강등돼 기본 반입에 포함되던 구멍을 막는다.
    §8.2 규격 밖의 키라 사람이 이 파일을 그대로 재반입해도 무시된다(전방 호환)."""
    if not is_valid_preview_id(preview_id):
        return None
    hash_part = source_hash[:12] if source_hash else NO_SOURCE
    name_part = _safe_component(source_filename or "preview")
    path = AUTO_DIR / f"{preview_id}__{hash_part}__{name_part}.json"
    try:
        AUTO_DIR.mkdir(parents=True, exist_ok=True)
        # UTF-8 · ensure_ascii=False (설계 §4.3) — 사람이 열어보고 그대로 재반입할 수 있게
        # 들여쓰기까지 적용해 다시 직렬화한다(내용·항목 순서는 동일).
        try:
            data = json.loads(json_bytes)
            if isinstance(data, dict) and warnings is not None:
                data[WARNINGS_KEY] = {
                    str(index): list(values) for index, values in sorted(warnings.items())
                }
            text = json.dumps(data, ensure_ascii=False, indent=2)
        except (json.JSONDecodeError, UnicodeDecodeError):
            path.write_bytes(json_bytes)
        else:
            path.write_text(text, encoding="utf-8")
    except OSError:
        _LOGGER.warning("반입 JSON 보존 실패: %s", path, exc_info=True)
        return None
    prune()
    return path


def load_warnings(json_bytes: bytes) -> Optional[Dict[int, List[str]]]:
    """보존 JSON에서 `preview_warnings` 사이드카를 읽는다(없으면 None → 호출부가 재계산).

    **구버전 보존본(S15 이전 — 키 없음)은 None**이라 현행 재계산 동작이 그대로 유지된다."""
    try:
        data = json.loads(json_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    raw = data.get(WARNINGS_KEY)
    if not isinstance(raw, dict):
        return None
    result: Dict[int, List[str]] = {}
    for key, values in raw.items():
        try:
            index = int(key)
        except (TypeError, ValueError):
            continue
        if isinstance(values, list):
            result[index] = [v for v in values if isinstance(v, str)]
    return result


def find(preview_id: str) -> Optional[Path]:
    """preview_id로 보존 파일을 찾는다(없으면 None)."""
    if not is_valid_preview_id(preview_id) or not AUTO_DIR.exists():
        return None
    matches = sorted(AUTO_DIR.glob(f"{preview_id}__*.json"))
    return matches[0] if matches else None


def parse_name(path: Path) -> Tuple[Optional[str], Optional[str]]:
    """보존 파일명 → (source_hash12 | None, 원본 파일명 | None)."""
    stem = path.name[: -len(".json")] if path.name.endswith(".json") else path.name
    parts = stem.split("__", 2)
    if len(parts) < 3:
        return None, None
    hash_part, name_part = parts[1], parts[2]
    hash12 = hash_part if _HASH12_RE.match(hash_part) else None
    return hash12, (name_part or None)


def read_source_bytes(hash12: Optional[str]) -> Optional[bytes]:
    """`sources/`에서 해시 접두어로 원본 바이트를 되읽는다(읽기 전용 — 불변 규칙 4)."""
    if not hash12 or not _HASH12_RE.match(hash12) or not SOURCES_DIR.exists():
        return None
    for candidate in sorted(SOURCES_DIR.glob(f"{hash12}_*")):
        if candidate.is_file():
            try:
                return candidate.read_bytes()
            except OSError:
                return None
    return None


def list_files() -> List[Path]:
    if not AUTO_DIR.exists():
        return []
    return [p for p in AUTO_DIR.glob("*.json") if p.is_file()]


def prune(keep: int = KEEP_MAX) -> List[str]:
    """최근 `keep`건만 남기고 오래된 파일부터 삭제. 삭제한 파일명 목록을 반환."""
    files = list_files()
    if len(files) <= keep:
        return []
    files.sort(key=lambda p: (p.stat().st_mtime, p.name))
    removed: List[str] = []
    for path in files[: len(files) - keep]:
        try:
            path.unlink()
            removed.append(path.name)
        except OSError:  # pragma: no cover - 파일 잠김 등
            _LOGGER.warning("보존 파일 정리 실패: %s", path)
    return removed
