"""대용량 원본 LLM 분할 반입 스키마 (S23 — F49, 설계 §4.25).

DDL·Alembic·settings 키 0건 — 상태 보존은 `import/split/` JSON 파일(최근 20건) + 인메모리
TTL 1시간뿐이다. 정밀 분석 잡(kind `'split_analyze'`)의 진행·오류는 기존
`schemas.convert.JobProgress`·`ErrorInfo`를 그대로 재사용한다(§4.10·§4.11 계약 그대로).

프론트-백엔드 병렬 구현 정렬(2026-08-04, 오케스트레이터 조정 — §4.25 미상세 4개 지점):
  1. 분석 전(휴리스틱만 있는) 상태 = `'ready'`(AppliedExam `'prepared'` 전례).
  2. `enqueue`의 `category_paths` 키 = **병합 그룹 내 최소 start의 chunk_id**(대표 키).
  3. 같은 원본(hash12) 기존 분할안 재사용 안내 = 최소형 `reuse: {"split_id": "..."}`.
  4. `analyze_estimate`는 POST(분할 시작) 응답뿐 아니라 **GET 상태 응답에도 동봉**한다
     (재진입·재사용 세션에서도 정밀 분석 비용 확인 스텝이 가능해야 한다, F35).

stage-reviewer 재수정([경미-5], 2026-08-04 오케스트레이터 결정) — 휴리스틱 후보 0건일 때의
균등 분할 폴백을 "조용히" 하지 않는다: 조각 라벨을 `"구조 미탐지 — 임시 균등 i/n"`으로
명시하고(confidence는 'uncertain' 유지), `fallback: 'even_split'|null` 필드를 POST·GET
응답 공통으로 싣는다(프론트가 폴백 여부를 안내 UI에 반영 — 프론트 후속 처리는 이 범위 밖).
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from schemas.convert import EngineChoice, ErrorInfo, JobProgress

SplitConfidence = Literal["ok", "uncertain"]
# 'ready' = 휴리스틱 분할안만 있는 상태(정밀 분석 미실행·미완료) — AppliedExam 'prepared' 전례.
# 'analyzing'/'analyzed'는 정밀 분석 잡의 진행·완료, 'error'/'cancelled'는 그 잡의 실패·취소.
SplitStatus = Literal["ready", "analyzing", "analyzed", "error", "cancelled"]


class SplitEstimate(BaseModel):
    approx_input_tokens: int
    assumed: bool


class SplitChunk(BaseModel):
    chunk_id: str
    label: str
    start: int
    end: int
    chars: int
    head: str
    estimate: SplitEstimate


class SplitReuse(BaseModel):
    """같은 원본(내용 hash12) 기존 분할 레코드 감지 안내(㉳) — 최소형(2026-08-04 정렬)."""

    split_id: str


SplitFallback = Literal["even_split"]


class SplitStartResult(BaseModel):
    split_id: str
    source_chars: int
    confidence: SplitConfidence
    chunks: List[SplitChunk]
    analyze_estimate: SplitEstimate
    reuse: Optional[SplitReuse] = None
    # [경미-5] 휴리스틱 후보 0건 → 균등 분할 폴백 여부(조용한 폴백 금지 — 명시 필드).
    fallback: Optional[SplitFallback] = None


class SplitAnalyzeRequest(BaseModel):
    engine: EngineChoice = "auto"
    # S22(F48 ④·ⓒ) — 요청 단위 모델 오버라이드(선택). 검증은 서버 공통 헬퍼가 수행.
    model: Optional[str] = None


class SplitAnalyzeStart(BaseModel):
    job_id: str


class SplitStateResponse(BaseModel):
    """`GET /api/import/split/{split_id}` 응답 — 상태·분할안 조회.

    LLM 산출 원문·정답은 어떤 필드에도 싣지 않는다(`head`는 추출 텍스트의 부분 문자열).
    `analyze_estimate`는 재진입 세션에서도 정밀 분석 비용 확인이 가능하도록 항상 동봉한다
    (2026-08-04 정렬 ④)."""

    split_id: str
    status: SplitStatus
    source_chars: int
    confidence: SplitConfidence
    chunks: List[SplitChunk]
    analyze_estimate: SplitEstimate
    progress: Optional[JobProgress] = None
    error_info: Optional[ErrorInfo] = None
    reuse: Optional[SplitReuse] = None
    fallback: Optional[SplitFallback] = None


class SplitEnqueueRequest(BaseModel):
    """`selections`의 각 그룹 = 조각 1개 또는 인접 chunk_id 연속 구간([합치기]).
    `category_paths` 키는 **병합 그룹 내 최소 start의 chunk_id**(대표 키, 2026-08-04 정렬 ②)."""

    selections: List[List[str]] = Field(min_length=1, max_length=40)
    category_paths: Optional[Dict[str, str]] = None


class SplitEnqueueJobItem(BaseModel):
    job_id: str
    chunk_ids: List[str]
    label: str


class SplitEnqueueResult(BaseModel):
    jobs: List[SplitEnqueueJobItem] = Field(default_factory=list)
