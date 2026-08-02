"""응용 모의고사 생성·검증 게이트·격리·제출 단위 테스트 (S19 — F45, 설계 §4.21).

실제 LLM 호출은 하지 않는다 — 검증 게이트(`validate_items`)는 순수 함수로 직접
호출하고, 저장(`_save_generated`)·제출(`submit_applied_exam`)은 in-memory sqlite
세션에 직접 호출한다(`test_answer_key_explain.py` 전례).
"""
from __future__ import annotations

import datetime as dt
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from exceptions import ValidationAppError
from schemas.exam import ExamAnswerItem, ExamSubmitRequest
from services import applied_exam_service, exam_service, quiz_service
from services.source_match import SourceMatcher


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


def _valid_item(**overrides) -> dict:
    base = {
        "content": "완전히 새로운 응용 문항 지문입니다 — 기출과 무관한 상황 설정",
        "choices": ["보기1", "보기2", "보기3", "보기4"],
        "answer": "1",
        "explanation": "해설 내용입니다",
        "basis": ["DOC-0001"],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# ① 검증 게이트 — content/choices/explanation 필수, answer 1-base, basis 결정론,
#    복제 검출(SourceMatcher 역적용)
# ---------------------------------------------------------------------------
def test_validate_items_missing_content_discarded_as_invalid_item():
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(content=None)]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert passed == []
    assert discarded == {"invalid_item": 1}


def test_validate_items_wrong_choice_count_discarded_as_invalid_item():
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(choices=["보기1", "보기2", "보기3"])]  # 3개 — 4지선다 위반
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert passed == []
    assert discarded == {"invalid_item": 1}


def test_validate_items_missing_explanation_discarded_separately():
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(explanation=None)]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert passed == []
    assert discarded == {"missing_explanation": 1}


def test_validate_items_answer_out_of_range_discards_whole_item():
    """설계 §4.21 생성 규약 3-ⓑ — F44 "answer만 제거" 해석은 여기 부적용, 문항 전체 폐기."""
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(answer="5")]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert passed == []
    assert discarded == {"invalid_answer": 1}


def test_validate_items_non_numeric_answer_discarded():
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(answer="정답은 1번")]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert discarded == {"invalid_answer": 1}


def test_validate_items_basis_out_of_prepare_scope_discarded():
    """서버 결정론 검증 — LLM이 basis로 지목해도 prepare 수집 집합에 없으면 폐기
    (F44 결정 ② 관례, LLM 매칭 판단 불신)."""
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(basis=["DOC-9999"])]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert passed == []
    assert discarded == {"bad_basis": 1}


def test_validate_items_empty_basis_discarded():
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(basis=[])]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert discarded == {"bad_basis": 1}


def test_validate_items_duplicate_of_source_discarded():
    """복제 검출 — SourceMatcher 역적용(§4.17 ⑥): 원본에 있으면 실패."""
    source_text = "가나다라마바사아자차카타파하" * 20  # 200자 이상 — 대조 가능
    matcher = SourceMatcher(source_text)
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(content=source_text)]  # 원본 그대로 복제
    passed, discarded = applied_exam_service.validate_items(items, basis, matcher)
    assert passed == []
    assert discarded == {"duplicate_of_source": 1}


def test_validate_items_not_duplicate_when_source_unavailable():
    """근거 corpus가 너무 짧아 대조 불가(available=False)면 복제 판정을 생략한다
    (전량 오탐 폐기 방지)."""
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item()]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert len(passed) == 1
    assert discarded == {}


def test_validate_items_passes_valid_item_unchanged_fields():
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item()]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert discarded == {}
    assert len(passed) == 1
    assert passed[0]["answer"] == "1"
    assert passed[0]["basis"] == ["DOC-0001"]


def test_validate_items_mixed_batch_partial_pass():
    """통과분·폐기분이 섞인 배치 — 부분 성공(설계 §4.21 결정 ⑤)의 게이트 단계 검증."""
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [
        _valid_item(),  # 통과
        _valid_item(answer="9"),  # invalid_answer
        _valid_item(explanation=""),  # missing_explanation
    ]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert len(passed) == 1
    assert discarded == {"invalid_answer": 1, "missing_explanation": 1}


# ---------------------------------------------------------------------------
# ① 통과 0건 = 잡 실패(DB 무변경) — finalize_generation
# ---------------------------------------------------------------------------
def test_finalize_generation_zero_passed_raises_before_any_db_session():
    """0건 통과 시 `SessionLocal()`(실 DB)이 아예 호출되지 않는다 — 검증 실패 시
    DB 세션을 열지도 않으므로 무변경이 구조적으로 보장된다."""
    job = {
        "_basis_docs": [{"id": 1, "doc_no": "DOC-0001", "type": "question", "title": "t", "content": "본문"}],
        "_engine": "claude-cli",
        "_scope_label": "테스트범위",
        "_requested_count": 1,
    }
    items = [{"content": None, "choices": None, "answer": None, "explanation": None, "basis": None}]
    with pytest.raises(ValidationAppError):
        applied_exam_service.finalize_generation(job, items)


