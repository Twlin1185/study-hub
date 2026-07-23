// 설계 §4.1, §4.2 기반 타입. list item 상세 필드는 명세에 없어 합리적으로 추정함 — 최종 보고 참고.

export type DocumentType = 'concept' | 'question' | 'past_question' | 'flashcard'

export type LevelHint = '자격증' | '시험' | '과목' | '단원'

export interface CategoryNode {
  id: number
  parent_id: number | null
  name: string
  level_hint: string | null
  exam_date: string | null
  sort_order: number
  children: CategoryNode[]
  doc_count: number
  progress: number | null
}

export interface CategoryTreeResponse {
  categories: CategoryNode[]
}

// 문서 목록 항목 — 명세에 명시된 필드 없음. tags/usage_count/bookmarked를 합리적으로 가정.
export interface DocumentListItem {
  id: number
  doc_no: string
  type: DocumentType
  title: string
  difficulty: number | null
  tags: string[]
  usage_count: number
  bookmarked: boolean
}

export interface DocumentUsage {
  category_id: number
  path: string
  local_note: string | null
}

export interface DocumentStatsLastAttempt {
  my_answer: string
  is_correct: boolean
  created_at: string
}

export interface DocumentStats {
  attempts: number
  accuracy: number | null
  // 최근 10회 풀이 정오 (오래된 → 최신). 설계 §5.3 풀이 이력 미니차트, stage-3에서 stats에 추가됨.
  recent: boolean[]
  // 마지막 풀이 복원용 (설계 §5.5 완료 문제 재방문) — 과거 데이터는 null일 수 있음.
  last_attempt: DocumentStatsLastAttempt | null
}

export interface DocumentDetail {
  id: number
  doc_no: string
  type: DocumentType
  title: string
  content: string | null
  choices: string[] | null
  answer: string | null
  explanation: string | null
  difficulty: number | null
  source_id: number | null
  source_detail: string | null
  is_active: boolean
  forked_from: number | null
  created_at: string
  updated_at: string
  tags: string[]
  usages: DocumentUsage[]
  relations: unknown[]
  bookmarked: boolean
  stats: DocumentStats
}

export interface Tag {
  id: number
  name: string
  usage_count: number
}

export interface DocumentListFilters {
  category_id?: number
  deep?: boolean
  type?: DocumentType
  tag?: string
  orphan?: boolean
  page?: number
  size?: number
}

// ---- 반입 Import (설계 §4.3) ----

export type ImportItemStatus = 'ok' | 'duplicate_suspect' | 'error'
export type ImportAction = 'new' | 'skip' | 'merge'

export interface ImportSource {
  filename: string
  duplicate_source: boolean
}

export interface ImportSummary {
  total: number
  ok: number
  duplicate_suspect: number
  error: number
}

export interface ImportDuplicateOf {
  id: number
  doc_no: string
  title: string
}

export interface ImportSuggestCategory {
  path: string
  category_id: number | null
  exists: boolean
}

export interface ImportSuggestRelation {
  doc_no: string
  document_id: number | null
  found: boolean
}

export interface ImportItem {
  index: number
  title: string
  type: DocumentType
  status: ImportItemStatus
  duplicate_of?: ImportDuplicateOf | null
  suggest_categories: ImportSuggestCategory[]
  suggest_relations: ImportSuggestRelation[]
  errors: string[]
}

export interface ImportPreviewResponse {
  preview_id: string
  source: ImportSource
  summary: ImportSummary
  items: ImportItem[]
}

export interface ImportDecision {
  index: number
  action: ImportAction
  merge_into?: number
  // number = 기존 분류 category_id(exists:true) · string = 생성 승인할 경로(exists:false)
  approve_categories?: (number | string)[]
  approve_relations?: number[]
}

export interface ImportCommitRequest {
  preview_id: string
  decisions: ImportDecision[]
}

// 설계 §4.3 확정분 (백엔드 실물 대조 완료)
export interface ImportCommitResult {
  created: number
  merged: number
  skipped: number
  new_documents: { id: number; doc_no: string; title: string }[]
  categories_created: string[]
  relations_created: number
}

// ---- 학습 진도 · 이어하기 (설계 §4.4) ----

export type StudyItemStatus = 'not_started' | 'in_progress' | 'done'

export interface StudyTrackItem {
  document_id: number
  doc_no: string
  type: DocumentType
  title: string
  status: StudyItemStatus
  sort_order: number
}

