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
  // S22(설계 §4.24 ④, F48) — 요청 단위 모델 오버라이드. value가 구체 엔진이고 그 엔진의 models
  // 소목록이 비어 있지 않을 때만 소목록 select를 노출한다(auto·소목록 빈 엔진(codex-cli)은
  // 미노출 — 자유 입력 없음 유지, §4.23 결정 재확인). null/undefined = "설정값" 선택.
  // 사용처가 modelValue·onModelChange를 넘기지 않으면(기존 7곳 이외 호출부) 이 select 자체가
  // 렌더되지 않아 기존 화면 동작이 완전히 불변이다.
  modelValue?: string | null
  onModelChange?: (model: string | null) => void
}

export default function EngineSelect({
  value,
  onChange,
  includeAuto = true,
  billingLabels,
  disabled,
  className,
  modelValue,
  onModelChange,
}: EngineSelectProps) {
  const statusQuery = useLlmStatus()
  const refreshStatus = useRefreshLlmStatus()
  const engines = statusQuery.data?.engines ?? []

  // 현재 선택된 구체 엔진 — auto·미매칭(legacy 'cli'|'api' 별칭 등)이면 null이라 모델 select가
  // 자연히 미노출된다(엔진을 먼저 선택해야 모델을 고를 수 있다, §4.24 ④ 규칙 (a)와 정합).
  const selectedEngine = value !== 'auto' ? (engines.find((e) => e.id === value) ?? null) : null

  function handleEngineChange(next: LlmEngine) {
    onChange(next)
    // 엔진이 바뀌면 이전 엔진의 모델 id를 들고 있지 않도록 초기화(다른 엔진에 남의 모델 id를
    // 전달하는 사고 경로 차단 — §4.23 [중요①] 폴백 시 모델 재산출 관례와 같은 정신).
    onModelChange?.(null)
  }

  function modelLabel(engine: LlmEngineStatus, modelId: string | null): string {
    if (!modelId) return '기본값'
    return engine.models.find((m) => m.id === modelId)?.label ?? modelId
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {includeAuto && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleEngineChange('auto')}
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
              onClick={() => handleEngineChange(engine.id)}
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

      {onModelChange && selectedEngine && selectedEngine.models.length > 0 && (
        <label className="flex w-fit flex-col gap-1 pl-1 text-[11px] text-muted">
          모델
          <select
            value={modelValue ?? ''}
            disabled={disabled}
            onChange={(e) => onModelChange(e.target.value || null)}
            className="rounded border border-border bg-bg px-2 py-1 text-xs text-primary outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">
              설정값(현재: {modelLabel(selectedEngine, selectedEngine.selected_model ?? selectedEngine.default_model)})
            </option>
            {selectedEngine.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
