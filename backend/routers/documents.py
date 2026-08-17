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
from schemas.explain import ExplainDraft, ExplainJobStart, ExplainJobStatus, ExplainRequest
from schemas.document import (
    DocumentCreate,
    DocumentDetail,
    DocumentListItem,
    DocumentUpdate,
    LinkCreate,
    RelationCreate,
    TagsReplace,
)
from schemas.embed import ResolveEmbedsRequest, ResolveEmbedsResponse
from services import convert_service, document_service, embed_service

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


@router.get(
    "/batch",
    response_model=List[DocumentDetail],
    # batch는 인쇄 뷰 등에서 쓰는 다건 조회 — 에디터 v2 저장 전환 3필드는 목록·batch
    # 무변경 계약(설계 §4.29 ①)이라 응답에서 제외한다. 서비스 계층은 상세 조회와
    # 동일한 get_document_detail을 재사용하되(DRY), 직렬화 단계에서만 걷어낸다.
    # List[Model] 응답에서 필드를 걷어내려면 pydantic 관례상 "__all__" 키로 각 항목에
    # 적용해야 한다(평평한 set은 리스트 인덱스에 매칭돼 아무 것도 걸러내지 못한다).
    response_model_exclude={"__all__": {"content_blocks", "explanation_blocks", "blocks_version"}},
)
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


@router.post("/resolve-embeds", response_model=ResolveEmbedsResponse)
def resolve_embeds(
    payload: ResolveEmbedsRequest, db: Session = Depends(get_db)
) -> ResolveEmbedsResponse:
    """임베드·링크 칩 배치 해석 (S17 — F43, 설계 §4.19 ③). 읽기 전용(SELECT만) —
    answer·explanation은 응답 스키마에 존재하지 않는다(불변 규칙 1)."""
    items = embed_service.resolve_embeds(db, payload.doc_nos)
    return ResolveEmbedsResponse(items=items)


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
    job_id = convert_service.start_regenerate_job(
        db, document_id, payload.reason, engine=payload.engine, model=payload.model
    )
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


# ---------------------------------------------------------------------------
# LLM 풀이 생성 (S18 — F44 ②, 설계 §4.20) — F30 재생성 잡 인프라 재사용
# ---------------------------------------------------------------------------
@router.post(
    "/{document_id}/explain",
    response_model=ExplainJobStart,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_explain(
    document_id: int, payload: ExplainRequest, db: Session = Depends(get_db)
) -> ExplainJobStart:
    """대상 제한: 문제 타입 + explanation 비어 있음(있으면 409). convert 잡 큐 재사용."""
    job_id = convert_service.start_explain_job(db, document_id, engine=payload.engine, model=payload.model)
    return ExplainJobStart(job_id=job_id)


@router.get("/{document_id}/explain/{job_id}", response_model=ExplainJobStatus)
def get_explain_status(document_id: int, job_id: str) -> ExplainJobStatus:
    result = convert_service.get_explain_job(document_id, job_id)
    draft = result.get("draft")
    draft_out = None
    if draft:
        draft_out = ExplainDraft(
            explanation=draft["explanation"],
            answer=draft.get("answer"),
            answer_included=bool(draft.get("answer")),
        )
    return ExplainJobStatus(
        job_id=result["job_id"],
        status=result["status"],
        draft=draft_out,
        explanation_source=result.get("explanation_source"),
        error=result.get("error"),
        error_info=result.get("error_info"),
        progress=result.get("progress"),
    )


@router.post("/{document_id}/explain/{job_id}/apply", response_model=DocumentDetail)
def apply_explain(document_id: int, job_id: str, db: Session = Depends(get_db)) -> DocumentDetail:
    """승인 병합(유일한 쓰기) — 서버가 마커 라인을 부착, answer는 비어 있을 때만 병합."""
    convert_service.apply_explain_job(db, document_id, job_id)
    return document_service.get_document_detail(db, document_id)
