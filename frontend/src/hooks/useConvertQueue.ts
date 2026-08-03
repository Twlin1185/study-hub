import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import {
  ACTIVE_POLL_INTERVAL_MS,
  IDLE_POLL_INTERVAL_MS,
  convertJobKey,
  fetchConvertJob,
  startConvertRequest,
} from '../api/convert'
import { newEntryId, readQueue, writeQueue } from '../utils/convertQueue'
import type { StoredQueueEntry } from '../utils/convertQueue'
import type { ConvertJobResponse, JobProgress, LlmEngine, LlmErrorInfo } from '../api/types'

// 반입 대기열(F40-②, 설계 §5.9) 상태 관리.
//
// 원칙:
//  - **새 API 0건** — 파일 수만큼 기존 POST /api/convert를 호출해 서버 큐에 쌓는다. 서버 워커는
//    동시 1개이므로 프론트도 **순차로 투입**한다(병렬 실행 금지 · 투입 순서 = 처리 순서).
//  - 잡 기록은 localStorage 배열(utils/convertQueue)에 남겨 새로고침·재접속 후 복원된다.
//  - 서버 잡 상태는 'running|done|error' 3종뿐이라 "대기"와 "변환 중"을 구분하지 않는다 →
//    **목록에서 아직 끝나지 않은 첫 항목**을 처리 중(active)으로 본다(서버가 FIFO 1개 처리).
//  - File 객체는 직렬화 불가라 이번 세션 메모리에만 남는다 — 새로고침 후 재시도는 재선택 안내.

export const MAX_QUEUE_BATCH = 10

export type QueueItemStatus = 'queued' | 'running' | 'ready' | 'committed' | 'error'

export interface QueueItem {
  entry: StoredQueueEntry
  label: string
  status: QueueItemStatus
  // 현재 서버가 처리 중이라고 보는 1건 — 진행 표시(LlmJobProgress)는 이 항목에만 붙인다.
  active: boolean
  progress: JobProgress | null | undefined
  errorInfo: LlmErrorInfo | null | undefined
  legacyError: string | null | undefined
  previewId: string | null
  // 잡 성공 결과에 덧붙는 사람이 읽는 문장 목록(S14, §4.13, 기본 []) — 서버가 문구를 완성해
  // 내려주므로 그대로 렌더한다(가공 금지).
  notes: string[]
  // 잡을 더 이상 확인할 수 없는 상태(404=lost, 그 외=서버 연결 실패).
  unavailable: 'lost' | 'unreachable' | null
  // 서버 연결 실패(unreachable) 후 [다시 확인]용 — 실패하면 폴링이 자동 재개되지 않는다.
  refetch: (() => void) | null
  // 이번 세션에 File 객체가 남아 있는가(파일 소스 재시도 가능 여부).
  retryable: boolean
}

export interface QueueFileInput {
  file: File
  categoryPath?: string | null
}

// S21(설계 §4.23) — 반입 시작 화면 engine 선택(§5.9 ①). 배치 전체에 같은 엔진을 적용한다
// (파일별 개별 엔진 지정은 이 단계 범위 밖 — "요청 단위 모델 오버라이드 없음"과 동일 원칙).
export interface StartOptions {
  engine?: LlmEngine
}

function labelOf(entry: StoredQueueEntry): string {
  return entry.fileName || entry.url || entry.fetchLabel || entry.jobId || '이름 없는 작업'
}

function startErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '변환 시작에 실패했습니다.'
}

// 한도 기억 사전 차단(409)은 detail에 LlmErrorInfo가 실려 온다(설계 §4.11) — 구조화 렌더용.
function extractStartErrorInfo(error: unknown): LlmErrorInfo | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const detail = error.detail
  if (detail && typeof detail === 'object' && 'kind' in detail) return detail as LlmErrorInfo
  return null
}

