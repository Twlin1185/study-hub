import { useState } from 'react'
import { useLlmStatus } from '../api/llm'
import EngineSelect, { type EngineSelectProps } from './EngineSelect'

// stage-55(규약 C) — 엔진 블록 요약 1줄 + [변경]. EngineSelect는 무변, 접힘 상태는 로컬(저장 0).
// 강제 펼침: ⓐ auto인데 해석 가능한 엔진 0 ⓑ 선택 구체 엔진이 available/enabled false.
type Props = Pick<EngineSelectProps, 'value' | 'onChange' | 'modelValue' | 'onModelChange'>

export default function EngineSelectCollapsible({ value, onChange, modelValue, onModelChange }: Props) {
  const [open, setOpen] = useState(false)
  const statusQuery = useLlmStatus()
  const status = statusQuery.data

  if (!status) {
    return <p className="text-xs text-muted">사용 엔진: 확인 중…</p>
  }

  const engines = status.engines
  let summary: string
  let forced = false
  if (value === 'auto') {
    const resolved = status.priority
      .map((id) => engines.find((e) => e.id === id))
      .find((e) => e && e.available && e.enabled)
    if (!resolved) forced = true
    summary = `자동 → ${resolved ? resolved.label : '사용 가능한 엔진 없음'}`
  } else {
    const eng = engines.find((e) => e.id === value)
    if (eng && (!eng.available || !eng.enabled)) forced = true
    summary = eng ? eng.label : String(value)
    if (eng && modelValue) {
      summary += ` · ${eng.models.find((m) => m.id === modelValue)?.label ?? modelValue}`
    }
  }

  const expanded = open || forced
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-muted">사용 엔진{expanded ? '' : `: ${summary}`}</span>
        {!forced && (
          <button type="button" onClick={() => setOpen(!open)} className="text-xs text-accent hover:underline">
            {expanded ? '접기' : '변경'}
          </button>
        )}
      </div>
      {expanded && (
        <EngineSelect value={value} onChange={onChange} modelValue={modelValue} onModelChange={onModelChange} />
      )}
    </div>
  )
}
