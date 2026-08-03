"""응용 모의고사 생성·검증 게이트·격리·제출 단위 테스트 (S19 — F45, 설계 §4.21).

실제 LLM 호출은 하지 않는다 — 검증 게이트(`validate_items`)는 순수 함수로 직접
호출하고, 저장(`_save_generated`)·제출(`submit_applied_exam`)은 in-memory sqlite
세션에 직접 호출한다(`test_answer_key_explain.py` 전례).
"""
from __future__ import annotations

import datetime as dt
import json

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from exceptions import ValidationAppError
from schemas.applied_exam import AppliedExamGenerateRequest, AppliedExamPrepareRequest
from schemas.exam import ExamAnswerItem, ExamSubmitRequest
from services import applied_exam_service, convert_service, exam_service, quiz_service
from services import source_match, tag_rule_service
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


@pytest.fixture()
def restore_queue_paused():
    """`test_job_center.py` 전례 — 큐를 일시정지해 워커가 실제 잡을 집어가 진짜 CLI를
    부르지 못하게 한다(실 LLM 호출 절대 금지). 테스트가 실패해도 다음 테스트를 막지
    않도록 항상 resume한다."""
    yield
    convert_service.resume_queue()


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


def test_validate_items_non_string_basis_element_discarded_without_crashing():
    """stage-reviewer 지적(중요 1) — LLM이 basis에 문자열이 아닌 원소(예: `{"doc_no": "..."}`
    객체)를 섞어 내보내도 `validate_items`가 TypeError로 죽지 않고 해당 문항만 `bad_basis`로
    폐기해야 한다(다른 통과 가능 문항까지 잡 전체가 죽어 LLM 비용을 날리는 사고 방지,
    설계 §4.21 생성 규약 3-ⓒ 의도 = "해당 문항만 폐기"). 통과 가능한 다른 문항은 그대로
    통과해 잡이 계속 진행됨을 함께 확인한다(부분 성공)."""
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [
        _valid_item(basis=[{"doc_no": "DOC-0001"}]),  # 비-문자열 원소 — 크래시 없이 폐기돼야 함
        _valid_item(),  # 정상 항목 — 계속 통과해야 함
    ]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert len(passed) == 1
    assert discarded == {"bad_basis": 1}


def test_validate_items_mixed_string_and_dict_basis_elements_discarded():
    """basis 배열에 유효한 문자열과 비-문자열이 섞여 있어도(부분 오염) 전체 문항을
    `bad_basis`로 폐기한다 — 부분 신뢰는 하지 않는다."""
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(basis=["DOC-0001", {"doc_no": "DOC-0001"}])]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert passed == []
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


def test_validate_items_short_content_not_flagged_duplicate():
    """검토 지적 ② — `SourceMatcher.matches()`는 정규화 길이 <`MIN_CANDIDATE_CHARS`(10)면
    원 용도(상투구 오탐 방지)에서 무조건 True(통과)를 돌려주는데, 역적용(복제 검출)에서
    그대로 쓰면 True=폐기라 짧은 생성 지문이 전부 오폐기된다. corpus는 대조 가능
    (>=200자)하지만 후보가 10자 미만이면 복제 판정 자체를 건너뛰어야 한다."""
    source_text = "가나다라마바사아자차카타파하" * 20  # >=200자 — 대조 가능(available=True)
    matcher = SourceMatcher(source_text)
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    short_content = "지문이짧음"  # 정규화 길이 <10
    assert len(source_match.normalize(short_content)) < source_match.MIN_CANDIDATE_CHARS
    items = [_valid_item(content=short_content)]
    passed, discarded = applied_exam_service.validate_items(items, basis, matcher)
    assert discarded == {}
    assert len(passed) == 1


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
# ① 봉투 정제 — _normalize_applied_exam_items가 basis의 비-문자열 원소를 걸러낸다
# (stage-reviewer 지적 — validate_items 방어와 겹쳐 두 지점에서 막는다)
# ---------------------------------------------------------------------------
def test_normalize_applied_exam_items_drops_non_string_basis_elements():
    payload = {
        "items": [
            {
                "content": "지문",
                "choices": ["a", "b", "c", "d"],
                "answer": "1",
                "explanation": "해설",
                "basis": ["DOC-0001", {"doc_no": "DOC-0002"}, 123, None],
            }
        ]
    }
    items = convert_service._normalize_applied_exam_items(payload)
    assert items[0]["basis"] == ["DOC-0001"]


