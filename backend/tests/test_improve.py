"""반입 자기 개선 루프 단위 테스트 (S20 — F46, 설계 §4.22, stage-20 §6 테스트 ①).

6군: ① 정책 잠금 ② 헝크 적용 ③ 제안 검증 게이트 ④ 수집 ⑤ 사례집 ⑥ 회귀 무흔적.

전부 순수 함수·파일 IO 수준에서 검증한다 — 실제 LLM 호출은 하지 않는다(잡 큐 워커·엔진
실행은 이 테스트의 대상이 아니다). `improve/`·`prompts/convert.md`(테스트용 사본)는
`monkeypatch`로 임시 경로에 격리해 실제 프로젝트 파일을 건드리지 않는다.
"""
from __future__ import annotations

import datetime as dt
import json

import pytest

from database import BASE_DIR
from exceptions import ConflictError, NotFoundError, ValidationAppError
from services import convert_service, import_service, improve_service, preview_store

SAMPLE_CONVERT_MD = (
    "# 샘플 프롬프트\n\n"
    "## 0. 역할\n"
    "일반 지시문 A(자유롭게 수정 가능)\n\n"
    "<!-- policy-lock:start -->\n"
    "정책 문장 1 — 창작 금지.\n"
    "<!-- policy-lock:end -->\n\n"
    "## 1. 형식\n"
    "일반 지시문 B(자유롭게 수정 가능)\n\n"
    "<!-- policy-lock:start -->\n"
    "정책 문장 2 — 순수 JSON.\n"
    "<!-- policy-lock:end -->\n"
)


@pytest.fixture()
def isolated_dirs(tmp_path, monkeypatch):
    """`improve/cases`·`improve/proposals`를 임시 폴더로 격리(실제 프로젝트 데이터 무영향)."""
    cases_dir = tmp_path / "cases"
    proposals_dir = tmp_path / "proposals"
    monkeypatch.setattr(improve_service, "CASES_DIR", cases_dir)
    monkeypatch.setattr(improve_service, "PROPOSALS_DIR", proposals_dir)
    return tmp_path


@pytest.fixture()
def isolated_prompt(tmp_path, monkeypatch):
    """`convert.md`·`convert.cases.md`를 임시 사본으로 격리(실제 프롬프트 파일 무변경)."""
    convert_md = tmp_path / "convert.md"
    casebook = tmp_path / "convert.cases.md"
    convert_md.write_text(SAMPLE_CONVERT_MD, encoding="utf-8")
    monkeypatch.setattr(improve_service, "CONVERT_PROMPT_PATH", convert_md)
    monkeypatch.setattr(improve_service, "CASEBOOK_PATH", casebook)
    return convert_md, casebook


def _write_case_record(case_id: str, **overrides) -> dict:
    base = {
        "case_id": case_id,
        "created_at": overrides.pop("created_at", dt.datetime.now().isoformat()),
        "origin": "convert_job",
        "kind": "invalid_output",
        "count": 1,
        "last_seen_at": dt.datetime.now().isoformat(),
        "engine": "claude-cli",
        "source": None,
        "document": None,
        "preview_ref": None,
        "detail": {},
        "llm_output_path": None,
        "regressions": [],
    }
    base.update(overrides)
    improve_service._ensure_dirs()
    improve_service._write_json(improve_service._case_path(case_id), base)
    return base


def _write_proposal_record(proposal_id: str, **overrides) -> dict:
    base = {
        "proposal_id": proposal_id,
        "kind": "casebook",
        "title": "샘플 제안",
        "rationale": "이유",
        "case_ids": ["fc_aaaaaa"],
        "payload": {"entry_markdown": "예시 처리"},
        "status": "pending",
        "created_at": overrides.pop("created_at", dt.datetime.now().isoformat()),
        "decided_at": None,
    }
    base.update(overrides)
    improve_service._ensure_dirs()
    improve_service._write_json(improve_service._proposal_path(proposal_id), base)
    return base


