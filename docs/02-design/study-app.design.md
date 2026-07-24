# Study Hub — 상세 설계 (API 명세 · 화면 상세)

> 상태: **Design v1.7** — v1.6 대비: **S8(M8 LLM 인프라) API 계약 신설**(§4.11 — 엔진 진단·API 키 관리·이중 엔진 convert·오류 구조화·URL 반입·**잡 진행 가시화 `progress`**). v1.6: 홈 다열 렌더를 콘텐츠 실측 폭 기준으로 변경(§5.1 — 이후 같은 날 임계값 704/1344·컨테이너 4xl/6xl·자동 분배·auto 미리보기 전용까지 확정)
> 작성일: 2026-07-22 · 갱신: 2026-07-24
> 상위 문서: `docs/01-plan/study-app.plan.md` (Draft v0.6)
> 구현 계획: `docs/01-plan/stage-1-skeleton.plan.md` ~ `stage-8-llm-infra.plan.md`

---

## 1. 범위

계획서의 데이터 모델(§6)을 전제로, **REST API 명세**와 **화면 상세**를 확정한다.
스키마 DDL은 계획서 §6.2가 단일 출처(source of truth)이며 여기서 반복하지 않는다.

## 2. 프로젝트 구조

```
study-hub/
├─ backend/
│  ├─ main.py               # FastAPI 앱 생성, 라우터 등록, 정적 파일(frontend/dist) 서빙
│  ├─ database.py           # engine(SQLite WAL), SessionLocal, get_db
│  ├─ models.py             # SQLAlchemy 모델 (계획서 §6.2 그대로)
│  ├─ schemas/              # Pydantic 요청/응답 모델 (리소스별 파일)
│  ├─ routers/              # categories, documents, imports, study, quiz, srs,
│  │                        # review_notes, stats, search, tags, suggestions, settings
│  ├─ services/             # sm2.py, import_service.py, stats_service.py,
│  │                        # tag_rule_service.py, convert_service.py(M6), backup_service.py(M6)
│  └─ alembic/              # 마이그레이션
├─ frontend/
│  └─ src/
│     ├─ api/               # client.ts(fetch 래퍼), 리소스별 React Query 훅
│     ├─ components/        # 공용: Tree, DocCard, MarkdownView, ProgressBar, TagChip, …
│     ├─ pages/             # 화면 11개 (§5)
│     ├─ stores/            # zustand: quizSession, flashcardSession, theme, sidebar(S7)
│     ├─ styles/tokens.css  # 디자인 토큰 (§6)
│     └─ App.tsx            # React Router 라우트
├─ sources/                 # 원본 파일 (불변)
├─ import/                  # Claude Code가 생성한 반입 JSON
├─ prompts/convert.md       # LLM 변환 프롬프트 템플릿
└─ study.db
```

## 3. API 공통 규약

- Base URL: `/api` — JSON, UTF-8. 프론트는 같은 origin에서 서빙되므로 CORS 불필요.
- **에러 포맷** (모든 4xx/5xx):
  ```json
  { "error": { "code": "NOT_FOUND", "message": "문서를 찾을 수 없습니다", "detail": null } }
  ```
  코드: `VALIDATION_ERROR`(422) · `NOT_FOUND`(404) · `CONFLICT`(409) · `INTERNAL`(500)
- **페이지네이션**: `?page=1&size=50` → `{ "items": [...], "total": 231, "page": 1, "size": 50 }`
- **날짜**: ISO 8601, 서버 로컬(Asia/Seoul) 기준. DATE는 `YYYY-MM-DD`.
- **소프트 삭제**: 삭제된 문서(`is_active=0`)는 모든 목록에서 기본 제외, `?include_inactive=1`로 노출.
- ID는 정수 PK. `doc_no`(DOC-0001)는 표시·반입 참조용.

## 4. API 명세

구현 단계 표기: [S1]~[S7] = stage 1~7에서 구현. (S7은 순수 프론트 단계 — 새 엔드포인트 없음, 기존 settings API의 키 추가만.)

### 4.1 분류 Categories

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/categories/tree` | 전체 트리. 노드별 `{id, name, level_hint, exam_date, children[], doc_count, progress}` — progress는 S3부터 채움 | S1 |
| `POST /api/categories` | `{parent_id, name, level_hint?, exam_date?}` | S1 |
| `PATCH /api/categories/{id}` | 이름·힌트·시험일 수정 | S1 |
| `POST /api/categories/{id}/move` | `{parent_id, sort_order}` — 자기 자신/자손 밑으로 이동 시 409 | S1 |
| `DELETE /api/categories/{id}` | 하위 노드나 연결 문서가 있으면 409 (강제 삭제 없음 — 먼저 비우도록 유도) | S1 |
| `GET /api/categories/{id}/stats` | 직계 자식별 `{progress, accuracy, attempt_count}` — 대시보드 드릴다운용 | S4 |
| `GET /api/categories/{id}/study-track` | 학습 트랙: `sort_order`순 문서 배열 `{document_id, type, title, status}` + 이어하기 위치 | S3 |

### 4.2 문서 Documents

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/documents` | 필터: `category_id`(하위 포함 `deep=1`), `type`, `tag`, `bookmarked=1`, `orphan=1`(고아 문서), 페이지네이션 | S1 |
| `POST /api/documents` | 생성. `doc_no`는 서버가 채번 | S1 |
| `GET /api/documents/{id}` | 상세 + `tags[]`, `usages[]`(연결 분류 경로+local_note), `relations[]`, `bookmarked`, `stats{attempts, accuracy}` | S1 |
| `PATCH /api/documents/{id}` | 본문·보기·정답·해설 등 수정 | S1 |
| `DELETE /api/documents/{id}` | 소프트 삭제 | S1 |
| `PUT /api/documents/{id}/tags` | `{tags: ["정규화", ...]}` 전체 교체. 없는 태그는 자동 생성 | S1 |
| `POST /api/documents/{id}/links` | `{category_id, local_note?, sort_order?}` 분류 연결. **이미 연결된 분류면 upsert** — 요청에 포함된 필드만 갱신 (§5.3 local_note 인라인 편집 경로) | S1 |
| `DELETE /api/documents/{id}/links/{category_id}` | 연결 해제 | S1 |
| `POST /api/documents/{id}/relations` | `{to_document_id, relation}` 문서 간 관계 (F24) | S4 |
| `DELETE /api/documents/{id}/relations/{to_id}` | 관계 해제 | S4 |
| `PUT /api/documents/{id}/bookmark` · `DELETE 동일 경로` | 북마크 토글 (F29) | S4 |
| `GET /api/documents/batch?ids=1,2,3` | 인쇄 뷰 등 다건 조회 | S4 |