# ---------------------------------------------------------------------------
# ② 마커 부착 — 접두·날짜·엔진 label
# ---------------------------------------------------------------------------
def test_build_question_marker_prefix_date_engine_label():
    marker = applied_exam_service._build_question_marker("claude-cli")
    assert marker.startswith("> [AI 생성 문항] ")
    assert dt.date.today().isoformat() in marker
    assert "Claude CLI" in marker


# ---------------------------------------------------------------------------
# ⑤ 저장(잡 말미 한 트랜잭션) — 마커·격리 연결·근거 relations·sort_order
# ---------------------------------------------------------------------------
def _seed_basis(db) -> tuple[models.Category, models.Document]:
    real_cat = models.Category(name="실전분류")
    db.add(real_cat)
    db.flush()
    basis_doc = models.Document(
        doc_no="DOC-0001", type="past_question", title="기출1", content="기출 본문", is_active=1
    )
    db.add(basis_doc)
    db.flush()
    db.add(models.CategoryDocument(category_id=real_cat.id, document_id=basis_doc.id, linked_by="manual"))
    db.commit()
    return real_cat, basis_doc


def test_save_generated_marker_isolation_relations_sort_order(db):
    real_cat, basis_doc = _seed_basis(db)

    job = {
        "_basis_docs": [
            {"id": basis_doc.id, "doc_no": "DOC-0001", "type": "past_question", "title": "기출1", "content": "기출 본문"}
        ],
        "_engine": "claude-cli",
        "_scope_label": "테스트범위",
        "_requested_count": 2,
    }
    passed_items = [
        _valid_item(content="응용문항 첫 번째 — 전혀 새로운 지문"),
        _valid_item(content="응용문항 두 번째 — 전혀 새로운 지문", answer="2"),
    ]

    result = applied_exam_service._save_generated(db, job, passed_items)
    assert result["requested"] == 2
    assert result["generated"] == 2
    assert len(result["document_ids"]) == 2

    docs = (
        db.query(models.Document)
        .filter(models.Document.id.in_(result["document_ids"]))
        .order_by(models.Document.id)
        .all()
    )
    today = dt.date.today().isoformat()
    for doc in docs:
        assert doc.content.startswith("> [AI 생성 문항] ")
        assert doc.type == "question"
        assert doc.source_detail == f"AI 응용 생성 {today}"
        assert "번" not in doc.source_detail  # F44 답지 매칭 키 오염 방지(§4.21 생성 규약 4)

    links = (
        db.query(models.CategoryDocument)
        .filter(models.CategoryDocument.document_id.in_(result["document_ids"]))
        .order_by(models.CategoryDocument.sort_order)
        .all()
    )
    assert [l.sort_order for l in links] == [1, 2]
    assert all(l.linked_by == "applied_exam" for l in links)
    assert all(l.category_id == result["run_category_id"] for l in links)

    rels = (
        db.query(models.DocumentRelation)
        .filter(models.DocumentRelation.from_document_id.in_(result["document_ids"]))
        .all()
    )
    assert len(rels) == 2
    assert all(
        r.to_document_id == basis_doc.id and r.relation == "derived_from" and r.created_by == "applied_exam"
        for r in rels
    )

    # 태그 미부여(규칙 자동 연결 차단)
    tag_links = (
        db.query(models.DocumentTag).filter(models.DocumentTag.document_id.in_(result["document_ids"])).all()
    )
    assert tag_links == []

    # 격리 — 실전 분류(real_cat)에는 생성 문항이 연결되지 않는다
    real_links = db.query(models.CategoryDocument).filter(models.CategoryDocument.category_id == real_cat.id).all()
    assert {l.document_id for l in real_links} == {basis_doc.id}


def test_save_generated_creates_root_and_sets_settings_pointer(db):
    job = {
        "_basis_docs": [],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 1,
    }
    passed_items = [_valid_item(basis=[])]

    result = applied_exam_service._save_generated(db, job, passed_items)

    root = db.query(models.Category).filter(models.Category.name == applied_exam_service.ROOT_CATEGORY_NAME).one()
    run_cat = db.get(models.Category, result["run_category_id"])
    assert run_cat.parent_id == root.id

    setting = db.get(models.Setting, applied_exam_service.ROOT_CATEGORY_SETTING_KEY)
    assert json.loads(setting.value) == root.id


