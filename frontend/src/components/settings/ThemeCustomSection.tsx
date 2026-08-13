import { useEffect, useState } from 'react'
import { useSettings, useUpdateSettings } from '../../api/settings'
import { ApiError } from '../../api/client'
import { CONTRAST_MIN, CONTRAST_MIN_MUTED, contrastRatio, isValidHex, pickReadableOnColor } from '../../utils/color'
import {
  DEFAULT_TOKEN_VALUES,
  INK_HEX,
  THEME_PALETTE_LABEL,
  THEME_PALETTE_OPTIONS,
  THEME_PRESETS,
  findPresetId,
  type ThemeTab,
} from '../../utils/themeCustomPresets'
import { isSafeThemeMode } from '../../utils/themeCustomInject'
import type { DocSize, ThemeCustom, ThemeCustomPalette } from '../../api/types'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

const FONT_TAB_OPTIONS: { value: NonNullable<ThemeCustomPalette['font']>; label: string }[] = [
  { value: 'sans', label: '고딕(sans)' },
  { value: 'serif', label: '명조(serif)' },
  { value: 'mono', label: '고정폭(mono)' },
]

// 검토 치명-1 수정: 서버 키는 fontSize가 아니라 size, 문서 스타일과 동일한 4단계(DocSize).
const FONT_SIZE_OPTIONS: { value: DocSize; label: string }[] = [
  { value: 'small', label: '작게' },
  { value: 'default', label: '기본' },
  { value: 'large', label: '크게' },
  { value: 'xl', label: '아주 크게' },
]

// 미리보기 인라인 스타일용 px 매핑 — utils/themeCustomInject.ts의 FONT_SIZE_PX와 값 동기.
const PREVIEW_FONT_SIZE_PX: Record<DocSize, string> = {
  small: '14px',
  default: '16px',
  large: '18px',
  xl: '20px',
}

