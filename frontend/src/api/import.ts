import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { categoryKeys } from './categories'
import { documentKeys } from './documents'
import type { ImportCommitRequest, ImportCommitResult, ImportPreviewResponse } from './types'

export interface ImportPreviewInput {
  jsonFile: File
  sourceFile?: File | null
}

// 설계 §4.3: multipart로 JSON 파일 업로드(+ 선택적 원본 파일 source_file).
// JSON 파일의 필드명은 명세에 명시되어 있지 않아 'file'로 가정 — 최종 보고 참고.
export function useImportPreview() {
  return useMutation({
    mutationFn: ({ jsonFile, sourceFile }: ImportPreviewInput) => {
      const form = new FormData()
      form.append('file', jsonFile)
      if (sourceFile) form.append('source_file', sourceFile)
      return api.postForm<ImportPreviewResponse>('/import/preview', form)
    },
  })
}

export function useImportCommit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ImportCommitRequest) => api.post<ImportCommitResult>('/import/commit', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
      qc.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}

// stage-42(B2-2, §4.3) — 분할 조각 미리보기 병합. 각 조각의 정규화 문서를 주어진 순서로 연결한
// 새 preview(항목 재인덱스·경고 승계·보존 O)를 돌려준다 — 응답 모양은 GET preview와 동일
// (ImportPreviewResponse). 원 조각 preview는 삭제되지 않는다(TTL 자연 만료). 누락·만료 preview_id는
// 404(ImportQueue.tsx가 인라인 에러로 표시).
export function useMergePreviews() {
  return useMutation({
    mutationFn: (previewIds: string[]) =>
      api.post<ImportPreviewResponse>('/import/preview/merge', { preview_ids: previewIds }),
  })
}
