# Study Hub — 상세 설계 (API 명세 · 화면 상세)

> 상태: **Design v1.1** — v1.0 대비: 문서 재생성 API(F30, §4.10)·오답노트 계층 그룹(§4.6·§5.8)·D-Day 병합(§4.8·§5.11) 반영
> 작성일: 2026-07-22 · 갱신: 2026-07-23
> 상위 문서: `docs/01-plan/study-app.plan.md` (Draft v0.5)
> 구현 계획: `docs/01-plan/stage-1-skeleton.plan.md` ~ `stage-6-automation.plan.md`

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
│     ├─ stores/            # zustand: quizSession, flashcardSession, theme
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

구현 단계 표기: [S1]~[S6] = stage 1~6에서 구현.

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
| `GET /api/search?q=&type=` | FTS5 (title/content/explanation), 스니펫 포함 | S6 |
| `GET /api/tags` | 태그 목록 + 사용 수 | S1 |
| `POST /api/tags/merge` | `{from_id, to_id}` 오타 태그 병합 | S6 |
| `GET /api/tag-rules` · `POST` · `PATCH /{id}` · `DELETE /{id}` | 태그 규칙 CRUD (F21) | S6 |
| `POST /api/tag-rules/{id}/scan` | 기존 문서 일괄 스캔 → 제안 생성 | S6 |
| `GET /api/suggestions` | 대기 중 연결 제안 (규칙·반입 발) | S6 |
| `POST /api/suggestions/apply` | `{approve: [id...], reject: [id...]}` | S6 |

### 4.10 설정·변환·백업

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/settings` · `PUT /api/settings` | 키-값 일괄 조회/저장. 키: `srs.daily_limit`, `quiz.default_count`, `backup.auto`, `ddays.custom`(S4 — 임의 D-Day JSON 배열 `[{id, label, date}]`) | S3 |
| `POST /api/convert` | `{source_path or upload}` → claude CLI headless 변환 잡 시작 (F23). `{job_id}` 반환 | S6 |
| `GET /api/convert/{job_id}` | `{status: running/done/error, result_preview_id?}` — 완료 시 곧장 반입 preview로 연결 | S6 |
| `POST /api/documents/{id}/regenerate` | `{reason}` — 문제 오류 신고 → claude CLI로 해당 문서만 재생성 잡 시작 (F30). convert 잡 큐 재사용(동시 1개). `{job_id}` 반환 | S6 |
| `GET /api/documents/{id}/regenerate/{job_id}` | `{status: running/done/error, draft?}` — 완료 시 재생성 초안(기존/신규 나란히 비교용 문서 필드 전체) | S6 |
| `POST /api/documents/{id}/regenerate/{job_id}/apply` | 초안 승인 → 기존 문서를 PATCH 방식으로 교체. **같은 문서 id·doc_no 유지** — attempts·오답노트·SRS 이력 보존. 미승인 초안은 폐기 가능(잡 TTL 만료 시 자동 폐기). 자동 덮어쓰기 금지(R7) | S6 |
| `POST /api/backups` · `GET /api/backups` · `POST /api/backups/{id}/restore` | 백업 스냅샷 (F27). restore는 확인 문구 필수 | S6 |

- 재생성(F30) 프롬프트 구성: **현재 문서 내용 + 신고 사유(reason) + (source_detail 있으면) 원본 출처 정보** — 원본 대조가 가능하도록(R7). 엔진은 R9 결정 그대로 claude CLI 서브프로세스(F23 인프라).

## 5. 화면 상세 (11개)

라우팅: React Router. 모바일(<768px)은 하단 탭바(홈/커리큘럼/퀴즈/오답노트) + 트리 드로어.

### 5.1 홈 대시보드 — `/`
- **구성(우선순위 순)**: ① 이어하기 카드(최대 3, 탭하면 `/study/:categoryId`로 즉시 복귀) ② "오늘의 복습 N개" 버튼(S5) ③ 학습 히트맵 12주(S4) ④ D-Day 배지들(시험 분류 + 임의 D-Day 병합 — §4.8, S4 완성) ⑤ 북마크 모아보기 진입(S4)
- **API**: `GET /api/dashboard`
- **엣지**: 데이터 0건이면 온보딩 카드("기출 JSON을 반입해 시작하세요" → `/import`).

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
- **로컬 상태**: zustand 3개 — `quizSession`(문항·답안·타이머), `flashcardSession`, `theme`.
- 낙관적 업데이트는 북마크·진도 완료(체감 속도 중요)에만 적용, 나머지는 단순 invalidate.

## 8. 비고

- 서버 채점 원칙: 정답·해설은 `quiz/session` 응답에 포함하지 않는다 (풀기 전 노출 방지, 기록 무결성).
- attempts 저장과 SM-2 갱신·오답노트 생성은 하나의 트랜잭션.
- 이 문서와 실제 구현의 갭은 각 stage 완료 시 `/pdca analyze`로 점검.
