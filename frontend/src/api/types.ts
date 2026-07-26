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
  // S9(F37): tree?pipeline=1 요청 시에만 채워진다 — 노드+하위 트리 전체 집계(§4.12).
  stage_progress?: CategoryStageProgress | null
}

// F37 챕터 파이프라인 3단 진도 (§4.12) — 전부 파생값, DDL 없음.
export interface StageCount {
  done: number
  total: number
}

export interface CategoryStageProgress {
  concept: StageCount
  question: StageCount
  past_question: StageCount
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
  // S9(F38): tag_query에서 이 태그를 참조하는 규칙 수 — "규칙 사용" 배지용 (§4.12).
  rule_count?: number
}

// S9(F38) 유사(오타 의심) 태그 쌍 (§4.12) — GET /api/tags/similar.
export type TagSimilarReason = 'space' | 'case' | 'edit1'

export interface TagSimilarSide {
  id: number
  name: string
  doc_count: number
}

export interface TagSimilarPair {
  a: TagSimilarSide
  b: TagSimilarSide
  reason: TagSimilarReason
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
  // S9(F37): 타입 필터(예: ['question'], ['past_question']) — mode·범위와 교집합 (§4.12)
  types?: DocumentType[]
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

// ---- 모의고사 Exam (설계 §4.14, S11, F25) ----
//
// 원칙(강제): 새 테이블 없음 — 리포트·이력은 전부 attempts 파생. exam/session 응답은
// quiz/session의 QuizQuestionOut을 재사용(정답·해설 절대 미포함, 서버 채점 원칙 §8).
// exam/submit은 제출 후 응답이라 정답·해설 공개(§4.14).
export type ExamOrder = 'random' | 'sequential'

export interface ExamCut {
  subject_min: number
  pass_avg: number
}

export interface ExamSubjectRequest {
  category_id: number
  // 미지정 = 해당 범위(하위 트리 전체) 전체 문항(과목당 상한 200, 서버 절단)
  count?: number
}

export interface ExamSessionRequest {
  subjects: ExamSubjectRequest[]
  types?: DocumentType[]
  order?: ExamOrder
  time_limit_minutes?: number
  cut?: ExamCut
}

// items 원소 = QuizQuestion(quiz/session과 동일 재사용) — 정답·해설 없음.
// requested는 백엔드 스키마(ExamSubjectOut)상 Optional — count 미지정(전체 요청) 시 null.
export interface ExamSubjectSession {
  category_id: number
  name: string
  requested: number | null
  count: number
  items: QuizQuestion[]
}

export interface ExamSessionResponse {
  time_limit_minutes: number
  cut: ExamCut
  order: ExamOrder
  total_count: number
  warnings: string[]
  subjects: ExamSubjectSession[]
}

export interface ExamAnswerInput {
  document_id: number
  subject_category_id: number
  // 미응답 = null (오답 처리 — §4.14)
  my_answer: string | null
  time_spent?: number
}

export interface ExamSubmitRequest {
  answers: ExamAnswerInput[]
  cut?: ExamCut
  // 리포트 기록용 에코만(서버 타이머 검증 없음 — 타이머는 프론트 주도, §4.14)
  elapsed_seconds?: number
}

export interface ExamSubjectReport {
  category_id: number
  name: string
  score: number
  correct: number
  count: number
  failed: boolean
}

export interface ExamResultItem {
  document_id: number
  subject_category_id: number
  is_correct: boolean
  my_answer: string | null
  // 백엔드 스키마상 Optional — 정상 흐름에선 항상 채워지지만 방어적으로 null 허용.
  answer: string | null
  explanation: string | null
  review_note_id: number | null
}

export interface ExamSubmitResponse {
  taken_at: string
  passed: boolean
  cut: ExamCut
  total: { score: number; correct: number; count: number }
  elapsed_seconds: number | null
  subjects: ExamSubjectReport[]
  results: ExamResultItem[]
}

export interface ExamHistorySubject {
  category_id: number
  name: string
  score: number
  failed: boolean
}

// label = 과목 노드들의 공통 부모 경로 파생(분류 삭제 시 "(삭제된 분류)"). passed는 기본 컷(40/60)
// 재평가(당시 컷 미보존, R15) — §4.14.
export interface ExamHistoryItem {
  taken_at: string
  label: string
  passed: boolean
  total: { score: number; correct: number; count: number }
  subjects: ExamHistorySubject[]
}

export type ExamHistoryResponse = ExamHistoryItem[]

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
  // S11(F16) — 선행 복습 카드(임박 시험 대비로 due 전에 당겨온 카드). D≤7에서만 등장, 기본 false.
  // 미발동 시 응답에서 생략될 수 있어 옵셔널로 둔다(§4.14 하위 호환).
  ahead?: boolean
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

// S11(F16) — D-Day 복습 강도 조절 발동 정보 (§4.14). 발동 시에만 srs/summary에 채워진다.
export interface DdayBoostInfo {
  category_id: number
  name: string
  exam_date: string
  d_day: number
  multiplier: number
  effective_limit: number
}

// S9(F36-①③) 복습 요약 (§4.12) — GET /api/srs/summary.
// today_due = 오늘 큐 잔여, tomorrow_due = 내일까지 due(오늘 미소화 이월 포함). daily_limit 상한 동일.
export interface SrsSummaryResponse {
  today_due: number
  tomorrow_due: number
  // S11(F16) — 발동 시에만 존재(미발동 시 필드 생략, 하위 호환 §4.14).
  dday_boost?: DdayBoostInfo
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
  // S9(F36-①): 데일리 세션 분량 예고용 대략치(분). 표본 없으면 서버가 60초/문항 기준. (§4.12)
  today_review_minutes?: number | null
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
  // 설계 §4.10 — 값은 문자열 "daily"(자동 백업 활성) | ""(비활성). 백엔드 기동 훅이
  // `auto != "daily"`면 early return하므로 boolean이 아닌 이 문자열 계약을 그대로 따라야 한다.
  'backup.auto'?: string
  'ddays.custom'?: CustomDDay[]
  // ---- LLM 엔진 설정 (설계 §4.11, S8) ----
  'llm.priority'?: LlmPriority
  'llm.fallback'?: LlmFallbackPolicy
  'llm.api_model'?: string
  // ---- 학습 UX (설계 §4.12, S9) ----
  // 정답 시 1.5초 자동 다음(오답은 항상 정지). 기본 off.
  'quiz.auto_advance'?: QuizAutoAdvance
  // 본문 글자 크기 3단계(문서 상세·학습 모드 공통). 기본 default.
  'study.font_scale'?: FontScale
  // ---- 일일 목표 (설계 §4.13, S10, F26) ----
  // 양의 정수, 미설정·0 = 목표 없음. 시간은 "문제 풀이 시간 기준"(개념 열람 시간 미측정).
  'goal.daily_questions'?: number
  'goal.daily_minutes'?: number
  // ---- D-Day 복습 강도 조절 (설계 §4.14, S11, F16) ---- 기본 'on'.
  'srs.dday_boost'?: 'on' | 'off'
  [key: string]: unknown
}

// S9(F36-⑥⑨) settings 값 타입.
export type QuizAutoAdvance = 'on' | 'off'
export type FontScale = 'small' | 'default' | 'large'

export type SettingsPatch = Partial<SettingsResponse>

// ---- 통계 · 대시보드 확장 (설계 §4.8, S4) ----

export interface HeatmapEntry {
  date: string // YYYY-MM-DD
  count: number
  // S10(F26) — 목표가 하나라도 설정된 경우에만 채워진다(설계 §4.13). 미설정 시 필드 자체가 없음.
  goal_met?: boolean
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

// ---- 검색 (설계 §4.9, §5 검색 결과 화면, S6 — v1.5 확정) ----
// GET /api/search?q=&type=&page=&size= 응답은 §3 페이지 봉투(Paginated<SearchResultItem>).
// snippet은 매칭 부분을 <mark>...</mark>로 감싼 문자열 — 렌더 시 mark 태그만 허용하고 나머지는
// 이스케이프해 XSS를 차단한다(utils/snippet.ts).
export interface SearchResultItem {
  document_id: number
  doc_no: string
  type: DocumentType
  title: string
  snippet: string
}

// ---- 태그 병합 (설계 §4.9, F21 인접) ----
export interface MergeTagsRequest {
  from_id: number
  to_id: number
}

// 응답 형태는 명세에 없음 — 병합 후 목록을 invalidate하므로 값 자체는 크게 쓰이지 않는다고 보고
// 최소한으로 가정. 최종 보고 참고.
export interface MergeTagsResponse {
  merged_into: number
}

// ---- 태그 자동 분류 규칙 (설계 §4.9, F21 — v1.5 확정) ----
export type TagRuleMode = 'auto' | 'suggest'

// tag_query 문법: 단일 태그 또는 "A OR B" 결합만 (R13 — AND/괄호/NOT 없음, 태그명은 정확 일치)
// 응답 필드: {id, category_id, category_path, tag_query, mode, created_at}
export interface TagRule {
  id: number
  tag_query: string
  category_id: number
  category_path?: string | null
  mode: TagRuleMode
  created_at?: string
}

export interface TagRuleInput {
  tag_query: string
  category_id: number
  mode: TagRuleMode
}

export interface TagRuleScanResult {
  created: number
}

export interface TagRuleUnlinkResult {
  unlinked: number
}

// ---- 제안함 (설계 §4.9 제안 수명주기, S6 — v1.5 확정) ----
// GET /api/suggestions는 대기 중(pending)만 내려주므로 응답에 status 필드가 없다.
// item = {id, document_id, doc_no, title, category_id, category_path, tag_rule_id,
// tag_rule_query, created_at} — tag_rule_query는 규칙 삭제 시 null.
export interface Suggestion {
  id: number
  document_id: number
  doc_no: string
  title: string
  category_id: number
  category_path: string
  tag_rule_id: number | null
  tag_rule_query: string | null
  created_at: string
}

export type SuggestionListResponse = Suggestion[]

export interface ApplySuggestionsRequest {
  approve: number[]
  reject: number[]
}

export interface ApplySuggestionsResult {
  approved: number
  rejected: number
}

// ---- LLM 엔진 관리 (설계 §4.11, F34·F35 1단계, S8) ----

// 파일 업로드/URL 반입 모두에서 선택 가능한 엔진 (POST /convert, POST .../regenerate 공통).
// 'auto' = 우선순위 설정(llm.priority) 따름 — 기본값.
export type LlmEngine = 'auto' | 'cli' | 'api'
export type LlmPriority = 'cli' | 'api'
export type LlmFallbackPolicy = 'auto' | 'ask' | 'off'

export interface LlmCliStatus {
  installed: boolean
  logged_in: boolean
  last_success_at: string | null
  last_error_kind: string | null
}

export interface LlmApiStatus {
  key_registered: boolean
  key_suffix: string | null
  last_success_at: string | null
}

// 최근 429 한도 기억 — resets_at 이전이면 재시도 전 경고 배너 대상 (설계 §4.11 "한도 기억").
export interface LlmLimitInfo {
  kind: string
  resets_at: string
}

export interface LlmStatusResponse {
  cli: LlmCliStatus
  api: LlmApiStatus
  limit: LlmLimitInfo | null
  priority: LlmPriority
  fallback_policy: LlmFallbackPolicy
}

export interface ApiKeyRequest {
  key: string
}

// 키 원문은 어떤 응답에도 포함되지 않는다(write-only) — 응답은 마지막 4자리만.
export interface ApiKeyResponse {
  key_suffix: string
}

// S10(§4.13): 'parse_failed' — 사이트 어댑터 파싱 실패(사이트 구조 변경 가능성). 원문 HTML 노출 금지.
export type LlmErrorKind = 'rate_limit' | 'auth' | 'not_installed' | 'timeout' | 'parse_failed' | 'other'
export type LlmLimitKind = 'session' | 'daily' | 'weekly' | 'model' | 'overall'

// convert/regenerate 잡 실패 시 구조화된 오류(설계 §4.11) — 원문 CLI/API JSON은 여기 담기지 않는다.
export interface LlmErrorInfo {
  kind: LlmErrorKind
  limit_kind?: LlmLimitKind | null
  resets_at?: string | null
  message: string
  action: string
  fallback_available: boolean
}

// S10(§4.13): 'fetching' — 사이트 수집(목록·문항·이미지 다운로드), URL 반입의 'downloading'과는
// 구분되는 별도 단계(어댑터가 여러 요청을 스로틀 걸며 수행하는 구간).
export type JobPhase = 'fetching' | 'downloading' | 'preparing' | 'llm_running' | 'parsing' | 'preview_building'

export interface JobUsage {
  input_tokens: number
  output_tokens: number
  cost_usd?: number | null
}

// 잡 진행 가시화(설계 §4.11) — last_activity_at이 진짜 심장박동. eta_ms는 표본 없으면 생략.
export interface JobProgress {
  phase: JobPhase
  detail?: string | null
  elapsed_ms: number
  last_activity_at: string
  usage?: JobUsage | null
  eta_ms?: number | null
}

// ---- Claude CLI 변환 · 재생성 (설계 §4.10·§4.11, F23·F30·F34·F35, S6·S8) ----
export type ConvertJobStatus = 'running' | 'done' | 'error'

export interface ConvertJobStartResponse {
  job_id: string
}

// "완료 시 곧장 반입 preview로 연결"(§4.10) — result_preview_id는 GET /api/import/preview/{id}로
// 다시 조회한다(v1.5 확정 — 백엔드에 추가됨). error_info·progress는 S8 신규(§4.11).
export interface ConvertJobResponse {
  status: ConvertJobStatus
  result_preview_id?: string | null
  error?: string | null
  error_info?: LlmErrorInfo | null
  progress?: JobProgress | null
}

// 재생성 초안 — 기존 문서와 나란히 비교할 필드 전체(§4.10 확정: title/content/choices/answer/
// explanation/difficulty/tags).
export interface RegenerateDraft {
  title: string
  content: string | null
  choices: string[] | null
  answer: string | null
  explanation: string | null
  difficulty: number | null
  tags: string[]
}

export interface RegenerateJobResponse {
  status: ConvertJobStatus
  draft?: RegenerateDraft | null
  error?: string | null
  error_info?: LlmErrorInfo | null
  progress?: JobProgress | null
}

// ---- 백업 (설계 §4.10, F27, S6 — v1.5 확정) ----
// id는 타임스탬프 문자열(숫자 PK 아님). restore는 body {confirm: "RESTORE"} 고정 문자열 필요.
export interface BackupItem {
  id: string
  created_at: string
  filename: string
  size_bytes: number | null
}

export type BackupListResponse = BackupItem[]

export interface CreateBackupResult {
  id: string
  created_at: string
}

// restore 확인 문구는 고정 문자열 "RESTORE" (설계 §4.10 v1.5 확정)
export interface RestoreBackupRequest {
  confirm: 'RESTORE'
}

// ---- 사이트에서 가져오기 (설계 §4.13, S10, F35 2단계) ----
// 신규는 수집기(어댑터)뿐 — LLM 정리·미리보기·중복 감지·분류 자동 생성·승인 반입은 기존
// convert 잡 큐·import preview/commit 재사용(§4.13 원칙). 새 테이블·컬럼 없음.

export type FetchAdapterId = 'qnet' | 'comcbt'

// GET /api/fetch/adapters — priority 숫자가 작을수록 우선(qnet=1, comcbt=2).
// available:false = robots 비허용·접속 불가 진단 시. notice = 이용 고지 문구.
export interface FetchAdapter {
  id: FetchAdapterId
  name: string
  priority: number
  available: boolean
  notice: string
}

export type FetchAdaptersResponse = FetchAdapter[]

// GET /api/fetch/certs?q= 병합 결과 — 정규화 이름(공백 제거) 기준 병합.
export interface FetchCertSource {
  adapter: FetchAdapterId
  cert_ref: string
}

export interface FetchCertResult {
  name: string
  sources: FetchCertSource[]
}

export type FetchCertsResponse = FetchCertResult[]

// POST /api/fetch/exams 요청 — 선택한 자격증의 sources 그대로 전달.
export interface FetchExamsRequest {
  sources: FetchCertSource[]
}

// 크롤링 예의 강제 조항 6항 — 실행 전 예상 LLM 사용량 안내. assumed=true면 문항 수·평균
// 토큰 모두 가정치(문항 수 미상 시 60개, 표본 없으면 문항당 600토큰).
export interface FetchExamEstimate {
  questions_assumed: number
  approx_input_tokens: number
  assumed: boolean
}

// POST /api/fetch/exams 응답 항목 — exam_key(YYYY-N 정규화)가 양쪽에 있으면 큐넷(qnet) 채택,
// comcbt는 also_on으로만 표기. imported = 해당 회차 분류 경로 존재 여부(파생).
// exam_ref: 채택 어댑터(adapter) 기준 조회용 참조(§4.13 갱신 — refs[adapter]와 동일값, 유지).
// refs: 어댑터별 exam_ref 맵(§4.13 갱신, stage-reviewer 지적 반영) — exam_ref의 의미가 어댑터마다
// 달라(comcbt=srl 숫자, qnet=URL) also_on 재시도 시 채택 어댑터의 exam_ref를 그대로 쓸 수 없다.
// 대상 어댑터 키가 refs에 없으면 그 어댑터로는 재시도 불가(해당 회차를 개별 조회할 수단이 없음).
export interface FetchExamItem {
  exam_key: string
  exam_ref: string
  refs: Record<string, string>
  label: string
  adapter: FetchAdapterId
  also_on: FetchAdapterId[]
  question_count?: number | null
  imported: boolean
  estimate: FetchExamEstimate
}

export type FetchExamsResponse = FetchExamItem[]

// POST /api/fetch/import — 한 번에 1회차. convert 잡 큐 재사용(kind='fetch', 동시 1개,
// engine·폴백 정책은 §4.11 그대로) → {job_id}(ConvertJobStartResponse와 동일 형태).
export interface FetchImportRequest {
  adapter: FetchAdapterId
  cert_ref: string
  exam_ref: string
  engine?: LlmEngine
}

// ---- 목표·스트릭 (설계 §4.13, S10, F26) ----
// GET /api/stats/streak — 전부 파생값(저장 없음). today.goal은 설정된 목표 항목만 채워짐.
export interface StreakGoal {
  questions?: number
  minutes?: number
}

export interface StreakToday {
  questions: number
  minutes: number
  goal: StreakGoal
  goal_met: boolean
}

export interface StreakResponse {
  current_streak: number
  best_streak: number
  today: StreakToday
}
