"""태그 자동 분류 규칙 (F21, 계획서 §11, 설계 §4.9).

tag_query 문법: **단일 태그 또는 'OR'로 결합한 여러 태그만** 지원한다(R13 — AND/괄호/NOT
없음 — 파서 과설계 방지). 태그명은 `tags.name` 정확 일치.

트리거 3곳:
  1. 반입 커밋 시 — import_service.commit_import()가 새로 생성·병합된 문서마다 호출.
  2. 태그 변경 시 — document_service.replace_tags()가 호출.
  3. 규칙 생성·수정 후 기존 문서 일괄 스캔 — `POST /api/tag-rules/{id}/scan` (scan_rule).

제안 수명주기(설계 §4.9): 이미 연결된 문서-분류 쌍, 또는 suggestions에 같은 쌍의 행이
있으면(상태 무관) 새 제안을 만들지 않는다 — rejected가 거절 기억으로 작동한다.
mode='auto' 규칙은 제안함을 거치지 않고 즉시 연결(linked_by='rule').

**S24(F50 ②) 격리 예외 — stage-reviewer 지적(중요 1) 반영**: 응용 모의고사 생성물은
auto 규칙이 매칭돼도 즉시 연결하지 않고 제안(suggested)만 만든다 — 승인 없는 자동 연결
경로가 하나도 없어야 한다는 R22 원칙 때문이다. 판정은 **호출부 플래그가 아니라
`_is_applied_exam_generated`(문서 기준)**로 `_apply_rule_to_document` 한 곳에서 내린다
— `scan_document`(트리거 1·2)·`scan_rule`(트리거 3) 전수가 이 함수를 경유하므로 어느
트리거로 들어와도 같은 판정을 받는다(`force_suggest` 파라미터는 생성 직후 호출의 명시적
보강 신호로 남겨두되, 문서 기준 판정이 근본 방어선이다).
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from exceptions import NotFoundError, ValidationAppError

_OR_SPLIT = re.compile(r"\s+OR\s+")
_DISALLOWED_SYNTAX = re.compile(r"[()]|\bAND\b|\bNOT\b")


def parse_tag_query(tag_query: str) -> List[str]:
    """단일 태그 또는 'A OR B OR C' → 태그명 목록(빈 조각·중복 제거, 원 순서 유지)."""
    parts = _OR_SPLIT.split(tag_query or "")
    names: List[str] = []
    seen = set()
    for part in parts:
        name = part.strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def _validate_tag_query(tag_query: str) -> None:
    if not tag_query or not tag_query.strip():
        raise ValidationAppError("tag_query는 비어 있을 수 없습니다")
    if _DISALLOWED_SYNTAX.search(tag_query):
        raise ValidationAppError(
            "tag_query는 단일 태그 또는 OR 결합만 지원합니다 (AND·괄호·NOT 불가 — R13)",
            detail={"tag_query": tag_query},
        )


def _validate_mode(mode: str) -> None:
    if mode not in ("suggest", "auto"):
        raise ValidationAppError(
            "mode는 'suggest' 또는 'auto'여야 합니다", detail={"mode": mode}
        )


def get_rule_or_404(db: Session, rule_id: int) -> models.TagRule:
    rule = db.get(models.TagRule, rule_id)
    if rule is None:
        raise NotFoundError("태그 규칙을 찾을 수 없습니다", detail={"tag_rule_id": rule_id})
    return rule


def list_rules(db: Session) -> List[models.TagRule]:
    return db.execute(
        select(models.TagRule).order_by(models.TagRule.id)
    ).scalars().all()


def create_rule(db: Session, *, category_id: int, tag_query: str, mode: str) -> models.TagRule:
    category = db.get(models.Category, category_id)
    if category is None:
        raise NotFoundError("분류를 찾을 수 없습니다", detail={"category_id": category_id})
    _validate_tag_query(tag_query)
    _validate_mode(mode)

    rule = models.TagRule(category_id=category_id, tag_query=tag_query.strip(), mode=mode)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def update_rule(
    db: Session,
    rule_id: int,
    *,
    category_id: Optional[int],
    tag_query: Optional[str],
    mode: Optional[str],
) -> models.TagRule:
    rule = get_rule_or_404(db, rule_id)
    if category_id is not None:
        category = db.get(models.Category, category_id)
        if category is None:
            raise NotFoundError("분류를 찾을 수 없습니다", detail={"category_id": category_id})
        rule.category_id = category_id
    if tag_query is not None:
        _validate_tag_query(tag_query)
        rule.tag_query = tag_query.strip()
    if mode is not None:
        _validate_mode(mode)
        rule.mode = mode
    db.commit()
    db.refresh(rule)
    return rule


def delete_rule(db: Session, rule_id: int) -> None:
    rule = get_rule_or_404(db, rule_id)
    # 연결·제안 이력은 유지하되 규칙 참조만 SET NULL (설계 §4.9 — 물리 삭제 금지 원칙과 정합)
    db.execute(
        models.CategoryDocument.__table__.update()
        .where(models.CategoryDocument.linked_rule_id == rule_id)
        .values(linked_rule_id=None)
    )
    db.execute(
        models.Suggestion.__table__.update()
        .where(models.Suggestion.tag_rule_id == rule_id)
        .values(tag_rule_id=None)
    )
    db.delete(rule)
    db.commit()


def _document_tag_names(db: Session, document_id: int) -> List[str]:
    return db.execute(
        select(models.Tag.name)
        .join(models.DocumentTag, models.DocumentTag.tag_id == models.Tag.id)
        .where(models.DocumentTag.document_id == document_id)
    ).scalars().all()


def _next_sort_order(db: Session, category_id: int) -> int:
    max_sort = db.execute(
        select(func.max(models.CategoryDocument.sort_order)).where(
            models.CategoryDocument.category_id == category_id
        )
    ).scalar()
    return (max_sort or 0) + 1


_APPLIED_EXAM_ORIGIN = "applied_exam"


def _is_applied_exam_generated(db: Session, document_id: int) -> bool:
    """S24(F50 ②, stage-reviewer 지적 — 중요 1) — 문서 기준으로 응용 모의고사 생성물인지
    판정한다. 신호 2개를 OR로 본다(단일 신호 의존 시 사용자의 일반 편집 경로 하나만으로
    감지를 피할 수 있는 문제 방지 — 방어 심도):

      ⓐ `category_documents.linked_by='applied_exam'` — 격리 런 분류 연결(생성 시 부여,
         `applied_exam_service._save_generated`). 사용자가 `remove_link`로 분류 연결을
         해제하면 이 신호는 사라질 수 있다.
      ⓑ `document_relations.created_by='applied_exam'` — 근거(`derived_from`) 연결(생성
         시 부여, 검증 게이트가 basis 1개 이상을 강제하므로 통과 문항은 항상 이 관계를
         갖는다). 사용자가 `remove_relation`으로 관계를 해제하면 이 신호도 사라질 수 있다.

    두 경로 모두 문서 삭제(소프트 삭제 `is_active=0` 포함)와 무관하게 조회하므로 삭제
    상태와 관계없이 판정이 성립한다(단순 존재 질의 — `is_active` 조건을 걸지 않는다).
    두 신호가 전부 사용자의 명시적 조작으로 제거된 극단적 사례에는 더 이상 판정할 수
    없지만, 그 경우는 사용자가 두 번의 별개 승인 경로(연결 해제·관계 해제)를 스스로
    거친 뒤이므로 R22가 막으려는 "승인 없는 자동 연결"에 해당하지 않는다.
    """
    has_isolation_link = (
        db.execute(
            select(models.CategoryDocument.document_id).where(
                models.CategoryDocument.document_id == document_id,
                models.CategoryDocument.linked_by == _APPLIED_EXAM_ORIGIN,
            )
        ).first()
        is not None
    )
    if has_isolation_link:
        return True

    has_derived_relation = (
        db.execute(
            select(models.DocumentRelation.from_document_id).where(
                models.DocumentRelation.from_document_id == document_id,
                models.DocumentRelation.created_by == _APPLIED_EXAM_ORIGIN,
            )
        ).first()
        is not None
    )
    return has_derived_relation


def _apply_rule_to_document(
    db: Session, rule: models.TagRule, document_id: int, *, force_suggest: bool = False
) -> Optional[str]:
    """규칙 하나 vs 문서 하나 매칭 처리. 커밋하지 않는다(호출부가 트랜잭션을 관리).

    반환: 'linked'(auto 즉시 연결) | 'suggested'(pending 제안 생성) | None(중복이라 아무 일도 안 함).

    S24(F50 ②, stage-reviewer 지적 — 중요 1): 판정을 여기 한 곳으로 내린다 — 대상
    문서가 `_is_applied_exam_generated`(문서 기준)면 규칙 mode·호출부 플래그와 무관하게
    항상 suggested로만 귀결된다(`scan_document`·`scan_rule` 전수가 이 함수를 경유하므로
    어느 트리거로 들어와도 같은 판정을 받는다). `force_suggest`(기본 False — 일반 문서의
    auto 규칙 의미론은 무변경)는 생성 직후 호출(같은 트랜잭션 내 아직 플러시되지 않은
    신호를 문서 기준 판정이 못 볼 수 있는 창)의 명시적 보강 신호로 남겨둔다.
    """
    existing_link = db.get(
        models.CategoryDocument, {"category_id": rule.category_id, "document_id": document_id}
    )
    if existing_link is not None:
        return None

    existing_suggestion = db.execute(
        select(models.Suggestion).where(
            models.Suggestion.document_id == document_id,
            models.Suggestion.category_id == rule.category_id,
        )
    ).scalar_one_or_none()
    if existing_suggestion is not None:
        return None

    force_via_document = force_suggest or _is_applied_exam_generated(db, document_id)
    if rule.mode == "auto" and not force_via_document:
        db.add(
            models.CategoryDocument(
                category_id=rule.category_id,
                document_id=document_id,
                linked_by="rule",
                linked_rule_id=rule.id,
                sort_order=_next_sort_order(db, rule.category_id),
            )
        )
        db.flush()
        return "linked"

    db.add(
        models.Suggestion(
            document_id=document_id,
            category_id=rule.category_id,
            tag_rule_id=rule.id,
            status="pending",
        )
    )
    db.flush()
    return "suggested"


def scan_document(db: Session, document_id: int, *, force_suggest: bool = False) -> Dict[str, int]:
    """트리거 1·2 — 문서 하나에 전체 규칙을 적용. 커밋은 호출부 책임.

    `force_suggest`(기본 False — 기존 호출부 전부 무변경)는 `_apply_rule_to_document`가
    문서 기준 판정과 OR로 함께 보는 보강 신호일 뿐, 근본 방어선은 문서 기준 판정이다
    (S24 — F50 ②, stage-reviewer 지적 — 중요 1).
    """
    counts = {"linked": 0, "suggested": 0}
    tags = _document_tag_names(db, document_id)
    if not tags:
        return counts
    tag_set = set(tags)

    for rule in list_rules(db):
        query_tags = parse_tag_query(rule.tag_query)
        if not any(t in tag_set for t in query_tags):
            continue
        result = _apply_rule_to_document(db, rule, document_id, force_suggest=force_suggest)
        if result:
            counts[result] += 1
    return counts


def scan_rule(db: Session, rule_id: int) -> int:
    """트리거 3 — `POST /api/tag-rules/{id}/scan`. 기존 활성 문서 전체를 훑어 이 규칙만
    적용한다. 반환값(`created`) = 새로 만든 제안 + 즉시 연결 합계."""
    rule = get_rule_or_404(db, rule_id)
    query_tags = parse_tag_query(rule.tag_query)
    if not query_tags:
        return 0

    doc_ids = db.execute(
        select(models.DocumentTag.document_id)
        .join(models.Tag, models.Tag.id == models.DocumentTag.tag_id)
        .join(models.Document, models.Document.id == models.DocumentTag.document_id)
        .where(models.Tag.name.in_(query_tags), models.Document.is_active == 1)
        .distinct()
    ).scalars().all()

    created = 0
    for doc_id in doc_ids:
        result = _apply_rule_to_document(db, rule, doc_id)
        if result:
            created += 1
    db.commit()
    return created


def unlink_rule(db: Session, rule_id: int) -> int:
    """`POST /api/tag-rules/{id}/unlink` — 이 규칙이 연결한 링크를 일괄 해제(연결 해제일
    뿐, 문서·분류 자체는 그대로 — 불변 규칙 3)."""
    get_rule_or_404(db, rule_id)
    rows = db.execute(
        select(models.CategoryDocument).where(models.CategoryDocument.linked_rule_id == rule_id)
    ).scalars().all()
    count = len(rows)
    for row in rows:
        db.delete(row)
    db.commit()
    return count
