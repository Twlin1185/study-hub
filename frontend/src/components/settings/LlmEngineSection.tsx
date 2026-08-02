import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  llmKeys,
  useDeleteApiKey,
  useInstallEngine,
  useLlmStatus,
  useRefreshLlmStatus,
  useSetApiKey,
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
// 해체). 우선순위는 드래그가 아니라 ▲▼ 버튼(설계 확정). Codex 같은 installable:true 엔진은
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

      {/* S21(설계 §4.23 ⓑ) — models가 빈 배열인 엔진은 select 자체를 렌더하지 않는다. 자유 입력
          없음 — 소목록만. */}
      {engine.models.length > 0 && (
        <div className="mt-2">
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
            모델
            <select
              value={engine.selected_model ?? ''}
              onChange={(e) => onModelChange(e.target.value || null)}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-primary outline-none focus:border-accent"
            >
              <option value="">엔진 기본{engine.default_model ? ` (${engine.default_model})` : ''}</option>
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

// CLI형 진단 — 기존 Claude CLI 카드(F34) 패턴을 그대로 유지하되, installable:true(현재
// codex-cli)인 경우 설치 단계가 로그인 단계 앞에 추가된다(설계 §4.17④·⑦ 3단계 온보딩).
function CliDiagnosis({ engine }: { engine: LlmEngineStatus }) {
  const refreshStatus = useRefreshLlmStatus()
  const installEngine = useInstallEngine()
  const [installVersion, setInstallVersion] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  function handleInstall() {
    setInstallError(null)
    installEngine.mutate(engine.id, {
      onSuccess: (data) => setInstallVersion(data.version ?? null),
      onError: (e) => setInstallError(errMsg(e, '설치에 실패했습니다.')),
    })
  }

  const needsInstallStep = engine.installable && !engine.installed

  return (
    <div className="text-xs">
      {needsInstallStep ? (
        <div>
          <p className="font-medium text-warning">미설치</p>
          <p className="mt-1 mb-2 text-muted">
            [설치]를 누르면 자동으로 다운로드해 앱 전용 폴더에 격리 설치합니다(시스템 PATH는
            변경되지 않습니다). 이미 PATH에 설치되어 있으면 그것을 그대로 사용합니다.
          </p>
          <button
            type="button"
            onClick={handleInstall}
            disabled={installEngine.isPending}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {installEngine.isPending ? '설치 중…' : '설치'}
          </button>
          {installError && <p className="mt-1 text-wrong">{installError}</p>}
        </div>
      ) : (
        <>
          {installVersion && <p className="mb-1 text-correct">✓ 설치됨 (v{installVersion})</p>}

          {!engine.installed && (
            <div>
              <p className="font-medium text-wrong">미설치</p>
              {engine.id === 'claude-cli' ? (
                <p className="mt-1 text-muted">
                  Claude Code CLI가 설치되어 있지 않습니다.{' '}
                  <a
                    href="https://docs.claude.com/ko/docs/claude-code"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    설치 안내
                  </a>
                  를 참고하세요.
                </p>
              ) : (
                <p className="mt-1 text-muted">설치되어 있지 않습니다.</p>
              )}
            </div>
          )}

          {engine.installed && !engine.logged_in && (
            <div>
              <p className="font-medium text-warning">미로그인</p>
              {engine.installable ? (
                <p className="mt-1 text-muted">
                  터미널에서 <code className="rounded bg-surface px-1">codex login</code>을 실행해
                  브라우저로 로그인하세요.
                </p>
              ) : (
                <ol className="mt-1 list-decimal pl-4 text-muted">
                  <li>PC 터미널을 엽니다.</li>
                  <li>
                    <code className="rounded bg-surface px-1">claude</code> 명령을 실행합니다.
                  </li>
                  <li>안내에 따라 로그인을 완료합니다.</li>
                  <li>이 화면에서 [다시 확인]을 누릅니다.</li>
                </ol>
              )}
              <button
                type="button"
                onClick={() => refreshStatus.mutate()}
                disabled={refreshStatus.isPending}
                className="mt-2 rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
              >
                {refreshStatus.isPending ? '확인 중…' : '다시 확인'}
              </button>
              {refreshStatus.isError && (
                <p className="mt-1 text-wrong">{errMsg(refreshStatus.error, '다시 확인에 실패했습니다.')}</p>
              )}
            </div>
          )}

          {engine.installed && engine.logged_in && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-correct">✓ 정상</p>
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
          )}
        </>
      )}

      {/* 프라이버시 고지(설계 §4.17⑦ — 온보딩 말미 1줄, PoC E2) — installable 엔진(현재
          codex-cli) 카드에 항상 고정 노출한다. */}
      {engine.installable && (
        <p className="mt-2 rounded border border-border bg-surface px-2 py-1.5 text-[11px] text-muted">
          {engine.label} 실행 시 변환 원문이 이 PC의{' '}
          <code className="rounded bg-bg px-1">~/.codex</code> 로그·세션 기록에 남습니다.
        </p>
      )}
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
