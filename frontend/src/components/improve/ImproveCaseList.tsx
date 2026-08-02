import { useState } from 'react'
import { useDeleteImproveCase, useImproveCases } from '../../api/improve'
import { ApiError } from '../../api/client'
import ConfirmDialog from '../ConfirmDialog'
import ImproveGenWizard from './ImproveGenWizard'
import { ORIGIN_LABEL, kindLabel } from './labels'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// 설계 screens §5.13 "사례 체크박스 선택(1~20)" — prepare가 받는 case_ids 상한과 같은 값
// (§4.22 ② — 초과 시 서버가 pydantic 422로 거부하므로 UI에서 먼저 막는다, stage-20 검토 경미 ⑤).
const MAX_GEN_CASES = 20

// 설계 §4.22 ①·⑤ — 실패 사례 목록(수집은 자동·비용 0). 최근 50건 상한(결정 ②)이 곧 전체
// 목록이라 size=50 고정 1페이지로 조회한다(별도 페이지네이션 UI를 두지 않음 — 프론트 판단).
export default function ImproveCaseList({ onProposalsGenerated }: { onProposalsGenerated?: () => void }) {
  const casesQuery = useImproveCases(1, 50)
  const deleteCase = useDeleteImproveCase()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const items = casesQuery.data?.items ?? []

  // ImproveRegressionWizard의 상한 처리(MAX_REGRESSION_CASES)와 같은 방식 — 이미 20건이면
  // 새로 체크해도 조용히 무시한다(체크박스 disabled로 시각적으로도 막음).
  function toggle(caseId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(caseId)) {
        next.delete(caseId)
      } else if (next.size < MAX_GEN_CASES) {
        next.add(caseId)
      }
      return next
    })
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    deleteCase.mutate(deleteTarget, {
      onSuccess: () => {
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(deleteTarget)
          return next
        })
        setDeleteTarget(null)
      },
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        반입 실패(변환 잡 실패·신뢰 게이트 탈락·오류 신고)가 자동으로 쌓입니다(비용 0). 사례를 골라
        개선 제안을 생성할 수 있습니다 — 생성은 LLM을 호출하므로 사용량 확인이 필요합니다.
      </p>

      {casesQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {casesQuery.isError && <p className="text-sm text-wrong">사례 목록을 불러오지 못했습니다.</p>}
      {casesQuery.data && items.length === 0 && <p className="text-sm text-muted">쌓인 실패 사례가 없습니다.</p>}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <span className="text-primary">
            {items.length}건 · 선택 {selected.size} / 최대 {MAX_GEN_CASES}건
          </span>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => setWizardOpen(true)}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            개선 제안 생성 ({selected.size}건)
          </button>
        </div>
      )}

      {deleteCase.isError && (
        <p className="text-sm text-wrong">{errMsg(deleteCase.error, '사례 제거에 실패했습니다.')}</p>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((c) => {
          const checked = selected.has(c.case_id)
          const capReached = !checked && selected.size >= MAX_GEN_CASES
          return (
          <li key={c.case_id} className={`rounded-lg border border-border bg-surface p-3 ${capReached ? 'opacity-50' : ''}`}>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={checked}
                disabled={capReached}
                onChange={() => toggle(c.case_id)}
              />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                    {kindLabel(c.kind)}
                  </span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                    {ORIGIN_LABEL[c.origin] ?? c.origin}
                  </span>
                  <span className="text-[11px] text-muted">{c.count}회</span>
                  {c.regressions.length > 0 && (
                    <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                      회귀 이력 {c.regressions.length}건
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted">최근 발생 {formatDate(c.last_seen_at)}</p>
                {c.document && (
                  <p className="truncate text-xs text-muted">
                    {c.document.doc_no} — {c.document.title}
                  </p>
                )}
                {c.source && <p className="truncate text-[11px] text-muted">원본: {c.source.filename}</p>}
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(c.case_id)}
                className="shrink-0 rounded border border-border px-2.5 py-1 text-xs text-primary hover:bg-bg"
              >
                제거
              </button>
            </div>
          </li>
          )
        })}
      </ul>

      {deleteTarget && (
        <ConfirmDialog
          title="사례 제거"
          message="이 실패 사례를 목록에서 제거합니다. 되돌릴 수 없습니다(보존 파일이 있으면 함께 삭제됩니다)."
          danger
          submitting={deleteCase.isPending}
          errorMessage={deleteCase.isError ? errMsg(deleteCase.error, '제거에 실패했습니다.') : null}
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {wizardOpen && (
        <ImproveGenWizard
          caseIds={Array.from(selected)}
          onClose={() => setWizardOpen(false)}
          onGenerated={() => {
            setWizardOpen(false)
            setSelected(new Set())
            onProposalsGenerated?.()
          }}
        />
      )}
    </div>
  )
}
