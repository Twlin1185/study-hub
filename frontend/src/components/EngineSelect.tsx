import { useLlmStatus, useRefreshLlmStatus } from '../api/llm'
import type { LlmEngine, LlmEngineStatus } from '../api/types'

// 설계 §4.23 ⓒ(F47, S21) — 엔진 선택이 노출되는 모든 화면(반입 시작·FetchImportWizard 사용량
// 확인·AI 응용 탭·F44 답지/explain·F46 개선·회귀 위저드)이 이 컴포넌트 1개로 수렴한다
// (개별 구현 금지). status.engines를 그대로 파생 렌더 — `available:false`·`enabled:false`는
// 선택 불가(비활성 표시) + 사유 1줄 + [다시 확인](기존 F34 재진단 경로 재사용, 신규 API 0).
//
// 게이팅 사유 라벨 4종(프론트 파생 — §4.23 결정, null 필드 미렌더 관례 연장):
//   enabled:false(우선) → "사용 안 함" · installed:false → "설치 필요" ·
//   logged_in:false → "로그인 필요" · key_registered:false → "키 미등록"
function gateReason(engine: LlmEngineStatus): string | null {
  if (!engine.enabled) return '사용 안 함'
  if (engine.available) return null
  if (engine.installed === false) return '설치 필요'
  if (engine.logged_in === false) return '로그인 필요'
  if (engine.key_registered === false) return '키 미등록'
  return '사용할 수 없음'
}

export interface EngineSelectProps {
  value: LlmEngine
  onChange: (value: LlmEngine) => void
  // 'auto' 옵션 노출 여부 — 대부분의 시작 화면은 기본값으로 유지(자동 = 우선순위 설정 따름).
  includeAuto?: boolean
  // billing 값('subscription'|'metered')별 표시 문구 — 호출부가 기존 문구를 그대로 넘긴다
  // (컴포넌트 통합이 기존 카피 변경을 강제하지 않도록).
  billingLabels?: Record<string, string>
  disabled?: boolean
  className?: string
}

export default function EngineSelect({
  value,
  onChange,
  includeAuto = true,
  billingLabels,
  disabled,
  className,
}: EngineSelectProps) {
  const statusQuery = useLlmStatus()
  const refreshStatus = useRefreshLlmStatus()
  const engines = statusQuery.data?.engines ?? []

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {includeAuto && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('auto')}
          aria-pressed={value === 'auto'}
          className={`w-fit rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
            value === 'auto' ? 'bg-accent text-on-accent' : 'bg-bg text-muted hover:bg-surface-raised'
          }`}
        >
          자동
        </button>
      )}
      {engines.map((engine) => {
        const reason = gateReason(engine)
        const gated = reason != null
        const billingLabel = billingLabels?.[engine.billing]
        return (
          <div key={engine.id} className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled || gated}
              onClick={() => onChange(engine.id)}
              aria-pressed={value === engine.id}
              className={`w-fit rounded-full px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                value === engine.id ? 'bg-accent text-on-accent' : 'bg-bg text-muted hover:bg-surface-raised'
              }`}
            >
              {engine.label}
              {billingLabel && ` · ${billingLabel}`}
            </button>
            {gated && (
              <>
                <span className="text-[11px] text-warning">{reason}</span>
                <button
                  type="button"
                  onClick={() => refreshStatus.mutate()}
                  disabled={refreshStatus.isPending}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-primary hover:bg-bg disabled:opacity-50"
                >
                  {refreshStatus.isPending ? '확인 중…' : '다시 확인'}
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
