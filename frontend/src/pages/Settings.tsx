import { useEffect, useState } from 'react'
import { useThemeStore } from '../stores/theme'
import type { ThemeMode } from '../stores/theme'
import { useSettings, useUpdateSettings } from '../api/settings'
import { ApiError } from '../api/client'
import DDayManager from '../components/DDayManager'

const OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: '라이트', icon: '☀️' },
  { value: 'dark', label: '다크', icon: '🌙' },
  { value: 'system', label: '시스템', icon: '🖥️' },
]

export default function SettingsPage() {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)

  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()
  const [defaultCount, setDefaultCount] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const value = settingsQuery.data?.['quiz.default_count']
    if (value != null) setDefaultCount(String(value))
  }, [settingsQuery.data])

  function handleSave() {
    const num = Number(defaultCount)
    if (!Number.isFinite(num) || num <= 0) {
      setError('1 이상의 숫자를 입력하세요.')
      return
    }
    setError(null)
    updateSettings.mutate(
      { 'quiz.default_count': num },
      {
        onSuccess: () => {
          setSaved(true)
          window.setTimeout(() => setSaved(false), 1500)
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : '저장에 실패했습니다.'),
      },
    )
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl font-semibold text-primary">설정</h1>

      <section className="mb-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold text-primary">테마</h2>
        <p className="mb-3 text-xs text-muted">
          시스템을 선택하면 OS의 라이트/다크 설정을 따라갑니다.
        </p>
        <div className="flex gap-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-lg border px-3 py-3 text-sm transition-colors ${
                mode === opt.value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-bg text-primary hover:bg-surface-raised'
              }`}
              aria-pressed={mode === opt.value}
            >
              <span className="text-lg" aria-hidden>
                {opt.icon}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold text-primary">퀴즈</h2>
        <p className="mb-3 text-xs text-muted">퀴즈 설정 화면에서 기본으로 채워지는 문항 수입니다.</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={100}
            value={defaultCount}
            onChange={(e) => setDefaultCount(e.target.value)}
            className="w-24 rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={updateSettings.isPending}
            className="rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {saved ? '저장됨' : '저장'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-wrong">{error}</p>}
      </section>

      <DDayManager />

      <p className="mt-4 text-xs text-muted">
        복습 큐 상한 · 백업/복원 · 태그 병합 도구는 이후 단계에서 추가됩니다.
      </p>
    </div>
  )
}