export function useConvertQueue() {
  const [entries, setEntriesState] = useState<StoredQueueEntry[]>(() => readQueue())
  const [starting, setStarting] = useState(false)
  // 이번 세션의 File 객체(entryId → File). 새로고침하면 사라진다.
  const filesRef = useRef<Map<string, File>>(new Map())
  // refetchInterval 콜백이 최신 active 잡을 읽을 수 있게 ref로 들고 있는다.
  const activeJobIdRef = useRef<string | null>(null)

  const updateEntry = useCallback(
    (id: string, patch: Partial<StoredQueueEntry>) => {
      setEntriesState((prev) => {
        const next = prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
        writeQueue(next)
        return next
      })
    },
    [],
  )

  // 파일·URL 반입 항목만 이 화면의 대기열로 다룬다(사이트 반입은 자체 위저드가 관리 — §4.13).
  const queueEntries = useMemo(() => entries.filter((e) => e.sourceKind !== 'fetch'), [entries])

  const results = useQueries({
    queries: queueEntries.map((entry) => ({
      queryKey: convertJobKey(entry.jobId ?? ''),
      queryFn: () => fetchConvertJob(entry.jobId as string),
      // preview_id를 이미 확보했으면 잡을 더 두드리지 않는다(잡은 TTL 1h·재시작으로 사라져도
      // 미리보기는 디스크 보존본에서 복구된다 — F40-①).
      enabled: entry.jobId != null && entry.committed !== true && !entry.previewId,
      retry: false,
      refetchInterval: (query: { state: { data?: ConvertJobResponse } }) => {
        if (query.state.data?.status !== 'running') return false as const
        return entry.jobId === activeJobIdRef.current ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS
      },
    })),
  })

  const items: QueueItem[] = useMemo(() => {
    // 1차: 종료(terminal) 여부 판정 — 아직 안 끝난 첫 항목이 곧 서버가 처리 중인 잡이다.
    const raw: QueueItem[] = queueEntries.map((entry, i) => {
      const r = results[i] as
        | { data?: ConvertJobResponse; isError?: boolean; error?: unknown; refetch?: () => void }
        | undefined
      const lost = r?.isError && r.error instanceof ApiError && r.error.status === 404
      const unavailable: QueueItem['unavailable'] = r?.isError ? (lost ? 'lost' : 'unreachable') : null
      const data = r?.data

      const previewId = entry.previewId ?? data?.result_preview_id ?? null

      let status: QueueItemStatus
      if (entry.committed) status = 'committed'
      // preview_id를 확보한 뒤에는 잡이 사라져도(404) 검토를 계속할 수 있다 — 서버가 보존본에서
      // 미리보기를 복구한다(F40-①, §4.3). 그래서 'ready' 판정이 오류 판정보다 우선한다.
      else if (previewId) status = 'ready'
      else if (entry.startError) status = 'error'
      else if (lost) status = 'error'
      else if (data?.status === 'error') status = 'error'
      else if (data?.status === 'done') status = 'error' // done인데 preview_id가 없는 경우
      else status = 'queued' // 'running'은 아래에서 active 1건에만 부여

      return {
        entry,
        label: labelOf(entry),
        status,
        active: false,
        progress: data?.progress,
        errorInfo: entry.startErrorInfo ?? data?.error_info,
        legacyError:
          entry.startError ??
          data?.error ??
          (data?.status === 'done' && !previewId
            ? '변환은 완료됐지만 미리보기 정보를 받지 못했습니다. 다시 시도하거나 JSON 파일을 직접 선택해 반입하세요.'
            : lost
              ? '서버가 다시 시작되었거나 작업 정보가 만료되어(1시간) 이 변환 작업이 사라졌습니다. 다시 시도해 주세요.'
              : undefined),
        previewId,
        notes: data?.notes ?? [],
        unavailable: previewId ? null : unavailable,
        refetch: r?.refetch ?? null,
        retryable: entry.sourceKind === 'url' ? Boolean(entry.url) : filesRef.current.has(entry.id),
      }
    })

    const activeIndex = raw.findIndex((it) => it.status === 'queued')
    if (activeIndex >= 0) {
      raw[activeIndex] = { ...raw[activeIndex], active: true, status: 'running' }
    }
    return raw
  }, [queueEntries, results])

  const activeJobId = items.find((it) => it.active)?.entry.jobId ?? null
  useEffect(() => {
    activeJobIdRef.current = activeJobId
  }, [activeJobId])

  // 변환이 끝나 preview_id가 나오면 즉시 localStorage에 새긴다 — 새로고침·서버 재시작 후에도
  // "검토 대기" 상태와 [검토] 경로가 유지된다(잡은 사라져도 미리보기는 복구된다 — F40-①).
  useEffect(() => {
    for (const item of items) {
      if (item.previewId && item.entry.previewId !== item.previewId) {
        updateEntry(item.entry.id, { previewId: item.previewId })
      }
    }
  }, [items, updateEntry])

  const pendingCount = items.filter((it) => it.status === 'queued' || it.status === 'running').length
  const readyCount = items.filter((it) => it.status === 'ready').length

  // 순차 투입 — 앞 요청이 끝난 뒤 다음을 보낸다(서버 큐 순서 = 사용자가 고른 순서).
  // engine(S21, §4.23) — 지정 시 배치 전체(이번 선택분)에 같은 값을 적용한다. 미지정(undefined)은
  // 기존 동작 그대로(서버 기본 auto).
  const startFiles = useCallback(
    async (inputs: QueueFileInput[], opts?: StartOptions) => {
      const created: StoredQueueEntry[] = inputs.map((input) => ({
        id: newEntryId(),
        jobId: null,
        sourceKind: 'file',
        fileName: input.file.name,
        categoryPath: input.categoryPath ?? null,
        committed: false,
        startError: null,
        startErrorInfo: null,
        createdAt: Date.now(),
      }))
      created.forEach((entry, i) => filesRef.current.set(entry.id, inputs[i].file))
      setEntriesState((prev) => {
        const next = [...prev, ...created]
        writeQueue(next)
        return next
      })

      setStarting(true)
      for (const entry of created) {
        const file = filesRef.current.get(entry.id)
        if (!file) continue
        try {
          const res = await startConvertRequest({
            kind: 'file',
            file,
            engine: opts?.engine,
            categoryPath: entry.categoryPath,
          })
          updateEntry(entry.id, { jobId: res.job_id, startError: null, startErrorInfo: null })
        } catch (err) {
          updateEntry(entry.id, {
            startError: startErrorMessage(err),
            startErrorInfo: extractStartErrorInfo(err),
          })
        }
      }
      setStarting(false)
    },
    [updateEntry],
  )

  const startUrl = useCallback(
    async (url: string, categoryPath?: string | null, opts?: StartOptions) => {
      const entry: StoredQueueEntry = {
        id: newEntryId(),
        jobId: null,
        sourceKind: 'url',
        url,
        categoryPath: categoryPath ?? null,
        committed: false,
        startError: null,
        startErrorInfo: null,
        createdAt: Date.now(),
      }
      setEntriesState((prev) => {
        const next = [...prev, entry]
        writeQueue(next)
        return next
      })
      setStarting(true)
      try {
        const res = await startConvertRequest({ kind: 'url', url, engine: opts?.engine, categoryPath })
        updateEntry(entry.id, { jobId: res.job_id, startError: null, startErrorInfo: null })
      } catch (err) {
        updateEntry(entry.id, {
          startError: startErrorMessage(err),
          startErrorInfo: extractStartErrorInfo(err),
        })
      }
      setStarting(false)
    },
    [updateEntry],
  )

  // [다시 시도] — S15(설계 §4.17③): 엔진은 호출자가 error_info.fallback_engine에서 구해 넘긴다
  // (다음 후보 엔진, 이항 가정 아님). 인자를 생략하거나 undefined면 legacy 'api' 폴백을 유지한다
  // (fallback_engine 필드가 없는 과도기 응답 대응 — 프론트 결정, 설계에 별도 규칙 없음).
  // 파일 소스는 이번 세션에 File이 있어야 한다.
  const retryEntry = useCallback(
    async (id: string, engine: LlmEngine = 'api') => {
      const entry = entries.find((e) => e.id === id)
      if (!entry) return
      setStarting(true)
      try {
        let res
        if (entry.sourceKind === 'url' && entry.url) {
          res = await startConvertRequest({
            kind: 'url',
            url: entry.url,
            engine,
            categoryPath: entry.categoryPath,
          })
        } else {
          const file = filesRef.current.get(id)
          if (!file) {
            setStarting(false)
            return
          }
          res = await startConvertRequest({ kind: 'file', file, engine, categoryPath: entry.categoryPath })
        }
        // 재시도는 새 잡·새 미리보기를 만든다 — 이전 preview_id는 버린다.
        updateEntry(id, {
          jobId: res.job_id,
          previewId: null,
          startError: null,
          startErrorInfo: null,
          committed: false,
        })
      } catch (err) {
        updateEntry(id, {
          startError: startErrorMessage(err),
          startErrorInfo: extractStartErrorInfo(err),
        })
      }
      setStarting(false)
    },
    [entries, updateEntry],
  )

  const markCommitted = useCallback(
    (id: string) => updateEntry(id, { committed: true }),
    [updateEntry],
  )

  const removeEntry = useCallback(
    (id: string) => {
      filesRef.current.delete(id)
      setEntriesState((prev) => {
        const next = prev.filter((e) => e.id !== id)
        writeQueue(next)
        return next
      })
    },
    [],
  )

  // 반입 완료·건너뛴 항목 정리 — 진행 중·검토 대기 항목은 남긴다.
  const clearFinished = useCallback(() => {
    setEntriesState((prev) => {
      const next = prev.filter((e) => e.sourceKind === 'fetch' || !e.committed)
      for (const e of prev) if (e.committed) filesRef.current.delete(e.id)
      writeQueue(next)
      return next
    })
  }, [])

  const entryById = useCallback((id: string | null) => items.find((it) => it.entry.id === id) ?? null, [items])

  return {
    items,
    pendingCount,
    readyCount,
    starting,
    startFiles,
    startUrl,
    retryEntry,
    markCommitted,
    removeEntry,
    clearFinished,
    entryById,
  }
}

export type ConvertQueue = ReturnType<typeof useConvertQueue>
