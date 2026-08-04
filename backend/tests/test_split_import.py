"""대용량 원본 LLM 분할 반입 단위 테스트 (S23 — F49, 설계 §4.25).

실 LLM 호출은 하지 않는다(무LLM 규약 — stage-21 사고 재발 방지 승계) — 정밀 분석 잡은
큐를 일시정지하거나 잡 레코드를 직접 구성해(F48 전례) 검증한다.

9항목: ① 휴리스틱 후보·라벨·confidence ② 상한 3종(200만 자·40개·조각 20만 자) 422
③ 무결성 검증(오름차순·중첩 0·합집합·무라벨 구간 생성) ④ 정밀 분석 산출 검증(후보 집합
밖 오프셋 = invalid_output) ⑤ 재절단 = 원문[start:end] 일치 ⑥ enqueue(비인접 [합치기]
422·category_path 전달·원본 재저장 0) ⑦ hash12 재사용 안내 ⑧ split_analyze의 잡 목록·
취소·model 422(10번째 지점) ⑨ F46 사례 기록.
"""
from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from exceptions import ConflictError, NotFoundError, ValidationAppError
from services import convert_service as cs
from services import import_service, improve_service, preview_store, split_service


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
    """sources/·import/split/·improve/cases를 임시 경로로 격리(실제 프로젝트 데이터 무영향,
    F40-① 전례)."""
    sources_dir = tmp_path / "sources"
    split_dir = tmp_path / "import" / "split"
    sources_dir.mkdir(parents=True)
    monkeypatch.setattr(import_service, "SOURCES_DIR", sources_dir)
    monkeypatch.setattr(preview_store, "SOURCES_DIR", sources_dir)
    monkeypatch.setattr(split_service, "SPLIT_DIR", split_dir)
    monkeypatch.setattr(improve_service, "CASES_DIR", tmp_path / "improve" / "cases")
    monkeypatch.setattr(improve_service, "PROPOSALS_DIR", tmp_path / "improve" / "proposals")
    split_service._STATE.clear()
    yield
    split_service._STATE.clear()


@pytest.fixture()
def restore_queue_paused():
    yield
    cs.resume_queue()


def _drop_jobs(*job_ids: str) -> None:
    with cs._JOBS_LOCK:
        for jid in job_ids:
            cs._JOBS.pop(jid, None)


# ---------------------------------------------------------------------------
# ① 휴리스틱 후보·라벨·confidence
# ---------------------------------------------------------------------------
def test_scan_heuristic_boundaries_detects_subject_headers_as_strong_ok_confidence():
    text = (
        "머리말 안내문입니다.\n\n"
        "1과목 재료역학\n" + ("가" * 40) + "\n\n"
        "2과목 유체역학\n" + ("나" * 40)
    )
    candidates, confidence = split_service._scan_heuristic_boundaries(text)
    labels = [label for _, label in candidates]
    assert confidence == "ok"
    assert any("1과목" in label for label in labels)
    assert any("2과목" in label for label in labels)


def test_scan_heuristic_boundaries_true_number_reset_without_heading_is_weak_uncertain():
    """강한 신호 없이 문항 번호가 5 → 1로 "진짜" 리셋되는 경우만 약한 후보로 잡는다."""
    section1 = "\n".join(f"{i}. 문항 {i} 지문 " + ("가" * 200) for i in range(1, 6))
    section2 = "\n".join(f"{i}. 문항 {i} 지문 " + ("나" * 200) for i in range(1, 6))
    text = section1 + "\n" + section2
    candidates, confidence = split_service._scan_heuristic_boundaries(text)
    assert confidence == "uncertain"
    assert len(candidates) == 1  # section1→section2 전환의 리셋 지점 1개만


def test_scan_heuristic_boundaries_no_signal_is_uncertain_with_zero_candidates():
    text = "그냥 평범한 본문입니다. " * 100
    candidates, confidence = split_service._scan_heuristic_boundaries(text)
    assert confidence == "uncertain"
    assert candidates == []


