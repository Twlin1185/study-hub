"""통합 휴지통 (S52, 설계 §4.32) 계약 테스트 — 문서·노트 복원 + 고아 이미지 2단계 정리.

고정하는 계약:
  ① 문서 복원 — 삭제→휴지통 노출→활성 목록 미노출→복원→반대, 부수 테이블(링크·태그·
     북마크·attempts) 무변, 재복원 멱등, 없는 id 404.
  ② 노트 복원 — 동일 + 복원 후 복제 가능.
  ③ 스캔 — 활성/비활성 문서·노트 블록·import/auto JSON 참조 전부 referenced, 미참조는
     orphans, 정규식 불충족은 other_files, 최근 mtime은 recent_skipped, .trash/는 trashed.
  ④ 이동 — 고아만 이동(all-or-nothing), 참조 중 파일 포함 시 422 + 이동 0, 잘못된
     파일명 422 + 부작용 0, 빈 배열/501건 422.
  ⑤ 되돌리기 — 대상 존재 시 skipped(휴지통 사본 유지), 미존재 skipped.
  ⑥ 서빙 — `.trash/` 이동 후 404, 되돌린 뒤 200.
  ⑦ 반입 원본(sources/ 밖 파일)은 스캔·이동 대상이 아니다.

`tmp_path`로 `convert_service.SOURCES_IMAGES_DIR`·`preview_store.AUTO_DIR`·
`main.IMAGES_DIR`를 monkeypatch — 실 `sources/` 무접촉.
"""
from __future__ import annotations

import hashlib
import os
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
import models
from database import Base, get_db
from services import convert_service, preview_store


# ---------------------------------------------------------------------------
# 픽스처 (test_documents_bulk.py·test_notes_duplicate.py 전례)
# ---------------------------------------------------------------------------
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


@pytest.fixture()
def dirs(tmp_path, monkeypatch):
    """실 `sources/`·`import/auto/` 무접촉 — 격리된 임시 폴더로 전부 monkeypatch."""
    images_dir = tmp_path / "sources" / "images"
    images_dir.mkdir(parents=True)
    auto_dir = tmp_path / "import" / "auto"
    auto_dir.mkdir(parents=True)
    # 스캔·이동은 convert_service.SOURCES_IMAGES_DIR/preview_store.AUTO_DIR를 호출
    # 시점에 읽는다(trash_service.py 설계). 서빙(main.py)은 별도 IMAGES_DIR 상수.
    monkeypatch.setattr(convert_service, "SOURCES_IMAGES_DIR", images_dir)
    monkeypatch.setattr(preview_store, "AUTO_DIR", auto_dir)
    monkeypatch.setattr(main, "IMAGES_DIR", images_dir)
    return images_dir, auto_dir


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------
def _fname(seed: str, ext: str = "png") -> str:
    return f"{hashlib.sha256(seed.encode()).hexdigest()[:16]}.{ext}"


def _write_image(images_dir, filename: str, age_days: float | None = None) -> None:
    path = images_dir / filename
    path.write_bytes(b"fake-image-bytes")
    if age_days is not None:
        ts = time.time() - age_days * 86400
        os.utime(path, (ts, ts))