def test_normalize_applied_exam_items_basis_not_list_becomes_empty():
    payload = {"items": [{"content": "지문", "basis": {"doc_no": "DOC-0001"}}]}
    items = convert_service._normalize_applied_exam_items(payload)
    assert items[0]["basis"] == []


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


def test_finalize_generation_zero_passed_message_includes_discard_summary():
    """검토 지적 ④ — `ValidationAppError.detail`은 `_fallback_error_info`의 generic
    분기(§4.11)에서 버려져 사용자에게 안 보인다. 폐기 사유 요약이 메시지 문자열
    자체에 합성돼야 한다(사유 코드 → 한국어 라벨, 원문 미노출 원칙 준수)."""
    job = {
        "_basis_docs": [{"id": 1, "doc_no": "DOC-0001", "type": "question", "title": "t", "content": "본문"}],
        "_engine": "claude-cli",
        "_scope_label": "테스트범위",
        "_requested_count": 2,
    }
    items = [
        {"content": None, "choices": None, "answer": None, "explanation": None, "basis": None},  # invalid_item
        _valid_item(answer="9"),  # invalid_answer(basis=["DOC-0001"]은 job의 basis_docs에 실재)
    ]
    with pytest.raises(ValidationAppError) as exc_info:
        applied_exam_service.finalize_generation(job, items)
    message = exc_info.value.message
    assert "생성된 문항 전체가 검증에서 폐기되었습니다" in message
    assert "문항 형식 오류 1건" in message
    assert "정답 형식 위반 1건" in message
    assert "범위를 좁히거나 문항 수를 줄여 다시 시도해 보세요." in message


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
# ① 자기참조 증폭 차단 — prepare 범위에서 applied 서브트리 차집합 제거(검토 지적 ①, R22)
# ---------------------------------------------------------------------------
def test_collect_basis_documents_excludes_applied_subtree(db):
    """사용자가 범위에 applied 런 분류를 섞어 골라도(직접 선택) AI 생성 문항은 다음
    생성의 근거로 수집되지 않는다 — 서버 결정론 차집합 제거."""
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
    run_cat_id = result["run_category_id"]
    gen_doc_id = result["document_ids"][0]

    docs = applied_exam_service._collect_basis_documents(db, [real_cat.id, run_cat_id])
    doc_ids = {d.id for d in docs}
    assert basis_doc.id in doc_ids
    assert gen_doc_id not in doc_ids


def test_prepare_rejects_when_scope_entirely_applied_subtree(db):
    """범위 전체가 applied 서브트리(예약 루트 자신 포함)면 실전 문서가 하나도 섞이지
    않으므로 기존 "근거 0건" 422로 자연 귀결된다(별도 에러 코드를 신설하지 않는다)."""
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
    run_cat_id = result["run_category_id"]
    root_id = json.loads(db.get(models.Setting, applied_exam_service.ROOT_CATEGORY_SETTING_KEY).value)

    with pytest.raises(ValidationAppError):
        applied_exam_service.prepare(db, AppliedExamPrepareRequest(category_ids=[run_cat_id], count=1))
    with pytest.raises(ValidationAppError):
        applied_exam_service.prepare(db, AppliedExamPrepareRequest(category_ids=[root_id], count=1))


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


# ---------------------------------------------------------------------------
# ③ invalid_output 안내 문구 — applied_exam 분기(검토 지적 ③). convert(원본 분할) 문구가
# 아니라 범위·문항 수 조정 안내로 갈라진다 — 응용 생성은 "원본"이 아니라 범위 문서·
# 요청 문항 수가 입력이다.
# ---------------------------------------------------------------------------
def test_invalid_output_action_applied_exam_branch_differs_from_convert():
    applied_msg = convert_service._invalid_output_action(truncated=False, job_kind="applied_exam")
    convert_msg = convert_service._invalid_output_action(truncated=False, job_kind="convert")
    assert applied_msg != convert_msg
    assert "범위를 좁히거나 문항 수를 줄여 다시 시도해 보세요." == applied_msg
    assert "원본" not in applied_msg  # "원본을 과목·회차 단위로…" 류 문구가 새지 않는다


