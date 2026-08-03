"""대용량 원본 LLM 분할 반입 (S23 — F49, 설계 §4.25).

플로우: 0단계 추출(LLM 0) → 1단계 휴리스틱 구조 분석(무비용·동기, 이 모듈) → 2단계 분할안
제시 + 사용자 확인(프론트) → 3단계 선택 조각의 **기존 convert 잡** N개 투입 → 4단계 조각별
미리보기 승인(기존 preview 경로, 이 모듈 범위 밖). LLM은 정밀 분석(kind `'split_analyze'`,
`convert_service`가 공유 잡 큐로 실행)에서만 개입하며, 그 입력조차 원문 전문이 아니라
경계 후보 오프셋 + 주변 발췌(~200자) + 서두/말미 표본뿐이다(원문 전체 투입은 원리상 불가).

불변 규칙 재확인:
  - 판별·추출·SSRF·MIME은 `convert_service`(§4.18 계층)를 그대로 재사용한다(중복 구현 금지).
    단, 이 모듈은 200,000자 상한을 우회해야 하므로 `_detect_import_format(..., max_chars=...)`
    로 호출한다(기존 호출부는 이 인자를 넘기지 않아 완전 불변 — 이 단계 DoD의 근거).
  - 조각 텍스트는 저장하지 않는다(R18 파생물 정신) — `sources/` 원본 + 오프셋으로 항상
    `원문[start:end]` 결정론 재절단한다. 상태 JSON에는 작은 발췌(head 200자·경계 발췌
    ~200자·서두/말미 표본)만 남긴다 — 전문은 절대 저장하지 않는다.
  - 조각 잡(변환)은 **기존 convert 잡**을 재사용하되 원본을 재저장하지 않는다
    (`convert_service.start_convert_job(skip_source_save=True, ...)`).
  - DDL·Alembic·settings 키 0건 — 저장 지점은 `sources/`(원본 1회)·`import/split/` JSON
    (최근 20건)·인메모리(TTL 1시간)뿐이다.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import math
import re
import threading
import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from database import BASE_DIR
from exceptions import ConflictError, NotFoundError, ValidationAppError
from services import convert_service, doc_extract, import_service, preview_store

_LOGGER = logging.getLogger(__name__)

# --- 상한(설계 §4.25 결정 ㉮~㉰ 확정 — settings 화 안 함, 임의 변경 금지) -----------------
TOTAL_MAX_CHARS = 2_000_000  # ㉯ 원본 총 상한(초과 = 분할 시작 전 422)
MAX_CHUNKS = 40  # ㉰ 조각 수 상한(분할안 산출 결과 초과 = 422·수동 분할 안내)
CHUNK_MAX_CHARS = doc_extract.MAX_TEXT_CHARS  # ㉮ 조각당 상한(200,000 — 기존 상수 재사용)

HEAD_CHARS = 200  # 분할안 조각의 head 발췌 길이
EXCERPT_RADIUS = 100  # 경계 후보 좌우 발췌 반경(총 ~200자) — 정밀 분석 허용 범위이기도 하다
SAMPLE_CHARS = 1000  # 서두/말미 표본 길이

# `_detect_import_format`의 200,000자 상한을 우회하기 위한 매우 큰 상한값(§4.18 판별 계층
# 재사용 — 이 값 자체는 어떤 실제 검증 기준도 아니다. 실제 상한 판정은 `TOTAL_MAX_CHARS`로
# 이 모듈이 직접 수행한다).
_DETECT_BYPASS_MAX_CHARS = 50_000_000

# --- 상태 보존(㉲ 확정) --------------------------------------------------------------
SPLIT_DIR = BASE_DIR / "import" / "split"
KEEP_MAX = 20  # R18 관례 — 초과 시 오래된 것부터 삭제(git·백업 제외)
STATE_TTL = dt.timedelta(hours=1)  # 인메모리 TTL — 만료 후 GET은 디스크 복구(F40-① 전례)

_STATE: Dict[str, dict] = {}
_STATE_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# 상태 보존 — 인메모리 TTL + `import/split/` JSON(최근 20건)
# ---------------------------------------------------------------------------
def _purge_expired() -> None:
    now = dt.datetime.now()
    with _STATE_LOCK:
        stale = [
            sid
            for sid, state in _STATE.items()
            if now - state.get("_mem_since", now) > STATE_TTL
        ]
        for sid in stale:
            _STATE.pop(sid, None)


def _remember_state(state: dict) -> None:
    state["_mem_since"] = dt.datetime.now()
    with _STATE_LOCK:
        _STATE[state["split_id"]] = state


def _persist_state(state: dict) -> None:
    """`import/split/{split_id}.json` 저장 — 조각 전문은 담지 않는다(head·발췌·표본만).
    실패는 예외를 올리지 않는다(보존 실패가 방금 만든 분할안 자체를 버리게 하면 안 된다)."""
    try:
        SPLIT_DIR.mkdir(parents=True, exist_ok=True)
        path = SPLIT_DIR / f"{state['split_id']}.json"
        serializable = {k: v for k, v in state.items() if not k.startswith("_mem")}
        path.write_text(json.dumps(serializable, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        _LOGGER.warning("분할 상태 저장 실패(split_id=%s)", state.get("split_id"), exc_info=True)
        return
    _prune_split_files()


def _prune_split_files(keep: int = KEEP_MAX) -> None:
    if not SPLIT_DIR.exists():
        return
    files = [p for p in SPLIT_DIR.glob("*.json") if p.is_file()]
    if len(files) <= keep:
        return
    files.sort(key=lambda p: (p.stat().st_mtime, p.name))
    for path in files[: len(files) - keep]:
        try:
            path.unlink()
        except OSError:  # pragma: no cover - 파일 잠김 등
            _LOGGER.warning("분할 상태 정리 실패: %s", path)


def _load_state_from_disk(split_id: str) -> Optional[dict]:
    path = SPLIT_DIR / f"{split_id}.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def get_state_or_404(split_id: str) -> dict:
    """분할 상태 조회(인메모리 우선 → 디스크 복구, F40-① preview 복구 전례)."""
    _purge_expired()
    with _STATE_LOCK:
        state = _STATE.get(split_id)
    if state is not None:
        return state
    state = _load_state_from_disk(split_id)
    if state is None:
        raise NotFoundError(
            "분할 작업을 찾을 수 없습니다(만료되었을 수 있습니다)", detail={"split_id": split_id}
        )
    _remember_state(state)
    return state


def _find_existing_split_id(hash12: str, *, exclude_split_id: Optional[str] = None) -> Optional[str]:
    """같은 원본(내용 hash12) 기존 분할 레코드 감지(㉳) — 가장 최근 것 하나를 안내한다."""
    if not SPLIT_DIR.exists():
        return None
    candidates: List[Tuple[float, str]] = []
    for path in SPLIT_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        if data.get("source_hash12") == hash12 and data.get("split_id") != exclude_split_id:
            candidates.append((path.stat().st_mtime, data["split_id"]))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


# ---------------------------------------------------------------------------
# 원본 재추출(조각 텍스트 무저장 — sources/ + 오프셋으로 결정론 재절단)
# ---------------------------------------------------------------------------
def _reextract_text(state: dict) -> str:
    data = preview_store.read_source_bytes(state["source_hash12"])
    if data is None:
        raise NotFoundError(
            "원본을 sources/에서 찾을 수 없습니다(삭제되었을 수 있습니다)",
            detail={"split_id": state["split_id"]},
        )
    detected = convert_service._detect_import_format(
        state["source_filename"], data, max_chars=_DETECT_BYPASS_MAX_CHARS
    )
    if detected.text is None:  # pragma: no cover - 분할 시작 시 이미 text 형식으로 확정됨
        raise NotFoundError(
            "원본에서 텍스트를 다시 추출할 수 없습니다", detail={"split_id": state["split_id"]}
        )
    return detected.text


# ---------------------------------------------------------------------------
# 휴리스틱 경계 스캔(무비용·동기 — LLM 0)
#
# 패턴(구현 실측 — 완료 기록에 기입): ① 마크다운 헤딩(#/##/###) ② 회차 헤더("제N회"·
# "YYYY년 N회") ③ 과목 헤더("N과목"·"제N과목"·"과목:") ④ 문항 번호 리셋("1." 또는 "1)"
# 재등장 — 약한 신호, ①②③이 하나도 없으면 confidence='uncertain').
# ---------------------------------------------------------------------------
_HEADING_RE = re.compile(r"^#{1,3}\s+\S")
_EXAM_ROUND_RE = re.compile(r"(제\s*\d+\s*회|\d{4}\s*년\s*\d+\s*회)")
_SUBJECT_HEADER_RE = re.compile(r"^(?:\[?\d+\s*과목\]?|제\s*\d+\s*과목|과목\s*[:：])")
_QUESTION_ONE_RE = re.compile(r"^\s*1\s*[.)]\s*\S")


def _scan_heuristic_boundaries(text: str) -> Tuple[List[Tuple[int, str]], str]:
    """returns (candidates=[(offset, label)], confidence)."""
    candidates: List[Tuple[int, str]] = []
    strong_hits = 0
    offset = 0
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        if stripped:
            label = stripped[:60]
            if _HEADING_RE.match(stripped) or _EXAM_ROUND_RE.search(stripped) or _SUBJECT_HEADER_RE.match(stripped):
                candidates.append((offset, label))
                strong_hits += 1
            elif _QUESTION_ONE_RE.match(line):
                candidates.append((offset, label))
        offset += len(line)
    confidence = "ok" if strong_hits > 0 else "uncertain"
    return candidates, confidence


# ---------------------------------------------------------------------------
# 조각 무결성 결정론 검증 함수(공용 — 휴리스틱·정밀 분석 검증·enqueue에서 재사용)
# ---------------------------------------------------------------------------
def _normalize_chunks(cuts: List[Tuple[int, str]], total_len: int) -> List[dict]:
    """경계 후보 목록(오프셋·라벨) → 전체 커버리지가 보장된 조각 목록(start·end·label).

    경계 누락 구간(어떤 후보도 시작점을 대지 못한 구간)은 "무라벨 구간 N"으로 자동 라벨링
    한다(조용한 탈락 금지). 조각당 상한(㉮ 200,000자) 초과 구간은 균등 재분할한다."""
    if total_len <= 0:
        return []
    seen: Dict[int, str] = {}
    for offset, label in cuts:
        if 0 <= offset < total_len:
            seen[offset] = label
    offsets = sorted(seen)
    if 0 not in seen:
        offsets = [0] + offsets
    cut_points = offsets + [total_len]

    raw_chunks: List[dict] = []
    gap_counter = 0
    for i in range(len(cut_points) - 1):
        start, end = cut_points[i], cut_points[i + 1]
        if start >= end:
            continue
        label = seen.get(start)
        if label is None:
            gap_counter += 1
            label = f"무라벨 구간 {gap_counter}"
        raw_chunks.append({"start": start, "end": end, "label": label})

    capped: List[dict] = []
    for chunk in raw_chunks:
        seg_len = chunk["end"] - chunk["start"]
        if seg_len <= CHUNK_MAX_CHARS:
            capped.append(chunk)
            continue
        pieces = math.ceil(seg_len / CHUNK_MAX_CHARS)
        piece_len = math.ceil(seg_len / pieces)
        cursor = chunk["start"]
        for idx in range(pieces):
            piece_end = chunk["end"] if idx == pieces - 1 else min(cursor + piece_len, chunk["end"])
            capped.append(
                {"start": cursor, "end": piece_end, "label": f'{chunk["label"]} ({idx + 1}/{pieces})'}
            )
            cursor = piece_end

    _assert_full_coverage(capped, total_len)
    return capped


def _assert_full_coverage(chunks: List[dict], total_len: int) -> None:
    """순수 검증(생성 없음) — start 오름차순·중첩 0·합집합 = 전체·조각당 상한 준수.
    위반은 저장된 상태 자체의 손상을 뜻하므로 422로 조기에 표면화한다."""
    prev_end = 0
    for chunk in chunks:
        if chunk["start"] < prev_end:
            raise ValidationAppError("조각 목록이 손상되었습니다(오프셋이 중첩되었습니다)")
        if chunk["start"] > prev_end:
            raise ValidationAppError("조각 목록이 손상되었습니다(빠진 구간이 있습니다)")
        if chunk["end"] - chunk["start"] > CHUNK_MAX_CHARS:
            raise ValidationAppError(
                f"조각이 상한({CHUNK_MAX_CHARS:,}자)을 초과합니다",
                detail={"chars": chunk["end"] - chunk["start"]},
            )
        prev_end = chunk["end"]
    if prev_end != total_len:
        raise ValidationAppError("조각 목록이 손상되었습니다(전체 길이와 일치하지 않습니다)")


def _estimate_for_chars(chars: int) -> dict:
    """`answer_key_service._estimate_usage` 관례(chars/1.5) 재사용 — 텍스트가 항상
    존재하므로 `assumed=False`로 고정한다."""
    return {"approx_input_tokens": max(int(chars / 1.5), 1), "assumed": False}


def _attach_ids_heads_estimates(chunks: List[dict], text: str) -> List[dict]:
    out: List[dict] = []
    for i, chunk in enumerate(chunks, start=1):
        head_end = min(chunk["start"] + HEAD_CHARS, chunk["end"])
        chars = chunk["end"] - chunk["start"]
        out.append(
            {
                "chunk_id": f"c{i}",
                "label": chunk["label"],
                "start": chunk["start"],
                "end": chunk["end"],
                "chars": chars,
                "head": text[chunk["start"] : head_end],
                "estimate": _estimate_for_chars(chars),
            }
        )
    return out


# ---------------------------------------------------------------------------
# 1단계 — 분할 시작(동기·LLM 0)
# ---------------------------------------------------------------------------
def start_split(
    *,
    upload_filename: Optional[str] = None,
    upload_bytes: Optional[bytes] = None,
    url: Optional[str] = None,
) -> dict:
    """`POST /api/import/split` — 다운로드→판별→추출→원본 sources/ 저장→총 상한(㉯)
    검증→휴리스틱 경계 스캔→분할안 반환(§4.25). 20만 자 이하 = 422(일반 반입 안내)."""
    if url:
        filename, data, _content_type = convert_service._download_source_url(url)
    elif upload_bytes is not None:
        if not upload_filename:
            raise ValidationAppError("업로드 파일명이 비어 있습니다")
        filename, data = upload_filename, upload_bytes
    else:
        raise ValidationAppError("file 업로드 또는 url 중 하나가 필요합니다")

    try:
        detected = convert_service._detect_import_format(
            filename, data, max_chars=_DETECT_BYPASS_MAX_CHARS
        )
    except (
        convert_service.UnsupportedFormatError,
        convert_service.DocParseFailedError,
        convert_service.TooLargeError,
    ) as exc:
        # §4.18 ⑥ 확정 문구 재사용(동기 에러 — 잡 error_info 채널이 아니다). 판별 계층
        # 자체가 이미 원본을 sources/에 저장한 뒤 이 예외를 만든다(대칭 관례 그대로).
        raise ValidationAppError(exc.public_message, detail={"action": exc.action}) from exc

    if detected.text is None:
        # PDF·이미지는 분할 대상이 아니다(§4.25 "PDF 파일 분할 없음" — pdf는 too_large
        # 판정 자체가 없어 범위 밖. 이미지도 텍스트 개념이 없어 동일 취급).
        raise ValidationAppError(
            "이 파일 형식은 분할 대상이 아닙니다 — 텍스트를 추출할 수 있는 형식만 분할할 수 "
            "있습니다(PDF·이미지는 제외).",
            detail={"file_type": detected.file_type},
        )

    text = detected.text
    source_chars = len(text)

    # 원본 sources/ 저장(성공 경로 — §4.25 ㉲). 실패 경로(위 except)는 판별 계층이 이미 저장.
    saved_name = import_service.save_source_file(filename, data)
    source_hash12 = saved_name.split("_", 1)[0]
    duplicate_of = _find_existing_split_id(source_hash12)

    if source_chars > TOTAL_MAX_CHARS:
        raise ValidationAppError(
            f"원본이 너무 큽니다(약 {source_chars:,}자 — 분할 반입 상한 {TOTAL_MAX_CHARS:,}자)",
            detail={
                "source_chars": source_chars,
                "limit": TOTAL_MAX_CHARS,
                "action": "원본을 과목·회차 단위로 나눠 개별 파일로 직접 분할해 반입해 주세요.",
            },
        )
    if source_chars <= CHUNK_MAX_CHARS:
        raise ValidationAppError(
            "분할이 필요 없는 크기입니다 — 일반 반입을 이용하세요",
            detail={"source_chars": source_chars, "limit": CHUNK_MAX_CHARS},
        )

    candidates, confidence = _scan_heuristic_boundaries(text)
    chunks = _normalize_chunks(candidates, source_chars)
    if len(chunks) > MAX_CHUNKS:
        raise ValidationAppError(
            f"조각 수가 상한({MAX_CHUNKS}개)을 초과했습니다(현재 {len(chunks)}개) — "
            "원본을 수동으로 나눠 반입해 주세요.",
            detail={"chunk_count": len(chunks), "limit": MAX_CHUNKS},
        )
    chunk_records = _attach_ids_heads_estimates(chunks, text)

    analysis = _build_analysis_context(candidates, text)
    analyze_input_chars = (
        len(analysis["head_sample"])
        + len(analysis["tail_sample"])
        + sum(len(item["context"]) for item in analysis["boundary_excerpts"])
    )
    analyze_estimate = _estimate_for_chars(analyze_input_chars)

    split_id = f"spl_{uuid.uuid4().hex[:8]}"
    state = {
        "split_id": split_id,
        "created_at": dt.datetime.now().isoformat(),
        "source_filename": filename,
        "source_hash12": source_hash12,
        "source_chars": source_chars,
        "confidence": confidence,
        "chunks": chunk_records,
        "heuristic_chunks": chunk_records,  # 정밀 분석 전 이력 보존(§4.25 "휴리스틱안은 이력 보존")
        "status": "ready",
        "analyze_job_id": None,
        "analyze_estimate": analyze_estimate,
        "duplicate_of": duplicate_of,
        **analysis,
    }
    _remember_state(state)
    _persist_state(state)

    return _to_start_result(state)


def _to_start_result(state: dict) -> dict:
    return {
        "split_id": state["split_id"],
        "source_chars": state["source_chars"],
        "confidence": state["confidence"],
        "chunks": state["chunks"],
        "analyze_estimate": state["analyze_estimate"],
        "reuse": {"split_id": state["duplicate_of"]} if state.get("duplicate_of") else None,
    }


def _build_analysis_context(candidates: List[Tuple[int, str]], text: str) -> dict:
    """정밀 분석 입력 규약(§4.25) — 원문 전문이 아니라 경계 후보 오프셋 + 주변 발췌(~200자)
    + 서두/말미 표본만 남긴다. `allowed_ranges`는 정밀 분석 산출 검증의 허용 범위다(LLM이
    "본" 위치만 인정 — 범위 밖 창작 오프셋은 invalid_output)."""
    total_len = len(text)
    head_sample = text[: min(SAMPLE_CHARS, total_len)]
    tail_start = max(total_len - SAMPLE_CHARS, 0)
    tail_sample = text[tail_start:]
    allowed_ranges: List[List[int]] = [[0, len(head_sample)], [tail_start, total_len]]
    excerpts: List[dict] = []
    for offset, label in candidates:
        lo = max(offset - EXCERPT_RADIUS, 0)
        hi = min(offset + EXCERPT_RADIUS, total_len)
        allowed_ranges.append([lo, hi])
        excerpts.append({"offset": offset, "label": label, "context": text[lo:hi]})
    return {
        "head_sample": head_sample,
        "tail_sample": tail_sample,
        "tail_start": tail_start,
        "allowed_ranges": allowed_ranges,
        "boundary_excerpts": excerpts,
    }


# ---------------------------------------------------------------------------
# 상태 조회(GET) — analyze 잡(§4.11 progress) 재사용
# ---------------------------------------------------------------------------
def get_state_response(split_id: str) -> dict:
    state = get_state_or_404(split_id)
    status = state.get("status", "ready")
    progress = None
    error_info = None
    job_id = state.get("analyze_job_id")
    if job_id:
        try:
            job = convert_service.get_split_analyze_job(job_id)
        except NotFoundError:
            job = None
        if job is not None:
            if job["status"] == "running":
                status = "analyzing"
                progress = job.get("progress")
            elif job["status"] == "error":
                status = "error"
                error_info = job.get("error_info")
            elif job["status"] == "cancelled":
                status = "cancelled"
            # job['status']=='done'이면 apply_analyze_result가 이미 persisted
            # status='analyzed'로 갱신해 두었다(여기서 재확정 불필요).
    return {
        "split_id": split_id,
        "status": status,
        "source_chars": state["source_chars"],
        "confidence": state["confidence"],
        "chunks": state["chunks"],
        # 2026-08-04 정렬 ④ — 재진입·재사용 세션에서도 정밀 분석 비용 확인이 가능하도록
        # GET에도 항상 동봉한다(POST 전용이 아니다).
        "analyze_estimate": state["analyze_estimate"],
        "progress": progress,
        "error_info": error_info,
        "reuse": {"split_id": state["duplicate_of"]} if state.get("duplicate_of") else None,
    }


# ---------------------------------------------------------------------------
# 2단계 — LLM 정밀 분석(convert_service의 split_analyze 잡이 호출)
# ---------------------------------------------------------------------------
def set_analyze_job(split_id: str, job_id: str) -> None:
    state = get_state_or_404(split_id)
    state["analyze_job_id"] = job_id
    _remember_state(state)
    _persist_state(state)


def assert_analyze_not_running(split_id: str) -> None:
    """이미 진행 중인 정밀 분석 잡이 있으면 409(중복 시작 방지)."""
    state = get_state_or_404(split_id)
    job_id = state.get("analyze_job_id")
    if not job_id:
        return
    try:
        job = convert_service.get_split_analyze_job(job_id)
    except NotFoundError:
        return
    if job["status"] == "running":
        raise ConflictError(
            "이미 분석이 진행 중입니다", detail={"split_id": split_id, "job_id": job_id}
        )


def build_analyze_prompt(state: dict) -> str:
    """§4.25 "정밀 분석 입력 규약" — 원문 전문 금지, 경계 후보 오프셋 + 주변 발췌(~200자)
    + 서두/말미 표본만 투입. 출력은 순수 JSON 배열만 지시한다."""
    lines = [
        "너는 Study Hub의 대용량 원본 분할 보조자다. 아래 표본·경계 후보만 근거로 문서의 "
        "실제 경계(과목·회차·문항 전환 지점)를 확정하라 — 원문 전체는 주어지지 않는다. "
        "아래 정보 범위 밖의 위치를 새로 만들어내면 안 된다.",
        "",
        "## 원본 개요",
        f"- 원본 파일명: {state['source_filename']}",
        f"- 전체 길이: {state['source_chars']}자",
        "",
        f"## 서두 표본(0~{len(state['head_sample'])}자)",
        state["head_sample"],
        "",
        f"## 말미 표본({state['tail_start']}~{state['source_chars']}자)",
        state["tail_sample"],
        "",
        f"## 휴리스틱 경계 후보({len(state['boundary_excerpts'])}개)",
    ]
    if state["boundary_excerpts"]:
        for item in state["boundary_excerpts"]:
            lines.append(
                f'- 오프셋 {item["offset"]}(휴리스틱 라벨: "{item["label"]}") 주변 발췌: '
                f'"{item["context"]}"'
            )
    else:
        lines.append("- (없음 — 서두·말미 표본 범위 안에서만 경계를 제안하라)")
    lines += [
        "",
        "## 출력 형식(엄수)",
        "코드펜스·설명 문장 없이 순수 JSON 배열 하나만 출력하라. 각 원소는 정확히 "
        '{"offset": 정수, "label": "문자열"} 형식이며, offset은 반드시 위 경계 후보 오프셋 '
        "중 하나이거나 서두·말미 표본이 보여준 범위 안의 위치여야 한다(범위 밖 위치를 "
        "만들어내면 안 된다). label은 그 경계에서 시작하는 구간을 사람이 알아볼 수 있는 "
        "제목으로 지어라(예: \"2과목 기계설계\", \"2024년 2회\"). 오프셋 오름차순으로 정렬하라.",
    ]
    return "\n".join(lines)


def apply_analyze_result(split_id: str, payload: Any) -> List[dict]:
    """정밀 분석 산출 검증(서버 결정론 — LLM 불신, §4.25) — 확정 오프셋은 휴리스틱 후보
    발췌 구간·서두/말미 표본 범위(`allowed_ranges`) 안의 위치만 수용한다. 위반은 신규 kind
    없이 기존 `invalid_output`을 재사용한다(§4.17 ⑤ 규율)."""
    state = get_state_or_404(split_id)
    if not isinstance(payload, list) or not payload:
        raise convert_service.InvalidLlmOutputError(
            "분할 정밀 분석 결과가 JSON 배열이 아닙니다", truncated=False
        )

    allowed_ranges = state.get("allowed_ranges") or []
    total_len = state["source_chars"]
    cuts: List[Tuple[int, str]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise convert_service.InvalidLlmOutputError(
                "분할 정밀 분석 결과 항목이 객체가 아닙니다", truncated=False
            )
        offset = item.get("offset")
        label = item.get("label")
        if not isinstance(offset, int) or isinstance(offset, bool):
            raise convert_service.InvalidLlmOutputError(
                "분할 정밀 분석 결과의 offset이 정수가 아닙니다", truncated=False
            )
        if not isinstance(label, str) or not label.strip():
            raise convert_service.InvalidLlmOutputError(
                "분할 정밀 분석 결과의 label이 비어 있습니다", truncated=False
            )
        if not (0 <= offset < total_len):
            raise convert_service.InvalidLlmOutputError(
                "분할 정밀 분석 결과의 offset이 원본 범위를 벗어났습니다", truncated=False
            )
        if not any(lo <= offset <= hi for lo, hi in allowed_ranges):
            # §4.25 "범위 밖 창작 오프셋 = invalid_output" — 휴리스틱 후보 집합 ∪ 발췌
            # 구간 밖의 위치는 LLM이 실제로 "보지 못한" 위치이므로 창작으로 간주한다.
            raise convert_service.InvalidLlmOutputError(
                "분할 정밀 분석 결과에 후보 범위 밖 오프셋이 있습니다(창작 의심)", truncated=False
            )
        cuts.append((offset, label.strip()))

    chunks = _normalize_chunks(cuts, total_len)
    if len(chunks) > MAX_CHUNKS:
        # 조각 수 상한도 "쓸 수 없는 산출물"로 취급한다 — 자동 재병합으로 눙치지 않고
        # invalid_output으로 실패시켜 재시도·수동 분할 안내로 보낸다(㉰ 확정).
        raise convert_service.InvalidLlmOutputError(
            f"분할 정밀 분석 결과의 조각 수가 상한({MAX_CHUNKS}개)을 초과했습니다"
            f"(결과 {len(chunks)}개)",
            truncated=False,
        )

    text = _reextract_text(state)
    chunk_records = _attach_ids_heads_estimates(chunks, text)

    state["chunks"] = chunk_records
    state["status"] = "analyzed"
    state["analyzed_at"] = dt.datetime.now().isoformat()
    _remember_state(state)
    _persist_state(state)
    return chunk_records


# ---------------------------------------------------------------------------
# 3단계 — 선택 조각 투입(기존 convert 잡 N개 등록)
# ---------------------------------------------------------------------------
def enqueue_split(
    db: Session,
    split_id: str,
    *,
    selections: List[List[str]],
    category_paths: Optional[Dict[str, str]] = None,
) -> dict:
    """`POST /api/import/split/{split_id}/enqueue` — 그룹 = 단일 또는 인접 chunk_id 연속
    구간([합치기]). 오프셋 결정론 재절단(`원문[start:end]`) 후 기존 convert 잡 N개 등록."""
    state = get_state_or_404(split_id)
    chunks: List[dict] = state["chunks"]
    _assert_full_coverage(
        [{"start": c["start"], "end": c["end"]} for c in chunks], state["source_chars"]
    )
    if not selections:
        raise ValidationAppError("selections가 비어 있습니다")

    order = [c["chunk_id"] for c in chunks]
    index_of = {cid: i for i, cid in enumerate(order)}
    by_id = {c["chunk_id"]: c for c in chunks}

    seen_ids: set = set()
    groups: List[List[dict]] = []
    for group_ids in selections:
        if not group_ids:
            raise ValidationAppError("빈 선택 그룹이 있습니다")
        if len(set(group_ids)) != len(group_ids):
            raise ValidationAppError(
                "같은 그룹 안에 조각이 중복 지정되었습니다", detail={"chunk_ids": group_ids}
            )
        missing = [cid for cid in group_ids if cid not in by_id]
        if missing:
            raise ValidationAppError("존재하지 않는 조각 id가 있습니다", detail={"chunk_ids": missing})
        dup = [cid for cid in group_ids if cid in seen_ids]
        if dup:
            raise ValidationAppError(
                "이미 다른 그룹에 선택된 조각입니다", detail={"chunk_ids": dup}
            )
        seen_ids.update(group_ids)

        indices = sorted(index_of[cid] for cid in group_ids)
        if indices != list(range(indices[0], indices[0] + len(indices))):
            raise ValidationAppError(
                "합치기는 인접한 조각끼리만 가능합니다", detail={"chunk_ids": group_ids}
            )
        ordered_group = [by_id[order[i]] for i in indices]
        merged_chars = ordered_group[-1]["end"] - ordered_group[0]["start"]
        if merged_chars > CHUNK_MAX_CHARS:
            raise ValidationAppError(
                f"합치기 결과가 조각당 상한({CHUNK_MAX_CHARS:,}자)을 초과합니다",
                detail={"chunk_ids": group_ids, "chars": merged_chars},
            )
        groups.append(ordered_group)

    text = _reextract_text(state)
    jobs_out: List[dict] = []
    for group in groups:
        start, end = group[0]["start"], group[-1]["end"]
        piece_text = text[start:end]  # 결정론 재절단 — 원문[start:end]
        chunk_ids = [c["chunk_id"] for c in group]
        label = group[0]["label"] if len(group) == 1 else f'{group[0]["label"]} ~ {group[-1]["label"]}'
        # 2026-08-04 정렬 ② — category_paths 키는 병합 그룹 내 최소 start의 chunk_id(대표 키).
        rep_id = group[0]["chunk_id"]
        cat_path = (category_paths or {}).get(rep_id)
        upload_filename = f"{state['source_filename']}__{rep_id}.txt"
        job_id = convert_service.start_convert_job(
            db=db,
            upload_filename=upload_filename,
            upload_bytes=piece_text.encode("utf-8"),
            category_path=cat_path,
            label=f"『{state['source_filename']}』 분할 조각 변환 — {label}",
            skip_source_save=True,  # §4.25 "조각 잡은 원본을 재저장하지 않는다"
            split_id=split_id,
            split_chunk_ids=chunk_ids,
        )
        jobs_out.append({"job_id": job_id, "chunk_ids": chunk_ids, "label": label})
    return {"jobs": jobs_out}
