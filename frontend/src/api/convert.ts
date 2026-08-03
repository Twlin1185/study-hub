import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from './client'
import { documentKeys } from './documents'
import type {
  ConvertJobResponse,
  ConvertJobStartResponse,
  ImportPreviewResponse,
  LlmEngine,
  RegenerateJobResponse,
} from './types'

const POLL_INTERVAL_MS = 2000

// 대기열(F40-②) 폴링 간격 — 서버 워커가 동시 1개라 **현재 처리 중 1건만** 촘촘히 보고,
// 뒤에서 순서를 기다리는 잡은 간격을 완화한다(설계 §5.9).
export const ACTIVE_POLL_INTERVAL_MS = POLL_INTERVAL_MS
export const IDLE_POLL_INTERVAL_MS = 10000

// 설계 §4.10·§4.11, F23·F34·F35 — "원본 파일로 시작"(multipart) 또는 "URL로 시작"(JSON {url})
// 업로드. multipart 필드명은 명세에 없어 import/preview와 동일 관례("file")로 가정 — 최종 보고 참고.
// engine은 §4.11 신규 파라미터, §4.17③에서 'auto'|엔진id로 확장(legacy 'cli'|'api'는 별칭
// 매핑으로 계속 수용) — 생략 시 서버 기본 auto=우선순위 설정.
// categoryPath는 S13(F40-③) 선택 파라미터 `category_path` — 지정 시 LLM이 모든 문항의 분류
// 제안을 그 경로 하나로 고정한다(제안 고정일 뿐 반입 확정은 여전히 사용자 승인 — R7).
// model(S22, 설계 §4.24 ④, F48) — 1회성 오버라이드. engine이 auto·미지정인데 model만 있으면
// 서버가 422(엔진 먼저 선택), 소목록 밖 값도 422. 미지정 = 설정값 폴백(기존 동작 불변).
export type StartConvertInput =
  | { kind: 'file'; file: File; engine?: LlmEngine; model?: string; categoryPath?: string | null }
  | { kind: 'url'; url: string; engine?: LlmEngine; model?: string; categoryPath?: string | null }

// 훅 밖(대기열 순차 투입 루프 등)에서도 쓰도록 요청 함수를 따로 노출한다.
export function startConvertRequest(input: StartConvertInput): Promise<ConvertJobStartResponse> {
  const categoryPath = input.categoryPath?.trim() ? input.categoryPath.trim() : undefined
  if (input.kind === 'file') {
    const form = new FormData()
    form.append('file', input.file)
    if (input.engine) form.append('engine', input.engine)
    if (input.model) form.append('model', input.model)
    if (categoryPath) form.append('category_path', categoryPath)
    return api.postForm<ConvertJobStartResponse>('/convert', form)
  }
  return api.post<ConvertJobStartResponse>('/convert', {
    url: input.url,
    engine: input.engine,
    model: input.model,
    category_path: categoryPath,
  })
}

export function useStartConvert() {
  return useMutation({ mutationFn: startConvertRequest })
}

// S13(F40-①, 설계 §4.3) — 보존된 반입 JSON 내려받기 링크. 최악의 경우에도 사용자가 파일을 손에
// 쥐고 "반입 JSON 파일 선택" 경로로 이어갈 수 있는 탈출구다(브라우저 다운로드이므로 <a download>).
export function previewJsonUrl(previewId: string): string {
  return `/api/import/preview/${encodeURIComponent(previewId)}/json`
}

// GET /api/convert/{job_id} 폴링 — running인 동안 2초 간격 재조회.
// retry: false — 잡 큐는 인메모리(서버 재시작 시 소실) + TTL 1시간이라 404가 된 잡은
// 재요청해도 돌아오지 않는다. 재시도하면 사라진 잡을 계속 두드리기만 한다(regenerate 잡 전례).
// 캐시 키 = 리소스 경로(설계 §7). 대기열(F40-②)이 useQueries로 여러 잡을 동시에 폴링할 때도
// 같은 키·같은 요청 함수를 써야 단건 조회와 캐시가 공유된다.
export const convertJobKey = (jobId: string) => ['convert', 'job', jobId] as const

export function fetchConvertJob(jobId: string): Promise<ConvertJobResponse> {
  return api.get<ConvertJobResponse>(`/convert/${jobId}`)
}

