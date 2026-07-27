"""사이트 어댑터 반입 서비스 (F35-2, 설계 §4.13).

어댑터 목록 · 자격증 검색(병합) · 회차 목록 · estimate 산출 · `imported` 파생을 담당한다.
실제 수집·LLM 정리는 convert 잡 큐(kind='fetch')가 수행한다.

**S13 — 단일 어댑터화**: 등록 어댑터가 qnet 하나뿐이라 어댑터 간 병합·우선순위 채택·
대안 어댑터 재시도는 없다(사설 사이트 어댑터 제거 — 계획서 §14 F35-2 "제거 이력"). `also_on`은
항상 빈 배열, `refs`는 단일 항목으로 **응답 필드 형태는 유지**한다(설계 §4.13 "회차 목록
구성 — S13 재작성", 프론트 계약 불변).

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
# 회차 목록 (S13 — 단일 어댑터 항목화 · imported · estimate)
# ---------------------------------------------------------------------------
_ROUND_KEY_RE = re.compile(r"^\d{4}-\d+$")  # 'YYYY-N' — 회차 번호 보유 키
_DATE_KEY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")  # 'YYYY-MM-DD' — 날짜형 키


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


def _sort_key(entry: ExamEntry) -> Tuple[int, int, int]:
    """정렬 키 — `exam_date`가 있으면 그 날짜, 없으면 `exam_key`에서 파생한
    (연도, 월=0, 회차) 튜플. `YYYY-N`·`YYYY-MM-DD` 문자열이 섞여 있으면 그대로
    문자열 정렬해선 시간순이 아니므로(예: '2016-2' > '2016-10-01' 문자열 비교) 항상
    수치 튜플로 비교한다."""
    candidate = entry.exam_date or entry.exam_key
    if candidate and _DATE_KEY_RE.fullmatch(candidate):
        year, month, day = candidate.split("-")
        return (int(year), int(month), int(day))
    if entry.exam_key and _ROUND_KEY_RE.fullmatch(entry.exam_key):
        year, num = entry.exam_key.split("-", 1)
        return (int(year), 0, int(num))
    return (0, 0, 0)


def list_exams(db: Session, sources: List[dict]) -> List[dict]:
    if not sources:
        raise ValidationAppError("sources가 비어 있습니다")

    client = registry.new_client()
    out: List[Tuple[Tuple[int, int, int], dict]] = []

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
            out.append(
                (
                    _sort_key(entry),
                    {
                        "exam_key": entry.exam_key,
                        "label": entry.label,
                        "adapter": adapter_id,
                        "cert_ref": cert_ref,
                        "exam_ref": entry.exam_ref,
                        # 단일 어댑터 계약 — 프론트 렌더 코드 불변을 위해 필드는 유지
                        # (설계 §4.13, S13). 병합·대안 어댑터가 없어 refs는 항상 1건,
                        # also_on은 항상 빈 배열.
                        "refs": {adapter_id: entry.exam_ref},
                        "also_on": [],
                        "question_count": entry.question_count,
                        "imported": _is_imported(db, entry.cert_name, entry.level_hint, entry.exam_key),
                        "estimate": estimate_usage(entry.question_count),
                    },
                )
            )
    # 최신 회차 우선 정렬 — 수치 (연도, 월, 일/회차) 튜플로 비교(문자열 정렬은 'YYYY-N'·
    # 'YYYY-MM-DD' 혼재 시 시간순이 아니다).
    out.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _key, item in out]
