import { Fragment } from 'react'

// 공용 Stepper (설계 §5.9, F36-⑪ + F37 3단 진도·완료 화면).
// 지나온 ✓=클릭 복귀 · 현재 ●=강조 · 미래 ○=흐림+비클릭+점선 연결 — 전부 토큰 기반.
export type StepStatus = 'done' | 'current' | 'future'

export interface StepperStep {
  key: string
  label: string
  sublabel?: string
  status: StepStatus
}

interface StepperProps {
  steps: StepperStep[]
  // 'done' 단계 클릭 시에만 호출된다(현재·미래는 비클릭). 파괴적 복귀 확인은 호출부 책임.
  onStepClick?: (index: number, step: StepperStep) => void
  size?: 'sm' | 'md'
  className?: string
}

export default function Stepper({ steps, onStepClick, size = 'md', className = '' }: StepperProps) {
  const circle = size === 'sm' ? 'h-6 w-6 text-[11px]' : 'h-8 w-8 text-sm'

  return (
    <ol className={`flex items-start ${className}`} aria-label="진행 단계">
      {steps.map((step, i) => {
        const clickable = step.status === 'done' && onStepClick != null
        return (
          <Fragment key={step.key}>
            {i > 0 && (
              // 연결선: 다음 단계가 미래면 점선+흐림, 아니면 실선 accent — "눌릴 것처럼 보이지 않게".
              <li
                aria-hidden
                className={`mt-3 h-0 flex-1 border-t-2 ${
                  step.status === 'future' ? 'border-dashed border-border' : 'border-solid border-accent'
                }`}
              />
            )}
            <li className="flex shrink-0 flex-col items-center gap-1" style={{ minWidth: 0 }}>
              <button
                type="button"
                disabled={!clickable}
                onClick={clickable ? () => onStepClick?.(i, step) : undefined}
                aria-current={step.status === 'current' ? 'step' : undefined}
                title={clickable ? `${step.label}(으)로 돌아가기` : step.label}
                className={`flex ${circle} items-center justify-center rounded-full border-2 font-semibold transition-colors ${
                  step.status === 'done'
                    ? 'border-accent bg-accent text-on-accent'
                    : step.status === 'current'
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-dashed border-border bg-surface text-muted opacity-60'
                } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
              >
                {step.status === 'done' ? '✓' : step.status === 'current' ? '●' : '○'}
              </button>
              <span
                className={`max-w-[7rem] truncate text-center text-xs ${
                  step.status === 'future' ? 'text-muted opacity-60' : 'font-medium text-primary'
                }`}
                title={step.label}
              >
                {step.label}
              </span>
              {step.sublabel && (
                <span className="text-[11px] text-muted" title={step.sublabel}>
                  {step.sublabel}
                </span>
              )}
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
