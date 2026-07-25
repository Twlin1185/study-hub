import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useBackups, useCreateBackup, useRestoreBackup } from '../api/backups'
import { useSettings, useUpdateSettings } from '../api/settings'
import type { BackupItem } from '../api/types'
import { ApiError } from '../api/client'
import Modal from './Modal'

function errMsg(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// 설계 §4.10(v1.5 확정) — 복원 확인 문구는 고정 문자열 "RESTORE".
const CONFIRM_PHRASE = 'RESTORE'

// 설계 §4.10, F27 — 백업 생성·목록·복원(확인 문구 타이핑 필수) + 자동 백업 옵션(backup.auto).
export default function BackupManager() {
  const backupsQuery = useBackups()
  const createBackup = useCreateBackup()
  const restoreBackup = useRestoreBackup()
  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()

  const qc = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null)
  // 복원 성공 후 강제 리로드 모달 표시 여부 (설계 §4.12 M6 이월 ②) — 닫기 없이 리로드만.
  const [restored, setRestored] = useState(false)

  // 설계 §4.10 — 값은 문자열 "daily"(활성)/""(비활성). 백엔드 기동 훅이 이 정확한 문자열을 비교한다.
  const autoBackup = settingsQuery.data?.['backup.auto'] === 'daily'

  function handleCreate() {
    setCreateError(null)
    createBackup.mutate(undefined, {
      onSuccess: () => setNotice('백업을 생성했습니다.'),
      onError: (e) => setCreateError(errMsg(e, '백업 생성에 실패했습니다.')),
    })
  }

  return (
    <section className="mb-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-primary">백업 · 복원</h2>
      <p className="mb-3 text-xs text-muted">
        study.db와 sources/ 원본을 타임스탬프로 백업합니다. 복원 전 자동으로 현재 상태의 스냅샷을
        1개 만든 뒤 되돌립니다.
      </p>

      <label className="mb-3 flex items-center gap-2 text-sm text-primary">
        <input
          type="checkbox"
          checked={autoBackup}
          onChange={(e) => updateSettings.mutate({ 'backup.auto': e.target.checked ? 'daily' : '' })}
        />
        매일 자동 백업 (앱 기동 시 마지막 백업이 24시간 지났으면 실행)
      </label>

      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={createBackup.isPending}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {createBackup.isPending ? '백업 생성 중…' : '지금 백업 생성'}
        </button>
        {notice && <span className="text-xs text-correct">{notice}</span>}
      </div>
      {createError && <p className="mb-3 text-sm text-wrong">{createError}</p>}

      {backupsQuery.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
      {backupsQuery.isError && <p className="text-sm text-wrong">백업 목록을 불러오지 못했습니다.</p>}
      {backupsQuery.data && backupsQuery.data.length === 0 && (
        <p className="text-sm text-muted">아직 생성된 백업이 없습니다.</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {(backupsQuery.data ?? []).map((b) => (
          <li
            key={b.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-bg px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 text-primary">
              <span className="mr-2">{b.created_at}</span>
              <span className="text-xs text-muted">{b.filename}</span>
              {b.size_bytes != null && <span className="ml-2 text-xs text-muted">{formatSize(b.size_bytes)}</span>}
            </span>
            <button
              type="button"
              onClick={() => setRestoreTarget(b)}
              className="rounded border border-border px-2.5 py-1 text-xs text-wrong hover:bg-surface"
            >
              복원
            </button>
          </li>
        ))}
      </ul>

      {restoreTarget && (
        <RestoreConfirmModal
          backup={restoreTarget}
          submitting={restoreBackup.isPending}
          errorMessage={restoreBackup.isError ? errMsg(restoreBackup.error, '복원에 실패했습니다.') : null}
          onClose={() => setRestoreTarget(null)}
          onConfirm={() =>
            restoreBackup.mutate(restoreTarget.id, {
              onSuccess: () => {
                setRestoreTarget(null)
                // 강제 리로드 모달로 전환 — stale 커넥션/화면 조작을 차단한다(§4.12).
                setRestored(true)
              },
            })
          }
        />
      )}

      {restored && (
        <ForceReloadModal
          onReload={() => {
            // 쿼리 캐시 폐기 후 전체 새로고침 — 복원본으로 앱을 다시 불러온다.
            qc.clear()
            window.location.reload()
          }}
        />
      )}
    </section>
  )
}

// 복원 완료 강제 리로드 모달 (설계 §4.12) — 닫기 버튼 없음(리로드만), "이상 시 서버 재시작" 안내.
function ForceReloadModal({ onReload }: { onReload: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="복원 완료"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-raised p-5 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold text-primary">복원 완료</h2>
        <p className="mb-1 text-sm text-primary">앱을 다시 불러옵니다. 복원된 데이터로 새로 시작합니다.</p>
        <p className="mb-4 text-xs text-muted">
          다시 불러온 뒤에도 이상 동작이 보이면 서버(백엔드)를 재시작하세요.
        </p>
        <button
          type="button"
          onClick={onReload}
          className="w-full rounded bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          앱 다시 불러오기
        </button>
      </div>
    </div>
  )
}

function RestoreConfirmModal({
  backup,
  onClose,
  onConfirm,
  submitting,
  errorMessage,
}: {
  backup: BackupItem
  onClose: () => void
  onConfirm: () => void
  submitting?: boolean
  errorMessage?: string | null
}) {
  const [typed, setTyped] = useState('')
  const matched = typed.trim() === CONFIRM_PHRASE

  return (
    <Modal title="백업 복원" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-primary">
          "{backup.created_at}" 백업으로 되돌립니다. 그 이후에 쌓인 학습 기록은 모두 사라집니다
          (복원 전 현재 상태는 자동으로 스냅샷됩니다).
        </p>
        <label className="flex flex-col gap-1 text-sm">
          계속하려면 <span className="font-semibold text-wrong">{CONFIRM_PHRASE}</span>을(를) 입력하세요.
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
        </label>
        {errorMessage && <p className="text-sm text-wrong">{errorMessage}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1.5 text-sm text-primary hover:bg-bg"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!matched || submitting}
            onClick={onConfirm}
            className="rounded bg-wrong px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '복원 중…' : '복원 실행'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
