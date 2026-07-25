"""태그 비즈니스 로직."""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import models
from exceptions import ConflictError, NotFoundError, ValidationAppError
from services import tag_rule_service


def get_or_create_tag(db: Session, name: str) -> models.Tag:
    normalized = name.strip()
    tag = db.execute(
        select(models.Tag).where(models.Tag.name == normalized)
    ).scalar_one_or_none()
    if tag is None:
        tag = models.Tag(name=normalized)
        db.add(tag)
        db.flush()
    return tag


def _normalize_for_dedup(name: str) -> str:
    """중복·유사 판정용 정규화 — 공백 전부 제거 + 소문자 (설계 §4.12)."""
    return re.sub(r"\s+", "", name).lower()


def _rule_counts_by_tag_name(db: Session) -> Dict[str, int]:
    """태그명 → 이 태그를 참조하는 tag_rules 수 (tag_query는 단일 태그 또는 OR 결합, R13)."""
    tag_queries = db.execute(select(models.TagRule.tag_query)).scalars().all()
    counts: Dict[str, int] = defaultdict(int)
    for tag_query in tag_queries:
        for name in tag_rule_service.parse_tag_query(tag_query):
            counts[name] += 1
    return counts


def list_tags(db: Session) -> List[dict]:
    rows = db.execute(
        select(
            models.Tag.id,
            models.Tag.name,
            func.count(models.DocumentTag.document_id).label("usage_count"),
        )
        .outerjoin(
            models.DocumentTag, models.DocumentTag.tag_id == models.Tag.id
        )
        .group_by(models.Tag.id)
        .order_by(func.count(models.DocumentTag.document_id).desc(), models.Tag.name)
    ).all()
    rule_counts = _rule_counts_by_tag_name(db)
    return [
        {
            "id": row.id,
            "name": row.name,
            "usage_count": row.usage_count,
            "rule_count": rule_counts.get(row.name, 0),
        }
        for row in rows
    ]


def get_tag_detail(db: Session, tag_id: int) -> dict:
    tag = db.get(models.Tag, tag_id)
    if tag is None:
        raise NotFoundError("태그를 찾을 수 없습니다", detail={"tag_id": tag_id})
    usage_count = db.execute(
        select(func.count())
        .select_from(models.DocumentTag)
        .where(models.DocumentTag.tag_id == tag_id)
    ).scalar_one()
    rule_counts = _rule_counts_by_tag_name(db)
    return {
        "id": tag.id,
        "name": tag.name,
        "usage_count": usage_count,
        "rule_count": rule_counts.get(tag.name, 0),
    }


def rename_tag(db: Session, tag_id: int, new_name: str) -> models.Tag:
    """`PATCH /api/tags/{id}` — 정규화(공백 제거·소문자) 후 기존 태그와 중복이면 409
    (설계 §4.12). `document_tags`는 tag_id 참조이므로 UPDATE 한 번으로 전 문서 반영."""
    tag = db.get(models.Tag, tag_id)
    if tag is None:
        raise NotFoundError("태그를 찾을 수 없습니다", detail={"tag_id": tag_id})

    stripped = new_name.strip()
    if not stripped:
        raise ValidationAppError("태그 이름은 비어 있을 수 없습니다")

    normalized_new = _normalize_for_dedup(stripped)
    others = db.execute(
        select(models.Tag).where(models.Tag.id != tag_id)
    ).scalars().all()
    for other in others:
        if _normalize_for_dedup(other.name) == normalized_new:
            raise ConflictError(
                "이미 사용 중인 태그 이름입니다. 병합을 사용하세요",
                detail={"existing_tag_id": other.id, "existing_tag_name": other.name},
            )

    tag.name = stripped
    db.commit()
    db.refresh(tag)
    return tag


def delete_tag(db: Session, tag_id: int) -> None:
    """`DELETE /api/tags/{id}` — 미사용(doc_count=0·규칙 미참조)만. 사용 중이면 409
    (설계 §4.12) — 정리는 병합으로 유도."""
    tag = db.get(models.Tag, tag_id)
    if tag is None:
        raise NotFoundError("태그를 찾을 수 없습니다", detail={"tag_id": tag_id})

    usage_count = db.execute(
        select(func.count())
        .select_from(models.DocumentTag)
        .where(models.DocumentTag.tag_id == tag_id)
    ).scalar_one()
    if usage_count > 0:
        raise ConflictError(
            "사용 중인 태그는 삭제할 수 없습니다. 병합을 사용하세요",
            detail={"tag_id": tag_id, "doc_count": usage_count},
        )

    rule_counts = _rule_counts_by_tag_name(db)
    if rule_counts.get(tag.name, 0) > 0:
        raise ConflictError(
            "태그 규칙에서 참조 중인 태그는 삭제할 수 없습니다. 규칙을 먼저 정리하세요",
            detail={"tag_id": tag_id, "rule_count": rule_counts.get(tag.name, 0)},
        )

    db.delete(tag)
    db.commit()


