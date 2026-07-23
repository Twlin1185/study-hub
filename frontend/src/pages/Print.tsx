import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCategoryTree } from '../api/categories'
import CategoryScopePicker from '../components/CategoryScopePicker'
import ConceptPrintView from '../components/print/ConceptPrintView'
import QuizPrintView from '../components/print/QuizPrintView'
import WrongNotePrintView from '../components/print/WrongNotePrintView'

type PrintType = 'concept' | 'quiz' | 'wrong'

const TYPE_OPTIONS: { value: PrintType; label: string }[] = [
  { value: 'concept', label: '개념 정리본' },
  { value: 'quiz', label: '문제집' },
  { value: 'wrong', label: '오답노트' },
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function monthAgoIso(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 10)
}

// 설계 §5.10, 계획 §12 — 인쇄 뷰. 옵션 패널은 화면 전용(print:hidden), 본문은 A4 폭 렌더 +
// @media print 규칙(styles/print.css, tokens.css). 테마는 인쇄 시 tokens.css가 항상 라이트로 강제한다.
export default function PrintPage() {
  const [searchParams] = useSearchParams()
  const treeQuery = useCategoryTree()

  const [type, setType] = useState<PrintType>((searchParams.get('type') as PrintType) || 'concept')
  const [categoryId, setCategoryId] = useState<number | null>(
    searchParams.get('category_id') ? Number(searchParams.get('category_id')) : null,
  )
  const [includeExplanation, setIncludeExplanation] = useState(true)
  const [answerSpace, setAnswerSpace] = useState(true)
  const [includeNotes, setIncludeNotes] = useState(true)
  const [dateFrom, setDateFrom] = useState(monthAgoIso())
  const [dateTo, setDateTo] = useState(todayIso())

  const needsCategory = type === 'concept' || type === 'quiz'
  const canPrint = !needsCategory || categoryId != null

  return (
    <div className="mx-auto max-w-3xl p-4">
      {/* 옵션 패널 — 화면 전용 */}
      <div className="print:hidden">
        <h1 className="mb-4 text-xl font-semibold text-primary">인쇄</h1>

        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-primary">종류</h2>
          <div className="grid grid-cols-3 gap-2">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setType(opt.value)}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  type === opt.value
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border bg-surface text-primary hover:bg-bg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {needsCategory && (
          <section className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-primary">범위</h2>
            {treeQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
            {treeQuery.data && (
              <CategoryScopePicker nodes={treeQuery.data} selectedId={categoryId} onSelect={setCategoryId} />
            )}
          </section>
        )}

        {type === 'quiz' && (
          <section className="mb-4 flex flex-col gap-2">
            <h2 className="mb-1 text-sm font-semibold text-primary">옵션</h2>
            <label className="flex items-center gap-2 text-sm text-primary">
              <input
                type="checkbox"
                checked={includeExplanation}
                onChange={(e) => setIncludeExplanation(e.target.checked)}
              />
              해설 포함
            </label>
            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="checkbox" checked={answerSpace} onChange={(e) => setAnswerSpace(e.target.checked)} />
              풀이 여백 추가
            </label>
          </section>
        )}

        {type === 'wrong' && (
          <section className="mb-4 flex flex-col gap-2">
            <h2 className="mb-1 text-sm font-semibold text-primary">옵션</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-primary">
              <span>기간</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded border border-border bg-surface px-2 py-1 text-sm text-primary"
              />
              <span>~</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded border border-border bg-surface px-2 py-1 text-sm text-primary"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
              내 메모 포함
            </label>
            <div className="text-sm text-primary">
              <span className="mr-2">분류 범위 (선택 안 하면 전체)</span>
              {treeQuery.data && (
                <CategoryScopePicker nodes={treeQuery.data} selectedId={categoryId} onSelect={setCategoryId} />
              )}
            </div>
          </section>
        )}

        <button
          type="button"
          onClick={() => window.print()}
          disabled={!canPrint}
          className="mb-6 w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          🖨 브라우저 인쇄 (PDF로 저장)
        </button>

        {!canPrint && <p className="mb-4 text-sm text-wrong">범위를 먼저 선택하세요.</p>}

        <div className="mb-4 border-t border-border" />
      </div>

      {/* 본문 — A4 폭 렌더, 인쇄 시 그대로 출력 */}
      {canPrint && (
        <div className="rounded-lg border border-border bg-surface p-6 print:border-0 print:bg-transparent print:p-0">
          {type === 'concept' && categoryId != null && <ConceptPrintView categoryId={categoryId} />}
          {type === 'quiz' && categoryId != null && (
            <QuizPrintView categoryId={categoryId} includeExplanation={includeExplanation} answerSpace={answerSpace} />
          )}
          {type === 'wrong' && (
            <WrongNotePrintView
              categoryId={categoryId}
              dateFrom={dateFrom}
              dateTo={dateTo}
              includeNotes={includeNotes}
            />
          )}
        </div>
      )}
    </div>
  )
}