# ===========================================================================
# ① 정책 잠금 — 잠금 구간 접촉 헝크 폐기·apply 422·마커 소실/개수 변경 검출·잠금 밖 통과
# ===========================================================================
def test_real_convert_md_has_balanced_lock_markers():
    """실제 `prompts/convert.md`(수정 대상 원본) — 마커 쌍이 맞고 6개 구간이 비어있지 않다."""
    text = (BASE_DIR / "prompts" / "convert.md").read_text(encoding="utf-8")
    regions = improve_service.extract_lock_regions(text)
    assert len(regions) == 6
    assert all(r.strip() for r in regions)


def test_check_policy_lock_true_when_unchanged():
    assert improve_service.check_policy_lock(SAMPLE_CONVERT_MD, SAMPLE_CONVERT_MD) is True


def test_check_policy_lock_false_when_lock_content_changed():
    tampered = SAMPLE_CONVERT_MD.replace("정책 문장 1 — 창작 금지.", "정책 문장 1 — 완화됨.")
    assert improve_service.check_policy_lock(SAMPLE_CONVERT_MD, tampered) is False


def test_check_policy_lock_false_when_marker_count_changed():
    """마커 하나가 사라지면(개수 불일치) 위반으로 판정한다."""
    tampered = SAMPLE_CONVERT_MD.replace("<!-- policy-lock:end -->\n\n## 1. 형식", "## 1. 형식", 1)
    assert improve_service.check_policy_lock(SAMPLE_CONVERT_MD, tampered) is False


def test_check_policy_lock_true_when_only_outside_lock_changed():
    changed = SAMPLE_CONVERT_MD.replace("일반 지시문 A(자유롭게 수정 가능)", "일반 지시문 A(수정됨)")
    assert improve_service.check_policy_lock(SAMPLE_CONVERT_MD, changed) is True


def test_validate_proposals_discards_hunk_touching_lock_region(isolated_prompt):
    raw = [
        {
            "kind": "prompt_edit",
            "title": "정책 완화 시도",
            "rationale": "…",
            "case_ids": ["fc_aaaaaa"],
            "payload": {"hunks": [{"before": "정책 문장 1 — 창작 금지.", "after": "정책 문장 1 — 완화."}]},
        }
    ]
    passed, discarded = improve_service.validate_proposals(raw, ["fc_aaaaaa"])
    assert passed == []
    assert discarded == {"policy_locked": 1}


def test_validate_proposals_passes_hunk_outside_lock_region(isolated_prompt):
    raw = [
        {
            "kind": "prompt_edit",
            "title": "지시문 A 보강",
            "rationale": "…",
            "case_ids": ["fc_aaaaaa"],
            "payload": {
                "hunks": [
                    {
                        "before": "일반 지시문 A(자유롭게 수정 가능)",
                        "after": "일반 지시문 A(보강된 지시)",
                    }
                ]
            },
        }
    ]
    passed, discarded = improve_service.validate_proposals(raw, ["fc_aaaaaa"])
    assert discarded == {}
    assert len(passed) == 1


def test_apply_proposal_prompt_edit_touching_lock_is_422(isolated_dirs, isolated_prompt):
    pid = "pr_000001"
    _write_proposal_record(
        pid,
        kind="prompt_edit",
        payload={"hunks": [{"before": "정책 문장 2 — 순수 JSON.", "after": "정책 문장 2 — 자유 형식."}]},
    )
    with pytest.raises(ValidationAppError):
        improve_service.apply_proposal(pid)
    convert_md, _casebook = isolated_prompt
    # 실패 시 파일 무변경(부분 적용 없음)
    assert convert_md.read_text(encoding="utf-8") == SAMPLE_CONVERT_MD


def test_apply_proposal_prompt_edit_outside_lock_succeeds(isolated_dirs, isolated_prompt):
    pid = "pr_000002"
    _write_proposal_record(
        pid,
        kind="prompt_edit",
        payload={
            "hunks": [
                {"before": "일반 지시문 B(자유롭게 수정 가능)", "after": "일반 지시문 B(개선됨)"}
            ]
        },
    )
    result = improve_service.apply_proposal(pid)
    assert result["applied"] is True
    convert_md, _casebook = isolated_prompt
    new_text = convert_md.read_text(encoding="utf-8")
    assert "일반 지시문 B(개선됨)" in new_text
    # 잠금 구간 내용은 그대로다(정책 문장 무변경)
    assert improve_service.check_policy_lock(SAMPLE_CONVERT_MD, new_text) is True
    record = improve_service.get_proposal_or_404(pid)
    assert record["status"] == "applied"


