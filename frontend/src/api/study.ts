import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { categoryKeys } from './categories'
import type { ContinueCard, DocumentType, StudyEventRequest, StudyTrackResponse } from './types'

// S9(F37): deep=1(하위 트리 포함) · types=(타입 필터) — 기존 호출(옵션 없음)은 결과 불변 (§4.12).
export interface StudyTrackOptions {
  deep?: boolean
  types?: DocumentType[]
}

export const studyKeys = {
  // 옵션 포함 캐시 키 — 기존 무옵션 호출과 deep/types 조합을 구분한다.
  track: (categoryId: number, options?: StudyTrackOptions) =>
    ['study', 'track', categoryId, options?.deep ?? false, options?.types?.join(',') ?? ''] as const,
  continue: ['study', 'continue'] as const,
}

function trackQuery(options?: StudyTrackOptions): string {
  const params = new URLSearchParams()
  if (options?.deep) params.set('deep', '1')
  if (options?.types && options.types.length > 0) params.set('types', options.types.join(','))
  const q = params.toString()
  return q ? `?${q}` : ''
}

export function useStudyTrack(categoryId: number | null, options?: StudyTrackOptions) {
  return useQuery({
    queryKey: studyKeys.track(categoryId ?? -1, options),
    queryFn: () => api.get<StudyTrackResponse>(`/categories/${categoryId}/study-track${trackQuery(options)}`),
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
      // 낙관적 갱신은 무옵션(기본) 학습 트랙만 대상 — 파이프라인 deep 변형은 onSettled 무효화로 최신화.
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
      // deep/types 변형까지 모두 무효화하도록 접두 키로 매칭.
      qc.invalidateQueries({ queryKey: ['study', 'track', variables.category_id] })
      qc.invalidateQueries({ queryKey: categoryKeys.tree })
      qc.invalidateQueries({ queryKey: studyKeys.continue })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
