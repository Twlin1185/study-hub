import type { CategoryNode } from '../api/types'

// S51(FB-25) — 탐색 다중 선택 선택 툴바(설계 §5.2 S51 · 지시서 §2 I). 선택 0이면 미렌더가 기본이나,
// 성공 직후는 선택이 0으로 초기화된 채 결과 요약 1줄만 툴바 자리에 남긴다(다음 조작 시 소멸).
interface BulkSelectionBarProps {
  count: number
  totalVisible: number
  // 좌측에서 선택한 분류(출발) — null이면 "전체 문서"/"단일 문서만" 상태라 이동·해제 비활성.
  fromNode: CategoryNode | null
  deep: boolean
  resultSummary: string | null
  onSelectAllVisible: () => void
  onClear: () => void
  onLink: () => void
  onMove: () => void
  onUnlink: () => void
  onDelete: () => void
}

const BTN = 'rounded border border-border bg-surface px-2 py-1 text-xs text-primary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50'

export default function BulkSelectionBar({
  count,
  totalVisible,
  fromNode,
  deep,
  resultSummary,
  onSelectAllVisible,
  onClear,
  onLink,
  onMove,
  onUnlink,
  onDelete,
}: BulkSelectionBarProps) {
  if (count === 0) {
    if (!resultSummary) return null
    return (
      <div className="sticky top-0 z-10 mb-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
        {resultSummary}
      </div>
    )
  }

  const canMoveUnlink = fromNode != null
  const suffix = deep ? '(하위 포함)' : ''
  const disabledTitle = canMoveUnlink ? undefined : '왼쪽에서 분류를 먼저 선택하세요'

  return (
    <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <span className="font-medium text-primary">{count}건 선택</span>
      <button type="button" onClick={onSelectAllVisible} className={BTN}>
        현재 목록 {totalVisible}건 전체 선택
      </button>
      <button type="button" onClick={onClear} className={BTN}>
        선택 해제
      </button>
      <span className="mx-0.5 hidden h-4 w-px bg-border sm:block" />
      <button type="button" onClick={onLink} className={BTN}>
        분류에 연결
      </button>
      <button type="button" onClick={onMove} disabled={!canMoveUnlink} title={disabledTitle} className={BTN}>
        {canMoveUnlink ? `'${fromNode.name}'에서 이동${suffix}` : '분류 이동'}
      </button>
      <button type="button" onClick={onUnlink} disabled={!canMoveUnlink} title={disabledTitle} className={BTN}>
        {canMoveUnlink ? `'${fromNode.name}'에서 연결 해제${suffix}` : '연결 해제'}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded border border-border bg-surface px-2 py-1 text-xs text-wrong hover:bg-bg"
      >
        삭제
      </button>
      {resultSummary && <span className="ml-auto text-xs text-muted">{resultSummary}</span>}
    </div>
  )
}