def test_invalid_output_action_applied_exam_truncated_variant():
    msg = convert_service._invalid_output_action(truncated=True, job_kind="applied_exam")
    assert "문항 수를 줄이거나" in msg
    assert "원본" not in msg


# ---------------------------------------------------------------------------
# S24(F50) — 누적('accumulate')·1회성('oneshot') 생성 모드 (설계 §4.21 S24 개정 블록)
# ---------------------------------------------------------------------------

# ① mode 기본값 = accumulate · 잘못된 값 422(스키마 Literal 검증 — FastAPI가 자동으로
#    §3 VALIDATION_ERROR 형태로 변환하는 계층은 기존 엔진 Literal 필드와 동일 인프라라
#    여기서는 스키마 경계만 검증한다).
def test_generate_request_mode_defaults_to_accumulate():
    assert AppliedExamGenerateRequest().mode == "accumulate"


def test_generate_request_mode_oneshot_accepted():
    assert AppliedExamGenerateRequest(mode="oneshot").mode == "oneshot"


def test_generate_request_invalid_mode_rejected_422():
    with pytest.raises(ValidationError):
        AppliedExamGenerateRequest(mode="bogus")


def test_start_applied_exam_job_stores_mode_in_job_record_label_unchanged(db, restore_queue_paused):
    """잡 레코드에 mode를 보관하되 label은 불변(체크리스트 ①) — 큐를 일시정지해 워커가
    실제로 잡을 집어가지 못하게 한 뒤 잡 딕셔너리만 즉시 검사하고 치운다."""
    convert_service.pause_queue()
    job_id_default = convert_service.start_applied_exam_job(
        db=db, gen_id="g1", scope_label="범위", requested_count=2, basis_docs=[], engine="claude-cli"
    )
    job_id_oneshot = convert_service.start_applied_exam_job(
        db=db, gen_id="g2", scope_label="범위", requested_count=2, basis_docs=[], engine="claude-cli", mode="oneshot"
    )
    with convert_service._JOBS_LOCK:
        job_default = convert_service._JOBS.pop(job_id_default)
        job_oneshot = convert_service._JOBS.pop(job_id_oneshot)

    assert job_default["_mode"] == "accumulate"
    assert job_oneshot["_mode"] == "oneshot"
    # label = 범위 라벨·요청 문항 수 수준 그대로(mode 문구가 섞이지 않는다)
    assert job_default["_label"] == job_oneshot["_label"] == "AI 응용 문항 생성 — 범위 (2문항)"


def test_build_applied_exam_prompt_tags_instruction_only_for_accumulate():
    """생성 프롬프트 출력 스키마 확장(accumulate만) — oneshot은 tags 지시 자체가 없다
    (출력 토큰 절감이 1회성의 존재 이유)."""
    prompt_accumulate = convert_service._build_applied_exam_prompt([], 3, mode="accumulate")
    prompt_oneshot = convert_service._build_applied_exam_prompt([], 3, mode="oneshot")
    assert "tags" in prompt_accumulate
    assert "tags" not in prompt_oneshot


