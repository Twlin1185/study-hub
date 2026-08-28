"""B4(S4·S5·S6·S7·S1) — LLM 분류 제안 관대 정규화·중복 형제 방지·형식 오류 강등
단위 테스트(설계 §4.11 추기, stage-42 결함 진단 B4).

고정하는 계약:
  ① `>`·`＞`·`»`·`≫`·`\\`·`::` 구분자 이형이 `/` 계층 경로로 정규화된다(S4).
  ② `suggest_categories`가 list가 아니거나 원소 형식이 틀려도 항목이 error가 되지
     않는다 — 회수 가능한 문자열만 채택 + `category_malformed` 경고(S7·S1).
  ③ 제안이 0개(빈 배열이거나 전부 회수 실패)면 `no_category` 경고(결정 ④).
  ④ 공백·대소문자·NFC 결합형만 다른 기존 분류에 중복 형제 노드가 생기지 않는다(S5).
  ⑤ 5단·60자를 넘는 LLM 제안 경로는 조용히 버려진다(S6, 항목 error 아님).
"""
from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
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


def _payload(suggest_categories, *, title: str = "1번 문항") -> bytes:
    docs = [
        {
            "type": "past_question",
            "title": title,
            "content": "본문",
            "answer": "1",
            "suggest_categories": suggest_categories,
        }
    ]
    return json.dumps(
        {"format_version": 1, "source": {"filename": "기출.pdf"}, "documents": docs},
        ensure_ascii=False,
    ).encode("utf-8")


# --- ① 구분자 이형 → `/` 계층 정규화(S4) ----------------------------------------
@pytest.mark.parametrize(
    "raw_path",
    [
        "품질경영기사 > 필기",
        "품질경영기사＞필기",
        "품질경영기사 » 필기",
        "품질경영기사 ≫ 필기",
        "품질경영기사\\필기",
        "품질경영기사::필기",
    ],
)
def test_alternate_separators_normalize_to_hierarchy(db, raw_path):
    resp = import_service.create_preview(
        db, json_bytes=_payload([raw_path]), source_filename=None, source_bytes=None
    )
    item = resp.items[0]
    assert item.status == "ok"
    assert item.warnings == []
    assert len(item.suggest_categories) == 1
    assert item.suggest_categories[0].path == "품질경영기사/필기"


# --- ② 형식 오류 회수 + category_malformed(S7·S1) -------------------------------
def test_malformed_entries_are_recovered_not_rejected(db):
    """리스트가 아닌 원소(int)·형식이 다른 dict는 버리고, 문자열·`path` 키 dict는
    회수한다. 항목 전체는 error가 아니라 ok(+warning)로 남는다."""
    resp = import_service.create_preview(
        db,
        json_bytes=_payload(
            ["품질경영기사/필기", 123, {"path": "정보처리기사/실기"}, {"bad": 1}]
        ),
        source_filename=None,
        source_bytes=None,
    )
    item = resp.items[0]
    assert item.status == "ok"
    assert item.errors == []
    assert "category_malformed" in item.warnings
    paths = sorted(sc.path for sc in item.suggest_categories)
    assert paths == ["정보처리기사/실기", "품질경영기사/필기"]


def test_non_list_suggest_categories_is_malformed_and_empty(db):
    """`suggest_categories`가 아예 배열이 아니면(문자열 등) 전부 회수 실패 —
    malformed + no_category 둘 다, 그러나 항목은 error가 아니다."""
    resp = import_service.create_preview(
        db, json_bytes=_payload("품질경영기사"), source_filename=None, source_bytes=None
    )
    item = resp.items[0]
    assert item.status == "ok"
    assert item.errors == []
    assert set(item.warnings) == {"category_malformed", "no_category"}
    assert item.suggest_categories == []


# --- ③ 제안 0개 = no_category(결정 ④) -------------------------------------------
def test_empty_suggest_categories_gets_no_category_warning(db):
    resp = import_service.create_preview(
        db, json_bytes=_payload([]), source_filename=None, source_bytes=None
    )
    item = resp.items[0]
    assert item.status == "ok"
    assert item.warnings == ["no_category"]


# --- ④ 공백·대소문자·NFC만 다른 기존 분류 = 중복 형제 금지(S5) -------------------
def test_case_and_whitespace_variants_reuse_existing_sibling(db):
    db.add(models.Category(parent_id=None, name="OS", sort_order=1))
    db.commit()

    resp = import_service.create_preview(
        db, json_bytes=_payload([]), source_filename=None, source_bytes=None
    )
    result = import_service.commit_import(
        db,
        CommitRequest(
            preview_id=resp.preview_id,
            decisions=[
                ImportDecision(index=0, action="new", approve_categories=[" os "])
            ],
        ),
    )
    assert result.categories_created == []  # 새로 생성되지 않음 — 기존 노드 재사용
    roots = db.query(models.Category).filter(models.Category.parent_id.is_(None)).all()
    assert len(roots) == 1  # 여전히 "OS" 하나뿐(중복 형제 없음)
    links = db.query(models.CategoryDocument).all()
    assert len(links) == 1
    assert links[0].category_id == roots[0].id


def test_nfc_composed_and_decomposed_forms_are_treated_as_same_name(db):
    """분해형(NFD) 조합 문자로 저장된 기존 분류에 완성형(NFC) 승인 경로가 매칭돼야
    한다(반대로도 성립) — 유니코드 결합형 차이로 형제가 생기면 안 된다."""
    import unicodedata

    decomposed_name = unicodedata.normalize("NFD", "가나다")
    db.add(models.Category(parent_id=None, name=decomposed_name, sort_order=1))
    db.commit()

    resp = import_service.create_preview(
        db, json_bytes=_payload([]), source_filename=None, source_bytes=None
    )
    result = import_service.commit_import(
        db,
        CommitRequest(
            preview_id=resp.preview_id,
            decisions=[
                ImportDecision(index=0, action="new", approve_categories=["가나다"])
            ],
        ),
    )
    assert result.categories_created == []
    roots = db.query(models.Category).filter(models.Category.parent_id.is_(None)).all()
    assert len(roots) == 1


# --- ⑤ 5단·60자 초과 LLM 제안은 조용히 버려진다(S6) ------------------------------
def test_over_depth_suggestion_is_dropped_not_error(db):
    over_depth = "/".join(f"단계{i}" for i in range(6))  # 6단(상한 5단 초과)
    resp = import_service.create_preview(
        db, json_bytes=_payload([over_depth]), source_filename=None, source_bytes=None
    )
    item = resp.items[0]
    assert item.status == "ok"
    assert item.errors == []
    assert "category_malformed" in item.warnings
    assert "no_category" in item.warnings
    assert item.suggest_categories == []


def test_over_length_segment_suggestion_is_dropped_not_error(db):
    too_long_segment = "가" * 61  # 세그먼트당 상한(60자) 초과
    resp = import_service.create_preview(
        db, json_bytes=_payload([too_long_segment]), source_filename=None, source_bytes=None
    )
    item = resp.items[0]
    assert item.status == "ok"
    assert item.errors == []
    assert "category_malformed" in item.warnings