### 4.3 반입 Import

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `POST /api/import/preview` | multipart로 JSON 파일 업로드 → 서버가 파싱·검증 후 미리보기 리포트. 원본 파일(`source_file`)을 같이 올리면 sources/에 보관 | S2 |
| `POST /api/import/commit` | preview_id + 항목별 결정 → 실제 반입. 결과 요약 반환 | S2 |
| `GET /api/import/preview/{preview_id}` | 캐시된 미리보기 재조회 — convert 잡 완료 시 `result_preview_id`로 반입 위저드에 연결하는 용도. TTL(1h) 만료 시 404 | S6 |

`preview` 응답:
```json
{
  "preview_id": "imp_a3f9",
  "source": { "filename": "2023_2회_기출.pdf", "duplicate_source": false },
  "summary": { "total": 120, "ok": 112, "duplicate_suspect": 6, "error": 2 },
  "items": [
    {
      "index": 0, "title": "2023-2회 17번: 정규화", "type": "past_question",
      "status": "duplicate_suspect",
      "duplicate_of": { "id": 211, "doc_no": "DOC-0211", "title": "..." },
      "suggest_categories": [ { "path": "정보처리기사/필기/DB", "category_id": 5, "exists": true } ],
      "suggest_relations":  [ { "doc_no": "DOC-0012", "document_id": 12, "found": true } ],
      "errors": []
    }
  ]
}
```
`commit` 요청:
```json
{
  "preview_id": "imp_a3f9",
  "decisions": [
    { "index": 0, "action": "merge", "merge_into": 211,
      "approve_categories": [5], "approve_relations": [12] },
    { "index": 1, "action": "new", "approve_categories": [5], "approve_relations": [] },
    { "index": 2, "action": "skip" }
  ]
}
```
- preview 상태는 서버 메모리(TTL 1시간)에 보관. 만료 시 409 → 다시 preview.
- `action: "merge"` = 기존 문서에 태그·출처만 병합, 본문은 유지.
- `approve_categories` 원소: **int = 기존 분류의 category_id** (`exists:true` 제안 승인) / **str = 생성 승인할 경로 문자열** (`exists:false` 제안 — commit이 누락 노드 생성 후 연결).
- `commit` 응답: `{ "created": N, "merged": N, "skipped": N, "new_documents": [{id, doc_no, title}], "categories_created": ["경로", ...], "relations_created": N }`.

### 4.4 학습 Study (진도·이어하기)

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/study/continue` | 홈 "이어하기" 카드: 최근 `resume_points` 상위 3개 `{category_path, document, progress}` | S3 |
| `POST /api/study/events` | `{category_id, document_id, action}` — `complete`(개념 "다음"=done 처리) / `position`(현재 위치 갱신) | S3 |

### 4.5 퀴즈·풀이 Quiz / Attempts

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `POST /api/quiz/session` | `{category_id?, mode, count?, document_ids?}` → 문제 목록(**정답·해설 제외**). mode: `sequential`·`random`·`wrong_only`(오답 재도전)·`bookmarked`(S4). `document_ids` 지정 시 해당 문서만 대상(모드 필터와 교집합, 요청 순서 유지) — 오답노트 개별 재도전용 | S3 |
| `POST /api/attempts` | 채점은 **서버가** 수행. 요청 `{document_id, category_id?, my_answer, time_spent, mode}` | S3 |

`attempts` 응답 — 채점 결과와 함께 해설 공개:
```json
{
  "is_correct": false, "answer": "1", "explanation": "3NF는 ...",
  "review_note_id": 88,          // 오답이면 자동 생성/기존 반환 (F06)
  "srs": { "due_date": "2026-07-23" }   // S5부터. 그 전엔 null
}
```

### 4.6 오답노트 Review Notes

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/review-notes` | 필터: `resolved`, `wrong_reason`, `category_id`(**하위 트리 포함**). 문서 요약에 분류 경로(`category_path`) 포함 — §5.8 계층 그룹핑의 근거 | S3 기본 / S4 하위 포함·경로 |
| `PATCH /api/review-notes/{id}` | `{note?, wrong_reason?, is_resolved?}` | S3 |