// 전역 앱 테마 편집(F53 ①, 설계 §4.26 ③ · screens §5.11 S28 · 백엔드 settings_service.py 대조
// 완료) — 라이트·다크 각각 편집, 프리셋 + 커스텀. 배경·서피스는 자유 색(대비 자동 검증) ·
// 글자색·강조색은 F52 팔레트 7색 이름만(자유 hex 금지 — 서버 THEME_PALETTE_NAMES와 동일 집합).
export default function ThemeCustomSection() {
  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()

  const [tab, setTab] = useState<ThemeTab>('light')
  const [draft, setDraft] = useState<ThemeCustomPalette>({})
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stored: ThemeCustom = settingsQuery.data?.['ui.theme_custom'] ?? {}

  useEffect(() => {
    setDraft(stored[tab] ?? {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, settingsQuery.data])

  const defaults = DEFAULT_TOKEN_VALUES[tab]

  const effectiveBg = isValidHex(draft.bg) ? draft.bg : defaults.bg
  const effectiveSurface = isValidHex(draft.surface) ? draft.surface : defaults.surface
  const effectiveTextHex = draft.text ? INK_HEX[tab][draft.text] : defaults.text
  // 검토 중요-1 — 서버가 본문 --text(4.5:1) + 보조 --text-muted(3.0:1) 2축으로 검증을 확장 중.
  // --text-muted는 이 화면에 직접 편집 UI가 없어 항상 기본 토큰 고정값이다(정확한 hex·임계값
  // 대조는 백엔드 보고가 정본 — 여기는 즉시 피드백용 미러).
  const mutedTextHex = defaults.textMuted

  const contrastTextBg = contrastRatio(effectiveBg, effectiveTextHex)
  const contrastTextSurface = contrastRatio(effectiveSurface, effectiveTextHex)
  const minTextContrast = Math.min(contrastTextBg, contrastTextSurface)
  const textOk = minTextContrast >= CONTRAST_MIN

  const contrastMutedBg = contrastRatio(effectiveBg, mutedTextHex)
  const contrastMutedSurface = contrastRatio(effectiveSurface, mutedTextHex)
  const minMutedContrast = Math.min(contrastMutedBg, contrastMutedSurface)
  const mutedOk = minMutedContrast >= CONTRAST_MIN_MUTED

  const contrastOk = textOk && mutedOk

  const activePresetId = findPresetId(draft, tab)
  const dirty = JSON.stringify(draft ?? {}) !== JSON.stringify(stored[tab] ?? {})

  function updateDraft(patch: Partial<ThemeCustomPalette>) {
    setDraft((d) => ({ ...d, ...patch }))
  }

  function applyPreset(presetId: string) {
    const preset = THEME_PRESETS.find((p) => p.id === presetId)
    if (preset) setDraft(preset[tab])
  }

  function handleSave() {
    if (!contrastOk) return
    setError(null)
    const next: ThemeCustom = { ...stored, [tab]: draft }
    updateSettings.mutate(
      { 'ui.theme_custom': next },
      {
        onSuccess: () => {
          setSaved(true)
          window.setTimeout(() => setSaved(false), 1500)
        },
        onError: (e) => setError(errMsg(e, '저장에 실패했습니다.')),
      },
    )
  }

  function handleResetAll() {
    setError(null)
    // null = 복구 경로(§4.26 ③ R27 ①) — 백엔드 검증기가 None을 그대로 통과시킨다.
    updateSettings.mutate(
      { 'ui.theme_custom': null },
      {
        onSuccess: () => {
          setSaved(true)
          window.setTimeout(() => setSaved(false), 1500)
        },
        onError: (e) => setError(errMsg(e, '초기화에 실패했습니다.')),
      },
    )
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold text-primary">전역 테마 편집</h3>
      <p className="mb-3 text-xs text-muted">
        배경·글자색·강조색·폰트·기준 글자크기를 직접 바꿔 앱 전체 디자인을 커스텀합니다. 라이트·다크
        각각 따로 저장되고, 지정하지 않은 항목은 기본값 그대로입니다.
      </p>

      {isSafeThemeMode() && (
        <p className="mb-3 rounded border border-warning bg-accent-soft px-3 py-2 text-xs text-primary">
          안전 모드로 접속했습니다 — 저장된 커스텀 테마를 무시하고 기본값으로 보고 있습니다. 정상
          접속하면 다시 커스텀 테마가 적용됩니다.
        </p>
      )}

      {/* 라이트·다크 탭 */}
      <div className="mb-3 flex gap-2">
        {(['light', 'dark'] as ThemeTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              tab === t ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-bg text-primary hover:bg-surface-raised'
            }`}
          >
            {t === 'light' ? '라이트 편집' : '다크 편집'}
          </button>
        ))}
      </div>

      {/* 프리셋 */}
      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold text-primary">프리셋</p>
        <div className="flex flex-wrap gap-1.5">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              aria-pressed={activePresetId === p.id}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                activePresetId === p.id
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-primary hover:bg-bg'
              }`}
            >
              {p.label}
            </button>
          ))}
          {activePresetId === null && Object.keys(draft).length > 0 && (
            <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted">직접 커스텀</span>
          )}
        </div>
      </div>

      {/* 폰트 */}
      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold text-primary">폰트</p>
        <div className="flex flex-wrap gap-1.5">
          {FONT_TAB_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => updateDraft({ font: o.value })}
              aria-pressed={draft.font === o.value}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                draft.font === o.value ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 기준 글자크기 */}
      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold text-primary">기준 글자크기</p>
        <div className="flex flex-wrap gap-1.5">
          {FONT_SIZE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => updateDraft({ size: o.value })}
              aria-pressed={draft.size === o.value}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                draft.size === o.value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-primary hover:bg-bg'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 배경·서피스 — 자유 색(§4.26 ③ 자유도 경계) */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          배경(자유 색)
          <input
            type="color"
            value={effectiveBg}
            onChange={(e) => updateDraft({ bg: e.target.value })}
            className="h-9 w-full cursor-pointer rounded border border-border bg-bg"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          카드/서피스(자유 색)
          <input
            type="color"
            value={effectiveSurface}
            onChange={(e) => updateDraft({ surface: e.target.value })}
            className="h-9 w-full cursor-pointer rounded border border-border bg-bg"
          />
        </label>
      </div>

      {/* 글자색 — F52 팔레트 7색 이름만(자유 입력 UI 없음, 서버 THEME_PALETTE_NAMES와 동일 집합) */}
      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold text-primary">글자색 (팔레트만)</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => updateDraft({ text: undefined })}
            aria-pressed={!draft.text}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              !draft.text ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
            }`}
          >
            기본
          </button>
          {THEME_PALETTE_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => updateDraft({ text: c })}
              aria-pressed={draft.text === c}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                draft.text === c ? 'border-accent text-accent' : 'border-border text-primary hover:bg-bg'
              }`}
            >
              <span
                className="h-3 w-3 rounded-full border border-border"
                style={{ backgroundColor: INK_HEX[tab][c] }}
                aria-hidden
              />
              {THEME_PALETTE_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {/* 강조색 — 마찬가지로 팔레트만 */}
      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold text-primary">강조색 (팔레트만)</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => updateDraft({ accent: undefined })}
            aria-pressed={!draft.accent}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              !draft.accent ? 'border-accent bg-accent-soft text-accent' : 'border-border text-primary hover:bg-bg'
            }`}
          >
            기본
          </button>
          {THEME_PALETTE_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => updateDraft({ accent: c })}
              aria-pressed={draft.accent === c}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                draft.accent === c ? 'border-accent text-accent' : 'border-border text-primary hover:bg-bg'
              }`}
            >
              <span
                className="h-3 w-3 rounded-full border border-border"
                style={{ backgroundColor: INK_HEX[tab][c] }}
                aria-hidden
              />
              {THEME_PALETTE_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {/* 대비 자동 검증 표시(R27 ②·검토 중요-1) — 본문·보조 텍스트 2축, 서버 422가 최종 게이트고
          여기는 즉시 피드백만. 어느 축이 미달인지 문구로 구분한다. */}
      {!contrastOk && (
        <div className="mb-3 flex flex-col gap-1 rounded border border-wrong bg-wrong/10 px-3 py-2 text-xs text-wrong">
          {!textOk && (
            <p>
              배경·서피스와 <strong>글자색</strong>의 명도 대비가 너무 낮습니다(최소{' '}
              {minTextContrast.toFixed(2)}:1, 기준 {CONTRAST_MIN}:1 이상 필요) — 본문 글자가 잘 안
              보일 수 있어 저장을 막았습니다.
            </p>
          )}
          {!mutedOk && (
            <p>
              배경·서피스와 <strong>보조 글자색(설명·안내 문구)</strong>의 명도 대비가 너무
              낮습니다(최소 {minMutedContrast.toFixed(2)}:1, 기준 {CONTRAST_MIN_MUTED}:1 이상
              필요) — 배경이나 서피스 색을 더 밝거나 어둡게 바꿔보세요.
            </p>
          )}
        </div>
      )}

      {/* 미리보기 — 사용자 입력 색 데이터를 그대로 반영(하드코딩 아님, 불변 규칙 5 예외). */}
      <div className="mb-3 rounded-lg border border-border p-3" style={{ backgroundColor: effectiveBg }}>
        <div
          className="rounded p-3"
          style={{
            backgroundColor: effectiveSurface,
            color: effectiveTextHex,
            fontFamily:
              draft.font === 'serif'
                ? "Georgia, 'Noto Serif KR', serif"
                : draft.font === 'mono'
                  ? "'SFMono-Regular', Consolas, monospace"
                  : undefined,
            fontSize: draft.size ? PREVIEW_FONT_SIZE_PX[draft.size] : PREVIEW_FONT_SIZE_PX.default,
          }}
        >
          <p className="mb-1 font-semibold">미리보기</p>
          <p>본문 텍스트가 이렇게 보입니다.</p>
          {draft.accent && (
            <span
              className="mt-2 inline-block rounded px-2 py-0.5 text-xs"
              style={{
                backgroundColor: INK_HEX[tab][draft.accent],
                color: pickReadableOnColor(INK_HEX[tab][draft.accent]),
              }}
            >
              강조 배지
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || !contrastOk || updateSettings.isPending}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {saved ? '저장됨' : '저장'}
        </button>
        <button
          type="button"
          onClick={handleResetAll}
          disabled={updateSettings.isPending}
          className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg disabled:opacity-50"
        >
          기본값으로 되돌리기
        </button>
        {error && <p className="text-sm text-wrong">{error}</p>}
      </div>

      {/* 복구 경로(R27 ① — 계약) — 커스텀이 화면을 못 보게 망가뜨려도 이 안내로 빠져나올 수 있다. */}
      <p className="mt-3 text-[11px] text-muted">
        화면이 깨져 보이면 주소 끝에 <code className="rounded bg-bg px-1">?safe_theme=1</code>을
        붙여 접속하세요 — 커스텀 테마를 무시하고 기본값으로 들어옵니다(예:{' '}
        <code className="rounded bg-bg px-1">/settings?safe_theme=1</code>).
      </p>
    </section>
  )
}
