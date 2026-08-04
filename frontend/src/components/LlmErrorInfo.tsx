import { useLlmStatus } from '../api/llm'
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
  // S15(설계 §4.17③) — 다음 후보 엔진 id로 재시도한다(과거의 "무조건 API로" 이항 가정 제거).
  // 호출자는 errorInfo.fallback_engine을 그대로 넘기거나, 없으면 undefined를 넘기면 된다 —
  // 이 컴포넌트가 과도기 폴백('api')까지 책임진다(아래 handleRetry).
  onRetry?: (engineId: string) => void
  retrying?: boolean
  // S13(F40-④, 설계 §4.11 `invalid_output`): 출력이 잘려 파싱에 실패한 경우 — 같은 파일로
  // 재시도하면 같은 실패이므로 "원본을 나눠서 다시 올리기"(시작 화면 복귀)를 제공한다.
  onSplitReupload?: () => void
  // S14(설계 §4.13·§5.9 `unsupported_format`): qnet 게시물에 PDF 첨부가 없는 경우 — 원본은
  // sources/에 이미 저장돼 있으므로 파일 반입(F40 대기열)으로 이어가는 버튼을 제공한다.
  onContinueWithFile?: () => void
  // S23(설계 §4.25, F49) — too_large(convert 잡 발생분만 — §4.25 ㉳)의 alternatives에
  // 'split_import'가 실리면 분할 위저드를 여는 버튼을 제공한다.
  onSplitImport?: () => void
}

export default function LlmErrorInfoView({
  errorInfo,
  legacyError,
  onRetry,
  retrying,
  onSplitReupload,
  onContinueWithFile,
  onSplitImport,
}: LlmErrorInfoProps) {
  // 엔진 레지스트리(설계 §4.17②) — 버튼 라벨을 fallback_engine id로 찾는다. 이 훅은 이미
  // status 쿼리 캐시를 공유하므로(LlmEngineSection·LlmLimitBanner와 동일 키) 여기서 별도
  // 요청이 새로 발생하지 않는다.
  const statusQuery = useLlmStatus()
  const fallbackId = errorInfo?.fallback_engine
  // 과도기 규칙(설계 §4.17③에 명시 없음 — 프론트 결정): fallback_engine 필드가 없는 응답에서는
  // 기존 'api' 폴백 동작을 그대로 유지한다.
  const retryEngineId = fallbackId ?? 'api'
  const fallbackLabel = fallbackId
    ? (statusQuery.data?.engines.find((e) => e.id === fallbackId)?.label ?? fallbackId)
    : null

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
      {errorInfo.kind === 'unsupported_format' && (
        <p className="mt-1 text-muted">원본 파일은 sources/ 폴더에 이미 저장되었습니다.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {errorInfo.fallback_available && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(retryEngineId)}
            disabled={retrying}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {retrying ? '재시도 중…' : fallbackLabel ? `${fallbackLabel}로 재시도` : 'API로 재시도'}
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
        {errorInfo.alternatives?.includes('file_import') && onContinueWithFile && (
          <button
            type="button"
            onClick={onContinueWithFile}
            className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
          >
            파일 반입으로 이어가기
          </button>
        )}
        {errorInfo.alternatives?.includes('split_import') && onSplitImport && (
          <button
            type="button"
            onClick={onSplitImport}
            className="rounded border border-border px-3 py-1.5 text-xs text-primary hover:bg-bg"
          >
            분할 반입
          </button>
        )}
      </div>
    </div>
  )
}
