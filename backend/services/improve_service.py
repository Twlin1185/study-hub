"""반입 자기 개선 루프 — 실패 사례·개선 제안·회귀 재검증 (S20 — F46, 설계 §4.22).

**이 모듈은 DB에 아무것도 쓰지 않는다.** 저장은 전부 `improve/` 폴더 JSON 레코드 +
`prompts/convert.cases.md`·`prompts/convert.md`(apply 승인 반영뿐) + 인메모리(gen·reg
상태, TTL 1시간)다. `sources/`는 읽기 전용으로만 접근한다(불변 규칙 4 — 새 파일을 쓰지
않는다. 실패 사례의 원본 바이트가 sources/에 없으면 회귀는 `outcome:'unavailable'`로
정직하게 떨어진다).

세 개의 축:
  ① 실패 사례 수집 — `collect_job_failure`(convert·fetch 잡 실패, best-effort) ·
     `collect_gate_case`(신뢰 게이트 fabrication_suspect, best-effort) ·
     `collect_report_case`(F30 신고, best-effort). 전부 예외를 삼킨다(로그만) — 수집
     실패가 원 플로우를 막지 않는다.
  ② 제안 생성 — `prepare_gen`(LLM 0·견적) → (convert 잡 큐, kind='improve_proposal') →
     `validate_proposals`(순수 함수 — 화이트리스트·case_ids 범위·헝크 시뮬레이션·정책
     잠금) → `save_proposals`.
  ③ 제안함 승인·반영 — `apply_proposal`(**이 기능의 유일한 파일 쓰기**: 사례집 append
     또는 convert.md 헝크 치환) · `reject_proposal`.
  ④ 회귀 재검증 — `prepare_regression`(LLM 0·견적) → 실제 재변환은
     `convert_service._do_improve_regression_job`이 수행(엔진 실행은 convert_service
     소관 — 이 모듈은 사례 IO·판정 보조 함수만 제공, 중복 구현 금지).

정책 잠금 검증(`check_policy_lock`)과 헝크 적용(`apply_hunks`)은 ②(생성 게이트 사전
시뮬레이션)와 ③(apply 최종 검증)이 **동일 함수를 공유**한다(설계 §4.22 — 이원화 금지).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import re
import threading
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from database import BASE_DIR
from exceptions import ConflictError, NotFoundError, ValidationAppError
from services import preview_store, source_match

_LOGGER = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 경로·상수
# ---------------------------------------------------------------------------
IMPROVE_DIR = BASE_DIR / "improve"
CASES_DIR = IMPROVE_DIR / "cases"
PROPOSALS_DIR = IMPROVE_DIR / "proposals"
PROMPTS_DIR = BASE_DIR / "prompts"
CONVERT_PROMPT_PATH = PROMPTS_DIR / "convert.md"
CASEBOOK_PATH = PROMPTS_DIR / "convert.cases.md"
# B4-S2/S3(설계 §4.11 추기) — 분류 정책 단일 출처. 종전에는 "단일 출처"로 문서에만
# 선언돼 있고 실제 프롬프트에는 첨부되지 않아 LLM이 taxonomy 규칙을 몰랐다.
TAXONOMY_PATH = PROMPTS_DIR / "taxonomy.md"

KEEP_MAX = 50  # cases·proposals 각 최근 50건 (결정 ②, R18 상수 관례)

COLLECT_KINDS = {"parse_failed", "unsupported_format", "invalid_output"}  # 수집 대상 kind만
PROPOSAL_KIND_WHITELIST = {"casebook", "prompt_edit", "code_issue"}

GEN_TTL = dt.timedelta(hours=1)
REG_TTL = dt.timedelta(hours=1)

GEN_MAX_CASES = 20
GEN_MAX_CONTEXT_CHARS = 200_000
REG_MAX_CASES = 10
CASEBOOK_MAX_CHARS = 20_000
SOURCE_EXCERPT_CHARS = 5_000
OUTPUT_EXCERPT_CHARS = 5_000

POLICY_LOCK_START = "<!-- policy-lock:start -->"
POLICY_LOCK_END = "<!-- policy-lock:end -->"
_MARKER_RE = re.compile(r"<!-- policy-lock:(start|end) -->")

_DISCARD_LABELS: Dict[str, str] = {
    "invalid_kind": "허용되지 않는 kind",
    "bad_case_ref": "근거 사례 범위 밖 참조",
    "hunk_unappliable": "헝크 적용 불가(본문 불일치)",
    "policy_locked": "정책 잠금 구간 접촉",
    "empty_payload": "payload 비어 있음",
}


def discard_label(reason: str) -> str:
    return _DISCARD_LABELS.get(reason, reason)


_GENS: Dict[str, dict] = {}
_GENS_LOCK = threading.Lock()
_REGS: Dict[str, dict] = {}
_REGS_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# 파일 IO 유틸
# ---------------------------------------------------------------------------
def _ensure_dirs() -> None:
    CASES_DIR.mkdir(parents=True, exist_ok=True)
    PROPOSALS_DIR.mkdir(parents=True, exist_ok=True)


def _case_path(case_id: str) -> Path:
    return CASES_DIR / f"{case_id}.json"


def _case_output_path(case_id: str) -> Path:
    return CASES_DIR / f"{case_id}.output.txt"


def _proposal_path(proposal_id: str) -> Path:
    return PROPOSALS_DIR / f"{proposal_id}.json"


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _list_case_files() -> List[Path]:
    _ensure_dirs()
    return sorted(CASES_DIR.glob("fc_*.json"))


def _list_proposal_files() -> List[Path]:
    _ensure_dirs()
    return sorted(PROPOSALS_DIR.glob("pr_*.json"))


def _load_records(paths: Sequence[Path]) -> List[dict]:
    records: List[dict] = []
    for p in paths:
        try:
            records.append(_read_json(p))
        except (OSError, json.JSONDecodeError):
            _LOGGER.warning("레코드 파일을 읽지 못했습니다: %s", p, exc_info=True)
    return records


# ---------------------------------------------------------------------------
# 프루닝 (결정 ②) — cases: 오래된 것부터. proposals: 결정 완료 먼저, pending 최후.
# ---------------------------------------------------------------------------
def _prune_cases(keep: int = KEEP_MAX) -> None:
    records = _load_records(_list_case_files())
    if len(records) <= keep:
        return
    records.sort(key=lambda r: r.get("created_at") or "")
    excess = len(records) - keep
    for record in records[:excess]:
        case_id = record.get("case_id")
        if not case_id:
            continue
        _case_path(case_id).unlink(missing_ok=True)
        _case_output_path(case_id).unlink(missing_ok=True)


def _prune_proposals(keep: int = KEEP_MAX) -> None:
    records = _load_records(_list_proposal_files())
    if len(records) <= keep:
        return

    def _sort_key(r: dict) -> Tuple[int, str]:
        pending = 1 if r.get("status") == "pending" else 0
        return (pending, r.get("created_at") or "")

    records.sort(key=_sort_key)
    excess = len(records) - keep
    for record in records[:excess]:
        pid = record.get("proposal_id")
        if pid:
            _proposal_path(pid).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# 사례 수집 (자동 — LLM 0·비용 0, best-effort — 실패해도 원 플로우 무영향)
# ---------------------------------------------------------------------------
def _hash12_of(data: Optional[bytes]) -> Optional[str]:
    if not data:
        return None
    return hashlib.sha256(data).hexdigest()[:12]


def _safe_name(name: str) -> str:
    base = Path(name).name.replace("\\", "_").replace("/", "_").strip()
    return base or "source"


def _dedup_key(
    *,
    kind: str,
    origin: str,
    hash12: Optional[str],
    document_id: Optional[int],
    preview_ref: Optional[str] = None,
) -> Tuple[Any, ...]:
    """중복 병합 키(결정 ②) — (kind, source.hash12), report는 (kind, document_id).

    S20(F46, 검토 지적 ⑦): `hash12`가 없는 경로(사이트 반입의 `FetchedExam` 구조화
    텍스트 — 원본 파일 자체가 없어 `source_bytes`가 채워지지 않는다)에서 무조건
    `(kind, None)`으로 묶으면 **서로 다른 회차의 실패가 kind별 1건으로 과대 병합**되어
    detail·preview_ref가 최신 것으로 덮인다. `preview_ref`(있으면)를 대체 식별자로 키에
    포함해 서로 다른 원천이 섞이지 않게 한다 — 매 시도가 새 preview_id라 완전한 재발
    카운트 병합(같은 회차 반복 실패의 count 누적)은 못 하지만, **다른 원천이 합쳐지는
    사고가 우선순위가 높다**(대체 식별자마저 없으면 기존 동작 유지)."""
    if origin == "report":
        return ("report", kind, document_id)
    if hash12:
        return ("other", kind, hash12)
    if preview_ref:
        return ("other", kind, "preview_ref", preview_ref)
    return ("other", kind, hash12)


def _find_existing_case(dedup_key: Tuple[Any, ...]) -> Optional[Path]:
    for path in _list_case_files():
        try:
            data = _read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        source = data.get("source") or {}
        document = data.get("document") or {}
        key = _dedup_key(
            kind=data.get("kind"),
            origin=data.get("origin"),
            hash12=source.get("hash12"),
            document_id=document.get("id"),
            preview_ref=data.get("preview_ref"),
        )
        if key == dedup_key:
            return path
    return None


def _record_case(
    *,
    origin: str,
    kind: str,
    engine: Optional[str] = None,
    source_filename: Optional[str] = None,
    source_bytes: Optional[bytes] = None,
    document: Optional[dict] = None,
    preview_ref: Optional[str] = None,
    detail: dict,
    output_text: Optional[str] = None,
) -> str:
    _ensure_dirs()
    hash12 = _hash12_of(source_bytes)
    document_id = document.get("id") if document else None
    dedup_key = _dedup_key(
        kind=kind, origin=origin, hash12=hash12, document_id=document_id, preview_ref=preview_ref
    )
    now = dt.datetime.now().isoformat()

    existing_path = _find_existing_case(dedup_key)
    if existing_path is not None:
        data = _read_json(existing_path)
        data["count"] = int(data.get("count", 1)) + 1
        data["last_seen_at"] = now
        data["detail"] = detail
        if preview_ref:
            data["preview_ref"] = preview_ref
        _write_json(existing_path, data)
        return data["case_id"]

    case_id = f"fc_{uuid.uuid4().hex[:6]}"
    source_field = None
    if hash12:
        # 스키마 계약(프론트 `ImproveCaseSource`) — path·hash12·filename 전부 non-null.
        safe_filename = source_filename or "source"
        name_part = _safe_name(safe_filename)
        source_field = {"path": f"{hash12}_{name_part}", "hash12": hash12, "filename": safe_filename}
    record = {
        "case_id": case_id,
        "created_at": now,
        "origin": origin,
        "kind": kind,
        "count": 1,
        "last_seen_at": now,
        "engine": engine,
        "source": source_field,
        "document": document,
        "preview_ref": preview_ref,
        "detail": detail,
        "llm_output_path": None,
        "regressions": [],
    }
    if output_text:
        try:
            _case_output_path(case_id).write_text(output_text, encoding="utf-8")
            record["llm_output_path"] = f"{case_id}.output.txt"
        except OSError:
            _LOGGER.warning("LLM 산출물 원문 저장 실패(사례 레코드는 유지)", exc_info=True)
    _write_json(_case_path(case_id), record)
    _prune_cases()
    return case_id


def collect_job_failure(
    job_kind: str,
    error_info: Optional[dict],
    *,
    engine: Optional[str] = None,
    source_filename: Optional[str] = None,
    source_bytes: Optional[bytes] = None,
    output_text: Optional[str] = None,
) -> None:
    """convert·fetch·split_analyze 잡 실패 수집(①, S23 F49 ㉳ — §4.22 수집 지점 확장) —
    `error_info.kind`가 대상 3종일 때만(제외: too_large·rate_limit·미설치/로그인/타임아웃
    등 환경·정책 실패). best-effort."""
    try:
        if not isinstance(error_info, dict):
            return
        kind = error_info.get("kind")
        if kind not in COLLECT_KINDS:
            return
        if job_kind == "convert":
            origin = "convert_job"
        elif job_kind == "split_analyze":
            origin = "split_analyze_job"
        else:
            origin = "fetch_job"
        detail = {"message": error_info.get("message"), "action": error_info.get("action")}
        _record_case(
            origin=origin,
            kind=kind,
            engine=engine,
            source_filename=source_filename,
            source_bytes=source_bytes,
            detail=detail,
            output_text=output_text if kind == "invalid_output" else None,
        )
    except Exception:  # noqa: BLE001 - 수집 실패가 잡 실패 처리 자체를 막으면 안 된다
        _LOGGER.warning("실패 사례 수집 중 오류(원 플로우 영향 없음)", exc_info=True)


def collect_gate_case(
    *,
    source_filename: Optional[str],
    source_bytes: Optional[bytes],
    item_indices: Sequence[int],
    total_items: int,
    preview_ref: Optional[str],
) -> None:
    """게이트 탈락(fabrication_suspect) 수집(①-②) — 잡 단위 1건, best-effort."""
    try:
        if not item_indices:
            return
        detail = {
            "item_indices": list(item_indices),
            "count": len(item_indices),
            "total_items": total_items,
        }
        _record_case(
            origin="gate",
            kind="fabrication_suspect",
            engine=None,
            source_filename=source_filename,
            source_bytes=source_bytes,
            preview_ref=preview_ref,
            detail=detail,
        )
    except Exception:  # noqa: BLE001
        _LOGGER.warning("게이트 실패 사례 수집 중 오류(원 플로우 영향 없음)", exc_info=True)


def collect_report_case(
    *, document_id: int, doc_no: str, title: str, reason: str, source_detail: Optional[str]
) -> None:
    """F30 신고 시점 수집(①-③, 결정 ⑥) — origin='report'·kind='user_report'. best-effort.
    F30 요청·응답·플로우는 무변경(부수 기록일 뿐)."""
    try:
        detail = {"reason": reason, "source_detail": source_detail}
        _record_case(
            origin="report",
            kind="user_report",
            engine=None,
            document={"id": document_id, "doc_no": doc_no, "title": title},
            detail=detail,
        )
    except Exception:  # noqa: BLE001
        _LOGGER.warning("신고 사례 수집 중 오류(원 플로우 영향 없음)", exc_info=True)


# ---------------------------------------------------------------------------
# 사례 조회·목록·삭제 (cases 3 엔드포인트)
# ---------------------------------------------------------------------------
def list_cases(kind: Optional[str], page: int, size: int) -> Tuple[List[dict], int]:
    records = _load_records(_list_case_files())
    if kind:
        records = [r for r in records if r.get("kind") == kind]
    records.sort(key=lambda r: r.get("last_seen_at") or r.get("created_at") or "", reverse=True)
    total = len(records)
    start = (page - 1) * size
    return records[start : start + size], total


def get_case_or_404(case_id: str) -> dict:
    path = _case_path(case_id)
    if not path.exists():
        raise NotFoundError("실패 사례를 찾을 수 없습니다", detail={"case_id": case_id})
    return _read_json(path)


def _require_case(case_id: str) -> dict:
    """gen·regression prepare 전용 — 부재는 422(설계 §4.22 ② "실재 검증(부재 422)")."""
    path = _case_path(case_id)
    if not path.exists():
        raise ValidationAppError("존재하지 않는 실패 사례가 포함되어 있습니다", detail={"case_id": case_id})
    return _read_json(path)


def delete_case(case_id: str) -> None:
    path = _case_path(case_id)
    if not path.exists():
        raise NotFoundError("실패 사례를 찾을 수 없습니다", detail={"case_id": case_id})
    path.unlink()
    _case_output_path(case_id).unlink(missing_ok=True)


def append_regression(case_id: str, *, reg_id: str, outcome: str) -> None:
    try:
        record = get_case_or_404(case_id)
    except NotFoundError:
        return
    record.setdefault("regressions", []).append(
        {"reg_id": reg_id, "run_at": dt.datetime.now().isoformat(), "outcome": outcome}
    )
    _write_json(_case_path(case_id), record)


def case_summary_dict(record: dict) -> dict:
    """cases 목록·상세 공용 응답 변환 — 프론트가 목록·상세에 같은 타입(`ImproveCaseItem`)을
    쓰므로(§4.22 ①) 목록도 `detail`·`preview_ref`·`regressions`를 전부 채워 돌려준다.
    원문(LLM 산출물)만 `has_llm_output` bool로 대체하고 절대 노출하지 않는다."""
    out = dict(record)
    out["has_llm_output"] = bool(record.get("llm_output_path"))
    out.pop("llm_output_path", None)  # 원문 미노출(로그 전용) — 있다는 사실만 bool로
    out["detail"] = record.get("detail") or {}
    out["preview_ref"] = record.get("preview_ref")
    out["regressions"] = record.get("regressions") or []
    return out


case_detail_dict = case_summary_dict


# ---------------------------------------------------------------------------
# 정책 잠금 검증 · 헝크 적용 (순수 함수 — ②의 사전 시뮬레이션과 ③의 apply가 공유)
# ---------------------------------------------------------------------------
def extract_lock_regions(text: str) -> List[str]:
    """`<!-- policy-lock:start -->`~`<!-- policy-lock:end -->` 구간의 내부 텍스트를 순서대로
    반환한다. 마커 쌍이 어긋나면(start만 있거나 순서가 뒤바뀌면) ValueError."""
    tokens = [(m.start(), m.end(), m.group(1)) for m in _MARKER_RE.finditer(text)]
    regions: List[str] = []
    i = 0
    while i < len(tokens):
        start_pos, start_end, kind = tokens[i]
        if kind != "start":
            raise ValueError("policy-lock 마커 순서가 올바르지 않습니다(end가 먼저 나옴)")
        if i + 1 >= len(tokens) or tokens[i + 1][2] != "end":
            raise ValueError("policy-lock 마커 쌍이 맞지 않습니다(start에 대응하는 end 없음)")
        end_pos = tokens[i + 1][0]
        regions.append(text[start_end:end_pos])
        i += 2
    return regions


def check_policy_lock(original_text: str, new_text: str) -> bool:
    """적용 결과에서 잠금 구간의 개수·순서·내용 바이트가 원본과 동일한가(설계 §4.22 결정 ⑦).
    마커 쌍 자체가 깨졌으면(개수 불일치 포함) False."""
    try:
        return extract_lock_regions(original_text) == extract_lock_regions(new_text)
    except ValueError:
        return False


def apply_hunks(text: str, hunks: Sequence[dict]) -> Tuple[Optional[str], Optional[str]]:
    """치환 헝크 순차 적용(unified diff 파서 불도입 — 설계 §4.22 결정 ⑦). 각 `before`는
    현재 텍스트에 **정확히 1회** 등장해야 한다(0회·2회+는 `hunk_unappliable`).
    반환: (적용 결과 | None, 실패 사유 | None)."""
    current = text
    for hunk in hunks:
        if not isinstance(hunk, dict):
            return None, "hunk_unappliable"
        before = hunk.get("before")
        after = hunk.get("after")
        if not isinstance(before, str) or not before or not isinstance(after, str):
            return None, "hunk_unappliable"
        if current.count(before) != 1:
            return None, "hunk_unappliable"
        current = current.replace(before, after, 1)
    return current, None


# ---------------------------------------------------------------------------
# 제안 검증 게이트 (순수 함수 — 단위 테스트 대상, 설계 §4.22 ②-3)
# ---------------------------------------------------------------------------
def validate_proposals(
    raw_proposals: Sequence[Any], allowed_case_ids: Sequence[str]
) -> Tuple[List[dict], Dict[str, int]]:
    """생성 잡 LLM 출력 `proposals[]` → (통과분, 사유별 폐기 건수). DB·파일 IO 없음(순수)."""
    allowed = set(allowed_case_ids)
    passed: List[dict] = []
    discard_counts: Dict[str, int] = defaultdict(int)
    convert_md_text = CONVERT_PROMPT_PATH.read_text(encoding="utf-8") if CONVERT_PROMPT_PATH.exists() else ""

    for raw in raw_proposals:
        if not isinstance(raw, dict):
            discard_counts["invalid_kind"] += 1
            continue
        kind = raw.get("kind")
        if kind not in PROPOSAL_KIND_WHITELIST:
            discard_counts["invalid_kind"] += 1
            continue

        case_ids = raw.get("case_ids")
        if (
            not isinstance(case_ids, list)
            or not case_ids
            or not all(isinstance(c, str) for c in case_ids)
            or not set(case_ids) <= allowed
        ):
            discard_counts["bad_case_ref"] += 1
            continue

        title = raw.get("title")
        if not isinstance(title, str) or not title.strip():
            discard_counts["empty_payload"] += 1
            continue
        rationale = raw.get("rationale")
        rationale = rationale.strip() if isinstance(rationale, str) else ""

        payload = raw.get("payload")
        if not isinstance(payload, dict) or not payload:
            discard_counts["empty_payload"] += 1
            continue

        if kind == "casebook":
            entry = payload.get("entry_markdown")
            if not isinstance(entry, str) or not entry.strip():
                discard_counts["empty_payload"] += 1
                continue
        elif kind == "prompt_edit":
            hunks = payload.get("hunks")
            if not isinstance(hunks, list) or not hunks:
                discard_counts["empty_payload"] += 1
                continue
            applied, reason = apply_hunks(convert_md_text, hunks)
            if applied is None:
                discard_counts[reason or "hunk_unappliable"] += 1
                continue
            if not check_policy_lock(convert_md_text, applied):
                discard_counts["policy_locked"] += 1
                continue
        else:  # code_issue
            repro = payload.get("repro_markdown")
            if not isinstance(repro, str) or not repro.strip():
                discard_counts["empty_payload"] += 1
                continue

        passed.append(
            {
                "kind": kind,
                "title": title.strip(),
                "rationale": rationale,
                "case_ids": case_ids,
                "payload": payload,
            }
        )

    return passed, dict(discard_counts)


# ---------------------------------------------------------------------------
# 제안 저장 (통과분 → improve/proposals/{pr_hex6}.json, status='pending')
# ---------------------------------------------------------------------------
def _save_proposal(proposal: dict) -> str:
    _ensure_dirs()
    proposal_id = f"pr_{uuid.uuid4().hex[:6]}"
    now = dt.datetime.now().isoformat()
    record = {
        "proposal_id": proposal_id,
        "kind": proposal["kind"],
        "title": proposal["title"],
        "rationale": proposal["rationale"],
        "case_ids": proposal["case_ids"],
        "payload": proposal["payload"],
        "status": "pending",
        "created_at": now,
        "decided_at": None,
    }
    _write_json(_proposal_path(proposal_id), record)
    return proposal_id


def save_proposals(passed: Sequence[dict]) -> List[str]:
    ids = [_save_proposal(p) for p in passed]
    _prune_proposals()
    return ids


# ---------------------------------------------------------------------------
# 제안함 조회·승인·거절 (proposals 4 엔드포인트, 설계 §4.22 ③)
# ---------------------------------------------------------------------------
def list_proposals(status: Optional[str], page: int, size: int) -> Tuple[List[dict], int]:
    records = _load_records(_list_proposal_files())
    if status:
        records = [r for r in records if r.get("status") == status]
    records.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    total = len(records)
    start = (page - 1) * size
    return records[start : start + size], total


def get_proposal_or_404(proposal_id: str) -> dict:
    path = _proposal_path(proposal_id)
    if not path.exists():
        raise NotFoundError("제안을 찾을 수 없습니다", detail={"proposal_id": proposal_id})
    return _read_json(path)


def build_proposal_detail(record: dict) -> dict:
    """상세 조회 — 적용 미리보기 서버 합성(설계 §4.22 ③, apply 없이 조회만).

    casebook·code_issue는 `payload`(entry_markdown·repro_markdown)가 이미 상세 재료
    그대로다 — 추가 합성이 필요 없다. **prompt_edit만** `preview_after`(적용 후 전문)·
    `policy_check`('ok'|'violation')를 최상위에 추가한다(프론트 `ImproveProposalDetail`
    계약 — 중첩 없이 평평한 구조)."""
    detail = dict(record)
    kind = record["kind"]
    payload = record.get("payload") or {}

    detail["preview_after"] = None
    detail["policy_check"] = None
    if kind == "prompt_edit":
        convert_md_text = CONVERT_PROMPT_PATH.read_text(encoding="utf-8") if CONVERT_PROMPT_PATH.exists() else ""
        applied, _reason = apply_hunks(convert_md_text, payload.get("hunks") or [])
        policy_ok = applied is not None and check_policy_lock(convert_md_text, applied)
        detail["preview_after"] = applied
        detail["policy_check"] = "ok" if policy_ok else "violation"
    return detail


def apply_proposal(proposal_id: str) -> dict:
    """승인 반영 — **이 기능의 유일한 파일 쓰기 경로**(설계 §4.22 ③)."""
    record = get_proposal_or_404(proposal_id)
    if record["status"] != "pending":
        raise ConflictError("이미 처리된 제안입니다", detail={"status": record["status"]})

    kind = record["kind"]
    payload = record.get("payload") or {}
    result: dict

    if kind == "casebook":
        entry_md = (payload.get("entry_markdown") or "").strip()
        header = f"## 사례 {', '.join(record['case_ids'])}: {record['title']}"
        existing = CASEBOOK_PATH.read_text(encoding="utf-8") if CASEBOOK_PATH.exists() else ""
        addition = f"\n\n{header}\n\n{entry_md}\n"
        new_text = existing + addition
        if len(new_text) > CASEBOOK_MAX_CHARS:
            raise ValidationAppError(
                f"사례집이 상한({CASEBOOK_MAX_CHARS}자)을 넘습니다 — git에서 직접 정리하세요",
                detail={"chars": len(new_text), "limit": CASEBOOK_MAX_CHARS},
            )
        PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
        CASEBOOK_PATH.write_text(new_text, encoding="utf-8")
        result = {"appended_chars": len(addition), "total_chars": len(new_text)}

    elif kind == "prompt_edit":
        convert_md_text = CONVERT_PROMPT_PATH.read_text(encoding="utf-8") if CONVERT_PROMPT_PATH.exists() else ""
        applied, reason = apply_hunks(convert_md_text, payload.get("hunks") or [])
        if applied is None:
            raise ConflictError(
                "프롬프트 본문이 변경되었습니다 — 제안을 다시 생성하세요", detail={"reason": reason}
            )
        if not check_policy_lock(convert_md_text, applied):
            raise ValidationAppError(
                "정책 잠금 구간을 변경하는 제안은 반영할 수 없습니다", detail={"proposal_id": proposal_id}
            )
        CONVERT_PROMPT_PATH.write_text(applied, encoding="utf-8")
        result = {"applied_chars": len(applied)}

    else:  # code_issue — 파일 쓰기 0, 상태 전환만(인계 완료)
        result = {"acknowledged": True}

    record["status"] = "acknowledged" if kind == "code_issue" else "applied"
    record["decided_at"] = dt.datetime.now().isoformat()
    _write_json(_proposal_path(proposal_id), record)
    return {"applied": True, "kind": kind, "result": result}


def reject_proposal(proposal_id: str) -> dict:
    record = get_proposal_or_404(proposal_id)
    if record["status"] != "pending":
        raise ConflictError("이미 처리된 제안입니다", detail={"status": record["status"]})
    record["status"] = "rejected"
    record["decided_at"] = dt.datetime.now().isoformat()
    _write_json(_proposal_path(proposal_id), record)
    return {"status": "rejected"}


# ---------------------------------------------------------------------------
# 사례집 주입 (convert 변환 프롬프트 조립 공통 경로 1곳 — convert_service가 호출)
# ---------------------------------------------------------------------------
def load_convert_prompt_with_casebook() -> str:
    """`convert.md` 전문 + (사례집이 있고 비어있지 않으면) "부속 사례집" 섹션 +
    (taxonomy.md가 있고 비어있지 않으면) "부속 분류 정책" 섹션 첨부.
    convert·fetch 공통 — 호출부가 각자 다시 읽지 않는다(중복 구현 금지)."""
    convert_md = CONVERT_PROMPT_PATH.read_text(encoding="utf-8") if CONVERT_PROMPT_PATH.exists() else ""
    if CASEBOOK_PATH.exists():
        casebook = CASEBOOK_PATH.read_text(encoding="utf-8").strip()
        if casebook:
            convert_md = f"{convert_md}\n\n---\n\n## 부속 사례집\n\n{casebook}\n"
    # B4-S2/S3(설계 §4.11 추기) — taxonomy.md(분류 정책 단일 출처)를 케이스북과 같은
    # 방식으로 첨부한다. 개별 반입의 `category_path` 고정 지시(있으면)는
    # `_category_directive_lines`가 이 정책보다 우선한다고 명시한다(§4.11 결정 ⑤).
    if TAXONOMY_PATH.exists():
        taxonomy = TAXONOMY_PATH.read_text(encoding="utf-8").strip()
        if taxonomy:
            convert_md = f"{convert_md}\n\n---\n\n## 부속 분류 정책\n\n{taxonomy}\n"
    return convert_md


# ---------------------------------------------------------------------------
# 제안 생성 — prepare(LLM 0) (설계 §4.22 ②-1)
# ---------------------------------------------------------------------------
_GEN_INSTRUCTIONS = """너는 Study Hub 반입 파이프라인의 개선 보조자다. 아래 실패 사례들을 분석해
재발을 줄이는 개선 제안을 만들어라. 제안은 절대 스스로 반영되지 않는다 — 사람이 검토 후
승인해야만 반영된다.

