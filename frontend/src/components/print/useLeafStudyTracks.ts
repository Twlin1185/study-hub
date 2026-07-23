import { useQueries } from '@tanstack/react-query'
import { api } from '../../api/client'
import { studyKeys } from '../../api/study'
import type { LeafGroup } from '../../utils/tree'
import type { StudyTrackResponse } from '../../api/types'

export interface LeafTrackResult {
  leaf: LeafGroup
  data: StudyTrackResponse | undefined
  isLoading: boolean
  isError: boolean
}

// 인쇄 뷰(§5.10) 전용 — 선택 범위의 리프 분류마다 study-track을 병렬 조회해 정렬된 문서 순서를 얻는다.
// 전용 인쇄 API가 없어(설계 "study-track·documents/batch·review-notes 조합") 기존 훅을 재사용한다.
export function useLeafStudyTracks(leaves: LeafGroup[]): LeafTrackResult[] {
  const results = useQueries({
    queries: leaves.map((leaf) => ({
      queryKey: studyKeys.track(leaf.id),
      queryFn: () => api.get<StudyTrackResponse>(`/categories/${leaf.id}/study-track`),
    })),
  })

  return leaves.map((leaf, i) => ({
    leaf,
    data: results[i]?.data,
    isLoading: results[i]?.isLoading ?? false,
    isError: results[i]?.isError ?? false,
  }))
}