def test_save_generated_rolls_back_all_on_mid_batch_failure(db, monkeypatch):
    """부분 성공 저장이 **트랜잭션 하나**임을 증명 — 두 번째 문항 처리 중 예외가 나면
    첫 번째 문항도 함께 롤백되어 DB에 남지 않는다(불변 규칙 2와 같은 원자성 요구)."""
    job = {
        "_basis_docs": [],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 2,
    }
    passed_items = [_valid_item(basis=[]), _valid_item(content="두번째", basis=[])]

    from services import document_service

    call_count = {"n": 0}
    original = document_service._generate_doc_no

    def _flaky(db_arg):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("강제 실패")
        return original(db_arg)

    monkeypatch.setattr(applied_exam_service, "_generate_doc_no", _flaky)

    with pytest.raises(RuntimeError):
        applied_exam_service._save_generated(db, job, passed_items)

    assert db.query(models.Document).count() == 0
    assert db.query(models.Category).count() == 0  # 루트·런 분류도 함께 롤백


# ---------------------------------------------------------------------------
# ③ 격리 — 생성 문항이 실전 분류 기준 quiz/exam 세션에 미등장(quiz_service 재사용 검증)
# ---------------------------------------------------------------------------
def test_isolation_generated_doc_absent_from_real_scope_present_in_run_scope(db):
    real_cat, basis_doc = _seed_basis(db)
    job = {
        "_basis_docs": [
            {"id": basis_doc.id, "doc_no": "DOC-0001", "type": "past_question", "title": "기출1", "content": "기출 본문"}
        ],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 1,
    }
    result = applied_exam_service._save_generated(db, job, [_valid_item()])
    gen_doc_id = result["document_ids"][0]

    real_scope_ids = quiz_service.eligible_document_ids(db, category_ids=[real_cat.id], wrong_only=False)
    assert gen_doc_id not in real_scope_ids

    run_scope_ids = quiz_service.eligible_document_ids(
        db, category_ids=[result["run_category_id"]], wrong_only=False
    )
    assert gen_doc_id in run_scope_ids


# ---------------------------------------------------------------------------
# ④ submit — applied 루트 밖 422 · mode='applied_exam' 기록 · exam/history 혼입 0
# ---------------------------------------------------------------------------
def test_submit_applied_exam_rejects_category_outside_applied_root(db):
    real_cat, basis_doc = _seed_basis(db)
    # basis_doc은 실전 분류(real_cat)에만 연결된 일반 문서 — applied 루트가 아니므로 거부.
    basis_doc.choices = json.dumps(["1", "2", "3", "4"], ensure_ascii=False)
    basis_doc.answer = "1"
    db.commit()

    payload = ExamSubmitRequest(
        answers=[ExamAnswerItem(document_id=basis_doc.id, subject_category_id=real_cat.id, my_answer="1")]
    )
    with pytest.raises(ValidationAppError):
        applied_exam_service.submit_applied_exam(db, payload)


def test_submit_applied_exam_records_mode_and_basis_no_exam_history_leak(db):
    real_cat, basis_doc = _seed_basis(db)
    job = {
        "_basis_docs": [
            {"id": basis_doc.id, "doc_no": "DOC-0001", "type": "past_question", "title": "기출1", "content": "기출 본문"}
        ],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 1,
    }
    result = applied_exam_service._save_generated(db, job, [_valid_item(answer="1")])
    gen_doc_id = result["document_ids"][0]
    run_cat_id = result["run_category_id"]

    payload = ExamSubmitRequest(
        answers=[ExamAnswerItem(document_id=gen_doc_id, subject_category_id=run_cat_id, my_answer="1")]
    )
    report = applied_exam_service.submit_applied_exam(db, payload)

    assert report.results[0].is_correct is True
    assert len(report.results[0].basis) == 1
    assert report.results[0].basis[0].doc_no == "DOC-0001"

    attempt = db.query(models.Attempt).filter(models.Attempt.document_id == gen_doc_id).one()
    assert attempt.mode == "applied_exam"

    # exam/history(mode='exam' 파생)에 혼입 0 — 서로 다른 mode라 자연 분리(설계 §4.21 결정 ②).
    assert exam_service.get_exam_history(db) == []
    history = applied_exam_service.get_applied_exam_history(db)
    assert len(history) == 1
    assert history[0].total.count == 1


def test_submit_applied_exam_wrong_answer_still_records_and_creates_review_note(db):
    real_cat, basis_doc = _seed_basis(db)
    job = {
        "_basis_docs": [
            {"id": basis_doc.id, "doc_no": "DOC-0001", "type": "past_question", "title": "기출1", "content": "기출 본문"}
        ],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 1,
    }
    result = applied_exam_service._save_generated(db, job, [_valid_item(answer="1")])
    gen_doc_id = result["document_ids"][0]
    run_cat_id = result["run_category_id"]

    payload = ExamSubmitRequest(
        answers=[ExamAnswerItem(document_id=gen_doc_id, subject_category_id=run_cat_id, my_answer="2")]
    )
    report = applied_exam_service.submit_applied_exam(db, payload)

    assert report.results[0].is_correct is False
    assert report.results[0].review_note_id is not None
    note = db.get(models.ReviewNote, report.results[0].review_note_id)
    assert note is not None and note.document_id == gen_doc_id
