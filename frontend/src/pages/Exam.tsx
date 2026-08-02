import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCategoryTreePipeline } from '../api/categories'
import { useCreateExamSession } from '../api/exam'
import { useExamSessionStore } from '../stores/examSession'
import { findCategory } from '../utils/tree'
import { ApiError } from '../api/client'
import type { CategoryNode, ExamOrder, ExamSessionRequest } from '../api/types'
import QuizExamTabs from '../components/QuizExamTabs'
import AppliedExamPanel from '../components/AppliedExamPanel'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

const ORDER_OPTIONS: { value: ExamOrder; label: string }[] = [
  { value: 'random', label: '랜덤' },
  { value: 'sequential', label: '순차' },
]

// 검토 지적(중요) — doc_count는 해당 분류에 "직접 연결된" 문서 수(개념 포함)라 서버 출제 기준
// (서브트리 전체의 question/past_question, quiz_service 재사용 §4.14)과 어긋난다. 하위 챕터에만
// 문제가 있는 과목이 0문항으로 오판되거나(회차/챕터 트리에서 기능이 막힘), 반대로 개념만 있는
// 노드가 N문항으로 보였다가 세션 생성 422로 이어진다. tree?pipeline=1(S9 F37, 커리큘럼 §5.4가
// 이미 사용 중)의 stage_progress.{question,past_question}.total(서브트리 포함 집계)로 판정한다.
function subjectExamCount(node: CategoryNode): number {
  const sp = node.stage_progress
  if (!sp) return 0
  return (sp.question?.total ?? 0) + (sp.past_question?.total ?? 0)
}

