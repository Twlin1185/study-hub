import { useLlmStatus } from '../api/llm'
import type { LlmEngineStatus } from '../api/types'

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

  // S15(설계 §4.17②) — limit 계약은 {kind, resets_at}만 담고 어느 엔진이 걸렸는지는 노출하지
  // 않는다(필드명·타입 불변, 특정 엔진 하드코딩 금지 대상 — DoD 4). 실사용 대부분은
  // engine:'auto'가 priority[0]으로 해석되므로, priority[0]을 한도에 걸린 엔진으로 간주하고
  // 그 다음 자리부터 첫 available 엔진을 찾는다(우선순위 순 — CLI형은 installed+logged_in,
  // API형은 key_registered로 이미 계산된 available 필드를 그대로 신뢰).
  const priority = statusQuery.data?.priority ?? []
  const engines = statusQuery.data?.engines ?? []
  const orderedEngines = priority
    .map((id) => engines.find((e) => e.id === id))
    .filter((e): e is LlmEngineStatus => e != null)
  const nextCandidate = orderedEngines.slice(1).find((e) => e.available) ?? null

  return (
    <div className="rounded border border-warning bg-accent-soft px-3 py-2 text-sm text-primary">
      한도 초과 상태입니다 — {formatDateTime(limit.resets_at)} 리셋 예정.{' '}
      {nextCandidate
        ? `『${nextCandidate.label}』로 계속 변환할 수 있습니다.`
        : '설정 > LLM 엔진에서 다른 엔진을 준비하면 계속 변환할 수 있습니다.'}
    </div>
  )
}
