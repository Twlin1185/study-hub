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

// 파생 관계(F43, 설계 §4.19 ⑥) — 본문 임베드 `![[DOC-…]]`를 저장 시 스캔해 만드는 인덱스 행
// (created_by='embed'). 사용자가 직접 선택·해제할 수 없고, 문서 상세의 역참조 목록·삭제 경고에만
// 쓰인다. 그래서 사용자 선택용 RelationType과 분리한다.
export type DerivedRelationType = 'embeds'
export type AnyRelationType = RelationType | DerivedRelationType

export interface RelatedDocument {
  document_id: number
  doc_no: string
  type: DocumentType
  title: string
  relation: AnyRelationType
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
  // S15(설계 §4.17 ⑤) — 경고(1개 이상) 항목 수. 변환 파이프라인(convert·fetch) preview에만
  // 존재 — 필드 부재(구버전 응답·직접 업로드 JSON)는 경고 없음(0)으로 처리한다.
  warning?: number
}

// S15(설계 §4.17 ⑤·⑥, R7 보강) — 변환 신뢰 게이트 경고. 변환 파이프라인(convert·fetch) preview
// 항목에만 존재하고, 직접 업로드 JSON에는 필드 자체가 없다(비적용). 모르는 값은 무시(전방 호환,
// alternatives 관례). solved_answer·fabrication_suspect는 프론트가 기본 반입 제외로 렌더하고,
// match_unavailable은 배지·안내만(기본 포함 유지) — 판정 규칙은 §4.17이 단일 출처.
export type ImportItemWarning = 'solved_answer' | 'fabrication_suspect' | 'match_unavailable'

export interface ImportDuplicateOf {
  id: number
  doc_no: string
  title: string
}

export interface ImportSuggestCategory {
  path: string
  category_id: number | null
  exists: boolean
  // 핫픽스(백엔드 병렬 작업) — true면 기존 노드인데 자식(하위 분류)이 있는 컨테이너 노드.
  // 필드 자체가 없는 응답(백엔드 배포 전/구버전)은 미표시로 우아하게 처리 — optional.
  container?: boolean
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
  // S15(설계 §4.17 ⑤) — 기본 []. 필드 부재(구버전 응답·직접 업로드 JSON)는 경고 없음으로 처리.
  warnings?: ImportItemWarning[]
}

