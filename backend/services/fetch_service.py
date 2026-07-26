"""사이트 어댑터 반입 서비스 (F35-2, 설계 §4.13).

어댑터 목록 · 자격증 검색(병합) · 회차 목록(병합·큐넷 우선·also_on) · estimate 산출 ·
`imported` 파생을 담당한다. 실제 수집·LLM 정리는 convert 잡 큐(kind='fetch')가 수행한다.

**새 테이블·컬럼 없음** — 회차 메타는 categories·sources 재사용, 전부 파생/캐시값이다.
"""
from __future__ import annotations

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
# 회차 목록 (병합 · 큐넷 우선 · also_on · imported · estimate)
# ---------------------------------------------------------------------------
def _exam_folder_from_key(exam_key: str) -> Optional[str]:
    """'2022-2' → '2022년 2회'. 파싱 불가면 None."""
    if "-" not in exam_key:
        return None
    year, _, num = exam_key.partition("-")
    if not year.isdigit() or not num.isdigit():
        return None
    return f"{year}년 {num}회"


def _is_imported(db: Session, cert_name: str, level_hint: str, exam_key: str) -> bool:
    folder = _exam_folder_from_key(exam_key)
    if not folder or not cert_name:
        return False
    path = f"{cert_name}/{level_hint}/{folder}"
    _cid, exists = import_service._resolve_category_path(db, path)
    return exists


def list_exams(db: Session, sources: List[dict]) -> List[dict]:
    if not sources:
        raise ValidationAppError("sources가 비어 있습니다")

    client = registry.new_client()
    # exam_key → {adapter_id → ExamEntry}
    by_key: Dict[str, Dict[str, ExamEntry]] = {}
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
            by_key.setdefault(entry.exam_key, {})[adapter_id] = entry

    out: List[dict] = []
    for exam_key, per_adapter in by_key.items():
        # 큐넷 우선: priority가 가장 작은(=우선) 어댑터를 채택, 나머지는 also_on
        chosen_id = min(per_adapter, key=lambda aid: adapter_priority.get(aid, 99))
        chosen = per_adapter[chosen_id]
        also_on = sorted(aid for aid in per_adapter if aid != chosen_id)
        # 대안 어댑터 재시도용 — 회차가 존재하는 모든 어댑터의 exam_ref 맵(하위 호환:
        # 최상위 exam_ref == refs[adapter]). 프론트가 [다른 어댑터로 재시도] 시 refs에서
        # 올바른 exam_ref를 골라 보낸다(잘못된 참조 전송 방지 — 설계 §4.13).
        refs = {aid: entry.exam_ref for aid, entry in per_adapter.items()}
        out.append(
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
            }
        )
    # 최신 회차 우선 정렬
    out.sort(key=lambda e: e["exam_key"], reverse=True)
    return out


def _cert_ref_for(sources: List[dict], adapter_id: str) -> Optional[str]:
    for src in sources:
        if isinstance(src, dict) and src.get("adapter") == adapter_id:
            return src.get("cert_ref")
    return None
