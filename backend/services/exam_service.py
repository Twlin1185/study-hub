"""실전 모의고사 — 세션 구성 · 일괄 제출 채점 · 응시 이력 (F25, 설계 §4.14).

원칙(강제): 새 테이블·컬럼 없음. 리포트·이력은 전부 attempts 파생(mode='exam' +
배치 공통 answered_at = 런 키). exam/session 응답에는 정답·해설이 없다(불변 규칙 1 —
quiz/session과 동일, QuizQuestionOut 재사용). exam/submit은 attempt_service의 채점
코어(grade_and_record)를 문항마다 호출하되, **배치 전체를 한 트랜잭션**으로 묶는다
(불변 규칙 2 — 중간 실패 시 attempts 0건).
"""
from __future__ import annotations

import datetime as dt
import json
import math
import random
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

import models
from exceptions import ValidationAppError
from schemas.exam import (
    ExamCut,
    ExamHistoryItem,
    ExamHistorySubject,
    ExamResultItem,
    ExamSessionRequest,
    ExamSessionResponse,
    ExamSubjectOut,
    ExamSubjectReport,
    ExamSubmitReport,
    ExamSubmitRequest,
    ExamTotal,
)
from schemas.quiz import QuizQuestionOut
from services import attempt_service, category_service, exam_scoring, quiz_service
from services.tree_utils import category_path, collect_descendant_ids

SUBJECT_UPPER_BOUND = 200  # 계획서 §4.14 — count 미지정(전체 요청) 시 과목당 상한
MINUTES_PER_QUESTION = 1.5  # 필기 관례(설계 §4.14) — time_limit_minutes 미지정 시 기본 산식


def _documents_ordered(db: Session, doc_ids: List[int]) -> List[models.Document]:
    if not doc_ids:
        return []
    rows = db.execute(
        select(models.Document).where(models.Document.id.in_(doc_ids))
    ).scalars().all()
    by_id = {doc.id: doc for doc in rows}
    return [by_id[i] for i in doc_ids if i in by_id]


def _to_quiz_question(doc: models.Document) -> QuizQuestionOut:
    return QuizQuestionOut(
        document_id=doc.id,
        doc_no=doc.doc_no,
        type=doc.type,
        title=doc.title,
        content=doc.content,
        choices=json.loads(doc.choices) if doc.choices else None,
        difficulty=doc.difficulty,
    )


def build_exam_session(db: Session, payload: ExamSessionRequest) -> ExamSessionResponse:
    """과목(=요청된 분류 노드) 각각 하위 트리 전체에서 출제 — 화면(시험 노드의 직계
    자식 체크리스트)이 과목 목록을 결정하고, API는 분류 id만 받는다(설계 §4.14)."""
    allowed_types: Optional[List[str]] = None
    if payload.types is not None:
        allowed_types = [t for t in payload.types if t in quiz_service.QUESTION_TYPES]

    warnings: List[str] = []
    subjects_out: List[ExamSubjectOut] = []
    total_count = 0

    for subject in payload.subjects:
        category = category_service.get_category_or_404(db, subject.category_id)
        category_ids = collect_descendant_ids(db, subject.category_id)

        doc_ids = quiz_service.eligible_document_ids(
            db,
            category_ids=category_ids,
            wrong_only=False,
            bookmarked_only=False,
            allowed_types=allowed_types,
        )

        if payload.order == "random":
            random.shuffle(doc_ids)
        else:
            doc_ids = quiz_service.sequential_order(db, doc_ids, category_ids)

        cap = subject.count if subject.count is not None else len(doc_ids)
        cap = min(cap, SUBJECT_UPPER_BOUND)
        doc_ids = doc_ids[:cap]

        if not doc_ids:
            warnings.append(f"'{category.name}'에 출제 가능한 문항이 없어 제외되었습니다")
            continue

        documents = _documents_ordered(db, doc_ids)
        items = [_to_quiz_question(doc) for doc in documents]
        subjects_out.append(
            ExamSubjectOut(
                category_id=category.id,
                name=category.name,
                requested=subject.count,
                count=len(items),
                items=items,
            )
        )
        total_count += len(items)

    if total_count == 0:
        raise ValidationAppError(
            "출제 가능한 문항이 없습니다. 과목 선택을 확인해주세요",
            detail={"subjects": [s.category_id for s in payload.subjects]},
        )

    time_limit = payload.time_limit_minutes or math.ceil(total_count * MINUTES_PER_QUESTION)
    cut = payload.cut or ExamCut()

    return ExamSessionResponse(
        time_limit_minutes=time_limit,
        cut=cut,
        order=payload.order,
        total_count=total_count,
        warnings=warnings,
        subjects=subjects_out,
    )


