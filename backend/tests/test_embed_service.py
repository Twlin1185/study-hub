"""문서 상호참조 — 임베드 해석·참조 인덱스 동기화 (S17, F43, 설계 §4.19) 단위 테스트.

고정하는 계약:
  ① 해석 응답에 answer/explanation **필드 자체 부재**(스키마 수준 — 필터링 아님, 불변 규칙 1)
  ② 저장(POST/PATCH) 시 embeds 동기화(추가·제거, upsert+prune) — `created_by='manual'` 등
     다른 행은 건드리지 않는다
  ③ 반입 commit 시에도 같은 트랜잭션에서 동기화된다
  ④ 전량 재계산 함수(R20)의 멱등성
  + 추가: 삭제 문서(found:true, content:null) · 부재 doc_no(found:false) 응답,
    상한 50 초과·빈 배열 422, 자기 참조·부재 대상은 인덱스 행 미생성
"""
from __future__ import annotations

import json as json_lib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
import models
from database import Base, get_db
from schemas.document import DocumentCreate, DocumentUpdate
from schemas.embed import RESOLVE_EMBEDS_MAX, EmbedResolveItem
from services import document_service, embed_service, import_service, preview_store


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------
@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db):
    """`GET /api/documents/resolve-embeds` 등 라우터 계약(422 포함)은 실제 HTTP 경유로
    확인한다 — get_db만 인메모리 세션으로 오버라이드해 실제 study.db는 건드리지 않는다."""

    def _override_get_db():
        yield db

    main.app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def isolated_import_dirs(tmp_path, monkeypatch):
    auto_dir = tmp_path / "import" / "auto"
    sources_dir = tmp_path / "sources"
    auto_dir.mkdir(parents=True)
    sources_dir.mkdir(parents=True)
    monkeypatch.setattr(preview_store, "AUTO_DIR", auto_dir)
    monkeypatch.setattr(preview_store, "SOURCES_DIR", sources_dir)
    monkeypatch.setattr(import_service, "SOURCES_DIR", sources_dir)
    import_service._PREVIEW_CACHE.clear()
    import_service._COMMITTED.clear()
    yield
    import_service._PREVIEW_CACHE.clear()
    import_service._COMMITTED.clear()


def _create_doc(
    db,
    *,
    type: str = "concept",
    title: str = "문서",
    content: str | None = "본문",
    answer: str | None = None,
    explanation: str | None = None,
) -> models.Document:
    payload = DocumentCreate(
        type=type, title=title, content=content, answer=answer, explanation=explanation
    )
    return document_service.create_document(db, payload)


def _embed_rows(db, from_document_id: int) -> list[models.DocumentRelation]:
    return db.execute(
        select(models.DocumentRelation).where(
            models.DocumentRelation.from_document_id == from_document_id,
            models.DocumentRelation.relation == "embeds",
            models.DocumentRelation.created_by == "embed",
        )
    ).scalars().all()


# ---------------------------------------------------------------------------
# ① answer·explanation 필드 자체 부재 (불변 규칙 1 — 계약 수준 봉인)
# ---------------------------------------------------------------------------
def test_embed_resolve_item_schema_has_no_answer_or_explanation_fields():
    assert "answer" not in EmbedResolveItem.model_fields
    assert "explanation" not in EmbedResolveItem.model_fields


def test_resolve_embeds_endpoint_response_excludes_answer_and_explanation(client, db):
    concept = _create_doc(
        db,
        type="question",
        title="문제1",
        content="본문",
        answer="정답입니다",
        explanation="해설입니다",
    )
    resp = client.post("/api/documents/resolve-embeds", json={"doc_nos": [concept.doc_no]})
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert "answer" not in item
    assert "explanation" not in item
    assert item["found"] is True
    assert item["content"] == "본문"
    assert item["id"] == concept.id  # [원문 열기]·링크 칩이 /docs/{id}로 직행하기 위한 식별자


