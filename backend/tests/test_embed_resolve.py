"""문서 임베드(트랜스클루전) 해석·인덱스 동기화·역참조 테스트 (F43, 설계 §4.19).

in-memory SQLite로 서비스 계층을 직접 호출한다(conftest 없음 — test_srs_dday_queue.py
스타일). 핵심 불변식: 해석 응답에 answer/explanation/choices 필드 자체가 존재하지
않는다(불변 규칙 1 — 필터링이 아니라 스키마 부재)를 model_fields·model_dump 양쪽에서
확인한다.
"""
from __future__ import annotations

import itertools

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from exceptions import NotFoundError
from schemas.document import (
    DocumentCreate,
    DocumentUpdate,
    ResolveEmbedItem,
    ResolveEmbedsRequest,
)
from services import document_service, embed_service


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


_doc_no_seq = itertools.count(1)


def _make_doc(
    db,
    *,
    doc_no: str | None = None,
    type: str = "concept",  # noqa: A002
    title: str = "테스트 문서",
    content: str | None = None,
    answer: str | None = None,
    is_active: int = 1,
) -> models.Document:
    """서비스 계층을 거치지 않고 문서를 직접 만든다(사전조건 세팅용 — embed 동기화는
    호출하지 않는다)."""
    doc = models.Document(
        doc_no=doc_no or f"DOC-{next(_doc_no_seq):04d}",
        type=type,
        title=title,
        content=content,
        answer=answer,
        is_active=is_active,
    )
    db.add(doc)
    db.flush()
    return doc


# ---------------------------------------------------------------------------
# ① 파서 — parse_embedded_doc_nos
# ---------------------------------------------------------------------------


def test_parse_extracts_embed_doc_no():
    content = "본문 ![[DOC-0012]] 이어짐"
    assert embed_service.parse_embedded_doc_nos(content) == ["DOC-0012"]


def test_parse_ignores_alias_in_embed():
    """임베드의 별칭부(|...)는 관용으로 버린다 — 오류 아님."""
    content = "![[DOC-0012|산술평균 보기]]"
    assert embed_service.parse_embedded_doc_nos(content) == ["DOC-0012"]


def test_parse_does_not_extract_links_or_anchors():
    """`[[DOC-xxxx]]` 링크·`[[#절 제목]]` 앵커는 임베드 인덱스 대상이 아니다."""
    content = "[[DOC-0012]] 링크 · [[DOC-0034|표시명]] · [[#절 제목]] 앵커"
    assert embed_service.parse_embedded_doc_nos(content) == []


def test_parse_excludes_code_fence():
    content = "```\n![[DOC-0012]]\n```\n본문 밖에는 참조 없음"
    assert embed_service.parse_embedded_doc_nos(content) == []


def test_parse_excludes_inline_code():
    content = "인라인 `![[DOC-0012]]` 코드 스팬 안"
    assert embed_service.parse_embedded_doc_nos(content) == []


def test_parse_dedup_preserves_order():
    content = "![[DOC-0034]] 그리고 ![[DOC-0012]] 다시 ![[DOC-0034]]"
    assert embed_service.parse_embedded_doc_nos(content) == ["DOC-0034", "DOC-0012"]


def test_parse_none_and_empty_content():
    assert embed_service.parse_embedded_doc_nos(None) == []
    assert embed_service.parse_embedded_doc_nos("") == []


# ---------------------------------------------------------------------------
# ② create/update 시 embeds 인덱스 동기화
# ---------------------------------------------------------------------------


def test_create_document_syncs_embed_relation(db):
    target = _make_doc(db, title="산술평균")
    db.commit()

    payload = DocumentCreate(
        type="concept", title="확률과 확률분포", content=f"참조 ![[{target.doc_no}]]"
    )
    created = document_service.create_document(db, payload)

    rows = db.execute(select(models.DocumentRelation)).scalars().all()
    assert len(rows) == 1
    assert rows[0].from_document_id == created.id
    assert rows[0].to_document_id == target.id
    assert rows[0].relation == "embeds"
    assert rows[0].created_by == "embed"


