"""사이트 어댑터 반입 서비스 (F35-2, 설계 §4.13).

어댑터 목록 · 자격증 검색(병합) · 회차 목록(병합·큐넷 우선·also_on) · estimate 산출 ·
`imported` 파생을 담당한다. 실제 수집·LLM 정리는 convert 잡 큐(kind='fetch')가 수행한다.

**새 테이블·컬럼 없음** — 회차 메타는 categories·sources 재사용, 전부 파생/캐시값이다.
"""
from __future__ import annotations

import re
import threading
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from exceptions import ValidationAppError
from services import import_service
from services.fetchers import registry
from services.fetchers.base import CertRef, ExamEntry, ParseFailedError

# 문항당 평균 입력 토큰 이동 평균 표본(설계 §4.13.6) — 표본 없으면 600 가정.
DEFAULT_TOKENS_PER_QUESTION = 600
DEFAULT_ASSUMED_QUESTIONS = 60  # 목록에서 문항 수 미상 시 가정
_TPQ_LOCK = threading.Lock()
_TPQ_SAMPLES: List[float] = []
_TPQ_MAX = 20


def record_tokens_per_question(input_tokens: int, question_count: int) -> None:
    """완료된 convert(fetch) 잡의 (문항당 토큰) 표본 기록 — estimate 이동 평균용."""
    if input_tokens <= 0 or question_count <= 0:
        return
    with _TPQ_LOCK:
        _TPQ_SAMPLES.append(input_tokens / question_count)
        if len(_TPQ_SAMPLES) > _TPQ_MAX:
            _TPQ_SAMPLES.pop(0)


def _avg_tokens_per_question() -> Tuple[int, bool]:
    with _TPQ_LOCK:
        samples = list(_TPQ_SAMPLES)
    if not samples:
        return DEFAULT_TOKENS_PER_QUESTION, True
    return int(sum(samples) / len(samples)), False


def estimate_usage(question_count: Optional[int]) -> dict:
    """예상 LLM 사용량(설계 §4.13.6). question_count 미상이면 60 가정(assumed=True)."""
    assumed_count = question_count is None or question_count <= 0
    q = DEFAULT_ASSUMED_QUESTIONS if assumed_count else int(question_count)
    per, per_assumed = _avg_tokens_per_question()
    return {
        "questions_assumed": q,
        "approx_input_tokens": q * per,
        "assumed": bool(assumed_count or per_assumed),
    }


# ---------------------------------------------------------------------------
# 어댑터 목록
# ---------------------------------------------------------------------------
def list_adapters() -> List[dict]:
    client = registry.new_client()
    out: List[dict] = []
    for adapter in registry.get_adapters():
        try:
            available, notice_override = adapter.is_available(client)
        except Exception:  # noqa: BLE001
            available, notice_override = False, "접속 상태를 확인할 수 없습니다"
        out.append(
            {
                "id": adapter.id,
                "name": adapter.name,
                "priority": adapter.priority,
                "available": available,
                "notice": notice_override or adapter.notice,
            }
        )
    return out


# ---------------------------------------------------------------------------
# 자격증 검색 (등록 어댑터 병합 — 정규화 이름 기준)
# ---------------------------------------------------------------------------
def _normalize_name(name: str) -> str:
    return "".join(name.split()).lower()


def search_certs(query: str) -> List[dict]:
    query = (query or "").strip()
    cache_key = f"certs:{_normalize_name(query)}"
    cached = registry.cache_get(cache_key)
    if cached is not None:
        return cached

    client = registry.new_client()
    merged: Dict[str, dict] = {}
    for adapter in registry.get_adapters():
        try:
            available, _ = adapter.is_available(client)
            if not available:
                continue
            results = adapter.search_certs(query, client)
        except ParseFailedError:
            continue
        except Exception:  # noqa: BLE001 - 한 어댑터 실패가 전체를 막지 않는다
            continue
        for cert in results:
            key = _normalize_name(cert.name)
            entry = merged.setdefault(key, {"name": cert.name, "sources": []})
            if not any(s["adapter"] == adapter.id for s in entry["sources"]):
                entry["sources"].append({"adapter": adapter.id, "cert_ref": cert.cert_ref})

    out = sorted(merged.values(), key=lambda e: e["name"])
    registry.cache_set(cache_key, out)
    return out