def test_get_status_result_includes_mode_field(db, restore_queue_paused):
    """상태 응답 `result`에 `mode` 필드 순수 추가(체크리스트 마지막 항목) — 실 LLM 호출
    없이 잡을 'done'으로 직접 마킹해(단위 테스트 관례) `get_status`가 §4.21 S24 개정
    블록이 요구하는 필드를 API 스키마(`AppliedExamStatus.result.mode`)까지 그대로
    실어 나르는지 확인한다."""
    convert_service.pause_queue()
    job_id = convert_service.start_applied_exam_job(
        db=db, gen_id="g-status", scope_label="범위", requested_count=1, basis_docs=[], engine="claude-cli",
        mode="oneshot",
    )
    with convert_service._JOBS_LOCK:
        job = convert_service._JOBS[job_id]
        job["status"] = "done"
        job["result"] = {
            "run_category_id": 1,
            "requested": 1,
            "generated": 1,
            "document_ids": [1],
            "discarded": [],
            "mode": "oneshot",
        }

    with applied_exam_service._GENS_LOCK:
        applied_exam_service._GENS["g-status"] = {
            "created_at": dt.datetime.now(),
            "category_ids": [],
            "scope_label": "범위",
            "requested_count": 1,
            "basis_docs": [],
            "source_counts": {"past_question": 0, "question": 0, "concept": 0},
            "estimate": {"approx_input_tokens": 1, "assumed": False},
            "job_id": job_id,
        }

    status_out = applied_exam_service.get_status("g-status")
    assert status_out.result is not None
    assert status_out.result.mode == "oneshot"

    with convert_service._JOBS_LOCK:
        convert_service._JOBS.pop(job_id, None)
    with applied_exam_service._GENS_LOCK:
        applied_exam_service._GENS.pop("g-status", None)


# ② accumulate = DocumentTag 저장 + suggestion 생성(auto 규칙에서도 linked 0·suggested만)
def test_save_generated_accumulate_saves_tags_and_forces_suggestion_even_for_auto_rule(db):
    real_cat, basis_doc = _seed_basis(db)
    auto_target_cat = models.Category(name="자동분류대상")
    db.add(auto_target_cat)
    db.flush()
    db.add(models.TagRule(category_id=auto_target_cat.id, tag_query="응용키워드", mode="auto"))
    db.commit()

    job = {
        "_basis_docs": [
            {"id": basis_doc.id, "doc_no": "DOC-0001", "type": "past_question", "title": "기출1", "content": "기출 본문"}
        ],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 1,
        "_mode": "accumulate",
    }
    item = _valid_item(tags=["응용키워드", "다른키워드"])
    result = applied_exam_service._save_generated(db, job, [item])
    assert result["mode"] == "accumulate"
    gen_doc_id = result["document_ids"][0]

    tag_names = set(
        db.query(models.Tag.name)
        .join(models.DocumentTag, models.DocumentTag.tag_id == models.Tag.id)
        .filter(models.DocumentTag.document_id == gen_doc_id)
        .all()
    )
    assert tag_names == {("응용키워드",), ("다른키워드",)}

    # auto 규칙이 매칭돼도 즉시 연결(linked)되지 않는다 — suggested 강제(승인 없는 자동
    # 연결 경로 0 유지, 격리 원칙 R22).
    linked = (
        db.query(models.CategoryDocument)
        .filter(
            models.CategoryDocument.category_id == auto_target_cat.id,
            models.CategoryDocument.document_id == gen_doc_id,
        )
        .all()
    )
    assert linked == []

    suggestion = (
        db.query(models.Suggestion)
        .filter(
            models.Suggestion.document_id == gen_doc_id,
            models.Suggestion.category_id == auto_target_cat.id,
        )
        .one()
    )
    assert suggestion.status == "pending"


