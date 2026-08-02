import { useState } from 'react'
import { useApplyImproveProposal, useImproveProposal, useRejectImproveProposal } from '../../api/improve'
import { ApiError } from '../../api/client'
import Modal from '../Modal'
import ImproveCaseDetailModal from './ImproveCaseDetailModal'
import { PROPOSAL_KIND_BADGE_CLASS, PROPOSAL_KIND_LABEL } from './labels'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

interface ImproveProposalDetailModalProps {
  proposalId: string
  onClose: () => void
  // apply/reject 성공 시 호출 — 호출부가 목록을 새로고침하고 모달을 닫을 수 있게 한다.
  onDecided?: () => void
}

// 설계 §4.22 ③(F46, S20) — 제안 상세: payload 전문 + 적용 미리보기(승인 전에 반영 결과 전문을
// 본다 — R8 미리보기 승인 관례). apply가 이 기능의 유일한 파일 쓰기 경로다.
export default function ImproveProposalDetailModal({ proposalId, onClose, onDecided }: ImproveProposalDetailModalProps) {
  const proposalQuery = useImproveProposal(proposalId)
  const applyMutation = useApplyImproveProposal()
  const rejectMutation = useRejectImproveProposal()
  const [openCaseId, setOpenCaseId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const p = proposalQuery.data

  function handleApply() {
    applyMutation.mutate(proposalId, { onSuccess: onDecided })
  }

  function handleReject() {
    rejectMutation.mutate(proposalId, { onSuccess: onDecided })
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 클립보드 API 미지원/권한 거부 — 무음 실패, 사용자는 텍스트를 직접 선택해 복사할 수 있다.
    }
  }

  const isPending = p?.status === 'pending'
  const submitting = applyMutation.isPending || rejectMutation.isPending
  const actionError = applyMutation.isError
    ? errMsg(applyMutation.error, '승인 반영에 실패했습니다.')
    : rejectMutation.isError
      ? errMsg(rejectMutation.error, '거절에 실패했습니다.')
      : null

  return (
    <Modal title="개선 제안" onClose={onClose} widthClass="max-w-2xl">
      {proposalQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {proposalQuery.isError && (
        <p className="text-sm text-wrong">{errMsg(proposalQuery.error, '제안을 불러오지 못했습니다.')}</p>
      )}

      {p && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PROPOSAL_KIND_BADGE_CLASS[p.kind]}`}>
                {PROPOSAL_KIND_LABEL[p.kind]}
              </span>
              {!isPending && (
                <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                  상태: {p.status}
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-primary">{p.title}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{p.rationale}</p>
          </div>

          {p.case_ids.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">근거 사례</p>
              <div className="flex flex-wrap gap-1.5">
                {p.case_ids.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOpenCaseId(id)}
                    className="rounded border border-border px-2 py-0.5 text-[11px] text-accent hover:bg-bg"
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 적용 미리보기 — kind별 승인 전 전문 확인(R8 관례) */}
          {p.kind === 'casebook' && p.payload.entry_markdown && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">사례집에 추가될 엔트리 전문</p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-bg p-3 text-xs text-primary">
                {p.payload.entry_markdown}
              </pre>
            </div>
          )}

          {p.kind === 'prompt_edit' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-muted">정책 잠금 검증</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    p.policy_check === 'violation' ? 'bg-wrong text-on-accent' : 'bg-correct text-on-accent'
                  }`}
                >
                  {p.policy_check === 'violation' ? '위반(반영 불가)' : '통과'}
                </span>
              </div>
              {p.policy_check === 'violation' && (
                <p className="text-xs text-wrong">
                  잠금 구간(정책 문장)을 건드리는 수정은 반영할 수 없습니다 — 거절해 주세요.
                </p>
              )}

              {(p.payload.hunks ?? []).map((h, i) => (
                <div key={i} className="rounded border border-border bg-bg p-2">
                  <p className="mb-1 text-[11px] font-semibold text-muted">헝크 {i + 1}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <p className="mb-0.5 text-[11px] text-wrong">변경 전</p>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-wrong bg-surface p-2 text-[11px] text-primary">
                        {h.before}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-0.5 text-[11px] text-correct">변경 후</p>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-correct bg-surface p-2 text-[11px] text-primary">
                        {h.after}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}

              {p.preview_after && (
                <details className="rounded border border-border bg-bg p-2">
                  <summary className="cursor-pointer text-xs font-semibold text-muted">
                    적용 후 convert.md 전문 보기
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] text-primary">
                    {p.preview_after}
                  </pre>
                </details>
              )}
            </div>
          )}

          {p.kind === 'code_issue' && p.payload.repro_markdown && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-semibold text-muted">재현 패키지</p>
                <button
                  type="button"
                  onClick={() => handleCopy(p.payload.repro_markdown ?? '')}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-primary hover:bg-bg"
                >
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
              <p className="mb-2 text-xs text-muted">
                코드 결함은 앱이 자동으로 고치지 않습니다 — 아래 재현 패키지를 개발 세션에 복사해
                전달하세요.
              </p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-bg p-3 text-xs text-primary">
                {p.payload.repro_markdown}
              </pre>
            </div>
          )}

          {actionError && <p className="text-sm text-wrong">{actionError}</p>}

          {isPending && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleReject}
                className="rounded border border-border px-4 py-2 text-sm text-primary hover:bg-bg disabled:opacity-50"
              >
                거절
              </button>
              <button
                type="button"
                disabled={submitting || (p.kind === 'prompt_edit' && p.policy_check === 'violation')}
                onClick={handleApply}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? '처리 중…' : p.kind === 'code_issue' ? '인계 완료' : '승인 반영'}
              </button>
            </div>
          )}
        </div>
      )}

      {openCaseId && <ImproveCaseDetailModal caseId={openCaseId} onClose={() => setOpenCaseId(null)} />}
    </Modal>
  )
}
