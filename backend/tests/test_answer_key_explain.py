"""답지 반입·LLM 풀이 생성 단위 테스트 (S18 — F44, 설계 §4.20).

실제 LLM(CLI·API·codex) 호출은 하지 않는다 — 서버 결정론 매칭·머지 순수 함수를 직접
호출하거나, `convert_service._JOBS`에 완료 상태의 가짜 잡을 주입해 apply 경로만 검증한다.
"""
from __future__ import annotations

import datetime as dt
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from exceptions import ConflictError
from services import answer_key_service, convert_service
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


def _doc(id_, *, source_detail=None, answer=None, explanation=None, choices=None):
    """DB에 붙이지 않은 순수 파이썬 Document — `match_answer_key`는 속성만 읽는다."""
    return models.Document(
        id=id_,
        doc_no=f"DOC-{id_:04d}",
        type="question",
        title=f"문항 {id_}",
        source_detail=source_detail,
        answer=answer,
        explanation=explanation,
        choices=choices,
        is_active=1,
    )


# ---------------------------------------------------------------------------
# ① 번호 추출 — 형식·"; " 병합·부재·중복
# ---------------------------------------------------------------------------
def test_extract_numbers_format_and_merge():
    assert answer_key_service.extract_numbers_from_source_detail("2023년 1회 17번") == [17]
    assert answer_key_service.extract_numbers_from_source_detail(
        "2023년 1회 17번; 2023년 2회 5번"
    ) == [17, 5]
    # 최말단 매치 — 한 조각 안에 "번"이 여러 번 나와도 마지막 것만 채택
    assert answer_key_service.extract_numbers_from_source_detail("17번 문제의 정답은 3번") == [3]


def test_extract_numbers_missing_and_duplicate():
    assert answer_key_service.extract_numbers_from_source_detail(None) == []
    assert answer_key_service.extract_numbers_from_source_detail("") == []
    assert answer_key_service.extract_numbers_from_source_detail("2023년 1회") == []  # 부재
    # 같은 번호가 여러 조각에서 중복 추출돼도 그대로 보존(중복 판정은 매칭 단계 책임)
    assert answer_key_service.extract_numbers_from_source_detail("17번; 17번") == [17, 17]


# ---------------------------------------------------------------------------
# ② 결정론 매칭 — 모호·범위 밖 번호 = unmatched
# ---------------------------------------------------------------------------
def test_match_deterministic_ambiguous_and_out_of_range():
    doc1 = _doc(1, source_detail="2023년 1회 1번")
    doc2a = _doc(2, source_detail="2023년 1회 2번")
    doc2b = _doc(3, source_detail="2023년 2회 2번")  # 번호 2 충돌 — 둘 다 ambiguous
    items = [
        {"no": 1, "answer": "1", "explanation": "설명1"},
        {"no": 2, "answer": "2", "explanation": "설명2"},
        {"no": 99, "answer": "3", "explanation": "설명99"},  # 대응 문서 없음 — no_document
    ]
    matcher = SourceMatcher(None)  # 대조 불가(원본 없음) — match_unavailable만 붙는다
    matched, unmatched = answer_key_service.match_answer_key([doc1, doc2a, doc2b], items, matcher)

    assert [m["document_id"] for m in matched] == [1]
    assert matched[0]["no"] == 1

    doc_reasons = {d["document_id"]: d["reason"] for d in unmatched["documents"]}
    assert doc_reasons[2] == "ambiguous"
    assert doc_reasons[3] == "ambiguous"

    no_reasons = {n["no"]: n["reason"] for n in unmatched["numbers"]}
    assert no_reasons[2] == "ambiguous"
    assert no_reasons[99] == "no_document"


def test_match_document_without_number_is_unmatched():
    doc = _doc(1, source_detail="2023년 1회")  # "번" 없음 — 부재
    matched, unmatched = answer_key_service.match_answer_key(
        [doc], [{"no": 1, "answer": "1", "explanation": None}], SourceMatcher(None)
    )
    assert matched == []
    assert unmatched["documents"][0]["reason"] == "no_number"


# ---------------------------------------------------------------------------
# ③ 빈 필드만 병합 — 기존 값 보존·conflict 표시, 실제 apply에서 skip
# ---------------------------------------------------------------------------
def test_matched_entry_flags_conflict_for_existing_field():
    doc = _doc(1, source_detail="1번", answer="1", explanation=None)
    items = [{"no": 1, "answer": "2", "explanation": "새 해설"}]
    matched, _ = answer_key_service.match_answer_key([doc], items, SourceMatcher(None))
    entry = matched[0]
    assert entry["conflicts"] == ["answer_exists"]
    assert entry["current"] == {"has_answer": True, "has_explanation": False}


