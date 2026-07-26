import type { ExamFlatItem, ExamSubjectMeta } from '../stores/examSession'

interface ExamNavigatorProps {
  items: ExamFlatItem[]
  subjectsMeta: ExamSubjectMeta[]
  answers: Record<number, string>
  currentIndex: number
  onJump: (index: number) => void
}

// 모의고사 런 화면(설계 §5.12) 문항 네비게이터 — 과목 구분 + 문항별 응답/미응답 표시, 탭 이동.
// 데스크톱은 우측 고정 패널, 모바일은 Modal로 감싸 하단 시트처럼 띄운다(호출부 pages/ExamRun.tsx).
// items는 subjects 순서 그대로 평탄화돼 있으므로(examSession.start) subjectsMeta.count로 구간을
// 순서대로 잘라내면 별도 탐색 없이 과목별 그룹을 만들 수 있다.
export default function ExamNavigator({ items, subjectsMeta, answers, currentIndex, onJump }: ExamNavigatorProps) {
  let offset = 0

  return (
    <div className="flex flex-col gap-3">
      {subjectsMeta.map((s) => {
        const start = offset
        offset += s.count
        const subjectItems = items.slice(start, start + s.count)
        if (subjectItems.length === 0) return null
        return (
          <div key={s.category_id}>
            <p className="mb-1.5 text-xs font-semibold text-muted">{s.name}</p>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-5">
              {subjectItems.map((it, i) => {
                const idx = start + i
                const done = answers[it.document_id] != null
                const isCurrent = idx === currentIndex
                return (
                  <button
                    key={it.document_id}
                    type="button"
                    onClick={() => onJump(idx)}
                    aria-current={isCurrent ? 'true' : undefined}
                    title={`${idx + 1}. ${it.title}`}
                    className={`flex h-8 w-8 items-center justify-center rounded text-xs font-medium transition-colors ${
                      isCurrent
                        ? 'border-2 border-accent bg-accent text-on-accent'
                        : done
                          ? 'border border-accent bg-accent-soft text-accent'
                          : 'border border-border bg-surface text-muted hover:bg-bg'
                    }`}
                  >
                    {idx + 1}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
