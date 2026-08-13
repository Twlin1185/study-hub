"""문서 CRUD·연결·태그·관계·북마크 비즈니스 로직."""
from __future__ import annotations

import json
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import cast, func, select, Integer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from exceptions import ConflictError, NotFoundError, ValidationAppError
from schemas.document import (
    DocumentCreate,
    DocumentDetail,
    DocumentListItem,
    DocumentRelationOut,
    DocumentSrs,
    DocumentStats,
    DocumentUsage,
    DocumentUpdate,
    LastAttempt,
    LinkCreate,
    RelationCreate,
)
from services import embed_service, tag_rule_service
from services.tag_service import get_or_create_tag

DOC_NO_PREFIX = "DOC-"


def _decode_style(raw: str | None) -> Optional[Dict[str, str]]:
    """`documents.style` TEXT 컬럼 디코딩 — 손상 데이터 방어.

    저장 경로(update_document)가 None 값 키를 걸러내지만, 과거 데이터나 직접 DB
    조작으로 `{"font": null, ...}` 형태가 남아 있어도 GET이 500을 내지 않도록 None
    값·비문자열 값 키는 드롭한다(DocumentDetail.style: Dict[str, str] 계약 보호).
    """
    if not raw:
        return None
    try:
        decoded = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(decoded, dict):
        return None
    return {k: v for k, v in decoded.items() if isinstance(v, str)}


def get_document_or_404(db: Session, document_id: int) -> models.Document:
    document = db.get(models.Document, document_id)
    if document is None:
        raise NotFoundError(
            "문서를 찾을 수 없습니다", detail={"document_id": document_id}
        )
    return document


def _generate_doc_no(db: Session) -> str:
    max_no = db.execute(
        select(
            func.max(cast(func.substr(models.Document.doc_no, len(DOC_NO_PREFIX) + 1), Integer))
        )
    ).scalar()
    next_no = (max_no or 0) + 1
    return f"{DOC_NO_PREFIX}{next_no:04d}"


def _collect_descendant_ids(db: Session, category_id: int) -> List[int]:
    ids = [category_id]
    frontier = [category_id]
    while frontier:
        children = db.execute(
            select(models.Category.id).where(models.Category.parent_id.in_(frontier))
        ).scalars().all()
        if not children:
            break
        ids.extend(children)
        frontier = children
    return ids


def _category_path(db: Session, category_id: int) -> str:
    parts: List[str] = []
    current: Optional[models.Category] = db.get(models.Category, category_id)
    while current is not None:
        parts.append(current.name)
        current = db.get(models.Category, current.parent_id) if current.parent_id else None
    return "/".join(reversed(parts))


def _tags_for_document(db: Session, document_id: int) -> List[str]:
    rows = db.execute(
        select(models.Tag.name)
        .join(models.DocumentTag, models.DocumentTag.tag_id == models.Tag.id)
        .where(models.DocumentTag.document_id == document_id)
        .order_by(models.Tag.name)
    ).scalars().all()
    return list(rows)


def _usage_count(db: Session, document_id: int) -> int:
    return db.execute(
        select(func.count())
        .select_from(models.CategoryDocument)
        .where(models.CategoryDocument.document_id == document_id)
    ).scalar_one()


def _bookmarked_ids(db: Session, document_ids: List[int]) -> Set[int]:
    if not document_ids:
        return set()
    rows = db.execute(
        select(models.Bookmark.document_id).where(
            models.Bookmark.document_id.in_(document_ids)
        )
    ).scalars().all()
    return set(rows)


def is_bookmarked(db: Session, document_id: int) -> bool:
    return db.get(models.Bookmark, document_id) is not None


