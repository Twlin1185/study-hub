import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LlmJobItem } from '../api/types'

interface JobCenterRunGroupProps {
  runId: number
  label: string
  items: LlmJobItem[]
  collapsed: boolean
  onToggle: () => void
  onClose: () => void
  busy: boolean
  onCancelAll: (items: LlmJobItem[]) => void
  onDismissAll: (items: LlmJobItem[]) => void
  children: ReactNode
}

// 집계 문구 — 유한 status enum → 고정 라벨 + 숫자(0 생략).
function summary(items: LlmJobItem[]): string {
  const count = (s: LlmJobItem['status']) => items.filter((i) => i.status === s).length
  const parts = [`작업 ${items.length}개`]
  const defs: Array<[LlmJobItem['status'], string]> = [
    ['running', '진행 중'],
    ['queued', '대기'],
    ['done', '완료'],
    ['error', '실패'],
    ['cancelled', '취소'],
  ]
  for (const [s, l] of defs) {
    const n = count(s)
    if (n > 0) parts.push(`${l} ${n}`)
  }
  return parts.join(' · ')
}

// stage-57 규약 G — 작업 센터 run 그룹(헤더·접기·일괄 액션). 잡 행은 children으로 받는다.
export default function JobCenterRunGroup({
  runId,
  label,
  items,
  collapsed,
  onToggle,
  onClose,
  busy,
  onCancelAll,
  onDismissAll,
  children,
}: JobCenterRunGroupProps) {
  const hasCancellable = items.some((i) => i.status === 'queued' || i.status === 'running')
  const hasDismissible = items.some(
    (i) => i.status === 'done' || i.status === 'error' || i.status === 'cancelled',
  )
  const btn = 'rounded border border-border px-2.5 py-1 text-xs hover:bg-bg disabled:opacity-50'
  return (
    <li className="rounded-lg border border-border">
      <div className="flex flex-col gap-2 rounded-t-lg bg-surface-raised p-3">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex w-full items-start gap-2 text-left"
        >
          <span aria-hidden className="shrink-0 text-xs text-muted">
            {collapsed ? '▶' : '▼'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-medium text-primary">{label}</span>
            <span className="block text-xs text-muted">{summary(items)}</span>
          </span>
        </button>
        <div className="flex flex-wrap gap-2">
          <Link to={`/import?run=${runId}`} onClick={onClose} className={`${btn} text-primary`}>
            카드로 이동
          </Link>
          {hasCancellable && (
            <button type="button" disabled={busy} onClick={() => onCancelAll(items)} className={`${btn} text-wrong`}>
              모두 취소
            </button>
          )}
          {hasDismissible && (
            <button type="button" disabled={busy} onClick={() => onDismissAll(items)} className={`${btn} text-primary`}>
              목록에서 지우기
            </button>
          )}
        </div>
      </div>
      {!collapsed && <ul className="flex flex-col gap-3 border-t border-border p-3">{children}</ul>}
    </li>
  )
}
