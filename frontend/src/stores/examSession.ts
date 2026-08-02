import { create } from 'zustand'
import type { DocumentType, ExamCut, ExamOrder, ExamSubjectSession, ExamSubmitResponse } from '../api/types'

// 모의고사 문항 1개(과목 컨텍스트 포함) — subjects[].items를 과목 순서 그대로 평탄화한다.
// 네비게이터가 과목 구간을 subjectsMeta의 count로 순서대로 잘라 표시하므로(설계 §5.12),
// 평탄화 시 과목 순서를 뒤섞지 않는다.
export interface ExamFlatItem {
  document_id: number
  doc_no: string
  type: DocumentType
  title: string
  content: string | null
  choices: string[] | null
  difficulty: number | null
  subject_category_id: number
  subject_name: string
}

export interface ExamSubjectMeta {
  category_id: number
  name: string
  count: number
}

export type ExamSessionStatus = 'idle' | 'active' | 'finished'

const DEFAULT_CUT: ExamCut = { subject_min: 40, pass_avg: 60 }

interface ExamSessionState {
  status: ExamSessionStatus
  items: ExamFlatItem[]
  subjectsMeta: ExamSubjectMeta[]
  currentIndex: number
  // key = document_id, 값이 있으면 응답한 것(미응답은 키 자체가 없음)
  answers: Record<number, string>
  cut: ExamCut
  timeLimitMinutes: number
  order: ExamOrder
  startedAt: number | null
  deadlineAt: number | null
  finishedAt: number | null
  report: ExamSubmitResponse | null
  // S19(§4.21·§7) — applied 컨텍스트(신규 스토어 없음, 기존 examSession 확장). applied=true면
  // 제출을 applied-exam/submit으로 분기하고, 리포트에 "AI 생성 모의고사" 배지·근거 링크(basis)를
  // 렌더한다. appliedRunCategoryId는 이 세션이 속한 격리 런 분류 id(참고용 — 제출 자체는 서버가
  // 검증, 프론트는 분기 신호로만 사용).
  applied: boolean
  appliedRunCategoryId: number | null

  start: (
    subjects: ExamSubjectSession[],
    timeLimitMinutes: number,
    cut: ExamCut,
    order: ExamOrder,
    applied?: boolean,
    appliedRunCategoryId?: number | null,
  ) => void
  setAnswer: (documentId: number, value: string) => void
  goTo: (index: number) => void
  submitted: (report: ExamSubmitResponse) => void
  reset: () => void
}

const initialState = {
  status: 'idle' as ExamSessionStatus,
  items: [] as ExamFlatItem[],
  subjectsMeta: [] as ExamSubjectMeta[],
  currentIndex: 0,
  answers: {} as Record<number, string>,
  cut: DEFAULT_CUT,
  timeLimitMinutes: 0,
  order: 'random' as ExamOrder,
  startedAt: null as number | null,
  deadlineAt: null as number | null,
  finishedAt: null as number | null,
  report: null as ExamSubmitResponse | null,
  applied: false,
  appliedRunCategoryId: null as number | null,
}

// 설계 §7 — zustand examSession(문항·답안·카운트다운·리포트). 제출 전엔 전부 로컬(서버는 무상태,
// §4.14) — persist 없음(새로고침·이탈 시 세션이 사라진다, 화면이 beforeunload·라우터 가드로 경고).
export const useExamSessionStore = create<ExamSessionState>((set, get) => ({
  ...initialState,

  start: (subjects, timeLimitMinutes, cut, order, applied = false, appliedRunCategoryId = null) => {
    const items: ExamFlatItem[] = subjects.flatMap((s) =>
      s.items.map((q) => ({
        document_id: q.document_id,
        doc_no: q.doc_no,
        type: q.type,
        title: q.title,
        content: q.content,
        choices: q.choices,
        difficulty: q.difficulty,
        subject_category_id: s.category_id,
        subject_name: s.name,
      })),
    )
    const subjectsMeta: ExamSubjectMeta[] = subjects.map((s) => ({
      category_id: s.category_id,
      name: s.name,
      count: s.items.length,
    }))
    const now = Date.now()
    set({
      ...initialState,
      status: 'active',
      items,
      subjectsMeta,
      cut,
      timeLimitMinutes,
      order,
      startedAt: now,
      deadlineAt: now + timeLimitMinutes * 60_000,
      applied,
      appliedRunCategoryId,
    })
  },

  setAnswer: (documentId, value) =>
    set((state) => ({ answers: { ...state.answers, [documentId]: value } })),

  goTo: (index) => {
    const { items } = get()
    if (index < 0 || index >= items.length) return
    set({ currentIndex: index })
  },

  submitted: (report) => set({ status: 'finished', finishedAt: Date.now(), report }),

  reset: () => set({ ...initialState }),
}))
