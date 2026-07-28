"""변환 결과 보존·복구 (S13 F40-①, 설계 §4.3) 단위 테스트.

계약 고정 항목:
  ① 캐시를 비운 뒤 preview 조회가 디스크에서 복구되고 items 수·순서가 동일
  ② 원본 연결이 복구돼 commit 후 documents.source_id가 채워짐
  ③ 보존 50건 초과 시 오래된 파일부터 삭제
  ④ 존재하지 않는 id는 404 (보존 파일이 없을 때만)

파일 입출력은 `import/auto/`·`sources/` 실경로를 tmp_path로 갈아끼워(monkeypatch) 실제
사용자 데이터를 건드리지 않는다 — `sources/` 원본 불변 규칙(4) 준수.
"""
from __future__ import annotations

import json
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from exceptions import ConflictError, NotFoundError
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
    """보존 폴더·sources 폴더를 테스트 전용 임시 경로로 격리."""
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


def _payload(n: int = 3) -> bytes:
    docs = [
        {
            "type": "past_question",
            "title": f"{i}번 문항 — 정규화",
            "content": f"본문 {i}",
            "answer": "1",
            "suggest_categories": ["품질경영기사/필기/2022년 2회"],
        }
        for i in range(1, n + 1)
    ]
    return json.dumps(
        {"format_version": 1, "source": {"filename": "기출.pdf"}, "documents": docs},
        ensure_ascii=False,
    ).encode("utf-8")


# --- ① 캐시 소거 후 디스크 복구 -------------------------------------------------
def test_recovers_from_disk_with_same_items(db):
    first = import_service.create_preview(
        db,
        json_bytes=_payload(3),
        source_filename="기출.pdf",
        source_bytes=b"%PDF-1.4 fake",
        preserve=True,
        # S15: 실제 보존 경로(convert·fetch 잡)는 신뢰 게이트가 켜진 상태다 —
        # 복구 경로도 게이트를 유지하므로 summary(=warning 포함)가 그대로 일치해야 한다
        # (설계 §4.17 ⑤ + F40-① 정합. 여기 원본은 가짜 PDF라 양쪽 다 "대조 불가").
        gate=True,
    )
    assert first.recovered is False

    # 서버 재시작·TTL 만료 상황 = 메모리 캐시만 비어 있는 상태
    import_service._PREVIEW_CACHE.clear()

    again = import_service.get_preview(db, first.preview_id)
    assert again.preview_id == first.preview_id
    assert again.recovered is True
    assert len(again.items) == len(first.items) == 3
    assert [i.index for i in again.items] == [i.index for i in first.items]
    assert [i.title for i in again.items] == [i.title for i in first.items]
    assert again.summary.model_dump() == first.summary.model_dump()


def test_preserved_file_name_is_the_recovery_contract(db):
    preview = import_service.create_preview(
        db,
        json_bytes=_payload(1),
        source_filename="2022년 2회.pdf",
        source_bytes=b"%PDF-1.4 fake",
        preserve=True,
    )
    path = preview_store.find(preview.preview_id)
    assert path is not None
    hash12, original = preview_store.parse_name(path)
    assert hash12 is not None and len(hash12) == 12
    assert original == "2022년 2회.pdf"
    # 파일명 해시 접두어 = sources/ 저장 파일명 접두어와 같은 규칙
    assert list(preview_store.SOURCES_DIR.glob(f"{hash12}_*"))
    # UTF-8 · ensure_ascii=False 보존 (한글이 이스케이프되지 않는다)
    assert "정규화" in path.read_text(encoding="utf-8")


