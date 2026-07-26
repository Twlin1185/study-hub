"""cbtbank.kr 어댑터 파싱 단위 테스트 (S12, 설계 §4.13).

DB·네트워크 없이 고정 HTML 조각(2026-07-26 실측 구조 축약본)으로 `list_exams`·
`fetch_exam` 파싱만 검증한다. `client`는 `get_text`만 흉내 내는 페이크로 대체하고,
사이트맵 조회가 필요한 `_cert_name`은 몽키패치로 건너뛴다(순수 파싱 로직 검증에 집중).
"""
from __future__ import annotations

from services.fetchers import cbtbank
from services.fetchers.base import FetchedExam, ParseFailedError

CATEGORY_HTML = """
<div class="row"><div class="col p-2 text-primary" style="font-weight:600">
<a href="/cbt-test-form/테스트자격증">CBT 모의시험</a></div></div>
<div class="row"><div class="col p-2 text-primary"><a href="/exam/bp20220424">테스트자격증 (2022-04-24)</a></div></div>
<div class="row"><div class="col p-2 text-primary"><a href="/exam/bp20210307">테스트자격증 (2021-03-07)</a></div></div>
"""

EXAM_HTML = """
<html><head><title>테스트자격증 2022-04-24 필기 기출문제 CBT 및 해설 - CBT문제은행</title></head>
<body>
<div class="row exam-class-title"><div class="col">
<p class="text-center text-dark">1과목: 과목A</p></div></div>
<div class="row text-dark"><div tabindex="0" class="col-12 exam-box exam-left" id="#bp20220424-1"
question-id="bp20220424-1" question-num="1">
<div class="row"><div class="col-12"><p class="exam-title"><span class="exam-number">1</span>. 문제내용<img src="/images/bp/bp20220424/bp20220424m1.gif"></p></div></div>
<div class="row"><div class="col-12 question-choice"><ol class="circlednumbers" correct="2">
<li>보기1</li><li class="correct">보기2</li><li>보기3</li><li>보기4</li></ol></div></div>
<div class="reply collapse"><ul class="view-reply">
<li class='reply-item a' data-info='id:1,depth:0,exam_id:bp20220424-1'>
<div class='btn-toolbar reply-name'><div class='media-body'><div class='mar-btm'>
<a class='btn-link media-heading'><span class='nick'>CBT문제은행AI</span></a></div></div></div>
<div class='reply-comment'>정답은 보기2입니다.</div></li>
<li class='reply-item b' data-info='id:2,depth:0,exam_id:bp20220424-1'>
<div class='btn-toolbar reply-name'><div class='media-body'><div class='mar-btm'>
<a class='btn-link media-heading'><span class='nick'>다른사용자</span></a></div></div></div>
<div class='reply-comment'>이 댓글은 무시되어야 한다.</div></li>
</ul></div>
</div>
<div class="row exam-class-title"><div class="col">
<p class="text-center text-dark">2과목: 과목B</p></div></div>
<div class="row text-dark"><div tabindex="0" class="col-12 exam-box exam-left" id="#bp20220424-2"
question-id="bp20220424-2" question-num="2">
<div class="row"><div class="col-12"><p class="exam-title"><span class="exam-number">2</span>. 두번째 문제<br>줄바꿈 포함</p></div></div>
<div class="row"><div class="col-12 question-choice"><ol class="circlednumbers" correct="1">
<li class="correct">A</li><li>B</li><li>C</li><li>D</li></ol></div></div>
<div class="reply collapse"><ul class="view-reply">
<li class='reply-item c' data-info='id:3,depth:0,exam_id:bp20220424-2'>
<div class='btn-toolbar reply-name'><div class='media-body'><div class='mar-btm'>
<a class='btn-link media-heading'><span class='nick'>CBT문제은행AI</span></a></div></div></div>
<div class='reply-comment'>두번째 해설입니다.</div></li>
</ul></div>
</div>
</body></html>
"""


class _FakeClient:
    def __init__(self, text: str) -> None:
        self._text = text

    def get_text(self, url: str) -> str:
        return self._text

    def can_fetch(self, url: str) -> bool:
        return True


