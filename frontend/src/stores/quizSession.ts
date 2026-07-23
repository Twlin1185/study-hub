import { create } from 'zustand'
import type { AttemptResponse, QuizMode, QuizQuestion } from '../api/types'

export interface QuizAnswerRecord {
  my_answer: string
  time_spent: number
  result: AttemptResponse
}

export type QuizSessionStatus = 'idle' | 'active' | 'finished'

interface QuizSessionState {
  status: QuizSessionStatus
  mode: QuizMode | null
  categoryId: number | null
  questions: QuizQuestion[]
  currentIndex: number
  // key = document_id
  answers: Record<number, QuizAnswerRecord>
  cardShownAt: number | null
  startedAt: number | null
  finishedAt: number | null

  start: (questions: QuizQuestion[], mode: QuizMode, categoryId: number | null) => void
  recordAnswer: (documentId: number, myAnswer: string, timeSpent: number, result: AttemptResponse) => void
  goNext: () => void
  finish: () => void
  reset: () => void
}

const initialState = {
  status: 'idle' as QuizSessionStatus,
  mode: null as QuizMode | null,
  categoryId: null as number | null,
  questions: [] as QuizQuestion[],
  currentIndex: 0,
  answers: {} as Record<number, QuizAnswerRecord>,
  cardShownAt: null as number | null,
  startedAt: null as number | null,
  finishedAt: null as number | null,
}

// 설계 §7: 퀴즈 세션(문항·답안·타이머)은 zustand 로컬 상태. 문항별 time_spent는
// "카드 표시~제출" 구간이므로 cardShownAt을 기준으로 계산한다 (설계 §5.6).
export const useQuizSessionStore = create<QuizSessionState>((set, get) => ({
  ...initialState,

  start: (questions, mode, categoryId) =>
    set({
      ...initialState,
      status: 'active',
      mode,
      categoryId,
      questions,
      startedAt: Date.now(),
      cardShownAt: Date.now(),
    }),

  recordAnswer: (documentId, myAnswer, timeSpent, result) =>
    set((state) => ({
      answers: { ...state.answers, [documentId]: { my_answer: myAnswer, time_spent: timeSpent, result } },
    })),

  goNext: () => {
    const { currentIndex, questions } = get()
    if (currentIndex + 1 >= questions.length) {
      set({ status: 'finished', finishedAt: Date.now() })
    } else {
      set({ currentIndex: currentIndex + 1, cardShownAt: Date.now() })
    }
  },

  finish: () => set({ status: 'finished', finishedAt: Date.now() }),

  reset: () => set({ ...initialState }),
}))
