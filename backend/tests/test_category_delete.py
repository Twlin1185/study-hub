"""DELETE /api/categories/{id} (S50 — 설계 §4.1 [S50]) 계약 테스트.

고정하는 계약:
  - 200 OK + CategoryDeleteResult{deleted_categories, unlinked, reparented, skipped_duplicates}
  - 기본(파라미터 없음): 하위 있음 → 409(children) · 활성 문서 있음 → 409(documents).
    소프트 삭제 문서의 잔존 링크는 판정에서 제외하고 실행 시 unlink로 정리(결함 ① 수정).
  - recursive=1: 하위 트리 전체 물리 삭제(깊은 노드 먼저), on_documents 정책도 트리 전체 적용.
  - on_documents=unlink: 링크만 삭제, 문서 무접촉.
  - on_documents=reparent: 링크를 최상위 삭제 대상의 parent_id로 이관(sort_order 등 보존),
    부모에 이미 같은 문서가 있으면 skipped_duplicates.
  - 루트 + reparent → 422.
  - 태그 규칙 존재 → 409(tag_rule_ids), 부분 삭제 없음.
  - suggestions/resume_points 정리, attempts.category_id NULL/부모 이관.

주의: 픽스처 헬퍼는 ORM 객체가 아니라 순수 int id를 반환한다 — DELETE 호출은 같은
세션에서 commit(expire_on_commit)을 유발하므로, 만들 때 받은 객체의 속성을 삭제 이후
다시 읽으면 DetachedInstanceError/ObjectDeletedError가 난다(세션 재사용 픽스처 전례:
test_notes_duplicate.py). 삭제 이후 상태 확인은 항상 `db.expunge_all()`로 identity map을
비운 뒤 새 쿼리로 한다.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
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


# ---------------------------------------------------------------------------
# ① 기본(파라미터 0) + 활성 문서 → 409
# ---------------------------------------------------------------------------


def test_default_active_document_conflict(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    doc_id = _mk_document(db, "D1")
    _link(db, cat_id, doc_id)

    resp = client.delete(f"/api/categories/{cat_id}")
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["error"]["code"] == "CONFLICT"
    assert body["error"]["detail"]["documents"] == 1

    db.expunge_all()
    # 부분 삭제 없음
    assert db.get(models.Category, cat_id) is not None


# ---------------------------------------------------------------------------
# ② 비활성 문서 링크만 → 200 삭제 (결함 ① 회귀)
# ---------------------------------------------------------------------------


def test_default_inactive_document_link_only_deletes(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    doc_id = _mk_document(db, "D1", is_active=0)
    _link(db, cat_id, doc_id)

    resp = client.delete(f"/api/categories/{cat_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {
        "deleted_categories": 1,
        "unlinked": 1,
        "reparented": 0,
        "skipped_duplicates": 0,
    }

    db.expunge_all()  # 삭제된 행의 세션 캐시(identity map) 무효화 — 기대: 조회 시 None
    assert db.get(models.Category, cat_id) is None
    # 문서 자체는 무접촉
    refreshed_doc = db.get(models.Document, doc_id)
    assert refreshed_doc is not None
    assert refreshed_doc.is_active == 0


# ---------------------------------------------------------------------------
# ③ 하위 있음 + 비재귀 → 409 / recursive=1 → 하위 전부 삭제·통계
# ---------------------------------------------------------------------------


def test_children_conflict_without_recursive(client: TestClient, db):
    parent_id = _mk_category(db, "P")
    _mk_category(db, "C", parent_id=parent_id)

    resp = client.delete(f"/api/categories/{parent_id}")
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["detail"]["children"] == 1

    db.expunge_all()
    assert db.get(models.Category, parent_id) is not None


def test_recursive_deletes_whole_subtree(client: TestClient, db):
    parent_id = _mk_category(db, "P")
    child_id = _mk_category(db, "C", parent_id=parent_id)
    grandchild_id = _mk_category(db, "GC", parent_id=child_id)

    resp = client.delete(f"/api/categories/{parent_id}", params={"recursive": "true"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["deleted_categories"] == 3

    db.expunge_all()
    assert db.get(models.Category, parent_id) is None
    assert db.get(models.Category, child_id) is None
    assert db.get(models.Category, grandchild_id) is None


# ---------------------------------------------------------------------------
# ④ unlink → 링크 0·문서 is_active 무변·study_progress 삭제·attempts.category_id NULL
# ---------------------------------------------------------------------------


def test_unlink_clears_links_and_progress_and_nulls_attempts(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    doc_id = _mk_document(db, "D1")
    _link(db, cat_id, doc_id)
    db.add(models.StudyProgress(category_id=cat_id, document_id=doc_id, status="done"))
    db.add(models.ResumePoint(category_id=cat_id, document_id=doc_id))
    attempt = models.Attempt(document_id=doc_id, category_id=cat_id, is_correct=1)
    db.add(attempt)
    db.commit()
    attempt_id = attempt.id

    resp = client.delete(f"/api/categories/{cat_id}", params={"on_documents": "unlink"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {
        "deleted_categories": 1,
        "unlinked": 1,
        "reparented": 0,
        "skipped_duplicates": 0,
    }

    db.expunge_all()
    assert db.get(models.Category, cat_id) is None
    assert (
        db.query(models.CategoryDocument)
        .filter_by(category_id=cat_id, document_id=doc_id)
        .first()
        is None
    )
    assert db.get(models.Document, doc_id) is not None
    assert (
        db.query(models.StudyProgress)
        .filter_by(category_id=cat_id, document_id=doc_id)
        .first()
        is None
    )
    assert db.query(models.ResumePoint).filter_by(category_id=cat_id).first() is None
    refreshed_attempt = db.get(models.Attempt, attempt_id)
    assert refreshed_attempt.category_id is None


# ---------------------------------------------------------------------------
# ⑤ reparent → 부모 링크 존재·sort_order/local_note 보존·중복 시 skipped_duplicates
#    ·study_progress 이관·attempts 부모
# ---------------------------------------------------------------------------


def test_reparent_moves_links_and_progress(client: TestClient, db):
    grandparent_id = _mk_category(db, "GP")
    parent_id = _mk_category(db, "P", parent_id=grandparent_id)
    doc_id = _mk_document(db, "D1")
    _link(db, parent_id, doc_id, sort_order=5, local_note="메모")
    db.add(models.StudyProgress(category_id=parent_id, document_id=doc_id, status="done"))
    attempt = models.Attempt(document_id=doc_id, category_id=parent_id, is_correct=1)
    db.add(attempt)
    db.commit()
    attempt_id = attempt.id

    resp = client.delete(f"/api/categories/{parent_id}", params={"on_documents": "reparent"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {
        "deleted_categories": 1,
        "unlinked": 0,
        "reparented": 1,
        "skipped_duplicates": 0,
    }

    db.expunge_all()
    link = (
        db.query(models.CategoryDocument)
        .filter_by(category_id=grandparent_id, document_id=doc_id)
        .first()
    )
    assert link is not None
    assert link.sort_order == 5
    assert link.local_note == "메모"

    progress = (
        db.query(models.StudyProgress)
        .filter_by(category_id=grandparent_id, document_id=doc_id)
        .first()
    )
    assert progress is not None
    assert progress.status == "done"

    refreshed_attempt = db.get(models.Attempt, attempt_id)
    assert refreshed_attempt.category_id == grandparent_id


def test_reparent_skips_duplicate_already_in_parent(client: TestClient, db):
    grandparent_id = _mk_category(db, "GP")
    parent_id = _mk_category(db, "P", parent_id=grandparent_id)
    doc_id = _mk_document(db, "D1")
    _link(db, grandparent_id, doc_id, sort_order=1)
    _link(db, parent_id, doc_id, sort_order=2)
    db.add(models.StudyProgress(category_id=parent_id, document_id=doc_id, status="done"))
    db.commit()

    resp = client.delete(f"/api/categories/{parent_id}", params={"on_documents": "reparent"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["reparented"] == 0
    assert body["skipped_duplicates"] == 1

    db.expunge_all()
    # 부모의 기존 행 유지(sort_order=1 그대로)
    link = (
        db.query(models.CategoryDocument)
        .filter_by(category_id=grandparent_id, document_id=doc_id)
        .first()
    )
    assert link is not None
    assert link.sort_order == 1

    # study_progress도 부모에 없었으므로 이관 여부 확인(부모에 기존 행 없었음 → 이관)
    progress = (
        db.query(models.StudyProgress)
        .filter_by(category_id=grandparent_id, document_id=doc_id)
        .first()
    )
    assert progress is not None


# ---------------------------------------------------------------------------
# ⑥ 루트 + reparent → 422
# ---------------------------------------------------------------------------


def test_reparent_on_root_returns_422(client: TestClient, db):
    root_id = _mk_category(db, "Root")

    resp = client.delete(f"/api/categories/{root_id}", params={"on_documents": "reparent"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"

    db.expunge_all()
    assert db.get(models.Category, root_id) is not None


# ---------------------------------------------------------------------------
# ⑦ 태그 규칙 존재 → 409(tag_rule_ids) · 부분 삭제 0
# ---------------------------------------------------------------------------


def test_tag_rule_blocks_delete(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    rule = models.TagRule(category_id=cat_id, tag_query="키워드", mode="suggest")
    db.add(rule)
    db.commit()
    rule_id = rule.id

    resp = client.delete(f"/api/categories/{cat_id}")
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["detail"]["tag_rule_ids"] == [rule_id]

    db.expunge_all()
    assert db.get(models.Category, cat_id) is not None


def test_tag_rule_blocks_recursive_delete_via_descendant(client: TestClient, db):
    parent_id = _mk_category(db, "P")
    child_id = _mk_category(db, "C", parent_id=parent_id)
    rule = models.TagRule(category_id=child_id, tag_query="키워드", mode="suggest")
    db.add(rule)
    db.commit()
    rule_id = rule.id

    resp = client.delete(f"/api/categories/{parent_id}", params={"recursive": "true"})
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["detail"]["tag_rule_ids"] == [rule_id]

    db.expunge_all()
    assert db.get(models.Category, parent_id) is not None
    assert db.get(models.Category, child_id) is not None


# ---------------------------------------------------------------------------
# ⑧ suggestions·resume_points 행 정리(FK ON 픽스처에서 IntegrityError 0)
# ---------------------------------------------------------------------------


def test_suggestions_and_resume_points_cleaned_up_no_fk_error(client: TestClient, db):
    cat_id = _mk_category(db, "A")
    doc_id = _mk_document(db, "D1", is_active=0)  # 비활성 링크만 → 기본 동작으로 삭제 가능
    _link(db, cat_id, doc_id)
    db.add(models.Suggestion(document_id=doc_id, category_id=cat_id, status="pending"))
    db.add(models.ResumePoint(category_id=cat_id, document_id=doc_id))
    db.commit()

    resp = client.delete(f"/api/categories/{cat_id}")
    assert resp.status_code == 200, resp.text

    db.expunge_all()
    assert db.query(models.Suggestion).filter_by(category_id=cat_id).first() is None
    assert db.query(models.ResumePoint).filter_by(category_id=cat_id).first() is None
    assert db.get(models.Category, cat_id) is None


# ---------------------------------------------------------------------------
# ⑨ 잘못된 on_documents → 422
# ---------------------------------------------------------------------------


def test_invalid_on_documents_returns_422(client: TestClient, db):
    cat_id = _mk_category(db, "A")

    resp = client.delete(f"/api/categories/{cat_id}", params={"on_documents": "delete"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"

    db.expunge_all()
    assert db.get(models.Category, cat_id) is not None
