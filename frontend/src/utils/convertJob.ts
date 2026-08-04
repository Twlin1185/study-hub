// 사이트 반입(§4.13, FetchImportWizard)이 쓰는 **단건 슬롯 뷰**.
//
// S13(F40-②)부터 실제 저장소는 배열 대기열(utils/convertQueue.ts) 하나뿐이다 — 이 모듈은 그
// 위에 얹은 호환 어댑터로, 사이트 반입 잡(sourceKind:'fetch')만 다룬다. 파일·URL 반입은
// 대기열(useConvertQueue)이 직접 관리하므로 이 슬롯을 쓰지 않는다.
//
// 저장소를 하나로 유지하는 이유: 구 단건 키(`study-hub:convert-job`)의 승격이 한 곳에서만
// 일어나야 진행 중이던 잡이 두 화면에 중복 등장하지 않는다.
import { newEntryId, readQueue, writeQueue } from './convertQueue'

export interface StoredConvertJob {
  jobId: string
  sourceKind: 'file' | 'url' | 'fetch'
  url?: string
  fileName?: string
  fetchLabel?: string
}

export function getStoredConvertJob(): StoredConvertJob | null {
  const entry = readQueue()
    .filter((e) => e.sourceKind === 'fetch' && !e.committed && e.jobId)
    .pop()
  if (!entry || !entry.jobId) return null
  return {
    jobId: entry.jobId,
    // 위 filter가 sourceKind==='fetch'만 남기므로 항상 리터럴로 좁혀 쓴다 — 대기열 쪽
    // QueueSourceKind가 'split'(S23, §4.25)으로 넓어져도 이 어댑터의 계약(fetch 전용)은
    // 그대로 'file'|'url'|'fetch'로 고정된다.
    sourceKind: 'fetch',
    url: entry.url,
    fileName: entry.fileName,
    fetchLabel: entry.fetchLabel,
  }
}

export function setStoredConvertJob(job: StoredConvertJob): void {
  const entries = readQueue().filter((e) => e.sourceKind !== 'fetch')
  writeQueue([
    ...entries,
    {
      id: newEntryId(),
      jobId: job.jobId,
      sourceKind: job.sourceKind,
      url: job.url,
      fileName: job.fileName,
      fetchLabel: job.fetchLabel,
      categoryPath: null,
      previewId: null,
      committed: false,
      startError: null,
      startErrorInfo: null,
      createdAt: Date.now(),
    },
  ])
}

export function clearStoredConvertJob(): void {
  writeQueue(readQueue().filter((e) => e.sourceKind !== 'fetch'))
}
