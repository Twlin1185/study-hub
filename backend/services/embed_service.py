"""문서 임베드(트랜스클루전) 참조 파서·인덱스 동기화·해석 (F43, 설계 §4.19).

`document_relations(relation='embeds', created_by='embed')` 행은 본문(content)의
`![[DOC-xxxx]]` 참조를 파싱해 만드는 **파생 인덱스**다 — 본문이 단일 출처이며, 이
모듈의 함수들은 언제든 재계산해도 같은 결과에 수렴하도록(멱등) 작성한다.

불변 규칙 1 봉인 지점: `resolve_embeds()`의 반환 스키마(`schemas.document.
ResolveEmbedItem`)에는 answer/explanation/choices 필드가 아예 없다 — 이 모듈은
필터링이 아니라 스키마 부재로 정답 유출 경로를 차단한다.
"""
from __future__ import annotations

import re
from typing import Dict, List, Set, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

import models

# 설계 §4.19 ① — 임베드만 인덱스한다(링크·앵커는 인덱스 대상이 아님).
# 별칭부(`|...`)는 관용으로 허용하되 버린다(임베드는 별칭이 표시될 자리가 없음).
_EMBED_RE = re.compile(r"!\[\[(DOC-\d{4,})(?:\|[^\]\n]*)?\]\]")

# 서버 인덱스 파서도 렌더(remark AST)와 동일하게 코드 구간을 제외한다(렌더-인덱스 정합).
_CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")

EMBED_RELATION = "embeds"
EMBED_CREATED_BY = "embed"


def _strip_code_regions(content: str) -> str:
    text = _CODE_FENCE_RE.sub("", content)
    text = _INLINE_CODE_RE.sub("", text)
    return text


def parse_embedded_doc_nos(content: str | None) -> List[str]:
    """본문에서 `![[DOC-xxxx]]` 임베드 참조의 doc_no만 추출한다.

    - 코드 펜스·인라인 코드 구간은 스캔 전에 제거한다.
    - `[[...]]` 링크·`[[#...]]` 앵커는 추출하지 않는다(임베드 전용 정규식).
    - 중복은 제거하고 본문 등장 순서를 유지한다.
    """
    if not content:
        return []
    text = _strip_code_regions(content)
    seen: Set[str] = set()
    result: List[str] = []
    for match in _EMBED_RE.finditer(text):
        doc_no = match.group(1)
        if doc_no not in seen:
            seen.add(doc_no)
            result.append(doc_no)
    return result


def sync_embed_relations(db: Session, document: models.Document) -> None:
    """본문 파싱 결과와 기존 embed 파생 행을 diff 동기화한다 (설계 §4.19 ⑤).

    - 새 참조는 INSERT하되, 같은 (from,to,'embeds') 쌍에 **수동 행이 이미 있으면
      건드리지 않는다**(upsert — created_by 보존).
    - 본문에서 사라진 참조는 `created_by='embed'` 행만 DELETE(수동 행 불가침).
    - 부재 doc_no·자기 참조는 행을 만들지 않는다.
    - 대상이 소프트 삭제(is_active=0)여도 행은 유지/생성한다(삭제 경고·역참조용).
    - commit은 호출자 몫 — 이 함수는 flush까지만 한다(트랜잭션 합류).
    """
    doc_nos = parse_embedded_doc_nos(document.content)

    resolved_ids: Set[int] = set()
    if doc_nos:
        rows = db.execute(
            select(models.Document.id, models.Document.doc_no).where(
                models.Document.doc_no.in_(doc_nos)
            )
        ).all()
        for doc_id, _doc_no in rows:
            if doc_id != document.id:
                resolved_ids.add(doc_id)

    existing_embed_rows = db.execute(
        select(models.DocumentRelation).where(
            models.DocumentRelation.from_document_id == document.id,
            models.DocumentRelation.relation == EMBED_RELATION,
            models.DocumentRelation.created_by == EMBED_CREATED_BY,
        )
    ).scalars().all()
    existing_embed_ids = {row.to_document_id for row in existing_embed_rows}

    # 본문에서 사라진 참조 — embed 파생 행만 삭제
    for row in existing_embed_rows:
        if row.to_document_id not in resolved_ids:
            db.delete(row)

    # 새로 나타난 참조 — 같은 (from,to,'embeds') 쌍에 수동 행이 있으면 건드리지 않는다
    for target_id in resolved_ids - existing_embed_ids:
        existing_any = db.get(
            models.DocumentRelation,
            {
                "from_document_id": document.id,
                "to_document_id": target_id,
                "relation": EMBED_RELATION,
            },
        )
        if existing_any is None:
            db.add(
                models.DocumentRelation(
                    from_document_id=document.id,
                    to_document_id=target_id,
                    relation=EMBED_RELATION,
                    created_by=EMBED_CREATED_BY,
                )
            )

    db.flush()


def rebuild_embed_index(db: Session) -> int:
    """전 문서(소프트 삭제 포함)를 재파싱해 embed 파생 행을 전량 재구축한다.

    멱등 — 언제든 다시 불러 실행해도 같은 결과에 수렴한다. 수동 관계 행은
    보존한다(sync_embed_relations가 created_by='embed' 행만 다루므로).
    엔드포인트로 노출하지 않는다(관리 함수 — R20 전량 재계산 경로).
    """
    documents = db.execute(select(models.Document)).scalars().all()
    for document in documents:
        sync_embed_relations(db, document)
    db.commit()
    return len(documents)


def embedded_by(db: Session, document_id: int) -> List[Dict[str, object]]:
    """이 문서를 임베드한 **활성** 문서 목록 — 사용처 표시·삭제 경고용."""
    rows = db.execute(
        select(models.Document.id, models.Document.doc_no, models.Document.title)
        .join(
            models.DocumentRelation,
            models.DocumentRelation.from_document_id == models.Document.id,
        )
        .where(
            models.DocumentRelation.to_document_id == document_id,
            models.DocumentRelation.relation == EMBED_RELATION,
            models.Document.is_active == 1,
        )
    ).all()
    return [{"id": doc_id, "doc_no": doc_no, "title": title} for doc_id, doc_no, title in rows]


def resolve_embeds(
    db: Session, doc_nos: List[str]
) -> Tuple[List[Dict[str, object]], List[str]]:
    """배치 해석 — 존재 문서는 본문 전용 필드만, 부재는 missing으로 (설계 §4.19 ③).

    서버는 재귀 해석하지 않는다. 소프트 삭제 문서는 items에 포함하되
    content=""로 반환한다(제목은 자리표시자에 쓰이되 내용은 네트워크에 싣지 않는다).
    """
    deduped: List[str] = []
    seen: Set[str] = set()
    for doc_no in doc_nos:
        if doc_no not in seen:
            seen.add(doc_no)
            deduped.append(doc_no)

    if not deduped:
        return [], []

    rows = db.execute(
        select(models.Document).where(models.Document.doc_no.in_(deduped))
    ).scalars().all()
    by_doc_no = {doc.doc_no: doc for doc in rows}

    items: List[Dict[str, object]] = []
    missing: List[str] = []
    for doc_no in deduped:
        doc = by_doc_no.get(doc_no)
        if doc is None:
            missing.append(doc_no)
            continue
        is_active = bool(doc.is_active)
        items.append(
            {
                "doc_no": doc.doc_no,
                "id": doc.id,
                "title": doc.title,
                "type": doc.type,
                "content": (doc.content or "") if is_active else "",
                "is_active": is_active,
            }
        )
    return items, missing