# ---------------------------------------------------------------------------
# stage-reviewer 지적(중요 1) — 자동 연결(linked) 차단은 호출부 플래그가 아니라
# `tag_rule_service._apply_rule_to_document`의 **문서 기준 판정**(`_is_applied_exam_generated`)
# 하나로 귀결돼야 한다 — scan_document(트리거 1·2)·scan_rule(트리거 3) 전수가 이 판정을
# 경유하는지, 그리고 일반 문서의 auto 즉시 연결 회귀가 없는지 확인한다.
# ---------------------------------------------------------------------------
def test_scan_rule_bulk_apply_suggests_only_for_applied_exam_generated_document(db):
    """scan_rule(트리거 3 — 일괄 스캔, force_suggest 없이 호출)에서도 응용 생성물은
    문서 기준 판정으로 걸러져 suggested만 만든다 — auto 규칙이어도 linked 행 0.
    생성은 oneshot 모드로 만들어(생성 시점엔 태그 0) 이후 별도로 태그가 붙은 시나리오를
    검증한다. 주의: oneshot 생성물도 격리 분류 연결(ⓐ linked_by='applied_exam')과
    derived_from(ⓑ created_by='applied_exam') 신호를 둘 다 가지므로 이 테스트는 이중
    신호 상태를 검증한다 — ⓑ 단독 경로(격리 분류 연결이 해제된 문서)는 별도 미검증
    (검토 관찰 2026-08-04: OR 판정 코드 경로상 동등하나 커버리지 공백으로 기록)."""
    real_cat, basis_doc = _seed_basis(db)
    job = {
        "_basis_docs": [
            {"id": basis_doc.id, "doc_no": "DOC-0001", "type": "past_question", "title": "기출1", "content": "기출 본문"}
        ],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 1,
        "_mode": "oneshot",
    }
    result = applied_exam_service._save_generated(db, job, [_valid_item()])
    gen_doc_id = result["document_ids"][0]

    # scan_rule 트리거 자체만 격리해 검증하기 위해 태그는 직접 심는다(replace_tags 경유가
    # 아니다 — 그 경로는 아래 별도 테스트에서 검증).
    tag = models.Tag(name="응용키워드-scanrule")
    db.add(tag)
    db.flush()
    db.add(models.DocumentTag(document_id=gen_doc_id, tag_id=tag.id))
    db.commit()

    target_cat = models.Category(name="자동분류대상-scanrule")
    db.add(target_cat)
    db.flush()
    rule = models.TagRule(category_id=target_cat.id, tag_query="응용키워드-scanrule", mode="auto")
    db.add(rule)
    db.commit()

    created = tag_rule_service.scan_rule(db, rule.id)
    assert created == 1

    linked = (
        db.query(models.CategoryDocument)
        .filter(
            models.CategoryDocument.category_id == target_cat.id,
            models.CategoryDocument.document_id == gen_doc_id,
        )
        .all()
    )
    assert linked == []

    suggestion = (
        db.query(models.Suggestion)
        .filter(
            models.Suggestion.document_id == gen_doc_id,
            models.Suggestion.category_id == target_cat.id,
        )
        .one()
    )
    assert suggestion.status == "pending"


def test_replace_tags_triggered_scan_suggests_only_for_applied_exam_generated_document(db):
    """document_service.replace_tags(트리거 2 — 태그 수동 편집)가 호출하는 scan_document는
    force_suggest 없이 호출되지만, 응용 생성물이면 문서 기준 판정으로 걸러져 suggested만
    만든다 — auto 규칙이어도 linked 행 0."""
    from services import document_service

    real_cat, basis_doc = _seed_basis(db)
    job = {
        "_basis_docs": [
            {"id": basis_doc.id, "doc_no": "DOC-0001", "type": "past_question", "title": "기출1", "content": "기출 본문"}
        ],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 1,
        "_mode": "oneshot",
    }
    result = applied_exam_service._save_generated(db, job, [_valid_item()])
    gen_doc_id = result["document_ids"][0]

    target_cat = models.Category(name="자동분류대상-replacetags")
    db.add(target_cat)
    db.flush()
    db.add(models.TagRule(category_id=target_cat.id, tag_query="응용키워드-replacetags", mode="auto"))
    db.commit()

    document_service.replace_tags(db, gen_doc_id, ["응용키워드-replacetags"])

    linked = (
        db.query(models.CategoryDocument)
        .filter(
            models.CategoryDocument.category_id == target_cat.id,
            models.CategoryDocument.document_id == gen_doc_id,
        )
        .all()
    )
    assert linked == []

    suggestion = (
        db.query(models.Suggestion)
        .filter(
            models.Suggestion.document_id == gen_doc_id,
            models.Suggestion.category_id == target_cat.id,
        )
        .one()
    )
    assert suggestion.status == "pending"


