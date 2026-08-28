"""B2-2 — 분할 반입 조각 미리보기 병합(`import_service.merge_previews`, 설계 §4.3·§4.25
추기) 단위 테스트.

고정하는 계약:
  ① 2개 이상 preview의 유효 항목(status != error)이 순서대로 이어붙여져 재인덱싱된다.
  ② error 항목은 병합 결과에서 빠진다(원 조각 preview에서 이미 표면화된 오류라 재이어
     붙일 정규화 doc이 없다).
  ③ 항목별 warnings가 승계된다(원 조각의 판정을 재판정 없이 그대로 옮긴다).
  ④ 존재하지 않는/만료된 preview_id는 404(detail에 어떤 id인지 남는다).
  ⑤ preview_ids가 2개 미만이면 422(ValidationAppError).
  ⑥ 병합 결과도 보존(preserve)되어 커밋 가능한 정상 preview다(원 조각은 삭제되지 않음).
"""
from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from exceptions import NotFoundError, ValidationAppError
from schemas.import_schema import CommitRequest, ImportDecision
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


def _payload(docs: list[dict]) -> bytes:
    return json.dumps(
        {"format_version": 1, "source": {"filename": "조각.txt"}, "documents": docs},
        ensure_ascii=False,
    ).encode("utf-8")


def _doc(title: str, *, suggest_categories=None) -> dict:
    return {
        "type": "past_question",
        "title": title,
        "content": f"{title} 본문",
        "answer": "1",
        "suggest_categories": suggest_categories if suggest_categories is not None else [],
    }


def test_merges_two_previews_in_order_with_reindex(db):
    p1 = import_service.create_preview(
        db,
        json_bytes=_payload([_doc("1번 문항"), _doc("2번 문항")]),
        source_filename="원본.txt",
        source_bytes=None,
        preserve=True,
    )
    p2 = import_service.create_preview(
        db,
        json_bytes=_payload([_doc("3번 문항")]),
        source_filename="원본.txt",
        source_bytes=None,
        preserve=True,
    )

    merged = import_service.merge_previews(db, [p1.preview_id, p2.preview_id])

    assert [item.index for item in merged.items] == [0, 1, 2]
    assert [item.title for item in merged.items] == ["1번 문항", "2번 문항", "3번 문항"]
    assert merged.summary.total == 3
    assert "분할 병합 2조각" in (merged.source.filename or "")
    # 원 조각 preview는 삭제되지 않는다(TTL 자연 만료) — 여전히 조회 가능.
    assert import_service.get_preview(db, p1.preview_id).preview_id == p1.preview_id
    assert import_service.get_preview(db, p2.preview_id).preview_id == p2.preview_id


def test_error_items_are_excluded_from_merge(db):
    p1 = import_service.create_preview(
        db,
        json_bytes=_payload([_doc("정상 문항"), {"type": "past_question"}]),  # 두 번째는 title 누락 = error
        source_filename="원본.txt",
        source_bytes=None,
        preserve=True,
    )
    assert p1.items[1].status == "error"
    p2 = import_service.create_preview(
        db,
        json_bytes=_payload([_doc("다른 조각 문항")]),
        source_filename="원본.txt",
        source_bytes=None,
        preserve=True,
    )

    merged = import_service.merge_previews(db, [p1.preview_id, p2.preview_id])

    assert merged.summary.total == 2  # error 항목은 빠진다
    assert [item.title for item in merged.items] == ["정상 문항", "다른 조각 문항"]


def test_warnings_are_inherited_from_source_pieces(db):
    p1 = import_service.create_preview(
        db,
        json_bytes=_payload([_doc("문항 A", suggest_categories=[])]),  # no_category
        source_filename="원본.txt",
        source_bytes=None,
        preserve=True,
    )
    assert "no_category" in p1.items[0].warnings
    p2 = import_service.create_preview(
        db,
        json_bytes=_payload([_doc("문항 B", suggest_categories=["품질경영기사/필기"])]),
        source_filename="원본.txt",
        source_bytes=None,
        preserve=True,
    )
    assert p2.items[0].warnings == []

    merged = import_service.merge_previews(db, [p1.preview_id, p2.preview_id])

    assert "no_category" in merged.items[0].warnings
    assert merged.items[1].warnings == []


def test_missing_preview_id_raises_404_with_detail(db):
    p1 = import_service.create_preview(
        db, json_bytes=_payload([_doc("문항")]), source_filename=None, source_bytes=None, preserve=True
    )
    with pytest.raises(NotFoundError) as excinfo:
        import_service.merge_previews(db, [p1.preview_id, "imp_does_not_exist"])
    assert excinfo.value.detail == {"preview_id": "imp_does_not_exist"}


def test_fewer_than_two_ids_is_rejected(db):
    p1 = import_service.create_preview(
        db, json_bytes=_payload([_doc("문항")]), source_filename=None, source_bytes=None, preserve=True
    )
    with pytest.raises(ValidationAppError):
        import_service.merge_previews(db, [p1.preview_id])
    with pytest.raises(ValidationAppError):
        import_service.merge_previews(db, [])


def test_merged_preview_is_committable(db):
    p1 = import_service.create_preview(
        db,
        json_bytes=_payload([_doc("1번 문항")]),
        source_filename=None,
        source_bytes=None,
        preserve=True,
    )
    p2 = import_service.create_preview(
        db,
        json_bytes=_payload([_doc("2번 문항")]),
        source_filename=None,
        source_bytes=None,
        preserve=True,
    )
    merged = import_service.merge_previews(db, [p1.preview_id, p2.preview_id])

    result = import_service.commit_import(
        db,
        CommitRequest(
            preview_id=merged.preview_id,
            decisions=[ImportDecision(index=i, action="new") for i in range(2)],
        ),
    )
    assert result.created == 2
    titles = sorted(d.title for d in db.query(models.Document).all())
    assert titles == ["1번 문항", "2번 문항"]
