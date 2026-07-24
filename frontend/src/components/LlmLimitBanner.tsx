import { useLlmStatus } from '../api/llm'

// 설계 §4.11 "한도 기억" — 최근 429의 {kind, resets_at}이 status 응답의 limit에 남아있는 동안,
// 리셋 전 변환 시도 시 시작 전에 경고 배너를 보여준다(stage-8 plan §4).
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

export default function LlmLimitBanner() {
  const statusQuery = useLlmStatus()
  const limit = statusQuery.data?.limit
  if (!limit) return null
  if (new Date(limit.resets_at).getTime() <= Date.now()) return null

  const apiAvailable = statusQuery.data?.api.key_registered

  return (
    <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
      한도 초과 상태입니다 — {formatDateTime(limit.resets_at)} 리셋 예정.{' '}
      {apiAvailable
        ? 'API 엔진은 계속 사용할 수 있습니다.'
        : '설정 > LLM 엔진에서 API 키를 등록하면 계속 변환할 수 있습니다.'}
    </div>
  )
}