def test_scan_heuristic_boundaries_ignores_indented_choice_markers_and_paren_format():
    """오케스트레이터 스모크 결함 회귀 고정(2026-08-04) — 재현: 회차 5개×문항 60개, 각 문항이
    "N. 지문…" 줄 + 들여쓴 "  1) 보기1  2) 보기2  3) 보기3  4) 보기4" 보기 줄로 구성된
    314,389자 표본이 회차 헤딩 5개 대신 조각 310개(회차 5 + 보기 줄 300개 오탐)로 쪼개지던
    결함. 보기 줄의 "1)"은 (a) 괄호 형식(마침표 아님) (b) 들여쓰기 2곳 모두에서 제외되어야
    한다."""

    def section(round_label: str, count: int) -> str:
        lines = [f"# {round_label} 기출문제"]
        for i in range(1, count + 1):
            lines.append(f"{i}. 문제 {i}번의 지문입니다. " + ("내용 텍스트 채움. " * 90))
            lines.append("  1) 보기1  2) 보기2  3) 보기3  4) 보기4")
        return "\n".join(lines)

    text = "\n\n".join(
        section(f"{2020 + i}년 {i + 1}회", 60) for i in range(5)
    )
    assert len(text) > split_service.CHUNK_MAX_CHARS  # 실사례와 같은 규모(20만 자 초과) 재현
    candidates, confidence = split_service._scan_heuristic_boundaries(text)
    assert confidence == "ok"
    assert len(candidates) == 5
    assert all("기출문제" in label for _, label in candidates)


def test_start_split_sample_five_rounds_sixty_questions_yields_five_chunks():
    """위 표본을 실제 `start_split` 파이프라인 전체(무결성 검증·상한 3종 포함)로 완주해도
    조각 5개·confidence ok로 끝나는지 확인(422 회귀 재발 방지)."""

    def section(round_label: str, count: int) -> str:
        lines = [f"# {round_label} 기출문제"]
        for i in range(1, count + 1):
            lines.append(f"{i}. 문제 {i}번의 지문입니다. " + ("내용 텍스트 채움. " * 90))
            lines.append("  1) 보기1  2) 보기2  3) 보기3  4) 보기4")
        return "\n".join(lines)

    text = "\n\n".join(section(f"{2020 + i}년 {i + 1}회", 60) for i in range(5))
    result = split_service.start_split(
        upload_filename="big-sample.txt", upload_bytes=text.encode("utf-8")
    )
    assert result["confidence"] == "ok"
    assert len(result["chunks"]) == 5
    for chunk in result["chunks"]:
        assert "기출문제" in chunk["label"]
        # 목표 3~6만 자 지시값에 정확히 부합(강제 상한 재분할이 필요 없는 크기).
        assert 30_000 <= chunk["chars"] <= 100_000


# ---------------------------------------------------------------------------
# ② 상한 3종 — 200만 자 · 40개 · 조각 20만 자(합치기 초과, ⑥과 공유)
# ---------------------------------------------------------------------------
def test_start_split_rejects_source_over_total_cap():
    data = ("a" * (split_service.TOTAL_MAX_CHARS + 1)).encode("utf-8")
    with pytest.raises(ValidationAppError) as exc_info:
        split_service.start_split(upload_filename="huge.txt", upload_bytes=data)
    assert "분할 반입 상한" in exc_info.value.message


def test_start_split_rejects_when_at_or_below_split_threshold():
    data = ("a" * split_service.CHUNK_MAX_CHARS).encode("utf-8")
    with pytest.raises(ValidationAppError) as exc_info:
        split_service.start_split(upload_filename="small.txt", upload_bytes=data)
    assert "분할이 필요 없는" in exc_info.value.message


def test_start_split_rejects_when_chunk_count_exceeds_max():
    sections = [f"{i + 1}과목 subject{i}\n" + ("x" * 6000) for i in range(41)]
    data = "\n\n".join(sections).encode("utf-8")
    assert len(data) > split_service.CHUNK_MAX_CHARS
    with pytest.raises(ValidationAppError) as exc_info:
        split_service.start_split(upload_filename="many.txt", upload_bytes=data)
    assert "조각 수가 상한" in exc_info.value.message


def test_normalize_chunks_over_chunk_cap_triggers_forced_equal_split():
    total = split_service.CHUNK_MAX_CHARS * 2 + 50_000  # 3조각으로 강제 분할되어야 함
    chunks = split_service._normalize_chunks([], total)
    assert len(chunks) == 3
    assert all(c["end"] - c["start"] <= split_service.CHUNK_MAX_CHARS for c in chunks)
    split_service._assert_full_coverage(chunks, total)


