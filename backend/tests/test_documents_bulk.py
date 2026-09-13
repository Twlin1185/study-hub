"""POST /api/documents/bulk (S51 — 설계 §4.31) 계약 테스트.

고정하는 계약(계획서 stage-51-explore-bulk-select §2 규약 A~G):
  - 200 OK + DocumentBulkResult{action, requested, linked, unlinked, moved, deleted, skipped}
  - 검사 순서: pydantic 422 → 404 문서(missing_ids, all-or-nothing) → 404 분류
    (category_id) → 422 의미(move from==to · 비활성 문서 inactive_ids) → 실행 → commit 1회.
  - link: 없는 행만 생성(linked_by='manual'·local_note NULL) · 기존 행 무접촉 skipped.
  - unlink: 출발(+deep)의 링크 행만 삭제 · 부수 테이블(study_progress 등) 무접촉.
  - move: 문서당 1행 이관(출발 자신 행 우선) · 필드 보존 · 도착에 이미 있으면 도착 유지 +
    skipped · study_progress 1행 이관(도착에 있으면 무접촉) · attempts/resume_points 무변.
  - delete: is_active=0만 · 링크·태그·북마크 무접촉 · 이미 비활성 skipped.

픽스처는 test_category_delete.py 전례(PRAGMA foreign_keys=ON — study_progress 이관이 FK
아래서 검증되도록). 삭제/이관 이후 상태 확인은 db.expunge_all() 뒤 새 쿼리로 한다.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
import models
from database import Base, get_db


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

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


def _mk_category(db, name: str, parent_id: int | None = None) -> int:
    cat = models.Category(name=name, parent_id=parent_id)
    db.add(cat)
    db.commit()
    return cat.id


def _mk_document(db, doc_no: str, is_active: int = 1, doc_type: str = "concept") -> int:
    doc = models.Document(doc_no=doc_no, type=doc_type, title=doc_no, is_active=is_active)
    db.add(doc)
    db.commit()
    return doc.id


def _link(db, category_id: int, document_id: int, **kwargs) -> None:
    db.add(models.CategoryDocument(category_id=category_id, document_id=document_id, **kwargs))
    db.commit()


def _progress(db, category_id: int, document_id: int, **kwargs) -> None:
    db.add(models.StudyProgress(category_id=category_id, document_id=document_id, **kwargs))
    db.commit()


def _count_links(db) -> int:
    return len(db.execute(select(models.CategoryDocument)).scalars().all())


# ---------------------------------------------------------------------------
# ① link — 신규 n건 linked · 기존 연결 skipped · linked_by='manual' · local_note NULL
# ---------------------------------------------------------------------------


def test_link_new_and_existing(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    d1 = _mk_document(db, "D1")
    d2 = _mk_document(db, "D2")
    _link(db, cat_id, d1)  # d1은 이미 연결됨

    resp = client.post(
        "/api/documents/bulk",
        json={"action": "link", "document_ids": [d1, d2], "category_id": cat_id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {
        "action": "link",
        "requested": 2,
        "linked": 1,
        "unlinked": 0,
        "moved": 0,
        "deleted": 0,
        "skipped": 1,
    }

    db.expunge_all()
    row = db.get(models.CategoryDocument, {"category_id": cat_id, "document_id": d2})
    assert row is not None
    assert row.linked_by == "manual"
    assert row.local_note is None
    assert row.sort_order == 0


# ---------------------------------------------------------------------------
# ② unlink — 얕은/깊은 · 다른 분류 잔존 · study_progress 잔존(무접촉) · 대상 0 skipped
# ---------------------------------------------------------------------------


def test_unlink_shallow_keeps_other_category_and_progress(client: TestClient, db):
    parent_id = _mk_category(db, "P")
    other_id = _mk_category(db, "O")
    d1 = _mk_document(db, "D1")
    _link(db, parent_id, d1)
    _link(db, other_id, d1)
    _progress(db, parent_id, d1, status="done")

    resp = client.post(
        "/api/documents/bulk",
        json={"action": "unlink", "document_ids": [d1], "category_id": parent_id},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "action": "unlink",
        "requested": 1,
        "linked": 0,
        "unlinked": 1,
        "moved": 0,
        "deleted": 0,
        "skipped": 0,
    }

    db.expunge_all()
    assert db.get(models.CategoryDocument, {"category_id": parent_id, "document_id": d1}) is None
    assert db.get(models.CategoryDocument, {"category_id": other_id, "document_id": d1}) is not None
    # 부수 테이블 무접촉 — 분류 행이 존속하므로 진도 잔존
    assert db.get(models.StudyProgress, {"category_id": parent_id, "document_id": d1}) is not None


def test_unlink_deep_covers_descendants_and_skips_untargeted(client: TestClient, db):
    parent_id = _mk_category(db, "P")
    child_id = _mk_category(db, "C", parent_id=parent_id)
    d1 = _mk_document(db, "D1")
    d2 = _mk_document(db, "D2")  # 연결 없음 → skipped
    _link(db, child_id, d1)

    resp = client.post(
        "/api/documents/bulk",
        json={
            "action": "unlink",
            "document_ids": [d1, d2],
            "category_id": parent_id,
            "deep": True,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["unlinked"] == 1
    assert body["skipped"] == 1

    db.expunge_all()
    assert db.get(models.CategoryDocument, {"category_id": child_id, "document_id": d1}) is None


# ---------------------------------------------------------------------------
# ③ move — 필드 보존 · 도착 기존 skipped · deep dedup · study_progress 이관/무접촉 ·
#    attempts/resume_points 무변 · 출발 링크 0 문서 skipped · from==to 422
# ---------------------------------------------------------------------------


def test_move_preserves_fields_and_migrates_progress(client: TestClient, db):
    from_id = _mk_category(db, "From")
    to_id = _mk_category(db, "To")
    d1 = _mk_document(db, "D1")
    _link(db, from_id, d1, sort_order=5, local_note="메모", linked_by="rule")
    _progress(db, from_id, d1, status="done")

    resp = client.post(
        "/api/documents/bulk",
        json={
            "action": "move",
            "document_ids": [d1],
            "category_id": from_id,
            "to_category_id": to_id,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "action": "move",
        "requested": 1,
        "linked": 0,
        "unlinked": 0,
        "moved": 1,
        "deleted": 0,
        "skipped": 0,
    }

    db.expunge_all()
    assert db.get(models.CategoryDocument, {"category_id": from_id, "document_id": d1}) is None
    moved_row = db.get(models.CategoryDocument, {"category_id": to_id, "document_id": d1})
    assert moved_row is not None
    assert moved_row.sort_order == 5
    assert moved_row.local_note == "메모"
    assert moved_row.linked_by == "rule"

    progress_row = db.get(models.StudyProgress, {"category_id": to_id, "document_id": d1})
    assert progress_row is not None
    assert db.get(models.StudyProgress, {"category_id": from_id, "document_id": d1}) is None


def test_move_destination_exists_keeps_destination_and_skips(client: TestClient, db):
    from_id = _mk_category(db, "From")
    to_id = _mk_category(db, "To")
    d1 = _mk_document(db, "D1")
    _link(db, from_id, d1, local_note="출발메모")
    _link(db, to_id, d1, local_note="도착메모")

    resp = client.post(
        "/api/documents/bulk",
        json={
            "action": "move",
            "document_ids": [d1],
            "category_id": from_id,
            "to_category_id": to_id,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["moved"] == 0
    assert body["skipped"] == 1

    db.expunge_all()
    assert db.get(models.CategoryDocument, {"category_id": from_id, "document_id": d1}) is None
    dest_row = db.get(models.CategoryDocument, {"category_id": to_id, "document_id": d1})
    assert dest_row is not None
    assert dest_row.local_note == "도착메모"  # 도착 행 유지


def test_move_deep_dedup_prefers_source_root_row(client: TestClient, db):
    from_id = _mk_category(db, "From")
    child_id = _mk_category(db, "C", parent_id=from_id)
    to_id = _mk_category(db, "To")
    d1 = _mk_document(db, "D1")
    _link(db, from_id, d1, local_note="root-note")
    _link(db, child_id, d1, local_note="child-note")

    resp = client.post(
        "/api/documents/bulk",
        json={
            "action": "move",
            "document_ids": [d1],
            "category_id": from_id,
            "to_category_id": to_id,
            "deep": True,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1

    db.expunge_all()
    assert db.get(models.CategoryDocument, {"category_id": child_id, "document_id": d1}) is None
    dest_row = db.get(models.CategoryDocument, {"category_id": to_id, "document_id": d1})
    assert dest_row is not None
    assert dest_row.local_note == "root-note"  # 출발 자신의 행이 승자


def test_move_no_source_link_creates_nothing(client: TestClient, db):
    from_id = _mk_category(db, "From")
    to_id = _mk_category(db, "To")
    d1 = _mk_document(db, "D1")  # from_id에 연결 없음

    resp = client.post(
        "/api/documents/bulk",
        json={
            "action": "move",
            "document_ids": [d1],
            "category_id": from_id,
            "to_category_id": to_id,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["moved"] == 0
    assert body["skipped"] == 1

    db.expunge_all()
    assert db.get(models.CategoryDocument, {"category_id": to_id, "document_id": d1}) is None


def test_move_progress_destination_exists_untouched(client: TestClient, db):
    from_id = _mk_category(db, "From")
    to_id = _mk_category(db, "To")
    d1 = _mk_document(db, "D1")
    _link(db, from_id, d1)
    _progress(db, from_id, d1, status="in_progress")
    _progress(db, to_id, d1, status="done")

    resp = client.post(
        "/api/documents/bulk",
        json={
            "action": "move",
            "document_ids": [d1],
            "category_id": from_id,
            "to_category_id": to_id,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["moved"] == 1

    db.expunge_all()
    # 도착에 이미 있으므로 무접촉(상태 그대로) — 출발 잔존 행도 삭제 0
    dest_progress = db.get(models.StudyProgress, {"category_id": to_id, "document_id": d1})
    assert dest_progress is not None
    assert dest_progress.status == "done"
    assert db.get(models.StudyProgress, {"category_id": from_id, "document_id": d1}) is not None


def test_move_attempts_and_resume_points_untouched(client: TestClient, db):
    from_id = _mk_category(db, "From")
    to_id = _mk_category(db, "To")
    d1 = _mk_document(db, "D1")
    _link(db, from_id, d1)
    attempt = models.Attempt(document_id=d1, category_id=from_id, is_correct=1)
    db.add(attempt)
    resume = models.ResumePoint(category_id=from_id, document_id=d1)
    db.add(resume)
    db.commit()
    attempt_id = attempt.id

    resp = client.post(
        "/api/documents/bulk",
        json={
            "action": "move",
            "document_ids": [d1],
            "category_id": from_id,
            "to_category_id": to_id,
        },
    )
    assert resp.status_code == 200, resp.text

    db.expunge_all()
    refreshed_attempt = db.get(models.Attempt, attempt_id)
    assert refreshed_attempt.category_id == from_id  # 무변
    refreshed_resume = db.get(models.ResumePoint, from_id)
    assert refreshed_resume is not None  # 무변(삭제 0)


def test_move_from_equals_to_returns_422(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    d1 = _mk_document(db, "D1")
    _link(db, cat_id, d1)

    resp = client.post(
        "/api/documents/bulk",
        json={
            "action": "move",
            "document_ids": [d1],
            "category_id": cat_id,
            "to_category_id": cat_id,
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# ④ delete — is_active=0 · 링크·북마크·태그 무접촉 · 이미 비활성 skipped
# ---------------------------------------------------------------------------


def test_delete_soft_deletes_and_keeps_side_tables(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    d1 = _mk_document(db, "D1")
    d2 = _mk_document(db, "D2", is_active=0)  # 이미 비활성
    _link(db, cat_id, d1)
    db.add(models.Bookmark(document_id=d1))
    tag = models.Tag(name="t1")
    db.add(tag)
    db.commit()
    db.add(models.DocumentTag(document_id=d1, tag_id=tag.id))
    db.commit()

    resp = client.post(
        "/api/documents/bulk",
        json={"action": "delete", "document_ids": [d1, d2]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "action": "delete",
        "requested": 2,
        "linked": 0,
        "unlinked": 0,
        "moved": 0,
        "deleted": 1,
        "skipped": 1,
    }

    db.expunge_all()
    assert db.get(models.Document, d1).is_active == 0
    # 링크·북마크·태그 행 무접촉
    assert db.get(models.CategoryDocument, {"category_id": cat_id, "document_id": d1}) is not None
    assert db.get(models.Bookmark, d1) is not None
    assert len(db.execute(select(models.DocumentTag)).scalars().all()) == 1


# ---------------------------------------------------------------------------
# ⑤ 없는 id 포함 → 404 missing_ids + 부분 변경 0(롤백)
# ---------------------------------------------------------------------------


def test_missing_document_id_rejects_all_or_nothing(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    d1 = _mk_document(db, "D1")
    missing_id = d1 + 999

    resp = client.post(
        "/api/documents/bulk",
        json={"action": "link", "document_ids": [d1, missing_id], "category_id": cat_id},
    )
    assert resp.status_code == 404, resp.text
    body = resp.json()
    assert body["error"]["code"] == "NOT_FOUND"
    assert body["error"]["detail"]["missing_ids"] == [missing_id]

    db.expunge_all()
    # 부분 변경 0 — d1도 연결되지 않았어야 함
    assert db.get(models.CategoryDocument, {"category_id": cat_id, "document_id": d1}) is None


# ---------------------------------------------------------------------------
# ⑥ 비활성 문서 + link → 422 inactive_ids
# ---------------------------------------------------------------------------


def test_inactive_document_rejects_link(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    d1 = _mk_document(db, "D1", is_active=0)

    resp = client.post(
        "/api/documents/bulk",
        json={"action": "link", "document_ids": [d1], "category_id": cat_id},
    )
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["detail"]["inactive_ids"] == [d1]


# ---------------------------------------------------------------------------
# ⑦ 빈 배열 · 201건 · 필수 필드 누락 → 422
# ---------------------------------------------------------------------------


def test_empty_document_ids_returns_422(client: TestClient, db):
    resp = client.post(
        "/api/documents/bulk",
        json={"action": "delete", "document_ids": []},
    )
    assert resp.status_code == 422, resp.text


def test_too_many_document_ids_returns_422(client: TestClient, db):
    resp = client.post(
        "/api/documents/bulk",
        json={"action": "delete", "document_ids": list(range(1, 202))},
    )
    assert resp.status_code == 422, resp.text


def test_missing_required_field_for_action_returns_422(client: TestClient, db):
    resp = client.post(
        "/api/documents/bulk",
        json={"action": "link", "document_ids": [1]},  # category_id 누락
    )
    assert resp.status_code == 422, resp.text

    resp2 = client.post(
        "/api/documents/bulk",
        json={"action": "move", "document_ids": [1], "category_id": 1},  # to_category_id 누락
    )
    assert resp2.status_code == 422, resp2.text


# ---------------------------------------------------------------------------
# ⑧ 분류 미존재 → 404
# ---------------------------------------------------------------------------


def test_missing_category_returns_404(client: TestClient, db):
    d1 = _mk_document(db, "D1")

    resp = client.post(
        "/api/documents/bulk",
        json={"action": "link", "document_ids": [d1], "category_id": 999999},
    )
    assert resp.status_code == 404, resp.text
    body = resp.json()
    assert body["error"]["detail"]["category_id"] == 999999


# ---------------------------------------------------------------------------
# ⑨ 항등식 G — 문서 단위 카운터(link/move/delete = requested = 처리 + skipped)
# ---------------------------------------------------------------------------


def test_result_identity_link_move_delete(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    to_id = _mk_category(db, "B")
    d1 = _mk_document(db, "D1")
    d2 = _mk_document(db, "D2")

    resp = client.post(
        "/api/documents/bulk",
        json={"action": "link", "document_ids": [d1, d2], "category_id": cat_id},
    )
    body = resp.json()
    assert body["requested"] == body["linked"] + body["skipped"]

    resp2 = client.post(
        "/api/documents/bulk",
        json={
            "action": "move",
            "document_ids": [d1, d2],
            "category_id": cat_id,
            "to_category_id": to_id,
        },
    )
    body2 = resp2.json()
    assert body2["requested"] == body2["moved"] + body2["skipped"]

    resp3 = client.post(
        "/api/documents/bulk",
        json={"action": "delete", "document_ids": [d1, d2]},
    )
    body3 = resp3.json()
    assert body3["requested"] == body3["deleted"] + body3["skipped"]

    # dedup 확인: 중복 id를 넣어도 requested는 유일 개수
    d3 = _mk_document(db, "D3")
    resp4 = client.post(
        "/api/documents/bulk",
        json={"action": "delete", "document_ids": [d3, d3, d3]},
    )
    assert resp4.json()["requested"] == 1
