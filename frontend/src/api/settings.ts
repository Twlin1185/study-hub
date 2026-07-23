import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { SettingsPatch, SettingsResponse } from './types'

export const settingsKeys = {
  all: ['settings'] as const,
}

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => api.get<SettingsResponse>('/settings'),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SettingsPatch) => api.put<SettingsResponse>('/settings', body),
    onSuccess: (data) => qc.setQueryData(settingsKeys.all, data),
  })
}
