"""POST /api/documents 블록 확장 (S36 — 설계 §4.29 ⑦) 계약 테스트.

고정하는 계약:
  B-1. 동반 규칙 2쌍(content_blocks<->content, explanation_blocks<->explanation) ·
       얕은 검증(version 정수·blocks 배열) · 크기 상한(too_large) · 태생 전환
       (blocks_version = 서버가 content_blocks.version을 컬럼 사본으로 채움).
  B-1. 블록 미동반 POST = 종전 계약 그대로 미전환 생성(3필드 NULL, 하위 호환 무변).
  B-2. quiz/session·resolve-embeds 등 파생 응답에 블록 필드가 부재한다(불변 규칙 1)
       — 이 테스트 파일은 사실 확인만 한다(스키마 자체를 건드리지 않았으므로 구조적
       보장. resolve-embeds는 기존 test_embed_service.py가 이미 answer/explanation
       부재를 고정하고 있어 여기서는 blocks 필드 부재만 확인).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from database import Base, get_db
from schemas.embed import EmbedResolveItem


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
    def _override_get_db():
        yield db

    main.app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.pop(get_db, None)


def _blocks(text: str = "hello") -> dict:
    return {"version": 1, "blocks": [{"type": "paragraph", "text": text}]}


# ---------------------------------------------------------------------------
# B-1 — 동반 생성 → 태생 전환
# ---------------------------------------------------------------------------
def test_post_with_content_blocks_pair_creates_converted_document(client):
    resp = client.post(
        "/api/documents",
        json={
            "type": "concept",
            "title": "블록 동반 생성",
            "content": "# 제목\n본문",
            "content_blocks": _blocks("본문"),
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["content"] == "# 제목\n본문"
    assert body["content_blocks"] == _blocks("본문")
    assert body["blocks_version"] == 1
    assert body["explanation_blocks"] is None

    # 상세 재조회 왕복
    detail = client.get(f"/api/documents/{body['id']}").json()
    assert detail["content_blocks"] == _blocks("본문")
    assert detail["blocks_version"] == 1


def test_post_with_both_pairs_sets_both_blocks_independently(client):
    resp = client.post(
        "/api/documents",
        json={
            "type": "question",
            "title": "본문+해설 동반",
            "content": "본문",
            "content_blocks": _blocks("본문"),
            "answer": "정답",
            "explanation": "해설",
            "explanation_blocks": _blocks("해설"),
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["content_blocks"] == _blocks("본문")
    assert body["explanation_blocks"] == _blocks("해설")
    assert body["blocks_version"] == 1


# ---------------------------------------------------------------------------
# B-1 — 미동반 POST = 종전 계약 그대로 미전환 생성 (하위 호환)
# ---------------------------------------------------------------------------
def test_post_without_blocks_creates_unconverted_document_unchanged(client):
    resp = client.post(
        "/api/documents",
        json={"type": "concept", "title": "구 편집기 생성", "content": "본문만"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["content"] == "본문만"
    assert body["content_blocks"] is None
    assert body["explanation_blocks"] is None
    assert body["blocks_version"] is None


# ---------------------------------------------------------------------------
# B-1 — 에러 표(§4.29 ⑥) 3종
# ---------------------------------------------------------------------------
def test_post_content_blocks_without_content_returns_projection_required(client):
    resp = client.post(
        "/api/documents",
        json={
            "type": "concept",
            "title": "한쪽만",
            "content_blocks": _blocks(),
        },
    )
    assert resp.status_code == 422
    err = resp.json()["error"]
    assert err["code"] == "VALIDATION_ERROR"
    assert err["detail"]["reason"] == "projection_required"


def test_post_explanation_blocks_without_explanation_returns_projection_required(client):
    resp = client.post(
        "/api/documents",
        json={
            "type": "concept",
            "title": "해설만 한쪽",
            "content": "본문",
            "content_blocks": _blocks(),
            "explanation_blocks": _blocks(),
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["detail"]["reason"] == "projection_required"


def test_post_content_blocks_null_alone_returns_projection_required(client):
    """content_blocks: null 단독(=content 미동반)은 동반 규칙이 먼저 걸린다
    (§4.29 ⑥ 각주 — PATCH 실측과 동일 우선순위)."""
    resp = client.post(
        "/api/documents",
        json={"type": "concept", "title": "null 단독", "content_blocks": None},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["detail"]["reason"] == "projection_required"


def test_post_content_blocks_null_with_content_returns_blocks_invalid(client):
    resp = client.post(
        "/api/documents",
        json={
            "type": "concept",
            "title": "null + content",
            "content": "본문",
            "content_blocks": None,
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["detail"]["reason"] == "blocks_invalid"


def test_post_content_blocks_bad_shape_returns_blocks_invalid(client):
    resp = client.post(
        "/api/documents",
        json={
            "type": "concept",
            "title": "형태 위반",
            "content": "본문",
            "content_blocks": {"version": "not-an-int", "blocks": []},
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["detail"]["reason"] == "blocks_invalid"


def test_post_content_blocks_too_large_returns_too_large(client):
    huge = {"version": 1, "blocks": [{"type": "paragraph", "text": "x" * 1_000_001}]}
    resp = client.post(
        "/api/documents",
        json={
            "type": "concept",
            "title": "크기 상한",
            "content": "본문",
            "content_blocks": huge,
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["detail"]["reason"] == "too_large"


# ---------------------------------------------------------------------------
# B-2 — 목록·batch 무변경(블록 필드 미포함) + resolve-embeds 블록 필드 부재
# ---------------------------------------------------------------------------
def test_list_documents_excludes_block_fields(client):
    client.post(
        "/api/documents",
        json={
            "type": "concept",
            "title": "목록 확인용",
            "content": "본문",
            "content_blocks": _blocks(),
        },
    )
    resp = client.get("/api/documents")
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert "content_blocks" not in item
    assert "explanation_blocks" not in item
    assert "blocks_version" not in item


def test_resolve_embeds_response_has_no_block_fields(client):
    created = client.post(
        "/api/documents",
        json={
            "type": "concept",
            "title": "임베드 대상",
            "content": "본문",
            "content_blocks": _blocks(),
        },
    ).json()
    assert "content_blocks" not in EmbedResolveItem.model_fields
    assert "explanation_blocks" not in EmbedResolveItem.model_fields

    resp = client.post(
        "/api/documents/resolve-embeds", json={"doc_nos": [created["doc_no"]]}
    )
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert "content_blocks" not in item
    assert "explanation_blocks" not in item
    assert "blocks_version" not in item