def test_list_exams_parses_label_and_date(monkeypatch):
    adapter = cbtbank.CbtbankAdapter()
    monkeypatch.setattr(adapter, "_cert_name", lambda client, ref: "테스트자격증")
    entries = adapter.list_exams("테스트자격증", _FakeClient(CATEGORY_HTML))
    assert [e.exam_key for e in entries] == ["2022-04-24", "2021-03-07"]  # 최신순
    first = entries[0]
    assert first.exam_ref == "bp20220424"
    assert first.exam_date == "2022-04-24"
    assert first.label == "테스트자격증 (2022-04-24)"
    assert first.level_hint == "필기"


def test_fetch_exam_extracts_questions_subjects_choices_answer_images(monkeypatch):
    adapter = cbtbank.CbtbankAdapter()
    monkeypatch.setattr(adapter, "_cert_name", lambda client, ref: "테스트자격증")
    result = adapter.fetch_exam("테스트자격증", "bp20220424", _FakeClient(EXAM_HTML))

    assert isinstance(result, FetchedExam)
    assert result.cert_name == "테스트자격증"
    assert result.exam_key == "2022-04-24"
    assert result.level_hint == "필기"
    # <title> 원문("- CBT문제은행" 접미 등) 대신 직접 구성 — 경검 3
    assert result.exam_label == "테스트자격증 2022-04-24 필기 기출문제"
    assert len(result.questions) == 2

    q1, q2 = result.questions
    assert q1.no == 1
    # "N과목: " 접두 제거 — 순수 과목명만(직렬화 중복 방지, 경검 2)
    assert q1.subject == "과목A"
    assert q1.choices == ["보기1", "보기2", "보기3", "보기4"]
    assert q1.answer == "2"  # correct="2" (1-based)
    assert q1.images == ["https://cbtbank.kr/images/bp/bp20220424/bp20220424m1.gif"]
    # AI(CBT문제은행AI) 댓글만 해설로 채택 — 다른 사용자 댓글은 무시
    assert q1.explanation == "정답은 보기2입니다."

    assert q2.no == 2
    assert q2.subject == "과목B"
    assert q2.choices == ["A", "B", "C", "D"]
    assert q2.answer == "1"
    assert q2.explanation == "두번째 해설입니다."
    assert q2.images == []

    assert result.note == "cbtbank · https://cbtbank.kr/exam/bp20220424"


def test_fetch_exam_raises_parse_failed_when_no_questions(monkeypatch):
    adapter = cbtbank.CbtbankAdapter()
    monkeypatch.setattr(adapter, "_cert_name", lambda client, ref: "테스트자격증")
    try:
        adapter.fetch_exam("테스트자격증", "bp99999999", _FakeClient("<html><body>no data</body></html>"))
        assert False, "ParseFailedError를 기대했다"
    except ParseFailedError as exc:
        assert exc.detail.get("exam_ref") == "bp99999999"


def test_normalize_strips_whitespace_and_lowers():
    assert cbtbank._normalize("품질 경영 기사") == cbtbank._normalize("품질경영기사")


# --- 검토 후속 경검 2: 과목 접두 제거 -----------------------------------------
def test_clean_subject_strips_numbered_prefix():
    assert cbtbank._clean_subject("1과목: 실험계획법") == "실험계획법"
    assert cbtbank._clean_subject("12과목 : 여유 공백") == "여유 공백"
    assert cbtbank._clean_subject("접두 없음") == "접두 없음"


# --- 검토 후속 경검 5: cert_ref(슬러그) 형식 검증 ------------------------------
def test_list_exams_rejects_malformed_cert_ref(monkeypatch):
    adapter = cbtbank.CbtbankAdapter()
    monkeypatch.setattr(adapter, "_cert_name", lambda client, ref: "테스트자격증")
    for bad in ["", "-시작하이픈", "../etc/passwd", "a/b", "a b"]:
        try:
            adapter.list_exams(bad, _FakeClient(CATEGORY_HTML))
            assert False, f"ParseFailedError를 기대했다: {bad!r}"
        except ParseFailedError:
            pass


def test_list_exams_accepts_valid_cert_ref(monkeypatch):
    adapter = cbtbank.CbtbankAdapter()
    monkeypatch.setattr(adapter, "_cert_name", lambda client, ref: "테스트자격증")
    entries = adapter.list_exams("품질경영기사", _FakeClient(CATEGORY_HTML))
    assert len(entries) == 2
    entries = adapter.list_exams("9급-국가직-공무원-건축계획", _FakeClient(CATEGORY_HTML))
    assert len(entries) == 2