def test_apply_fills_blank_field_only_and_keeps_existing(db):
    doc = models.Document(
        doc_no="DOC-0001",
        type="question",
        title="문항1",
        source_detail="1번",
        answer="1",
        explanation=None,
        is_active=1,
    )
    db.add(doc)
    db.flush()
    cat = models.Category(name="테스트분류")
    db.add(cat)
    db.flush()
    db.add(models.CategoryDocument(category_id=cat.id, document_id=doc.id))
    db.commit()

    key_id = "akk_test_merge"
    job_id = "ak_test_merge"
    answer_key_service._KEYS[key_id] = {
        "created_at": dt.datetime.now(),
        "filename": "answer.txt",
        "file_type": "txt",
        "category_id": cat.id,
        "source_bytes": b"1. 2 - new explanation text",
        "extract_available": True,
        "extracted_chars": 20,
        "target": {"question_total": 1, "missing_answer": 0, "missing_explanation": 1},
        "estimate": {"approx_input_tokens": 10, "assumed": False},
        "job_id": job_id,
    }
    with convert_service._JOBS_LOCK:
        convert_service._JOBS[job_id] = {
            "kind": "answer_key",
            "status": "done",
            "result": {"items": [{"no": 1, "answer": "2", "explanation": "새 해설"}]},
            "error": None,
            "_error_info": None,
            "created_at": dt.datetime.now(),
        }

    result = answer_key_service.apply_answer_key(db, key_id, [doc.id])
    assert result.updated == 1
    assert result.skipped == []
    db.refresh(doc)
    assert doc.answer == "1"  # 기존 정답 보존(덮어쓰기 없음)
    assert doc.explanation == "새 해설"  # 빈 필드만 채움
    assert "정답/해설: answer.txt" in doc.source_detail


# ---------------------------------------------------------------------------
# ④ apply 멱등성 — 빈 필드만 채우므로 재적용은 무해(변경 없음)
# ---------------------------------------------------------------------------
def test_apply_is_idempotent(db):
    doc = models.Document(
        doc_no="DOC-0002",
        type="question",
        title="문항2",
        source_detail="1번",
        answer=None,
        explanation=None,
        is_active=1,
    )
    db.add(doc)
    db.flush()
    cat = models.Category(name="테스트분류2")
    db.add(cat)
    db.flush()
    db.add(models.CategoryDocument(category_id=cat.id, document_id=doc.id))
    db.commit()

    key_id = "akk_test_idem"
    job_id = "ak_test_idem"
    answer_key_service._KEYS[key_id] = {
        "created_at": dt.datetime.now(),
        "filename": "answer.txt",
        "file_type": "txt",
        "category_id": cat.id,
        "source_bytes": b"1. 2 - explanation",
        "extract_available": True,
        "extracted_chars": 20,
        "target": {"question_total": 1, "missing_answer": 1, "missing_explanation": 1},
        "estimate": {"approx_input_tokens": 10, "assumed": False},
        "job_id": job_id,
    }
    with convert_service._JOBS_LOCK:
        convert_service._JOBS[job_id] = {
            "kind": "answer_key",
            "status": "done",
            "result": {"items": [{"no": 1, "answer": "2", "explanation": "해설"}]},
            "error": None,
            "_error_info": None,
            "created_at": dt.datetime.now(),
        }

    first = answer_key_service.apply_answer_key(db, key_id, [doc.id])
    assert first.updated == 1
    db.refresh(doc)
    source_detail_after_first = doc.source_detail

    second = answer_key_service.apply_answer_key(db, key_id, [doc.id])
    assert second.updated == 0
    assert [s.model_dump() for s in second.skipped] == [
        {"document_id": doc.id, "reason": "no_blank_field"}
    ]
    db.refresh(doc)
    assert doc.source_detail == source_detail_after_first  # 중복 병기 없음(멱등)


# ---------------------------------------------------------------------------
# ⑤ explanation 원문 대조 → fabrication_suspect
# ---------------------------------------------------------------------------
def test_explanation_mismatch_flagged_fabrication_suspect():
    source_text = "가나다라마바사아자차카타파하" * 20  # 200자 이상 — 대조 가능
    matcher = SourceMatcher(source_text)
    assert matcher.available
    doc = _doc(1, source_detail="1번")
    items = [{"no": 1, "answer": None, "explanation": "완전히 다른 내용의 창작 해설 문장입니다"}]
    matched, _ = answer_key_service.match_answer_key([doc], items, matcher)
    assert "fabrication_suspect" in matched[0]["warnings"]


def test_explanation_match_available_no_warning_when_present_in_source():
    source_text = "가나다라마바사아자차카타파하" * 20 + "이 문장은 원문에 실제로 있는 해설입니다"
    matcher = SourceMatcher(source_text)
    doc = _doc(1, source_detail="1번")
    items = [{"no": 1, "answer": None, "explanation": "이 문장은 원문에 실제로 있는 해설입니다"}]
    matched, _ = answer_key_service.match_answer_key([doc], items, matcher)
    assert "fabrication_suspect" not in matched[0]["warnings"]


