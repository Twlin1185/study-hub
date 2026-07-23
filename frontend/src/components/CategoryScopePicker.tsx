import { useState } from 'react'
import type { CategoryNode } from '../api/types'

interface CategoryScopePickerProps {
  nodes: CategoryNode[]
  selectedId: number | null
  onSelect: (id: number | null) => void
}

// 퀴즈 설정 화면의 "범위" 선택 트리 — 편집 메뉴 없는 읽기 전용 선택 트리.
// 분류 편집이 필요한 곳은 components/Tree.tsx를 그대로 재사용한다.
export default function CategoryScopePicker({ nodes, selectedId, onSelect }: CategoryScopePickerProps) {
  return (
    <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-surface p-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`rounded px-2 py-1.5 text-left text-sm font-medium ${
          selectedId === null ? 'bg-accent-soft text-accent' : 'text-primary hover:bg-bg'
        }`}
      >
        전체 범위
      </button>
      {nodes.map((node) => (
        <ScopeNode key={node.id} node={node} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}

function ScopeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: CategoryNode
  depth: number
  selectedId: number | null
  onSelect: (id: number | null) => void
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
        <span className="shrink-0 text-[11px] text-muted">{node.doc_count}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <ScopeNode key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}