## 규칙(엄수)
- 제안 kind는 반드시 casebook(사례집 추가) | prompt_edit(본문 프롬프트 부분 수정) |
  code_issue(코드 결함으로 보임 — 재현 패키지만) 중 하나다.
- casebook: 실패 유형별 **처리 예시(few-shot)**만 담아라. 정책 문장(새 규칙 선언)을
  넣지 마라 — 예시는 본문 규칙을 보충할 뿐 규칙을 만들 수 없다.
- prompt_edit: 반드시 payload.hunks(치환 전/후 쌍) 형태로 제안하라. 각 hunk의 "before"는
  본문에 정확히 그대로 등장하는 문자열이어야 한다(대략적 요약 금지). **`<!-- policy-lock:start -->`
  와 `<!-- policy-lock:end -->` 사이(잠금 구간)는 절대 건드리지 마라** — 정책 문장을
  완화·삭제·재작성하는 어떤 제안도 서버가 자동 폐기한다.
- code_issue: 코드 자체의 결함으로 보이면 고치려 하지 말고 재현 패키지(원본 참조·실패
  기록·기대 동작)만 서술하라.
- 근거가 부족하면 제안하지 마라(개수를 억지로 채우지 마라) — 빈 배열도 정답이다.

## 출력 형식(엄수)
코드펜스·설명 문장 없이, 순수 JSON 객체 하나만 출력하라:
{"proposals": [{"kind": "casebook"|"prompt_edit"|"code_issue", "title": "...",
"rationale": "...", "case_ids": ["fc_xxxxxx", ...], "payload": {...}}]}
- casebook payload: {"entry_markdown": "..."}
- prompt_edit payload: {"hunks": [{"before": "...", "after": "..."}]}
- code_issue payload: {"repro_markdown": "..."}
"""


def _case_input_section(record: dict) -> str:
    lines = [f"## 실패 사례 {record['case_id']} (kind={record['kind']}, origin={record['origin']})"]
    lines.append(f"발생 횟수: {record.get('count', 1)}회, 최근: {record.get('last_seen_at')}")
    lines.append("detail: " + json.dumps(record.get("detail") or {}, ensure_ascii=False))

    source = record.get("source") or {}
    hash12 = source.get("hash12")
    if hash12:
        data = preview_store.read_source_bytes(hash12)
        text = source_match.extract_source_text(source.get("filename"), data) if data else None
        if text:
            lines.append("### 원본 발췌")
            lines.append(text[:SOURCE_EXCERPT_CHARS])

    output_path = record.get("llm_output_path")
    if output_path:
        p = CASES_DIR / output_path
        if p.exists():
            try:
                lines.append("### LLM 산출물 원문(당시 실패 응답)")
                lines.append(p.read_text(encoding="utf-8")[:OUTPUT_EXCERPT_CHARS])
            except OSError:
                pass
    return "\n\n".join(lines)


def _build_gen_prompt(case_ids: Sequence[str]) -> Tuple[str, List[dict]]:
    case_records = [_require_case(cid) for cid in case_ids]

    convert_md = CONVERT_PROMPT_PATH.read_text(encoding="utf-8") if CONVERT_PROMPT_PATH.exists() else ""
    casebook = CASEBOOK_PATH.read_text(encoding="utf-8") if CASEBOOK_PATH.exists() else ""

    parts = [
        _GEN_INSTRUCTIONS,
        "---",
        "## 현재 convert.md 전문",
        convert_md,
        "## 현재 convert.cases.md 전문",
        casebook.strip() or "(비어 있음)",
    ]
    parts.extend(_case_input_section(r) for r in case_records)
    parts.append("최종 출력은 설명 문장·코드펜스 없이 순수 JSON 객체 하나만.")
    return "\n\n".join(parts), case_records


def _estimate_usage(total_chars: int, *, assumed: bool = False) -> dict:
    """`fetch_service.estimate_usage`·`answer_key_service._estimate_usage` 필드 관례
    (chars/1.5 보정) — approx_input_tokens·assumed."""
    return {"approx_input_tokens": max(int(total_chars / 1.5), 1), "assumed": assumed}


def _purge_gen() -> None:
    now = dt.datetime.now()
    with _GENS_LOCK:
        stale = [gid for gid, state in _GENS.items() if now - state["created_at"] > GEN_TTL]
        for gid in stale:
            _GENS.pop(gid, None)


def _get_gen_or_404(gen_id: str) -> dict:
    _purge_gen()
    with _GENS_LOCK:
        state = _GENS.get(gen_id)
    if state is None:
        raise NotFoundError(
            "제안 생성 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"gen_id": gen_id}
        )
    return state


def prepare_gen(case_ids: Sequence[str]) -> dict:
    _purge_gen()
    if not case_ids or not (1 <= len(case_ids) <= GEN_MAX_CASES):
        raise ValidationAppError(
            f"사례는 1~{GEN_MAX_CASES}건 선택해야 합니다", detail={"count": len(case_ids), "max": GEN_MAX_CASES}
        )
    seen: List[str] = []
    for cid in case_ids:
        if cid not in seen:
            seen.append(cid)

    prompt, _records = _build_gen_prompt(seen)  # 부재 사례는 여기서 422
    total_chars = len(prompt)
    if total_chars > GEN_MAX_CONTEXT_CHARS:
        raise ValidationAppError(
            f"선택한 사례의 입력이 너무 큽니다(약 {total_chars}자 — 상한 {GEN_MAX_CONTEXT_CHARS}자). "
            "사례 수를 줄여 주세요",
            detail={"chars": total_chars, "limit": GEN_MAX_CONTEXT_CHARS},
        )
    estimate = _estimate_usage(total_chars)

    gen_id = f"gp_{uuid.uuid4().hex[:8]}"
    with _GENS_LOCK:
        _GENS[gen_id] = {
            "created_at": dt.datetime.now(),
            "case_ids": seen,
            "prompt": prompt,
            "estimate": estimate,
            "job_id": None,
        }
    return {"gen_id": gen_id, "case_count": len(seen), "estimate": estimate}


def start_generation(db, gen_id: str, *, engine: str = "auto", model: Optional[str] = None) -> str:
    from services import convert_service  # 지연 import — 순환 회피(applied_exam_service 전례)

    state = _get_gen_or_404(gen_id)
    existing_job_id = state.get("job_id")
    if existing_job_id is not None:
        try:
            existing_job = convert_service.get_improve_proposal_job(gen_id, existing_job_id)
        except NotFoundError:
            existing_job = None
        if existing_job is not None and existing_job["status"] == "running":
            raise ConflictError("이미 제안 생성이 진행 중입니다", detail={"job_id": existing_job_id})

    job_id = convert_service.start_improve_proposal_job(
        db, gen_id=gen_id, prompt=state["prompt"], case_ids=state["case_ids"], engine=engine, model=model
    )
    with _GENS_LOCK:
        current = _GENS.get(gen_id)
        if current is not None:
            current["job_id"] = job_id
    return job_id


def get_gen_status(gen_id: str) -> dict:
    from services import convert_service

    state = _get_gen_or_404(gen_id)
    job_id = state.get("job_id")
    if job_id is None:
        return {"gen_id": gen_id, "status": "prepared"}

    job = convert_service.get_improve_proposal_job(gen_id, job_id)
    return {
        "gen_id": gen_id,
        "status": job["status"],
        "error": job.get("error"),
        "error_info": job.get("error_info"),
        "progress": job.get("progress"),
        "result": job.get("result"),
    }


# ---------------------------------------------------------------------------
# 회귀 재검증 — prepare(LLM 0) (설계 §4.22 ④-1)
# ---------------------------------------------------------------------------
def _purge_reg() -> None:
    now = dt.datetime.now()
    with _REGS_LOCK:
        stale = [rid for rid, state in _REGS.items() if now - state["created_at"] > REG_TTL]
        for rid in stale:
            _REGS.pop(rid, None)


def _get_reg_or_404(reg_id: str) -> dict:
    _purge_reg()
    with _REGS_LOCK:
        state = _REGS.get(reg_id)
    if state is None:
        raise NotFoundError(
            "회귀 재검증 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"reg_id": reg_id}
        )
    return state


def prepare_regression(case_ids: Sequence[str]) -> dict:
    _purge_reg()
    if not case_ids or not (1 <= len(case_ids) <= REG_MAX_CASES):
        raise ValidationAppError(
            f"사례는 1~{REG_MAX_CASES}건 선택해야 합니다", detail={"count": len(case_ids), "max": REG_MAX_CASES}
        )
    seen: List[str] = []
    for cid in case_ids:
        if cid not in seen:
            seen.append(cid)

    records = [_require_case(cid) for cid in seen]
    if any(r.get("kind") == "user_report" for r in records):
        raise ValidationAppError(
            "신고 사례는 자동 회귀 판정 대상이 아닙니다", detail={"case_ids": seen}
        )

    # 보수 계상(§4.22 ④-1) — 판별·파서 단계에서 끝나 LLM에 도달하지 않을 사례도 포함해
    # 원본 바이트 크기 합계를 그대로 쓴다(assumed=True).
    total_bytes = 0
    for r in records:
        hash12 = (r.get("source") or {}).get("hash12")
        data = preview_store.read_source_bytes(hash12) if hash12 else None
        if data:
            total_bytes += len(data)
    estimate = _estimate_usage(total_bytes, assumed=True)

    reg_id = f"rg_{uuid.uuid4().hex[:8]}"
    with _REGS_LOCK:
        _REGS[reg_id] = {
            "created_at": dt.datetime.now(),
            "case_ids": seen,
            "estimate": estimate,
            "job_id": None,
        }
    return {"reg_id": reg_id, "case_count": len(seen), "estimate": estimate}


def start_regression(db, reg_id: str, *, engine: str = "auto", model: Optional[str] = None) -> str:
    from services import convert_service

    state = _get_reg_or_404(reg_id)
    existing_job_id = state.get("job_id")
    if existing_job_id is not None:
        try:
            existing_job = convert_service.get_improve_regression_job(reg_id, existing_job_id)
        except NotFoundError:
            existing_job = None
        if existing_job is not None and existing_job["status"] == "running":
            raise ConflictError("이미 회귀 재검증이 진행 중입니다", detail={"job_id": existing_job_id})

    job_id = convert_service.start_improve_regression_job(
        db, reg_id=reg_id, case_ids=state["case_ids"], engine=engine, model=model
    )
    with _REGS_LOCK:
        current = _REGS.get(reg_id)
        if current is not None:
            current["job_id"] = job_id
    return job_id


def get_reg_status(reg_id: str) -> dict:
    from services import convert_service

    state = _get_reg_or_404(reg_id)
    job_id = state.get("job_id")
    if job_id is None:
        return {"reg_id": reg_id, "status": "prepared", "results": []}

    job = convert_service.get_improve_regression_job(reg_id, job_id)
    result = job.get("result") or {}
    return {
        "reg_id": reg_id,
        "status": job["status"],
        "error": job.get("error"),
        "error_info": job.get("error_info"),
        "progress": job.get("progress"),
        "results": result.get("results", []),
    }