def _mk_document(
    db,
    doc_no: str,
    *,
    content: str | None = None,
    choices: str | None = None,
    explanation: str | None = None,
    content_blocks: str | None = None,
    explanation_blocks: str | None = None,
    is_active: int = 1,
) -> models.Document:
    doc = models.Document(
        doc_no=doc_no,
        type="concept",
        title=f"제목-{doc_no}",
        content=content,
        choices=choices,
        explanation=explanation,
        content_blocks=content_blocks,
        explanation_blocks=explanation_blocks,
        is_active=is_active,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def _mk_note(db, content_blocks: str, *, content: str = "body", is_active: int = 1) -> models.Note:
    note = models.Note(
        title="노트", content_blocks=content_blocks, content=content, blocks_version=1, is_active=is_active
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


# ---------------------------------------------------------------------------
# ① 문서 복원
# ---------------------------------------------------------------------------
def test_document_restore_roundtrip_and_side_tables_untouched(client, db, dirs):
    cat = models.Category(name="분류")
    db.add(cat)
    db.commit()
    db.refresh(cat)

    doc = _mk_document(db, "DOC-T1")
    db.add(models.CategoryDocument(category_id=cat.id, document_id=doc.id))
    tag = models.Tag(name="tag1")
    db.add(tag)
    db.commit()
    db.refresh(tag)
    db.add(models.DocumentTag(document_id=doc.id, tag_id=tag.id))
    db.add(models.Bookmark(document_id=doc.id))
    db.add(models.Attempt(document_id=doc.id, is_correct=1, mode="quiz"))
    db.commit()

    def _counts():
        return (
            db.query(models.CategoryDocument).count(),
            db.query(models.DocumentTag).count(),
            db.query(models.Bookmark).count(),
            db.query(models.Attempt).count(),
        )

    before = _counts()

    resp = client.delete(f"/api/documents/{doc.id}")
    assert resp.status_code == 204

    # 활성 목록 미노출
    active_list = client.get("/api/documents").json()
    assert doc.id not in [item["id"] for item in active_list["items"]]

    # 휴지통 목록 노출
    trash_list = client.get("/api/trash/documents").json()
    trash_ids = [item["id"] for item in trash_list["items"]]
    assert doc.id in trash_ids
    trashed_item = next(item for item in trash_list["items"] if item["id"] == doc.id)
    assert trashed_item["is_active"] is False

    assert _counts() == before  # 삭제가 부수 테이블 무접촉

    resp = client.post(f"/api/documents/{doc.id}/restore")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_active"] is True

    assert _counts() == before  # 복원도 부수 테이블 무접촉

    active_list = client.get("/api/documents").json()
    assert doc.id in [item["id"] for item in active_list["items"]]
    trash_list = client.get("/api/trash/documents").json()
    assert doc.id not in [item["id"] for item in trash_list["items"]]

    # 재복원 멱등
    resp2 = client.post(f"/api/documents/{doc.id}/restore")
    assert resp2.status_code == 200
    assert resp2.json()["is_active"] is True


def test_document_restore_missing_id_404(client, dirs):
    resp = client.post("/api/documents/999999/restore")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------
# ② 노트 복원
# ---------------------------------------------------------------------------
def _create_note_via_api(client, title="원본") -> dict:
    payload = {
        "title": title,
        "content_blocks": {"version": 1, "blocks": [{"type": "paragraph", "text": "hi"}]},
        "content": "hi",
    }
    resp = client.post("/api/notes", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_note_restore_roundtrip_and_duplicate_after(client, dirs):
    note = _create_note_via_api(client)

    resp = client.delete(f"/api/notes/{note['id']}")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    active_list = client.get("/api/notes").json()
    assert note["id"] not in [item["id"] for item in active_list["items"]]

    trash_list = client.get("/api/trash/notes").json()
    assert note["id"] in [item["id"] for item in trash_list["items"]]

    resp = client.post(f"/api/notes/{note['id']}/restore")
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is True

    active_list = client.get("/api/notes").json()
    assert note["id"] in [item["id"] for item in active_list["items"]]
    trash_list = client.get("/api/trash/notes").json()
    assert note["id"] not in [item["id"] for item in trash_list["items"]]

    # 재복원 멱등
    resp2 = client.post(f"/api/notes/{note['id']}/restore")
    assert resp2.status_code == 200
    assert resp2.json()["is_active"] is True

    # 복원 후 복제 가능
    dup_resp = client.post(f"/api/notes/{note['id']}/duplicate")
    assert dup_resp.status_code == 200


def test_note_restore_missing_id_404(client, dirs):
    resp = client.post("/api/notes/999999/restore")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------
# ③ 스캔
# ---------------------------------------------------------------------------
def test_scan_images_classifies_referenced_orphan_other_recent_trashed(client, db, dirs):
    images_dir, auto_dir = dirs

    fname_active_doc = _fname("active-doc")
    fname_inactive_doc = _fname("inactive-doc")
    fname_note = _fname("note")
    fname_auto = _fname("auto-json")
    fname_orphan_old = _fname("orphan-old")
    fname_orphan_recent = _fname("orphan-recent")
    fname_other = "not-a-hash-name.tmp"
    fname_trashed = _fname("already-trashed")

    for f in (
        fname_active_doc,
        fname_inactive_doc,
        fname_note,
        fname_orphan_old,
        fname_orphan_recent,
    ):
        _write_image(images_dir, f)
    os.utime(images_dir / fname_orphan_old, (time.time() - 30 * 86400,) * 2)
    # fname_orphan_recent은 방금 생성 = mtime now (recent_skipped 후보)

    (images_dir / fname_other).write_bytes(b"not-image-pattern")

    trash_dir = images_dir / ".trash"
    trash_dir.mkdir()
    (trash_dir / fname_trashed).write_bytes(b"trashed-bytes")

    _mk_document(db, "DOC-ACTIVE", content=f"본문 /images/{fname_active_doc} 참조", is_active=1)
    _mk_document(db, "DOC-INACTIVE", explanation=f"해설 /images/{fname_inactive_doc}", is_active=0)
    _mk_note(db, content_blocks=f'{{"version":1,"blocks":[{{"url":"/images/{fname_note}"}}]}}')

    (auto_dir / "preview-1__abc123456789__x.json").write_text(
        f'{{"blocks": [{{"url": "/images/{fname_auto}"}}]}}', encoding="utf-8"
    )
    _write_image(images_dir, fname_auto)

    resp = client.get("/api/trash/images", params={"min_age_days": 7})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    orphan_names = [e["filename"] for e in body["orphans"]]
    assert orphan_names == sorted(orphan_names)
    assert fname_orphan_old in orphan_names
    assert fname_orphan_recent not in orphan_names
    for referenced_name in (fname_active_doc, fname_inactive_doc, fname_note, fname_auto):
        assert referenced_name not in orphan_names

    assert body["referenced"] == 4
    assert body["recent_skipped"] == 1
    assert body["other_files"] == 1
    assert body["total_files"] == body["referenced"] + len(body["orphans"]) + body["recent_skipped"]

    trashed_names = [e["filename"] for e in body["trashed"]]
    assert trashed_names == [fname_trashed]

    assert body["min_age_days"] == 7
    assert body["trash_dir"].replace("\\", "/").endswith("sources/images/.trash")

    # min_age_days=0 이면 recent 후보도 orphan에 포함
    resp0 = client.get("/api/trash/images", params={"min_age_days": 0})
    body0 = resp0.json()
    orphan_names0 = [e["filename"] for e in body0["orphans"]]
    assert fname_orphan_recent in orphan_names0
    assert body0["recent_skipped"] == 0


def test_scan_min_age_days_out_of_range_422(client, dirs):
    resp = client.get("/api/trash/images", params={"min_age_days": 366})
    assert resp.status_code == 422
    resp2 = client.get("/api/trash/images", params={"min_age_days": -1})
    assert resp2.status_code == 422


# ---------------------------------------------------------------------------
# ④ 이동
# ---------------------------------------------------------------------------
def test_move_orphans_to_trash(client, db, dirs):
    images_dir, _ = dirs
    orphan = _fname("move-orphan")
    _write_image(images_dir, orphan, age_days=30)

    resp = client.post("/api/trash/images/move", json={"filenames": [orphan]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {"moved": 1, "skipped": 0}
    assert not (images_dir / orphan).exists()
    assert (images_dir / ".trash" / orphan).exists()


def test_move_missing_file_is_skipped_not_404(client, dirs):
    ghost = _fname("ghost-file")
    resp = client.post("/api/trash/images/move", json={"filenames": [ghost]})
    assert resp.status_code == 200
    assert resp.json() == {"moved": 0, "skipped": 1}


def test_move_when_trash_already_has_same_name_is_skipped_no_overwrite(client, dirs):
    """규약 C — `.trash/`에 같은 이름이 이미 있으면 원본 그대로 두고 skipped(덮어쓰기 0).
    restore 쪽 대칭 케이스는 test_restore_when_target_exists_is_skipped_and_trash_copy_kept."""
    images_dir, _ = dirs
    trash_dir = images_dir / ".trash"
    trash_dir.mkdir()
    fname = _fname("dup-in-trash")
    _write_image(images_dir, fname, age_days=30)
    (trash_dir / fname).write_bytes(b"existing-trash-bytes")

    resp = client.post("/api/trash/images/move", json={"filenames": [fname]})
    assert resp.status_code == 200
    assert resp.json() == {"moved": 0, "skipped": 1}
    assert (images_dir / fname).exists()  # 원본 잔존
    assert (images_dir / fname).read_bytes() == b"fake-image-bytes"
    assert (trash_dir / fname).read_bytes() == b"existing-trash-bytes"  # 휴지통 사본 바이트 무변


def test_move_referenced_file_rejected_all_or_nothing(client, db, dirs):
    images_dir, _ = dirs
    referenced = _fname("still-ref")
    orphan = _fname("clean-orphan")
    _write_image(images_dir, referenced, age_days=30)
    _write_image(images_dir, orphan, age_days=30)
    _mk_document(db, "DOC-REF", content=f"/images/{referenced}")

    resp = client.post(
        "/api/trash/images/move", json={"filenames": [referenced, orphan]}
    )
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["detail"]["reason"] == "still_referenced"
    assert referenced in body["error"]["detail"]["filenames"]

    # all-or-nothing — orphan도 이동되지 않았다
    assert (images_dir / referenced).exists()
    assert (images_dir / orphan).exists()
    assert not (images_dir / ".trash" / orphan).exists()


@pytest.mark.parametrize("bad_name", ["../x.png", ".trash/x.png", "abc.png", "no-ext"])
def test_move_invalid_filename_rejected_no_side_effects(client, dirs, bad_name):
    images_dir, _ = dirs
    resp = client.post("/api/trash/images/move", json={"filenames": [bad_name]})
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["detail"]["reason"] == "invalid_filename"
    assert list(images_dir.glob("**/*")) == [] or all(
        p.name != bad_name for p in images_dir.glob("**/*")
    )


def test_move_empty_or_over_500_filenames_422(client, dirs):
    resp = client.post("/api/trash/images/move", json={"filenames": []})
    assert resp.status_code == 422

    many = [_fname(f"seed-{i}") for i in range(501)]
    resp2 = client.post("/api/trash/images/move", json={"filenames": many})
    assert resp2.status_code == 422


# ---------------------------------------------------------------------------
# ⑤ 되돌리기
# ---------------------------------------------------------------------------
def test_restore_from_trash_moves_back(client, dirs):
    images_dir, _ = dirs
    trash_dir = images_dir / ".trash"
    trash_dir.mkdir()
    fname = _fname("restore-me")
    (trash_dir / fname).write_bytes(b"data")

    resp = client.post("/api/trash/images/restore", json={"filenames": [fname]})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"restored": 1, "skipped": 0}
    assert (images_dir / fname).exists()
    assert not (trash_dir / fname).exists()


def test_restore_when_target_exists_is_skipped_and_trash_copy_kept(client, dirs):
    images_dir, _ = dirs
    trash_dir = images_dir / ".trash"
    trash_dir.mkdir()
    fname = _fname("dup-restore")
    (trash_dir / fname).write_bytes(b"trash-bytes")
    (images_dir / fname).write_bytes(b"reuploaded-bytes")

    resp = client.post("/api/trash/images/restore", json={"filenames": [fname]})
    assert resp.status_code == 200
    assert resp.json() == {"restored": 0, "skipped": 1}
    assert (trash_dir / fname).exists()  # 삭제 0
    assert (images_dir / fname).read_bytes() == b"reuploaded-bytes"  # 덮어쓰기 0


def test_restore_missing_in_trash_is_skipped(client, dirs):
    fname = _fname("never-trashed")
    resp = client.post("/api/trash/images/restore", json={"filenames": [fname]})
    assert resp.status_code == 200
    assert resp.json() == {"restored": 0, "skipped": 1}


# ---------------------------------------------------------------------------
# ⑥ 서빙
# ---------------------------------------------------------------------------
def test_serving_404_after_trash_and_200_after_restore(client, dirs):
    images_dir, _ = dirs
    fname = _fname("serve-me")
    _write_image(images_dir, fname, age_days=30)

    resp_before = client.get(f"/images/{fname}")
    assert resp_before.status_code == 200

    move_resp = client.post("/api/trash/images/move", json={"filenames": [fname]})
    assert move_resp.status_code == 200
    assert move_resp.json()["moved"] == 1

    resp_trashed = client.get(f"/images/{fname}")
    assert resp_trashed.status_code == 404

    restore_resp = client.post("/api/trash/images/restore", json={"filenames": [fname]})
    assert restore_resp.status_code == 200
    assert restore_resp.json()["restored"] == 1

    resp_after = client.get(f"/images/{fname}")
    assert resp_after.status_code == 200


# ---------------------------------------------------------------------------
# ⑦ 반입 원본(sources/ 밖 파일)은 스캔·이동 대상이 아니다
# ---------------------------------------------------------------------------
def test_original_sources_outside_images_not_scanned_or_touched(client, db, dirs, tmp_path):
    images_dir, _ = dirs
    sources_root = images_dir.parent  # tmp_path / sources
    original = sources_root / "past-exam.pdf"
    original.write_bytes(b"original pdf bytes - immutable")
    before_mtime = original.stat().st_mtime

    resp = client.get("/api/trash/images", params={"min_age_days": 0})
    assert resp.status_code == 200
    body = resp.json()
    assert all(e["filename"] != "past-exam.pdf" for e in body["orphans"])
    assert body["other_files"] == 0  # images/ 직속만 스캔 — 상위 sources/는 대상 밖

    assert original.exists()
    assert original.stat().st_mtime == before_mtime
    assert original.read_bytes() == b"original pdf bytes - immutable"