# ---------------------------------------------------------------------------
# ③ 조각 무결성 결정론 검증(오름차순·중첩 0·합집합·무라벨 구간 생성)
# ---------------------------------------------------------------------------
def test_normalize_chunks_fills_gap_with_auto_label_and_covers_full_range():
    cuts = [(100, "2과목"), (300, "3과목")]
    chunks = split_service._normalize_chunks(cuts, 500)
    assert [c["start"] for c in chunks] == [0, 100, 300]
    assert chunks[0]["label"] == "무라벨 구간 1"
    assert chunks[1]["label"] == "2과목"
    assert chunks[-1]["end"] == 500
    split_service._assert_full_coverage(chunks, 500)  # 예외 없이 통과해야 한다


def test_assert_full_coverage_rejects_overlap_and_gap_and_over_cap():
    with pytest.raises(ValidationAppError):
        split_service._assert_full_coverage(
            [{"start": 0, "end": 100}, {"start": 50, "end": 200}], 200
        )  # 중첩
    with pytest.raises(ValidationAppError):
        split_service._assert_full_coverage(
            [{"start": 0, "end": 50}, {"start": 100, "end": 200}], 200
        )  # 빠진 구간
    with pytest.raises(ValidationAppError):
        split_service._assert_full_coverage(
            [{"start": 0, "end": split_service.CHUNK_MAX_CHARS + 1}],
            split_service.CHUNK_MAX_CHARS + 1,
        )  # 조각당 상한 초과


# ---------------------------------------------------------------------------
# ④ 정밀 분석 산출 검증 — 후보 집합 밖 오프셋 = invalid_output
# ---------------------------------------------------------------------------
def _base_state(split_id: str, **overrides) -> dict:
    state = {
        "split_id": split_id,
        "created_at": dt.datetime.now().isoformat(),
        "source_filename": "x.txt",
        "source_hash12": "0" * 12,
        "source_chars": 1000,
        "confidence": "uncertain",
        "chunks": [],
        "heuristic_chunks": [],
        "status": "ready",
        "analyze_job_id": None,
        "analyze_estimate": {"approx_input_tokens": 100, "assumed": False},
        "duplicate_of": None,
        "head_sample": "a" * 100,
        "tail_sample": "b" * 100,
        "tail_start": 900,
        "allowed_ranges": [[0, 100], [900, 1000]],
        "boundary_excerpts": [],
    }
    state.update(overrides)
    return state


def test_apply_analyze_result_rejects_offset_outside_allowed_ranges():
    state = _base_state("spl_invalid_offset")
    split_service._remember_state(state)
    with pytest.raises(cs.InvalidLlmOutputError):
        split_service.apply_analyze_result(
            "spl_invalid_offset", [{"offset": 500, "label": "창작된 경계"}]
        )


def test_apply_analyze_result_rejects_non_list_and_non_int_offset():
    state = _base_state("spl_invalid_shape")
    split_service._remember_state(state)
    with pytest.raises(cs.InvalidLlmOutputError):
        split_service.apply_analyze_result("spl_invalid_shape", {"offset": 10, "label": "x"})
    with pytest.raises(cs.InvalidLlmOutputError):
        split_service.apply_analyze_result("spl_invalid_shape", [{"offset": "10", "label": "x"}])


def test_apply_analyze_result_accepts_offset_within_allowed_range_and_reextracts():
    data = ("x" * 1000).encode("utf-8")
    saved_name = import_service.save_source_file("x.txt", data)
    hash12 = saved_name.split("_", 1)[0]
    state = _base_state("spl_valid_offset", source_hash12=hash12, allowed_ranges=[[0, 50]])
    split_service._remember_state(state)
    chunks = split_service.apply_analyze_result(
        "spl_valid_offset", [{"offset": 30, "label": "확정 경계"}]
    )
    assert chunks[0]["start"] == 0
    assert chunks[-1]["end"] == 1000
    assert chunks[1]["label"] == "확정 경계"
    refreshed = split_service.get_state_or_404("spl_valid_offset")
    assert refreshed["status"] == "analyzed"


