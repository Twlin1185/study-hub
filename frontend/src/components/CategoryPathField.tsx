import { useEffect, useState } from 'react'
import { useCategoryTree } from '../api/categories'
import CategoryScopePicker from './CategoryScopePicker'
import { findCategoryPath } from '../utils/tree'

// 분류 경로 미리 지정(F40-③, 설계 §4.11 `category_path?` · §5.9) — 시작 화면(파일·URL 공통)의
// 접이식 패널. 기존 노드는 CategoryScopePicker 재사용으로 고르고, 뒤에 회차 등 하위 경로를
// 텍스트로 덧붙인다. **완성 경로 미리보기 문자열**을 항상 보여줘 오타를 시작 전에 드러낸다.
//
// 이 값은 어디까지나 **제안 고정**이다 — 반입 확정은 미리보기 단계의 사용자 승인(R7).
// 검증 규칙은 서버(convert_service.normalize_category_path)와 같은 값을 미러링한다.
export const CATEGORY_PATH_MAX_DEPTH = 5
export const CATEGORY_PATH_MAX_SEGMENT = 60

export function categoryPathSegments(path: string): string[] {
  return path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function normalizeCategoryPath(path: string): string {
  return categoryPathSegments(path).join('/')
}

// 서버와 같은 규칙으로 미리 판정해 시작 전에 알려 준다(최종 판단은 서버 422).
export function categoryPathError(path: string): string | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  const rawSegments = trimmed.split('/')
  if (rawSegments.some((s) => !s.trim())) {
    return '경로에 빈 단계가 있습니다 (예: 품질경영기사/필기/2022년 2회).'
  }
  const segments = categoryPathSegments(trimmed)
  if (segments.some((s) => s.length > CATEGORY_PATH_MAX_SEGMENT)) {
    return `각 단계는 ${CATEGORY_PATH_MAX_SEGMENT}자 이하여야 합니다.`
  }
  if (segments.length > CATEGORY_PATH_MAX_DEPTH) {
    return `경로는 최대 ${CATEGORY_PATH_MAX_DEPTH}단계까지 지정할 수 있습니다.`
  }
  return null
}

interface CategoryPathFieldProps {
  value: string
  onChange: (path: string) => void
  // 대기열(여러 파일)에서는 "모든 파일에 같은 상위 경로 적용"임을 문구로 알린다.
  sharedNotice?: boolean
}

export default function CategoryPathField({ value, onChange, sharedNotice = false }: CategoryPathFieldProps) {
  const [open, setOpen] = useState(false)
  const [baseId, setBaseId] = useState<number | null>(null)
  const [extra, setExtra] = useState('')
  const treeQuery = useCategoryTree()

  const basePath = baseId != null ? findCategoryPath(treeQuery.data ?? [], baseId) : null
  const composed = normalizeCategoryPath([basePath ?? '', extra].filter(Boolean).join('/'))

  useEffect(() => {
    onChange(composed)
    // onChange는 호출부에서 매 렌더 새로 만들 수 있어 의존성에서 뺀다(경로 값 변화만 반영).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composed])

  const error = categoryPathError(composed)

  return (
    <div className="rounded border border-border bg-bg">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-primary"
      >
        <span className="font-medium">분류 경로 지정 (선택)</span>
        <span className="flex min-w-0 items-center gap-2">
          {value && <span className="truncate text-xs text-accent">{value}</span>}
          <span className="text-muted" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <p className="text-xs text-muted">
            지정하면 모든 문항의 분류 제안이 이 경로 하나로 고정됩니다. 미리보기에서 해제·추가할 수 있고,
            없는 분류는 반입을 승인할 때 만들어집니다.
            {sharedNotice && ' 여기서 정한 경로는 모든 파일에 같은 상위 경로로 적용됩니다.'}
          </p>

          <div>
            <p className="mb-1 text-xs font-semibold text-muted">기존 분류에서 고르기</p>
            {treeQuery.isLoading && <p className="text-xs text-muted">분류를 불러오는 중…</p>}
            {treeQuery.isError && <p className="text-xs text-wrong">분류를 불러오지 못했습니다.</p>}
            {treeQuery.data && (
              <CategoryScopePicker
                nodes={treeQuery.data}
                selectedId={baseId}
                onSelect={(id) => setBaseId(id)}
              />
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm text-primary">
            하위 경로 덧붙이기 (선택 — 예: 2022년 2회)
            <input
              type="text"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="2022년 2회"
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
            />
          </label>

          <div className="rounded border border-border bg-surface px-3 py-2 text-xs">
            <span className="text-muted">완성 경로: </span>
            {composed ? (
              <span className="font-medium text-primary">{composed}</span>
            ) : (
              <span className="text-muted">지정하지 않음 (LLM이 알아서 제안)</span>
            )}
          </div>

          {error && <p className="text-xs text-warning">{error}</p>}
        </div>
      )}
    </div>
  )
}
