import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import MarkdownView from '../components/MarkdownView'
import QuestionCard from '../components/QuestionCard'
import ExamNavigator from '../components/ExamNavigator'
import ProgressBar from '../components/ProgressBar'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import ReportErrorButton from '../components/ReportErrorButton'
import { useExamSessionStore } from '../stores/examSession'
import type { ExamFlatItem } from '../stores/examSession'
import { useSubmitExam, useExamHistory } from '../api/exam'
import { useSubmitAppliedExam } from '../api/appliedExam'
import { useUpdateReviewNote } from '../api/reviewNotes'
import { useCreateQuizSession } from '../api/quiz'
import { useQuizSessionStore } from '../stores/quizSession'
import { useFontScale } from '../hooks/useFontScale'
import { ApiError } from '../api/client'
import { formatAnswer } from '../utils/answerFormat'
import type { ExamCut, ExamResultItem, ExamSubjectReport, ExamSubmitRequest, ExamSubmitResponse, WrongReason } from '../api/types'

const WRONG_REASONS: WrongReason[] = ['개념부족', '실수', '함정', '시간부족']

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

function formatCountdown(totalSec: number): string {
  const s = Math.max(0, totalSec)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function formatElapsedSeconds(totalSec: number): string {
  const s = Math.max(0, totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// 설계 §5.12 — 모의고사 런 화면(`/exam/run`). QuizCard 문항 렌더 재사용 + 채점 상호작용 제거,
// 카운트다운 타이머(프론트 주도) + 문항 네비게이터. 제출 후엔 같은 페이지가 결과 리포트로 전환된다
// (pages/QuizRun.tsx의 active↔finished 전환 패턴과 동일).
export default function ExamRunPage() {
  const navigate = useNavigate()
  const status = useExamSessionStore((s) => s.status)
  const items = useExamSessionStore((s) => s.items)
  const subjectsMeta = useExamSessionStore((s) => s.subjectsMeta)
  const currentIndex = useExamSessionStore((s) => s.currentIndex)
  const answers = useExamSessionStore((s) => s.answers)
  const cut = useExamSessionStore((s) => s.cut)
  const startedAt = useExamSessionStore((s) => s.startedAt)
  const deadlineAt = useExamSessionStore((s) => s.deadlineAt)
  const report = useExamSessionStore((s) => s.report)
  const applied = useExamSessionStore((s) => s.applied)
  const setAnswerStore = useExamSessionStore((s) => s.setAnswer)
  const goTo = useExamSessionStore((s) => s.goTo)
  const submitted = useExamSessionStore((s) => s.submitted)
  const reset = useExamSessionStore((s) => s.reset)

  const submitExam = useSubmitExam()
  const submitAppliedExam = useSubmitAppliedExam()
  const updateReviewNote = useUpdateReviewNote()
  const createQuizSession = useCreateQuizSession()
  const startQuiz = useQuizSessionStore((s) => s.start)
  const fontScale = useFontScale()

  const [now, setNow] = useState(() => Date.now())
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [leaveTarget, setLeaveTarget] = useState<string | 'back' | null>(null)
  const autoSubmittedRef = useRef(false)
  const allowLeaveRef = useRef(false)

  // 검토 지적(확인 요청) — allowLeaveRef가 true인 동안(명시적 "나가기" 확정 처리 중)에는 이 효과가
  // 절대 발동하지 않도록 구조적으로 가드한다. reset()이 status를 'idle'로 바꾸는 순간과
  // confirmLeave의 navigate(target)/history.go(-2)가 겹치면 목적지가 서로 덮어써질 여지가 있었는데,
  // 이 가드로 "idle 전환 시 재이동"과 "명시적 나가기 이동"이 같은 틱에 동시에 일어날 구조 자체를
  // 없앤다(하나는 항상 스킵).
  useEffect(() => {
    if (status === 'idle' && !allowLeaveRef.current) navigate('/exam', { replace: true })
  }, [status, navigate])

  // 상단 카운트다운 tick — 1초마다
  useEffect(() => {
    if (status !== 'active') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [status])

  // 새로고침·닫기 경고 (설계 §5.12)
  useEffect(() => {
    if (status !== 'active') return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [status])

  // 라우터 가드 ① — 앱 내부 링크 클릭 가로채기(사이드바·하단 탭바 등 SPA 내비게이션, 설계 §5.12).
  // BrowserRouter(비-데이터 라우터)라 useBlocker를 쓸 수 없어 캡처 단계 클릭 인터셉트로 구현한다.
  useEffect(() => {
    if (status !== 'active') return
    function onClick(e: MouseEvent) {
      if (allowLeaveRef.current) return
      const target = (e.target as HTMLElement)?.closest('a')
      if (!target) return
      const href = target.getAttribute('href')
      if (!href || !href.startsWith('/') || href === '/exam/run') return
      e.preventDefault()
      e.stopPropagation()
      setLeaveTarget(href)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [status])

  // 라우터 가드 ② — 브라우저/폰 뒤로가기 가로채기. 진입 시 더미 히스토리 엔트리를 하나 더 쌓아두고,
  // popstate가 오면 즉시 되쌓아 실제 이탈을 막은 뒤 확인 모달을 띄운다(확정 시 go(-2)로 실제 이탈).
  useEffect(() => {
    if (status !== 'active') return
    window.history.pushState({ examGuard: true }, '', window.location.href)
    function onPopState() {
      if (allowLeaveRef.current) return
      window.history.pushState({ examGuard: true }, '', window.location.href)
      setLeaveTarget('back')
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      // 더미 히스토리 엔트리 정리(검토 지적 경미5) — active를 벗어나는 순간(제출 완료 등) 리스너를
      // 먼저 뗀 뒤 조용히 back() 한 번으로 더미를 consume해서, 결과 화면에서 뒤로가기 1회가
      // 무반응으로 보이는 문제를 없앤다. allowLeaveRef가 true인 경로(나가기 확정)는 confirmLeave가
      // 이미 정확한 스텝 수로 처리하므로(뒤로가기 확정=go(-2), 링크 이동=push) 여기서 중복 처리하지 않는다.
      if (!allowLeaveRef.current) {
        window.history.back()
      }
    }
  }, [status])

  function confirmLeave() {
    allowLeaveRef.current = true
    const target = leaveTarget
    setLeaveTarget(null)
    reset()
    if (target === 'back') {
      window.history.go(-2)
    } else if (target) {
      navigate(target)
    }
  }

  function buildSubmitBody(elapsedSeconds: number): ExamSubmitRequest {
    // 검토 지적(경미3) — 모의고사는 자유 이동이 허용돼 문항별 실제 체류 시간을 정확히 측정할 수
    // 없다(재방문·건너뛰기가 섞임). time_spent를 아예 비우면 S10 goal.daily_minutes(attempts.
    // time_spent 합산)가 응시 시간을 통째로 놓치므로, 총 소요 시간을 문항 수로 균등 배분해
    // 전송한다 — 정확한 문항별 시간이 아니라 "일일 학습 시간 집계 누락 방지"가 목적인 근사치.
    const perItemSeconds = items.length > 0 ? Math.floor(elapsedSeconds / items.length) : 0
    return {
      answers: items.map((it) => ({
        document_id: it.document_id,
        subject_category_id: it.subject_category_id,
        my_answer: answers[it.document_id] ?? null,
        time_spent: perItemSeconds,
      })),
      cut,
      elapsed_seconds: elapsedSeconds,
    }
  }

  function doSubmit() {
    setSubmitError(null)
    const elapsedSeconds = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0
    const body = buildSubmitBody(elapsedSeconds)
    // S19(§4.21) — applied 세션은 채점 코어를 공유하는 applied-exam/submit으로 분기(mode
    // 'applied_exam' 기록 + results[].basis 추가, 요청 형태는 exam/submit과 동일).
    const mutation = applied ? submitAppliedExam : submitExam
    mutation.mutate(body, {
      onSuccess: (data) => submitted(data),
      onError: (e) => setSubmitError(errMsg(e, '제출에 실패했습니다.')),
    })
  }

  // 타이머 0초 — 확인 없이 미응답 포함 자동 일괄 제출 (설계 §5.12)
  useEffect(() => {
    if (status !== 'active' || deadlineAt == null) return
    if (now >= deadlineAt && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true
      doSubmit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, status, deadlineAt])

  function handleSubmitClick() {
    const unanswered = items.filter((it) => answers[it.document_id] == null).length
    if (unanswered > 0) {
      setSubmitConfirmOpen(true)
    } else {
      doSubmit()
    }
  }

  if (status === 'idle') return null

  if (status === 'finished' && report) {
    return (
      <ExamReport
        report={report}
        items={items}
        applied={applied}
        updateReviewNote={updateReviewNote}
        createQuizSession={createQuizSession}
        startQuiz={startQuiz}
        onExit={() => {
          reset()
          navigate('/exam')
        }}
      />
    )
  }

  const current = items[currentIndex]
  if (!current) return null

  const remainingMs = deadlineAt ? Math.max(0, deadlineAt - now) : 0
  const remainingSec = Math.floor(remainingMs / 1000)
  const warn = remainingSec <= 5 * 60
  const unansweredCount = items.filter((it) => answers[it.document_id] == null).length
  const submitPending = applied ? submitAppliedExam.isPending : submitExam.isPending

  return (
    <div className="mx-auto max-w-5xl p-4 pb-24">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-primary">
          모의고사 응시 중
          {applied && (
            <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              AI 생성 모의고사
            </span>
          )}
        </h1>
        <div className="flex items-center gap-3">
          <span className={`text-lg font-semibold tabular-nums ${warn ? 'text-warning' : 'text-primary'}`}>
            ⏱ {formatCountdown(remainingSec)}
          </span>
          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={submitPending}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            제출
          </button>
        </div>
      </div>

      <div className="mb-4">
        <ProgressBar
          value={(currentIndex + 1) / items.length}
          label={`${currentIndex + 1}/${items.length} · 미응답 ${unansweredCount}개`}
        />
      </div>

      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <QuestionCard
            docNo={current.doc_no}
            content={current.content}
            choices={current.choices}
            fontScale={fontScale}
            selectedValue={answers[current.document_id] ?? null}
            onSelect={(i) => setAnswerStore(current.document_id, String(i + 1))}
            headerRight={<span className="text-xs text-muted">{current.subject_name}</span>}
          />

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => goTo(currentIndex - 1)}
              disabled={currentIndex === 0}
              className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg disabled:opacity-40"
            >
              ◀ 이전
            </button>
            <button
              type="button"
              onClick={() => setNavigatorOpen(true)}
              className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg md:hidden"
            >
              문항 목록
            </button>
            <button
              type="button"
              onClick={() => goTo(currentIndex + 1)}
              disabled={currentIndex >= items.length - 1}
              className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg disabled:opacity-40"
            >
              다음 ▶
            </button>
          </div>
        </div>

        {/* 데스크톱 문항 네비게이터 — 우측 고정 패널 (설계 §5.12) */}
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-4 max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-surface p-3">
            <p className="mb-2 text-xs font-semibold text-primary">문항 네비게이터</p>
            <ExamNavigator
              items={items}
              subjectsMeta={subjectsMeta}
              answers={answers}
              currentIndex={currentIndex}
              onJump={goTo}
            />
          </div>
        </aside>
      </div>

      {/* 모바일 문항 네비게이터 — 하단 시트 대용 Modal (설계 §5.12) */}
      {navigatorOpen && (
        <Modal title="문항 네비게이터" onClose={() => setNavigatorOpen(false)}>
          <ExamNavigator
            items={items}
            subjectsMeta={subjectsMeta}
            answers={answers}
            currentIndex={currentIndex}
            onJump={(i) => {
              goTo(i)
              setNavigatorOpen(false)
            }}
          />
        </Modal>
      )}

      {submitError && <p className="mt-3 text-sm text-wrong">{submitError}</p>}

      {submitConfirmOpen && (
        <ConfirmDialog
          title="제출 확인"
          message={`미응답 문항이 ${unansweredCount}개 있습니다. 그래도 제출할까요? (미응답은 오답으로 채점됩니다)`}
          confirmLabel="제출"
          danger
          submitting={submitPending}
          onClose={() => setSubmitConfirmOpen(false)}
          onConfirm={() => {
            setSubmitConfirmOpen(false)
            doSubmit()
          }}
        />
      )}

      {leaveTarget != null && (
        <ConfirmDialog
          title="시험 응시 중"
          message="지금 나가면 시험이 사라집니다(제출 전 답안은 저장되지 않습니다). 나갈까요?"
          confirmLabel="나가기"
          danger
          onClose={() => setLeaveTarget(null)}
          onConfirm={confirmLeave}
        />
      )}
    </div>
  )
}

function SubjectScoreBar({ subject, cut }: { subject: ExamSubjectReport; cut: ExamCut }) {
  const pct = Math.max(0, Math.min(100, subject.score))
  const cutPct = Math.max(0, Math.min(100, cut.subject_min))
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-primary">{subject.name}</span>
        <span className="flex items-center gap-2">
          <span className="text-muted">
            {subject.correct}/{subject.count} · {subject.score}점
          </span>
          {subject.failed && (
            <span className="rounded-full bg-wrong/10 px-2 py-0.5 text-xs font-medium text-wrong">과락</span>
          )}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-border">
        <div
          className={`h-2 rounded-full ${subject.failed ? 'bg-wrong' : 'bg-correct'}`}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-0 h-2 w-0.5 bg-warning"
          style={{ left: `${cutPct}%` }}
          title={`과락 기준 ${cut.subject_min}점`}
        />
      </div>
    </div>
  )
}

// 오답 직후 틀린이유 원탭(F36-⑤ 재사용, 설계 §5.12) — review_note_id로 즉시 PATCH.
function ExamWrongReasonButtons({
  reviewNoteId,
  updateReviewNote,
}: {
  reviewNoteId: number
  updateReviewNote: ReturnType<typeof useUpdateReviewNote>
}) {
  const [selected, setSelected] = useState<WrongReason | null>(null)

  function pick(reason: WrongReason) {
    const next = selected === reason ? null : reason
    setSelected(next)
    updateReviewNote.mutate({ id: reviewNoteId, wrong_reason: next })
  }

  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium text-muted">틀린 이유 (오답노트에 바로 기록)</p>
      <div className="flex flex-wrap gap-1.5">
        {WRONG_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => pick(reason)}
            aria-pressed={selected === reason}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              selected === reason
                ? 'border-accent bg-accent text-on-accent'
                : 'border-border bg-surface text-primary hover:bg-bg'
            }`}
          >
            {reason}
          </button>
        ))}
      </div>
    </div>
  )
}

function ResultRow({
  result,
  item,
  updateReviewNote,
}: {
  result: ExamResultItem
  item: ExamFlatItem | undefined
  updateReviewNote: ReturnType<typeof useUpdateReviewNote>
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`rounded-lg border p-3 ${
        result.is_correct ? 'border-border bg-surface' : 'border-wrong/40 bg-wrong/5'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-primary">
          {item && (
            <span className="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
              {item.doc_no}
            </span>
          )}
          <span className={`mr-2 font-semibold ${result.is_correct ? 'text-correct' : 'text-wrong'}`}>
            {result.is_correct ? '정답' : '오답'}
          </span>
          {item?.title}
        </span>
        <span className="shrink-0 text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-3 border-t border-border pt-3">
          {item?.content && <MarkdownView content={item.content} />}
          <p className="my-2 text-sm text-primary">
            내 답: {formatAnswer(result.my_answer, '미응답')} · 정답: {formatAnswer(result.answer, '미응답')}
          </p>
          {!result.is_correct && result.review_note_id != null && (
            <ExamWrongReasonButtons reviewNoteId={result.review_note_id} updateReviewNote={updateReviewNote} />
          )}
          <div className="text-sm text-primary">
            <span className="font-semibold">해설</span>
            <MarkdownView content={result.explanation} />
          </div>
          {/* S19(§4.21) — 생성 문항 사후 검토 방어선: 근거 문서 링크 + 오류 신고(F30 재사용). */}
          {result.basis && result.basis.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-1.5 text-xs font-semibold text-muted">근거 문서</p>
              <div className="flex flex-wrap gap-1.5">
                {result.basis.map((b) => (
                  <Link
                    key={b.document_id}
                    to={`/docs/${b.document_id}`}
                    className="rounded border border-border px-2 py-1 text-xs text-accent hover:bg-bg"
                  >
                    {b.doc_no} {b.title}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {result.basis != null && (
            <div className="mt-3">
              <ReportErrorButton documentId={result.document_id} variant="inline" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ExamReport({
  report,
  items,
  applied,
  updateReviewNote,
  createQuizSession,
  startQuiz,
  onExit,
}: {
  report: ExamSubmitResponse
  items: ExamFlatItem[]
  applied: boolean
  updateReviewNote: ReturnType<typeof useUpdateReviewNote>
  createQuizSession: ReturnType<typeof useCreateQuizSession>
  startQuiz: ReturnType<typeof useQuizSessionStore.getState>['start']
  onExit: () => void
}) {
  const navigate = useNavigate()
  // S19(§4.21) — applied 세션은 이 페이지에서 실전 이력을 조회하지 않는다(요청 §4.21 "이력" 항).
  const historyQuery = useExamHistory(5, !applied)
  const [retryError, setRetryError] = useState<string | null>(null)

  const itemMap = useMemo(() => new Map(items.map((it) => [it.document_id, it])), [items])
  const wrongItems = report.results.filter((r) => !r.is_correct)

  function handleRetryWrong() {
    setRetryError(null)
    const documentIds = wrongItems.map((r) => r.document_id)
    if (documentIds.length === 0) return
    createQuizSession.mutate(
      { mode: 'sequential', count: documentIds.length, document_ids: documentIds },
      {
        onSuccess: (data) => {
          if (data.items.length === 0) {
            setRetryError('재도전할 문제를 찾지 못했습니다.')
            return
          }
          startQuiz(data.items, 'sequential', null)
          navigate('/quiz/run')
        },
        onError: () => setRetryError('재도전 세션을 시작하지 못했습니다.'),
      },
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-primary">
          모의고사 결과
          {applied && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              AI 생성 모의고사
            </span>
          )}
        </h1>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            report.passed ? 'bg-correct/10 text-correct' : 'bg-wrong/10 text-wrong'
          }`}
        >
          {report.passed ? '합격' : '불합격'}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{report.total.score}점</p>
          <p className="text-xs text-muted">총점(과목 평균)</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold text-primary">
            {report.total.correct}/{report.total.count}
          </p>
          <p className="text-xs text-muted">정답 수</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-center">
          <p className="text-2xl font-semibold text-primary">{formatElapsedSeconds(report.elapsed_seconds ?? 0)}</p>
          <p className="text-xs text-muted">소요 시간</p>
        </div>
      </div>

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-primary">과목별 점수</h2>
        <div className="flex flex-col gap-2">
          {report.subjects.map((s) => (
            <SubjectScoreBar key={s.category_id} subject={s} cut={report.cut} />
          ))}
        </div>
      </section>

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-primary">문항별 리뷰</h2>
        <div className="flex flex-col gap-2">
          {report.results.map((r) => (
            <ResultRow
              key={r.document_id}
              result={r}
              item={itemMap.get(r.document_id)}
              updateReviewNote={updateReviewNote}
            />
          ))}
        </div>
      </section>

      {retryError && <p className="mb-3 text-sm text-wrong">{retryError}</p>}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        {wrongItems.length > 0 && (
          <button
            type="button"
            onClick={handleRetryWrong}
            disabled={createQuizSession.isPending}
            className="flex-1 rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            틀린 문제 재도전 ({wrongItems.length})
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate('/review-notes')}
          className="flex-1 rounded border border-border px-4 py-2.5 text-sm font-medium text-primary hover:bg-bg"
        >
          오답노트 가기
        </button>
        <button
          type="button"
          onClick={onExit}
          className="flex-1 rounded border border-border px-4 py-2.5 text-sm font-medium text-primary hover:bg-bg"
        >
          모의고사 설정으로
        </button>
      </div>

      {historyQuery.data && historyQuery.data.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-primary">최근 응시 이력</h2>
          <div className="flex flex-col gap-1.5">
            {historyQuery.data.map((h) => (
              <div
                key={h.taken_at}
                className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-primary" title={h.label}>
                  {h.label}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-muted">{h.total.score}점</span>
                  <span className={`text-xs font-medium ${h.passed ? 'text-correct' : 'text-wrong'}`}>
                    {h.passed ? '합격' : '불합격'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
