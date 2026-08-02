import { useMemo } from 'react'
import { useAllReviewNotes } from '../../api/reviewNotes'
import { groupByCategoryPath } from '../../utils/reviewNoteGroups'
import MarkdownView from '../MarkdownView'

interface WrongNotePrintViewProps {
  categoryId: number | null
  dateFrom: string
  dateTo: string
  includeNotes: boolean
}

// 설계 §5.10 — 오답노트 인쇄: 기간·분류 필터 + 내 메모 포함 옵션.
// review-notes API(§4.6)는 날짜 범위 파라미터가 없어 전체를 받아 created_at으로 클라이언트 필터링한다.
// 인쇄는 완결된 전체 목록이 필요해 size=200(서버 상한) 이내로 전 페이지를 순회 수집한다
// (size=500 단발 요청은 서버 상한 초과로 422 — 핫픽스, stage-4 결함).
export default function WrongNotePrintView({ categoryId, dateFrom, dateTo, includeNotes }: WrongNotePrintViewProps) {
  const notesQuery = useAllReviewNotes({ category_id: categoryId ?? undefined })

  const filtered = useMemo(() => {
    const items = notesQuery.data ?? []
    return items.filter((n) => {
      const created = n.created_at.slice(0, 10)
      if (dateFrom && created < dateFrom) return false
      if (dateTo && created > dateTo) return false
      return true
    })
  }, [notesQuery.data, dateFrom, dateTo])

  const groups = useMemo(() => groupByCategoryPath(filtered), [filtered])

  if (notesQuery.isLoading) return <p className="text-sm text-muted">불러오는 중…</p>
  if (notesQuery.isError) return <p className="text-sm text-wrong">오답노트를 불러오지 못했습니다.</p>
  if (filtered.length === 0) return <p className="text-sm text-muted">조건에 맞는 오답노트가 없습니다.</p>

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-primary">오답노트</h1>
      <p className="mb-6 text-xs text-muted">
        {dateFrom || '전체'} ~ {dateTo || '전체'} · 총 {filtered.length}건
      </p>

      {groups.map((group) => (
        <section key={group.header} className="mb-6">
          <h2 className="print-avoid-break mb-3 border-b border-border pb-1 text-lg font-semibold text-primary">
            {group.header} ({group.count})
          </h2>
          {group.subgroups.map((sub) => (
            <div key={sub.subheading} className="mb-4">
              {sub.subheading !== group.header && (
                <h3 className="mb-2 text-sm font-semibold text-muted">{sub.subheading}</h3>
              )}
              <ol className="flex flex-col gap-3">
                {sub.notes.map((note, i) => (
                  <li key={note.id} className="print-avoid-break text-sm text-primary">
                    <p className="font-medium">
                      {i + 1}. {note.document.doc_no} {note.document.title}
                      {note.wrong_reason && <span className="ml-2 text-xs text-muted">[{note.wrong_reason}]</span>}
                      {note.is_resolved && <span className="ml-2 text-xs text-correct">[극복]</span>}
                    </p>
                    <MarkdownView content={note.document.content} docNo={note.document.doc_no} />
                    {includeNotes && note.note && (
                      <p className="mt-1 rounded border border-dashed border-border bg-bg p-2 text-xs text-muted">
                        내 메모: {note.note}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
