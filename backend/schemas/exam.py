"""모의고사 스키마 (F25, 설계 §4.14).

중요: 서버 채점 원칙(불변 규칙 1) — `ExamSessionResponse`(및 그 안의
`QuizQuestionOut`)는 정답·해설을 절대 담지 않는다. 제출(`ExamSubmitReport`) 이후
응답에만 정답·해설이 실린다(attempts 단건 응답과 동일 원칙).
"""
from __future__ import annotations

import datetime as dt
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from schemas.quiz import QuizQuestionOut
from services.exam_scoring import DEFAULT_PASS_AVG, DEFAULT_SUBJECT_MIN

ExamOrder = Literal["random", "sequential"]


class ExamCut(BaseModel):
    """합격선 — 요청 파라미터가 출처(설정 저장 없음, 설계 §4.14). 기본값 = 국가기술자격 표준."""

    subject_min: int = DEFAULT_SUBJECT_MIN
    pass_avg: int = DEFAULT_PASS_AVG


# --- exam/session -------------------------------------------------------------
class ExamSubjectRequest(BaseModel):
    category_id: int
    count: Optional[int] = Field(default=None, ge=1, le=200)


class ExamSessionRequest(BaseModel):
    subjects: List[ExamSubjectRequest]
    types: Optional[List[Literal["question", "past_question"]]] = None
    order: ExamOrder = "random"
    time_limit_minutes: Optional[int] = Field(default=None, ge=1)
    cut: Optional[ExamCut] = None


class ExamSubjectOut(BaseModel):
    category_id: int
    name: str
    requested: Optional[int] = None  # 요청 count 에코(미지정 = 전체 요청이었다는 뜻, null)
    count: int
    items: List[QuizQuestionOut] = Field(default_factory=list)


class ExamSessionResponse(BaseModel):
    time_limit_minutes: int
    cut: ExamCut
    order: ExamOrder
    total_count: int
    warnings: List[str] = Field(default_factory=list)
    subjects: List[ExamSubjectOut] = Field(default_factory=list)


# --- exam/submit ---------------------------------------------------------------
class ExamAnswerItem(BaseModel):
    document_id: int
    subject_category_id: int
    my_answer: Optional[str] = None  # 미응답 = null (오답 처리)
    time_spent: Optional[int] = Field(default=None, ge=0)


class ExamSubmitRequest(BaseModel):
    answers: List[ExamAnswerItem]
    cut: Optional[ExamCut] = None
    elapsed_seconds: Optional[int] = Field(default=None, ge=0)


class ExamTotal(BaseModel):
    score: int
    correct: int
    count: int


class ExamSubjectReport(BaseModel):
    category_id: int
    name: str
    score: int
    correct: int
    count: int
    failed: bool


class ExamResultItem(BaseModel):
    """제출 이후 문항별 리뷰 — 이 시점에는 정답·해설 공개가 원칙에 맞다."""

    document_id: int
    subject_category_id: int
    is_correct: bool
    my_answer: Optional[str] = None
    answer: Optional[str] = None
    explanation: Optional[str] = None
    review_note_id: Optional[int] = None


class ExamSubmitReport(BaseModel):
    taken_at: dt.datetime  # 런 키(배치 공통 answered_at) — exam/history 그룹 키와 동일 값
    passed: bool
    cut: ExamCut
    total: ExamTotal
    elapsed_seconds: Optional[int] = None
    subjects: List[ExamSubjectReport] = Field(default_factory=list)
    results: List[ExamResultItem] = Field(default_factory=list)


# --- exam/history ----------------------------------------------------------------
class ExamHistorySubject(BaseModel):
    category_id: int
    name: str
    score: int
    failed: bool


class ExamHistoryItem(BaseModel):
    taken_at: dt.datetime
    label: str  # 과목 노드들의 공통 부모 경로(삭제된 분류는 "(삭제된 분류)")
    passed: bool  # 기본 컷(40/60) 재평가 — 당시 컷 미저장(R15)
    total: ExamTotal
    subjects: List[ExamHistorySubject] = Field(default_factory=list)
