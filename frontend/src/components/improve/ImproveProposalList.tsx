import { useState } from 'react'
import { useImproveProposals } from '../../api/improve'
import ImproveProposalDetailModal from './ImproveProposalDetailModal'
import { PROPOSAL_KIND_BADGE_CLASS, PROPOSAL_KIND_LABEL } from './labels'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

// 설계 §4.22 ③(F46, S20) — 제안 카드 목록(대기 중). 카드 = kind 배지 + title + rationale +
// 근거 사례 링크. 상세(적용 미리보기 + 승인/거절)는 모달로 연다.
export default function ImproveProposalList() {
  const proposalsQuery = useImproveProposals('pending')
  const [openId, setOpenId] = useState<string | null>(null)

  const items = proposalsQuery.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        생성된 개선 제안입니다. 승인해야만 사례집·프롬프트 파일에 반영됩니다 — 승인 전에 반영 결과
        전문을 먼저 확인하세요.
      </p>

      {proposalsQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {proposalsQuery.isError && <p className="text-sm text-wrong">제안 목록을 불러오지 못했습니다.</p>}
      {proposalsQuery.data && items.length === 0 && (
        <p className="text-sm text-muted">대기 중인 개선 제안이 없습니다.</p>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((p) => (
          <li key={p.proposal_id}>
            <button
              type="button"
              onClick={() => setOpenId(p.proposal_id)}
              className="flex w-full flex-col items-start gap-1 rounded-lg border border-border bg-surface p-3 text-left hover:bg-surface-raised"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PROPOSAL_KIND_BADGE_CLASS[p.kind]}`}>
                  {PROPOSAL_KIND_LABEL[p.kind]}
                </span>
                <span className="text-[11px] text-muted">{formatDate(p.created_at)}</span>
              </div>
              <p className="text-sm font-medium text-primary">{p.title}</p>
              <p className="line-clamp-2 text-xs text-muted">{p.rationale}</p>
              {p.case_ids.length > 0 && (
                <p className="text-[11px] text-muted">근거 사례 {p.case_ids.length}건</p>
              )}
            </button>
          </li>
        ))}
      </ul>

      {openId && (
        <ImproveProposalDetailModal
          proposalId={openId}
          onClose={() => setOpenId(null)}
          onDecided={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
