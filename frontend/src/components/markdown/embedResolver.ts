// 임베드 해석 캐시·배치 큐 (설계 §4.19 ③).
//
// - 캐시 = **열람 컴포넌트 수명 동안의 메모리 Map**. 전역 영속 캐시·무효화 체계는 만들지 않는다.
//   (루트 MarkdownView가 인스턴스를 하나 만들고, 그 안의 임베드 트리 전체가 공유한다.)
// - 요청은 **마이크로태스크 단위로 모아 1회 배치 호출**한다. 같은 커밋에서 마운트된 임베드 카드·
//   링크 칩(= 같은 깊이의 참조 전부)의 요청이 한 번의 POST로 합쳐진다 → "한 문서 열람에 임베드
//   수만큼 개별 요청" 경로가 구조적으로 생기지 않는다. 중첩 임베드는 깊이당 1회 추가 배치.
// - 같은 doc_no는 캐시/진행 중 항목으로 판정해 재요청하지 않는다.
import { ApiError } from '../../api/client'
import { resolveEmbeds } from '../../api/embeds'
import type { EmbedResolveItem } from '../../api/embeds'

export type EmbedEntryStatus = 'loading' | 'ready' | 'error'

export interface EmbedEntry {
  status: EmbedEntryStatus
  item?: EmbedResolveItem
  error?: string
}

const LOADING: EmbedEntry = { status: 'loading' }

export class EmbedResolver {
  // doc_no → 상태. useSyncExternalStore 스냅샷으로 그대로 쓰이므로 값 교체 시에만 새 객체를 만든다.
  private entries = new Map<string, EmbedEntry>()
  private queue = new Set<string>()
  private scheduled = false
  private listeners = new Set<() => void>()

  peek(docNo: string): EmbedEntry | undefined {
    return this.entries.get(docNo)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // 해석 요청 — 이미 캐시/진행 중이면 아무 일도 하지 않는다.
  request(docNo: string): void {
    if (!docNo || this.entries.has(docNo)) return
    this.entries.set(docNo, LOADING)
    this.queue.add(docNo)
    this.schedule()
  }

  // 네트워크 실패 항목만 다시 시도한다(사용자 조작).
  retry(docNo: string): void {
    const entry = this.entries.get(docNo)
    if (entry?.status !== 'error') return
    this.entries.delete(docNo)
    this.request(docNo)
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.flush()
    })
  }

  private async flush(): Promise<void> {
    const batch = Array.from(this.queue)
    this.queue.clear()
    if (batch.length === 0) return
    try {
      const items = await resolveEmbeds(batch)
      const byNo = new Map(items.map((item) => [item.doc_no, item]))
      for (const docNo of batch) {
        const item = byNo.get(docNo)
        // 응답에 빠진 doc_no는 부재로 간주(배치 부분 성공 — §4.19 ③).
        this.entries.set(docNo, { status: 'ready', item: item ?? { doc_no: docNo, found: false } })
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : '임베드를 불러오지 못했습니다.'
      for (const docNo of batch) this.entries.set(docNo, { status: 'error', error: message })
    }
    this.emit()
  }
}