### 4.7 복습 SRS

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/srs/today` | 오늘의 복습 큐 (상한 `settings:srs.daily_limit`, 우선순위: 오답노트 미해결 > 기한초과 오래된 순). 응답 = 배열(페이지네이션 없음 — 상한으로 이미 절단). 항목: `{document_id, doc_no, type, title, content, choices, difficulty, due_date, ease_factor, interval_days, repetitions, has_review_note, answer, explanation}` — **정답·해설은 flashcard 타입에만 채움**(자가판정용, 서버 채점 없음), 문제 타입은 null(불변 규칙 1 — attempts 경로로 채점) | S5 |
| `POST /api/srs/answer` | `{document_id, q}` (q: 0~5, 계획서 §10 매핑) → `{ease_factor, interval_days, due_date}` | S5 |

퀴즈·플래시카드에서 풀면 `attempts` 저장 시 서버가 내부적으로 SM-2 갱신 — 클라이언트가 `srs/answer`를 따로 부를 필요 없음. `srs/answer`는 플래시카드(풀이 기록이 없는 판정)용.

### 4.8 대시보드·통계 Stats

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/dashboard` | 홈 요약 (아래 예시) | S3 최소 / S4 완성 |
| `GET /api/stats/heatmap?from&to` | `[{date, count}]` — attempts + 개념 완료 합산 | S4 |
| `GET /api/stats/weakness?category_id&limit=10` | 누적 정답률 낮은 문서/단원 Top N | S4 |
| `GET /api/stats/accuracy-trend?days=30` | `[{date, attempts, correct, accuracy}]` — 일자별 정답률 시계열(풀이 있는 날만). 홈 "최근 정답률 추이 라인"용 | S4 |
| `GET /api/stats/export?format=csv` | 학습 기록 내보내기 (F17) | S6 |

`dashboard` 응답:
```json
{
  "today_review": 12,
  "continue": [ { "category_id": 42, "path": "정보처리기사/필기/2과목/Ch.3",
                  "document_id": 317, "done": 7, "total": 12 } ],
  "ddays": [ { "kind": "category", "category_id": 3, "name": "정보처리기사 필기", "exam_date": "2026-08-30", "d_day": 39 },
             { "kind": "custom", "id": "dd_1", "category_id": null, "name": "실기 접수 마감", "exam_date": "2026-08-05", "d_day": 13 } ],
  "recent": { "attempts_7d": 143, "accuracy_7d": 0.78 }
}
```
- `ddays`(S4 완성): 분류의 `exam_date` + `settings:ddays.custom`(임의 D-Day — 접수 마감·발표일 등 분류와 무관한 날짜)을 서버가 **병합**해 `d_day` 계산, 날짜순 정렬. 지난 날짜는 제외. 날짜 필드명은 두 종류 모두 `exam_date`로 통일(S3 응답과 호환 — DDL 변경 없음).

### 4.9 검색·태그·제안함

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/search?q=&type=&page=&size=` | FTS5 (title/content/explanation — **answer 미인덱싱**). 응답은 §3 페이지 봉투, item = `{document_id, doc_no, type, title, snippet}` (`snippet`은 `<mark>` 하이라이트) | S6 |
| `GET /api/tags` | 태그 목록 + 사용 수 | S1 |
| `POST /api/tags/merge` | `{from_id, to_id}` 오타 태그 병합 | S6 |
| `GET /api/tag-rules` · `POST` · `PATCH /{id}` · `DELETE /{id}` | 태그 규칙 CRUD (F21). 응답 필드: `{id, category_id, category_path, tag_query, mode, created_at}` | S6 |
| `POST /api/tag-rules/{id}/scan` | 기존 문서 일괄 스캔 → 제안 생성. `{created: n}` 반환 | S6 |
| `POST /api/tag-rules/{id}/unlink` | **이 규칙이 연결한**(`category_documents.linked_rule_id={id}`) 링크 일괄 해제. `{unlinked: n}` 반환 | S6 |
| `GET /api/suggestions` | 대기 중(`status='pending'`) 연결 제안 목록. item = `{id, document_id, doc_no, title, category_id, category_path, tag_rule_id, tag_rule_query, created_at}` (`tag_rule_query`는 발생 규칙의 tag_query — 규칙 삭제 시 null) | S6 |
| `POST /api/suggestions/apply` | `{approve: [id...], reject: [id...]}` — 승인 시 연결 생성(`linked_by='rule'`) + status 갱신 | S6 |

- **제안 수명주기(F21)**: 트리거 3곳(반입 커밋/태그 변경/규칙 scan)에서 tag_query 매칭 시 —
  `mode='suggest'` 규칙 → `suggestions`에 `pending` 행 생성. `mode='auto'` 규칙 → 즉시 `category_documents` 연결(`linked_by='rule'`, `linked_rule_id`) — 제안함을 거치지 않음.
  - **중복 방지**: 이미 연결된 문서-분류 쌍, 또는 `suggestions`에 같은 쌍의 행이 있으면(상태 무관) 새 제안을 만들지 않음 — **rejected가 거절 기억으로 작동**(같은 제안 반복 금지).
  - 승인 = 연결 생성 + `approved`/`decided_at`. 거절 = `rejected`/`decided_at`. 이미 연결돼 있으면 승인은 no-op(멱등).
  - tag_query 문법: **단일 태그 또는 `OR` 결합만**(R13 — AND/괄호/NOT 없음). 태그명은 `tags.name` 정확 일치.
  - 규칙 삭제 시 해당 `suggestions.tag_rule_id`·`category_documents.linked_rule_id`는 SET NULL(연결·이력은 유지).

### 4.10 설정·변환·백업

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/settings` · `PUT /api/settings` | 키-값 일괄 조회/저장. 키: `srs.daily_limit`, `quiz.default_count`, `backup.auto`, `ddays.custom`(S4 — 임의 D-Day JSON 배열 `[{id, label, date}]`), `home.layout`(S7 — 홈 위젯 레이아웃 JSON, 아래 규격) | S3 |
| `POST /api/convert` | `{source_path or upload}` → claude CLI headless 변환 잡 시작 (F23). `{job_id}` 반환 | S6 |
| `GET /api/convert/{job_id}` | `{status: running/done/error, result_preview_id?}` — 완료 시 곧장 반입 preview로 연결 | S6 |
| `POST /api/documents/{id}/regenerate` | `{reason}` — 문제 오류 신고 → claude CLI로 해당 문서만 재생성 잡 시작 (F30). convert 잡 큐 재사용(동시 1개). `{job_id}` 반환 | S6 |
| `GET /api/documents/{id}/regenerate/{job_id}` | `{status: running/done/error, draft?}` — 완료 시 재생성 초안(기존/신규 나란히 비교용 문서 필드 전체) | S6 |
| `POST /api/documents/{id}/regenerate/{job_id}/apply` | 초안 승인 → 기존 문서를 PATCH 방식으로 교체. **같은 문서 id·doc_no 유지** — attempts·오답노트·SRS 이력 보존. 미승인 초안은 폐기 가능(잡 TTL 만료 시 자동 폐기). 자동 덮어쓰기 금지(R7) | S6 |
| `POST /api/backups` · `GET /api/backups` · `POST /api/backups/{id}/restore` | 백업 스냅샷 (F27). `id`는 타임스탬프 문자열. restore는 확인 문구 필수 — body `{confirm: "RESTORE"}` 고정 문자열, 복원 전 자동 스냅샷 1개 생성 | S6 |