# ---------------------------------------------------------------------------
# ⑤ 재절단 = 원문[start:end] 일치 · ⑥ enqueue(비인접 [합치기] 422 · category_path ·
#    원본 재저장 0)
# ---------------------------------------------------------------------------
def _start_split_with_two_subjects() -> tuple[dict, str]:
    # 총 길이 > 200,000(분할 필요) · 조각당 길이 <= 200,000(강제 재분할 없이 정확히 2조각)
    body_a = "가" * 110_000
    body_b = "나" * 110_000
    text = f"1과목 재료역학\n{body_a}\n\n2과목 유체역학\n{body_b}"
    data = text.encode("utf-8")
    result = split_service.start_split(upload_filename="원본.txt", upload_bytes=data)
    return result, text


def test_enqueue_recut_matches_original_substring_exactly(db, restore_queue_paused):
    result, original_text = _start_split_with_two_subjects()
    cs.pause_queue()
    chunk = result["chunks"][0]
    try:
        out = split_service.enqueue_split(
            db, result["split_id"], selections=[[chunk["chunk_id"]]]
        )
        job_id = out["jobs"][0]["job_id"]
        with cs._JOBS_LOCK:
            uploaded_bytes = cs._JOBS[job_id]["_source_bytes"]
        expected = original_text[chunk["start"] : chunk["end"]].encode("utf-8")
        assert uploaded_bytes == expected
        _drop_jobs(job_id)
    finally:
        cs.resume_queue()


def test_enqueue_rejects_non_adjacent_merge_group():
    body = "가" * 80_000
    text = f"1과목 A\n{body}\n\n2과목 B\n{body}\n\n3과목 C\n{body}"
    result = split_service.start_split(upload_filename="세조각.txt", upload_bytes=text.encode("utf-8"))
    chunk_ids = [c["chunk_id"] for c in result["chunks"]]
    assert len(chunk_ids) == 3
    with pytest.raises(ValidationAppError) as exc_info:
        # 중간 조각(chunk_ids[1])을 건너뛴 비인접 조합 — [합치기]는 인접 구간만 허용된다.
        split_service.enqueue_split(
            None, result["split_id"], selections=[[chunk_ids[0], chunk_ids[2]]]
        )
    assert "인접" in exc_info.value.message


def test_enqueue_rejects_merge_result_over_chunk_cap(db, restore_queue_paused):
    """②·⑥ 공유 — [합치기] 결과가 조각당 상한(20만 자)을 초과하면 422."""
    body_a = "가" * 120_000
    body_b = "나" * 120_000
    text = f"1과목 재료역학\n{body_a}\n\n2과목 유체역학\n{body_b}"
    result = split_service.start_split(upload_filename="원본2.txt", upload_bytes=text.encode("utf-8"))
    chunk_ids = [c["chunk_id"] for c in result["chunks"]]
    assert len(chunk_ids) == 2
    with pytest.raises(ValidationAppError) as exc_info:
        split_service.enqueue_split(db, result["split_id"], selections=[chunk_ids])
    assert "상한" in exc_info.value.message


def test_enqueue_passes_category_path_by_representative_min_start_chunk_id(db, restore_queue_paused):
    result, _text = _start_split_with_two_subjects()
    cs.pause_queue()
    chunk_ids = [c["chunk_id"] for c in result["chunks"]]
    try:
        out = split_service.enqueue_split(
            db,
            result["split_id"],
            selections=[[chunk_ids[0]], [chunk_ids[1]]],
            category_paths={chunk_ids[0]: "품질경영기사/필기/2024년 1회"},
        )
        job_first = out["jobs"][0]["job_id"]
        job_second = out["jobs"][1]["job_id"]
        with cs._JOBS_LOCK:
            assert cs._JOBS[job_first]["_category_path"] == "품질경영기사/필기/2024년 1회"
            assert cs._JOBS[job_second]["_category_path"] is None
        _drop_jobs(job_first, job_second)
    finally:
        cs.resume_queue()