# ---------------------------------------------------------------------------
# ② 저장(POST/PATCH) 시 embeds 동기화 — 추가·제거(upsert+prune)
# ---------------------------------------------------------------------------
def test_create_document_syncs_embeds_index(db):
    concept = _create_doc(db, title="산술평균")
    upper = document_service.create_document(
        db,
        DocumentCreate(
            type="concept",
            title="상위 문서",
            content=f"참고: ![[{concept.doc_no}|평균]]",
        ),
    )
    rows = _embed_rows(db, upper.id)
    assert len(rows) == 1
    assert rows[0].to_document_id == concept.id
    assert rows[0].created_by == "embed"


def test_update_document_content_change_prunes_stale_and_adds_new_embed(db):
    a = _create_doc(db, title="A")
    c = _create_doc(db, title="C")
    b = _create_doc(db, title="B", content=f"![[{a.doc_no}]]")
    assert {row.to_document_id for row in _embed_rows(db, b.id)} == {a.id}

    document_service.update_document(db, b.id, DocumentUpdate(content=f"![[{c.doc_no}]]"))
    assert {row.to_document_id for row in _embed_rows(db, b.id)} == {c.id}


def test_update_document_without_content_change_does_not_touch_embeds(db):
    a = _create_doc(db, title="A")
    b = _create_doc(db, title="B", content=f"![[{a.doc_no}]]")
    document_service.update_document(db, b.id, DocumentUpdate(title="B(제목만 변경)"))
    assert {row.to_document_id for row in _embed_rows(db, b.id)} == {a.id}


def test_sync_does_not_touch_manual_relation_rows(db):
    """`created_by='manual'`인 같은 relation='embeds' 조합 행은 자동 동기화 대상이 아니다
    (§4.19 ⑥ — 파생 인덱스는 `created_by='embed'` 조건이 걸린 행만 치환한다)."""
    a = _create_doc(db, title="A")
    b = _create_doc(db, title="B", content=None)
    db.add(
        models.DocumentRelation(
            from_document_id=b.id, to_document_id=a.id, relation="embeds", created_by="manual"
        )
    )
    db.commit()

    document_service.update_document(db, b.id, DocumentUpdate(content="임베드 참조 없는 본문"))

    rows = db.execute(
        select(models.DocumentRelation).where(models.DocumentRelation.from_document_id == b.id)
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].created_by == "manual"


def test_self_reference_and_missing_target_create_no_index_rows(db):
    a = _create_doc(db, title="A")
    document_service.update_document(
        db, a.id, DocumentUpdate(content=f"![[{a.doc_no}]] 그리고 ![[DOC-9999]]")
    )
    assert _embed_rows(db, a.id) == []


# ---------------------------------------------------------------------------
# ③ 반입 commit 시 동기화 — commit_import와 같은 트랜잭션
# ---------------------------------------------------------------------------
def test_commit_import_syncs_embeds_for_new_document(db):
    concept = _create_doc(db, title="산술평균")
    docs = [
        {
            "type": "concept",
            "title": "반입된 상위 문서",
            "content": f"참고: ![[{concept.doc_no}]]",
        }
    ]
    payload = json_lib.dumps(
        {"format_version": 1, "source": {"filename": "노트.md"}, "documents": docs},
        ensure_ascii=False,
    ).encode("utf-8")
    preview = import_service.create_preview(
        db, json_bytes=payload, source_filename=None, source_bytes=None
    )
    from schemas.import_schema import CommitRequest, ImportDecision

    result = import_service.commit_import(
        db,
        CommitRequest(
            preview_id=preview.preview_id,
            decisions=[ImportDecision(index=0, action="new")],
        ),
    )
    new_doc_id = result.new_documents[0].id
    rows = _embed_rows(db, new_doc_id)
    assert len(rows) == 1
    assert rows[0].to_document_id == concept.id