def submit_exam(db: Session, payload: ExamSubmitRequest) -> ExamSubmitReport:
    """일괄 제출 채점 — 배치 전체가 한 트랜잭션(불변 규칙 2). 미응답(null)=오답."""
    if not payload.answers:
        raise ValidationAppError("제출할 답안이 없습니다")

    cut = payload.cut or ExamCut()

    document_ids = [a.document_id for a in payload.answers]
    documents = db.execute(
        select(models.Document).where(models.Document.id.in_(document_ids))
    ).scalars().all()
    doc_by_id: Dict[int, models.Document] = {doc.id: doc for doc in documents}

    # 등장 순서를 유지한 과목 id 목록 — 리포트 subjects 순서 = 첫 등장 순.
    subject_ids: List[int] = list(dict.fromkeys(a.subject_category_id for a in payload.answers))
    category_by_id: Dict[int, models.Category] = {}
    subtree_by_id: Dict[int, set] = {}
    for cid in subject_ids:
        category = category_service.get_category_or_404(db, cid)
        category_by_id[cid] = category
        subtree_by_id[cid] = set(collect_descendant_ids(db, cid))

    for ans in payload.answers:
        doc = doc_by_id.get(ans.document_id)
        if doc is None or not doc.is_active:
            raise ValidationAppError(
                "존재하지 않거나 비활성화된 문서가 포함되어 있습니다",
                detail={"document_id": ans.document_id},
            )
        linked = db.execute(
            select(models.CategoryDocument.category_id)
            .where(
                models.CategoryDocument.document_id == doc.id,
                models.CategoryDocument.category_id.in_(subtree_by_id[ans.subject_category_id]),
            )
            .limit(1)
        ).first()
        if linked is None:
            raise ValidationAppError(
                "문서가 해당 과목 분류에 속하지 않습니다",
                detail={
                    "document_id": ans.document_id,
                    "subject_category_id": ans.subject_category_id,
                },
            )

    run_key = dt.datetime.utcnow()  # 배치 공통 answered_at — 응시 런 키(설계 §4.14)
    tallies: Dict[int, exam_scoring.SubjectTally] = {
        cid: exam_scoring.SubjectTally(category_id=cid, name=category_by_id[cid].name)
        for cid in subject_ids
    }
    results: List[ExamResultItem] = []

    try:
        for ans in payload.answers:
            doc = doc_by_id[ans.document_id]
            graded = attempt_service.grade_and_record(
                db,
                document=doc,
                my_answer=ans.my_answer,
                category_id=ans.subject_category_id,
                time_spent=ans.time_spent,
                mode="exam",
                answered_at=run_key,
            )
            tally = tallies[ans.subject_category_id]
            tally.count += 1
            if graded.is_correct:
                tally.correct += 1
            results.append(
                ExamResultItem(
                    document_id=doc.id,
                    subject_category_id=ans.subject_category_id,
                    is_correct=graded.is_correct,
                    my_answer=ans.my_answer,
                    answer=doc.answer,
                    explanation=doc.explanation,
                    review_note_id=graded.review_note_id,
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    subject_scores = exam_scoring.grade_subjects(
        [tallies[cid] for cid in subject_ids], subject_min=cut.subject_min
    )
    total = exam_scoring.total_score(subject_scores)
    passed = exam_scoring.is_passed(subject_scores, total, pass_avg=cut.pass_avg)
    total_correct = sum(t.correct for t in tallies.values())
    total_items = sum(t.count for t in tallies.values())

    return ExamSubmitReport(
        taken_at=run_key,
        passed=passed,
        cut=cut,
        total=ExamTotal(score=total, correct=total_correct, count=total_items),
        elapsed_seconds=payload.elapsed_seconds,
        subjects=[
            ExamSubjectReport(
                category_id=s.category_id,
                name=s.name,
                score=s.score,
                correct=s.correct,
                count=s.count,
                failed=s.failed,
            )
            for s in subject_scores
        ],
        results=results,
    )


def _ancestor_chain(db: Session, category: models.Category) -> List[int]:
    """category 자신을 제외한 조상 id 체인 — 루트 → 직계부모 순."""
    chain: List[int] = []
    current = category
    while current.parent_id is not None:
        parent = db.get(models.Category, current.parent_id)
        if parent is None:
            break
        chain.append(parent.id)
        current = parent
    chain.reverse()
    return chain


def _exam_label(db: Session, subject_category_ids: List[int]) -> str:
    """시험 라벨 = 과목 노드들의 공통 부모 경로(설계 §4.14). 분류가 전부 삭제됐으면
    "(삭제된 분류)". 정상 흐름(시험 노드의 직계 자식 체크리스트)이라면 과목들이
    같은 부모(시험 노드)를 공유하므로 그 경로가 그대로 라벨이 된다."""
    categories = [
        cat
        for cid in subject_category_ids
        if (cat := db.get(models.Category, cid)) is not None
    ]
    if not categories:
        return "(삭제된 분류)"

    chains = [_ancestor_chain(db, cat) for cat in categories]
    common: List[int] = []
    for idx in range(min(len(chain) for chain in chains)):
        node = chains[0][idx]
        if all(chain[idx] == node for chain in chains):
            common.append(node)
        else:
            break

    if common:
        return category_path(db, common[-1])
    # 과목들이 공통 조상을 공유하지 않는 예외적 경우(직접 API 호출 등) — 과목명을 이어붙임
    return " · ".join(cat.name for cat in categories)


def get_exam_history(db: Session, limit: int = 20) -> List[ExamHistoryItem]:
    """attempts(mode='exam')를 answered_at으로 그룹한 파생 이력(저장 없음, 설계 §4.14).
    합격 재평가는 기본 컷(40/60) 고정 — 당시 컷은 저장하지 않는다(R15)."""
    run_keys = db.execute(
        select(models.Attempt.answered_at)
        .where(models.Attempt.mode == "exam")
        .distinct()
        .order_by(models.Attempt.answered_at.desc())
        .limit(limit)
    ).scalars().all()

    items: List[ExamHistoryItem] = []
    for run_key in run_keys:
        rows = db.execute(
            select(
                models.Attempt.category_id,
                models.Attempt.is_correct,
            ).where(
                models.Attempt.mode == "exam",
                models.Attempt.answered_at == run_key,
            )
        ).all()

        tallies: Dict[int, exam_scoring.SubjectTally] = {}
        subject_order: List[int] = []
        for category_id, is_correct in rows:
            if category_id is None:
                continue
            if category_id not in tallies:
                cat = db.get(models.Category, category_id)
                name = cat.name if cat is not None else "(삭제된 분류)"
                tallies[category_id] = exam_scoring.SubjectTally(category_id=category_id, name=name)
                subject_order.append(category_id)
            tally = tallies[category_id]
            tally.count += 1
            if is_correct:
                tally.correct += 1

        if not subject_order:
            continue

        subject_scores = exam_scoring.grade_subjects(
            [tallies[cid] for cid in subject_order],
            subject_min=exam_scoring.DEFAULT_SUBJECT_MIN,
        )
        total = exam_scoring.total_score(subject_scores)
        passed = exam_scoring.is_passed(
            subject_scores, total, pass_avg=exam_scoring.DEFAULT_PASS_AVG
        )
        total_correct = sum(t.correct for t in tallies.values())
        total_items = sum(t.count for t in tallies.values())

        items.append(
            ExamHistoryItem(
                taken_at=run_key,
                label=_exam_label(db, subject_order),
                passed=passed,
                total=ExamTotal(score=total, correct=total_correct, count=total_items),
                subjects=[
                    ExamHistorySubject(
                        category_id=s.category_id, name=s.name, score=s.score, failed=s.failed
                    )
                    for s in subject_scores
                ],
            )
        )
    return items
