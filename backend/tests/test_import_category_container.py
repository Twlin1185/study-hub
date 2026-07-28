"""반입 미리보기 분류 제안의 컨테이너 노드 경고 신호 단위 테스트.

핫픽스 배경: `suggest_categories` 경로가 "자식이 있는 기존 노드(컨테이너)"로 끝나는
제안을 무경고로 수용해, 회차·과목 없이 컨테이너에 문서가 직접 붙는 사고가 있었다.
이 테스트는 `SuggestCategoryResult.container` 신호가 올바른 경우에만 True로
채워지는지(차단·자동 변경 없이 신호만 내려가는지)를 고정한다.
"""
from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
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


def _seed_tree(db) -> None:
    """품질경영기사 / 필기 / 2022년 2회 3단 트리를 만들어
    '품질경영기사/필기'는 컨테이너(자식 있음), '.../필기/2022년 2회'는 리프가 되게 한다."""
    root = models.Category(parent_id=None, name="품질경영기사", sort_order=1)
    db.add(root)
    db.flush()
    child = models.Category(parent_id=root.id, name="필기", sort_order=1)
    db.add(child)
    db.flush()
    leaf = models.Category(parent_id=child.id, name="2022년 2회", sort_order=1)
    db.add(leaf)
    db.commit()


def _payload(path: str) -> bytes:
    docs = [
        {
            "type": "past_question",
            "title": "1번 문항",
            "content": "본문",
            "answer": "1",
            "suggest_categories": [path],
        }
    ]
    return json.dumps(
        {"format_version": 1, "source": {"filename": "기출.pdf"}, "documents": docs},
        ensure_ascii=False,
    ).encode("utf-8")


def test_container_path_is_flagged(db):
    """경로가 자식이 있는 기존 노드(컨테이너)로 끝나면 container=True."""
    _seed_tree(db)
    resp = import_service.create_preview(
        db,
        json_bytes=_payload("품질경영기사/필기"),
        source_filename=None,
        source_bytes=None,
    )
    sc = resp.items[0].suggest_categories[0]
    assert sc.exists is True
    assert sc.container is True


def test_leaf_path_is_not_flagged(db):
    """경로가 자식 없는 기존 리프 노드면 container가 표시되지 않는다."""
    _seed_tree(db)
    resp = import_service.create_preview(
        db,
        json_bytes=_payload("품질경영기사/필기/2022년 2회"),
        source_filename=None,
        source_bytes=None,
    )
    sc = resp.items[0].suggest_categories[0]
    assert sc.exists is True
    assert sc.container is None


def test_new_path_is_not_flagged(db):
    """경로가 기존 노드에 전부 매칭되지 않는(신규 생성) 제안이면 container가 표시되지 않는다."""
    _seed_tree(db)
    resp = import_service.create_preview(
        db,
        json_bytes=_payload("정보처리기사/실기"),
        source_filename=None,
        source_bytes=None,
    )
    sc = resp.items[0].suggest_categories[0]
    assert sc.exists is False
    assert sc.container is None