def test_enqueue_does_not_resave_chunk_text_as_new_source(db, restore_queue_paused):
    """§4.25 "조각 잡은 원본을 재저장하지 않는다" — enqueue 후 sources/에 원본 파일 1개만
    남아야 한다(조각 텍스트가 새 원본으로 저장되면 안 된다)."""
    result, _text = _start_split_with_two_subjects()
    cs.pause_queue()
    before = list(import_service.SOURCES_DIR.glob("*"))
    try:
        out = split_service.enqueue_split(
            db, result["split_id"], selections=[[c["chunk_id"]] for c in result["chunks"]]
        )
        after = list(import_service.SOURCES_DIR.glob("*"))
        assert len(after) == len(before)  # 새 파일이 추가되지 않았다
        job_ids = [j["job_id"] for j in out["jobs"]]
        with cs._JOBS_LOCK:
            for jid in job_ids:
                assert cs._JOBS[jid]["_skip_source_save"] is True
        _drop_jobs(*job_ids)
    finally:
        cs.resume_queue()


# ---------------------------------------------------------------------------
# ⑦ hash12 재사용 안내
# ---------------------------------------------------------------------------
def test_start_split_same_content_reuses_existing_split_id():
    data = ("1과목 x\n" + "가" * 110_000 + "\n\n2과목 y\n" + "나" * 110_000).encode("utf-8")
    first = split_service.start_split(upload_filename="a.txt", upload_bytes=data)
    assert first["reuse"] is None
    second = split_service.start_split(upload_filename="a.txt", upload_bytes=data)
    assert second["reuse"] == {"split_id": first["split_id"]}


# ---------------------------------------------------------------------------
# ⑧ split_analyze — 잡 목록·취소·model 422(10번째 지점)
# ---------------------------------------------------------------------------
def test_split_analyze_job_appears_in_job_list_with_split_id_ref():
    job = cs._new_job_base(
        "split_analyze", resolved_engine="claude-cli", requested_engine="claude-cli", model=None
    )
    job.update({"_split_id": "spl_abc", "_label": "『x.txt』 분할 정밀 분석"})
    job_id = "spa_test1"
    with cs._JOBS_LOCK:
        cs._JOBS[job_id] = job
    try:
        overview = cs.list_jobs_overview()
        item = next(i for i in overview["items"] if i["job_id"] == job_id)
        assert item["kind"] == "split_analyze"
        assert item["ref"] == {"split_id": "spl_abc"}
        assert item["label"] == "『x.txt』 분할 정밀 분석"
    finally:
        _drop_jobs(job_id)


def test_split_analyze_job_cancel_transitions_to_cancelled():
    job = cs._new_job_base(
        "split_analyze", resolved_engine="claude-cli", requested_engine="claude-cli", model=None
    )
    job.update({"_split_id": "spl_abc", "_label": "테스트"})
    job_id = "spa_test2"
    with cs._JOBS_LOCK:
        cs._JOBS[job_id] = job
    try:
        result = cs.cancel_job(job_id)
        assert result["status"] == "cancelled"
        with cs._JOBS_LOCK:
            assert cs._JOBS[job_id]["status"] == "cancelled"
    finally:
        _drop_jobs(job_id)


def test_split_analyze_model_outside_shortlist_rejects_with_422(db):
    state = _base_state("spl_model_422")
    split_service._remember_state(state)
    with pytest.raises(ValidationAppError):
        cs.start_split_analyze_job(
            db, split_id="spl_model_422", engine="claude-cli", model="not-a-real-model"
        )
    # 소목록 밖 model 검증은 잡 생성 전이라 잡이 큐에 남지 않아야 한다.
    with cs._JOBS_LOCK:
        assert not any(j.get("_split_id") == "spl_model_422" for j in cs._JOBS.values())


# ---------------------------------------------------------------------------
# ⑨ F46 사례 기록 — split_analyze 잡 실패(invalid_output)는 수집, too_large는 제외
# ---------------------------------------------------------------------------
def test_collect_job_failure_records_split_analyze_origin_for_invalid_output():
    improve_service.collect_job_failure(
        "split_analyze",
        {"kind": "invalid_output", "message": "m", "action": "a"},
        engine="claude-cli",
    )
    records, total = improve_service.list_cases(None, 1, 20)
    assert total == 1
    assert records[0]["origin"] == "split_analyze_job"
    assert records[0]["kind"] == "invalid_output"


def test_collect_job_failure_excludes_too_large_for_split_analyze():
    improve_service.collect_job_failure(
        "split_analyze",
        {"kind": "too_large", "message": "m", "action": "a"},
        engine="claude-cli",
    )
    _records, total = improve_service.list_cases(None, 1, 20)
    assert total == 0
