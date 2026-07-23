import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { Tag } from './types'

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<Tag[]>('/tags'),
  })
}