// 빈 값·0·음수 입력 방어(검토 지적 경미4) — 항상 유효한 양의 정수만 반환.
function clampPositiveInt(raw: string, fallback: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

// CategoryScopePicker(components/)는 "전체 범위" 루트 옵션이 있는 읽기 전용 선택 트리라 모의고사의
// "시험 노드 1개를 반드시 고른다" 흐름과 맞지 않는다(전체 범위를 시험 노드로 삼을 수 없음) —
// 같은 재귀 렌더 패턴을 "전체" 옵션 없이 이 화면 전용으로 다시 둔다(기존 컴포넌트는 불변 유지).
function ExamNodeTree({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: CategoryNode[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  return (
    <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-surface p-2">
      {nodes.map((node) => (
        <ExamNodeItem key={node.id} node={node} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}

function ExamNodeItem({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: CategoryNode
  depth: number
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded px-1 py-1 text-sm ${
          isSelected ? 'bg-accent-soft text-accent' : 'text-primary hover:bg-bg'
        }`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`w-4 shrink-0 text-muted ${hasChildren ? '' : 'invisible'}`}
          aria-label={expanded ? '접기' : '펼치기'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button type="button" onClick={() => onSelect(node.id)} className="min-w-0 flex-1 truncate text-left">
          {node.name}
        </button>
        <span className="shrink-0 text-[11px] text-muted">{subjectExamCount(node)}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <ExamNodeItem key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

// 설계 §5.12 — 모의고사 구성 화면. ① 시험 노드 선택 → ② 직계 자식 체크리스트(과목) →
// ③ 과목당 문항 수·제한 시간·합격선·출제 순서 → [응시 시작] = POST /api/exam/session.
export default function ExamPage() {
  const navigate = useNavigate()
  // S9 F37 파이프라인 트리(서브트리 타입별 집계 포함) — 과목 판정을 서버 출제 기준과 맞춘다(검토 지적 중요).
  const pipelineQuery = useCategoryTreePipeline()
  const createSession = useCreateExamSession()
  const start = useExamSessionStore((s) => s.start)

  // S19(§4.21·§5.12) — 모드 탭 [실전(기출)] / [AI 응용]. AI 응용은 별도 위저드(AppliedExamPanel)로
  // 완전히 분리한다 — 이 아래 실전 흐름(F25)은 손대지 않는다(계약 불변).
  const [examMode, setExamMode] = useState<'real' | 'applied'>('real')

  const [examNodeId, setExamNodeId] = useState<number | null>(null)
  const [selectedSubjects, setSelectedSubjects] = useState<Set<number>>(new Set())

  // true = "전체 문항"(count 미지정 → 서버가 해당 범위 전체 출제, 과목당 상한 200)
  const [perSubjectCountAll, setPerSubjectCountAll] = useState(false)
  const [perSubjectCountInput, setPerSubjectCountInput] = useState('20')
  const [countTouched, setCountTouched] = useState(false)
  const [order, setOrder] = useState<ExamOrder>('random')
  const [orderTouched, setOrderTouched] = useState(false)
  const [subjectMin, setSubjectMin] = useState(40)
  const [passAvg, setPassAvg] = useState(60)
  const [timeLimitInput, setTimeLimitInput] = useState('')
  const [timeLimitTouched, setTimeLimitTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 빈 값·0·음수를 항상 걸러낸 실제 전송값(검토 지적 경미4) — 입력 필드 자체는 자유롭게 타이핑되도록
  // 원본 문자열(perSubjectCountInput)을 그대로 두고, 파생값만 안전하게 계산한다.
  const perSubjectCount = perSubjectCountAll ? null : clampPositiveInt(perSubjectCountInput, 20)

  const examNode = examNodeId != null ? findCategory(pipelineQuery.data ?? [], examNodeId) : null
  // 핫픽스 — 시험 노드 자신에 직속 문서가 있으면(중간 노드에 바로 연결된 문서, 합법) 과목 체크리스트가
  // examNode.children만 훑어서 그 문서를 어떤 과목에도 못 넣어 출제에서 통째로 빠졌다. 시험 노드 자신을
  // 나타내는 항목을 목록 맨 앞에 추가한다 — category_id=examNode.id로 세션을 만들면 백엔드
  // collect_descendant_ids가 자기 자신도 포함하므로(§4.14) 정상 출제된다.
  //
  // 검토 보완 — 이 항목의 실제 출제 범위는 "직속 문서만"이 아니라 examNode의 collect_descendant_ids
  // 결과(자기 자신 + 하위 트리 전체)다. 즉 아래 자식 과목들이 이미 포함하는 문서를 전부 다시
  // 포함하므로, 라벨은 "이 분류 전체"로 실제 동작을 정확히 드러낸다. exam_service가 과목 간 중복
  // 제거를 하지 않으므로(같은 문서가 두 과목에 중복 출제·이중 채점) 이 항목과 자식 과목은 동시에
  // 선택될 수 없도록 상호배타를 구조적으로 강제한다(아래 anyChildSelected/toggleSubject) — 완화
  // 문구는 모바일에서 뜨지 않는 hover 툴팁이 아니라 항상 노출되는 캡션으로 둔다.
  const hasOwnDocs = (examNode?.doc_count ?? 0) > 0
  const selfSubjectId = hasOwnDocs ? examNode?.id ?? null : null
  const subjectNodes = useMemo(
    () => (hasOwnDocs && examNode ? [examNode, ...examNode.children] : examNode?.children ?? []),
    [examNode, hasOwnDocs],
  )
  // 자식 과목이 하나라도 선택돼 있으면 self("이 분류 전체") 항목은 비활성 — 중복 출제 원천 차단.
  const anyChildSelected = useMemo(
    () => (examNode?.children ?? []).some((c) => selectedSubjects.has(c.id)),
    [examNode, selectedSubjects],
  )

  // 시험 노드가 바뀌면 과목 선택을 새로 초기화(문제 보유 노드 기본 전체 선택, §5.12 — 판정은
  // subjectExamCount, 서브트리 question+past_question 합) — 사용자 수동 조정(문항 수·순서) 터치
  // 상태도 함께 리셋한다.
  useEffect(() => {
    if (examNodeId == null) {
      setSelectedSubjects(new Set())
      return
    }
    const node = findCategory(pipelineQuery.data ?? [], examNodeId)
    const defaults = (node?.children ?? []).filter((c) => subjectExamCount(c) > 0).map((c) => c.id)
    setSelectedSubjects(new Set(defaults))
    setCountTouched(false)
    setOrderTouched(false)
    setTimeLimitTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examNodeId, pipelineQuery.data])

  // 회차 노드 1개만 선택 = "회차 그대로" 모의 프리셋(전체 문항·순차 기본, 설계 §5.12) —
  // 사용자가 직접 건드린 값은 덮어쓰지 않는다.
  useEffect(() => {
    if (selectedSubjects.size === 1) {
      if (!countTouched) setPerSubjectCountAll(true)
      if (!orderTouched) setOrder('sequential')
    } else {
      if (!countTouched) {
        setPerSubjectCountAll(false)
        setPerSubjectCountInput('20')
      }
      if (!orderTouched) setOrder('random')
    }
  }, [selectedSubjects, countTouched, orderTouched])

  function toggleSubject(id: number) {
    setSelectedSubjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        // 상호배타(검토 권고) — self("이 분류 전체")는 하위 트리 전체를 다시 포함해 자식 과목과
        // 겹치므로, 자식 과목을 새로 선택하면 self는 자동 해제한다(self는 자식이 하나라도 선택된
        // 동안 체크박스 자체가 비활성화되어 반대 방향 선택은 UI에서 막힌다).
        if (selfSubjectId != null && id !== selfSubjectId) next.delete(selfSubjectId)
      }
      return next
    })
  }

  const selectedNodes = useMemo(
    () => subjectNodes.filter((c) => selectedSubjects.has(c.id)),
    [subjectNodes, selectedSubjects],
  )
  const estimatedTotal = selectedNodes.reduce(
    (sum, c) =>
      sum + (perSubjectCount != null ? Math.min(perSubjectCount, subjectExamCount(c)) : subjectExamCount(c)),
    0,
  )
  const estimatedMinutes = Math.max(1, Math.ceil(estimatedTotal * 1.5))
  const displayedTimeLimit = timeLimitTouched ? timeLimitInput : String(estimatedMinutes)
  // 시간 필드도 동일하게 방어(요청 범위 밖 하드닝) — 비우거나 0/음수를 입력해도 항상 유효한 값만 전송.
  const effectiveTimeLimitMinutes = timeLimitTouched
    ? clampPositiveInt(timeLimitInput, estimatedMinutes)
    : estimatedMinutes

  function handleStart() {
    setError(null)
    if (examNodeId == null || selectedSubjects.size === 0) {
      setError('시험 노드와 과목을 선택하세요.')
      return
    }
    const body: ExamSessionRequest = {
      subjects: Array.from(selectedSubjects).map((id) => ({
        category_id: id,
        count: perSubjectCount ?? undefined,
      })),
      order,
      cut: { subject_min: subjectMin, pass_avg: passAvg },
      time_limit_minutes: timeLimitTouched ? effectiveTimeLimitMinutes : undefined,
    }
    createSession.mutate(body, {
      onSuccess: (data) => {
        start(data.subjects, data.time_limit_minutes, data.cut, data.order)
        navigate('/exam/run')
      },
      onError: (e) => setError(errMsg(e, '모의고사를 시작하지 못했습니다.')),
    })
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl font-semibold text-primary">모의고사</h1>

      <QuizExamTabs />

      {/* AI 응용 모드 탭(설계 §4.21·§5.12) — [실전(기출)]은 아래 기존 흐름 그대로(F25 계약 불변),
          [AI 응용]은 완전히 분리된 별도 위저드(AppliedExamPanel)로 전환한다. */}
      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-surface p-1">
        {(
          [
            { value: 'real', label: '실전(기출)' },
            { value: 'applied', label: 'AI 응용' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setExamMode(opt.value)}
            className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
              examMode === opt.value ? 'bg-accent text-on-accent' : 'text-muted hover:bg-bg hover:text-primary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {examMode === 'applied' && <AppliedExamPanel />}

      {examMode === 'real' && (
        <>
      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-primary">① 시험 노드 선택</h2>
        {pipelineQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
        {pipelineQuery.isError && <p className="text-sm text-wrong">분류를 불러오지 못했습니다.</p>}
        {pipelineQuery.data && (
          <ExamNodeTree nodes={pipelineQuery.data} selectedId={examNodeId} onSelect={setExamNodeId} />
        )}
      </section>

      {examNode && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">
            ② 과목 구성{' '}
            <span className="text-xs font-normal text-muted">
              (직계 자식{hasOwnDocs ? ' + 이 분류 전체(직속 문서 포함)' : ''} — 0문항은 비활성)
            </span>
          </h2>
          {subjectNodes.length === 0 ? (
            <p className="text-sm text-muted">이 노드는 하위 항목이 없습니다. 다른 노드를 선택하세요.</p>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3">
              {subjectNodes.map((c) => {
                const count = subjectExamCount(c)
                const isSelfEntry = c.id === examNode?.id
                const disabled = count === 0 || (isSelfEntry && anyChildSelected)
                return (
                  <div key={c.id} className="flex flex-col gap-0.5">
                    <label
                      className={`flex items-center gap-2 text-sm ${disabled ? 'text-muted opacity-50' : 'text-primary'}`}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selectedSubjects.has(c.id)}
                        onChange={() => toggleSubject(c.id)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {c.name}
                        {isSelfEntry && <span className="ml-1 text-xs text-accent">(이 분류 전체)</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{count}문항</span>
                    </label>
                    {/* 완화 문구는 hover 툴팁이 아니라 항상 노출되는 소문구로(모바일에서는 hover가 없다). */}
                    {isSelfEntry && (
                      <p className="pl-6 text-[11px] text-muted">
                        {anyChildSelected
                          ? '다른 과목이 선택되어 있어 비활성화됨 — 하위 전체를 다시 포함해 문항이 중복됩니다.'
                          : '하위 전체(자식 과목 포함)를 한 과목으로 출제합니다. 선택 시 아래 자식 과목은 선택할 수 없습니다.'}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {selectedSubjects.size === 1 && (
            <p className="mt-2 text-xs text-accent">
              회차 모의: 전체 문항 · 순차 출제가 기본으로 적용됩니다(아래에서 수정 가능).
            </p>
          )}
        </section>
      )}

      {examNode && subjectNodes.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">③ 시험 설정</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              과목당 문항 수
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  disabled={perSubjectCountAll}
                  value={perSubjectCountInput}
                  onChange={(e) => {
                    setCountTouched(true)
                    setPerSubjectCountInput(e.target.value)
                  }}
                  className="w-20 rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent disabled:opacity-50"
                />
                <label className="flex items-center gap-1 text-xs text-primary">
                  <input
                    type="checkbox"
                    checked={perSubjectCountAll}
                    onChange={(e) => {
                      setCountTouched(true)
                      setPerSubjectCountAll(e.target.checked)
                    }}
                  />
                  전체 문항
                </label>
              </div>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted">
              제한 시간(분) <span className="text-[11px]">— 자동 계산(총 문항×1.5분), 수정 가능</span>
              <input
                type="number"
                min={1}
                value={displayedTimeLimit}
                onChange={(e) => {
                  setTimeLimitTouched(true)
                  setTimeLimitInput(e.target.value)
                }}
                className="w-24 rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
              합격선 — 과목 {subjectMin}점 과락 · 평균 {passAvg}점 합격
              <div className="flex items-center gap-2 text-sm text-primary">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={subjectMin}
                  onChange={(e) => setSubjectMin(Number(e.target.value))}
                  className="w-16 rounded border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
                <span className="text-xs text-muted">점 과락 ·</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={passAvg}
                  onChange={(e) => setPassAvg(Number(e.target.value))}
                  className="w-16 rounded border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
                <span className="text-xs text-muted">점 평균 합격</span>
              </div>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted">
              출제 순서
              <div className="flex gap-2">
                {ORDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setOrderTouched(true)
                      setOrder(opt.value)
                    }}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                      order === opt.value
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border bg-surface text-primary hover:bg-bg'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </label>
          </div>
        </section>
      )}

      {error && <p className="mb-3 text-sm text-wrong">{error}</p>}

      <button
        type="button"
        onClick={handleStart}
        disabled={createSession.isPending || examNodeId == null || selectedSubjects.size === 0}
        className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
      >
        {createSession.isPending ? '준비 중…' : '응시 시작'}
      </button>
        </>
      )}
    </div>
  )
}