# ---------------------------------------------------------------------------
# ⑥ answer 번호 검증 — choices 범위 밖은 병합 후보에서 제거
# ---------------------------------------------------------------------------
def test_answer_out_of_choice_range_is_dropped():
    doc = _doc(1, source_detail="1번", choices=json.dumps(["a", "b", "c"], ensure_ascii=False))
    items = [{"no": 1, "answer": "9", "explanation": None}]
    matched, _ = answer_key_service.match_answer_key([doc], items, SourceMatcher(None))
    assert "answer" not in matched[0]["proposed"]


def test_answer_within_choice_range_is_kept():
    doc = _doc(1, source_detail="1번", choices=json.dumps(["a", "b", "c"], ensure_ascii=False))
    items = [{"no": 1, "answer": "2", "explanation": None}]
    matched, _ = answer_key_service.match_answer_key([doc], items, SourceMatcher(None))
    assert matched[0]["proposed"]["answer"] == "2"


# ---------------------------------------------------------------------------
# ⑦ explain 대상 제한 — 해설 있는 문서는 409(ConflictError)
# ---------------------------------------------------------------------------
def test_explain_target_restriction_conflict(db):
    doc = models.Document(
        doc_no="DOC-0010",
        type="question",
        title="문항10",
        content="본문",
        answer="1",
        explanation="이미 있는 해설",
        is_active=1,
    )
    db.add(doc)
    db.commit()
    with pytest.raises(ConflictError):
        convert_service.start_explain_job(db, doc.id)


# ---------------------------------------------------------------------------
# ⑧ 마커 부착 — 접두·정답 포함 변형
# ---------------------------------------------------------------------------
def test_explain_apply_marker_prefix_explanation_only(db):
    doc = models.Document(
        doc_no="DOC-0020",
        type="question",
        title="문항20",
        content="본문",
        answer="1",
        explanation=None,
        is_active=1,
    )
    db.add(doc)
    db.commit()

    job_id = "exp_test_only"
    with convert_service._JOBS_LOCK:
        convert_service._JOBS[job_id] = {
            "kind": "explain",
            "status": "done",
            "document_id": doc.id,
            "result": {"draft": {"explanation": "풀이 내용입니다", "answer": None}},
            "error": None,
            "_error_info": None,
            "_engine": "claude-cli",
            "created_at": dt.datetime.now(),
        }

    updated = convert_service.apply_explain_job(db, doc.id, job_id)
    assert updated.explanation.startswith("> [AI 생성 해설] ")
    assert "[AI 생성 해설·정답]" not in updated.explanation
    assert "풀이 내용입니다" in updated.explanation
    assert updated.answer == "1"  # 기존 정답 불변


def test_explain_apply_marker_prefix_with_answer(db):
    doc = models.Document(
        doc_no="DOC-0021",
        type="question",
        title="문항21",
        content="본문",
        answer=None,
        explanation=None,
        is_active=1,
    )
    db.add(doc)
    db.commit()

    job_id = "exp_test_both"
    with convert_service._JOBS_LOCK:
        convert_service._JOBS[job_id] = {
            "kind": "explain",
            "status": "done",
            "document_id": doc.id,
            "result": {"draft": {"explanation": "풀이 내용입니다", "answer": "2"}},
            "error": None,
            "_error_info": None,
            "_engine": "claude-cli",
            "created_at": dt.datetime.now(),
        }

    updated = convert_service.apply_explain_job(db, doc.id, job_id)
    assert updated.explanation.startswith("> [AI 생성 해설·정답] ")
    assert updated.answer == "2"


def test_explain_apply_does_not_overwrite_existing_answer(db):
    """draft에 answer가 있어도 기존 정답이 있으면 병합하지 않는다(§4.20 ② — 비어 있을 때만)."""
    doc = models.Document(
        doc_no="DOC-0022",
        type="question",
        title="문항22",
        content="본문",
        answer="3",
        explanation=None,
        is_active=1,
    )
    db.add(doc)
    db.commit()

    job_id = "exp_test_keep_answer"
    with convert_service._JOBS_LOCK:
        convert_service._JOBS[job_id] = {
            "kind": "explain",
            "status": "done",
            "document_id": doc.id,
            "result": {"draft": {"explanation": "풀이 내용입니다", "answer": "1"}},
            "error": None,
            "_error_info": None,
            "_engine": "claude-cli",
            "created_at": dt.datetime.now(),
        }

    updated = convert_service.apply_explain_job(db, doc.id, job_id)
    assert updated.answer == "3"  # 기존 정답 불변(정답 미포함 마커)
    assert updated.explanation.startswith("> [AI 생성 해설] ")
