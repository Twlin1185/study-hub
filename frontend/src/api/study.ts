import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { categoryKeys } from './categories'
import type { ContinueCard, StudyEventRequest, StudyTrackResponse } from './types'

export const studyKeys = {
  track: (categoryId: number) => ['study', 'track', categoryId] as const,
  continue: ['study', 'continue'] as const,
}

export function useStudyTrack(categoryId: number | null) {
  return useQuery({
    queryKey: studyKeys.track(categoryId ?? -1),
    queryFn: () => api.get<StudyTrackResponse>(`/categories/${categoryId}/study-track`),
    enabled: categoryId != null,
  })
}

// 홈/커리큘럼 "이어하기" 카드 목록 (설계 §4.4)
export function useContinueList() {
  return useQuery({
    queryKey: studyKeys.continue,
    queryFn: () => api.get<ContinueCard[]>('/study/continue'),
  })
}

interface CompleteMutationContext {
  previous?: StudyTrackResponse
  key?: ReturnType<typeof studyKeys.track>
}

export function useStudyEvent() {
  const qc = useQueryClient()
  return useMutation<void, unknown, StudyEventRequest, CompleteMutationContext>({
    mutationFn: (body) => api.post<void>('/study/events', body),
    // 규칙: 낙관적 업데이트는 북마크·진도 완료에만 적용 — action:'complete'는 학습 트랙 캐시를
    // 즉시 갱신해 "다음" 버튼 체감 속도를 확보한다. position은 낙관적 업데이트 대상이 아니다.
    onMutate: async (body) => {
      if (body.action !== 'complete') return {}
      const key = studyKeys.track(body.category_id)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<StudyTrackResponse>(key)
      if (previous) {
        qc.setQueryData<StudyTrackResponse>(key, {
          ...previous,
          items: previous.items.map((item) =>
            item.document_id === body.document_id ? { ...item, status: 'done' } : item,
          ),
        })
      }
      return { previous, key }
    },
    onError: (_err, _body, context) => {
      if (context?.previous && context.key) {
        qc.setQueryData(context.key, context.previous)
      }
    },
    onSettled: (_data, _err, variables) => {
      qc.invalidateQueries({ queryKey: studyKeys.track(variables.category_id) })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
      qc.invalidateQueries({ queryKey: studyKeys.continue })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