# ---------------------------------------------------------------------------
# 회차 목록 (병합 · 우선순위 채택 · also_on · imported · estimate)
# ---------------------------------------------------------------------------
_ROUND_KEY_RE = re.compile(r"^\d{4}-\d+$")  # 'YYYY-N' — 회차 번호 보유 키
_DATE_KEY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")  # 'YYYY-MM-DD' — 날짜형 키(S12)


def exam_folder_name(exam_key: str) -> Optional[str]:
    """키→분류 폴더명 단일 파생 함수(설계 §4.13 — `_is_imported`와 convert
    `_fetch_category_path`가 공유, 불일치 금지). 'YYYY-N' → 'YYYY년 N회',
    'YYYY-MM-DD' → 'YYYY년 M월 D일'(앞자리 0 제거). 파싱 불가면 None."""
    if not exam_key:
        return None
    if _DATE_KEY_RE.fullmatch(exam_key):
        year, month, day = exam_key.split("-")
        return f"{year}년 {int(month)}월 {int(day)}일"
    if _ROUND_KEY_RE.fullmatch(exam_key):
        year, num = exam_key.split("-", 1)
        return f"{year}년 {num}회"
    return None


def _is_imported(db: Session, cert_name: str, level_hint: str, exam_key: str) -> bool:
    folder = exam_folder_name(exam_key)
    if not folder or not cert_name:
        return False
    path = f"{cert_name}/{level_hint}/{folder}"
    _cid, exists = import_service._resolve_category_path(db, path)
    return exists


def _group_key(entry: ExamEntry) -> str:
    """병합 그룹 키(S12) — ① exam_date 보유 항목끼리는 날짜로 병합(cbtbank 라벨엔 회차
    번호가 없다), ② 없으면 기존 `exam_key` 그대로 병합(하위 호환, qnet 등)."""
    if entry.exam_date:
        return f"date:{entry.exam_date}"
    return f"key:{entry.exam_key}"


def _representative_exam_key(per_adapter: Dict[str, ExamEntry], adapter_priority: Dict[str, int]) -> str:
    """대표 exam_key(설계 §4.13) — 그룹 내 회차 번호 보유 키(`YYYY-N`) 우선 채택
    (분류 경로 "YYYY년 N회" 유지), 없으면 날짜형(`YYYY-MM-DD`).

    회차 번호 보유 어댑터가 여럿이면 **priority 최소(채택) 어댑터의 키**를 결정적으로
    고른다 — `dict` 삽입 순서(=`sources` 요청 순서)에 의존하지 않는다(경검 4)."""
    round_items = [
        (aid, e.exam_key) for aid, e in per_adapter.items() if _ROUND_KEY_RE.fullmatch(e.exam_key or "")
    ]
    if round_items:
        round_items.sort(key=lambda t: adapter_priority.get(t[0], 99))
        return round_items[0][1]
    date_keys = [e.exam_date for e in per_adapter.values() if e.exam_date]
    if date_keys:
        return date_keys[0]
    return next(iter(per_adapter.values())).exam_key


