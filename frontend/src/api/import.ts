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