def test_normal_document_auto_rule_still_links_immediately_regression(db):
    """일반(응용 생성물이 아닌) 문서는 문서 기준 판정에 걸리지 않아 auto 규칙이 종전처럼
    즉시 연결된다 — 회귀 없음(stage-reviewer 지적 — 중요 1)."""
    normal_doc = models.Document(
        doc_no="DOC-NORMAL-1", type="question", title="일반문항", content="본문", is_active=1
    )
    db.add(normal_doc)
    db.flush()
    tag = models.Tag(name="일반키워드")
    db.add(tag)
    db.flush()
    db.add(models.DocumentTag(document_id=normal_doc.id, tag_id=tag.id))
    db.commit()

    target_cat = models.Category(name="자동분류대상-일반")
    db.add(target_cat)
    db.flush()
    db.add(models.TagRule(category_id=target_cat.id, tag_query="일반키워드", mode="auto"))
    db.commit()

    counts = tag_rule_service.scan_document(db, normal_doc.id)
    assert counts == {"linked": 1, "suggested": 0}

    linked = (
        db.query(models.CategoryDocument)
        .filter(
            models.CategoryDocument.category_id == target_cat.id,
            models.CategoryDocument.document_id == normal_doc.id,
        )
        .one()
    )
    assert linked.linked_by == "rule"


# ③ oneshot = 태그 0·스캔 0(종전 동작 회귀)
def test_save_generated_oneshot_no_tags_no_scan_call(db, monkeypatch):
    real_cat, basis_doc = _seed_basis(db)
    scan_calls = {"n": 0}
    original_scan = tag_rule_service.scan_document

    def _spy(*args, **kwargs):
        scan_calls["n"] += 1
        return original_scan(*args, **kwargs)

    monkeypatch.setattr(applied_exam_service.tag_rule_service, "scan_document", _spy)

    job = {
        "_basis_docs": [
            {"id": basis_doc.id, "doc_no": "DOC-0001", "type": "past_question", "title": "기출1", "content": "기출 본문"}
        ],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 1,
        "_mode": "oneshot",
    }
    # tags가 정상적으로 붙어 있어도(누적 모드 프롬프트를 거쳐 온 게 아니라는 가정 하에)
    # oneshot 분기는 이를 완전히 무시해야 한다.
    item = _valid_item(tags=["무시될키워드"])
    result = applied_exam_service._save_generated(db, job, [item])
    assert result["mode"] == "oneshot"
    gen_doc_id = result["document_ids"][0]

    assert db.query(models.DocumentTag).filter(models.DocumentTag.document_id == gen_doc_id).count() == 0
    assert scan_calls["n"] == 0


# ④ tags 필드 위반 = 태그만 무시·문항 유지(discarded 미포함)
def test_validate_items_tags_not_a_list_ignored_item_kept():
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(tags="응용키워드,다른키워드")]  # 문자열 — 비배열 위반
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert discarded == {}
    assert len(passed) == 1
    assert passed[0]["tags"] == []


def test_validate_items_tags_with_any_non_string_element_discards_whole_array_not_item():
    """stage-reviewer 지적(경미 3) — 관례(`convert_service._normalize_regenerate_draft`,
    F44 전례)는 배열에 비-문자열 원소가 하나라도 섞이면 **배열 전체**를 무시한다(부분
    필터가 아니다). 문항 자체는 여전히 유지된다(discarded 미포함)."""
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(tags=["응용키워드", 123, None, "다른키워드"])]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert discarded == {}
    assert len(passed) == 1
    assert passed[0]["tags"] == []


def test_validate_items_tags_all_strings_trimmed_deduped_order_preserved():
    """전부 문자열인 배열만 §8.2 정규화(공백 정리·빈 값 제거·중복 제거, 원 순서 유지)를
    거친다."""
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item(tags=["응용키워드", "  ", "응용키워드", " 다른키워드 "])]
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert discarded == {}
    assert len(passed) == 1
    assert passed[0]["tags"] == ["응용키워드", "다른키워드"]