def _group_sort_key(per_adapter: Dict[str, ExamEntry], exam_key: str) -> Tuple[int, int, int]:
    """정렬 키(경검 1) — 그룹에 `exam_date`가 있으면 그 날짜, 없으면 대표 `exam_key`에서
    파생한 (연도, 월=0, 회차) 튜플. `YYYY-N`·`YYYY-MM-DD` 문자열이 섞여 있으면 그대로
    문자열 정렬해선 시간순이 아니므로(예: '2016-2' > '2016-10-01' 문자열 비교) 항상
    수치 튜플로 비교한다."""
    date_val = next((e.exam_date for e in per_adapter.values() if e.exam_date), None)
    candidate = date_val or exam_key
    if candidate and _DATE_KEY_RE.fullmatch(candidate):
        year, month, day = candidate.split("-")
        return (int(year), int(month), int(day))
    if exam_key and _ROUND_KEY_RE.fullmatch(exam_key):
        year, num = exam_key.split("-", 1)
        return (int(year), 0, int(num))
    return (0, 0, 0)


def list_exams(db: Session, sources: List[dict]) -> List[dict]:
    if not sources:
        raise ValidationAppError("sources가 비어 있습니다")

    client = registry.new_client()
    # 병합 그룹 키 → {adapter_id → ExamEntry}
    by_group: Dict[str, Dict[str, ExamEntry]] = {}
    adapter_priority = {a.id: a.priority for a in registry.get_adapters()}

    for src in sources:
        if not isinstance(src, dict):
            continue
        adapter_id = src.get("adapter")
        cert_ref = src.get("cert_ref")
        if not adapter_id or not cert_ref:
            continue
        adapter = registry.get_adapter(adapter_id)
        if adapter is None:
            continue
        cache_key = f"exams:{adapter_id}:{cert_ref}"
        entries = registry.cache_get(cache_key)
        if entries is None:
            try:
                entries = adapter.list_exams(cert_ref, client)
            except ParseFailedError:
                entries = []
            except Exception:  # noqa: BLE001
                entries = []
            registry.cache_set(cache_key, entries)
        for entry in entries:
            by_group.setdefault(_group_key(entry), {})[adapter_id] = entry

    out: List[Tuple[Tuple[int, int, int], dict]] = []
    for _group_key_val, per_adapter in by_group.items():
        # 채택 = priority 최소(qnet > cbtbank > comcbt), 나머지는 also_on
        chosen_id = min(per_adapter, key=lambda aid: adapter_priority.get(aid, 99))
        chosen = per_adapter[chosen_id]
        also_on = sorted(aid for aid in per_adapter if aid != chosen_id)
        # 대안 어댑터 재시도용 — 회차가 존재하는 모든 어댑터의 exam_ref 맵(하위 호환:
        # 최상위 exam_ref == refs[adapter]). 프론트가 [다른 어댑터로 재시도] 시 refs에서
        # 올바른 exam_ref를 골라 보낸다(잘못된 참조 전송 방지 — 설계 §4.13).
        refs = {aid: entry.exam_ref for aid, entry in per_adapter.items()}
        exam_key = _representative_exam_key(per_adapter, adapter_priority)
        sort_key = _group_sort_key(per_adapter, exam_key)
        out.append(
            (
                sort_key,
                {
                    "exam_key": exam_key,
                    "label": chosen.label,
                    "adapter": chosen_id,
                    "cert_ref": _cert_ref_for(sources, chosen_id),
                    "exam_ref": chosen.exam_ref,
                    "refs": refs,
                    "also_on": also_on,
                    "question_count": chosen.question_count,
                    "imported": _is_imported(db, chosen.cert_name, chosen.level_hint, exam_key),
                    "estimate": estimate_usage(chosen.question_count),
                },
            )
        )
    # 최신 회차 우선 정렬 — 수치 (연도, 월, 일/회차) 튜플로 비교(문자열 정렬은 'YYYY-N'·
    # 'YYYY-MM-DD' 혼재 시 시간순이 아니다, 경검 1).
    out.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _sort_key, item in out]


def _cert_ref_for(sources: List[dict], adapter_id: str) -> Optional[str]:
    for src in sources:
        if isinstance(src, dict) and src.get("adapter") == adapter_id:
            return src.get("cert_ref")
    return None