# ---------------------------------------------------------------------------
# ④ 전량 재계산 함수(R20) — 멱등성
# ---------------------------------------------------------------------------
def test_recompute_all_embeds_is_idempotent(db):
    a = _create_doc(db, title="A")
    b = _create_doc(db, title="B", content=f"![[{a.doc_no}]]")

    # 인덱스가 어떤 이유로든 어긋난 상태를 재현(직접 삭제) — 재계산이 복구해야 한다.
    db.execute(
        models.DocumentRelation.__table__.delete().where(
            models.DocumentRelation.from_document_id == b.id
        )
    )
    db.commit()
    assert _embed_rows(db, b.id) == []

    count1 = embed_service.recompute_all_embeds(db)
    rows1 = {row.to_document_id for row in _embed_rows(db, b.id)}
    count2 = embed_service.recompute_all_embeds(db)
    rows2 = {row.to_document_id for row in _embed_rows(db, b.id)}

    assert rows1 == {a.id}
    assert rows1 == rows2
    assert count1 == count2 == 2  # 문서 수(a, b) — 재실행해도 동일


# ---------------------------------------------------------------------------
# 해석 조회 — 부재 doc_no(found:false) · 소프트 삭제(found:true, content:null)
# id 필드(§4.19 계약 변경 2026-08-02) — [원문 열기]·링크 칩의 /docs/{id} 직행용,
# found:true는 삭제 문서 포함 항상 id 제공 · found:false는 id 없음
# ---------------------------------------------------------------------------
def test_resolve_embeds_missing_doc_no_returns_found_false(db):
    items = embed_service.resolve_embeds(db, ["DOC-9999"])
    assert items == [EmbedResolveItem(doc_no="DOC-9999", found=False)]
    assert items[0].id is None


def test_resolve_embeds_found_document_includes_id(db):
    a = _create_doc(db, title="산술평균")
    items = embed_service.resolve_embeds(db, [a.doc_no])
    assert items[0].id == a.id


def test_resolve_embeds_soft_deleted_document_hides_content_but_keeps_id_and_title(db):
    a = _create_doc(db, title="삭제될 문서", content="본문 내용")
    document_service.soft_delete_document(db, a.id)

    items = embed_service.resolve_embeds(db, [a.doc_no])
    item = items[0]
    assert item.found is True
    assert item.is_active is False
    assert item.content is None
    assert item.title == "삭제될 문서"
    assert item.id == a.id  # 삭제 문서도 id는 내려간다([원문 열기] 링크용)


def test_resolve_embeds_read_only_does_not_write_any_table(db):
    """§4.19 ③ — SELECT만 수행(study_progress·srs_cards·attempts 등 쓰기 0)."""
    a = _create_doc(db, title="A")
    before = db.execute(select(models.DocumentRelation)).scalars().all()
    embed_service.resolve_embeds(db, [a.doc_no, "DOC-9999"])
    after = db.execute(select(models.DocumentRelation)).scalars().all()
    assert before == after


# ---------------------------------------------------------------------------
# 요청 스키마 — 상한 50 초과·빈 배열 = 422 VALIDATION_ERROR
# ---------------------------------------------------------------------------
def test_resolve_embeds_endpoint_rejects_over_limit(client):
    too_many = [f"DOC-{i:04d}" for i in range(RESOLVE_EMBEDS_MAX + 1)]
    resp = client.post("/api/documents/resolve-embeds", json={"doc_nos": too_many})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_resolve_embeds_endpoint_rejects_empty_array(client):
    resp = client.post("/api/documents/resolve-embeds", json={"doc_nos": []})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_resolve_embeds_endpoint_accepts_exactly_max_after_dedup(client):
    doubled = [f"DOC-{i:04d}" for i in range(RESOLVE_EMBEDS_MAX)] * 2
    resp = client.post("/api/documents/resolve-embeds", json={"doc_nos": doubled})
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == RESOLVE_EMBEDS_MAX