def test_validate_items_missing_tags_key_defaults_to_empty_list():
    """oneshot 프롬프트는 tags 지시 자체가 없으므로 raw 항목에 키가 없다 — 통과 항목의
    tags는 안전하게 빈 리스트로 귀결된다."""
    basis = {"DOC-0001": {"doc_no": "DOC-0001"}}
    items = [_valid_item()]  # tags 키 자체 없음
    passed, discarded = applied_exam_service.validate_items(items, basis, SourceMatcher(None))
    assert discarded == {}
    assert passed[0]["tags"] == []


# ⑤ derived_from — 근거 연결은 양 모드 공통(체크리스트 ⑤)
def test_derived_from_recorded_in_both_modes(db):
    for idx, mode in enumerate(("accumulate", "oneshot")):
        real_cat = models.Category(name=f"실전분류-{mode}")
        db.add(real_cat)
        db.flush()
        # 숫자가 아닌 접미사 — `_generate_doc_no`의 max(substr(...)::int) 계산에서 캐스트
        # 실패로 NULL 취급돼(무시) 이후 생성 문서 doc_no와 절대 충돌하지 않는다.
        basis_doc = models.Document(
            doc_no=f"DOC-BASIS-{mode}", type="past_question", title="기출1", content="기출 본문", is_active=1
        )
        db.add(basis_doc)
        db.flush()
        db.add(
            models.CategoryDocument(category_id=real_cat.id, document_id=basis_doc.id, linked_by="manual")
        )
        db.commit()

        job = {
            "_basis_docs": [
                {
                    "id": basis_doc.id,
                    "doc_no": basis_doc.doc_no,
                    "type": "past_question",
                    "title": "기출1",
                    "content": "기출 본문",
                }
            ],
            "_engine": "claude-cli",
            "_scope_label": f"범위-{mode}",
            "_requested_count": 1,
            "_mode": mode,
        }
        result = applied_exam_service._save_generated(db, job, [_valid_item(basis=[basis_doc.doc_no])])
        gen_doc_id = result["document_ids"][0]
        rel = (
            db.query(models.DocumentRelation)
            .filter(models.DocumentRelation.from_document_id == gen_doc_id)
            .one()
        )
        assert rel.relation == "derived_from"
        assert rel.created_by == "applied_exam"
        assert rel.to_document_id == basis_doc.id


# ⑥ 격리 불변 — accumulate 모드에서도 실전 트리 연결 0·마커 부착·기본 제외가 그대로다
# (태그·suggestion이 생겨도 격리 원칙 자체는 개정 대상이 아니다).
def test_accumulate_mode_isolation_marker_and_real_tree_unaffected(db):
    real_cat, basis_doc = _seed_basis(db)
    auto_target_cat = models.Category(name="다른실전분류")
    db.add(auto_target_cat)
    db.flush()
    db.add(models.TagRule(category_id=auto_target_cat.id, tag_query="응용키워드", mode="auto"))
    db.commit()

    job = {
        "_basis_docs": [
            {"id": basis_doc.id, "doc_no": "DOC-0001", "type": "past_question", "title": "기출1", "content": "기출 본문"}
        ],
        "_engine": "claude-cli",
        "_scope_label": "범위",
        "_requested_count": 1,
        "_mode": "accumulate",
    }
    result = applied_exam_service._save_generated(db, job, [_valid_item(tags=["응용키워드"])])
    gen_doc_id = result["document_ids"][0]

    doc = db.get(models.Document, gen_doc_id)
    assert doc.content.startswith("> [AI 생성 문항] ")  # 마커 부착

    # 실전 트리(real_cat·auto_target_cat)에 연결된 행 0 — suggestion만 생겼을 뿐
    real_links = (
        db.query(models.CategoryDocument)
        .filter(
            models.CategoryDocument.document_id == gen_doc_id,
            models.CategoryDocument.category_id.in_([real_cat.id, auto_target_cat.id]),
        )
        .all()
    )
    assert real_links == []

    # 기본 제외 — 실전 분류 기준 quiz 스코프에는 여전히 안 나온다
    real_scope_ids = quiz_service.eligible_document_ids(
        db, category_ids=[real_cat.id, auto_target_cat.id], wrong_only=False
    )
    assert gen_doc_id not in real_scope_ids
