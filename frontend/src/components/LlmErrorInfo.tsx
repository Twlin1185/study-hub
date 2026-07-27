import type { LlmErrorInfo as LlmErrorInfoType, LlmLimitKind } from '../api/types'

// 설계 §4.11 오류 구조화 — convert/regenerate 잡 실패 시 error_info를 사람이 읽는 문구로 렌더한다.
// CLI/API 원문 JSON은 절대 노출하지 않는다. error_info가 없는 구 형식(error 문자열만)은 기존
// 안내를 유지하되, JSON 덩어리처럼 보이는 문자열은 그대로 뿌리지 않고 일반 메시지로 대체한다.
const LIMIT_KIND_LABEL: Record<LlmLimitKind, string> = {
  session: '세션',
  daily: '일간',
  weekly: '주간',
  model: '모델',
  overall: '전체',
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function sanitizeLegacyMessage(raw: string | null | undefined): string {
  if (!raw) return '알 수 없는 오류가 발생했습니다.'
  const trimmed = raw.trim()
  const looksLikeRawDump = trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.length > 300
  return looksLikeRawDump ? '처리 중 오류가 발생했습니다 (자세한 원인은 서버 로그를 확인하세요).' : trimmed
}

interface LlmErrorInfoProps {
  errorInfo: LlmErrorInfoType | null | undefined
  legacyError?: string | null
  onRetryWithApi?: () => void
  retrying?: boolean
  // S13(F40-④, 설계 §4.11 `invalid_output`): 출력이 잘려 파싱에 실패한 경우 — 같은 파일로
  // 재시도하면 같은 실패이므로 "원본을 나눠서 다시 올리기"(시작 화면 복귀)를 제공한다.
  onSplitReupload?: () => void
}

export default function LlmErrorInfoView({
  errorInfo,
  legacyError,
  onRetryWithApi,
  retrying,
  onSplitReupload,
}: LlmErrorInfoProps) {
  if (!errorInfo) {
    return (
      <div className="rounded border border-wrong bg-surface px-3 py-2 text-sm">
        <p className="font-medium text-wrong">처리에 실패했습니다.</p>
        <p className="mt-1 text-muted">{sanitizeLegacyMessage(legacyError)}</p>
      </div>
    )
  }

  return (
    <div className="rounded border border-wrong bg-surface px-3 py-2 text-sm">
      <p className="font-medium text-wrong">{errorInfo.message}</p>
      {errorInfo.kind === 'rate_limit' && errorInfo.limit_kind && (
        <p className="mt-1 text-muted">
          {LIMIT_KIND_LABEL[errorInfo.limit_kind]} 한도 초과
          {errorInfo.resets_at && ` — ${formatDateTime(errorInfo.resets_at)} 리셋 예정`}
        </p>
      )}
      <p className="mt-1 text-muted">{errorInfo.action}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {errorInfo.fallback_available && onRetryWithApi && (
          <button
            type="button"
            onClick={onRetryWithApi}
            disabled={retrying}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {retrying ? '재시도 중…' : 'API로 재시도'}
          </button>
        )}
        {errorInfo.kind === 'invalid_output' && onSplitReupload && (
          <button
            type="button"
            onClick={onSplitReupload}
            className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
          >
            파일 나눠서 다시 올리기
          </button>
        )}
      </div>
    </div>
  )
}
