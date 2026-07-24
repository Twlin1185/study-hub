import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { documentKeys } from './documents'
import type {
  ConvertJobResponse,
  ConvertJobStartResponse,
  ImportPreviewResponse,
  RegenerateJobResponse,
} from './types'

const POLL_INTERVAL_MS = 2000

// 설계 §4.10, F23 — "원본 파일로 시작" 업로드. multipart 필드명은 명세에 없어 import/preview와
// 동일 관례("file")로 가정 — 최종 보고 참고.
export function useStartConvert() {
  return useMutation({
    mutationFn: (sourceFile: File) => {
      const form = new FormData()
      form.append('file', sourceFile)
      return api.postForm<ConvertJobStartResponse>('/convert', form)
    },
  })
}

// GET /api/convert/{job_id} 폴링 — running인 동안 2초 간격 재조회.
export function useConvertJob(jobId: string | null) {
  return useQuery({
    queryKey: ['convert', 'job', jobId ?? ''],
    queryFn: () => api.get<ConvertJobResponse>(`/convert/${jobId}`),
    enabled: jobId != null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_INTERVAL_MS : false),
  })
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

// F30 — 문제 오류 신고 → 재생성 잡 시작 (convert 잡 큐 재사용, 동시 1개)
export function useRegenerate() {
  return useMutation({
    mutationFn: ({ documentId, reason }: { documentId: number; reason: string }) =>
      api.post<ConvertJobStartResponse>(`/documents/${documentId}/regenerate`, { reason }),
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