def list_documents(
    db: Session,
    *,
    category_id: Optional[int] = None,
    deep: bool = False,
    doc_type: Optional[str] = None,
    tag: Optional[str] = None,
    orphan: bool = False,
    bookmarked: bool = False,
    include_inactive: bool = False,
    page: int = 1,
    size: int = 50,
) -> Tuple[List[DocumentListItem], int]:
    query = select(models.Document.id).distinct()

    if not include_inactive:
        query = query.where(models.Document.is_active == 1)

    if doc_type:
        query = query.where(models.Document.type == doc_type)

    if category_id is not None:
        category_ids = (
            _collect_descendant_ids(db, category_id) if deep else [category_id]
        )
        query = query.join(
            models.CategoryDocument,
            models.CategoryDocument.document_id == models.Document.id,
        ).where(models.CategoryDocument.category_id.in_(category_ids))

    if tag:
        query = query.join(
            models.DocumentTag, models.DocumentTag.document_id == models.Document.id
        ).join(models.Tag, models.Tag.id == models.DocumentTag.tag_id).where(
            models.Tag.name == tag
        )

    if orphan:
        linked_ids = select(models.CategoryDocument.document_id)
        query = query.where(models.Document.id.notin_(linked_ids))

    if bookmarked:
        bookmarked_ids = select(models.Bookmark.document_id)
        query = query.where(models.Document.id.in_(bookmarked_ids))

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()

    ids = db.execute(
        query.order_by(models.Document.id.desc()).offset((page - 1) * size).limit(size)
    ).scalars().all()

    documents = []
    if ids:
        documents = db.execute(
            select(models.Document)
            .where(models.Document.id.in_(ids))
            .order_by(models.Document.id.desc())
        ).scalars().all()

    bookmarked_set = _bookmarked_ids(db, [doc.id for doc in documents])

    items = [
        DocumentListItem(
            id=doc.id,
            doc_no=doc.doc_no,
            type=doc.type,
            title=doc.title,
            difficulty=doc.difficulty,
            is_active=bool(doc.is_active),
            tags=_tags_for_document(db, doc.id),
            usage_count=_usage_count(db, doc.id),
            bookmarked=doc.id in bookmarked_set,
            created_at=doc.created_at,
            updated_at=doc.updated_at,
        )
        for doc in documents
    ]
    return items, total


def create_document(db: Session, payload: DocumentCreate) -> models.Document:
    is_question = payload.type in ("question", "past_question")
    if is_question and not payload.answer:
        raise ValidationAppError(
            "문제 타입 문서는 정답(answer)이 필요합니다", detail={"type": payload.type}
        )

    for attempt in range(3):
        doc_no = _generate_doc_no(db)
        document = models.Document(
            doc_no=doc_no,
            type=payload.type,
            title=payload.title,
            content=payload.content,
            choices=json.dumps(payload.choices, ensure_ascii=False) if payload.choices is not None else None,
            answer=payload.answer,
            explanation=payload.explanation,
            difficulty=payload.difficulty,
            source_id=payload.source_id,
            source_detail=payload.source_detail,
        )
        db.add(document)
        try:
            db.flush()  # id 확보 — embeds 동기화가 from_document_id로 참조한다
            embed_service.sync_embeds_for_document(db, document)
            db.commit()
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise
            continue
        db.refresh(document)
        return document
    raise ConflictError("문서 번호 채번에 실패했습니다")  # pragma: no cover


def update_document(
    db: Session, document_id: int, payload: DocumentUpdate
) -> models.Document:
    document = get_document_or_404(db, document_id)
    data = payload.model_dump(exclude_unset=True)
    if "choices" in data:
        data["choices"] = (
            json.dumps(data["choices"], ensure_ascii=False)
            if data["choices"] is not None
            else None
        )
    if "style" in data:
        # null = 전체 해제(NULL 저장). dict는 화이트리스트 검증을 이미 통과했다
        # (schemas/document.py DocumentStyle — 하위 키의 명시적 None은 422로 걸러진다).
        # exclude_none은 2차 방어(review 지적) — 정상 경로에서는 이미 None이 없어야
        # 하지만, None이 그대로 저장되면 GET 시 DocumentDetail.style: Dict[str, str]
        # 응답 검증이 깨져 500이 나므로 저장 직전에 한 번 더 걸러낸다.
        style_value = data["style"]
        data["style"] = (
            json.dumps(
                {k: v for k, v in style_value.items() if v is not None},
                ensure_ascii=False,
            )
            if style_value is not None
            else None
        )
    for field, value in data.items():
        setattr(document, field, value)
    if "content" in data:
        # embeds 인덱스 동기화(§4.19 ⑥) — content 변경 시에만, 문서 저장과 같은 트랜잭션
        embed_service.sync_embeds_for_document(db, document)
    db.commit()
    db.refresh(document)
    return document


def soft_delete_document(db: Session, document_id: int) -> None:
    document = get_document_or_404(db, document_id)
    document.is_active = 0
    db.commit()