export interface ImportPreviewResponse {
  preview_id: string
  source: ImportSource
  summary: ImportSummary
  items: ImportItem[]
  // S13(F40-①, 설계 §4.3): 디스크 보존본에서 복구된 미리보기. 항목 index는 안정하지만
  // 중복 판정(duplicate_of)은 복구 시점 DB 기준으로 재계산되므로 화면에 소표기한다.
  recovered?: boolean
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
  // S13(F40-①): 만료된 preview를 디스크 보존본으로 복구한 뒤 커밋했음(설계 §4.3).
  recovered?: boolean
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
  // S19(§4.21) — applied-exam/submit 응답에서만 채워진다(일반 exam/submit엔 없음, undefined).
  // document_relations 'derived_from'에서 파생된 근거 문서 목록 — 사후 검토(R22 ②)의 핵심.
  basis?: AppliedExamBasisDoc[]
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

// ---- 응용 모의고사 Applied Exam (설계 §4.21, S19, F45) ----
//
// 원칙(강제 재확인): 응시 구성은 기존 exam/session 재사용(신규 세션 API 없음) — subjects=
// [{category_id: run_category_id}] 1과목, QuizQuestionOut 재사용이라 정답·해설·basis 전부
// 부재(계약 수준 봉인, 불변 규칙 1). 이 블록의 타입은 신규 5개 엔드포인트(prepare·generate·
// 상태·submit·history)만 다룬다. submit 응답은 ExamSubmitResponse를 그대로 재사용하고
// results[].basis(위 ExamResultItem 참조)만 추가로 채워진다 — 별도 응답 타입을 두지 않는다.
// history 응답도 파생 로직 재사용이라 ExamHistoryResponse와 동일 형태(mode='applied_exam' 그룹).

export interface AppliedExamPrepareRequest {
  category_ids: number[]
  count: number
}

export interface AppliedExamSourceCounts {
  past_question: number
  question: number
  concept: number
}

// estimate 필드 관례 = fetch_service.estimate_usage(§4.13)·answer-key(§4.20 ①) 재사용.
export interface AppliedExamEstimate {
  approx_input_tokens: number
  assumed: boolean
}

export interface AppliedExamPrepareResponse {
  gen_id: string
  scope_label: string
  source_counts: AppliedExamSourceCounts
  requested_count: number
  estimate: AppliedExamEstimate
}

// S24(설계 §4.21 S24 개정 블록 ① — F50): 누적/1회성 모드. 미지정 = 'accumulate' 기본(종전
// 동작(항상 태그 없음)과 다른 기본값 — oneshot이 종전과 동일). 그 외 값 = 422.
export type AppliedExamMode = 'accumulate' | 'oneshot'

// S22(설계 §4.24 ④ — F48): model? 1회성 오버라이드 — engine이 auto·미지정이면 422(엔진 먼저
// 선택), 소목록 밖 값도 422. 미지정 = 설정값 폴백(기존 동작 불변).
export interface AppliedExamGenerateRequest {
  engine?: LlmEngine
  model?: string
  mode?: AppliedExamMode
}

export interface AppliedExamGenerateResponse {
  job_id: string
}

// 검증 게이트(§4.21 결정 ⑦) 폐기 사유 — 조용한 축소 금지, 상태 응답에 구조화되어 내려온다.
export type AppliedExamDiscardReason =
  | 'invalid_item'
  | 'invalid_answer'
  | 'missing_explanation'
  | 'bad_basis'
  | 'duplicate_of_source'

export interface AppliedExamDiscardGroup {
  reason: AppliedExamDiscardReason
  count: number
}

export interface AppliedExamResult {
  run_category_id: number
  requested: number
  generated: number
  discarded: AppliedExamDiscardGroup[]
  document_ids: number[]
  // S24(설계 §4.21 S24 개정 블록 — F50) — 표시 전용 순수 추가. 누적 = 태그 부여·제안 강제,
  // 1회성 = 종전과 동일(태그 0). 요약 표시는 고정 문구뿐 — 응시 전 문서 상세 일괄 조회 금지(§5.12 규약).
  mode: AppliedExamMode
}

// GET /api/applied-exam/{gen_id} — 상태·결과 조회. convert 잡 큐 kind 'applied_exam' 재사용이라
// progress·error_info 계약은 §4.11 그대로(ConvertJobResponse와 동형이나 result 필드가 다름).
// 'prepared'(2026-08-02 검토 경미⑤, 라이브 실측) — generate 호출 전(prepare 직후) gen 상태를
// 나타내는 값. ConvertJobStatus('running'|'done'|'error')에는 없는 상태라 유니온으로 확장한다.
// 프론트는 이 값을 process 단계 폴링 중에는 만나지 않는다(generate 성공 후에만 폴링 시작 —
// AppliedExamPanel.tsx) — 타입만 정확히 맞추고 소비처 동작은 바꾸지 않는다.
export type AppliedExamStatus = ConvertJobStatus | 'prepared'

export interface AppliedExamStatusResponse {
  status: AppliedExamStatus
  error?: string | null
  error_info?: LlmErrorInfo | null
  progress?: JobProgress | null
  result?: AppliedExamResult | null
}

export interface AppliedExamBasisDoc {
  document_id: number
  doc_no: string
  title: string
  type: DocumentType
}

// 파생값 재사용 — mode='applied_exam' 그룹(실전 exam/history와 상호 불간섭, §4.21 결정 ②).
export type AppliedExamHistoryResponse = ExamHistoryResponse

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
  // ---- 엔진 운용 제어 (설계 §4.23, S21, F47) ----
  // 부정 목록(결정 ①) — 레지스트리 등재 id만 쓴다(알 수 없는 id는 서버가 무시). 빈 배열·키
  // 부재 = 전 엔진 활성.
  'llm.disabled'?: LlmEngineId[]
  // 엔진id → 선택 모델id(결정 ③). legacy `llm.api_model`은 읽기 별칭으로만 남고 이 키에는
  // 쓰지 않는다(§4.23 ⓑ).
  'llm.models'?: Partial<Record<LlmEngineId, string>>
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

// ---- LLM 엔진 관리 (설계 §4.11 F34·F35 1단계, S8 / §4.17 엔진 레지스트리, S15) ----

// 파일 업로드/URL 반입 모두에서 선택 가능한 엔진 (POST /convert, POST .../regenerate 공통).
// 'auto' = 우선순위 설정(llm.priority) 따름 — 기본값. 'cli'|'api'는 legacy 별칭(서버가 읽기 시
// claude-cli/claude-api로 매핑 — 설계 §4.17①, 422 아님) — 신규 엔진 id도 함께 허용한다.
export type LlmEngine = 'auto' | LlmEngineId | 'cli' | 'api'

// S15(설계 §4.17①) — 엔진 레지스트리 id. F34 cli|api 이항 가정 해체.
export type LlmEngineId = 'claude-cli' | 'claude-api' | 'codex-cli'
export type LlmEngineBilling = 'subscription' | 'metered'

// settings `llm.priority` 신 규격 — 엔진 id 배열(순서=시도 순서). legacy 스칼라('cli'|'api')는
// 서버가 읽기 시 배열로 매핑하고, 쓰기는 항상 이 배열 형식(설계 §4.17①) — 프론트는 이 필드를
// 직접 읽지 않고 항상 정규화된 `LlmStatusResponse.priority`를 단일 출처로 사용한다.
export type LlmPriority = LlmEngineId[]
export type LlmFallbackPolicy = 'auto' | 'ask' | 'off'

// S21(설계 §4.23 ⓑ) — 엔진별 선택 가능 모델 소목록 항목. 자유 텍스트 입력 없음(레지스트리
// 하드코딩 소목록만, 결정 ③ 기각 확정).
export interface LlmEngineModelOption {
  id: string
  label: string
}

// S15(설계 §4.17②) — 엔진 배열 항목. CLI형(claude-cli·codex-cli) = installed/logged_in만 값이
// 있고 key_registered/key_suffix는 null. API형(claude-api) = 반대. 프론트는 null 필드를
// 렌더하지 않는다(필드 유무로 카드 내용을 결정 — 엔진 추가·제거에 프론트 코드 변경 없음).
// S21(설계 §4.23) — enabled·models·default_model·selected_model 4종 순수 추가(결정 ⑤) — 기존
// 필드·톱레벨 불변. enabled:false는 settings `llm.disabled`(부정 목록) 반영값 — available과는
// 별개 축(available=진단 결과, enabled=사용자 의사)이며 게이팅 라벨은 enabled:false가 우선한다.
export interface LlmEngineStatus {
  id: LlmEngineId
  label: string
  billing: LlmEngineBilling
  installable: boolean
  available: boolean
  installed: boolean | null
  logged_in: boolean | null
  key_registered: boolean | null
  key_suffix: string | null
  last_success_at: string | null
  last_error_kind: string | null
  enabled: boolean
  models: LlmEngineModelOption[]
  default_model: string | null
  selected_model: string | null
}

// 최근 429 한도 기억 — resets_at 이전이면 재시도 전 경고 배너 대상 (설계 §4.11 "한도 기억").
// 어느 엔진의 한도인지는 담지 않는다(계약 불변 — 설계 §4.17②).
export interface LlmLimitInfo {
  kind: string
  resets_at: string
}

// S15(설계 §4.17②) — 기존 톱레벨 cli/api 필드는 제거 확정(호환 유지 안 함). priority는 서버가
// 별칭 매핑+누락 보충을 마친 유효 배열을 내려준다.
export interface LlmStatusResponse {
  engines: LlmEngineStatus[]
  limit: LlmLimitInfo | null
  priority: LlmEngineId[]
  fallback_policy: LlmFallbackPolicy
}

// S15(설계 §4.17④) — POST /api/llm/engines/{id}/install 응답. installable:true 엔진(현재
// codex-cli)만 유효 — 그 외는 422.
export interface InstallEngineResponse {
  installed: boolean
  version?: string
}

export interface ApiKeyRequest {
  key: string
}

// 키 원문은 어떤 응답에도 포함되지 않는다(write-only) — 응답은 마지막 4자리만.
export interface ApiKeyResponse {
  key_suffix: string
}

// POST/DELETE /api/fetch/qnet-key 응답 (backend schemas/fetch.py QnetKeyResponse, §4.13) —
// ApiKeyResponse(F34 LLM API 키)와 달리 key_registered를 함께 내려준다.
export interface QnetKeyResponse {
  key_registered: boolean
  key_suffix: string | null
}

// S10(§4.13): 'parse_failed' — 사이트 어댑터 파싱 실패(사이트 구조 변경 가능성). 원문 HTML 노출 금지.
// S13(§4.11 F40-④): 'invalid_output' — LLM 출력이 완결된 JSON이 아님(대개 문항이 많아 출력 상한에서
// 잘림). 같은 파일로 재시도하면 같은 실패라 "나눠서 다시 올리기"를 안내한다. 원문(raw) 미노출.
// S14(§4.13): 'unsupported_format' — qnet 게시물에 LLM 투입 가능한 PDF 첨부가 없음(ZIP·HWP 등).
// 원본은 sources/에 저장된 뒤 잡이 종료되며, 포맷별 안내 문구(message)는 서버가 내려준다.
// S16(§4.18⑤): 'too_large' — 추출·디코드된 텍스트가 상한(200,000자)을 초과해 LLM 호출 전에
// 실행이 중단됨(비용 0). message/action은 서버 완성 문장(분할 권고) — 프론트 포맷 분기 없음.
export type LlmErrorKind =
  | 'rate_limit'
  | 'auth'
  | 'not_installed'
  | 'timeout'
  | 'parse_failed'
  | 'invalid_output'
  | 'unsupported_format'
  | 'too_large'
  | 'other'
export type LlmLimitKind = 'session' | 'daily' | 'weekly' | 'model' | 'overall'

// convert/regenerate 잡 실패 시 구조화된 오류(설계 §4.11) — 원문 CLI/API JSON은 여기 담기지 않는다.
// alternatives(S14) — 이 실패에서 유효한 대안 액션 식별자 목록(예: 'file_import'). 프론트는 이
// 값으로 버튼 노출을 결정하고, 문구는 만들지 않는다(kind별 하드코딩 대신 이 배열을 신뢰).
export interface LlmErrorInfo {
  kind: LlmErrorKind
  limit_kind?: LlmLimitKind | null
  resets_at?: string | null
  message: string
  action: string
  fallback_available: boolean
  alternatives?: string[]
  // S15(설계 §4.17③) — 다음 후보 엔진 id(priority 배열상 다음 available 엔진). fallback_available
  // 이 true일 때만 값이 있을 것으로 기대되지만, 과도기 백엔드 응답은 필드 자체가 없을 수 있다 —
  // 그 경우 프론트는 legacy 'api' 폴백 동작을 유지한다(설계에 과도기 규칙 명시 없음, 프론트 결정).
  // 타입은 설계 원문 그대로 string(좁은 유니온 아님) — 버튼 라벨은 이 id로 status.engines[]를
  // 찾아 완성하고, 찾지 못하면 id 원문을 그대로 보여준다(엔진명 하드코딩 금지).
  fallback_engine?: string
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
// S22(설계 §4.24 ② — F48): 'cancelled' 순수 추가 — 전 kind 상태 응답 공통(오류 아님, error_info
// 없음). 이 유니온을 재사용하는 AppliedExamStatus·ImproveJobStatus에도 함께 반영된다.
export type ConvertJobStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface ConvertJobStartResponse {
  job_id: string
}

// "완료 시 곧장 반입 preview로 연결"(§4.10) — result_preview_id는 GET /api/import/preview/{id}로
// 다시 조회한다(v1.5 확정 — 백엔드에 추가됨). error_info·progress는 S8 신규(§4.11).
// notes(S14, §4.13) — 성공 결과에 덧붙는 사람이 읽는 문장 목록(기본 []), 예:
// "도면·과제 묶음(ZIP)도 sources/에 함께 저장했습니다." 서버가 문구를 완성해 내려주므로
// 프론트는 포맷을 만들지 않고 그대로 렌더한다.
export interface ConvertJobResponse {
  status: ConvertJobStatus
  result_preview_id?: string | null
  error?: string | null
  error_info?: LlmErrorInfo | null
  progress?: JobProgress | null
  notes?: string[]
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

// ---- 답지·해설지 반입 (설계 §4.20 ①, F44, S18) ----
// POST /api/import/answer-key 응답 — 판별·추출만 수행(LLM 0). estimate는 fetch estimate_usage
// 필드 관례(approx_input_tokens·assumed) 재사용.
export interface AnswerKeyEstimate {
  approx_input_tokens: number
  assumed: boolean
}

export interface AnswerKeyTarget {
  question_total: number
  missing_answer: number
  missing_explanation: number
}

export interface AnswerKeyUploadResponse {
  key_id: string
  filename: string
  file_type: string
  extract_available: boolean
  extracted_chars: number
  target: AnswerKeyTarget
  estimate: AnswerKeyEstimate
}

// 미리보기 matched 항목의 conflicts(이미 값이 있어 병합에서 건너뜀)·warnings(기계 검증 결과).
export type AnswerKeyConflictField = 'answer_exists' | 'explanation_exists'
export type AnswerKeyWarning = 'fabrication_suspect' | 'match_unavailable'

export interface AnswerKeyMatchedCurrent {
  has_answer: boolean
  has_explanation: boolean
}

export interface AnswerKeyMatchedProposed {
  answer?: string | null
  explanation?: string | null
}

export interface AnswerKeyMatchedItem {
  document_id: number
  doc_no: string
  title: string
  no: number
  current: AnswerKeyMatchedCurrent
  proposed: AnswerKeyMatchedProposed
  conflicts: AnswerKeyConflictField[]
  warnings: AnswerKeyWarning[]
}

export type AnswerKeyUnmatchedNumberReason = 'no_document' | 'ambiguous'
export type AnswerKeyUnmatchedDocumentReason = 'no_number' | 'ambiguous' | 'no_item'

export interface AnswerKeyUnmatchedNumber {
  no: number
  reason: AnswerKeyUnmatchedNumberReason
}

export interface AnswerKeyUnmatchedDocument {
  document_id: number
  doc_no: string
  title: string
  reason: AnswerKeyUnmatchedDocumentReason
}

export interface AnswerKeyUnmatched {
  numbers: AnswerKeyUnmatchedNumber[]
  documents: AnswerKeyUnmatchedDocument[]
}

// ---- 반입 자기 개선 루프 Improve (설계 §4.22, F46, S20) ----
//
// 원칙(강제 재확인): 이 기능은 DB에 아무것도 쓰지 않는다 — 저장은 improve/cases·
// improve/proposals(JSON 파일) + prompts/convert.cases.md·convert.md(git 관리) 뿐이다.
// 파일 쓰기 경로는 apply 1곳뿐(승인 게이트 — R8). 수집(cases)은 비용 0 자동, 개선 생성(gen)·
// 회귀(regression)는 항상 prepare(견적, LLM 0) → 확인 스텝 → generate/run(LLM 호출) 순서다.
// gen_id·reg_id가 상태 폴링 키(§4.22 — answer-key의 key_id와 동일 관례, job_id는 시작 응답에만).

export type ImproveCaseOrigin = 'convert_job' | 'fetch_job' | 'gate' | 'report'

export interface ImproveCaseSource {
  path: string
  hash12: string
  filename: string
}

export interface ImproveCaseDocumentRef {
  id: number
  doc_no: string
  title: string
}

export type ImproveRegressionOutcome = 'passed' | 'still_failing' | 'failed_differently' | 'unavailable'

export interface ImproveCaseRegression {
  reg_id: string
  run_at: string
  outcome: ImproveRegressionOutcome
  detail?: string | null
}

// cases 목록·상세 공용 — 명세(§4.22 ①)상 목록도 "레코드 요약(has_llm_output bool 포함 · 원문
// 미포함)"이라 필드 구성은 상세와 사실상 같고(detail 유무만 다를 수 있음), 프론트는 단일 타입으로
// 다룬다. 원문(LLM 산출물·error_info raw)은 어떤 응답에도 담기지 않는다(로그 전용, §4.11 관례).
export interface ImproveCaseItem {
  case_id: string
  created_at: string
  origin: ImproveCaseOrigin
  kind: string
  count: number
  last_seen_at: string
  engine?: string | null
  source?: ImproveCaseSource | null
  document?: ImproveCaseDocumentRef | null
  preview_ref?: string | null
  has_llm_output: boolean
  // detail = origin별 구조화 정보(§4.22 — error_info 사본 · 게이트 항목 인덱스 · 신고 reason).
  // 필드 구성이 origin마다 달라 명세가 스키마를 못박지 않는다 — 프론트는 가공 없이 원본 구조만
  // 보존한다(사례 상세 화면에서 key: value 나열로 렌더).
  detail?: Record<string, unknown> | null
  regressions: ImproveCaseRegression[]
}

export interface ImproveEstimate {
  approx_input_tokens: number
  assumed: boolean
}

export interface ImproveGenPrepareRequest {
  case_ids: string[]
}

export interface ImproveGenPrepareResponse {
  gen_id: string
  case_count: number
  estimate: ImproveEstimate
}

export interface ImproveDiscardedGroup {
  reason: string
  count: number
}

export interface ImproveGenResult {
  proposal_ids: string[]
  discarded: ImproveDiscardedGroup[]
}

// generate 호출 전(prepare 직후)에는 잡이 아직 시작되지 않아 'prepared'로 응답한다 — §4.22
// 실측(stage-20 검토 경미 ②). AppliedExamStatus(위 §4.21, types.ts:535)와 동일하게 ConvertJobStatus
// 유니온으로 확장한다(런타임 영향 없음 — 계약 정확성).
export type ImproveJobStatus = ConvertJobStatus | 'prepared'

export interface ImproveGenJobResponse {
  status: ImproveJobStatus
  progress?: JobProgress | null
  error_info?: LlmErrorInfo | null
  result?: ImproveGenResult | null
}

export type ImproveProposalKind = 'casebook' | 'prompt_edit' | 'code_issue'
export type ImproveProposalStatus = 'pending' | 'applied' | 'rejected' | 'acknowledged'

export interface ImproveProposalListItem {
  proposal_id: string
  kind: ImproveProposalKind
  title: string
  rationale: string
  case_ids: string[]
  status: ImproveProposalStatus
  created_at: string
  decided_at?: string | null
}

export interface ImproveHunk {
  before: string
  after: string
}

export type ImprovePolicyCheck = 'ok' | 'violation'

// kind별 payload — casebook만 entry_markdown, prompt_edit만 hunks(+preview_after·policy_check
// 서버 합성), code_issue만 repro_markdown이 채워진다(§4.22 ②·③). 프론트는 kind로 분기해 읽는다.
export interface ImproveProposalPayload {
  entry_markdown?: string
  hunks?: ImproveHunk[]
  repro_markdown?: string
}

export interface ImproveProposalDetail extends ImproveProposalListItem {
  payload: ImproveProposalPayload
  // prompt_edit 전용 적용 미리보기(§4.22 ③) — 적용 후 convert.md 전문 + 정책 잠금 검증 결과.
  preview_after?: string | null
  policy_check?: ImprovePolicyCheck | null
}

// apply 응답 result는 kind별 자유 형식(§4.22 ③) — 프론트는 applied·kind만 신뢰해 분기하고
// result는 그대로 보존만 한다(가공하지 않음).
export interface ImproveApplyResponse {
  applied: boolean
  kind: ImproveProposalKind
  result: unknown
}

export interface ImproveRegressionPrepareRequest {
  case_ids: string[]
}

export interface ImproveRegressionPrepareResponse {
  reg_id: string
  case_count: number
  estimate: ImproveEstimate
}

export interface ImproveRegressionResultItem {
  case_id: string
  outcome: ImproveRegressionOutcome
  detail?: string | null
}

export interface ImproveRegressionJobResponse {
  status: ImproveJobStatus
  progress?: JobProgress | null
  error_info?: LlmErrorInfo | null
  results: ImproveRegressionResultItem[]
}

// GET /api/import/answer-key/{key_id} — 상태·미리보기 조회(convert 잡 큐 kind 'answer_key' 재사용,
// progress·error_info는 §4.11 계약 그대로). matched·unmatched는 status:'done'에서만 채워진다.
export interface AnswerKeyStatusResponse {
  status: ConvertJobStatus
  error?: string | null
  error_info?: LlmErrorInfo | null
  progress?: JobProgress | null
  matched?: AnswerKeyMatchedItem[]
  unmatched?: AnswerKeyUnmatched
}

export interface AnswerKeyApplySkip {
  document_id: number
  reason: string
}

// POST .../apply 응답 — 빈 필드만 병합(멱등). 유일한 병합 쓰기 경로(§4.20 ①-4).
export interface AnswerKeyApplyResult {
  updated: number
  skipped: AnswerKeyApplySkip[]
}

// ---- LLM 풀이 생성 (설계 §4.20 ②, F44, S18 — F30 재생성 잡 인프라 재사용) ----
export interface ExplainDraft {
  explanation: string
  // 원본에 정답이 없어 LLM이 함께 산출한 경우만 값이 있다(answer_included로 구분).
  answer?: string | null
  answer_included: boolean
}

// GET .../explain/{job_id} — explanation_source는 §4.17 answer_source 관례와 동일하게
// 응답 전용·DB 미저장(마커 라인은 apply 시 서버가 explanation 본문에 부착).
export interface ExplainJobResponse {
  status: ConvertJobStatus
  draft?: ExplainDraft | null
  explanation_source?: 'generated'
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

// S13: 사설 사이트 어댑터 제거 — 등록 어댑터는 qnet 단독(설계 §4.13, 계획서 §14 F35-2).
export type FetchAdapterId = 'qnet'

// GET /api/fetch/adapters — S13: 원소 1개(qnet, priority=1 고정) — 채택 경쟁 없음.
// available:false = S13 종료 시점 스텁이라 항상 false("준비 중"). notice = 이용 고지 문구
// (개인 학습 전용·재배포 금지 + 커버리지 한계 문구를 항상 포함 — S14, 설계 §4.13).
// S14: key_registered·key_suffix 추가 — available은 서비스키 등록 여부를 반영한다(§4.13).
// 미등록 시 available:false로 하위 호환(프론트 분기 불요).
export interface FetchAdapter {
  id: FetchAdapterId
  name: string
  priority: number
  available: boolean
  notice: string
  key_registered?: boolean
  key_suffix?: string | null
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
// include_notices(S14, §4.13·§5.9 실측 6) — 안내문 게시물(공개문제가 아닌 공지) 포함 여부.
// 기본 false(서버 기본값과 동일) — 명시적으로 true를 보내야 안내문까지 돌아온다. 같은 24h
// 캐시에서 파생되므로 토글로 다시 호출해도 추가 비용이 없다.
export interface FetchExamsRequest {
  sources: FetchCertSource[]
  include_notices?: boolean
}

// 크롤링 예의 강제 조항 6항 — 실행 전 예상 LLM 사용량 안내. assumed=true면 문항 수·평균
// 토큰 모두 가정치(문항 수 미상 시 60개, 표본 없으면 문항당 600토큰).
export interface FetchExamEstimate {
  questions_assumed: number
  approx_input_tokens: number
  assumed: boolean
}

// POST /api/fetch/exams 응답 항목 — S13: 어댑터가 qnet 하나뿐이라 어댑터 간 병합·채택
// 경쟁이 없다. also_on은 항상 빈 배열, refs는 {qnet: exam_ref} 단일 항목(계약 형태는 유지
// — 향후 공식 API 어댑터 추가 여지 + 프론트 렌더 코드 불변, 설계 §4.13).
// imported = 해당 회차 분류 경로 존재 여부(파생). exam_key가 연도만(`YYYY`)이거나 식별 불가
// (`qnet-{artlSeq}`)면 분류 경로를 만들 수 없어 imported는 항상 false로 고정된다(서버 판정 —
// 프론트는 exam_key 형태를 해석·가공하지 않고 label을 그대로 표시한다, S14 실측 6).
// exam_ref: 어댑터 기준 조회용 참조(§4.13 — refs[adapter]와 동일값, 유지).
// refs: 어댑터별 exam_ref 맵 — 필드는 유지하되 S13에서는 항상 단일 항목.
// is_notice(S14, §4.13·§5.9 실측 6) — 공개문제가 아닌 안내문 게시물. include_notices:false로
// 조회하면 이 값이 true인 항목은 애초에 응답에 포함되지 않는다(서버가 걸러 보낸다).
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
  is_notice: boolean
}

export type FetchExamsResponse = FetchExamItem[]

// POST /api/fetch/import — 한 번에 1회차. convert 잡 큐 재사용(kind='fetch', 동시 1개,
// engine·폴백 정책은 §4.11 그대로) → {job_id}(ConvertJobStartResponse와 동일 형태).
// exam_key?(§4.13) — fetch/exams가 반환한 키를 그대로 전달하면 서버가 수집 결과의
// exam_key를 이 값으로 덮어써 목록 표기·분류 경로·imported 판정을 일치시킨다.
// S13: 단일 어댑터에서는 목록 키와 수집 키가 같아 사실상 항등 전달 — 계약 유지 목적.
// 미지정 시 기존 동작(어댑터 자체 키) 완전 불변.
// model?(S22, 설계 §4.24 ④) — 1회성 오버라이드, 규칙은 AppliedExamGenerateRequest 주석 참조.
export interface FetchImportRequest {
  adapter: FetchAdapterId
  cert_ref: string
  exam_ref: string
  engine?: LlmEngine
  model?: string
  exam_key?: string
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

// ---- LLM 작업 센터 (설계 §4.24, S22, F48) ----
// 전역 잡 목록·취소·대기열 일시정지·요청 단위 model 오버라이드. 신규 엔드포인트 4개는 전부
// LLM 0·DB 0(인메모리 조회·플래그) — §4.24 ⓐ. 전 kind 8종이 같은 잡 큐·레코드를 공유하므로
// 목록 1개가 전 kind를 덮는다(현행 실측).
export type LlmJobKind =
  | 'convert'
  | 'fetch'
  | 'regenerate'
  | 'answer_key'
  | 'explain'
  | 'applied_exam'
  | 'improve_proposal'
  | 'improve_regression'

// kind별 참조 id(§4.24 ⓓ 표) — [화면으로 이동]·복원 훅 공유 키. 모르는/없는 필드는 생략된다
// (필드 유무로 렌더를 결정하는 기존 관례, §4.17② 참고).
export interface LlmJobRef {
  preview_id?: string | null
  document_id?: number | null
  gen_id?: string | null
  reg_id?: string | null
  key_id?: string | null
}

// 전역 목록 전용 상태 유니온 — kind별 상태 응답(ConvertJobStatus)에는 없는 'queued'(대기 중,
// 아직 워커가 집지 않음)가 여기서만 구분된다(§4.24 ⓐ — 전역 목록이 큐 위치까지 파생한다).
export type LlmJobListStatus = ConvertJobStatus | 'queued'

// label·상태 문구는 서버가 완성한 한국어 문장 그대로(§4.10 notes 관례 — 프론트 포맷 분기 금지).
// engine·model은 이 잡에 유효 적용된 값(model: null = 모델 인자 미전달). 정답·해설·LLM 산출
// 원문은 이 스키마 어디에도 없다(불변 규칙 1 — 목록 응답 수준에서 부재).
export interface LlmJobItem {
  job_id: string
  kind: LlmJobKind
  status: LlmJobListStatus
  label: string
  engine: string | null
  model: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  progress?: JobProgress | null
  error_info?: LlmErrorInfo | null
  ref: LlmJobRef
}

export interface LlmJobQueueInfo {
  paused: boolean
  concurrency: number
}

// GET /api/llm/jobs — 정렬: running → queued(등록순) → 종료(최신순). 페이지네이션 없음(잡 TTL
// 1시간 내 레코드뿐 — 상한 자연 형성).
export interface LlmJobsResponse {
  queue: LlmJobQueueInfo
  items: LlmJobItem[]
}

// POST /api/llm/jobs/{id}/cancel 응답 — usage는 running 취소(부분 과금 정직 표기)에만 실린다.
// 이미 종료된 잡(done·error·cancelled) = 409, 미존재·TTL 만료 = 404(§3 에러 규약 그대로).
export interface LlmJobCancelResponse {
  status: 'cancelled'
  usage?: JobUsage | null
}

// POST /api/llm/queue/pause·resume 응답 — 멱등, 인메모리(서버 재시작 시 해제).
export interface LlmQueuePauseResponse {
  paused: boolean
}
