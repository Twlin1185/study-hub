import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  llmKeys,
  useDeleteApiKey,
  useInstallEngine,
  useLlmStatus,
  useRefreshLlmStatus,
  useSetApiKey,
  useStartCliLogin,
} from '../../api/llm'
import { useSettings, useUpdateSettings } from '../../api/settings'
import { ApiError } from '../../api/client'
import type { LlmEngineId, LlmEngineStatus, LlmFallbackPolicy, LlmLimitInfo } from '../../api/types'
import ConfirmDialog from '../ConfirmDialog'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
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

// limit.kind는 §4.11에서 string으로만 명세됨(error_info.limit_kind의 좁은 유니온과 다름) — 알려진
// 값만 한글로 매핑하고 나머지는 원문 그대로 보여준다.
const LIMIT_KIND_LABEL: Record<string, string> = {
  session: '세션',
  daily: '일간',
  weekly: '주간',
  model: '모델',
  overall: '전체',
}

const FALLBACK_OPTIONS: { value: LlmFallbackPolicy; label: string; hint: string }[] = [
  { value: 'auto', label: '자동', hint: '우선 엔진 실패 시 다음 순위 엔진으로 자동 전환 (구독형이 아니면 과금 발생 가능)' },
  { value: 'ask', label: '물어보기', hint: '실패 시 [다시 시도] 버튼으로 다음 순위 엔진을 직접 선택 (기본값)' },
  { value: 'off', label: '끔', hint: '실패 시 수동 반입 안내만 제공' },
]

const RANK_LABEL = ['1순위', '2순위', '3순위', '4순위', '5순위']