# --- ② 원본 연결 복구 → commit 후 source_id ------------------------------------
def test_recovered_preview_commit_links_source(db):
    preview = import_service.create_preview(
        db,
        json_bytes=_payload(2),
        source_filename="기출.pdf",
        source_bytes=b"%PDF-1.4 fake bytes",
        preserve=True,
    )
    import_service._PREVIEW_CACHE.clear()

    result = import_service.commit_import(
        db,
        CommitRequest(
            preview_id=preview.preview_id,
            decisions=[ImportDecision(index=i, action="new") for i in range(2)],
        ),
    )
    assert result.created == 2
    assert result.recovered is True  # 복구 후 커밋임을 프론트가 알 수 있어야 한다

    docs = db.query(models.Document).all()
    assert len(docs) == 2
    assert all(d.source_id is not None for d in docs)
    source = db.query(models.Source).one()
    assert all(d.source_id == source.id for d in docs)


def test_second_commit_is_blocked_even_though_file_is_preserved(db):
    """보존 파일은 커밋 후에도 남지만(내려받기 탈출구), 같은 preview 재커밋은 막는다."""
    preview = import_service.create_preview(
        db, json_bytes=_payload(1), source_filename=None, source_bytes=None, preserve=True
    )
    req = CommitRequest(
        preview_id=preview.preview_id, decisions=[ImportDecision(index=0, action="new")]
    )
    assert import_service.commit_import(db, req).created == 1
    with pytest.raises(ConflictError):
        import_service.commit_import(db, req)
    assert preview_store.find(preview.preview_id) is not None  # 파일은 그대로 남는다


def test_second_commit_is_blocked_even_after_preview_lookup(db):
    """S13 검토 결함: 커밋 뒤 `GET /api/import/preview/{id}` 한 번이면 재커밋 차단이
    무력화됐다(조회가 보존본으로 캐시를 되살려 commit의 `_COMMITTED` 가드 분기를
    건너뛰게 만듦). 설계 §4.3 "커밋 완료 preview_id는 **복구 대상에서 제외**"."""
    preview = import_service.create_preview(
        db, json_bytes=_payload(2), source_filename=None, source_bytes=None, preserve=True
    )
    req = CommitRequest(
        preview_id=preview.preview_id,
        decisions=[ImportDecision(index=i, action="new") for i in range(2)],
    )
    assert import_service.commit_import(db, req).created == 2

    # ① 조회도 복구하지 않고 409를 낸다 (다른 탭이 여전히 ready 상태로 남은 상황)
    with pytest.raises(ConflictError):
        import_service.get_preview(db, preview.preview_id)

    # ② 그 뒤 재커밋도 여전히 409 — 문서가 두 배로 늘지 않는다
    with pytest.raises(ConflictError):
        import_service.commit_import(db, req)
    assert db.query(models.Document).count() == 2


def test_committed_preview_json_download_still_works(db):
    """차단은 복구·재커밋에만 적용된다 — 내려받기 탈출구는 커밋 후에도 살아 있다
    (설계 §4.3 "보존 파일 자체는 지우지 않아 내려받기 탈출구는 유지")."""
    preview = import_service.create_preview(
        db, json_bytes=_payload(1), source_filename=None, source_bytes=None, preserve=True
    )
    import_service.commit_import(
        db,
        CommitRequest(
            preview_id=preview.preview_id,
            decisions=[ImportDecision(index=0, action="new")],
        ),
    )
    path = import_service.preserved_json_path(preview.preview_id)
    assert path.exists()
    assert json.loads(path.read_text(encoding="utf-8"))["format_version"] == 1


def test_committed_marker_is_bounded(db):
    """`_COMMITTED`는 프로세스 전역이므로 상한을 둔다(오래된 항목부터 밀려남)."""
    for i in range(import_service._COMMITTED_MAX + 10):
        import_service._mark_committed(f"imp_{i:05d}")
    assert len(import_service._COMMITTED) == import_service._COMMITTED_MAX
    assert "imp_00000" not in import_service._COMMITTED  # 가장 오래된 것부터 밀려난다
    assert f"imp_{import_service._COMMITTED_MAX + 9:05d}" in import_service._COMMITTED


