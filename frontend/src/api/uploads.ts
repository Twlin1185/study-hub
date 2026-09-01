import { useMutation } from '@tanstack/react-query'
import { api } from './client'
import type { UploadImageResponse } from './types'

// 설계 §4.27(S29, F54) — 이미지 첨부 업로드. 요청당 파일 1개(다중은 호출부가 순차 호출).
// 성공 응답 필드는 url 하나뿐(신규 저장·중복 재사용 응답 동일 — 프론트는 구분하지 않는다).
// 실패(전부 422)는 client.ts가 서버 message를 그대로 담아 ApiError로 던진다 — 프론트는
// code·detail.reason으로 분기하지 않고 그 message를 그대로 렌더한다(§3, 진입점: 편집2 블록 표면
// (BlockSurface)의 이미지 업로드 파이프라인 — stage-43 F-1로 구 편집기 방언 위젯은 퇴역).
export function useUploadImage() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.postForm<UploadImageResponse>('/uploads', form)
    },
  })
}