def test_update_document_adds_and_removes_embed_relations(db):
    target_a = _make_doc(db, title="A 개념")
    target_b = _make_doc(db, title="B 개념")
    db.commit()

    created = document_service.create_document(
        db, DocumentCreate(type="concept", title="상위", content=f"![[{target_a.doc_no}]]")
    )

    document_service.update_document(
        db, created.id, DocumentUpdate(content=f"![[{target_b.doc_no}]]")
    )

    rows = db.execute(
        select(models.DocumentRelation).where(
            models.DocumentRelation.from_document_id == created.id
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].to_document_id == target_b.id


def test_update_document_without_content_change_is_noop(db):
    target = _make_doc(db, title="A 개념")
    db.commit()
    created = document_service.create_document(
        db, DocumentCreate(type="concept", title="상위", content=f"![[{target.doc_no}]]")
    )

    document_service.update_document(db, created.id, DocumentUpdate(title="제목만 변경"))

    rows = db.execute(
        select(models.DocumentRelation).where(
            models.DocumentRelation.from_document_id == created.id
        )
    ).scalars().all()
    assert len(rows) == 1  # content 미변경 — embed 인덱스 그대로


def test_sync_ignores_self_reference(db):
    doc = _make_doc(db, title="자기참조")
    db.commit()
    doc.content = f"![[{doc.doc_no}]]"
    embed_service.sync_embed_relations(db, doc)
    db.commit()

    assert db.execute(select(models.DocumentRelation)).scalars().all() == []


def test_sync_ignores_missing_doc_no(db):
    doc = _make_doc(db, title="본문")
    db.commit()
    doc.content = "![[DOC-9999]]"
    embed_service.sync_embed_relations(db, doc)
    db.commit()

    assert db.execute(select(models.DocumentRelation)).scalars().all() == []


def test_sync_preserves_manual_relation_row(db):
    """같은 (from,to,'embeds') 쌍에 수동 행이 이미 있으면 created_by를 건드리지 않고,
    본문에서 참조가 사라져도 그 행을 지우지 않는다(수동 행 불가침)."""
    source = _make_doc(db, title="상위")
    target = _make_doc(db, title="하위")
    db.add(
        models.DocumentRelation(
            from_document_id=source.id,
            to_document_id=target.id,
            relation="embeds",
            created_by="manual",
        )
    )
    db.commit()

    source.content = f"![[{target.doc_no}]]"
    embed_service.sync_embed_relations(db, source)
    db.commit()

    row = db.get(
        models.DocumentRelation,
        {"from_document_id": source.id, "to_document_id": target.id, "relation": "embeds"},
    )
    assert row is not None
    assert row.created_by == "manual"

    source.content = "참조 없음"
    embed_service.sync_embed_relations(db, source)
    db.commit()

    row_after = db.get(
        models.DocumentRelation,
        {"from_document_id": source.id, "to_document_id": target.id, "relation": "embeds"},
    )
    assert row_after is not None
    assert row_after.created_by == "manual"


# ---------------------------------------------------------------------------
# ③ relations[] 응답에서 embed 행 제외 + embedded_by 노출
# ---------------------------------------------------------------------------


def test_document_detail_excludes_embed_rows_and_shows_embedded_by(db):
    target = _make_doc(db, title="산술평균")
    db.commit()
    upper = document_service.create_document(
        db, DocumentCreate(type="concept", title="확률과 확률분포", content=f"![[{target.doc_no}]]")
    )

    upper_detail = document_service.get_document_detail(db, upper.id)
    assert upper_detail.relations == []  # embed 파생 행은 relations에서 제외

    target_detail = document_service.get_document_detail(db, target.id)
    assert target_detail.relations == []
    assert len(target_detail.embedded_by) == 1
    assert target_detail.embedded_by[0].id == upper.id
    assert target_detail.embedded_by[0].doc_no == upper.doc_no


# ---------------------------------------------------------------------------
# ④ 해석 응답 스키마 — answer/explanation/choices 부재 (불변 규칙 1)
# ---------------------------------------------------------------------------


def test_resolve_embed_item_schema_has_no_answer_fields():
    field_names = set(ResolveEmbedItem.model_fields.keys())
    assert field_names == {"doc_no", "id", "title", "type", "content", "is_active"}
    assert "answer" not in field_names
    assert "explanation" not in field_names
    assert "choices" not in field_names


def test_resolve_embeds_item_model_dump_has_no_answer_fields(db):
    doc = _make_doc(db, type="question", title="문제", content="지문", answer="1")
    db.commit()

    items, missing = embed_service.resolve_embeds(db, [doc.doc_no])
    assert missing == []
    item = ResolveEmbedItem(**items[0])
    dumped = item.model_dump()
    assert "answer" not in dumped
    assert "explanation" not in dumped
    assert "choices" not in dumped
    assert dumped["content"] == "지문"


def test_resolve_embeds_request_rejects_bad_pattern():
    with pytest.raises(Exception):
        ResolveEmbedsRequest(doc_nos=["DOC-12"])  # 3자리 — 패턴 위반


def test_resolve_embeds_request_rejects_over_50():
    with pytest.raises(Exception):
        ResolveEmbedsRequest(doc_nos=[f"DOC-{i:04d}" for i in range(51)])


# ---------------------------------------------------------------------------
# ⑤ missing 처리(404 아님) · 소프트 삭제 content="" · 요청 중복 제거
# ---------------------------------------------------------------------------


def test_resolve_embeds_missing_is_not_error(db):
    doc = _make_doc(db, title="존재함")
    db.commit()

    items, missing = embed_service.resolve_embeds(db, [doc.doc_no, "DOC-9999"])
    assert len(items) == 1
    assert missing == ["DOC-9999"]


def test_resolve_embeds_soft_deleted_returns_empty_content(db):
    doc = _make_doc(db, title="삭제됨", content="원래 내용", is_active=0)
    db.commit()

    items, missing = embed_service.resolve_embeds(db, [doc.doc_no])
    assert missing == []
    assert items[0]["content"] == ""
    assert items[0]["is_active"] is False
    assert items[0]["title"] == "삭제됨"


def test_resolve_embeds_dedupes_request(db):
    doc = _make_doc(db, title="중복 요청")
    db.commit()

    items, missing = embed_service.resolve_embeds(db, [doc.doc_no, doc.doc_no, doc.doc_no])
    assert len(items) == 1
    assert missing == []


# ---------------------------------------------------------------------------
# ⑥ rebuild_embed_index — 멱등성·수동 행 보존·전량 삭제 후 복구
# ---------------------------------------------------------------------------


def test_rebuild_embed_index_idempotent(db):
    target = _make_doc(db, title="산술평균")
    db.commit()
    document_service.create_document(
        db, DocumentCreate(type="concept", title="상위", content=f"![[{target.doc_no}]]")
    )

    before = db.execute(select(models.DocumentRelation)).scalars().all()
    assert len(before) == 1

    embed_service.rebuild_embed_index(db)
    after_first = db.execute(select(models.DocumentRelation)).scalars().all()
    assert len(after_first) == 1

    embed_service.rebuild_embed_index(db)
    after_second = db.execute(select(models.DocumentRelation)).scalars().all()
    assert len(after_second) == 1
    assert after_second[0].to_document_id == target.id


def test_rebuild_embed_index_preserves_manual_relation(db):
    source = _make_doc(db, title="문제")
    target = _make_doc(db, title="개념")
    db.add(
        models.DocumentRelation(
            from_document_id=source.id,
            to_document_id=target.id,
            relation="explains",
            created_by="manual",
        )
    )
    db.commit()

    embed_service.rebuild_embed_index(db)

    row = db.get(
        models.DocumentRelation,
        {"from_document_id": source.id, "to_document_id": target.id, "relation": "explains"},
    )
    assert row is not None
    assert row.created_by == "manual"


def test_rebuild_embed_index_restores_after_full_deletion(db):
    target = _make_doc(db, title="산술평균")
    db.commit()
    upper = document_service.create_document(
        db, DocumentCreate(type="concept", title="상위", content=f"![[{target.doc_no}]]")
    )

    # 인덱스 전량 삭제 시뮬레이션 (사고 등) — 본문이 단일 출처이므로 복구 가능해야 한다
    db.execute(models.DocumentRelation.__table__.delete())
    db.commit()
    assert db.execute(select(models.DocumentRelation)).scalars().all() == []

    embed_service.rebuild_embed_index(db)

    rows = db.execute(select(models.DocumentRelation)).scalars().all()
    assert len(rows) == 1
    assert rows[0].from_document_id == upper.id
    assert rows[0].to_document_id == target.id
    assert rows[0].created_by == "embed"


# ---------------------------------------------------------------------------
# ⑦ [신규 — 검토 결함 수정 검증] remove_relation은 embed 파생 행을 보호한다
# ---------------------------------------------------------------------------


def test_remove_relation_deletes_manual_relation_row(db):
    """embed 행과 무관한 일반 수동 관계는 기존대로 삭제된다."""
    source = _make_doc(db, title="문제")
    target = _make_doc(db, title="개념")
    db.add(
        models.DocumentRelation(
            from_document_id=source.id,
            to_document_id=target.id,
            relation="explains",
            created_by="manual",
        )
    )
    db.commit()

    document_service.remove_relation(db, source.id, target.id)

    row = db.get(
        models.DocumentRelation,
        {"from_document_id": source.id, "to_document_id": target.id, "relation": "explains"},
    )
    assert row is None


def test_remove_relation_protects_embed_row(db):
    """검토 결함 수정 지점: embed 파생 행(created_by='embed')은 DELETE /relations로
    지워지지 않는다 — 매칭 0건이 되어 404를 반환하고 행은 그대로 남는다."""
    target = _make_doc(db, title="산술평균")
    db.commit()
    upper = document_service.create_document(
        db, DocumentCreate(type="concept", title="상위", content=f"![[{target.doc_no}]]")
    )

    with pytest.raises(NotFoundError):
        document_service.remove_relation(db, upper.id, target.id)

    row = db.get(
        models.DocumentRelation,
        {"from_document_id": upper.id, "to_document_id": target.id, "relation": "embeds"},
    )
    assert row is not None
    assert row.created_by == "embed"
