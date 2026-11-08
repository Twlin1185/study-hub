import { useCallback, useMemo, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { startConvertRequest } from '../api/convert'
import type { StartConvertInput } from '../api/convert'
import { importRunKeys, isRunInProgress, listRuns, useRunDetail } from '../api/importRuns'
import { llmJobsKey, useLlmJobs } from '../api/llm'
import type { ImportRun, LlmEngine, LlmErrorInfo, LlmJobItem, LlmJobsResponse } from '../api/types'

// 반입 건 목록(설계 §4.34, §5.9 [S56]) — 서버가 정본. 진행 중 run이 있을 때만 짧은 간격으로 폴링하고
// 없으면 폴링 0(탭 복귀·마운트 시 갱신은 기본 동작). 라이브 잡 진행은 서버가 싣지 않으므로
// 전역 잡 쿼리(useLlmJobs — 키 공유·중복 폴링 0)와 job_id로 조인한다.

export const RUNS_PAGE_SIZE = 50
const RUNS_ACTIVE_POLL_MS = 3000

export interface UseImportRunsResult {
  runs: ImportRun[]
  total: number
  hasMore: boolean
  fetchMore: () => void
  fetchingMore: boolean
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
  // job_id -> 전역 잡 항목(TTL로 사라졌으면 없음 — 진행 표시만 생략)
  jobsById: Map<string, LlmJobItem>
  reviewReadyCount: number
  inProgressCount: number
  // ?run= 단건 보강 결과 — 첫 페이지에 없던 run은 맨 위에 고정해 포함한다(runs에 이미 합쳐짐).
  pinnedMissing: boolean
}

export function useImportRuns(pinnedRunId: number | null): UseImportRunsResult {
  const qc = useQueryClient()
  const query = useInfiniteQuery({
    queryKey: [...importRunKeys.all, 'list'] as const,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => listRuns(pageParam, RUNS_PAGE_SIZE),
    getNextPageParam: (last) => (last.page * last.size < last.total ? last.page + 1 : undefined),
    refetchInterval: (q) => {
      const pages = q.state.data?.pages ?? []
      const jobs = qc.getQueryData<LlmJobsResponse>(llmJobsKey)?.items ?? []
      const liveJobIds = new Set(jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.job_id))
      // 진행 중 상태 · 분할 조각이 아직 덜 모인 run(첫 조각에서 review_ready가 돼도 계속) · 살아 있는 잡이 붙은 run.
      const active = pages.some((p) =>
        p.items.some((r) => {
          if (isRunInProgress(r.status)) return true
          const s = r.summary
          if (s.chunks_total != null && s.previews.length + (s.chunks_failed ?? 0) < s.chunks_total) return true
          return r.job_id != null && liveJobIds.has(r.job_id)
        }),
      )
      return active ? RUNS_ACTIVE_POLL_MS : false
    },
  })
  const jobsQuery = useLlmJobs()

  const listed = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.items), [query.data])
  const total = query.data?.pages[0]?.total ?? 0

  // ?run=<id>가 첫 페이지(들)에 없으면 단건 GET으로 카드 1장을 상단 고정한다.
  const missing = pinnedRunId != null && query.isFetched && !listed.some((r) => r.id === pinnedRunId)
  const pinnedDetail = useRunDetail(pinnedRunId, { enabled: missing })
  const runs = useMemo(() => {
    if (missing && pinnedDetail.data) return [pinnedDetail.data.run, ...listed]
    return listed
  }, [listed, missing, pinnedDetail.data])

  const jobsById = useMemo(() => {
    const map = new Map<string, LlmJobItem>()
    for (const it of jobsQuery.data?.items ?? []) map.set(it.job_id, it)
    return map
  }, [jobsQuery.data])

  const reviewReadyCount = listed.filter((r) => r.status === 'review_ready').length
  const inProgressCount = listed.filter((r) => isRunInProgress(r.status)).length

  return {
    runs,
    total,
    hasMore: query.hasNextPage === true,
    fetchMore: () => void query.fetchNextPage(),
    fetchingMore: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    jobsById,
    reviewReadyCount,
    inProgressCount,
    pinnedMissing: missing && pinnedDetail.isError,
  }
}

// ---- 시작 함수(구 localStorage 대기열 투입 로직 대체) ----
// 서버 워커는 동시 1개라 파일 다중 선택은 **순차 투입**(투입 순서 = 처리 순서)한다. 상태는 서버 run이
// 정본이므로 localStorage에 아무것도 쓰지 않는다. 시작 요청 후 run 목록·잡 목록을 invalidate한다.

export const MAX_START_BATCH = 10

export interface StartOptions {
  engine?: LlmEngine
  model?: string
}

export interface StartFileInput {
  file: File
  categoryPath?: string | null
}

export interface StartFailure {
  name: string
  message: string
  errorInfo: LlmErrorInfo | null
}

export interface StartOutcome {
  runIds: number[]
  failures: StartFailure[]
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

export function useStartImportRuns() {
  const qc = useQueryClient()
  const [starting, setStarting] = useState(false)

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: importRunKeys.all })
    qc.invalidateQueries({ queryKey: llmJobsKey })
  }, [qc])

  const runOne = useCallback(
    async (name: string, input: StartConvertInput, outcome: StartOutcome) => {
      try {
        const res = await startConvertRequest(input)
        if (res.run_id != null) outcome.runIds.push(res.run_id)
        invalidate()
      } catch (err) {
        outcome.failures.push({ name, message: startErrorMessage(err), errorInfo: extractStartErrorInfo(err) })
      }
    },
    [invalidate],
  )

  const startFiles = useCallback(
    async (inputs: StartFileInput[], opts?: StartOptions): Promise<StartOutcome> => {
      const outcome: StartOutcome = { runIds: [], failures: [] }
      setStarting(true)
      for (const input of inputs) {
        await runOne(
          input.file.name,
          {
            kind: 'file',
            file: input.file,
            engine: opts?.engine,
            model: opts?.model,
            categoryPath: input.categoryPath,
          },
          outcome,
        )
      }
      setStarting(false)
      return outcome
    },
    [runOne],
  )

  const startUrl = useCallback(
    async (url: string, categoryPath?: string | null, opts?: StartOptions): Promise<StartOutcome> => {
      const outcome: StartOutcome = { runIds: [], failures: [] }
      setStarting(true)
      await runOne(url, { kind: 'url', url, engine: opts?.engine, model: opts?.model, categoryPath }, outcome)
      setStarting(false)
      return outcome
    },
    [runOne],
  )

  return { starting, startFiles, startUrl }
}
