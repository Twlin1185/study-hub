import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard } from '../api/dashboard'
import { useSuggestions } from '../api/suggestions'
import { useSettings, useUpdateSettings } from '../api/settings'
import { ApiError } from '../api/client'
import {
  containerMaxWidthClass,
  distributeColumns,
  effectiveColumns,
  parseHomeLayout,
  toStoredLayout,
} from '../utils/homeLayout'
import type { HomeLayout } from '../utils/homeLayout'
import { useContentWidth } from '../hooks/useContentWidth'
import { WIDGET_COMPONENTS } from '../components/home/registry'
import HomeEditor from '../components/home/HomeEditor'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

export default function HomePage() {
  const dashboardQuery = useDashboard()
  const suggestionsQuery = useSuggestions()
  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()
  const { ref: contentRef, width: contentWidth } = useContentWidth()

  const [editing, setEditing] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const suggestionCount = suggestionsQuery.data?.length ?? 0
  const layout = parseHomeLayout(settingsQuery.data?.['home.layout'])

  if (dashboardQuery.isLoading || settingsQuery.isLoading) {
    return <p className="p-4 text-sm text-muted">불러오는 중…</p>
  }
  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <p className="p-4 text-sm text-wrong">
        {errMsg(dashboardQuery.error, '대시보드를 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.')}
      </p>
    )
  }

  if (editing) {
    return (
      <HomeEditor
        initial={layout}
        saving={updateSettings.isPending}
        onCancel={() => {
          setSaveError(null)
          setEditing(false)
        }}
        onDone={(next: HomeLayout) => {
          setSaveError(null)
          updateSettings.mutate(
            { 'home.layout': toStoredLayout(next) },
            {
              onSuccess: () => setEditing(false),
              onError: (e) => setSaveError(errMsg(e, '레이아웃 저장에 실패했습니다.')),
            },
          )
        }}
      />
    )
  }

  const data = dashboardQuery.data
  const hasNoData = data.continue.length === 0 && data.ddays.length === 0 && data.recent.attempts_7d === 0

  const cols = effectiveColumns(layout.columns, contentWidth)
  const columnBuckets = distributeColumns(layout.widgets, cols)

  return (
    // 바깥 w-full 래퍼를 관측한다 — max-w 적용된 안쪽 div를 재면 자기 자신에 되먹임(설계 §5.1 v1.6).
    <div ref={contentRef} className="w-full">
    <div className={`mx-auto ${containerMaxWidthClass(cols)} p-4`}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-primary">홈</h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg print:hidden"
        >
          편집
        </button>
      </div>

      {saveError && <p className="mb-3 text-sm text-wrong">{saveError}</p>}

      {hasNoData && (
        <div className="mb-5 flex flex-col items-start gap-2 rounded-lg border border-border bg-surface p-5">
          <p className="text-sm font-medium text-primary">아직 학습 데이터가 없습니다.</p>
          <p className="text-sm text-muted">기출 JSON을 반입해 시작하세요.</p>
          <Link
            to="/import"
            className="mt-1 rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            반입하러 가기
          </Link>
        </div>
      )}

      {suggestionCount > 0 && (
        <Link
          to="/suggestions"
          className="mb-5 flex items-center justify-between rounded-lg border border-accent bg-accent-soft px-3 py-2.5 text-sm text-accent hover:opacity-90"
        >
          <span>📮 분류 제안 {suggestionCount}건 대기 중</span>
          <span>제안함 열기 ›</span>
        </Link>
      )}

      {/* 위젯 다열 렌더 (설계 §5.1) */}
      <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {columnBuckets.map((bucket, c) => (
          <div key={c} className="flex flex-col gap-5">
            {bucket.map((w) => {
              const Widget = WIDGET_COMPONENTS[w.id]
              return <Widget key={w.id} />
            })}
          </div>
        ))}
      </div>
    </div>
    </div>
  )
}
