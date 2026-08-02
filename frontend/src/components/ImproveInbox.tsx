import { useState } from 'react'
import { useImproveProposals } from '../api/improve'
import ImproveCaseList from './improve/ImproveCaseList'
import ImproveProposalList from './improve/ImproveProposalList'
import ImproveRegressionPanel from './improve/ImproveRegressionPanel'

type Section = 'cases' | 'proposals' | 'regression'

// 설계 §4.22 ③(F46, S20) — 제안함 [반입 개선] 탭. 실패 사례 목록(자동 수집·비용 0) → 개선 제안
// 생성(수동 + estimate 확인) → 제안 카드 승인/거절(유일한 파일 쓰기) → 반영된 제안의 회귀
// 재검증(수동 + estimate 확인) 순서를 세 섹션으로 나눠 보여준다(모바일 우선 — 세그먼트 전환).
export default function ImproveInbox() {
  const [section, setSection] = useState<Section>('cases')
  const pendingProposalsQuery = useImproveProposals('pending')
  const pendingCount = pendingProposalsQuery.data?.length ?? 0

  const tabs: { key: Section; label: string; badge?: number }[] = [
    { key: 'cases', label: '실패 사례' },
    { key: 'proposals', label: '제안', badge: pendingCount || undefined },
    { key: 'regression', label: '회귀 재검증' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSection(t.key)}
            aria-pressed={section === t.key}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
              section === t.key ? 'bg-accent text-on-accent' : 'bg-bg text-muted hover:bg-surface-raised'
            }`}
          >
            {t.label}
            {t.badge != null && (
              <span className="rounded-full bg-wrong px-1.5 py-0.5 text-[10px] font-semibold leading-none text-on-accent">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {section === 'cases' && <ImproveCaseList onProposalsGenerated={() => setSection('proposals')} />}
      {section === 'proposals' && <ImproveProposalList />}
      {section === 'regression' && <ImproveRegressionPanel />}
    </div>
  )
}
