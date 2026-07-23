import { useState } from 'react'
import type { CategoryNode } from '../api/types'

export interface TreeActions {
  onSelect: (id: number | null) => void
  onAddChild: (parent: CategoryNode | null) => void
  onRename: (node: CategoryNode) => void
  onMove: (node: CategoryNode) => void
  onDelete: (node: CategoryNode) => void
  onDropDocument: (categoryId: number, documentId: number) => void
}

interface TreeProps extends TreeActions {
  nodes: CategoryNode[]
  selectedId: number | null
}

export default function Tree({ nodes, selectedId, ...actions }: TreeProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => actions.onSelect(null)}
        className={`rounded px-2 py-1.5 text-left text-sm font-medium ${
          selectedId === null ? 'bg-accent-soft text-accent' : 'text-primary hover:bg-bg'
        }`}
      >
        전체 문서
      </button>
      {nodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} selectedId={selectedId} {...actions} />
      ))}
      <button
        type="button"
        onClick={() => actions.onAddChild(null)}
        className="mt-1 rounded px-2 py-1.5 text-left text-sm text-muted hover:bg-bg hover:text-primary"
      >
        + 최상위 분류 추가
      </button>
    </div>
  )
}

interface TreeNodeProps extends TreeActions {
  node: CategoryNode
  depth: number
  selectedId: number | null
}

function TreeNode({ node, depth, selectedId, ...actions }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded px-1 py-1 text-sm ${
          isSelected ? 'bg-accent-soft text-accent' : 'text-primary hover:bg-bg'
        } ${dragOver ? 'ring-2 ring-accent' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const docId = e.dataTransfer.getData('application/x-document-id')
          if (docId) actions.onDropDocument(node.id, Number(docId))
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`w-4 shrink-0 text-muted ${hasChildren ? '' : 'invisible'}`}
          aria-label={expanded ? '접기' : '펼치기'}
        >
          {expanded ? '▾' : '▸'}
        </button>

        <button
          type="button"
          onClick={() => actions.onSelect(node.id)}
          className="min-w-0 flex-1 truncate text-left"
          title={node.name}
        >
          {node.name}
          {node.level_hint && <span className="ml-1 text-[11px] text-muted">({node.level_hint})</span>}
        </button>

        <span className="shrink-0 text-[11px] text-muted">{node.doc_count}</span>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="분류 메뉴"
            className="rounded px-1 text-muted opacity-0 hover:bg-bg group-hover:opacity-100"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-36 rounded-md border border-border bg-surface-raised py-1 text-left shadow-lg">
                <MenuItem
                  label="하위 분류 추가"
                  onClick={() => {
                    setMenuOpen(false)
                    actions.onAddChild(node)
                  }}
                />
                <MenuItem
                  label="이름 변경"
                  onClick={() => {
                    setMenuOpen(false)
                    actions.onRename(node)
                  }}
                />
                <MenuItem
                  label="이동"
                  onClick={() => {
                    setMenuOpen(false)
                    actions.onMove(node)
                  }}
                />
                <MenuItem
                  label="삭제"
                  danger
                  onClick={() => {
                    setMenuOpen(false)
                    actions.onDelete(node)
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {node.progress != null && (
        <div
          className="h-1 rounded-full bg-border"
          style={{ marginLeft: `${depth * 14 + 24}px`, marginRight: '8px' }}
        >
          <div
            className="h-1 rounded-full bg-accent"
            style={{ width: `${Math.round(node.progress * 100)}%` }}
          />
        </div>
      )}

      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} selectedId={selectedId} {...actions} />
          ))}
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-bg ${danger ? 'text-wrong' : 'text-primary'}`}
    >
      {label}
    </button>
  )
}
