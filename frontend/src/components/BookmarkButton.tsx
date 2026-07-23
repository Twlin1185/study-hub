import { useToggleBookmark } from '../api/documents'

interface BookmarkButtonProps {
  documentId: number
  bookmarked: boolean
  size?: 'sm' | 'md'
  className?: string
}

// 북마크 별 — 탐색 카드·문서 상세·퀴즈 카드 공용 (설계 §5.3, §7 낙관적 업데이트 대상).
export default function BookmarkButton({ documentId, bookmarked, size = 'md', className = '' }: BookmarkButtonProps) {
  const toggleBookmark = useToggleBookmark()
  const textSize = size === 'sm' ? 'text-base' : 'text-lg'

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggleBookmark.mutate({ id: documentId, bookmarked: !bookmarked })
      }}
      aria-label={bookmarked ? '북마크 해제' : '북마크 추가'}
      aria-pressed={bookmarked}
      title={bookmarked ? '북마크 해제' : '북마크 추가'}
      className={`shrink-0 leading-none transition-colors ${textSize} ${
        bookmarked ? 'text-warning' : 'text-muted hover:text-warning'
      } ${className}`}
    >
      {bookmarked ? '★' : '☆'}
    </button>
  )
}