- 재생성(F30) 프롬프트 구성: **현재 문서 내용 + 신고 사유(reason) + (source_detail 있으면) 원본 출처 정보** — 원본 대조가 가능하도록(R7). 엔진은 R9 결정 그대로 claude CLI 서브프로세스(F23 인프라). S8부터는 §4.11의 이중 엔진 정책을 따른다.

### 4.11 LLM 엔진 관리 (S8 — F34 + F35 1단계)

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/llm/status` | 엔진 진단: `{cli: {installed, logged_in, last_success_at, last_error_kind}, api: {key_registered, key_suffix, last_success_at}, limit: {kind, resets_at} \| null, priority, fallback_policy}` | S8 |
| `POST /api/llm/api-key` | `{key}` — **즉석 연결 테스트**(초경량 호출) 성공 시에만 저장. 저장처는 루트 `secrets.json`(**DB/settings 금지** — 백업(F27)·git 제외 대상). 응답은 `{key_suffix}`(마지막 4자리)만 — 원문 키는 어떤 응답에도 미포함(write-only) | S8 |
| `DELETE /api/llm/api-key` | 키 삭제 | S8 |
| `POST /api/convert` 확장 | `{file 업로드}` **또는 `{url}`** (F35-1): url이면 서버가 다운로드(공개 자료, 크기 상한·content-type 화이트리스트·**사설/로컬 IP 차단(SSRF 방지)**) 후 동일 파이프라인. `engine` 선택 파라미터(`'auto'\|'cli'\|'api'`, 기본 auto=우선순위) — 폴백 "물어보기" 시 프론트가 `engine:'api'`로 재요청하는 계약 | S8 |

- **엔진 설정은 settings 재사용**: `llm.priority`(`'cli'\|'api'`, 기본 cli) · `llm.fallback`(`'auto'\|'ask'\|'off'`, 기본 **ask** — auto는 과금 동의 UI 통과 시에만 설정 가능) · `llm.api_model`(기본 `claude-sonnet-5` — 과금 부담 고려, 변경 가능).
- **API 엔진**: anthropic Python SDK 직접 호출(키는 secrets.json→환경변수→`ant` 프로필 순 해석). convert/regenerate 프롬프트는 CLI 경로와 동일 템플릿.
- **오류 구조화**: convert/regenerate 잡 상태 응답에 `error_info` 추가 — `{kind: 'rate_limit'\|'auth'\|'not_installed'\|'timeout'\|'other', limit_kind?: 'session'\|'daily'\|'weekly'\|'model'\|'overall', resets_at?, message(사람이 읽는 한국어), action(다음 행동 안내), fallback_available: bool}`. **CLI/API 원문 JSON은 사용자에게 노출 금지.** CLI 429의 `result` 문자열에서 한도 종류·리셋 시각을 파싱한다.
- **한도 기억**: 최근 429의 `{kind, resets_at}`을 settings `llm.last_limit`에 기록 — status 응답에 포함하고, 리셋 전 변환 시도 시 실행 전에 경고(폴백 정책 적용). 리셋 시각 경과 시 자동 무효화.
- CLI 로그인은 앱이 대행 불가(대화형) — status의 `logged_in:false`일 때 프론트가 "터미널에서 `claude` 실행해 로그인" 안내 + [다시 확인] 재진단.
- **잡 진행 가시화(S8 — "마냥 기다리다 새로고침" 방지)**: convert/regenerate 잡 상태 응답에 `progress` 추가 —
  `{phase: 'downloading'|'preparing'|'llm_running'|'parsing'|'preview_building', detail?, elapsed_ms, last_activity_at, usage?: {input_tokens, output_tokens, cost_usd?}, eta_ms?}`.
  - CLI는 `--output-format stream-json`으로 실행해 스트림 이벤트에서 **활동 신호와 누적 usage를 실시간 파싱** → 잡 상태에 반영(API 엔진은 SDK 스트리밍 동일). `last_activity_at`이 진짜 심장박동 — "살아있음"을 보증한다.
  - `eta_ms`는 **대략치**: 과거 완료 잡들의 (파일 크기→소요 시간) 이동 평균으로 추정, 표본 없으면 생략. 정확성보다 "감"이 목적.
  - 프론트: 단계 스텝 표시 + 경과 시간 + 토큰/예상 비용 라이브 카운터 + 대략 ETA + **"새로고침해도 작업은 서버에서 계속됩니다"** 안내(폴링은 새로고침 후 job_id로 재개 — 기존 계약 그대로).
- `home.layout`(S7, F31) 규격 — **새 API·DDL 없음**, settings GET/PUT 재사용:
  ```json
  { "columns": "auto",
    "widgets": [ { "id": "continue", "visible": true, "order": 0, "col": 0 } ] }
  ```
  - `columns`: `'auto' | 1 | 2 | 3`. `widgets[].id`: §5.1 위젯 레지스트리 9종. `col`: 다열일 때 열 배정(0부터, 생략 시 0).
  - 전방 호환: 서버는 값을 검증 없이 문자열로 저장(키-값 원칙 유지). 프론트가 파싱 시 **알 수 없는 id 무시, 누락 id는 기본값(표시·마지막 순서)으로 보충**, 키 부재 = 기본 레이아웃.
  - 서버 저장이므로 홈 레이아웃은 **전 기기 공통**. (기기별 선호인 사이드바 접힘·테마는 localStorage — §5 도입부·§6.)

## 5. 화면 상세 (11개)

라우팅: React Router. 모바일(<768px)은 하단 탭바(홈/커리큘럼/퀴즈/오답노트) + 트리 드로어.

**공통 레이아웃 — 사이드바 접힘(S7, F33)**: 태블릿·PC(≥768px)의 좌측 사이드바에 접힘 토글(« / »).
- 접으면 **아이콘 전용 레일**(라벨 숨김, `title` 툴팁 유지) — 완전 숨김이 아니라 레일 유지: 다시 펼칠 진입점이 항상 보이고, 내비게이션은 한 번의 클릭 거리를 유지.
- 상태: zustand `sidebar` 스토어 + **localStorage `sidebar`**(`'expanded' | 'collapsed'`) — 기기별 UI 선호이므로 서버 settings가 아닌 localStorage(theme 관례, §6).
- 저장값 없을 때 기본: **768~1023px(태블릿) = collapsed, ≥1024px(PC) = expanded.** 모바일(<768px)은 사이드바 자체가 없으므로 토글 미노출(하단 탭바 유지).

### 5.1 홈 대시보드 — `/`
- **구성(우선순위 순)**: ① 이어하기 카드(최대 3, 탭하면 `/study/:categoryId`로 즉시 복귀) ② "오늘의 복습 N개" 버튼(S5) ③ 학습 히트맵(S4 — 당초 12주 고정, S7부터 반응형 주 수) ④ D-Day 배지들(시험 분류 + 임의 D-Day 병합 — §4.8, S4 완성) ⑤ 북마크 모아보기 진입(S4)
- **API**: `GET /api/dashboard`
- **엣지**: 데이터 0건이면 온보딩 카드("기출 JSON을 반입해 시작하세요" → `/import`).
- **위젯 레지스트리(S7, F31)** — 홈 섹션을 9개 위젯 컴포넌트로 분리, id 고정:
  `continue`(이어하기) · `today_review`(오늘의 복습) · `dday`(D-Day) · `heatmap`(학습 히트맵 — 반응형 주 수) · `exam_progress`(시험별 진도 도넛) · `recent7d`(최근 7일 풀이/정답률) · `accuracy_trend`(최근 정답률 추이) · `weakness`(자꾸 틀리는 개념 Top 10) · `bookmarks`(북마크 모아보기 진입).
  기존 "데이터 0건이면 위젯 미표시" 관례는 유지하되, 사용자 숨김(`visible:false`)이 우선하며 숨긴 위젯은 **데이터 쿼리도 실행하지 않는다**(비마운트 또는 `enabled:false` — 쿼리 미실행이면 구현 방식 무관, S7 구현은 비마운트). 온보딩 카드는 위젯이 아님(편집 대상 제외).
- **편집 모드(S7, F31)**: 홈 헤더 [편집] → 위젯마다 드래그 핸들(≡)·숨김(눈) 토글, 상단 열 수 세그먼트(자동/1/2/3), 하단 "숨긴 위젯" 목록(탭하면 복귀), [기본값 복원], [완료]=`PUT /api/settings`(`home.layout`, §4.10 — 저장은 완료 시 1회, 취소 시 드래프트 폐기).
  - 드래그는 **Pointer Events 직접 구현**(pointerdown/move/up + setPointerCapture, 핸들 `touch-action:none`) — **외부 D&D 라이브러리 금지**. 같은 열 내 순서 변경 + 열 간 이동(col 배정), 드래그 중 자리표시자 표시.
  - 폴백: 핸들 옆 ▲▼(순서)·◀▶(열 이동) 버튼 — 터치 스크롤 충돌·접근성 대비. 모바일은 이 버튼만으로도 전체 편집 가능. **단 auto 모드에서는 배치 조작 전체가 비활성** — 아래 "편집 모드의 열 조작 규칙" 참조.
- **다열 렌더(S7, F31)**: `columns:'auto'` = **콘텐츠 영역 실측 폭 기준**(사이드바 제외 가용 폭을 ResizeObserver로 관측 — 창 크기 변화와 사이드바 접힘/펼침에 실시간 반응): `<704px` 1열 · `704~1343px` 2열 · `≥1344px` 3열. 고정 1/2/3. **콘텐츠 폭 <640px는 항상 1열 강등**(col 값은 보존, order·col 순으로 평탄화). 열 수 축소 시 초과 col은 마지막 열로 클램프. 컨테이너 폭 1열 `max-w-2xl`(672) · 2열 `max-w-4xl`(896) · 3열 `max-w-6xl`(1152) + `mx-auto`.
  - **컨테이너 최대 폭은 그 열 수가 흔히 쓰이는 콘텐츠 폭보다 확실히 작게** 잡는다 — 일반 PC 폭(콘텐츠 ≥896px)에서 항상 수십~수백 px의 좌우 여백이 남아 **가운데 정렬이 눈에 보인다**. 검산: 콘텐츠 1088px(1280 창)→2열 여백 96px씩 · 1344px(1536 창)→3열 여백 96px씩 · 1728px(1920 창)→3열 여백 288px씩. (v1.6 초안 5xl/7xl은 현실적인 창 폭 대부분에서 컨테이너가 영역을 꽉 채워 여백 0~32px — 정렬 체감 불가. 2026-07-24 사용자 피드백 3차 반영.)
  - **자동 분배(3차 피드백 반영)**: 표시 위젯들의 col 값이 사실상 미지정(전원 동일 col — 기본 레이아웃이 이 상태)인데 렌더 열이 2~3열이면, 배열 순서대로 **라운드로빈 자동 분배**한다(0,1,2,0,1,…) — 우선순위 높은 위젯이 각 열 상단에 오고, 창이 넓어질 때 위젯이 자연스럽게 열로 퍼진다. 사용자가 편집 모드에서 열을 지정한(서로 다른 col 존재) 레이아웃은 자동 분배하지 않고 지정값 그대로. 편집 모드는 현재 화면과 동일한 분배로 렌더(WYSIWYG).
  - **편집 모드의 열 조작 규칙(4·5차 피드백 반영)**: `columns:'auto'`에서 배치는 **미리보기 전용(비활성)** — 드래그 핸들·▲▼·◀▶ 전부 미동작/미노출로 현재 자동 배치를 보여주기만 한다. 배치를 수정하려면 고정 1/2/3을 선택해야 하며(전환 시 현재 보이던 분배가 시작점), 고정 모드에서만 드래그·▲▼·◀▶가 활성화되고 열 간 이동이 col을 실체화한다. 숨김 토글(눈)·숨긴 위젯 탭 복귀는 열 배치와 무관하므로 auto에서도 동작한다(단 드래그 기반 숨김/복귀는 고정 모드 전용).
  - **숨긴 위젯 드래그(4차 피드백 반영)**: 편집 모드 하단 "숨긴 위젯" 목록의 항목을 그리드로 드래그하면 해당 위치에 visible로 복귀하고, 그리드의 위젯을 숨김 영역으로 드래그하면 숨김 처리된다(탭 복귀·눈 토글도 유지).
  - 태블릿 DoD 정합: 뷰포트 768px + 접힘 레일(64px) → 콘텐츠 704px → 2열 유지.
  - (v1.5까지는 뷰포트 innerWidth 기준 — 사이드바 폭 때문에 PC에서 여백이 안 보이고 리사이즈 반응이 체감되지 않아 콘텐츠 폭 기준으로 변경.)
- **히트맵 반응형 주 수(S7)**: 히트맵은 12주 고정이 아니라 **위젯 컨테이너 폭에 맞춰 표시 주 수를 유동 조정**한다. 열 수·사이드바 접힘에 따라 위젯 폭이 달라지므로 기준은 뷰포트가 아닌 **위젯 컨테이너 폭(ResizeObserver)**.
  - 셀 크기·간격은 고정(토큰 기반) — `표시 주 수 = floor((컨테이너 폭 − 요일 라벨 폭) / (셀 + 간격))`을 **최소 8주 ~ 최대 26주**로 클램프. 항상 **최근 N주**를 오른쪽 끝(오늘)에 정렬해 렌더.
  - 데이터는 기존 `GET /api/stats/heatmap?from&to`로 **최대 범위(26주)를 1회 조회**하고 클라이언트에서 최근 N주만 잘라 렌더 — 리사이즈·열 변경 시 재요청 없음. **새 API·파라미터 변경 없음.**
  - 주 수 **수동 지정**(위젯별 설정)은 v1.x 후보로 계속 제외 — 이 항목은 자동 조정만 다룬다.
- **D-Day 즉석 편집(S7, F32)**: D-Day 위젯 헤더의 연필 아이콘 → 모달로 **설정 §5.11의 D-Day 관리(DDayManager) 컴포넌트 재사용**(시험 분류 `exam_date` + 임의 D-Day 추가·수정·삭제 — 기존 categories PATCH·`settings:ddays.custom` 경로 그대로, 새 로직 없음). D-Day 위젯만은 데이터 0건이어도(visible이면) "등록된 D-Day 없음 + [추가]"로 표시 — 홈에서 첫 등록 가능. 저장 시 dashboard invalidate → 배지 즉시 갱신.

### 5.2 탐색 — `/explore`
- **구성**: 좌측 분류 트리(노드별 진도바·문서수, 우클릭/⋯ 메뉴로 추가·이름변경·이동·삭제), 우측 문서 카드 그리드(제목·타입 배지·태그 칩·"N곳에서 사용 중" 배지·북마크 별).
- **필터바**: 타입, 태그, 북마크만, **단일 문서만**(어느 분류에도 연결되지 않은 문서 — API 파라미터는 `orphan=1` 유지, UI 표기는 "단일 문서"). "하위 포함" 토글(`deep=1`).
- **API**: `categories/tree`, `documents`, 링크 연결/해제, 문서 생성 모달.
- **상호작용**: 문서 카드를 다른 분류 노드로 드래그 = 연결 추가(이동 아님 — 다대다 원칙 시각화). 모바일은 카드 ⋯ 메뉴 → "분류에 연결".

### 5.3 문서 상세 — `/docs/:id`
- **구성**: 제목+doc_no+타입, 본문 Markdown 렌더(코드 하이라이트, 이미지), 태그 칩(클릭=탐색 필터), 사용처 목록(분류 경로 + local_note 인라인 편집), 관련 문서(relations — 문제면 "이 문제의 개념", 개념이면 "확인 문제")(S4), 풀이 이력 미니차트(최근 10회 ○×, S3), 북마크 별(S4).
- **문제 타입 뷰 모드**: 지문(content) → 보기 목록(①~④ 각각 별도 행) → **정답·해설은 기본 가림** — "정답·해설 보기" 토글(스포일러)로만 펼침. 문서를 열람만 해도 정답이 눈에 들어오지 않게 한다.
- **편집 모드**: 본문·보기·정답·해설 필드 폼. 문제 타입이면 미리보기 탭(실제 퀴즈 카드 모양).
- **오류 신고·재생성(S6, F30)**: [오류 신고] 버튼(진입점: 문서 상세·학습 모드 §5.5·퀴즈 해설 §5.6) → 사유 입력 모달 → 재생성 잡 생성(진행 중 배지 표시) → 완료 시 **문서 상세에서 기존 vs 신규 나란히 비교** → [교체](apply — 같은 문서 유지) / [폐기]. 자동 덮어쓰기 없음.
- **API**: `documents/{id}`, PATCH, tags PUT, relations, bookmark, regenerate(S6, §4.10).

### 5.4 커리큘럼 — `/curriculum`, `/curriculum/:categoryId`
- `/curriculum`: 최상위(자격증) 카드 목록 → 시험 선택. 카드 목록에 [+ 시험 추가].
- `/curriculum/:id`: 과목→챕터 아코디언. 각 행 = 이름 + 진도바(done/total) + [이어하기|여기서 시작] 버튼. 완료 챕터는 ✓.
- **분류 관리(S4)**: 분류 편집이 탐색 §5.2 전용이 아니라 커리큘럼에서도 가능해야 한다 — 편집 모드 토글(연필 아이콘) 시 각 행/카드에 [추가(하위 분류)] [이름·시험일 수정] [이동(순서·부모 변경)] [삭제] 노출. 탐색과 동일한 공용 모달(CategoryFormModal·MoveCategoryModal·ConfirmDialog)과 기존 categories API를 재사용하며, 삭제 규칙(§4.1 — 하위·연결 문서 있으면 409)도 동일. 변경 즉시 트리·진도 invalidate.
- **API**: `categories/tree`(진도 포함), `study/continue`, categories POST/PATCH/move/DELETE(S4 확장).

### 5.5 학습 모드 — `/study/:categoryId` (핵심 UX)
- **구성**: 상단 챕터 진행바(7/12), 본문 영역(개념=Markdown / 문제=퀴즈 카드 인라인), 하단 [◀ 이전] [다음 ▶].
- **동작**: 개념 문서에서 "다음" = `study/events{action:complete}` 후 다음 문서. 문제 문서는 풀어야(=attempts 성공 제출) "다음" 활성화. 진입·이동 시 `action:position`으로 resume 갱신.
- **챕터 완료 화면**: 정답률 요약 + 틀린 문제 목록("지금 다시 풀기" = wrong_only 미니 퀴즈) + [다음 챕터 ▶].
- **엣지**: 챕터에 문서 0개면 "문서를 연결하세요" 안내. 마지막 챕터 완료 시 과목 완료 화면.
- **완료 문제 재방문**: 이미 done인 문제로 돌아가면 마지막 풀이를 복원해 표시 — 내가 고른 보기(정오 색상)·정답·해설을 그대로 보여주고, [다시 풀기] 버튼으로 재제출 가능(새 attempt 누적, 이력 미니차트에 반영). 데이터는 `documents/{id}`의 `stats.last_attempt {my_answer, is_correct, created_at}`.
- **오류 신고(S6)**: 문제 카드에 [오류 신고] 버튼 → §5.3의 재생성 흐름으로 진입.
- **API**: `categories/{id}/study-track`, `study/events`, `attempts`.

### 5.6 퀴즈 — `/quiz` (설정) → `/quiz/run`
- **설정 화면**: 범위(트리 선택), 모드(순차/랜덤/오답만/북마크만), 문항 수(기본 `settings:quiz.default_count`).
- **런 화면**: 문제 카드(지문 Markdown + 보기 4개 버튼), 선택 즉시 제출 → 정오 색상 + 해설 펼침 + 관련 개념 링크(S4) + [오류 신고](S6 — §5.3 재생성 흐름) → [다음]. 상단 진행바 + 경과 시간.
- **종료 요약**: 정답률, 소요 시간, 틀린 문제 리스트(각각 오답노트 메모 바로 입력).
- **상태**: 세션은 zustand 스토어(새로고침 시 세션 종료 확인 모달). 문항별 `time_spent`는 카드 표시~제출 시각.
- **API**: `quiz/session`, `attempts`.

### 5.7 플래시카드 — `/flashcards?category_id=` (S5)
- 카드 뒤집기(탭/스페이스), 스와이프 좌="모른다"(q=1)/우="안다"(q=4). 남은 장수 + 오늘 큐 진행.
- **API**: `srs/today`(flashcard 타입 필터) 또는 범위 선택, `srs/answer`.

### 5.8 오답노트 — `/review-notes`
- **구성**: 필터(분류 범위·틀린이유·해결여부) + 분류 계층 그룹 리스트(아래) — 카드 = 문제 요약, 내 메모 인라인 편집, 틀린이유 태그 선택, [극복] 토글, [재도전].
- **분류 범위 필터(S4)**: 평면 셀렉트가 아니라 퀴즈 설정(§5.6)의 범위 트리 선택과 동일 패턴(공용 컴포넌트화) — 선택한 범위의 **하위 전체 포함**(§4.6 하위 트리 필터).
- **계층 그룹 보기(S4)**: 리스트를 분류 경로(`category_path`) 기준 그룹 섹션으로 표시 — 상위 단위(대단위) 헤더 → 하위 단위(중/소/하위 단위) 소제목, 접기/펼치기, 그룹 헤더에 건수 배지. 여러 분류에 연결된 문서는 선택 범위 안의 경로를 우선, 없으면 첫 연결 경로 기준 1곳에만 표시. 어느 분류에도 연결 안 된 문서는 "미분류" 그룹.
- [재도전] = 해당 문서들로 `quiz/session{mode:wrong_only}`. 카드별 개별 [재도전] = `quiz/session{mode:sequential, document_ids:[해당 문서]}` — 누른 그 문제만 출제. **`wrong_only`가 아닌 `sequential`을 쓰는 이유**: wrong_only는 미해결 오답노트 조인이라 극복(resolved) 처리된 문제·오답노트 없는 문서는 0문항이 된다. 특정 문서를 지목하는 재도전(오답노트 개별·약점 위젯 §5.1)은 모두 `sequential + document_ids`.
- **API**: `review-notes`(S4: 하위 포함·경로), PATCH, `quiz/session`.

### 5.9 반입 — `/import`
- **3단계 위저드**: ① 파일 선택(JSON + 원본 선택) → ② 미리보기 표(항목별 상태 배지: 정상/중복 의심/오류. 중복은 기존 문서와 나란히 비교, 라디오: 건너뛰기/새로 추가/병합. 분류·관계 제안 체크박스) → ③ 반입 실행 → 결과 요약(생성 N, 병합 N, 건너뜀 N + 새 문서 바로가기).
- **엣지**: preview 만료(1h) 시 재업로드 안내. 오류 항목은 개별 오류 메시지 표시, 커밋에서 자동 제외.
- **API**: `import/preview`, `import/commit`. S6: "파일만 던지면 변환부터"(`convert`) 버튼 추가.

### 5.10 인쇄 뷰 — `/print?type=&category_id=&options=`
- **종류 3종**(계획서 §12): 개념 정리본 / 문제집(문제 앞·해설 뒤 분리) / 오답노트.
- 옵션 패널(화면에서만 보임): 해설 포함/제외, 풀이 여백, 기간 필터(오답노트). 본문은 A4 폭 렌더 + `@media print` 규칙.
- **API**: `study-track`·`documents/batch`·`review-notes` 조합 (전용 API 없음).

### 5.11 설정 — `/settings`
- 테마(라이트/다크/시스템 — localStorage, §6), 복습 큐 상한, 기본 문항 수, D-Day 관리(S4, 아래), 백업/복원(S6), 태그 병합 도구(S6).
- **D-Day 관리(S4)** — DDL 변경 없이 두 종류:
  - 시험 분류 D-Day: 트리에서 시험 분류 선택 → `exam_date` 추가/변경/제거 (`PATCH /api/categories/{id}` 재사용).
  - 임의 D-Day(접수 마감·발표일 등 분류와 무관): 라벨+날짜 추가/수정/삭제 — `settings:ddays.custom = [{id, label, date}]` (settings GET/PUT 재사용).
  - 홈 D-Day 배지는 두 종류를 병합한 `dashboard.ddays`(§4.8) 사용.
- **API**: `settings`, `categories` PATCH, `backups`(S6).

## 6. 테마 · 디자인 토큰 (F28)

- Tailwind `darkMode: 'class'` + `styles/tokens.css`의 CSS 변수 이중 구조. 컴포넌트는 **토큰만 참조**(`bg-surface`, `text-primary` 등) — 색상 하드코딩 금지.
- 토큰(라이트/다크 각 1세트): `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-soft`, `--on-accent`(accent 배경 위 텍스트 — `text-white` 대체), `--correct`, `--wrong`, `--warning`, 히트맵 5단계.
- 테마 스토어: `theme = 'system' | 'light' | 'dark'` (localStorage `theme`). system이면 `prefers-color-scheme` 미디어쿼리 구독. `<html>`에 `class="dark"` 토글.
- 인쇄 뷰는 테마 무시하고 항상 라이트로 렌더.

## 7. 프론트 상태 관리

- **서버 상태**: TanStack Query — 캐시 키 = 리소스 경로. 변경(mutation) 후 관련 쿼리 invalidate.
- **로컬 상태**: zustand 4개 — `quizSession`(문항·답안·타이머), `flashcardSession`, `theme`, `sidebar`(S7 — `'expanded'|'collapsed'`, localStorage `sidebar` persist, 기본값 규칙은 §5 도입부).
- 홈 레이아웃(S7)은 스토어를 두지 않는다: 저장본은 서버 `settings:home.layout`(TanStack Query), 편집 중 드래프트는 홈 컴포넌트 로컬 상태 — [완료] 시에만 PUT, 취소 시 폐기.
- 낙관적 업데이트는 북마크·진도 완료(체감 속도 중요)에만 적용, 나머지는 단순 invalidate.

## 8. 비고

- 서버 채점 원칙: 정답·해설은 `quiz/session` 응답에 포함하지 않는다 (풀기 전 노출 방지, 기록 무결성).
- attempts 저장과 SM-2 갱신·오답노트 생성은 하나의 트랜잭션.
- 이 문서와 실제 구현의 갭은 각 stage 완료 시 `/pdca analyze`로 점검.