def _edit_distance_at_most_one(a: str, b: str) -> bool:
    """편집거리(삽입/삭제/치환) 1 이내인지 — 개인 규모 O(n^2) 전수 비교용 경량 구현."""
    if a == b:
        return False
    len_a, len_b = len(a), len(b)
    if abs(len_a - len_b) > 1:
        return False

    if len_a == len_b:
        mismatches = sum(1 for x, y in zip(a, b) if x != y)
        return mismatches == 1

    shorter, longer = (a, b) if len_a < len_b else (b, a)
    i = j = 0
    diff = 0
    while i < len(shorter) and j < len(longer):
        if shorter[i] == longer[j]:
            i += 1
            j += 1
        else:
            diff += 1
            if diff > 1:
                return False
            j += 1
    return True


def _classify_similarity(name_a: str, name_b: str) -> Optional[str]:
    """공백만 다름='space' / (공백 제거 후) 대소문자만 다름='case' / 편집거리 1='edit1'."""
    if name_a == name_b:
        return None

    stripped_a = re.sub(r"\s+", "", name_a)
    stripped_b = re.sub(r"\s+", "", name_b)
    if stripped_a == stripped_b:
        return "space"
    if stripped_a.lower() == stripped_b.lower():
        return "case"
    if _edit_distance_at_most_one(stripped_a.lower(), stripped_b.lower()):
        return "edit1"
    return None


def find_similar_tags(db: Session) -> List[dict]:
    """`GET /api/tags/similar` — 공백/대소문자/편집거리 1 유사 쌍, O(n^2) 전수 비교
    (개인 규모 충분 — 인덱스·캐시 없음, 설계 §4.12)."""
    rows = db.execute(
        select(
            models.Tag.id,
            models.Tag.name,
            func.count(models.DocumentTag.document_id).label("doc_count"),
        )
        .outerjoin(models.DocumentTag, models.DocumentTag.tag_id == models.Tag.id)
        .group_by(models.Tag.id)
        .order_by(models.Tag.name)
    ).all()
    tags = [{"id": row.id, "name": row.name, "doc_count": row.doc_count} for row in rows]

    pairs: List[dict] = []
    for i in range(len(tags)):
        for j in range(i + 1, len(tags)):
            reason = _classify_similarity(tags[i]["name"], tags[j]["name"])
            if reason:
                pairs.append({"a": tags[i], "b": tags[j], "reason": reason})
    return pairs


def merge_tags(db: Session, from_id: int, to_id: int) -> Dict[str, int]:
    """오타 태그 병합(F21 원칙 — 계획서 §11) — from_id가 붙은 문서를 to_id로 재배정하고
    from_id 태그 자체는 삭제한다. 이미 to_id가 붙어 있는 문서는 건너뛴다(PK 중복 방지)."""
    if from_id == to_id:
        raise ValidationAppError(
            "from_id와 to_id가 같습니다", detail={"from_id": from_id, "to_id": to_id}
        )
    from_tag = db.get(models.Tag, from_id)
    if from_tag is None:
        raise NotFoundError("병합할 태그(from_id)를 찾을 수 없습니다", detail={"tag_id": from_id})
    to_tag = db.get(models.Tag, to_id)
    if to_tag is None:
        raise NotFoundError("병합 대상 태그(to_id)를 찾을 수 없습니다", detail={"tag_id": to_id})

    from_doc_ids = db.execute(
        select(models.DocumentTag.document_id).where(models.DocumentTag.tag_id == from_id)
    ).scalars().all()
    to_doc_ids = set(
        db.execute(
            select(models.DocumentTag.document_id).where(models.DocumentTag.tag_id == to_id)
        ).scalars().all()
    )

    merged_count = 0
    for doc_id in from_doc_ids:
        if doc_id not in to_doc_ids:
            db.add(models.DocumentTag(document_id=doc_id, tag_id=to_id))
            merged_count += 1

    db.execute(
        models.DocumentTag.__table__.delete().where(models.DocumentTag.tag_id == from_id)
    )
    db.delete(from_tag)
    db.commit()
    return {"merged_documents": merged_count, "removed_tag_id": from_id}
