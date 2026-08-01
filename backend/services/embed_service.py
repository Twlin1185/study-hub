"""문서 상호참조 — 임베드 참조 파서·인덱스 동기화·전량 재계산·해석 조회 (S17, F43).

설계 §4.19 단일 출처. 저장 지점(POST/PATCH `documents`, `import_service.commit_import`)에서
본문을 파싱해 `document_relations(relation='embeds', created_by='embed')` 행을
**스캔 결과로 치환**한다(upsert+prune, 본문이 단일 출처인 파생 인덱스). 새 테이블·컬럼·
Alembic 변경 0건 — 기존 `document_relations`만 사용한다.

**읽기 전용 보증**: `resolve_embeds`는 SELECT만 수행한다 — study_progress·srs_cards·
attempts 등 어떤 테이블에도 쓰기 0(§4.19 ③, stage-17 DoD 5).
"""
from __future__ import annotations

import re
from typing import List, Optional, Set

from sqlalchemy import select
from sqlalchemy.orm import Session

import models
from schemas.embed import EmbedResolveItem

# 임베드 문법(§4.19 ①) — `![[DOC-0012]]` · `![[DOC-0012|별칭]]`. 인덱스 대상은 임베드만이고
# 링크 칩(`[[...]]`, `!` 없음)은 인덱스하지 않는다. 코드 블록 제외 없음(본문 전체 스캔 — 단순성
# 우선, §4.19 ① 확정).
EMBED_PATTERN = re.compile(r"!\[\[(DOC-\d{4,})(?:\|([^\]\|]+))?\]\]")


def extract_embedded_doc_nos(content: Optional[str]) -> List[str]:
    """본문에서 임베드 참조 doc_no를 등장 순서대로 중복 없이 추출한다."""
    if not content:
        return []
    seen: Set[str] = set()
    result: List[str] = []
    for match in EMBED_PATTERN.finditer(content):
        doc_no = match.group(1)
        if doc_no not in seen:
            seen.add(doc_no)
            result.append(doc_no)
    return result


def sync_embeds_for_document(db: Session, document: models.Document) -> None:
    """`document.content` 기준으로 이 문서가 선언하는 embeds 행 집합을 치환한다.

    upsert+prune: 스캔 결과에 없는 기존 embeds 행은 삭제, 새로 등장한 참조는 추가.
    자기 자신 참조·부재 doc_no는 행을 만들지 않는다(§4.19 ⑥). **커밋은 호출부 책임** —
    문서 저장과 같은 트랜잭션 안에서 호출해야 한다(불변 규칙 2와 같은 원칙).
    """
    doc_nos = extract_embedded_doc_nos(document.content)

    target_ids: Set[int] = set()
    if doc_nos:
        rows = db.execute(
            select(models.Document.id).where(models.Document.doc_no.in_(doc_nos))
        ).scalars().all()
        for doc_id in rows:
            if doc_id == document.id:
                continue  # 자기 자신 임베드 — 행 미생성
            target_ids.add(doc_id)

    existing_rows = db.execute(
        select(models.DocumentRelation).where(
            models.DocumentRelation.from_document_id == document.id,
            models.DocumentRelation.relation == "embeds",
            models.DocumentRelation.created_by == "embed",
        )
    ).scalars().all()
    existing_ids = {row.to_document_id for row in existing_rows}

    for row in existing_rows:
        if row.to_document_id not in target_ids:
            db.delete(row)

    for to_id in target_ids - existing_ids:
        db.add(
            models.DocumentRelation(
                from_document_id=document.id,
                to_document_id=to_id,
                relation="embeds",
                created_by="embed",
            )
        )
    db.flush()


def recompute_all_embeds(db: Session) -> int:
    """전량 재계산(R20) — 전 문서(is_active 무관)를 재파싱해 `created_by='embed'` 행 전체를
    재구축한다. 멱등(두 번 돌려도 같은 결과). 도입 시 1회 백필 겸용. **신규 API로 노출하지
    않는다** — 관리 스크립트·셸에서 직접 호출하는 서비스 함수로만 존재한다.

    실행 진입점: `backend/scripts/recompute_embeds.py` (검토 경미-6).
        backend/.venv/Scripts/python.exe scripts/recompute_embeds.py

    반환값은 재파싱한 문서 수(호출부 로깅용).
    """
    documents = db.execute(select(models.Document)).scalars().all()
    for document in documents:
        sync_embeds_for_document(db, document)
    db.commit()
    return len(documents)


def resolve_embeds(db: Session, doc_nos: List[str]) -> List[EmbedResolveItem]:
    """배치 해석 조회(§4.19 ③) — 읽기 전용(SELECT만). answer·explanation은 절대 담지 않는다.

    부재 doc_no는 `found=False`(배치 부분 성공, 404 아님) — `id` 없음. 소프트 삭제(is_active=0)
    문서는 `found=True, id, title` 제공 + `content=None`(자리표시자·[원문 열기] 링크용으로
    `id`는 삭제 문서도 내려간다).
    """
    rows = db.execute(
        select(models.Document).where(models.Document.doc_no.in_(doc_nos))
    ).scalars().all()
    by_doc_no = {doc.doc_no: doc for doc in rows}

    items: List[EmbedResolveItem] = []
    for doc_no in doc_nos:
        document = by_doc_no.get(doc_no)
        if document is None:
            items.append(EmbedResolveItem(doc_no=doc_no, found=False))
            continue
        is_active = bool(document.is_active)
        items.append(
            EmbedResolveItem(
                doc_no=doc_no,
                found=True,
                id=document.id,
                title=document.title,
                type=document.type,
                content=document.content if is_active else None,
                is_active=is_active,
            )
        )
    return items
