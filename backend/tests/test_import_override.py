"""stage-42(B3) — 검토 단계 편집분(`ImportDecision.override`) commit 적용 (설계 §4.3 S42 추기).

- override는 정규화 문서에 얕은 덮어쓰기 후 new 경로로 저장된다(원 캐시 doc 불변).
- title·content 빈 문자열 = 422. merge 액션은 본문 불변(override 미반영).
"""
from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from exceptions import ValidationAppError
from schemas.import_schema import CommitRequest, ImportDecision, ItemOverride
from services import import_service, preview_store


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


@pytest.fixture(autouse=True)
def isolated_dirs(tmp_path, monkeypatch):
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


def _preview(db, docs):
    payload = json.dumps(
        {"format_version": 1, "source": {"filename": "원본.txt"}, "documents": docs},
        ensure_ascii=False,
    ).encode("utf-8")
    return import_service.create_preview(db, json_bytes=payload, source_filename=None, source_bytes=None)


def _q(title="1번 문항"):
    return {
        "type": "past_question",
        "title": title,
        "content": "원래 본문",
        "answer": "1",
        "explanation": "원래 해설",
        "suggest_categories": ["정보처리기사/필기"],
    }


def test_preview_item_carries_body_fields(db):
    p = _preview(db, [_q()])
    item = p.items[0]
    assert item.content == "원래 본문"
    assert item.answer == "1"
    assert item.explanation == "원래 해설"


def test_override_applied_on_new_and_cache_untouched(db):
    p = _preview(db, [_q()])
    result = import_service.commit_import(
        db,
        CommitRequest(
            preview_id=p.preview_id,
            decisions=[
                ImportDecision(
                    index=0,
                    action="new",
                    override=ItemOverride(title="고친 제목", content="고친 본문", answer="3", explanation="고친 해설"),
                )
            ],
        ),
    )
    assert result.created == 1
    doc = db.query(models.Document).one()
    assert (doc.title, doc.content, doc.answer, doc.explanation) == ("고친 제목", "고친 본문", "3", "고친 해설")


def test_partial_override_keeps_other_fields(db):
    p = _preview(db, [_q()])
    import_service.commit_import(
        db,
        CommitRequest(
            preview_id=p.preview_id,
            decisions=[ImportDecision(index=0, action="new", override=ItemOverride(content="본문만 수정"))],
        ),
    )
    doc = db.query(models.Document).one()
    assert doc.title == "1번 문항"
    assert doc.content == "본문만 수정"
    assert doc.answer == "1"


@pytest.mark.parametrize("override", [ItemOverride(title="   "), ItemOverride(content="")])
def test_empty_title_or_content_override_is_422(db, override):
    p = _preview(db, [_q()])
    with pytest.raises(ValidationAppError):
        import_service.commit_import(
            db,
            CommitRequest(preview_id=p.preview_id, decisions=[ImportDecision(index=0, action="new", override=override)]),
        )
    assert db.query(models.Document).count() == 0