def test_recovered_preview_recomputes_duplicates_against_current_db(db):
    """복구 시 duplicate_of는 **현재 DB 기준**으로 재계산된다(설계 §4.3 재계산 원칙)."""
    preview = import_service.create_preview(
        db, json_bytes=_payload(1), source_filename=None, source_bytes=None, preserve=True
    )
    assert preview.items[0].status == "ok"

    # 그 사이 같은 내용의 문서가 DB에 생겼다
    db.add(
        models.Document(
            doc_no="DOC-9001",
            type="past_question",
            title="1번 문항 — 정규화",
            content="본문 1",
            answer="1",
        )
    )
    db.commit()
    import_service._PREVIEW_CACHE.clear()

    again = import_service.get_preview(db, preview.preview_id)
    assert again.items[0].index == 0  # index는 안정
    assert again.items[0].status == "duplicate_suspect"  # 판정은 현재 DB 기준


# --- ③ 보존 50건 상한 -----------------------------------------------------------
def test_prune_keeps_only_latest_50(db):
    for i in range(55):
        path = preview_store.AUTO_DIR / f"imp_{i:04d}__nosrc__x.json"
        path.write_text("{}", encoding="utf-8")
        os.utime(path, (1_600_000_000 + i, 1_600_000_000 + i))  # 오래된 것이 앞

    preview_store.prune()

    names = sorted(p.name for p in preview_store.list_files())
    assert len(names) == preview_store.KEEP_MAX == 50
    assert "imp_0000__nosrc__x.json" not in names  # 가장 오래된 것부터 삭제
    assert "imp_0004__nosrc__x.json" not in names
    assert "imp_0005__nosrc__x.json" in names
    assert "imp_0054__nosrc__x.json" in names


def test_save_triggers_prune(db):
    for i in range(50):
        path = preview_store.AUTO_DIR / f"imp_old{i:04d}__nosrc__x.json"
        path.write_text("{}", encoding="utf-8")
        os.utime(path, (1_600_000_000 + i, 1_600_000_000 + i))

    import_service.create_preview(
        db, json_bytes=_payload(1), source_filename=None, source_bytes=None, preserve=True
    )
    assert len(preview_store.list_files()) == preview_store.KEEP_MAX
    assert not (preview_store.AUTO_DIR / "imp_old0000__nosrc__x.json").exists()


# --- ④ 없는 id는 404 / commit은 409 --------------------------------------------
def test_safe_component_collapses_repeated_separators(db):
    """파일명 성분에 구분자(`__`)가 남지 않는다 — 1패스 replace는 "a____b" → "a__b"였다.
    위험 문자 치환이 만든 밑줄까지 접히는지도 함께 고정."""
    assert preview_store._safe_component("a____b.pdf") == "a_b.pdf"
    assert preview_store._safe_component("a<>b.pdf") == "a_b.pdf"
    assert "__" not in preview_store._safe_component("기출__2022__2회.pdf")

    path = preview_store.save("imp_sep01", b"{}", source_filename="기출__2022회.pdf")
    assert path is not None
    hash12, original = preview_store.parse_name(path)
    assert hash12 is None  # nosrc
    assert original == "기출_2022회.pdf"


def test_missing_preview_is_404(db):
    with pytest.raises(NotFoundError):
        import_service.get_preview(db, "imp_nothing")


def test_missing_preserved_json_download_is_404():
    with pytest.raises(NotFoundError):
        import_service.preserved_json_path("imp_nothing")


def test_commit_without_recovery_still_conflicts(db):
    with pytest.raises(ConflictError):
        import_service.commit_import(
            db, CommitRequest(preview_id="imp_nothing", decisions=[])
        )


def test_path_traversal_preview_id_is_rejected(db):
    assert preview_store.find("../../secrets") is None
    with pytest.raises(NotFoundError):
        import_service.get_preview(db, "../../secrets")


def test_manual_preview_is_not_preserved(db):
    """사용자가 직접 올린 반입 JSON(POST /api/import/preview)은 보존 대상이 아니다 —
    보존은 LLM 비용을 치른 convert·fetch 산출물만(설계 §4.3)."""
    import_service.create_preview(
        db, json_bytes=_payload(1), source_filename=None, source_bytes=None
    )
    assert preview_store.list_files() == []
