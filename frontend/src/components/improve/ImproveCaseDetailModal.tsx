import { useImproveCase } from '../../api/improve'
import Modal from '../Modal'
import { ORIGIN_LABEL, REGRESSION_OUTCOME_LABEL, kindLabel } from './labels'

// 설계 §4.22 ③ — 제안 카드의 "근거 사례 링크" 클릭 시 사례 상세를 보여준다(재현 정보 —
// detail·source·preview_ref·regressions. 원문 미포함, §4.22 ①).
export default function ImproveCaseDetailModal({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const caseQuery = useImproveCase(caseId)
  const c = caseQuery.data

  return (
    <Modal title={`사례 ${caseId}`} onClose={onClose} widthClass="max-w-lg">
      {caseQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {caseQuery.isError && <p className="text-sm text-wrong">사례를 불러오지 못했습니다(이미 제거되었을 수 있습니다).</p>}
      {c && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              {kindLabel(c.kind)}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
              {ORIGIN_LABEL[c.origin] ?? c.origin}
            </span>
            <span className="text-[11px] text-muted">{c.count}회 · 최근 {formatDate(c.last_seen_at)}</span>
          </div>

          {c.document && (
            <p className="text-xs text-muted">
              문서: {c.document.doc_no} — {c.document.title}
            </p>
          )}
          {c.source && (
            <p className="text-xs text-muted">
              원본: {c.source.filename} ({c.source.hash12})
            </p>
          )}
          {c.preview_ref && <p className="text-xs text-muted">보존 파일: {c.preview_ref}</p>}
          {c.has_llm_output && <p className="text-xs text-muted">LLM 산출물 원문 보존됨(로그 전용, API 미노출)</p>}

          {c.detail && Object.keys(c.detail).length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">상세</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-bg p-2 text-[11px] text-primary">
                {JSON.stringify(c.detail, null, 2)}
              </pre>
            </div>
          )}

          {c.regressions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">회귀 재검증 이력</p>
              <ul className="flex flex-col gap-1">
                {c.regressions.map((r, i) => (
                  <li key={i} className="text-xs text-primary">
                    {formatDate(r.run_at)} — {REGRESSION_OUTCOME_LABEL[r.outcome] ?? r.outcome}
                    {r.detail && <span className="text-muted"> ({r.detail})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