// S15(설계 §4.17①·⑦) — 엔진 카드 2개 고정 → status.engines 배열 렌더로 일반화(F34 이항 가정
// 해체). 우선순위는 드래그가 아니라 ▲▼ 버튼(설계 확정). installable 엔진(codex-cli·claude-cli)은
// 카드 안에 설치→로그인→진단 3단계 온보딩이 함께 들어간다(별도 라우트 없음).
export default function LlmEngineSection() {
  const statusQuery = useLlmStatus()
  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()
  const qc = useQueryClient()

  const [pendingFallback, setPendingFallback] = useState<LlmFallbackPolicy | null>(null)

  const engines = statusQuery.data?.engines ?? []
  const priorityIds = statusQuery.data?.priority ?? engines.map((e) => e.id)
  const limit = statusQuery.data?.limit ?? null
  const fallback = settingsQuery.data?.['llm.fallback'] ?? statusQuery.data?.fallback_policy ?? 'ask'

  // priority 순서대로 카드를 나열 — ▲▼가 이 목록 순서를 바꾼다. 정상 백엔드라면 priority가 등록
  // 엔진 전부를 포함하지만(설계 §4.17① 누락 보충), 방어적으로 빠진 항목은 끝에 붙인다.
  const orderedEngines = priorityIds
    .map((id) => engines.find((e) => e.id === id))
    .filter((e): e is LlmEngineStatus => e != null)
  const missing = engines.filter((e) => !priorityIds.includes(e.id))
  const displayEngines = [...orderedEngines, ...missing]

  function movePriority(id: LlmEngineId, direction: -1 | 1) {
    const idx = priorityIds.indexOf(id)
    const swapIdx = idx + direction
    if (idx < 0 || swapIdx < 0 || swapIdx >= priorityIds.length) return
    const next = [...priorityIds]
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    updateSettings.mutate(
      { 'llm.priority': next },
      { onSuccess: () => qc.invalidateQueries({ queryKey: llmKeys.status }) },
    )
  }

  function handleFallbackSelect(value: LlmFallbackPolicy) {
    if (value === 'auto') {
      setPendingFallback(value)
      return
    }
    updateSettings.mutate({ 'llm.fallback': value })
  }

  function confirmAutoFallback() {
    updateSettings.mutate(
      { 'llm.fallback': 'auto' },
      {
        onSuccess: () => setPendingFallback(null),
        onError: () => setPendingFallback(null),
      },
    )
  }

  // S21(설계 §4.23, 결정 ①) — 활성 토글 저장 = settings `llm.disabled`(비활성 엔진 id 배열,
  // 부정 목록) 전체 쓰기. 레지스트리 등재 id(engines)만 대상 — 알 수 없는 id는 서버가 무시하지만
  // 프론트도 표시된 엔진만 다룬다.
  function handleToggleEnabled(id: LlmEngineId, nextEnabled: boolean) {
    const currentDisabled = engines.filter((e) => !e.enabled).map((e) => e.id)
    const nextDisabled = nextEnabled
      ? currentDisabled.filter((x) => x !== id)
      : Array.from(new Set([...currentDisabled, id]))
    updateSettings.mutate(
      { 'llm.disabled': nextDisabled },
      { onSuccess: () => qc.invalidateQueries({ queryKey: llmKeys.status }) },
    )
  }

  // S21(설계 §4.23 ⓑ, 결정 ③) — 모델 선택 저장 = settings `llm.models`({엔진id: 모델id}) 전체
  // 쓰기(부분 병합 아님 — 다른 엔진 선택을 보존하려면 현재 값을 먼저 펼쳐야 한다). modelId가
  // null(엔진 기본 선택)이면 그 엔진 키를 제거한다.
  function handleModelChange(id: LlmEngineId, modelId: string | null) {
    const current = settingsQuery.data?.['llm.models'] ?? {}
    const next = { ...current }
    if (modelId) next[id] = modelId
    else delete next[id]
    updateSettings.mutate(
      { 'llm.models': next },
      { onSuccess: () => qc.invalidateQueries({ queryKey: llmKeys.status }) },
    )
  }

  // S21(설계 §4.23·screens §5.11 ④) — 전 엔진 꺼짐 안내 1줄. 신규 오류 경로 없음(기존 "후보
  // 없음" 처리 그대로) — 원인을 알려주는 안내만.
  const allDisabled = engines.length > 0 && engines.every((e) => !e.enabled)

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold text-primary">엔진 상태</h3>
      <p className="mb-3 text-xs text-muted">
        기출 변환·오류 재생성에 사용할 엔진을 관리합니다. 구독형(CLI)은 각자의 구독 세션으로
        무료, 종량 과금형(API)은 사용한 만큼 과금됩니다. ▲▼로 우선순위를 조정하면 실패 시 다음
        순위 엔진이 폴백 후보가 됩니다. 엔진을 끄면(사용 안 함) auto 해석·폴백 후보에서 제외되어
        변환에 쓰이지 않습니다.
      </p>

      {statusQuery.isLoading && <p className="mb-3 text-xs text-muted">상태 확인 중…</p>}
      {statusQuery.isError && <p className="mb-3 text-xs text-wrong">상태를 불러오지 못했습니다.</p>}

      {limit && formatDateTime(limit.resets_at) && (
        <LimitBanner limit={limit} />
      )}

      {allDisabled && (
        <p className="mb-3 rounded border border-warning bg-accent-soft px-2 py-1.5 text-xs text-primary">
          모든 엔진이 꺼져 있습니다 — 변환·생성 기능이 동작하지 않습니다.
        </p>
      )}

      <div className="mb-4 flex flex-col gap-3">
        {displayEngines.map((engine, i) => (
          <EngineCard
            key={engine.id}
            engine={engine}
            rank={RANK_LABEL[i] ?? `${i + 1}순위`}
            isFirst={i === 0}
            isLast={i === displayEngines.length - 1}
            onMoveUp={() => movePriority(engine.id, -1)}
            onMoveDown={() => movePriority(engine.id, 1)}
            onToggleEnabled={(next) => handleToggleEnabled(engine.id, next)}
            onModelChange={(modelId) => handleModelChange(engine.id, modelId)}
          />
        ))}
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-muted">폴백 정책 (우선 엔진 실패 시)</p>
        <div className="flex flex-col gap-1.5">
          {FALLBACK_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-2 rounded border px-2.5 py-1.5 text-xs ${
                fallback === opt.value ? 'border-accent bg-accent-soft' : 'border-border bg-bg'
              }`}
            >
              <input
                type="radio"
                name="llm-fallback"
                className="mt-0.5"
                checked={fallback === opt.value}
                onChange={() => handleFallbackSelect(opt.value)}
              />
              <span>
                <span className="font-medium text-primary">{opt.label}</span>
                <span className="ml-1 text-muted">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {pendingFallback && (
        <ConfirmDialog
          title="자동 폴백 — 과금 동의"
          message="한도 초과 시 자동으로 다음 순위 엔진으로 전환됩니다. 그 엔진이 종량 과금형(API)이면 사용량에 따라 과금됩니다. 계속할까요?"
          confirmLabel="동의하고 설정"
          submitting={updateSettings.isPending}
          onClose={() => setPendingFallback(null)}
          onConfirm={confirmAutoFallback}
        />
      )}
    </section>
  )
}

function LimitBanner({ limit }: { limit: LlmLimitInfo }) {
  return (
    <p className="mb-3 rounded border border-warning bg-accent-soft px-2 py-1 text-[11px] text-primary">
      {LIMIT_KIND_LABEL[limit.kind] ?? limit.kind} 한도 초과 — {formatDateTime(limit.resets_at)} 리셋 예정
    </p>
  )
}

interface EngineCardProps {
  engine: LlmEngineStatus
  rank: string
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  // S21(설계 §4.23) — 활성 토글·모델 선택.
  onToggleEnabled: (next: boolean) => void
  onModelChange: (modelId: string | null) => void
}

// 카드 내용은 필드 유무로 결정한다(설계 §4.17②·⑦) — CLI형(installed/logged_in이 null이 아님) ·
// API형(key_registered가 null이 아님). 엔진이 늘어나도 이 컴포넌트는 바뀌지 않아야 정상.
function EngineCard({
  engine,
  rank,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  onModelChange,
}: EngineCardProps) {
  const isCliType = engine.installed !== null || engine.logged_in !== null
  const isKeyType = engine.key_registered !== null

  return (
    <div className="rounded border border-border bg-bg p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
            {rank}
          </span>
          <h4 className="text-sm font-semibold text-primary">{engine.label}</h4>
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
            {engine.billing === 'subscription' ? '구독형' : '종량 과금'}
          </span>
          {!engine.enabled && (
            <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-medium text-on-accent">
              사용 안 함
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-primary">
            <input
              type="checkbox"
              checked={engine.enabled}
              onChange={(e) => onToggleEnabled(e.target.checked)}
            />
            사용
          </label>
          <div className="flex gap-1" role="group" aria-label={`${engine.label} 우선순위 조정`}>
            <button
              type="button"
              onClick={onMoveUp}
              disabled={isFirst}
              aria-label="우선순위 올리기"
              className="rounded border border-border px-1.5 py-1 text-xs text-primary hover:bg-surface disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={isLast}
              aria-label="우선순위 내리기"
              className="rounded border border-border px-1.5 py-1 text-xs text-primary hover:bg-surface disabled:opacity-30"
            >
              ▼
            </button>
          </div>
        </div>
      </div>

      {/* 꺼진 카드도 진단·온보딩·[다시 확인]은 정상 렌더한다(설계 §4.23 — 켜면 즉시 복귀). */}
      {isCliType && <CliDiagnosis engine={engine} />}
      {isKeyType && <ApiKeyDiagnosis engine={engine} />}

      {/* S21(설계 §4.23 ⓑ, 검토 정정 2026-08-03) — models가 빈 배열인 엔진은 select 자체를
          렌더하지 않는다. 자유 입력 없음 — 소목록만. default_model이 non-null인 엔진(API형,
          claude-api)은 selected_model이 절대 null이 되지 않으므로(§4.23 ⑤ 유효 적용값 —
          legacy 기본 상주) "엔진 기본" 빈 옵션을 렌더하지 않는다(눌러도 선택되지 않는 유령
          옵션 방지) — API는 항상 구체 모델로 호출되고 '기본' = default_model 그 자체다.
          CLI형(default_model null)만 "엔진 기본(미전달)" 옵션을 유지한다. */}
      {engine.models.length > 0 && (
        <div className="mt-2">
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
            모델
            <select
              value={engine.selected_model ?? ''}
              onChange={(e) => onModelChange(e.target.value || null)}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-primary outline-none focus:border-accent"
            >
              {engine.default_model == null && <option value="">엔진 기본(미전달)</option>}
              {engine.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

// 스피너 — 로그인 대기·설치 중 등 진행 표시 공용(색은 accent 토큰만).
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent align-[-1px]"
    />
  )
}

type OnboardingStep = 'install' | 'login' | 'done'

const STEP_ITEMS: { key: OnboardingStep; label: string }[] = [
  { key: 'install', label: '설치' },
  { key: 'login', label: '로그인' },
  { key: 'done', label: '완료' },
]

// 온보딩 3단계 표시줄 — 현재 단계는 accent 강조, 지난 단계는 체크(설계 §4.17④ 3단계 온보딩).
function StepIndicator({ step }: { step: OnboardingStep }) {
  const currentIdx = STEP_ITEMS.findIndex((it) => it.key === step)
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
      {STEP_ITEMS.map((it, idx) => {
        const isDone = idx < currentIdx
        const isCurrent = idx === currentIdx
        return (
          <span key={it.key} className="flex items-center gap-1">
            <span
              className={
                isCurrent
                  ? 'rounded-full bg-accent px-2 py-0.5 font-semibold text-on-accent'
                  : isDone
                    ? 'rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent'
                    : 'rounded-full border border-border px-2 py-0.5 text-muted'
              }
            >
              {isDone ? '✓' : `${idx + 1}`} {it.label}
            </span>
            {idx < STEP_ITEMS.length - 1 && <span className="text-muted">→</span>}
          </span>
        )
      })}
    </div>
  )
}

function isNotInstalledReason(detail: unknown): boolean {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    (detail as { reason?: unknown }).reason === 'not_installed'
  )
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const LOGIN_POLL_MS = 4000

// CLI형 진단 — installable 엔진(codex-cli·claude-cli)은 [설치]를 누른 순간부터 사용자 개입 없이
// 설치→로그인→완료로 이어지는 온보딩 스테퍼(설계 §4.17④·⑦, 후속 B6). 단계는 engine.installed/
// logged_in에서 파생하고(서버가 유일한 진실 출처), 로컬 상태는 "로그인 창을 지금 띄웠는가"만
// 보조로 들고 있는다 — engine.login_pending이 true로 오면(새로고침 등으로 로컬 상태가 날아간
// 경우) 그 값을 그대로 이어받아 폴링을 재개한다.
function CliDiagnosis({ engine }: { engine: LlmEngineStatus }) {
  const refreshStatus = useRefreshLlmStatus()
  const installEngine = useInstallEngine()
  const startLogin = useStartCliLogin()

  const [installError, setInstallError] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginNotice, setLoginNotice] = useState<string | null>(null)
  const [loginActive, setLoginActive] = useState<boolean>(() => engine.login_pending === true)
  const [loginStartedAt, setLoginStartedAt] = useState<number | null>(() =>
    engine.login_pending === true ? Date.now() : null,
  )
  const [loginTimedOut, setLoginTimedOut] = useState(false)

  // 서버가 로그인 프로세스 생존을 알려오면(초기 로드·다른 경로에서 시작된 로그인 포함) 로컬
  // 상태가 없어도 폴링 단계로 이어받는다.
  useEffect(() => {
    if (engine.login_pending && !loginActive) {
      setLoginActive(true)
      setLoginStartedAt(Date.now())
      setLoginTimedOut(false)
    }
  }, [engine.login_pending, loginActive])

  // 로그인 확인되면 로컬 추적 상태를 정리(다음 재로그인 시나리오를 위해).
  useEffect(() => {
    if (engine.logged_in) {
      setLoginActive(false)
      setLoginStartedAt(null)
      setLoginTimedOut(false)
      setLoginNotice(null)
    }
  }, [engine.logged_in])

  // 로그인 대기 중에는 4초마다 강제 진단(?refresh=1)으로 로그인 완료 여부를 확인. 5분 지나면
  // 폴링을 멈추고 [로그인 창 다시 열기] 안내로 전환.
  useEffect(() => {
    if (!loginActive || engine.logged_in || loginTimedOut) return
    const id = window.setInterval(() => {
      if (loginStartedAt != null && Date.now() - loginStartedAt > LOGIN_TIMEOUT_MS) {
        setLoginTimedOut(true)
        return
      }
      refreshStatus.mutate()
    }, LOGIN_POLL_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshStatus는 매 렌더 새 mutate 참조지만 호출부만 쓴다.
  }, [loginActive, engine.logged_in, loginTimedOut, loginStartedAt])

  function handleInstall() {
    setInstallError(null)
    installEngine.mutate(engine.id, {
      onSuccess: () => {
        refreshStatus.mutate(undefined, {
          onSuccess: (fresh) => {
            const freshEngine = fresh.engines.find((e) => e.id === engine.id)
            if (!freshEngine?.logged_in) {
              triggerLogin()
            }
          },
        })
      },
      onError: (e) => setInstallError(errMsg(e, '설치에 실패했습니다.')),
    })
  }

  function triggerLogin() {
    setLoginError(null)
    setLoginNotice(null)
    startLogin.mutate(engine.id, {
      onSuccess: (data) => {
        if (data.status === 'already_logged_in') {
          refreshStatus.mutate()
          return
        }
        if (data.status === 'in_progress') {
          setLoginNotice('로그인 창이 이미 열려 있습니다 — 그 창에서 진행하세요.')
        }
        setLoginActive(true)
        setLoginStartedAt(Date.now())
        setLoginTimedOut(false)
      },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 422 && isNotInstalledReason(e.detail)) {
          setLoginActive(false)
          setLoginError('설치가 확인되지 않았습니다 — 먼저 설치를 진행해 주세요.')
          refreshStatus.mutate()
          return
        }
        setLoginError(errMsg(e, '로그인 시작에 실패했습니다.'))
      },
    })
  }

  const privacyNotice = engine.installable && (
    <p className="mt-2 rounded border border-border bg-surface px-2 py-1.5 text-[11px] text-muted">
      {engine.label} 실행 시 변환 원문이 이 PC의{' '}
      <code className="rounded bg-bg px-1">{engine.id === 'claude-cli' ? '~/.claude' : '~/.codex'}</code>{' '}
      {engine.id === 'claude-cli' ? 'Claude Code 세션 기록' : '로그·세션 기록'}에 남습니다.
    </p>
  )

  // installable:false인 CLI 엔진(현재 미존재 — 향후 대비 최소 폴백). 스테퍼가 없는 대신 상태
  // 문구 + [다시 확인]만 제공한다.
  if (!engine.installable) {
    return (
      <div className="text-xs">
        {!engine.installed ? (
          <p className="font-medium text-wrong">설치되어 있지 않습니다.</p>
        ) : !engine.logged_in ? (
          <div>
            <p className="font-medium text-warning">미로그인</p>
            <button
              type="button"
              onClick={() => refreshStatus.mutate()}
              disabled={refreshStatus.isPending}
              className="mt-2 rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
            >
              {refreshStatus.isPending ? '확인 중…' : '다시 확인'}
            </button>
          </div>
        ) : (
          <DoneStep engine={engine} refreshStatus={refreshStatus} />
        )}
        {privacyNotice}
      </div>
    )
  }

  const step: OnboardingStep = !engine.installed ? 'install' : !engine.logged_in ? 'login' : 'done'

  return (
    <div className="text-xs">
      <StepIndicator step={step} />

      {step === 'install' && (
        <div>
          {installEngine.isPending ? (
            <p className="flex items-center gap-1.5 text-muted">
              <Spinner />
              다운로드·설치 중…
              {engine.id === 'claude-cli'
                ? ' Claude Code는 약 220MB — 수십 초 걸릴 수 있습니다.'
                : ' 몇 초 안에 끝납니다.'}
            </p>
          ) : (
            <>
              <p className="mb-2 text-muted">
                [설치]를 누르면 자동으로 다운로드해 앱 전용 폴더에 격리 설치합니다(시스템 PATH는
                변경되지 않습니다). 이미 PATH에 설치되어 있으면 그것을 그대로 사용합니다. 설치가
                끝나면 이어서 로그인 창이 자동으로 열립니다 — 따로 서버를 재시작할 필요가
                없습니다.
              </p>
              <button
                type="button"
                onClick={handleInstall}
                disabled={installEngine.isPending}
                className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                설치
              </button>
            </>
          )}
          {installError && <p className="mt-1 text-wrong">{installError}</p>}
        </div>
      )}

      {step === 'login' && (
        <div>
          <p className="font-medium text-warning">미로그인</p>

          {!loginActive ? (
            <>
              <p className="mt-1 mb-2 text-muted">
                [로그인]을 누르면 이 PC에 로그인 창이 열립니다. 브라우저에서 로그인을 마치면
                자동으로 이어집니다.
              </p>
              <button
                type="button"
                onClick={triggerLogin}
                disabled={startLogin.isPending}
                className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {startLogin.isPending ? '여는 중…' : '로그인'}
              </button>
            </>
          ) : (
            <>
              {loginTimedOut ? (
                <p className="mt-1 mb-2 text-wrong">시간이 지났습니다 — 로그인 창을 다시 열어주세요.</p>
              ) : (
                <p className="mt-1 mb-2 flex items-center gap-1.5 text-muted">
                  <Spinner />
                  이 PC에 로그인 창이 열렸습니다. 브라우저에서 로그인을 마치면 자동으로
                  이어집니다.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={triggerLogin}
                  disabled={startLogin.isPending}
                  className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
                >
                  로그인 창 다시 열기
                </button>
                <button
                  type="button"
                  onClick={() => refreshStatus.mutate()}
                  disabled={refreshStatus.isPending}
                  className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
                >
                  {refreshStatus.isPending ? '확인 중…' : '다시 확인'}
                </button>
              </div>
            </>
          )}

          {loginNotice && <p className="mt-1 text-muted">{loginNotice}</p>}
          {loginError && <p className="mt-1 text-wrong">{loginError}</p>}

          <p className="mt-2 text-muted">
            로그인 창은 서버가 실행 중인 PC에 열립니다 — 폰에서 보고 있다면 PC에서 진행하세요.
          </p>

          <details className="mt-2 rounded border border-border bg-surface p-2 text-muted">
            <summary className="cursor-pointer select-none font-medium text-primary">
              수동으로 하기
            </summary>
            <div className="mt-1.5">
              {engine.id === 'codex-cli' ? (
                <p>
                  터미널에서 <code className="rounded bg-bg px-1">codex login</code>을 실행해
                  브라우저로 로그인하세요.
                </p>
              ) : (
                <p>
                  터미널에서{' '}
                  <code className="rounded bg-bg px-1">tools\claude\claude.exe auth login</code>을
                  실행하거나(PC에 이미 Claude Code가 PATH에 있으면{' '}
                  <code className="rounded bg-bg px-1">claude auth login</code>) 안내에 따라
                  로그인을 완료한 뒤 [다시 확인]을 누르세요.
                </p>
              )}
            </div>
          </details>
        </div>
      )}

      {step === 'done' && <DoneStep engine={engine} refreshStatus={refreshStatus} />}

      {privacyNotice}
    </div>
  )
}

// 완료 단계 — 설치·CLI 진단 모두 정상. installable:false 폴백 분기와도 공유.
function DoneStep({
  engine,
  refreshStatus,
}: {
  engine: LlmEngineStatus
  refreshStatus: ReturnType<typeof useRefreshLlmStatus>
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="font-medium text-correct">✓ 설정 완료 — 바로 변환·재생성에 쓸 수 있습니다</p>
        {formatDateTime(engine.last_success_at) && (
          <p className="mt-1 text-muted">마지막 성공: {formatDateTime(engine.last_success_at)}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => refreshStatus.mutate()}
        disabled={refreshStatus.isPending}
        className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
      >
        {refreshStatus.isPending ? '확인 중…' : '다시 확인'}
      </button>
    </div>
  )
}

// API형 진단 — 즉석 연결 테스트 성공 시에만 서버가 저장(원문 키 미포함, F34 패턴 그대로).
function ApiKeyDiagnosis({ engine }: { engine: LlmEngineStatus }) {
  const setApiKey = useSetApiKey()
  const deleteApiKey = useDeleteApiKey()

  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keySaved, setKeySaved] = useState(false)

  function handleSaveKey() {
    if (!keyInput.trim()) {
      setKeyError('API 키를 입력하세요.')
      return
    }
    setKeyError(null)
    setApiKey.mutate(keyInput.trim(), {
      onSuccess: () => {
        setKeyInput('')
        setKeySaved(true)
        window.setTimeout(() => setKeySaved(false), 1500)
      },
      onError: (e) => setKeyError(errMsg(e, '연결 테스트에 실패했습니다. 키를 확인하세요.')),
    })
  }

  return engine.key_registered ? (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-correct">
        ✓ 등록됨 — <code className="rounded bg-surface px-1">sk-…{engine.key_suffix}</code>
      </p>
      {formatDateTime(engine.last_success_at) && (
        <p className="text-muted">마지막 성공: {formatDateTime(engine.last_success_at)}</p>
      )}
      <button
        type="button"
        onClick={() => deleteApiKey.mutate()}
        disabled={deleteApiKey.isPending}
        className="w-fit rounded border border-border px-2 py-1 text-xs text-wrong hover:bg-surface disabled:opacity-50"
      >
        {deleteApiKey.isPending ? '삭제 중…' : '키 삭제'}
      </button>
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      <input
        type="password"
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        placeholder="sk-ant-..."
        autoComplete="off"
        className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={handleSaveKey}
        disabled={setApiKey.isPending}
        className="w-fit rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
      >
        {setApiKey.isPending ? '연결 테스트 중…' : keySaved ? '저장됨' : '연결 테스트 후 저장'}
      </button>
      {keyError && <p className="text-xs text-wrong">{keyError}</p>}
      <p className="text-[11px] text-muted">
        키는 서버의 secrets.json에만 저장되며(DB·백업 제외) 이 화면에는 다시 표시되지 않습니다.
      </p>
    </div>
  )
}
