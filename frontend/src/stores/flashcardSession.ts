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

interface FlashcardSessionState {
  status: FlashcardStatus
  cards: FlashcardCard[]
  index: number
  flipped: boolean
  // document_id -> q (4=안다 / 1=모른다)
  results: Record<number, number>

  start: (cards: FlashcardCard[]) => void
  flip: () => void
  setFlipped: (v: boolean) => void
  // 현재 카드에 판정(q)을 기록하고 다음 카드로 넘어간다. 마지막이면 finished.
  grade: (q: number) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as FlashcardStatus,
  cards: [] as FlashcardCard[],
  index: 0,
  flipped: false,
  results: {} as Record<number, number>,
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
    if (index + 1 >= cards.length) {
      set({ results: nextResults, status: 'finished', flipped: false })
    } else {
      set({ results: nextResults, index: index + 1, flipped: false })
    }
  },

  reset: () => set({ ...initialState }),
}))
