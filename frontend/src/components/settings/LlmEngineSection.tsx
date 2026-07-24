import { useState } from 'react'
import { useDeleteApiKey, useLlmStatus, useRefreshLlmStatus, useSetApiKey } from '../../api/llm'
import { useSettings, useUpdateSettings } from '../../api/settings'
import { ApiError } from '../../api/client'
import type { LlmFallbackPolicy, LlmPriority } from '../../api/types'
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

const PRIORITY_OPTIONS: { value: LlmPriority; label: string }[] = [
  { value: 'cli', label: 'CLI 우선' },
  { value: 'api', label: 'API 우선' },
]

const FALLBACK_OPTIONS: { value: LlmFallbackPolicy; label: string; hint: string }[] = [
  { value: 'auto', label: '자동', hint: '한도 초과 시 API로 자동 전환 (과금 발생)' },
  { value: 'ask', label: '물어보기', hint: '실패 시 [API로 재시도] 버튼으로 직접 선택 (기본값)' },
  { value: 'off', label: '끔', hint: '실패 시 수동 반입 안내만 제공' },
]

// stage-8 plan §4, 설계 §4.11 — CLI/API 엔진 진단 카드 + 우선순위 + 폴백 정책(자동 선택 시
// 과금 동의 필수).
export default function LlmEngineSection() {
  const statusQuery = useLlmStatus()
  const refreshStatus = useRefreshLlmStatus()
  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()
  const setApiKey = useSetApiKey()
  const deleteApiKey = useDeleteApiKey()

  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keySaved, setKeySaved] = useState(false)
  const [pendingFallback, setPendingFallback] = useState<LlmFallbackPolicy | null>(null)

  const priority = settingsQuery.data?.['llm.priority'] ?? statusQuery.data?.priority ?? 'cli'
  const fallback = settingsQuery.data?.['llm.fallback'] ?? statusQuery.data?.fallback_policy ?? 'ask'

  function handlePriorityChange(value: LlmPriority) {
    updateSettings.mutate({ 'llm.priority': value })
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

  const cli = statusQuery.data?.cli
  const apiStatus = statusQuery.data?.api
  const limit = statusQuery.data?.limit

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold text-primary">엔진 상태</h3>
      <p className="mb-3 text-xs text-muted">
        기출 변환·오류 재생성에 사용할 엔진을 관리합니다. CLI는 Claude 구독 세션으로 무료, API는
        사용한 만큼 과금됩니다.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* CLI 카드 */}
        <div className="rounded border border-border bg-bg p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-primary">CLI (Claude Code)</h4>
            <button
              type="button"
              onClick={() => refreshStatus.mutate()}
              disabled={refreshStatus.isPending}
              className="rounded border border-border px-2 py-1 text-xs text-primary hover:bg-surface disabled:opacity-50"
            >
              {refreshStatus.isPending ? '확인 중…' : '다시 확인'}
            </button>
          </div>

          {statusQuery.isLoading && <p className="text-xs text-muted">상태 확인 중…</p>}
          {statusQuery.isError && <p className="text-xs text-wrong">상태를 불러오지 못했습니다.</p>}
          {refreshStatus.isError && (
            <p className="text-xs text-wrong">{errMsg(refreshStatus.error, '다시 확인에 실패했습니다.')}</p>
          )}

          {cli && (
            <>
              {!cli.installed && (
                <div className="text-xs">
                  <p className="font-medium text-wrong">미설치</p>
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
                </div>
              )}
              {cli.installed && !cli.logged_in && (
                <div className="text-xs">
                  <p className="font-medium text-warning">미로그인</p>
                  <ol className="mt-1 list-decimal pl-4 text-muted">
                    <li>PC 터미널을 엽니다.</li>
                    <li>
                      <code className="rounded bg-surface px-1">claude</code> 명령을 실행합니다.
                    </li>
                    <li>안내에 따라 로그인을 완료합니다.</li>
                    <li>이 화면에서 [다시 확인]을 누릅니다.</li>
                  </ol>
                </div>
              )}
              {cli.installed && cli.logged_in && (
                <div className="text-xs">
                  <p className="font-medium text-correct">✓ 정상</p>
                  {formatDateTime(cli.last_success_at) && (
                    <p className="mt-1 text-muted">마지막 성공: {formatDateTime(cli.last_success_at)}</p>
                  )}
                </div>
              )}
              {limit && formatDateTime(limit.resets_at) && (
                <p className="mt-2 rounded border border-warning bg-accent-soft px-2 py-1 text-[11px] text-primary">
                  {LIMIT_KIND_LABEL[limit.kind] ?? limit.kind} 한도 초과 — {formatDateTime(limit.resets_at)} 리셋
                  예정
                </p>
              )}
            </>
          )}
        </div>

        {/* API 카드 */}
        <div className="rounded border border-border bg-bg p-3">
          <h4 className="mb-2 text-sm font-semibold text-primary">API (Anthropic)</h4>

          {apiStatus?.key_registered ? (
            <div className="flex flex-col gap-2 text-xs">
              <p className="text-correct">
                ✓ 등록됨 — <code className="rounded bg-surface px-1">sk-…{apiStatus.key_suffix}</code>
              </p>
              {formatDateTime(apiStatus.last_success_at) && (
                <p className="text-muted">마지막 성공: {formatDateTime(apiStatus.last_success_at)}</p>
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
                키는 서버의 secrets.json에만 저장되며(DB·백업 제외) 이 화면에는 다시 표시되지
                않습니다.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold text-muted">우선 엔진</p>
        <div className="flex gap-2">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handlePriorityChange(opt.value)}
              aria-pressed={priority === opt.value}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                priority === opt.value ? 'bg-accent text-on-accent' : 'bg-bg text-muted hover:bg-surface-raised'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
          message="한도 초과 시 자동으로 API 엔진으로 전환됩니다. API는 Anthropic 사용량에 따라 과금됩니다. 계속할까요?"
          confirmLabel="동의하고 설정"
          submitting={updateSettings.isPending}
          onClose={() => setPendingFallback(null)}
          onConfirm={confirmAutoFallback}
        />
      )}
    </section>
  )
}