def get_document_detail(db: Session, document_id: int) -> DocumentDetail:
    document = get_document_or_404(db, document_id)

    usage_rows = db.execute(
        select(models.CategoryDocument).where(
            models.CategoryDocument.document_id == document_id
        )
    ).scalars().all()
    usages = [
        DocumentUsage(
            category_id=row.category_id,
            path=_category_path(db, row.category_id),
            local_note=row.local_note,
        )
        for row in usage_rows
    ]

    attempts_count = db.execute(
        select(func.count())
        .select_from(models.Attempt)
        .where(models.Attempt.document_id == document_id)
    ).scalar_one()
    correct_count = db.execute(
        select(func.count())
        .select_from(models.Attempt)
        .where(
            models.Attempt.document_id == document_id,
            models.Attempt.is_correct == 1,
        )
    ).scalar_one()
    accuracy = (correct_count / attempts_count) if attempts_count else 0.0

    recent_rows = db.execute(
        select(models.Attempt.is_correct)
        .where(models.Attempt.document_id == document_id)
        .order_by(models.Attempt.answered_at.desc())
        .limit(10)
    ).scalars().all()
    recent = [bool(value) for value in reversed(recent_rows)]

    last_attempt_row = db.execute(
        select(models.Attempt)
        .where(models.Attempt.document_id == document_id)
        .order_by(models.Attempt.answered_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    last_attempt = (
        LastAttempt(
            my_answer=last_attempt_row.my_answer,
            is_correct=bool(last_attempt_row.is_correct),
            created_at=last_attempt_row.answered_at,
        )
        if last_attempt_row is not None
        else None
    )

    srs_card = db.get(models.SrsCard, document_id)
    srs_info = (
        DocumentSrs(
            due_date=srs_card.due_date,
            ease_factor=srs_card.ease_factor,
            interval_days=srs_card.interval_days,
            repetitions=srs_card.repetitions,
        )
        if srs_card is not None
        else None
    )

    return DocumentDetail(
        id=document.id,
        doc_no=document.doc_no,
        type=document.type,
        title=document.title,
        content=document.content,
        choices=json.loads(document.choices) if document.choices else None,
        answer=document.answer,
        explanation=document.explanation,
        difficulty=document.difficulty,
        style=_decode_style(document.style),
        source_id=document.source_id,
        source_detail=document.source_detail,
        is_active=bool(document.is_active),
        forked_from=document.forked_from,
        created_at=document.created_at,
        updated_at=document.updated_at,
        tags=_tags_for_document(db, document.id),
        usages=usages,
        relations=_relations_for_document(db, document.id),
        bookmarked=is_bookmarked(db, document.id),
        stats=DocumentStats(
            attempts=attempts_count,
            accuracy=round(accuracy, 4),
            recent=recent,
            last_attempt=last_attempt,
            srs=srs_info,
        ),
    )


def _relations_for_document(db: Session, document_id: int) -> List[DocumentRelationOut]:
    """이 문서와 연결된 관계 전부 — 이 문서가 선언한 것(direction='from')과
    상대가 선언한 것(direction='to') 둘 다 포함한다 (§5.3 "이 문제의 개념"/"확인 문제").
    """
    outgoing = db.execute(
        select(models.DocumentRelation, models.Document)
        .join(models.Document, models.Document.id == models.DocumentRelation.to_document_id)
        .where(models.DocumentRelation.from_document_id == document_id)
    ).all()
    incoming = db.execute(
        select(models.DocumentRelation, models.Document)
        .join(models.Document, models.Document.id == models.DocumentRelation.from_document_id)
        .where(models.DocumentRelation.to_document_id == document_id)
    ).all()

    items: List[DocumentRelationOut] = []
    for relation, other in outgoing:
        items.append(
            DocumentRelationOut(
                document_id=other.id,
                doc_no=other.doc_no,
                title=other.title,
                type=other.type,
                relation=relation.relation,
                direction="from",
            )
        )
    for relation, other in incoming:
        items.append(
            DocumentRelationOut(
                document_id=other.id,
                doc_no=other.doc_no,
                title=other.title,
                type=other.type,
                relation=relation.relation,
                direction="to",
            )
        )
    return items


def add_relation(db: Session, document_id: int, payload: RelationCreate) -> None:
    document = get_document_or_404(db, document_id)
    if payload.to_document_id == document.id:
        raise ValidationAppError(
            "자기 자신과 관계를 맺을 수 없습니다", detail={"document_id": document_id}
        )
    other = db.get(models.Document, payload.to_document_id)
    if other is None:
        raise NotFoundError(
            "대상 문서를 찾을 수 없습니다", detail={"document_id": payload.to_document_id}
        )

    existing = db.get(
        models.DocumentRelation,
        {
            "from_document_id": document.id,
            "to_document_id": payload.to_document_id,
            "relation": payload.relation,
        },
    )
    if existing is None:
        db.add(
            models.DocumentRelation(
                from_document_id=document.id,
                to_document_id=payload.to_document_id,
                relation=payload.relation,
            )
        )
        db.commit()


def remove_relation(db: Session, document_id: int, to_document_id: int) -> None:
    """수동 관계(explains 등) 해제. `relation='embeds'`는 본문 파싱이 만드는 파생 인덱스라
    이 경로로 지우지 않는다 — 지워도 본문의 `![[...]]`가 그대로면 다음 저장·재계산 때
    되살아나 사용자 입장에서는 "안 지워진다"로 보이고, 그 사이 인덱스만 소실된다(검토
    경미-1, R20). 프론트가 embeds를 판별하는 기준(`relation === 'embeds'`)과 동일하게
    relation 값만으로 제외한다."""
    get_document_or_404(db, document_id)
    rows = db.execute(
        select(models.DocumentRelation).where(
            models.DocumentRelation.from_document_id == document_id,
            models.DocumentRelation.to_document_id == to_document_id,
            models.DocumentRelation.relation != "embeds",
        )
    ).scalars().all()
    if not rows:
        raise NotFoundError(
            "관계를 찾을 수 없습니다",
            detail={"document_id": document_id, "to_document_id": to_document_id},
        )
    for row in rows:
        db.delete(row)
    db.commit()


def add_bookmark(db: Session, document_id: int) -> None:
    get_document_or_404(db, document_id)
    if db.get(models.Bookmark, document_id) is None:
        db.add(models.Bookmark(document_id=document_id))
        db.commit()


def remove_bookmark(db: Session, document_id: int) -> None:
    get_document_or_404(db, document_id)
    bookmark = db.get(models.Bookmark, document_id)
    if bookmark is None:
        raise NotFoundError(
            "북마크를 찾을 수 없습니다", detail={"document_id": document_id}
        )
    db.delete(bookmark)
    db.commit()


def get_documents_batch(db: Session, ids: List[int]) -> List[DocumentDetail]:
    """인쇄 뷰 등 다건 조회 (설계 §4.2) — 요청 순서를 유지하고, 없거나 비활성인 id는 건너뛴다."""
    if not ids:
        return []
    rows = db.execute(
        select(models.Document).where(
            models.Document.id.in_(ids), models.Document.is_active == 1
        )
    ).scalars().all()
    by_id: Dict[int, models.Document] = {doc.id: doc for doc in rows}
    ordered_ids = [doc_id for doc_id in ids if doc_id in by_id]
    return [get_document_detail(db, doc_id) for doc_id in ordered_ids]


def _apply_tag_replacement(db: Session, document: models.Document, tag_names: List[str]) -> None:
    """태그 전체 교체(커밋하지 않음) — replace_tags·재생성 승인 등에서 공용으로 쓴다."""
    normalized = []
    seen = set()
    for name in tag_names:
        clean = name.strip()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        normalized.append(clean)

    db.execute(
        models.DocumentTag.__table__.delete().where(
            models.DocumentTag.document_id == document.id
        )
    )
    for name in normalized:
        tag = get_or_create_tag(db, name)
        db.add(models.DocumentTag(document_id=document.id, tag_id=tag.id))
    db.flush()


def replace_tags(db: Session, document_id: int, tag_names: List[str]) -> List[str]:
    document = get_document_or_404(db, document_id)
    _apply_tag_replacement(db, document, tag_names)
    # 트리거 2: 태그 변경 시 — 태그 자동 분류 규칙 스캔 (설계 §4.9, 계획서 §11)
    tag_rule_service.scan_document(db, document.id)
    db.commit()
    return _tags_for_document(db, document.id)


def add_link(db: Session, document_id: int, payload: LinkCreate) -> None:
    """분류 연결 upsert.

    이미 연결되어 있으면 요청 본문에 명시적으로 포함된 필드만 갱신한다
    (local_note를 안 보내면 기존 값 유지 — 설계 §5.3 사용처 local_note 인라인 편집이
    이 엔드포인트를 재사용하므로 그때 기존 값을 지우지 않기 위함).
    연결이 없으면 새로 생성한다.
    """
    document = get_document_or_404(db, document_id)
    category = db.get(models.Category, payload.category_id)
    if category is None:
        raise NotFoundError(
            "분류를 찾을 수 없습니다", detail={"category_id": payload.category_id}
        )

    existing = db.get(
        models.CategoryDocument, {"category_id": payload.category_id, "document_id": document.id}
    )

    if existing is not None:
        updates = payload.model_dump(exclude_unset=True, exclude={"category_id"})
        for field, value in updates.items():
            if field == "sort_order" and value is None:
                continue
            setattr(existing, field, value)
    else:
        link = models.CategoryDocument(
            category_id=payload.category_id,
            document_id=document.id,
            local_note=payload.local_note,
            sort_order=payload.sort_order or 0,
        )
        db.add(link)

    db.commit()


def remove_link(db: Session, document_id: int, category_id: int) -> None:
    get_document_or_404(db, document_id)
    link = db.get(
        models.CategoryDocument, {"category_id": category_id, "document_id": document_id}
    )
    if link is None:
        raise NotFoundError(
            "연결을 찾을 수 없습니다",
            detail={"category_id": category_id, "document_id": document_id},
        )
    db.delete(link)
    db.commit()
