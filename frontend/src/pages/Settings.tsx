import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useThemeStore } from '../stores/theme'
import type { ThemeMode } from '../stores/theme'
import { useSettings, useUpdateSettings } from '../api/settings'
import { srsKeys } from '../api/srs'
import { streakKeys } from '../api/stats'
import { api, ApiError } from '../api/client'
import type { FontScale, QuizAutoAdvance } from '../api/types'
import DDayManager from '../components/DDayManager'
import TagRuleManager from '../components/TagRuleManager'
import BackupManager from '../components/BackupManager'
import TagManager from '../components/TagManager'
import SettingsSection from '../components/settings/SettingsSection'
import LlmEngineSection from '../components/settings/LlmEngineSection'
import QnetKeySection from '../components/settings/QnetKeySection'
import ThemeCustomSection from '../components/settings/ThemeCustomSection'

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
  const qc = useQueryClient()
  const [defaultCount, setDefaultCount] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dailyLimit, setDailyLimit] = useState('')
  const [srsSaved, setSrsSaved] = useState(false)
  const [srsError, setSrsError] = useState<string | null>(null)

  // 일일 목표 (설계 §4.13·§5.11, S10, F26) — 비움/0 = 목표 없음.
  const [goalQuestions, setGoalQuestions] = useState('')
  const [goalMinutes, setGoalMinutes] = useState('')
  const [goalSaved, setGoalSaved] = useState(false)
  const [goalError, setGoalError] = useState<string | null>(null)

  // F36-⑨⑥ — settings 값 즉시 저장(변경 시 write). 기본값은 default/off.
  const fontScale: FontScale =
    settingsQuery.data?.['study.font_scale'] === 'small' || settingsQuery.data?.['study.font_scale'] === 'large'
      ? settingsQuery.data['study.font_scale']
      : 'default'
  const autoAdvance: QuizAutoAdvance = settingsQuery.data?.['quiz.auto_advance'] === 'on' ? 'on' : 'off'
  // S11(F16) — D-Day 복습 강화 토글, 기본 on(§4.14 발동 조건: 값이 'off'일 때만 미발동).
  const ddayBoostOn = settingsQuery.data?.['srs.dday_boost'] !== 'off'

  useEffect(() => {
    const value = settingsQuery.data?.['quiz.default_count']
    if (value != null) setDefaultCount(String(value))
    const limit = settingsQuery.data?.['srs.daily_limit']
    if (limit != null) setDailyLimit(String(limit))
    const gq = settingsQuery.data?.['goal.daily_questions']
    setGoalQuestions(gq != null && gq > 0 ? String(gq) : '')
    const gm = settingsQuery.data?.['goal.daily_minutes']
    setGoalMinutes(gm != null && gm > 0 ? String(gm) : '')
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

  // 비움/0 = 목표 없음(§4.13) — 음수·비정수만 오류로 막는다.
  function parseGoalInput(raw: string): number | null {
    if (raw.trim() === '') return 0
    const num = Number(raw)
    if (!Number.isInteger(num) || num < 0) return null
    return num
  }

  function handleSaveGoals() {
    const questions = parseGoalInput(goalQuestions)
    const minutes = parseGoalInput(goalMinutes)
    if (questions === null || minutes === null) {
      setGoalError('0 이상의 정수를 입력하세요 (비우면 목표 없음).')
      return
    }
    setGoalError(null)
    updateSettings.mutate(
      { 'goal.daily_questions': questions, 'goal.daily_minutes': minutes },
      {
        onSuccess: () => {
          setGoalSaved(true)
          window.setTimeout(() => setGoalSaved(false), 1500)
          // 저장 시 스트릭·히트맵 위젯 invalidate (설계 §5.11 — 목표가 홈·복습 화면에 즉시 반영)
          qc.invalidateQueries({ queryKey: streakKeys.all })
          qc.invalidateQueries({ queryKey: ['stats', 'heatmap'] })
        },
        onError: (e) => setGoalError(e instanceof ApiError ? e.message : '저장에 실패했습니다.'),
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
          {/* 매뉴얼 링크(S12, F39, 설계 §5.11) — 목차 하단, 7번째 그룹이 아닌 단순 링크(F38 6그룹 불변) */}
          <div className="mt-2 border-t border-border pt-2">
            <a
              href="/manual"
              target="_blank"
              rel="noopener"
              className="block rounded px-2 py-1.5 text-sm text-muted hover:bg-surface hover:text-primary"
            >
              사용 설명서 열기 ↗
            </a>
          </div>
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

            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-primary">일일 목표</h3>
              <p className="mb-3 text-xs text-muted">
                비우거나 0으로 두면 목표 없음입니다. 시간은 문제 풀이 시간 기준입니다(개념 열람 시간은
                포함되지 않습니다).
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  하루 문제 수
                  <input
                    type="number"
                    min={0}
                    value={goalQuestions}
                    onChange={(e) => setGoalQuestions(e.target.value)}
                    placeholder="없음"
                    className="w-24 rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  하루 학습 시간(분)
                  <input
                    type="number"
                    min={0}
                    value={goalMinutes}
                    onChange={(e) => setGoalMinutes(e.target.value)}
                    placeholder="없음"
                    className="w-24 rounded border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleSaveGoals}
                  disabled={updateSettings.isPending}
                  className="rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                >
                  {goalSaved ? '저장됨' : '저장'}
                </button>
              </div>
              {goalError && <p className="mt-2 text-sm text-wrong">{goalError}</p>}
            </section>

            {/* D-Day 복습 강화 토글 (설계 §5.11, S11 F16) */}
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-primary">D-Day 복습 강화</h3>
              <p className="mb-3 text-xs text-muted">
                시험 14일 전부터 복습 상한을 늘리고 임박 시험 범위를 우선합니다.
              </p>
              <label className="flex items-center gap-2 text-sm text-primary">
                <input
                  type="checkbox"
                  checked={ddayBoostOn}
                  onChange={(e) => {
                    updateSettings.mutate(
                      { 'srs.dday_boost': e.target.checked ? 'on' : 'off' },
                      {
                        onSuccess: () => {
                          qc.invalidateQueries({ queryKey: srsKeys.today })
                          qc.invalidateQueries({ queryKey: srsKeys.summary })
                          qc.invalidateQueries({ queryKey: ['dashboard'] })
                        },
                      },
                    )
                  }}
                />
                D-Day 복습 강화 사용
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

            {/* 큐넷 오픈API 서비스키 카드 — 설계 §4.13·§5.11(S14). 데이터 유입(반입 소스) 계열이라
                이 그룹에 카드로만 추가한다(F38 6그룹 수 불변 — 7번째 그룹 아님). */}
            <QnetKeySection />
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

            {/* 전역 테마 편집(S28 — F53 ①, §4.26 ③) — F38 6그룹 수 불변, 그룹 내 카드 추가만. */}
            <ThemeCustomSection />

            {/* stage-43 F-3 — 실험실(베타) 카드(S33 도입) 제거. 퇴로 토글은 소멸했고, 노트 진입은
                정식 승격(G-1)으로 사이드바·모바일 드로어 '노트' 항목이 대신한다(§5.16 정식 표면 —
                더 이상 이 카드가 유일한 진입점이 아니다). F38 6그룹 수 불변(카드 1개만 감소). */}
          </SettingsSection>

          {/* 모바일(<768px, 사이드바 없음) 전용 매뉴얼 진입 경로 — 아코디언 하단(§5.11) */}
          <div className="border-t border-border pt-4 md:hidden">
            <a
              href="/manual"
              target="_blank"
              rel="noopener"
              className="block rounded px-2 py-1.5 text-sm text-muted hover:bg-surface hover:text-primary"
            >
              사용 설명서 열기 ↗
            </a>
          </div>

          <AppVersionLine />
        </div>
      </div>
    </div>
  )
}

// 앱 버전 표시(stage-45 결정 ④) — 단일 출처는 루트 VERSION 파일이고 서버가
// `/api/app-version`의 `version` 필드로 알려준다. 구버전 서버·파일 부재 등으로
// version이 없으면 줄 자체를 그리지 않는다(표시용 부가 정보 — 실패 허용).
function AppVersionLine() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api
      .get<{ asset: string | null; version?: string | null }>('/app-version')
      .then((res) => {
        if (!cancelled && res.version) setVersion(res.version)
      })
      .catch(() => {}) // 서버 응답 불가 — 조용히 생략
    return () => {
      cancelled = true
    }
  }, [])
  if (!version) return null
  return (
    <p className="pt-2 text-center text-xs text-muted">Study Hub v{version}</p>
  )
}