export function useConvertJob(jobId: string | null) {
  return useQuery({
    queryKey: convertJobKey(jobId ?? ''),
    queryFn: () => fetchConvertJob(jobId as string),
    enabled: jobId != null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_INTERVAL_MS : false),
    retry: false,
  })
}

// 잡이 서버에서 사라졌는가(404) — 서버 재시작 또는 TTL(1시간) 만료. 이 상태에서는 진행 표시를
// 멈추고 "다시 시도" 안내로 빠져나가야 한다(폴링 결과가 영영 오지 않으므로 진행 중 표시를
// 유지하면 화면이 "처리 준비 중…"에서 멈춘 것처럼 보인다 — 2026-07-26 사용자 실사용 보고).
export function isJobLost(query: { isError: boolean; error: unknown }): boolean {
  return query.isError && query.error instanceof ApiError && query.error.status === 404
}

// 진행 상황을 더 이상 확인할 수 없는 상태를 구분한다.
//   'lost'        — 404: 잡이 서버에서 사라짐(재시작·TTL 1시간 만료). 다시 시도해야 한다.
//   'unreachable' — 그 외 실패(서버가 꺼졌거나 재시작 중, 네트워크 끊김). 서버가 돌아오면
//                   같은 잡이 살아 있을 수도 있으므로 '다시 확인'을 권한다.
// 404만 처리하면 서버를 끄거나 재시작하는 동안 화면이 "처리 준비 중…"에 갇힌다
// (2026-07-26 실사용 확인 — 서버 재시작이 잦은 로컬 앱이라 흔한 경로다).
export type JobUnavailable = 'lost' | 'unreachable' | null

export function jobUnavailable(query: { isError: boolean; error: unknown }): JobUnavailable {
  if (!query.isError) return null
  return isJobLost(query) ? 'lost' : 'unreachable'
}

// convert 잡 완료(done) 시 result_preview_id로 반입 preview를 자동 연동한다. §4.3에는 preview_id로
// 기존 미리보기를 다시 조회하는 GET 엔드포인트가 명세되어 있지 않아 `/import/preview/{id}`가
// 있다고 가정해 시도한다 — 실패 시 폴백 안내(수동 반입)로 이어진다. **명세 갭 — 최종 보고 필수.**
export function useConvertedPreview(previewId: string | null) {
  return useQuery({
    queryKey: ['import', 'preview', previewId ?? ''],
    queryFn: () => api.get<ImportPreviewResponse>(`/import/preview/${previewId}`),
    enabled: previewId != null,
    retry: false,
  })
}

// F30 — 문제 오류 신고 → 재생성 잡 시작 (convert 잡 큐 재사용, 동시 1개). engine은 §4.11 신규
// 파라미터 — 한도 초과 후 재시도 시 다음 후보 엔진 id로 재요청하는 계약(§4.17③, 이항 아님).
export function useRegenerate() {
  return useMutation({
    mutationFn: ({
      documentId,
      reason,
      engine,
    }: {
      documentId: number
      reason: string
      engine?: LlmEngine
    }) => api.post<ConvertJobStartResponse>(`/documents/${documentId}/regenerate`, { reason, engine }),
  })
}

// GET .../regenerate/{job_id} 폴링 — 완료 시 기존/신규 비교용 초안(draft) 포함.
export function useRegenerateJob(documentId: number | null, jobId: string | null) {
  return useQuery({
    queryKey: ['documents', documentId ?? -1, 'regenerate', jobId ?? ''],
    queryFn: () => api.get<RegenerateJobResponse>(`/documents/${documentId}/regenerate/${jobId}`),
    enabled: documentId != null && jobId != null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_INTERVAL_MS : false),
    retry: false,
  })
}

// 초안 승인 → 기존 문서를 PATCH 방식으로 교체(같은 id·doc_no 유지, 이력 보존).
export function useApplyRegenerate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ documentId, jobId }: { documentId: number; jobId: string }) =>
      api.post<void>(`/documents/${documentId}/regenerate/${jobId}/apply`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: documentKeys.detail(variables.documentId) })
      qc.invalidateQueries({ queryKey: documentKeys.all })
    },
  })
}
