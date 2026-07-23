import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCategoryTree } from '../api/categories'
import type { CategoryNode } from '../api/types'
import { findCategory } from '../utils/tree'
import { ApiError } from '../api/client'
import ProgressBar from '../components/ProgressBar'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §5.4 — 과목/챕터 아코디언. 계층 깊이(자격증/시험/과목/단원)가 데이터마다 달라질 수 있어
// 고정 2단(과목/챕터)으로 하드코딩하지 않고, 실제 아코디언으로 임의 깊이를 지원한다.
// 문서가 없는 리프(챕터)를 "챕터"로 간주해 진도바 + [이어하기/여기서 시작] 버튼을 표시.
export default function CurriculumDetailPage() {
  const { id } = useParams<{ id: string }>()
  const categoryId = id ? Number(id) : null
  const treeQuery = useCategoryTree()

  const nodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data])
  const node = categoryId != null ? findCategory(nodes, categoryId) : null

  if (treeQuery.isLoading) return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  if (treeQuery.isError) {
    return <p className="p-4 text-sm text-wrong">{errMsg(treeQuery.error, '분류를 불러오지 못했습니다.')}</p>
  }
  if (!node) {
    return <p className="p-4 text-sm text-wrong">분류를 찾을 수 없습니다.</p>
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Link to="/curriculum" className="mb-3 inline-block text-sm text-muted hover:text-primary">
        ← 커리큘럼
      </Link>

      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-primary">{node.name}</h1>
        {node.exam_date && <span className="text-xs text-muted">시험일 {node.exam_date}</span>}
      </div>

      {node.children.length === 0 ? (
        <p className="text-sm text-muted">하위 과목·챕터가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {node.children.map((child) => (
            <AccordionSection key={child.id} node={child} depth={0} />
          ))}
        </div>
      )}
    </div>
  )
}

function AccordionSection({ node, depth }: { node: CategoryNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.children.length > 0

  if (!hasChildren) {
    // 진도바용 done/total은 categories/tree의 비율(progress)만 제공하므로 doc_count와
    // 조합해 근사치를 표시한다 (백엔드가 done/total 원본을 내려주면 교체 필요 — 최종 보고 참고).
    const total = node.doc_count
    const done = node.progress != null ? Math.round(node.progress * total) : 0
    const isComplete = total > 0 && node.progress != null && node.progress >= 1

    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3" style={{ marginLeft: `${depth * 12}px` }}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-primary">{node.name}</p>
          {total > 0 ? (
            <ProgressBar value={node.progress ?? 0} label={`${done}/${total}`} />
          ) : (
            <p className="text-xs text-muted">문서를 연결하세요</p>
          )}
        </div>
        {isComplete ? (
          <span className="shrink-0 text-lg text-correct" aria-label="완료" title="완료">
            ✓
          </span>
        ) : total > 0 ? (
          <Link
            to={done > 0 ? `/study/${node.id}` : `/study/${node.id}?from=start`}
            className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            {done > 0 ? '이어하기' : '여기서 시작'}
          </Link>
        ) : null}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface" style={{ marginLeft: `${depth * 12}px` }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-muted">{expanded ? '▾' : '▸'}</span>
          <span className="text-sm font-medium text-primary">{node.name}</span>
        </span>
        {node.progress != null && <span className="text-xs text-muted">{Math.round(node.progress * 100)}%</span>}
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          {node.children.map((child) => (
            <AccordionSection key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
