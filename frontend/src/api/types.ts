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

// ---- 관계 Relations (설계 §4.2, §5.3, F24) ----
// direction: 'from' = 이 문서가 관계를 선언(예: 개념이 "explains") / 'to' = 상대가 선언.
// DELETE /documents/{id}/relations/{to_id}는 direction:'from'인 관계만 해제 가능(백엔드
// remove_relation이 from_document_id==현재 문서인 행만 대상으로 함) — UI에서 구분해야 한다.
export type RelationType = 'explains' | 'related' | 'prerequisite'
export type RelationDirection = 'from' | 'to'

export interface RelatedDocument {
  document_id: number
  doc_no: string
  type: DocumentType
  title: string
  relation: RelationType
  direction: RelationDirection
}

export interface DocumentStatsLastAttempt {
  my_answer: string
  is_correct: boolean
  created_at: string
}

// 문서 상세 SRS 상태 (설계 §5.7 지원 · stage-5) — 카드가 아직 없으면(첫 attempts/판정 전) null.
// due_date·ease_factor·interval_days가 stats.srs로 추가될 예정(태스크 노트 — 백엔드 병렬 구현).
export interface DocumentSrs {
  due_date: string | null
  ease_factor: number | null
  interval_days: number | null
  repetitions?: number | null
}

export interface DocumentStats {
  attempts: number
  accuracy: number | null
  // 최근 10회 풀이 정오 (오래된 → 최신). 설계 §5.3 풀이 이력 미니차트, stage-3에서 stats에 추가됨.
  recent: boolean[]
  // 마지막 풀이 복원용 (설계 §5.5 완료 문제 재방문) — 과거 데이터는 null일 수 있음.
  last_attempt: DocumentStatsLastAttempt | null
  // SRS 상태(stage-5). 카드 미생성 시 null/undefined.
  srs?: DocumentSrs | null
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
  relations: RelatedDocument[]
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
  bookmarked?: boolean
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
// 백엔드 QuizQuestionOut(backend/schemas/quiz.py)과 대조 완료 — bookmarked 필드는 없다.
// §5.6 "퀴즈 카드" 북마크 별은 document_id로 별도 조회(useDocument)해 표시한다.
export interface QuizQuestion {
  document_id: number
  doc_no: string
  type: DocumentType
  title: string
  content: string | null
  choices: string[] | null
  difficulty: number | null
}

// 백엔드 QuizSessionResponse와 대조 완료 — mode·category_id도 함께 내려온다.
export interface QuizSessionResponse {
  mode: QuizMode
  category_id: number | null
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

// ---- 복습 SRS (설계 §4.7, stage-5) ----
//
// GET /api/srs/today 실계약(설계 §4.7 명문화). 순수 배열. 큐 항목이 카드 렌더에 필요한 콘텐츠를
// 직접 싣는다 — question/past_question은 content·choices 포함(answer·explanation은 null, 채점은
// attempts), flashcard는 answer·explanation 포함(뒤집기 뒷면용). 오답노트 미해결 여부는
// has_review_note(우선순위 배지용). 기한 초과 여부(is_overdue)는 서버가 안 주므로 프론트에서 계산.
export interface SrsQueueItem {
  document_id: number
  doc_no: string
  type: DocumentType
  title: string
  content: string | null
  choices: string[] | null
  difficulty: number | null
  due_date: string
  ease_factor: number
  interval_days: number
  repetitions: number
  has_review_note: boolean
  answer: string | null
  explanation: string | null
}

// today는 상한(settings:srs.daily_limit)으로 이미 잘려 내려오므로 페이지네이션 없이 배열로 받는다
// (heatmap·weakness 등 다른 배열 응답과 동일 관례).
export type SrsTodayResponse = SrsQueueItem[]

// 플래시카드(풀이 기록 없는 판정)용. q 매핑(계획 §10): 안다=4·모른다=1.
export interface SrsAnswerRequest {
  document_id: number
  q: number
}

export interface SrsAnswerResponse {
  ease_factor: number
  interval_days: number
  due_date: string
}

// ---- 오답노트 (설계 §4.6, 계획 §6.2 review_notes 테이블) ----

export type WrongReason = '개념부족' | '실수' | '함정' | '시간부족'

// "문서 요약 포함"(§4.6)의 구체 필드는 명세에 없어 문제 카드 표시에 필요한 최소 필드로 추정.
// category_path(§4.6 S4 보강 — 계층 그룹핑 근거)는 서버가 선택 범위 내 경로를 우선,
// 없으면 첫 연결 경로 기준으로 1개만 계산해 내려준다고 가정. 분류 연결이 없으면 null(미분류).
export interface ReviewNoteDocument {
  id: number
  doc_no: string
  type: DocumentType
  title: string
  content: string | null
  category_path: string | null
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

// S4 완성: 분류 exam_date + settings:ddays.custom 병합. kind로 구분(§5.11 배지 시험/임의 표시).
// custom 항목은 category_id가 null이고 settings 저장용 id(string)를 그대로 내려준다고 가정.
export type DDayKind = 'category' | 'custom'

export interface DDayItem {
  kind: DDayKind
  category_id: number | null
  id?: string
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

// 임의 D-Day(§4.10, §5.11) — settings.ddays.custom = [{id, label, date}]
export interface CustomDDay {
  id: string
  label: string
  date: string
}

// settings는 key-value 저장이라 응답 스키마가 고정되어 있지 않음. 현재 알려진 키만 타입에 반영.
export interface SettingsResponse {
  'srs.daily_limit'?: number
  'quiz.default_count'?: number
  'backup.auto'?: boolean
  'ddays.custom'?: CustomDDay[]
  [key: string]: unknown
}

export type SettingsPatch = Partial<SettingsResponse>

// ---- 통계 · 대시보드 확장 (설계 §4.8, S4) ----

export interface HeatmapEntry {
  date: string // YYYY-MM-DD
  count: number
}

// 홈 "최근 정답률 추이 라인" (설계 §4.8, S4 보강) — 풀이가 있었던 날만, 날짜 오름차순.
// accuracy는 0~1 스케일(다른 accuracy 필드들과 동일 컨벤션).
export interface AccuracyTrendEntry {
  date: string // YYYY-MM-DD
  attempts: number
  correct: number
  accuracy: number
}

// 누적 정답률 하위 Top N — 백엔드 WeaknessItem(backend/schemas/stats.py)과 대조 완료.
// 최소 시도 수 3 필터는 서버가 적용. accuracy는 0~1 스케일.
export interface WeaknessItem {
  document_id: number
  doc_no: string
  title: string
  type: DocumentType
  category_path: string | null
  accuracy: number
  attempts: number
}

// 커리큘럼 드릴다운 — 직계 자식별 진도·정답률·시도 수 (§4.1).
// 백엔드 routers/categories.py get_category_stats(response_model=List[CategoryStatsItem])와
// 대조 완료 — 배열을 그대로 반환한다(래핑 없음).
export interface CategoryChildStat {
  category_id: number
  name: string
  progress: number | null
  accuracy: number | null
  attempt_count: number
}

// ---- 문서 배치 조회 (설계 §4.2, 인쇄 뷰용) ----
// 백엔드 routers/documents.py get_documents_batch(response_model=List[DocumentDetail])와 대조 완료.
export type DocumentBatchResponse = DocumentDetail[]