# ===========================================================================
# ② 헝크 적용 — 정확 1회 일치 적용·0회/2회+ 거부
# ===========================================================================
def test_apply_hunks_exact_one_match_applies():
    text = "A B C"
    result, reason = improve_service.apply_hunks(text, [{"before": "B", "after": "X"}])
    assert result == "A X C"
    assert reason is None


def test_apply_hunks_zero_matches_rejected():
    text = "A B C"
    result, reason = improve_service.apply_hunks(text, [{"before": "Z", "after": "X"}])
    assert result is None
    assert reason == "hunk_unappliable"


def test_apply_hunks_multiple_matches_rejected():
    text = "A B A"
    result, reason = improve_service.apply_hunks(text, [{"before": "A", "after": "X"}])
    assert result is None
    assert reason == "hunk_unappliable"


# ===========================================================================
# ③ 제안 검증 게이트 — kind 화이트리스트·case_ids 범위 밖 폐기·통과 0건=잡 실패·파일 무변경
# ===========================================================================
def test_validate_proposals_invalid_kind_discarded(isolated_prompt):
    raw = [{"kind": "delete_everything", "title": "t", "rationale": "r", "case_ids": ["fc_aaaaaa"], "payload": {"x": 1}}]
    passed, discarded = improve_service.validate_proposals(raw, ["fc_aaaaaa"])
    assert passed == []
    assert discarded == {"invalid_kind": 1}


def test_validate_proposals_bad_case_ref_discarded(isolated_prompt):
    raw = [
        {
            "kind": "casebook",
            "title": "t",
            "rationale": "r",
            "case_ids": ["fc_ffffff"],  # 요청 집합 밖
            "payload": {"entry_markdown": "예시"},
        }
    ]
    passed, discarded = improve_service.validate_proposals(raw, ["fc_aaaaaa"])
    assert passed == []
    assert discarded == {"bad_case_ref": 1}


def test_validate_proposals_all_discarded_means_no_file_written(isolated_dirs, isolated_prompt):
    raw = [{"kind": "bogus", "title": "t", "rationale": "r", "case_ids": ["fc_aaaaaa"], "payload": {}}]
    passed, discarded = improve_service.validate_proposals(raw, ["fc_aaaaaa"])
    assert passed == []
    assert discarded == {"invalid_kind": 1}
    ids = improve_service.save_proposals(passed)
    assert ids == []
    assert improve_service._list_proposal_files() == []


def test_validate_proposals_valid_casebook_passes(isolated_prompt):
    raw = [
        {
            "kind": "casebook",
            "title": "표 깨짐 처리 예시",
            "rationale": "…",
            "case_ids": ["fc_aaaaaa"],
            "payload": {"entry_markdown": "표가 깨지면 (원본 확인 필요)로 표시"},
        }
    ]
    passed, discarded = improve_service.validate_proposals(raw, ["fc_aaaaaa"])
    assert discarded == {}
    assert len(passed) == 1
    assert passed[0]["kind"] == "casebook"


def test_validate_proposals_hunk_unappliable_discarded(isolated_prompt):
    raw = [
        {
            "kind": "prompt_edit",
            "title": "t",
            "rationale": "r",
            "case_ids": ["fc_aaaaaa"],
            "payload": {"hunks": [{"before": "존재하지 않는 문자열", "after": "x"}]},
        }
    ]
    passed, discarded = improve_service.validate_proposals(raw, ["fc_aaaaaa"])
    assert passed == []
    assert discarded == {"hunk_unappliable": 1}


# ===========================================================================
# ④ 수집 — 대상 kind만 수집·중복 count 병합·프루닝 50건·pending 최후
# ===========================================================================
def test_collect_job_failure_collects_target_kind(isolated_dirs):
    improve_service.collect_job_failure(
        "convert",
        {"kind": "invalid_output", "message": "m", "action": "a"},
        engine="claude-cli",
        source_filename="a.pdf",
        source_bytes=b"hello world",
        output_text="broken json",
    )
    files = improve_service._list_case_files()
    assert len(files) == 1
    record = improve_service._read_json(files[0])
    assert record["kind"] == "invalid_output"
    assert record["origin"] == "convert_job"
    assert record["llm_output_path"] == f"{record['case_id']}.output.txt"
    assert improve_service._case_output_path(record["case_id"]).read_text(encoding="utf-8") == "broken json"


