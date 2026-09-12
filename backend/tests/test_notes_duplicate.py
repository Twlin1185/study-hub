"""POST /api/notes/{id}/duplicate (S48 — 설계 §4.28 ⑦) 계약 테스트.

고정하는 계약:
  - 요청 본문 없음, 200 OK + 새 노트 NoteOut(id 새 값 · is_active true).
  - 제목: rstrip() + " (사본)" · 공백뿐이면 "(사본)" · 200자 상한 초과 시 원제
    절단(접미사 유지) · 반복 복제는 접미사 누적.
  - content_blocks/content/blocks_version 원본 그대로 복사, 원본 무변.
  - 삭제된 원본(is_active=0)·존재하지 않는 id는 동일한 404.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from database import Base, get_db
from routers.notes import _duplicate_title, TITLE_MAX_LEN


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


def _create(client: TestClient, title: str = "원본 제목") -> dict:
    payload = {
        "title": title,
        "content_blocks": _blocks(),
        "content": "hello",
    }
    resp = client.post("/api/notes", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# _duplicate_title 단위 테스트
# ---------------------------------------------------------------------------


def test_duplicate_title_basic():
    assert _duplicate_title("제목") == "제목 (사본)"


def test_duplicate_title_rstrip():
    assert _duplicate_title("제목   ") == "제목 (사본)"


def test_duplicate_title_blank():
    assert _duplicate_title("") == "(사본)"
    assert _duplicate_title("   ") == "(사본)"


def test_duplicate_title_truncates_over_limit():
    long_title = "가" * 199
    result = _duplicate_title(long_title)
    assert len(result) <= TITLE_MAX_LEN
    assert result.endswith(" (사본)")


def test_duplicate_title_exact_200():
    title_200 = "가" * 200
    result = _duplicate_title(title_200)
    assert len(result) <= TITLE_MAX_LEN
    assert result.endswith(" (사본)")


def test_duplicate_title_repeated():
    once = _duplicate_title("제목")
    twice = _duplicate_title(once)
    assert twice == "제목 (사본) (사본)"


# ---------------------------------------------------------------------------
# ⓐ 생성 -> 복제 -> 응답 검증
# ---------------------------------------------------------------------------


def test_duplicate_creates_new_note_with_copied_body(client: TestClient):
    original = _create(client, title="원본 제목")

    resp = client.post(f"/api/notes/{original['id']}/duplicate")
    assert resp.status_code == 200, resp.text
    dup = resp.json()

    assert dup["id"] != original["id"]
    assert dup["title"] == "원본 제목 (사본)"
    assert dup["content_blocks"] == original["content_blocks"]
    assert dup["content"] == original["content"]
    assert dup["blocks_version"] == original["blocks_version"]
    assert dup["is_active"] is True


# ---------------------------------------------------------------------------
# ⓑ 목록에 2건, 원본 무변
# ---------------------------------------------------------------------------


def test_duplicate_leaves_original_unchanged_and_lists_both(client: TestClient):
    original = _create(client, title="원본 제목")
    client.post(f"/api/notes/{original['id']}/duplicate")

    listing = client.get("/api/notes")
    assert listing.status_code == 200
    body = listing.json()
    assert body["total"] == 2

    refetched = client.get(f"/api/notes/{original['id']}")
    assert refetched.status_code == 200
    refetched_body = refetched.json()
    assert refetched_body["title"] == "원본 제목"
    assert refetched_body["content_blocks"] == original["content_blocks"]
    assert refetched_body["updated_at"] == original["updated_at"]


# ---------------------------------------------------------------------------
# ⓒ 공백 제목
# ---------------------------------------------------------------------------


def test_duplicate_blank_title_becomes_suffix_only(client: TestClient):
    original = _create(client, title="   ")

    resp = client.post(f"/api/notes/{original['id']}/duplicate")
    assert resp.status_code == 200
    assert resp.json()["title"] == "(사본)"


# ---------------------------------------------------------------------------
# ⓓ 199~200자 제목 -> 결과 200자 이하 + 접미사 유지
# ---------------------------------------------------------------------------


def test_duplicate_long_title_truncated_but_keeps_suffix(client: TestClient):
    for length in (199, 200):
        original = _create(client, title="가" * length)
        resp = client.post(f"/api/notes/{original['id']}/duplicate")
        assert resp.status_code == 200
        title = resp.json()["title"]
        assert len(title) <= TITLE_MAX_LEN
        assert title.endswith(" (사본)")


# ---------------------------------------------------------------------------
# ⓔ 삭제 후 복제 -> 404
# ---------------------------------------------------------------------------


def test_duplicate_after_delete_returns_404(client: TestClient):
    original = _create(client, title="원본 제목")
    del_resp = client.delete(f"/api/notes/{original['id']}")
    assert del_resp.status_code == 200

    resp = client.post(f"/api/notes/{original['id']}/duplicate")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------
# ⓕ 없는 id -> 404
# ---------------------------------------------------------------------------


def test_duplicate_missing_id_returns_404(client: TestClient):
    resp = client.post("/api/notes/999999/duplicate")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------
# ⓖ 반복 복제 -> 접미사 누적
# ---------------------------------------------------------------------------


def test_duplicate_repeated_accumulates_suffix(client: TestClient):
    original = _create(client, title="제목")
    first = client.post(f"/api/notes/{original['id']}/duplicate").json()
    second = client.post(f"/api/notes/{first['id']}/duplicate").json()

    assert first["title"] == "제목 (사본)"
    assert second["title"] == "제목 (사본) (사본)"
