import { create } from 'zustand'
import type { DocumentType } from '../api/types'

// 플래시카드 큐 항목 — srs/today 항목과 documents 목록 항목 모두에서 만들 수 있다.
// srs 큐 경로는 콘텐츠가 함께 오므로 embedded=true(별도 조회 불필요),
// 범위(category_id) 경로는 embedded=false로 documents/{id}를 조회한다.
export interface FlashcardCard {
  document_id: number
  doc_no: string
  type: DocumentType
  title: string
  embedded: boolean
  content?: string | null
  answer?: string | null
  explanation?: string | null
}

export type FlashcardStatus = 'idle' | 'active' | 'finished'

// 계획서 §10 q 매핑: 안다=4·모른다=1 (다른 값 임의 사용 금지).
export const FLASHCARD_Q_KNOW = 4
export const FLASHCARD_Q_DONT_KNOW = 1

// 미전송 판정(전송 지연 방식, 설계 §4.12·§5.7 F36-⑧). 항상 최대 1건 — 직전 판정만 undo 가능.
export interface PendingJudgment {
  document_id: number
  q: number
}

interface FlashcardSessionState {
  status: FlashcardStatus
  cards: FlashcardCard[]
  index: number
  flipped: boolean
  // document_id -> q (4=안다 / 1=모른다)
  results: Record<number, number>
  // 아직 서버에 확정 전송하지 않은 직전 판정(undo 대상). null이면 되돌릴 판정 없음.
  pending: PendingJudgment | null

  start: (cards: FlashcardCard[]) => void
  flip: () => void
  setFlipped: (v: boolean) => void
  // 현재 카드에 판정(q)을 기록하고 다음 카드로 넘어간다. 마지막이면 finished.
  // pending을 새 판정으로 교체한다 — 이전 pending 확정 전송은 호출부 책임(grade 호출 전에 flush).
  grade: (q: number) => void
  // 직전 판정을 되돌린다(미전송이므로 서버 롤백 불필요) — 해당 카드로 복귀, 결과·pending 제거.
  undo: () => void
  clearPending: () => void
  reset: () => void
}

const initialState = {
  status: 'idle' as FlashcardStatus,
  cards: [] as FlashcardCard[],
  index: 0,
  flipped: false,
  results: {} as Record<number, number>,
  pending: null as PendingJudgment | null,
}

// 설계 §7: flashcardSession은 지정된 zustand 로컬 스토어 3개 중 하나.
export const useFlashcardSessionStore = create<FlashcardSessionState>((set, get) => ({
  ...initialState,

  start: (cards) => set({ ...initialState, status: 'active', cards }),

  flip: () => set((s) => ({ flipped: !s.flipped })),

  setFlipped: (v) => set({ flipped: v }),

  grade: (q) => {
    const { cards, index, results } = get()
    const card = cards[index]
    if (!card) return
    const nextResults = { ...results, [card.document_id]: q }
    const pending: PendingJudgment = { document_id: card.document_id, q }
    if (index + 1 >= cards.length) {
      set({ results: nextResults, status: 'finished', flipped: false, pending })
    } else {
      set({ results: nextResults, index: index + 1, flipped: false, pending })
    }
  },

  undo: () => {
    const { cards, index, results, status, pending } = get()
    if (!pending) return
    // 판정한 카드 인덱스: 마지막(finished)은 현재 index, 그 외엔 직전(index-1).
    const judgedIndex = status === 'finished' ? index : index - 1
    if (judgedIndex < 0) return
    const nextResults = { ...results }
    const card = cards[judgedIndex]
    if (card) delete nextResults[card.document_id]
    set({ index: judgedIndex, results: nextResults, flipped: false, status: 'active', pending: null })
  },

  clearPending: () => set({ pending: null }),

  reset: () => set({ ...initialState }),
}))