@pytest.mark.parametrize("excluded_kind", ["too_large", "rate_limit", "auth", "not_installed", "timeout", "other"])
def test_collect_job_failure_ignores_non_target_kinds(isolated_dirs, excluded_kind):
    improve_service.collect_job_failure(
        "convert", {"kind": excluded_kind, "message": "m", "action": "a"}, source_bytes=b"data"
    )
    assert improve_service._list_case_files() == []


def test_collect_job_failure_dedup_merges_count(isolated_dirs):
    for _ in range(2):
        improve_service.collect_job_failure(
            "fetch",
            {"kind": "parse_failed", "message": "m", "action": "a"},
            source_filename="same.pdf",
            source_bytes=b"same-bytes",
        )
    files = improve_service._list_case_files()
    assert len(files) == 1
    record = improve_service._read_json(files[0])
    assert record["count"] == 2


def test_collect_job_failure_best_effort_never_raises(isolated_dirs, monkeypatch):
    def _boom(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(improve_service, "_record_case", _boom)
    # 예외를 삼킨다 — 원 플로우(잡 실패 처리)에 영향 없음
    improve_service.collect_job_failure(
        "convert", {"kind": "invalid_output", "message": "m", "action": "a"}, source_bytes=b"x"
    )


def test_prune_cases_removes_oldest_first(isolated_dirs):
    now = dt.datetime.now()
    for i in range(7):
        _write_case_record(f"fc_{i:06x}", created_at=(now + dt.timedelta(seconds=i)).isoformat())
    improve_service._prune_cases(keep=5)
    remaining = {improve_service._read_json(p)["case_id"] for p in improve_service._list_case_files()}
    assert remaining == {f"fc_{i:06x}" for i in range(2, 7)}  # 0·1(가장 오래됨)이 삭제됨


def test_prune_proposals_decided_removed_before_pending(isolated_dirs):
    now = dt.datetime.now()
    # pending 2건(오래됨) + applied 3건(최신) — 총 5건, keep=3이면 applied부터 지워야 한다
    _write_proposal_record("pr_p1", status="pending", created_at=(now - dt.timedelta(minutes=10)).isoformat())
    _write_proposal_record("pr_p2", status="pending", created_at=(now - dt.timedelta(minutes=9)).isoformat())
    _write_proposal_record("pr_a1", status="applied", created_at=(now - dt.timedelta(minutes=3)).isoformat())
    _write_proposal_record("pr_a2", status="rejected", created_at=(now - dt.timedelta(minutes=2)).isoformat())
    _write_proposal_record("pr_a3", status="acknowledged", created_at=(now - dt.timedelta(minutes=1)).isoformat())

    improve_service._prune_proposals(keep=3)
    remaining_ids = {improve_service._read_json(p)["proposal_id"] for p in improve_service._list_proposal_files()}
    # pending 2건은 끝까지 보존, decided 3건 중 2건이 삭제되어 1건만 남는다
    assert {"pr_p1", "pr_p2"} <= remaining_ids
    assert len(remaining_ids) == 3


# ===========================================================================
# ⑤ 사례집 — append·20,000자 상한 422·주입 조립
# ===========================================================================
def test_apply_proposal_casebook_appends_and_creates_file(isolated_dirs, isolated_prompt):
    _convert_md, casebook = isolated_prompt
    assert not casebook.exists()
    pid = "pr_cb01"
    _write_proposal_record(
        pid,
        kind="casebook",
        case_ids=["fc_aaaaaa"],
        title="표 깨짐 처리",
        payload={"entry_markdown": "표가 깨지면 (원본 확인 필요)로 표시한다."},
    )
    result = improve_service.apply_proposal(pid)
    assert result["applied"] is True
    assert casebook.exists()
    text = casebook.read_text(encoding="utf-8")
    assert "표가 깨지면 (원본 확인 필요)로 표시한다." in text
    assert "fc_aaaaaa" in text
    record = improve_service.get_proposal_or_404(pid)
    assert record["status"] == "applied"


def test_apply_proposal_casebook_over_limit_is_422(isolated_dirs, isolated_prompt):
    _convert_md, casebook = isolated_prompt
    casebook.write_text("x" * (improve_service.CASEBOOK_MAX_CHARS - 10), encoding="utf-8")
    pid = "pr_cb02"
    _write_proposal_record(
        pid, kind="casebook", case_ids=["fc_aaaaaa"], payload={"entry_markdown": "y" * 1000}
    )
    with pytest.raises(ValidationAppError):
        improve_service.apply_proposal(pid)
    # 실패 시 파일 무변경
    assert casebook.read_text(encoding="utf-8") == "x" * (improve_service.CASEBOOK_MAX_CHARS - 10)


def test_load_convert_prompt_with_casebook_injects_section(isolated_prompt):
    convert_md, casebook = isolated_prompt
    # 사례집이 없으면 본문 그대로
    assert improve_service.load_convert_prompt_with_casebook() == SAMPLE_CONVERT_MD

    casebook.write_text("## 사례 fc_aaaaaa: 예시\n\n표 깨짐은 (원본 확인 필요)", encoding="utf-8")
    injected = improve_service.load_convert_prompt_with_casebook()
    assert injected.startswith(SAMPLE_CONVERT_MD)
    assert "부속 사례집" in injected
    assert "표 깨짐은 (원본 확인 필요)" in injected


def test_load_convert_prompt_with_casebook_empty_file_not_injected(isolated_prompt):
    convert_md, casebook = isolated_prompt
    casebook.write_text("   \n", encoding="utf-8")  # 공백뿐 — "비어 있음"
    assert improve_service.load_convert_prompt_with_casebook() == SAMPLE_CONVERT_MD


# ===========================================================================
# ⑥ 회귀 무흔적 — preview 미등록·DB 무변경·regressions append
# ===========================================================================
def test_regression_run_case_source_missing_is_unavailable(isolated_dirs):
    record = _write_case_record(
        "fc_nosrc1", kind="parse_failed", source={"path": None, "hash12": "0" * 12, "filename": "x.pdf"}
    )
    job = {"_engine": "claude-cli", "_timeout": 5, "_extra_tmp_paths": []}
    preview_cache_before = dict(import_service._PREVIEW_CACHE)
    outcome, detail = convert_service._regression_run_case("job1", job, record)
    assert outcome == "unavailable"
    assert isinstance(detail, str) and detail  # 프론트 렌더 계약 — 문자열(dict 아님)
    # preview 미등록 확인 — 회귀 실행 전후로 캐시가 그대로다
    assert import_service._PREVIEW_CACHE == preview_cache_before


def test_regression_run_case_no_source_field_is_unavailable(isolated_dirs):
    record = _write_case_record("fc_nosrc2", kind="invalid_output", source=None)
    job = {"_engine": "claude-cli", "_timeout": 5, "_extra_tmp_paths": []}
    outcome, detail = convert_service._regression_run_case("job2", job, record)
    assert outcome == "unavailable"


def test_append_regression_appends_case_file_only(isolated_dirs):
    record = _write_case_record("fc_reg001")
    improve_service.append_regression("fc_reg001", reg_id="rg_test01", outcome="passed")
    updated = improve_service.get_case_or_404("fc_reg001")
    assert len(updated["regressions"]) == 1
    assert updated["regressions"][0]["outcome"] == "passed"
    assert updated["regressions"][0]["reg_id"] == "rg_test01"


def test_append_regression_missing_case_is_noop(isolated_dirs):
    # 존재하지 않는 사례 — 예외 없이 조용히 무시(best-effort 기록 지점)
    improve_service.append_regression("fc_ghost01", reg_id="rg_x", outcome="passed")
    with pytest.raises(NotFoundError):
        improve_service.get_case_or_404("fc_ghost01")


def test_prepare_regression_rejects_user_report(isolated_dirs):
    _write_case_record("fc_rep0001", kind="user_report", origin="report")
    with pytest.raises(ValidationAppError):
        improve_service.prepare_regression(["fc_rep0001"])


def test_prepare_regression_missing_case_is_422(isolated_dirs):
    with pytest.raises(ValidationAppError):
        improve_service.prepare_regression(["fc_absent1"])


# ===========================================================================
# 부가 — 제안함 상태 전이(pending 아니면 409), 사례 삭제(부속 output 동반 삭제)
# ===========================================================================
def test_apply_proposal_twice_is_conflict(isolated_dirs, isolated_prompt):
    pid = "pr_twice1"
    _write_proposal_record(pid, kind="casebook", payload={"entry_markdown": "예시"})
    improve_service.apply_proposal(pid)
    with pytest.raises(ConflictError):
        improve_service.apply_proposal(pid)


def test_reject_pending_then_apply_is_conflict(isolated_dirs, isolated_prompt):
    pid = "pr_rej0001"
    _write_proposal_record(pid, kind="casebook", payload={"entry_markdown": "예시"})
    improve_service.reject_proposal(pid)
    with pytest.raises(ConflictError):
        improve_service.apply_proposal(pid)


def test_delete_case_removes_output_sidecar(isolated_dirs):
    case_id = "fc_outp01"
    _write_case_record(case_id, llm_output_path=f"{case_id}.output.txt")
    improve_service._case_output_path(case_id).write_text("raw", encoding="utf-8")
    improve_service.delete_case(case_id)
    assert not improve_service._case_path(case_id).exists()
    assert not improve_service._case_output_path(case_id).exists()


# ===========================================================================
# Opus 검토 경미 결함 수정분 (2026-08-02, 사용자 승인) — ③ invalid_output 안내 문구 분기
# 누락 · ⑥ 회귀 판정이 '대조 불가'를 passed로 오기록 · ⑦ hash12 없는 사례의 과대 병합
# ===========================================================================


# --- ③ improve 잡의 invalid_output 안내 문구 분기 ---------------------------------
def test_invalid_output_action_improve_proposal_branch_has_no_source_wording():
    """제안 생성엔 '원본'이 없다 — 반입(convert·fetch)용 "과목·회차 단위로 나눠 올리기"
    문구가 나오면 오안내(검토 지적 ③)."""
    truncated_action = convert_service._invalid_output_action(truncated=True, job_kind="improve_proposal")
    plain_action = convert_service._invalid_output_action(truncated=False, job_kind="improve_proposal")
    assert "원본" not in truncated_action
    assert "원본" not in plain_action
    assert "사례" in truncated_action
    assert "사례" in plain_action


def test_invalid_output_action_improve_regression_branch_has_no_source_wording():
    action = convert_service._invalid_output_action(truncated=False, job_kind="improve_regression")
    assert "원본" not in action
    assert "사례" in action


def test_fallback_error_info_improve_proposal_all_discarded_action_is_accurate():
    """'전량 폐기'는 같은 사례로 재시도해도 검증 게이트 결과가 같은 결정론적 실패다 —
    "잠시 후 다시 시도하세요"는 오안내(검토 지적 ③ 부수 지적). error_info 구조(kind 포함)는
    불변, action 문구만 사례 조정 안내로 바뀐다."""
    exc = ValidationAppError("생성된 제안 전체가 검증에서 폐기되었습니다 — 허용되지 않는 kind 1건.")
    info = convert_service._fallback_error_info(exc, job_kind="improve_proposal")
    assert info["kind"] == "other"  # §4.11 kind 집합 불변
    assert info["action"] != "잠시 후 다시 시도하세요."
    assert "사례" in info["action"]


def test_fallback_error_info_other_job_kinds_action_unchanged():
    """부수 지적 수정이 improve_proposal 외 잡 종류의 기존 문구를 건드리지 않았는지 확인."""
    exc = ValidationAppError("알 수 없는 오류")
    info = convert_service._fallback_error_info(exc, job_kind="convert")
    assert info["action"] == "잠시 후 다시 시도하세요."


# --- ⑥ 회귀 판정 — 대조 불가는 unavailable로, passed로 오기록하지 않는다 -------------------
def test_regression_gate_case_short_source_reports_unavailable_not_passed(tmp_path, monkeypatch):
    """검토자 실측 재현: 정규화 <200자 원본(대조 불가) + 명백한 창작 산출 → 종전엔 `passed`
    ("창작 의심 재발 없음")로 잘못 기록됐다. 원문 대조를 시도조차 못 한 상태이므로
    `unavailable`로 정직하게 기록해야 한다(R23 ③ 회귀 수치 신뢰)."""
    monkeypatch.setattr(convert_service, "CONVERT_TMP_DIR", tmp_path)

    short_source_text = "가" * 150  # 정규화 150자 — MIN_SOURCE_NORM_CHARS(200) 미만
    short_source_bytes = short_source_text.encode("utf-8")
    monkeypatch.setattr(preview_store, "read_source_bytes", lambda hash12: short_source_bytes)

    fabricated_json = json.dumps(
        {
            "documents": [
                {
                    "type": "question",
                    "title": "제목",
                    "content": "완전히 다른 창작된 지문 — 원본과 무관한 내용입니다",
                    "answer": "1",
                    "answer_source": "solved",
                }
            ]
        },
        ensure_ascii=False,
    )
    monkeypatch.setattr(
        convert_service,
        "_run_claude_cli_streaming",
        lambda prompt, *, timeout_seconds, job_id: fabricated_json,
    )

    record = {
        "case_id": "fc_short01",
        "kind": "fabrication_suspect",
        "origin": "gate",
        "source": {"path": "x", "hash12": "a" * 12, "filename": "short.txt"},
    }
    job = {"_engine": "claude-cli", "_timeout": 5, "_extra_tmp_paths": []}

    outcome, detail = convert_service._regression_run_case("job_short", job, record)

    assert outcome == "unavailable"
    assert isinstance(detail, str) and "대조 불가" in detail
    # 회귀했다면 이 값이 True(사실은 대조 불가일 뿐 재발 여부를 알 수 없다)로 잘못 나온다 —
    # 판정 자체가 unavailable이므로 fabrication 여부를 outcome에 반영하지 않았는지 확인.
    assert outcome != "passed"
    assert outcome != "still_failing"


# --- ⑦ hash12 없는 사례의 과대 병합 방지 -------------------------------------------
def test_collect_gate_case_without_hash12_uses_preview_ref_to_avoid_merge(isolated_dirs):
    """FetchedExam(큐넷 구조화 텍스트 — 원본 파일이 없어 source_bytes가 없음) 경로의 서로
    다른 회차 실패가 kind별 1건으로 합쳐지면 안 된다(검토 지적 ⑦)."""
    improve_service.collect_gate_case(
        source_filename=None,
        source_bytes=None,
        item_indices=[0],
        total_items=1,
        preview_ref="imp_aaa1111__nosrc__2023년1회.json",
    )
    improve_service.collect_gate_case(
        source_filename=None,
        source_bytes=None,
        item_indices=[0],
        total_items=1,
        preview_ref="imp_bbb2222__nosrc__2023년2회.json",
    )
    files = improve_service._list_case_files()
    assert len(files) == 2
    kinds_refs = {improve_service._read_json(f)["preview_ref"] for f in files}
    assert kinds_refs == {
        "imp_aaa1111__nosrc__2023년1회.json",
        "imp_bbb2222__nosrc__2023년2회.json",
    }


def test_collect_gate_case_without_hash12_same_preview_ref_still_merges(isolated_dirs):
    """대체 식별자(preview_ref)가 같으면 기존처럼 count 병합이 동작해야 한다(과잉 분리 방지)."""
    for _ in range(2):
        improve_service.collect_gate_case(
            source_filename=None,
            source_bytes=None,
            item_indices=[0],
            total_items=1,
            preview_ref="imp_ccc3333__nosrc__같은회차.json",
        )
    files = improve_service._list_case_files()
    assert len(files) == 1
    assert improve_service._read_json(files[0])["count"] == 2


def test_collect_gate_case_without_hash12_or_preview_ref_falls_back_to_legacy_merge(isolated_dirs):
    """대체 식별자마저 없으면 기존 동작(과대 병합) 유지가 명시적으로 허용된다."""
    for _ in range(2):
        improve_service.collect_gate_case(
            source_filename=None, source_bytes=None, item_indices=[0], total_items=1, preview_ref=None
        )
    files = improve_service._list_case_files()
    assert len(files) == 1
    assert improve_service._read_json(files[0])["count"] == 2
