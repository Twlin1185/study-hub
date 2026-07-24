from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from database import get_db
from exceptions import ValidationAppError
from schemas.common import Page
from schemas.convert import (
    RegenerateJobStart,
    RegenerateJobStatus,
    RegenerateRequest,
)
from schemas.document import (
    DocumentCreate,
    DocumentDetail,
    DocumentListItem,
    DocumentUpdate,
    LinkCreate,
    RelationCreate,
    TagsReplace,
)
from services import convert_service, document_service

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("", response_model=Page[DocumentListItem])
def list_documents(
    category_id: Optional[int] = None,
    deep: bool = False,
    type: Optional[str] = None,  # noqa: A002 - 설계 §4.2의 쿼리 파라미터명 그대로
    tag: Optional[str] = None,
    orphan: bool = False,
    bookmarked: bool = False,
    include_inactive: bool = False,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Page[DocumentListItem]:
    items, total = document_service.list_documents(
        db,
        category_id=category_id,
        deep=deep,
        doc_type=type,
        tag=tag,
        orphan=orphan,
        bookmarked=bookmarked,
        include_inactive=include_inactive,
        page=page,
        size=size,
    )
    return Page[DocumentListItem](items=items, total=total, page=page, size=size)


@router.get("/batch", response_model=List[DocumentDetail])
def get_documents_batch(
    ids: str = Query(..., description="콤마로 구분된 문서 id 목록"),
    db: Session = Depends(get_db),
) -> List[DocumentDetail]:
    try:
        id_list = [int(part) for part in ids.split(",") if part.strip() != ""]
    except ValueError as exc:
        raise ValidationAppError(
            "ids는 콤마로 구분된 정수 목록이어야 합니다", detail={"ids": ids}
        ) from exc
    return document_service.get_documents_batch(db, id_list)


@router.post("", response_model=DocumentDetail, status_code=status.HTTP_201_CREATED)
def create_document(
    payload: DocumentCreate, db: Session = Depends(get_db)
) -> DocumentDetail:
    document = document_service.create_document(db, payload)
    return document_service.get_document_detail(db, document.id)


@router.get("/{document_id}", response_model=DocumentDetail)
def get_document(document_id: int, db: Session = Depends(get_db)) -> DocumentDetail:
    return document_service.get_document_detail(db, document_id)


@router.patch("/{document_id}", response_model=DocumentDetail)
def update_document(
    document_id: int, payload: DocumentUpdate, db: Session = Depends(get_db)
) -> DocumentDetail:
    document_service.update_document(db, document_id, payload)
    return document_service.get_document_detail(db, document_id)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: int, db: Session = Depends(get_db)) -> None:
    document_service.soft_delete_document(db, document_id)


@router.put("/{document_id}/tags", response_model=DocumentDetail)
def replace_tags(
    document_id: int, payload: TagsReplace, db: Session = Depends(get_db)
) -> DocumentDetail:
    document_service.replace_tags(db, document_id, payload.tags)
    return document_service.get_document_detail(db, document_id)


@router.post("/{document_id}/links", response_model=DocumentDetail, status_code=status.HTTP_200_OK)
def add_link(
    document_id: int, payload: LinkCreate, db: Session = Depends(get_db)
) -> DocumentDetail:
    """분류 연결 upsert — 신규 연결이면 생성, 이미 연결돼 있으면 명시적으로 보낸 필드만 갱신."""
    document_service.add_link(db, document_id, payload)
    return document_service.get_document_detail(db, document_id)


@router.delete("/{document_id}/links/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_link(
    document_id: int, category_id: int, db: Session = Depends(get_db)
) -> None:
    document_service.remove_link(db, document_id, category_id)


@router.post("/{document_id}/relations", response_model=DocumentDetail)
def add_relation(
    document_id: int, payload: RelationCreate, db: Session = Depends(get_db)
) -> DocumentDetail:
    document_service.add_relation(db, document_id, payload)
    return document_service.get_document_detail(db, document_id)


@router.delete("/{document_id}/relations/{to_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_relation(
    document_id: int, to_id: int, db: Session = Depends(get_db)
) -> None:
    document_service.remove_relation(db, document_id, to_id)


@router.put("/{document_id}/bookmark", response_model=DocumentDetail)
def add_bookmark(document_id: int, db: Session = Depends(get_db)) -> DocumentDetail:
    document_service.add_bookmark(db, document_id)
    return document_service.get_document_detail(db, document_id)


@router.delete("/{document_id}/bookmark", response_model=DocumentDetail)
def remove_bookmark(document_id: int, db: Session = Depends(get_db)) -> DocumentDetail:
    document_service.remove_bookmark(db, document_id)
    return document_service.get_document_detail(db, document_id)


@router.post(
    "/{document_id}/regenerate",
    response_model=RegenerateJobStart,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_regenerate(
    document_id: int, payload: RegenerateRequest, db: Session = Depends(get_db)
) -> RegenerateJobStart:
    """오류 신고 → 재생성 잡 시작 (F30). convert 잡 큐 재사용(동시 1개)."""
    job_id = convert_service.start_regenerate_job(db, document_id, payload.reason, engine=payload.engine)
    return RegenerateJobStart(job_id=job_id)


@router.get("/{document_id}/regenerate/{job_id}", response_model=RegenerateJobStatus)
def get_regenerate_status(document_id: int, job_id: str) -> RegenerateJobStatus:
    return RegenerateJobStatus(**convert_service.get_regenerate_job(document_id, job_id))


@router.post("/{document_id}/regenerate/{job_id}/apply", response_model=DocumentDetail)
def apply_regenerate(
    document_id: int, job_id: str, db: Session = Depends(get_db)
) -> DocumentDetail:
    """초안 승인 — 같은 문서 id·doc_no 유지, attempts·오답노트·SRS 이력 보존(R7)."""
    convert_service.apply_regenerate_job(db, document_id, job_id)
    return document_service.get_document_detail(db, document_id)
