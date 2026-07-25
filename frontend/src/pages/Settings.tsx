import { useEffect, useState } from 'react'
import { useThemeStore } from '../stores/theme'
import type { ThemeMode } from '../stores/theme'
import { useSettings, useUpdateSettings } from '../api/settings'
import { ApiError } from '../api/client'
import type { FontScale, QuizAutoAdvance } from '../api/types'
import DDayManager from '../components/DDayManager'
import TagRuleManager from '../components/TagRuleManager'
import BackupManager from '../components/BackupManager'
import TagManager from '../components/TagManager'
import SettingsSection from '../components/settings/SettingsSection'
import LlmEngineSection from '../components/settings/LlmEngineSection'

const FONT_SCALE_OPTIONS: { value: FontScale; label: string }[] = [
  { value: 'small', label: '작게' },
  { value: 'default', label: '기본' },
  { value: 'large', label: '크게' },
]

const OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: '라이트', icon: '☀️' },
  { value: 'dark', label: '다크', icon: '🌙' },
  { value: 'system', label: '시스템', icon: '🖥️' },
]

// 설정 화면 6그룹 골격(stage-8 plan §4, F38 선행분) — 학습/일정/태그·분류/LLM 엔진/데이터/화면.
// 기존 항목은 그룹으로 이동만 했을 뿐 내부 재구성은 하지 않는다(세부 재구성·태그 관리자는 M9).
const GROUPS = [
  { id: 'settings-learning', label: '학습' },
  { id: 'settings-schedule', label: '일정' },
  { id: 'settings-tags', label: '태그·분류' },
  { id: 'settings-llm', label: 'LLM 엔진' },
  { id: 'settings-data', label: '데이터' },
  { id: 'settings-display', label: '화면' },
]

export default function SettingsPage() {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)

  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()
  const [defaultCount, setDefaultCount] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dailyLimit, setDailyLimit] = useState('')
  const [srsSaved, setSrsSaved] = useState(false)
  const [srsError, setSrsError] = useState<string | null>(null)

  // F36-⑨⑥ — settings 값 즉시 저장(변경 시 write). 기본값은 default/off.
  const fontScale: FontScale =
    settingsQuery.data?.['study.font_scale'] === 'small' || settingsQuery.data?.['study.font_scale'] === 'large'
      ? settingsQuery.data['study.font_scale']
      : 'default'
  const autoAdvance: QuizAutoAdvance = settingsQuery.data?.['quiz.auto_advance'] === 'on' ? 'on' : 'off'

  useEffect(() => {
    const value = settingsQuery.data?.['quiz.default_count']
    if (value != null) setDefaultCount(String(value))
    const limit = settingsQuery.data?.['srs.daily_limit']
    if (limit != null) setDailyLimit(String(limit))
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

  function handleSaveSrs() {
    const num = Number(dailyLimit)
    if (!Number.isInteger(num) || num <= 0) {
      setSrsError('1 이상의 정수를 입력하세요.')
      return
    }
    setSrsError(null)
    updateSettings.mutate(
      { 'srs.daily_limit': num },
      {
        onSuccess: () => {
          setSrsSaved(true)
          window.setTimeout(() => setSrsSaved(false), 1500)
        },
        onError: (e) => setSrsError(e instanceof ApiError ? e.message : '저장에 실패했습니다.'),
      },
    )
  }

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="mb-4 text-xl font-semibold text-primary">설정</h1>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {/* 좌측 목차 — 데스크톱 스티키, 모바일은 숨김(아코디언 헤더로 대체) */}
        <nav className="hidden shrink-0 md:sticky md:top-4 md:block md:w-40">
          <ul className="flex flex-col gap-0.5 text-sm">
            {GROUPS.map((g) => (
              <li key={g.id}>
                <a
                  href={`#${g.id}`}
                  className="block rounded px-2 py-1.5 text-muted hover:bg-surface hover:text-primary"
                >
                  {g.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <SettingsSection id="settings-learning" title="학습">
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-primary">퀴즈</h3>
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

            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-primary">복습 상한</h3>
              <p className="mb-3 text-xs text-muted">
                하루에 "오늘의 복습" 큐에 나타나는 최대 항목 수입니다 (기본 30).
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                  className="w-24 rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handleSaveSrs}
                  disabled={updateSettings.isPending}
                  className="rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                >
                  {srsSaved ? '저장됨' : '저장'}
                </button>
              </div>
              {srsError && <p className="mt-2 text-sm text-wrong">{srsError}</p>}
            </section>

            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-primary">본문 글자 크기</h3>
              <p className="mb-3 text-xs text-muted">문서 상세·학습 모드의 본문 크기입니다.</p>
              <div className="flex gap-2">
                {FONT_SCALE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateSettings.mutate({ 'study.font_scale': opt.value })}
                    aria-pressed={fontScale === opt.value}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      fontScale === opt.value
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border bg-bg text-primary hover:bg-surface-raised'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-primary">정답 시 자동 다음</h3>
              <p className="mb-3 text-xs text-muted">
                퀴즈에서 정답을 맞히면 1.5초 뒤 자동으로 다음 문제로 넘어갑니다 (오답은 항상 정지).
              </p>
              <label className="flex items-center gap-2 text-sm text-primary">
                <input
                  type="checkbox"
                  checked={autoAdvance === 'on'}
                  onChange={(e) => updateSettings.mutate({ 'quiz.auto_advance': e.target.checked ? 'on' : 'off' })}
                />
                정답 자동 다음 사용
              </label>
            </section>
          </SettingsSection>

          <SettingsSection id="settings-schedule" title="일정">
            <DDayManager />
          </SettingsSection>

          <SettingsSection id="settings-tags" title="태그·분류">
            <TagRuleManager />
            <TagManager />
          </SettingsSection>

          <SettingsSection id="settings-llm" title="LLM 엔진">
            <LlmEngineSection />
          </SettingsSection>

          <SettingsSection id="settings-data" title="데이터">
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-primary">학습 기록 내보내기</h3>
              <p className="mb-3 text-xs text-muted">
                풀이 기록(attempts)과 문서·분류 메타를 CSV로 내보냅니다.
              </p>
              <a
                href="/api/stats/export?format=csv"
                download
                className="inline-block rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
              >
                CSV 다운로드
              </a>
            </section>

            <BackupManager />
          </SettingsSection>

          <SettingsSection id="settings-display" title="화면">
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-primary">테마</h3>
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
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}
