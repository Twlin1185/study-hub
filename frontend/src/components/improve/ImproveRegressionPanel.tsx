import { useState } from 'react'
import { useImproveProposals } from '../../api/improve'
import { useJobRecovery } from '../../hooks/useJobRecovery'
import ImproveRegressionWizard from './ImproveRegressionWizard'
import { PROPOSAL_KIND_BADGE_CLASS, PROPOSAL_KIND_LABEL } from './labels'
import type { ImproveProposalListItem } from '../../api/types'

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// 설계 §4.22 ④(F46, S20) — 반영된(applied) 제안에서 회귀 재검증을 시작한다. 완전 자동 회귀
// 금지(결정 ⑤) — 항상 사용자가 사례를 골라 estimate 확인 스텝을 거친 뒤 수동 실행.
export default function ImproveRegressionPanel() {
  const appliedQuery = useImproveProposals('applied')
  const [target, setTarget] = useState<ImproveProposalListItem | null>(null)
  // 재진입 복원(설계 §4.24 ⑤·ⓓ, F48) — proposal 객체 없이 reg_id만으로도 위저드를 열 수 있다
  // (ImproveRegressionWizard의 proposal? 선택 지원 — resume 모드는 select 단계를 쓰지 않는다).
  const [resumeRegId, setResumeRegId] = useState<string | null>(null)

  useJobRecovery({
    kind: 'improve_regression',
    enabled: !target && !resumeRegId,
    onRecovered: (job) => {
      const rid = job.ref?.reg_id
      if (!rid) return
      setResumeRegId(rid)
    },
  })

  const items = appliedQuery.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        승인 반영된 제안을 골라 과거 실패 사례로 회귀 재검증을 실행할 수 있습니다 — 개선이 실제로
        재발을 막았는지 수치로 확인합니다(LLM 재변환이라 사용량 확인이 필요합니다).
      </p>

      {appliedQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {appliedQuery.isError && <p className="text-sm text-wrong">반영된 제안 목록을 불러오지 못했습니다.</p>}
      {appliedQuery.data && items.length === 0 && (
        <p className="text-sm text-muted">아직 반영된(승인된) 제안이 없습니다.</p>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((p) => (
          <li key={p.proposal_id} className="rounded-lg border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PROPOSAL_KIND_BADGE_CLASS[p.kind]}`}>
                {PROPOSAL_KIND_LABEL[p.kind]}
              </span>
              <span className="text-[11px] text-muted">반영 {formatDate(p.decided_at)}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-primary">{p.title}</p>
            <p className="mt-0.5 text-xs text-muted">근거 사례 {p.case_ids.length}건</p>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setTarget(p)}
                className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
              >
                회귀 재검증
              </button>
            </div>
          </li>
        ))}
      </ul>

      {(target || resumeRegId) && (
        <ImproveRegressionWizard
          proposal={target ?? undefined}
          resumeRegId={target ? undefined : (resumeRegId ?? undefined)}
          onClose={() => {
            setTarget(null)
            setResumeRegId(null)
          }}
          onDone={() => {
            setTarget(null)
            setResumeRegId(null)
          }}
        />
      )}
    </div>
  )
}
