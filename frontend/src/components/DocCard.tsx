import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DocumentListItem } from '../api/types'
import TagChip from './TagChip'

const TYPE_LABEL: Record<string, string> = {
  concept: '개념',
  question: '문제',
  past_question: '기출',
  flashcard: '카드',
}

interface DocCardProps {
  doc: DocumentListItem
  onRequestLink: (documentId: number) => void
}

export default function DocCard({ doc, onRequestLink }: DocCardProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      className="group relative flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-sm transition-shadow hover:shadow-md"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-document-id', String(doc.id))
        e.dataTransfer.effectAllowed = 'link'
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate(`/docs/${doc.id}`)}
          className="flex-1 text-left"
        >
          <span className="mb-1 inline-block rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
            {TYPE_LABEL[doc.type] ?? doc.type}
          </span>
          <h3 className="line-clamp-2 text-sm font-medium text-primary">{doc.title}</h3>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="더보기"
            className="rounded p-1 text-muted hover:bg-bg hover:text-primary"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-border bg-surface-raised py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm text-primary hover:bg-bg"
                  onClick={() => {
                    setMenuOpen(false)
                    onRequestLink(doc.id)
                  }}
                >
                  분류에 연결
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {doc.tags.map((tag) => (
            <TagChip key={tag} label={tag} />
          ))}
        </div>
      )}

      {doc.usage_count > 0 && (
        <span className="text-xs text-muted">{doc.usage_count}곳에서 사용 중</span>
      )}
    </div>
  )
}