// 백엔드 StudyTrackResponse(backend/schemas/study.py)와 대조 완료: category_id·category_name도 내려온다.
export interface StudyTrackResponse {
  category_id: number
  category_name: string
  items: StudyTrackItem[]
  resume_document_id: number | null
}

export type StudyEventAction = 'complete' | 'position'

export interface StudyEventRequest {
  category_id: number
  document_id: number
  action: StudyEventAction
}

// 홈 "이어하기" 카드 — dashboard.continue 응답 예시(§4.8, 구체적 필드 확정)를 기준으로 삼고
// study/continue(§4.4, {category_path, document, progress}로만 서술)에도 동일 필드명을
// 재사용하는 것으로 추정했다. study/continue 응답에 category_id가 명세되어 있지 않지만
// "/study/:categoryId"로 이동하려면 필요해 포함시킴 — 최종 보고에서 확인 필요.
export interface ContinueCard {
  category_id: number
  path: string
  document_id: number
  done: number
  total: number
}

// ---- 퀴즈 · 채점 (설계 §4.5) ----

export type QuizMode = 'sequential' | 'random' | 'wrong_only' | 'bookmarked'

export interface QuizSessionRequest {
  category_id?: number | null
  mode: QuizMode
  count: number
  // 지정 시 해당 문서만 대상(모드 필터와 교집합, 요청 순서 유지) — 오답노트 개별 재도전용 (설계 §4.5, §5.8)
  document_ids?: number[]
}

// 정답·해설은 절대 포함하지 않는다 (서버 채점 원칙, 설계 §8) — 타입에도 필드를 두지 않음.
export interface QuizQuestion {
  document_id: number
  doc_no: string
  type: DocumentType
  title: string
  content: string | null
  choices: string[] | null
}

// 응답 형태가 명세에 없어(단지 "문제 목록"으로만 서술) §3의 목록 규약(items 래핑)을 따르는
// 것으로 추정. 최종 보고에서 확인 필요.
export interface QuizSessionResponse {
  items: QuizQuestion[]
}

// 'study' = 학습 모드 인라인 문제 제출 (백엔드 AttemptCreate.mode 허용값, 설계 §5.5)
export type AttemptMode = 'quiz' | 'review' | 'flashcard' | 'study'

export interface AttemptRequest {
  document_id: number
  category_id?: number | null
  my_answer: string
  time_spent: number
  mode: AttemptMode
}

export interface AttemptSrs {
  due_date: string
}

export interface AttemptResponse {
  is_correct: boolean
  answer: string
  explanation: string | null
  review_note_id: number | null
  srs: AttemptSrs | null
}

// ---- 오답노트 (설계 §4.6, 계획 §6.2 review_notes 테이블) ----

export type WrongReason = '개념부족' | '실수' | '함정' | '시간부족'

// "문서 요약 포함"(§4.6)의 구체 필드는 명세에 없어 문제 카드 표시에 필요한 최소 필드로 추정.
export interface ReviewNoteDocument {
  id: number
  doc_no: string
  type: DocumentType
  title: string
  content: string | null
}

export interface ReviewNote {
  id: number
  document_id: number
  note: string | null
  wrong_reason: WrongReason | null
  is_resolved: boolean
  created_at: string
  updated_at: string
  document: ReviewNoteDocument
}

export interface ReviewNoteFilters {
  resolved?: boolean
  wrong_reason?: WrongReason
  category_id?: number
  page?: number
  size?: number
}

export interface ReviewNotePatch {
  note?: string
  wrong_reason?: WrongReason | null
  is_resolved?: boolean
}

// ---- 대시보드 (설계 §4.8) ----

export interface DDayItem {
  category_id: number
  name: string
  exam_date: string
  d_day: number
}

export interface DashboardRecent {
  attempts_7d: number
  accuracy_7d: number | null
}

export interface DashboardResponse {
  today_review: number
  continue: ContinueCard[]
  ddays: DDayItem[]
  recent: DashboardRecent
}

// ---- 설정 (설계 §4.10, 계획 §6.2 settings 테이블 — key/value) ----

// settings는 key-value 저장이라 응답 스키마가 고정되어 있지 않음. 현재 알려진 키만 타입에 반영.
export interface SettingsResponse {
  'srs.daily_limit'?: number
  'quiz.default_count'?: number
  'backup.auto'?: boolean
  [key: string]: unknown
}

export type SettingsPatch = Partial<SettingsResponse>
