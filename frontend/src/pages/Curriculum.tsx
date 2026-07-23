import { Link } from 'react-router-dom'
import { useCategoryTree } from '../api/categories'
import { ApiError } from '../api/client'
import ProgressBar from '../components/ProgressBar'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// 설계 §5.4 — 최상위(자격증) 카드 목록. 선택하면 /curriculum/:id에서 과목→챕터 아코디언.
export default function CurriculumPage() {
  const treeQuery = useCategoryTree()

  if (treeQuery.isLoading) return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  if (treeQuery.isError) {
    return (
      <p className="p-4 text-sm text-wrong">
        {errMsg(treeQuery.error, '분류를 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.')}
      </p>
    )
  }

  const nodes = treeQuery.data ?? []

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-xl font-semibold text-primary">커리큘럼</h1>

      {nodes.length === 0 && (
        <p className="text-sm text-muted">등록된 분류가 없습니다. 탐색에서 분류를 먼저 추가하세요.</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {nodes.map((node) => (
          <Link
            key={node.id}
            to={`/curriculum/${node.id}`}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="truncate text-base font-medium text-primary">{node.name}</h2>
              {node.level_hint && <span className="shrink-0 text-xs text-muted">{node.level_hint}</span>}
            </div>
            <span className="text-xs text-muted">문서 {node.doc_count}개</span>
            {node.progress != null && (
              <ProgressBar value={node.progress} label={`${Math.round(node.progress * 100)}%`} />
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
