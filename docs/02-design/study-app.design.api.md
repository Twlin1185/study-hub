# Study Hub — 상세 설계 §4 API 명세

> `study-app.design.md`(색인 · §1~3 공통 규약)에서 2026-07-31 분할된 **§4 전체**다(내용 이동만 — § 번호·[S#] 단계 태그는 분할 전과 동일, 판번은 색인 문서를 따른다).
> 부분 읽기: 원하는 절은 `### 4.` 패턴을 Grep해 위치를 찾은 뒤 그 구간만 읽는다(예: §4.18 → `### 4.18`). 단계별로는 `[S<n>]` 태그 Grep.

## 4. API 명세

구현 단계 표기: [S1]~[S14] = stage 1~14에서 구현. (S7은 순수 프론트 단계 — 새 엔드포인트 없음, 기존 settings API의 키 추가만.)

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

### 4.3 반입 Import (S2 · S6 — convert 연결 · **S13 — F40-① 변환 결과 보존·복구**)

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `POST /api/import/preview` | multipart로 JSON 파일 업로드 → 서버가 파싱·검증 후 미리보기 리포트. 원본 파일(`source_file`)을 같이 올리면 sources/에 보관 | S2 |
| `POST /api/import/commit` | preview_id + 항목별 결정 → 실제 반입. 결과 요약 반환 | S2 |
| `GET /api/import/preview/{preview_id}` | 캐시된 미리보기 재조회 — convert 잡 완료 시 `result_preview_id`로 반입 위저드에 연결하는 용도. **S13(F40-①): 캐시 미스(TTL 1h 만료·서버 재시작)면 `import/auto/`의 보존 JSON으로 preview를 재생성해 복구**(같은 preview_id 유지) — 보존 파일도 없을 때만 404 | S6·S13 |
| `GET /api/import/preview/{preview_id}/json` | **S13(F40-①)**: 보존된 반입 JSON 원본을 `Content-Disposition: attachment`로 반환(`application/json`). 최악의 경우에도 사용자가 파일을 손에 쥐고 "반입 JSON 파일 선택" 경로로 이어갈 수 있게 하는 **탈출구**. 보존 파일이 없으면 404 — **보존은 convert·fetch 잡이 만든 preview에만 생긴다**(사용자가 직접 올린 JSON의 preview는 보존 대상이 아니다: 파일이 이미 사용자 손에 있다). 따라서 프론트는 **보존본이 있는 경로에서만 [변환 JSON 내려받기]를 노출**한다(§5.9 — 항상 노출하면 직접 업로드 preview에서 404를 누르게 된다) | S13 |

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
- preview 상태는 서버 메모리(TTL 1시간)에 보관. 만료 시 409 → 다시 preview. **S13(F40-①)부터는 만료 전에 디스크 복구를 시도하므로 409는 "복구도 실패"일 때만 도달한다.**
- **S15 예정(§4.17 ⑤·⑥ — 변환 신뢰 게이트, 순수 추가)**: 항목에 `warnings: string[]`(기본 `[]` — `'solved_answer'|'fabrication_suspect'|'match_unavailable'`) + summary에 `warning`(경고 항목 수, 기본 0). 앞 두 값은 프론트 기본 반입 제외, 셋째는 표시만 — 규칙·판정 알고리즘은 §4.17이 단일 출처.

**변환 결과 보존·복구 (S13 — F40-①, 계획서 §14 F40. "LLM 비용이 증발하지 않게")**
- **왜**: 변환 산출 JSON이 프로세스 메모리 preview 캐시(TTL 1시간)에만 존재해, 시간 초과·서버 재시작 시 LLM 비용을 치른 결과가 복구 수단 없이 사라진다(원본은 sources/에 남지만 재변환 = 재과금).
- **보존**: convert·fetch 잡이 preview 생성에 성공하면 그 반입 JSON을 **`import/auto/{preview_id}__{source_hash12|nosrc}__{원본파일명}.json`** 으로 저장(UTF-8, `ensure_ascii=False`). **파일명 규칙이 곧 복구 계약** — `source_hash12` = 원본 바이트 SHA-256 앞 12자(= `sources/` 저장 파일명 접두어와 같은 규칙), 원본이 없으면 `nosrc`. 별도 인덱스·DB 레코드를 두지 않는다(**DDL 0건**).
- **복구 절차**: 캐시 미스 → `import/auto/`에서 preview_id로 파일 탐색 → 해시로 `sources/`의 원본 바이트를 되읽어 → 기존 `create_preview`를 그대로 재실행(**같은 preview_id 재사용**). 결과적으로 원본 연결·`duplicate_source` 판정까지 최초와 동일하게 재구성된다.
- **재계산 원칙**: 항목 `index`는 같은 JSON·같은 순서에서 나오므로 **안정**(commit 결정과 어긋나지 않는다). 반면 `duplicate_of`·`suggest_*`는 **복구 시점의 DB 기준으로 재계산**된다 — 그 사이 DB가 바뀌면 배지가 달라질 수 있어 화면에 "복구됨 — 판정은 현재 DB 기준" 소표기(F26 `goal_met` "현재 기준 재평가" 전례와 같은 원칙).
- `POST /api/import/commit`도 만료 시 **같은 복구를 1회 시도**한 뒤 진행한다(프론트 재조회 불요).
- **복구 표시 필드**: `PreviewResponse.recovered` · `CommitResult.recovered` (bool, 기본 `false` — 순수 추가라 기존 클라이언트에 무해). 위 소표기의 근거값이다.
- **재커밋 차단**(S13 구현 중 발견 — 보존이 만든 새 위험): 종전에는 "커밋 성공 = 캐시 소거"가 곧 재커밋 방지였는데, 디스크 보존이 그 방어를 무력화한다(같은 preview로 두 번 반입되는 사고). 커밋 완료된 preview_id는 **복구 대상에서 제외**하고 409("이미 반입이 완료된 미리보기입니다")를 반환한다. 보존 파일 자체는 지우지 않아 **내려받기 탈출구는 유지**된다. 이 차단은 프로세스 메모리 기록이므로 재시작 후 같은 id로 의도적 재커밋을 보내면 복구되지만, 그때는 전 항목이 중복으로 표시되어 사용자가 알아챌 수 있다.
- **보존 정책**: `import/auto/`는 **최근 50건**만 유지(초과 시 오래된 것부터 삭제). git 제외 · **백업(F27) 대상 아님**(백업 = study.db + sources/) — 손실 시 대가는 "재변환 비용"뿐이다(원본은 백업된다). → 계획서 R18.
- `import/` 최상위(사용자가 직접 넣는 반입 JSON)와 **하위 폴더로 분리**해 사람이 넣은 파일과 앱 산출물이 섞이지 않게 한다.
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
| `GET /api/convert/{job_id}` | `{status: running/done/error, result_preview_id?}` — 완료 시 곧장 반입 preview로 연결. (S8: `progress`·`error_info` §4.11) **S14: `notes: string[]`(기본 `[]`) 추가** — 성공했지만 사용자가 알아야 할 **소표기**(예: "도면·과제 묶음(ZIP)도 함께 저장했습니다"). **문구는 서버가 완성해 내려주고 프론트는 그대로 나열한다**(포맷·분기 로직을 프론트에 두지 않는다 — 어댑터가 늘어도 렌더 코드 불변). 비어 있으면 아무것도 렌더하지 않는다 | S6·S14 |
| `POST /api/documents/{id}/regenerate` | `{reason}` — 문제 오류 신고 → claude CLI로 해당 문서만 재생성 잡 시작 (F30). convert 잡 큐 재사용(동시 1개). `{job_id}` 반환 | S6 |
| `GET /api/documents/{id}/regenerate/{job_id}` | `{status: running/done/error, draft?}` — 완료 시 재생성 초안(기존/신규 나란히 비교용 문서 필드 전체) | S6 |
| `POST /api/documents/{id}/regenerate/{job_id}/apply` | 초안 승인 → 기존 문서를 PATCH 방식으로 교체. **같은 문서 id·doc_no 유지** — attempts·오답노트·SRS 이력 보존. 미승인 초안은 폐기 가능(잡 TTL 만료 시 자동 폐기). 자동 덮어쓰기 금지(R7) | S6 |
| `POST /api/backups` · `GET /api/backups` · `POST /api/backups/{id}/restore` | 백업 스냅샷 (F27). `id`는 타임스탬프 문자열. restore는 확인 문구 필수 — body `{confirm: "RESTORE"}` 고정 문자열, 복원 전 자동 스냅샷 1개 생성 | S6 |

- 재생성(F30) 프롬프트 구성: **현재 문서 내용 + 신고 사유(reason) + (source_detail 있으면) 원본 출처 정보** — 원본 대조가 가능하도록(R7). 엔진은 R9 결정 그대로 claude CLI 서브프로세스(F23 인프라). S8부터는 §4.11의 이중 엔진 정책을 따른다.

### 4.11 LLM 엔진 관리 (S8 — F34 + F35 1단계 · **S13 — F40-③ `category_path?` · F40-④ `invalid_output`**)

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/llm/status` | 엔진 진단: `{cli: {installed, logged_in, last_success_at, last_error_kind}, api: {key_registered, key_suffix, last_success_at}, limit: {kind, resets_at} \| null, priority, fallback_policy}` | S8 |
| `POST /api/llm/api-key` | `{key}` — **즉석 연결 테스트**(초경량 호출) 성공 시에만 저장. 저장처는 루트 `secrets.json`(**DB/settings 금지** — 백업(F27)·git 제외 대상). 응답은 `{key_suffix}`(마지막 4자리)만 — 원문 키는 어떤 응답에도 미포함(write-only) | S8 |
| `DELETE /api/llm/api-key` | 키 삭제 | S8 |
| `POST /api/convert` 확장 | `{file 업로드}` **또는 `{url}`** (F35-1): url이면 서버가 다운로드(공개 자료, 크기 상한·content-type 화이트리스트·**사설/로컬 IP 차단(SSRF 방지)**) 후 동일 파이프라인. `engine` 선택 파라미터(`'auto'\|'cli'\|'api'`, 기본 auto=우선순위) — 폴백 "물어보기" 시 프론트가 `engine:'api'`로 재요청하는 계약 | S8 |
| `POST /api/convert` 확장 2 | **S13(F40-③)**: 선택 파라미터 **`category_path`**(예 `"품질경영기사/필기/2022년 2회"`) — 지정 시 서버가 프롬프트에 "모든 문항의 `suggest_categories`는 정확히 이 경로 하나로 고정" 지시를 넣는다. **사이트 반입(§4.13)의 지시 문자열 생성기를 공유**(중복 구현 금지 — 경로·라벨만 받는 형태로 일반화). 검증: 최대 5단계·단계당 60자·빈 단계 금지(위반 시 422). **자동 반입이 아니다** — preview의 제안을 고정할 뿐 확정은 사용자 승인(R7), 없는 노드 생성은 기존 commit `approve_categories` 계약 그대로 | S13 |

- **엔진 설정은 settings 재사용**: `llm.priority`(`'cli'\|'api'`, 기본 cli) · `llm.fallback`(`'auto'\|'ask'\|'off'`, 기본 **ask** — auto는 과금 동의 UI 통과 시에만 설정 가능) · `llm.api_model`(기본 `claude-sonnet-5` — 과금 부담 고려, 변경 가능). (**S15 예정**: 이 절의 `cli|api` 이항 계약은 §4.17이 엔진 레지스트리로 일반화한다 — `llm.priority`는 엔진 id 배열, status는 엔진 배열, legacy 값은 읽기 시 별칭 매핑. 이 절 서술은 S8~S14 시점 기준으로 보존.)
- **API 엔진**: anthropic Python SDK 직접 호출(키는 설정 화면에서 사용자가 등록한 secrets.json **단일 출처** — 환경변수·외부 프로필 자동 탐색 없음). convert/regenerate 프롬프트는 CLI 경로와 동일 템플릿.
- **오류 구조화**: convert/regenerate 잡 상태 응답에 `error_info` 추가 — `{kind: 'rate_limit'\|'auth'\|'not_installed'\|'timeout'\|'other', limit_kind?: 'session'\|'daily'\|'weekly'\|'model'\|'overall', resets_at?, message(사람이 읽는 한국어), action(다음 행동 안내), fallback_available: bool}`. (S10: kind에 `'parse_failed'` 추가 — 사이트 어댑터 파싱 실패, §4.13. **S13: `'invalid_output'` 추가 — 아래. S14: `'unsupported_format'` 추가 — qnet의 PDF 없는 게시물(ZIP·HWP), §4.13. S16: `'too_large'` 추가 — 추출·디코드 텍스트 길이 상한 초과(LLM 호출 전 차단·분할 권고), §4.18 ⑤.**) **CLI/API 원문 JSON은 사용자에게 노출 금지.**
  - **`alternatives`(프론트 대안 버튼 힌트, S10 신설)**: 값은 **`'url_import'` · `'file_import'`(S14 추가) · `'other_adapter'`(사문화 — 단일 어댑터라 서버가 더 내려보내지 않지만 값 자체는 남겨 둔다)**. `unsupported_format`·상류 실패 계열은 기본이 `['file_import','url_import']`(원본이 이미 `sources/`에 있으므로 **파일 반입이 첫 번째 행동**), `parse_failed`는 `['url_import']`가 기본. (**S16**: 이 기본값 서술은 **fetch 잡 기준** — **convert 잡(파일·URL 반입)에서 발생한 `unsupported_format`·`parse_failed`는 빈 배열**, 실패한 경로 자신을 대안으로 제시하지 않는다 — §4.18 ⑥.) 프론트는 **아는 값만 버튼으로 렌더하고 모르는 값은 무시**한다(전방 호환). CLI 429의 `result` 문자열에서 한도 종류·리셋 시각을 파싱한다.
- **`invalid_output`(S13 — F40-④, 잘못된 안내의 교정)**: LLM 출력이 완결된 JSON이 아닐 때(대개 문항이 많아 출력 상한에서 **잘림**) 지금은 `kind:'other'` + "잠시 후 다시 시도하세요"로 안내되는데, **같은 파일로 재시도하면 같은 실패**라 LLM 비용만 반복 소모된다. → 전용 kind로 분류하고 message "LLM 응답이 완결된 JSON이 아닙니다 — 출력이 중간에 잘렸을 수 있습니다"(비잘림이면 "올바른 JSON이 아닙니다"), action은 **잡 종류별**로 — 반입(convert·fetch)은 "원본을 과목·회차 단위로 나눠 올려 다시 변환해 보세요", 재생성(F30)은 "재생성 요청(사유)을 더 짧고 구체적으로 적어 다시 시도해 보세요". **엔진 교체는 권하지 않는다(S13 구현 확정)** — `API_MAX_OUTPUT_TOKENS`가 CLI·API 공통 상한이라 엔진을 바꿔도 잘림은 그대로이고, `fallback_available=false`라 [API로 재시도] 버튼도 뜨지 않는다(문구가 없는 버튼을 가리키지 않게 한다). **원문(잘린 출력·raw)은 응답에 싣지 않는다**(§4.11 원칙 — 로그에만). **서버측 PDF 분할은 하지 않는다**(라이브러리 의존 금지 — §4.13 비지원 포맷 정책과 같은 원칙).
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

### 4.12 일상 다듬기 (S9 — F36 · F37 · F38 + M6 이월 2건)

**신규·확장 엔드포인트**

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/srs/summary` | `{today_due, tomorrow_due}` — today_due = 오늘 큐 잔여 수, tomorrow_due = 내일까지 due인 카드 수(오늘 미소화 이월 포함). 둘 다 `srs.daily_limit` 상한 규칙 동일 적용. 용처: 복습 완료 화면 "내일 N개 예정"(F36-③), 홈 daily_start 위젯(F36-①) | S9 |
| `GET /api/dashboard` 확장 | 응답에 `today_review_minutes` 추가 — **대략치**: 큐 잔여 수 × 최근 30일 문항 풀이 시간 중앙값(표본 없으면 60초/문항). 분 환산은 **올림**, 큐>0이면 최소 1분(0분 표기 방지 — S9 검토 반영). daily_start 분량 예고용("복습 12 + Ch.3 이어하기 · 예상 25분") | S9 확장 |
| `GET /api/categories/tree?pipeline=1` | F37: 노드별 `stage_progress {concept:{done,total}, question:{done,total}, past_question:{done,total}}` 추가 — **노드+하위 트리 전체** 집계(§4.6 deep 원칙, 임의 깊이). 파라미터 없으면 기존 응답 그대로(불변). 커리큘럼 3단 진도·개수 칩의 데이터 원천 — **단일 패스 집계**(노드별 재귀 쿼리 금지) | S9 확장 |
| `GET /api/categories/{id}/study-track` 확장 | `deep=1`(하위 트리 문서 포함 — 정렬: 트리 순회(분류 sort_order) → 링크 sort_order) · `types=concept,question`(타입 필터). F37 개념 트랙 = `deep=1&types=concept,question`(인터리브 유지, 기출 제외) | S9 확장 |
| `POST /api/quiz/session` 확장 | `types` 파라미터(예: `["question"]`, `["past_question"]`) — 기존 mode·범위(하위 포함)와 교집합. F37 단계 ②③의 출제 경로. **채점·트랜잭션 불변 규칙 그대로**(정답·해설 미포함) | S9 확장 |
| `GET /api/tags` 확장 | item에 `rule_count` 추가 — 이 태그를 tag_query에서 참조하는 규칙 수(태그 관리자 "규칙 사용" 배지) | S9 확장 |
| `PATCH /api/tags/{id}` | `{name}` 이름 변경 — `document_tags`가 tag_id 참조이므로 UPDATE 한 번으로 전 문서 일괄 반영. 정규화(공백 제거·소문자) 후 기존 태그와 중복이면 409 + "병합을 사용하세요" 안내 | S9 |
| `DELETE /api/tags/{id}` | **미사용 태그만**(doc_count=0 · 규칙 미참조). 사용 중이면 409 — 정리는 병합으로 유도 | S9 |
| `GET /api/tags/similar` | 유사(오타 의심) 태그 쌍: `[{a:{id,name,doc_count}, b:{id,name,doc_count}, reason:'space'\|'case'\|'edit1'}]` — 정규화(공백 제거·소문자) 동일 또는 편집거리 1 이내. 개인 규모(태그 수백 개)이므로 O(n²) 전수 비교로 충분 — 인덱스·캐시 없음(YAGNI) | S9 |

**F37 stage_progress 판정 규칙 (DDL 없음 — 전부 파생값)**
- 집계 모수는 하위 트리 내 **고유 문서 기준(distinct document)** — 한 문서가 같은 서브트리의 여러 분류에 연결돼도 1개로 센다(이중 계산 금지).
- `concept` done = `study_progress.status='done'`(문서가 연결된 분류 기준 — 서브트리 내 어느 링크에서든 done이면 done, 하위 트리 합산).
- `question`·`past_question` done = **해당 문서에 활성 attempt 1회 이상**(정오 무관 — "풀었다"가 완료. 어느 화면에서 풀었든 인정).
- `flashcard`는 집계 제외. 단계 재개는 저장하지 않는다 — **next_stage = 첫 미완료 단계**를 프론트가 stage_progress에서 파생(개념 미완→개념, 개념 완료·문제 미완→문제, …, 전부 완료→done).

**F36 중 API가 필요 없는 것 (명시)**
- ⑤ 틀린이유 원탭: attempts 응답의 `review_note_id`로 기존 `PATCH /api/review-notes/{id}` 재사용.
- ⑧ 플래시카드 undo 1회: **판정 전송 지연** 방식 — 판정을 다음 카드 진입 시(마지막 카드는 세션 종료 시) 확정 전송, undo = 미전송 취소. 새 API·서버 롤백 없음(SM-2 오염 원천 차단).
- ⑥⑨는 settings 키 추가만: `quiz.auto_advance`(`'on'|'off'`, 기본 off — 정답 시 1.5초 자동 다음, 오답은 항상 정지) · `study.font_scale`(`'small'|'default'|'large'`, 기본 default — 문서 상세·학습 모드 본문 공통).
- F37 커리큘럼 내 문서 작성·수정: **새 API 없음** — documents POST/PATCH + links(§4.2) 재사용.

**M6 이월 ① — 검색 한국어 recall (trigram)**
- `GET /api/search` **요청·응답 계약 불변** — 내부 개선만. `documents_fts`를 `tokenize='trigram'`으로 재구축(Alembic: DROP → CREATE + 동기화 트리거 재생성 + 백필) → "제3정규형" 본문이 "정규형" 질의에 매칭(부분어 recall).
- 제약: trigram은 3자 미만 토큰 매칭 불가 — 질의 토큰 중 **3자 이상만 MATCH에 사용**, 전 토큰이 2자 이하면 `title/content LIKE` 폴백(최신순 정렬, 스니펫은 단순 발췌). answer 미인덱싱 원칙(불변 규칙 1) 유지.

**M6 이월 ② — 백업 복원 후 재시작 UX**
- API 계약 불변. `POST /api/backups/{id}/restore` 성공 직후 서버가 **SQLAlchemy `engine.dispose()`로 커넥션 풀 폐기**(이후 요청은 복원본으로 새 커넥션) + 복원본 대상 검증 쿼리 1회.
- 프론트: 복원 성공 시 **강제 리로드 모달**("복원 완료 — 앱을 다시 불러옵니다") → 확인 시 쿼리 캐시 폐기 + `location.reload()`. 모달에 "이상 동작 시 서버를 재시작하세요" 안내 유지(닫기 없이 리로드만 — stale 화면 조작 차단).

### 4.13 콘텐츠·동기 (S10 — F35 2단계 + F26 · S12 — 어댑터 3호 cbtbank·날짜 키 병합 · **S13** — 사설 어댑터(comcbt·cbtbank) 제거로 단일 어댑터화 · **S14** — qnet 공식 오픈API 실가동)

> **단계 구분(계획서 v0.17 재편)**: **S13 = 제거·단순화만**(제거 후 등록 어댑터 = qnet **스텁 1개**, `available:false` — 사이트 반입 탭은 "준비 중"). **S14 = qnet 오픈API 실가동**(서비스키·목록·상세·첨부). 아래 표·규칙에서 `S14` 태그가 붙은 항목은 **S13에서 구현하지 않는다** — 계약은 확정돼 있고 착수 시점만 뒤로 미뤘다(실측상 필기·필답형 미수록 → 후순위, 계획서 §14 F35-3 "실측 확정 사항").

**원칙(강제)**: 신규는 **수집기(어댑터)뿐** — LLM 정리·진행 가시화·미리보기·중복 감지·분류 자동 생성·승인 반입은 전부 기존 convert 잡 큐(§4.10·§4.11)와 import preview/commit(§4.3)을 재사용한다. **새 테이블·컬럼 없음**(근거는 계획서 §14 F35·F26 명세).

**S13 어댑터 구성 원칙(강제)**: 수집 대상은 **공식 오픈API 등 공개 배포가 허용된 경로만**이다 — 사설 사이트의 DOM을 겨냥한 어댑터는 두지 않는다(comcbt·cbtbank 제거, 근거·트레이드오프·기각 대안은 계획서 §14 F35-2 "제거 이력"이 단일 출처). **S13 이후 등록 어댑터는 `qnet` 하나** — 따라서 **어댑터 간 병합·우선순위 채택·대안 어댑터 재시도는 존재하지 않는다.** 단, **API 계약(응답 형태)은 유지한다**(아래 표의 "계약 안정성" 주석) — 프론트 변경 최소화 + 향후 공식 API 어댑터 추가 여지.

**신규·확장 엔드포인트**

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/fetch/adapters` | 등록 어댑터 목록 `[{id, name, priority, available, notice}]` — **S13: 원소 1개(`id:'qnet'`, `priority:1`) 고정**. **계약 안정성 결정(2026-07-27): 배열 구조를 유지한다** — ① 프론트는 이미 목록을 일반 렌더(어댑터별 분기 없음)라 단일 객체로 바꾸면 오히려 프론트 수정이 필요하고, ② 공식 오픈API를 제공하는 다른 기관 어댑터가 추가될 여지를 열어두며, ③ registry·라우터 구조를 그대로 둘 수 있다(제거 범위를 최소화). `priority` 필드도 유지(값 1 고정 — 정렬 의미만 남고 채택 경쟁은 없음). `notice` = 이용 고지 문구(개인 학습 전용·재배포 금지 + **커버리지 한계**: 실기 공개문제 위주, 필기 기출은 URL·파일 반입 안내). `available:false` = 서비스키 미등록·접속 불가 진단 시(**S13 종료 시점 = 스텁이라 항상 false + "준비 중" 안내**). **S14(구현 확정 — 예고대로)**: qnet 항목에 `key_registered`(bool)·`key_suffix?`(마지막 4자리) 추가 — `available` = **서비스키 등록 여부 반영**(미등록 시 false + notice "공공데이터포털 서비스키 등록 필요 — 설정 > 데이터". 기존 스텁 응답의 상위 호환 — 프론트 분기 불요). notice의 **커버리지 한계 문구는 S14에서 실측 기준으로 확정**("실기 작업형·도면 위주 — 필기·필답형은 파일·URL 반입") | S10·S13·S14 |
| `GET /api/fetch/certs?q=` | 자격증 검색 — 등록 어댑터 전체에 질의 후 **정규화 이름(공백 제거)으로 병합**: `[{name, sources: [{adapter, cert_ref}]}]`(S13: 어댑터가 하나이므로 `sources`는 항상 1건 — **응답 형태 유지**, 이름 정규화·중복 제거 로직은 남는다). 결과는 서버 메모리 캐시(TTL 24h — 반복 호출·쿼터 절약) | S10 |
| `POST /api/fetch/exams` | `{sources: [{adapter, cert_ref}], include_notices?: bool}` → **회차 목록**: `[{exam_key, label, adapter, exam_ref, also_on: [], refs, question_count?, imported, estimate, is_notice}]`. **S14 안내문 토글**: `include_notices`(기본 **false**)면 **안내문 게시물을 목록에서 뺀다**(조용한 삭제 아님 — 하단 "안내문 N건 보기" 토글이 `true`로 같은 요청을 다시 보낸다). 응답 항목의 **`is_notice`(bool, 기본 false)** 로 어느 항목이 안내문인지 표시 — `false`일 때는 항상 `is_notice:false`만 온다. **판정은 제목 텍스트만 사용하고 목록·판정 모두 같은 24h 캐시에서 파생되므로 토글에 드는 추가 API 호출은 0건**(상세 조회로 판별하지 않는다 — 쿼터 소모). **`exam_ref` = 어댑터 기준 회차 참조 — `fetch/import`에 `{adapter, cert_ref, exam_ref}`로 그대로 전달하는 계약**(certs의 `cert_ref`와 대응). **S13 단순화**: 어댑터가 하나이므로 **어댑터 간 병합·priority 채택 경쟁이 없다** — `also_on`은 **항상 빈 배열**, `refs`는 `{qnet: exam_ref}` 단일 항목(둘 다 **필드는 유지** — 프론트 렌더 코드 불변). `exam_key` = 어댑터가 산출한 회차 키. **S14에서 3형태로 확정**(실측 분포 date 1 / year 32 / unknown 271 — 목록 304건 기준): ① `'YYYY-N'`(회차 번호 확인 — 원칙) 또는 `'YYYY-MM-DD'`(제목에 날짜) → **폴더명 파생 가능** ② **`'YYYY'`(연도만 확인 — 예 "(2026년도)")** → **폴더명을 파생하지 않는다. 회차를 창작하지 않기 위함**(정렬에만 연도 사용) ③ `'qnet-{artlSeq}'`(연도조차 못 읽음) → 라벨 그대로 단독 항목. **②③은 `imported`가 항상 false이고 분류 경로를 만들지 않는다** — 반입 후 사용자가 직접 분류한다(추측 금지). `imported` = 해당 회차 분류 경로 존재 여부(파생 — 저장 안 함, 키→폴더명 파생 함수는 convert 분류 경로와 단일 공유. **파생 불가 키는 경로를 만들 수 없으므로 판정 자체가 false**). `estimate` = 예상 LLM 사용량(아래) | S10·S13·S14 |
| `POST /api/fetch/import` | `{adapter, cert_ref, exam_ref, exam_key?}` — **한 번에 1회차**(배치 없음). **`exam_key?`** = `fetch/exams`가 반환한 키를 그대로 되돌려 보내는 파라미터 — 서버가 수집 결과(FetchedExam/FetchedFile)의 exam_key를 이 값으로 덮어써 목록 표기·분류 경로·imported 판정을 일치시킨다. **S13: 단일 어댑터에서는 목록 키와 수집 키가 같아 사실상 항등 전달이지만, 계약·프론트 호출 형태를 유지하기 위해 파라미터를 남긴다**(미지정 시 어댑터 자체 키 — 동작 동일). **convert 잡 큐 재사용**(kind=`'fetch'`, 동시 1개, engine 파라미터·폴백 정책 §4.11 그대로) → `{job_id}`. 진행·결과 조회는 기존 `GET /api/convert/{job_id}` — `progress.phase`에 `'fetching'`(사이트 수집·이미지 다운로드) 신설, 완료 시 `result_preview_id`로 기존 반입 위저드 미리보기에 합류 | S10·S12 |
| `POST /api/fetch/qnet-key` | `{key}` — 큐넷 오픈API **서비스키 등록**(F34 `llm/api-key` 계약 미러): **즉석 검증**(getOpenQstList `numOfRows=1` 호출 — 에러 30/31이면 실패 사유 반환) 성공 시에만 저장. 저장처는 루트 `secrets.json`의 `qnet_service_key`(**DB/settings 금지** — 백업(F27)·git 제외, anthropic 키와 파일 공유 — 병합 저장으로 상호 훼손 금지). 응답 `{key_suffix}`만 — **원문 키는 어떤 응답·로그에도 미포함**(write-only, 요청 URL 로깅 시 serviceKey 마스킹) | S14 |
| `DELETE /api/fetch/qnet-key` | 서비스키 삭제 — 이후 qnet은 `available:false` 스텁 동작으로 복귀 | S14 |
| `GET /api/stats/streak` | F26: `{current_streak, best_streak, today: {questions, minutes, goal: {questions?, minutes?}, goal_met}}` — 전부 파생값(아래 규칙). 용처: 홈 스트릭 위젯(§5.1)·복습 완료 화면(§5.7) | S10 |
| `GET /api/stats/heatmap` 확장 | 항목에 `goal_met`(bool) 추가 — **목표가 하나라도 설정된 경우에만** 채움(미설정 시 필드 생략). 기존 필드·파라미터 불변(하위 호환). 판정은 `stats/streak`와 동일 함수 공유 | S10 확장 |

**어댑터 모듈 구조 (소스별 분리 — 외부 구조 변경 시 해당 모듈만 수정)**

```
backend/services/fetchers/
├─ base.py       # 공통 인터페이스: search_certs(q) / list_exams(cert_ref)
│                #   / fetch_exam(exam_ref, on_activity) → FetchedExam(구조 추출형) 또는 FetchedFile(원본 파일형)
├─ registry.py   # 어댑터 등록·HTTP 클라이언트(SSRF 검증·리다이렉트 제한·매직 바이트)·스로틀(2초)·robots 확인·목록 캐시(TTL 24h, 프로세스 메모리)
└─ qnet.py       # 큐넷 — S10~S13은 목록 스텁(available:false). S14: 공공데이터포털 오픈API(국가자격
                 #   공개문제 조회) 목록·상세 + 첨부 다운로드(FetchedFile — 아래 S14 노트)
                 #   ※ S13에서 comcbt.py·cbtbank.py 삭제(사설 어댑터 제거 — 계획서 §14 F35-2 제거 이력)
```

- 수집 결과 2형은 **인터페이스로 유지**: **`FetchedFile`**(원본 파일 — PDF 등) = F35-1과 동일하게 convert 투입(LLM이 구조 추출) — **S14 qnet이 사용하는 경로**. **`FetchedExam`**(구조 추출형) = `{cert_name, exam_key, exam_label, questions: [{no, stem, choices, answer?, explanation?, subject?, images: []}], note?(수집 URL·어댑터 id — FetchedFile과 출처 추적 계약 동일)}` — 구조화 텍스트로 프롬프트에 투입. **S13 시점에 FetchedExam을 쓰는 어댑터는 없다**(유일한 사용자였던 cbtbank 제거) — 인터페이스·이미지 저장 분기·프롬프트 직렬화는 **삭제하지 않고 유지**한다(공식 API가 구조화 문항을 주는 경우를 위한 계약이며, 제거해도 얻는 게 없고 되살리기 비용만 크다).
- **자료구조 필드(파이썬 dataclass — DDL 아님, 기본값 None)**: `ExamEntry.exam_date?`(`YYYY-MM-DD` — S13에서 **병합 자연 키 용도는 소멸**, 라벨·정렬 보조 정보로만 남음) · `FetchedQuestion.subject?`(과목 구분 — 구조화 텍스트에 "과목:" 줄로 직렬화, LLM 지시로 **태그 제안 소재**로만 사용. 분류 경로는 회차까지 — 기존 계약 불변).
- 두 경로 모두 최종적으로 **반입 JSON 규격(계획서 §8.2)으로 LLM 정리**(해설 보강·태그·검수) 후 preview 생성. `suggest_categories`는 어댑터가 확정한 경로를 프롬프트에 **강제 지시** — 분류 자동 생성은 기존 commit의 경로 생성 재사용. **경로 3단계는 exam_key + level_hint에서 파생**: `YYYY-N` → `"자격증명/{level_hint}/YYYY년 N회"`, 날짜형 `YYYY-MM-DD` → `"자격증명/{level_hint}/YYYY년 M월 D일"`(앞자리 0 제거 — S14 qnet 공개문제는 `level_hint='실기'`가 기본). **S14 확정: `YYYY`(연도만)·`qnet-{artlSeq}`(식별 불가)는 폴더명을 파생하지 않는다** — 파생 함수가 `None`을 돌려주고, 그러면 **분류 경로 강제 지시 없이 반입**된다(회차 창작 금지 > 자동 분류 편의). **S13(F40-③)부터 이 경로 규칙은 파일·URL 반입의 `category_path`(§4.11)와도 같은 형태를 쓴다** — 수동 지정 경로는 사용자가 직접 적으므로 키→폴더명 파생을 거치지 않는다. **키→폴더명 파생 함수는 imported 판정(fetch_service)과 convert 분류 경로가 단일 공유**(불일치 금지).
- **이미지(그림 문제)**: FetchedExam 경로에서 어댑터가 다운로드(스로틀 동일 적용)해 `sources/images/`에 저장(R2 관례), content에 Markdown 링크 삽입 — 링크는 **절대 경로 `/images/{fname}`**(상대 경로는 SPA 라우트에서 깨짐 — S12 검토 실측). 서빙은 `GET /images/{filename}` — `sources/images/`를 **읽기 전용** FileResponse(파일명 정규식 검증으로 경로 탈출 차단, 부재 시 404, SPA 폴백보다 먼저 — main.py, `/manual` 전례). **원본 불변 규칙 그대로.** (S14 qnet은 PDF 첨부 경로라 이미지가 PDF에 내장 — 이 분기는 현재 사용 어댑터가 없지만 **이미 반입된 이미지의 서빙(`GET /images/{filename}`)은 계속 필요**하므로 삭제 금지: 과거 수집 이미지는 전량 보존한다.)
- **출처 추적**: `documents.source_detail` = "YYYY년 N회 M번", `sources.note`에 수집 URL·어댑터 id 기록.
- **DOM 셀렉터·페이지 구조는 이 문서에서 확정하지 않는다** — 구현 시 실측 확인(stage-10 체크리스트 명시). 설계가 확정하는 것은 인터페이스·오류 처리·예의 규칙뿐.

**구현 실측 노트 (2026-07-25 · S12 추가 2026-07-26 · **S13 정리 + S14 오픈API 실측 2026-07-27** — 추측 셀렉터 배제 원칙에 따른 확정 사항)**
- **[제거됨 — S13] comcbt(M10)·cbtbank(M12) 실측 노트**: 두 사설 어댑터는 **S13에서 코드와 함께 삭제**됐다(사설 사이트 DOM 겨냥 수집 코드의 공개 배포 중단 — 근거·트레이드오프·기각 대안은 계획서 §14 F35-2 "제거 이력"이 단일 출처). 사이트별 DOM·URL 규칙 세부는 이 문서에서 **삭제**한다(재도입 시 그대로 되살아나는 것을 막기 위함). 남길 교훈만 요약: ① 정적 HTML에 본문이 없는 사이트는 첨부 PDF 우회가 유일한 길이었고(FetchedFile), ② 구조화 HTML 사이트는 FetchedExam 경로를 처음 실사용했으며, ③ 어댑터 격리 덕에 두 어댑터의 도입·제거 모두 **fetch API 계약을 바꾸지 않았다**(R14 설계의 검증). 이미 반입된 문서·`sources/` 원본·수집 이미지는 **전량 보존**한다.
- **qnet**: robots.txt가 표준 응답이 아닌 점검 안내 HTML이며, 공개문제 카탈로그가 JS 포털이라 정적 목록을 실측할 수 없음 → `search_certs`/`list_exams`는 **빈 목록 + `available:false` 안내**로 구현(추측 셀렉터 금지). `fetch_exam`은 공개 파일 **직접 URL 한정**으로 F35-1 다운로드 경로 재사용 — **포털 구조가 확정되면 qnet.py 목록 부분만 채우면 자동 작동**(모듈 격리 원칙, R14. S13에서 오픈API로 실현).
- **qnet(S14 — 오픈API 스펙 실사본 확보 + **실호출 실측** 2026-07-27, 위 스텁의 해소 경로. **S13에서는 스텁 유지**)**: ※ **실측 확정 사항(numOfRows 50 상한/930 · 목록 304건 중 메타 전 필드 빈값 43건 · 첨부 PDF14·ZIP4·HWP0 · 필기·필답형 미수록(품질경영기사 `totalCount 0`) · 제목 형식 불규칙 + 안내문 게시물 혼입)은 **계획서 §14 F35-3 "실측 확정 사항"이 단일 출처**이며, 구현 규칙은 `stage-14-qnet-openapi.plan.md` 체크리스트에 있다. 아래 계약은 그 전제 위에서 읽는다. 공공데이터포털 **"국가자격 공개문제 조회 서비스"** `http://apis.data.go.kr/B490007/openQst`(REST GET, `serviceKey` 쿼리 인증, `dataFormat` XML/JSON) — 포털 역설계 없이 공식 계약으로 목록·상세를 채운다(계획서 §14 F35-3). `getOpenQstList`(필수 serviceKey·**`numOfRows` — 실측 상한 50 고정**(초과 시 `resultCode 930`)·pageNo(전체 순회 7페이지 내외)·dataFormat·`qualgbCd` — **T(국가기술자격)만 사용**, 선택 `jmNm` 종목명 검색) → items: `artlSeq`(게시물 ID)·title·regDttm·seriesCd/Nm·jmCd/jmNm + totalCount. `getOpenQst`(상세 — qualgbCd·artlSeq) → title·contents(HTML clob — **사용하지 않음**, 첨부가 정본)·`fileList[]{fileNm, fileSn, fileUrl}`. **cert_ref = jmCd, exam_ref = artlSeq**(어댑터 내부 의미 — 계약상 불투명 값, S10의 직접 URL exam_ref는 목록 스텁이라 발급 이력 없음 → 하위 호환 부담 없음). exam_key는 게시물 제목에서 연도·회차 파싱(**실측 표본 5종이 계획서 §14 F35-3에 고정돼 있다 — 접두어 `[공개문제]`/`[문제공개]`/없음, 괄호 안 `YYYYMMDD`/`YYYY년도`/없음. 표본 밖 형식을 추측하지 말 것**, 식별 불가 게시물은 **라벨 그대로 단독 항목**으로 노출하고 분류 경로는 회차 폴더를 만들 수 없으므로 사용자 확인에 맡긴다), 실기 공개문제는 `level_hint='실기'`. **`fileUrl`은 JWT 토큰 URL·유효 1시간(에러 941)** — 상세 조회와 다운로드를 같은 잡에서 즉시 연속 수행(목록·캐시에 fileUrl 저장 금지). 파일 호스트 `openapi.hrdkorea.or.kr`·API 호스트 `apis.data.go.kr` SSRF 허용 목록 추가(사설/루프백 차단·50MB 상한·2초 스로틀 유지 — 30 TPS 대비 과잉 여유지만 일관성 유지). **HWP 정책·커버리지 한계(실기 위주 — 필기 CBT 기출 비공개)·쿼터(일 1,000건, 24h 캐시로 절약)는 계획서 §14 F35-3이 단일 출처.** 오픈API 에러코드(22 쿼터 초과·30/31 키 오류·941 토큰 만료)는 사람 말 매핑(원문 XML/JSON 노출 금지).
- **qnet(S14 — 구현 완료 확정 사항, 2026-07-27. 위 계약이 실제로 어떻게 굳었는지)**:
  1. **전 목록 실측 재확인**: `numOfRows=50` × **7페이지 = 304건**, **930 에러 0건**. 종목 버킷 **241개**. 메타 전 필드 빈값 **42건**(지시서 실측 시점 43건 — 데이터 갱신분) — **가짜 종목 0건**이고 **제목 검색으로 노출되며 반입까지 가능**하다. 이 경로의 `cert_ref`는 `title:…` 형태이고 **분류 경로 자동 생성은 하지 않는다**(종목명을 모르므로 폴더 최상단을 지어낼 수 없다). 안내문 게시물 **15건**은 기본 숨김(`include_notices=true`로만 노출).
  2. **"검색 결과 0건"은 오류가 아니다**: "품질경영기사" 검색 = **HTTP 200 + 빈 배열**(실측). 커버리지 한계 문구는 어댑터 `notice`에 **고정 노출**하고, 0건 화면은 그 notice와 같은 취지로 안내한다. **이 정상 0건과 상류 실패(쿼터·키 오류)를 구분하기 위해 후자는 502로 나간다** — §3 상류 실패 규약.
  3. **성공 소표기 = `notes`**: pdf+zip 동시 보유 게시물은 PDF를 대표로 삼고 ZIP도 `sources/`에 저장한 뒤 `notes`에 완성된 한국어 문장 1건을 담는다(§4.10). 프론트는 나열만 한다.
  4. **검증 상태(정직하게 기록)**: ① **첨부 다운로드 이후 convert→미리보기 구간은 S14 검토(2026-07-27) 라이브 반입으로 완결 확인 — 해소.** 봉제기능사(artlSeq 5253924) 반입 잡이 `fetching→…→preview_building`을 거쳐 done, 미리보기·`suggest_categories` 생성(상세 조회·첨부 다운로드가 같은 잡에서 LLM 이전 연속 수행됨도 확인). ② **941(fileUrl 토큰 만료) 재시도 경로는 실제 발생을 재현하지 못했다**(코드 경로·단위 테스트만 — 상세 재조회 1회 재시도. 다음 실사용에서 확인).
  5. **알려진 한계**: 안내문 판정은 **접두어 없는 게시물 한정**이라 `[공개문제] …관련 안내`처럼 **접두어가 붙은 안내성 게시물은 목록에 남는다**. 실측상 이런 게시물은 전부 ZIP 전용이라 반입 시 `unsupported_format` 안내로 귀결된다(원본은 저장됨) — 제목 규칙을 더 공격적으로 넓히면 진짜 공개문제를 숨길 위험이 커서 **현 판정 범위를 유지**한다.

**수집 예의 — 강제 조항 (위반 구현 금지)**
0. **대상 제한(S13 신설)**: 어댑터는 **공식 오픈API 등 공개 배포가 허용된 경로만** 대상으로 한다 — 사설 사이트 DOM을 겨냥한 수집기는 추가하지 않는다(계획서 §14 F35-2 제거 이력). 대상 은닉(도메인 난독화 등)은 **금지** — 은닉은 정당성을 만들지 못한다(기각된 대안).
1. **robots.txt 존중**: 수집 전 확인(캐시 24h), 비허용 경로는 `available:false`·수집 거부 + URL 반입(F35-1) 대안 안내.
2. **요청 간격**: 사이트별 **최소 2초**(전역 스로틀 — 목록·문항·이미지 요청 전부 포함), 오류 시 지수 백오프. 병렬 요청 금지(잡 큐 동시 1개와 일관).
3. **User-Agent 명시**: `StudyHub-Personal/1.0` (F35-1 관례 유지).
4. **개인 학습 전용·재배포 금지**: 실행 전 확인 스텝(§5.9)에 고지 문구 고정 노출. 내보내기·공유 기능에 수집물 예외 취급 없음(재배포 기능 자체를 만들지 않음).
5. **로그인/CAPTCHA 필요 사이트는 범위 외** — 우회 코드 금지.
6. **실행 전 예상 LLM 사용량 안내 필수**: `estimate = {questions_assumed(문항 수 — 목록에서 미상이면 60 가정 표기), approx_input_tokens(최근 완료 convert 잡의 문항당 평균 토큰 이동 평균 — 표본 없으면 문항당 600토큰 가정), assumed(bool — 가정치 여부)}`. §4.11 한도 기억 경고와 함께 확인 스텝에서 표시.

**회차 목록 구성 (S13 재작성 — 단일 어댑터. M10~M12의 다중 어댑터 병합 규칙은 폐지)**
- **어댑터 간 병합·우선순위 채택·대안 어댑터 재시도 없음.** `fetch/exams`는 qnet이 돌려준 회차 목록을 그대로 항목화한다 — `adapter:'qnet'`, `also_on: []`(항상 빈 배열), `refs: {qnet: exam_ref}`. 우선순위(priority) 필드는 형태 유지용이며 채택 경쟁에 쓰이지 않는다.
  - *폐지된 규칙(참고 — 되살리지 말 것)*: 시험 날짜(`exam_date`) 자연 키 병합 · 대표 exam_key 선정(회차 번호 보유 키 우선) · priority 최소 채택(qnet>cbtbank>comcbt) · `level_hint` 동일 항목끼리만 병합. 전부 **어댑터가 둘 이상일 때만 의미**가 있었고, 사설 어댑터 제거(계획서 §14 F35-2)로 근거가 사라졌다.
- **exam_key 형식과 폴더명 파생은 유지**: `YYYY-N` → "YYYY년 N회", 날짜형 `YYYY-MM-DD` → "YYYY년 M월 D일"(회차 번호 미상 폴백). **S14 추가 2형태(`YYYY`·`qnet-{artlSeq}`)는 폴더명 미파생**(위 §4.13 exams 행) — 정렬은 연도 튜플, 식별 불가는 목록 맨 아래(안정 정렬로 원래 순서 유지). **키→폴더명 파생 함수는 `imported` 판정(fetch_service)과 convert 분류 경로가 단일 공유**(불일치 금지 — 이 규칙은 변경 없음).
- **정렬**: 최신 회차 우선 — 문자열 정렬이 아니라 (연도, 월, 일/회차) **수치 튜플**로 비교한다(`YYYY-N`·`YYYY-MM-DD` 혼재 대응 — S12 검토 지적, 단일 어댑터에서도 유효하므로 유지).
- 회차 식별 불가 항목(제목에서 연도·회차를 못 읽는 게시물)은 **라벨 그대로 단독 항목**으로 노출(추측 금지 — 병합이 없으므로 "병합 불참" 개념 자체가 사라졌다).
- **S14 실측 대응 2건(계약 수준)**: ① **메타 빈값 방어** — `jmCd`/`jmNm`이 빈 문자열인 게시물(실측 304건 중 43건 — **S14 구현 시 재실측 42건**, 데이터 갱신으로 증감함)은 **종목 목록에 버킷을 만들지 않는다**(가짜 자격증 생성 금지). 대신 질의 문자열이 title에 포함되면 노출한다 — 조용히 사라지지도, 목록을 오염시키지도 않게. 빈 문자열과 `None`은 **정규화 함수 1개로 동일 취급**. ② **안내문 게시물 필터** — 공개문제가 아닌 안내·집행 공지가 섞여 있으므로 **제목 텍스트만으로** 판정해 기본 숨김 + "안내문 N건 보기" 토글로 노출(상세 조회로 판별하지 않는다 — 쿼터 소모).
- 문서 단위 중복은 별도 처리 불필요 — 기존 preview 중복 감지(제목+내용 해시, §4.3)가 그대로 작동한다.

**파싱 실패 처리 (F30 연동)**
- 회차 단위 실패(목록·응답 구조 해석 불가): 잡 실패 + `error_info {kind:'parse_failed', message:"공개문제 응답 구조가 변경되었을 수 있습니다", action: **URL 반입(F35-1)·파일 반입** 안내, fallback_available}` — 원문 HTML/XML/JSON 노출 금지(§4.11 원칙 동일). **S13: 대안 어댑터 재시도 안내는 삭제**(단일 어댑터 — 폴백은 URL·파일 반입뿐).
- **비지원 포맷(S14 — qnet 비지원 포맷 정책, 계획서 §14 F35-3)**: 첨부에 LLM 투입 가능한 PDF가 없으면 원본을 sources/에 저장한 뒤 잡을 `error_info {kind:'unsupported_format', …}`으로 종료 — **포맷별 문구 분기(실측: 실제 대상은 HWP가 아니라 ZIP)**: **ZIP** = "도면·과제 파일 묶음입니다 — 압축을 풀어 PDF/이미지를 파일 반입하세요", **HWP** = "한글에서 PDF로 변환 후 파일 반입", 그 외 = 일반 문구. PDF와 ZIP을 함께 가진 게시물은 PDF를 대표로 삼고 ZIP도 저장한다 — **조용한 스킵 금지**(목록 시점엔 포맷 미상 — fileList는 상세 전용·쿼터 소모). 쿼터·키·토큰 오류(22·30/31·941)는 각각 사람 말 메시지로 분류(941은 상세 재조회 1회 내부 재시도 후).
- 문항 단위 경미 결함(보기 누락 등): preview 오류 항목으로 표기(기존 규칙 — 커밋에서 자동 제외).
- 반입 후 발견된 내용 오류: 기존 **F30 오류 신고·재생성** 경로(§4.10) — 신고 사유 + source_detail(수집 출처)로 재생성.

**F26 목표·스트릭 파생 규칙 (DDL 없음 — 근거는 계획서 §14 F26 명세)**
- **목표 = settings 키 2개**: `goal.daily_questions` · `goal.daily_minutes`(양의 정수, 미설정·0 = 목표 없음. settings GET/PUT 재사용 — 새 API 없음).
- **활동일** = 히트맵과 동일 모수(attempts + 개념 완료(`study_progress.completed_at`)). `current_streak` = 오늘 활동 있으면 오늘 포함 연속 일수, 오늘 없으면 **어제까지의** 연속 일수(하루가 끝나기 전에 스트릭을 끊지 않는다). `best_streak` = 전체 이력 최장(전수 스캔 — 개인 규모 충분).
- **today**: `questions` = 오늘 attempts 수(정오 무관), `minutes` = 오늘 `attempts.time_spent` 합 ÷ 60 올림 — **문제 풀이 시간 기준**(개념 열람 시간은 미측정, 한계 명문화). `goal_met` = 설정된 목표 항목 **각각 모두** 충족(AND).
- **스트릭은 목표와 무관**(활동 기준) — 목표 변경이 과거 스트릭을 재해석하지 않는다. 반면 heatmap `goal_met`은 **현재 목표로 과거를 재평가**하는 파생값(목표 이력 저장 안 함 — YAGNI).

### 4.14 시험 직전 도구 (S11 — F25 실전 모의고사 + F16 D-Day 복습 강도 조절)

**원칙(강제)**: **새 테이블·컬럼 없음** — 모의고사 리포트·이력은 전부 **attempts 파생**(mode=`'exam'` + 배치 공통 `answered_at` = 런 키), D-Day 강도 조절은 SRS **큐 구성 계층**만 손댄다(`services/sm2.py` 알고리즘·`srs_cards` 저장값(EF·interval·due_date)은 불변). 근거는 계획서 §14 F25·F16 명세.

**신규·확장 엔드포인트**

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `POST /api/exam/session` | 모의고사 구성. 요청 `{subjects: [{category_id, count?}], types?, order?: 'random'(기본)\|'sequential', time_limit_minutes?, cut?: {subject_min, pass_avg}}` — 과목 = 요청된 분류 노드(각각 **하위 트리 전체**에서 출제, §4.6 deep 원칙 — 어느 노드를 과목으로 삼을지는 화면 §5.12가 시험 노드의 직계 자식 체크리스트로 위임). 출제 자격 판정·타입 필터는 quiz_service 재사용(활성 문서·question/past_question, `types` 미지정 시 둘 다). `count` 미지정 = 해당 범위 전체(과목당 상한 200). 응답에 **정답·해설 절대 미포함**(불변 규칙 1 — quiz/session과 동일). **서버는 세션을 저장하지 않는다**(무상태 — 제출 요청이 전부 갖고 온다) | S11 |
| `POST /api/exam/submit` | **일괄 제출 채점** — 시간 종료·[제출] 시 1회 호출. 요청 `{answers: [{document_id, subject_category_id, my_answer(미응답=null), time_spent?}], cut?, elapsed_seconds?}`. 서버가 전 문항 채점(단건 attempts와 **같은 채점 코어** 공유 — 아래) 후 문항마다 attempts INSERT(mode=`'exam'`, category_id=과목 노드, **배치 공통 answered_at**) + 오답 시 오답노트 생성/재사용 + SM-2 갱신 + study_progress — **배치 전체가 한 트랜잭션**(불변 규칙 2 — 중간 실패 시 전무). 응답 = 리포트(아래 — **제출 후이므로 정답·해설 공개 허용**, attempts 단건 응답과 동일 원칙) | S11 |
| `GET /api/exam/history?limit=20` | 응시 이력 — **파생값**(attempts mode='exam'을 answered_at으로 그룹, 저장 없음). 배열 반환(페이지네이션 없음 — limit 절단, srs/today 전례). 합격 재평가는 **기본 컷(40/60) 고정**(당시 컷 미저장 — 한계는 계획서 R15) | S11 |
| `GET /api/srs/today` 확장 | F16 — D-Day 부스트 반영 큐(아래 규칙). item에 `ahead`(bool — 선행 복습 카드, D≤7에서만 등장, 기본 false) 추가. 미발동 시 기존 응답·순서 완전 불변 | S11 확장 |
| `GET /api/srs/summary` 확장 | 발동 시에만 `dday_boost` 객체 추가: `{category_id, name, exam_date, d_day, multiplier, effective_limit}` — 미발동 시 필드 생략(하위 호환, S10 `goal_met` 전례). `today_due`·`tomorrow_due`는 유효 상한 기준으로 산출 | S11 확장 |

**F25 모의고사 규칙 (전부 파생 — DDL 없음)**

- **과목 출처 = categories 트리**: 별도 "과목" 개념을 만들지 않는다. 화면(§5.12)이 시험 노드(예: "정보처리기사/필기")의 **직계 자식 체크리스트**로 과목을 고르게 하고, API는 분류 id 목록만 받는다 — 직계 자식에 과목·회차 노드가 혼재해도(F35 반입이 회차를 필기 밑에 만듦) 사용자 선택으로 해소. **회차 모의** = 회차 노드 1개만 선택(단일 과목·전체 문항·`sequential`이 화면 기본값).
- **채점 코어 공유**: attempt_service의 단건 채점(정규화 비교·평균시간/직전오답 기반 q 매핑·오답노트·진도·SM-2)을 **커밋 없는 공용 함수로 분리**해 단건(quiz)·배치(exam)가 같은 규칙을 쓴다(srs_service.apply_sm2 전례). 채점 규칙 이원화 금지. 기존 `POST /api/attempts` 동작·응답은 불변.
- **미응답(null) = 오답**: attempts 기록(is_correct=0) + 오답노트 생성(몰라서 비운 것도 복습 대상) + SM-2 q=1. 기존 정규화 채점이 빈 답을 자연히 오답 처리.
- **점수·합격 판정**: 과목 점수 = `round(100 × 정답 / 문항수)`. 과락 = 점수 < `subject_min`(기본 **40**). 총점 = 과목 점수 **단순 평균**(문항 수 가중 없음 — 국가기술자격 관례, 반올림). 합격 = 전 과목 비과락 **AND** 총점 ≥ `pass_avg`(기본 **60**).
- **합격선(cut)의 출처 = 요청 파라미터**: 기본 40/60(국가기술자격 표준)을 화면이 채워 보내고 실행 시 조정 가능 — settings 저장 없음(전 국가기술자격 공통 표준이라 기본값으로 충분, YAGNI. 시험별 컷 프리셋은 실수요 확인 후 — R15).
- **타이머 = 프론트 주도**: 개인용 로컬 앱 — 서버 검증은 과설계(방어 대상이 자기 자신). `time_limit_minutes` 미지정 시 서버가 `ceil(총 문항 × 1.5분)`(필기 관례) 계산해 응답에 에코, 카운트다운·시간 초과 자동 제출은 프론트 책임(§5.12). `elapsed_seconds`는 리포트에 기록용 에코만.
- **검증**: `subject_category_id`는 해당 문서가 그 과목 서브트리에 연결된 경우만 허용(아니면 422 VALIDATION_ERROR). 존재하지 않는 문서·비활성 문서 포함 시 422. 전 과목 출제 문항 0이면 세션 생성 422. 0문항 과목은 세션 응답에서 제외 + `warnings`.
- **attempts 기록 맥락**: `category_id` = **과목 노드**(가장 구체적 맥락 — "문서+맥락 이중 기록" 원칙 그대로). 덕분에 과목별 점수는 조회 시 category_id 그룹만으로 재계산되고, 기존 약점 분석·시험별 통계에도 그대로 합류한다. history의 시험 라벨 = 과목 노드들의 공통 부모 경로 파생(분류가 나중에 삭제되면 "(삭제된 분류)" 표기).

`exam/session` 응답 예 (items 원소 = quiz/session의 `QuizQuestionOut` 재사용 — 정답·해설 없음):
```json
{
  "time_limit_minutes": 90,
  "cut": { "subject_min": 40, "pass_avg": 60 },
  "order": "random",
  "total_count": 60,
  "warnings": [],
  "subjects": [
    { "category_id": 12, "name": "소프트웨어 설계", "requested": 20, "count": 20,
      "items": [ { "document_id": 317, "doc_no": "DOC-0317", "type": "past_question",
                   "title": "…", "content": "…", "choices": ["…","…","…","…"], "difficulty": 3 } ] }
  ]
}
```

`exam/submit` 응답(리포트) 예:
```json
{
  "taken_at": "2026-07-26T14:02:11",
  "passed": false,
  "cut": { "subject_min": 40, "pass_avg": 60 },
  "total": { "score": 58, "correct": 35, "count": 60 },
  "elapsed_seconds": 4310,
  "subjects": [
    { "category_id": 12, "name": "소프트웨어 설계", "score": 35, "correct": 7, "count": 20, "failed": true }
  ],
  "results": [
    { "document_id": 317, "subject_category_id": 12, "is_correct": false, "my_answer": "1",
      "answer": "2", "explanation": "…", "review_note_id": 88 }
  ]
}
```
- `taken_at` = 런 키(배치 공통 answered_at, ISO) — history의 그룹 키와 동일 값.
- `exam/history` item = `{taken_at, label(공통 부모 경로), passed(기본 컷 재평가), total{score, correct, count}, subjects[{category_id, name, score, failed}]}`.

**F16 D-Day 복습 강도 조절 규칙 (큐 구성 계층 — sm2.py·srs_cards 저장값 불변)**

- **발동 조건**: `settings:srs.dday_boost`(`'on'|'off'`, 기본 **on**) AND `categories.exam_date` 중 **0 ≤ d_day ≤ 14**가 존재(지난 날짜 제외). **임의 D-Day(`ddays.custom`)는 대상 아님** — 분류 서브트리가 없어 범위 우선·선행 복습이 정의되지 않는다(명문화).
- **① 유효 상한 확대**: 가장 임박한 시험의 d_day ≤ 7 → `ceil(srs.daily_limit × 2)`, 8~14 → `ceil(× 1.5)`. **큐 구성·개수 산출(dashboard `today_review`)·`srs/summary`가 같은 유효 상한 함수를 공유**(수치 불일치 금지).
- **② 임박 범위 우선**: 큐 정렬 우선순위 확장 — **미해결 오답노트(기존 1순위 유지)** > **임박 시험 서브트리 소속 카드**(문서가 해당 서브트리 분류에 연결) > 기한 초과 오래된 순. 여러 시험이 임박이면 서브트리 **합집합**이 우선 대상, 배율(①)은 최소 d_day 기준.
- **③ 선행 복습(D≤7만)**: due 도래 카드로 유효 상한이 안 차면, 임박 시험 서브트리의 `due_date > 오늘` 카드를 due 오름차순으로 남는 자리에 채운다(item `ahead:true`) — **시험 이후로 잡힌 카드를 시험 전에 한 번은 보게** 하는 장치. 저장된 due_date는 건드리지 않고, 풀이 시점에 정상 SM-2 갱신만 일어난다(Anki "review ahead"와 동일 원리).
- 시험이 지나면 발동 조건이 저절로 해제(전부 날짜 파생 — 원복 코드 불요). 미발동·토글 off 시 기존 큐와 완전 동일.

### 4.15 도움말 (S12 — F39 사용자 매뉴얼 통합)

**원칙(강제)**: `docs/manual/user-manual.html` **원본 파일이 단일 출처** — 빌드 복사·프론트 번들 포함 없음(문서 갱신 = 서버 재시작 없이 새로고침만으로 반영). **읽기 전용 서빙** — `docs/manual/`을 쓰거나 수정하는 코드는 금지(`sources/` 원본 불변 규칙과 동일 정신). DDL·저장·상태 없음.

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /manual` | `docs/manual/user-manual.html`을 `FileResponse`(`text/html; charset=utf-8`)로 서빙 — **`/api` 밖의 HTML 문서 경로**(JSON API 아님). 파일 없으면 404 — 본문은 전역 예외 처리의 §3 포맷 JSON을 따른다(별도 텍스트 포맷을 만들지 않음, 2026-07-26 검토 반영). **main.py 정적 서빙 블록에 직접 등록**(전용 라우터 과설계 — 엔드포인트 1개)하되 **SPA 폴백(catch-all)보다 먼저 매칭**되어야 한다 | S12 |

- 매뉴얼은 자기완결 HTML(인라인 CSS, 토큰 팔레트·`prefers-color-scheme` 다크 지원 내장) — **새 탭 열람이 정본 경로**(§5 공통 레이아웃·§5.11 진입점). in-app 렌더러·iframe 임베드·검색은 만들지 않는다(YAGNI — 자체 목차 보유).
- **한계 명문화**: 새 탭은 앱의 수동 테마 선택(localStorage `theme`)과 동기화하지 않는다 — 시스템 테마(`prefers-color-scheme`)만 추종(매뉴얼이 자체 지원, 허용된 한계).

### 4.16 앱 버전 확인 (배포 후 열려 있는 탭 갱신)

**문제(2026-07-26 실사용)**: 서버를 재시작하고 프론트를 새로 빌드해도 **이미 열려 있는 탭은 옛 JS를 계속 실행**한다 — 사용자가 직접 새로고침하기 전까지 화면만 구버전이고 API 호출만 새 서버로 나간다("새로고침 이후에 되고 있어"). 배포 빌드를 FastAPI가 그대로 서빙하는 구조(§1)의 필연적 결과다.

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `GET /api/app-version` | `{asset}` — 서버가 지금 서빙하는 메인 번들 파일명(`dist/index.html`에서 파싱, 예 `index-BvyMTJdl.js`). dist가 없으면 `null` | S12 후속 |

- **판별 근거 = 번들 파일명 해시**: 빌드마다 파일명이 바뀌므로 별도 버전 파일·빌드 스탬프·SW 버전 관리가 필요 없다. 탭은 자기 `<script src>`에서 실행 중인 파일명을 읽어 서버 값과 비교한다.
- **동작**: 불일치 시 ① 이 서버 빌드로 아직 새로고침한 적 없으면 **자동 1회 새로고침**(sessionStorage 가드) ② 이미 새로고침했는데도 불일치가 남으면(비정상) 무한 새로고침 대신 **배너 + [새로고침] 버튼**. 점검 시점은 앱 마운트 · 창 포커스 · 60초 주기, 서버 응답 실패는 조용히 무시(다음 주기 재시도).
- **범위 밖**: 서비스 워커 버전 관리·프리캐시 목록 갱신은 건드리지 않는다(현행 network-first 유지 — 서버가 살아 있으면 항상 최신을 받고, 꺼져 있을 때만 캐시 폴백).

### 4.17 멀티 벤더 LLM 엔진 — 레지스트리·변환 신뢰 게이트 (S15 — F41. **계약 확정 2026-07-28, 착수 게이트 G3 해소분**)

> 근거: Codex CLI 격리 PoC 실측(2026-07-27, `codex_engine_test\results\SUMMARY.md` v2 — 조건부 GO)과 그 §5 요구사항 7건. **이 절은 계약 확정본이고 구현은 stage-15 잔여 게이트(G2 품질 재실험) 통과 후** — 구현 중 이 계약과 어긋나는 필요(특히 DDL)가 발견되면 임의 확정 없이 착수 중단 후 보고한다(stage-15 DoD 5).
> 원칙 재확인: 미리보기 승인 없는 자동 반입 금지(R7 — 아래 신뢰 게이트는 그 기계적 보강) · 오류 원문 노출 금지(`error_info` 구조화, §4.11) · 자격증명은 secrets.json/전역 홈 단일 출처(DB·settings 금지).

**① 엔진 레지스트리 (F34 `cli|api` 이항 가정 해체)**

- **엔진 id**: `'claude-cli' | 'claude-api' | 'codex-cli'`. 표시명: `Claude CLI` · `Claude API` · `Codex CLI`.
- **엔진 항목 인터페이스**(`llm_engine_service` 내부 레지스트리 — 코드 계약): 항목마다
  `id` · `label`(표시명) · `billing`(`'subscription'`(구독 — claude-cli·codex-cli) `| 'metered'`(종량 과금 — claude-api)) · `installable`(bool — 앱이 [설치]를 제공하는지, codex-cli만 true) ·
  `diagnose()`(설치·로그인/키 진단 — TTL 60초 캐시 관례 유지) · `invoke()`(변환 호출 — 프롬프트는 `prompts/convert.md` **벤더 중립 단일본** 공유, `_fetch_directives` 등 지시 생성기 재사용) · `classify()`(실패 원문 → `error_info` 조각 — 원문은 로그 전용) · `available()`(폴백 후보 자격 — CLI형: 설치+로그인, API형: 키 등록).
- **상태 저장 키의 일반화**: 헬스(`_ENGINE_HEALTH`)·진단 캐시·한도 기억(`llm.last_limit.engine`)은 전부 **엔진 id를 키**로 쓴다.
- **legacy 별칭 매핑(마이그레이션 없는 하위 호환)**: `'cli'→'claude-cli'` · `'api'→'claude-api'`. **읽기 시에만** 적용 — 대상은 settings `llm.priority`·`llm.last_limit.engine`, 그리고 요청 파라미터 `engine`(아래 ③). **쓰기는 항상 신 id**(설정 화면 저장·한도 기억 갱신 시 자연스럽게 신 형식으로 수렴 — 일괄 변환 스크립트·Alembic 불요).
- **`llm.priority` 규격 개정**: 신 규격 = **엔진 id 배열**(순서 = 시도 순서, 예 `["claude-cli","codex-cli","claude-api"]`). legacy 스칼라는 읽기 시 매핑 — `'cli'→["claude-cli","claude-api"]` · `'api'→["claude-api","claude-cli"]`(현행 이항 폴백 동작과 동치). 배열에 없는 등록 엔진은 **레지스트리 등록 순서대로 목록 끝에 보충**(`home.layout` 누락 id 보충과 같은 전방 호환 원칙 — codex-cli가 나중에 추가돼도 기존 설정이 깨지지 않는다). 알 수 없는 id는 무시.

**② `GET /api/llm/status` 응답 확장 — 엔진 배열로 교체**

```json
{
  "engines": [
    { "id": "claude-cli", "label": "Claude CLI", "billing": "subscription", "installable": false,
      "available": true, "installed": true, "logged_in": true,
      "key_registered": null, "key_suffix": null,
      "last_success_at": "2026-07-28T09:00:00", "last_error_kind": null },
    { "id": "claude-api", "label": "Claude API", "billing": "metered", "installable": false,
      "available": false, "installed": null, "logged_in": null,
      "key_registered": false, "key_suffix": null,
      "last_success_at": null, "last_error_kind": null },
    { "id": "codex-cli", "label": "Codex CLI", "billing": "subscription", "installable": true,
      "available": false, "installed": false, "logged_in": false,
      "key_registered": null, "key_suffix": null,
      "last_success_at": null, "last_error_kind": null }
  ],
  "limit": null,
  "priority": ["claude-cli", "claude-api", "codex-cli"],
  "fallback_policy": "ask"
}
```
- 엔진별 필드는 **CLI형 = `installed`/`logged_in`, API형 = `key_registered`/`key_suffix`** 만 의미가 있고 해당 없는 쪽은 `null`(프론트는 null 필드를 렌더하지 않는다). `priority`는 위 ①의 정규화(별칭 매핑+누락 보충)를 거친 **유효 배열**을 내려준다.
- **기존 톱레벨 `cli`/`api` 필드는 제거 확정(호환 유지 안 함)** — 판단 근거(2026-07-28 소비처 전수 확인): 소비처는 `LlmEngineSection`(S15에서 레지스트리 목록 렌더로 **같은 단계에 재작성**)과 `LlmLimitBanner`(**`limit` 필드만** 사용 — 이 필드는 불변) 둘뿐이고, 프론트·백엔드는 같은 배포 단위(FastAPI가 dist 서빙)라 버전 어긋남은 열린 구탭뿐인데 그건 §4.16 자동 새로고침이 해소한다. legacy 필드를 병존시키면 그 자체가 이항 잔재(stage-15 DoD 4 "이항 분기 0건" 위반)로 남는다.
- `limit`(한도 기억 `{kind, resets_at}`)·`fallback_policy`는 계약 불변. `llm.fallback`(`auto|ask|off`)·auto의 과금 동의 UI(후보 목록에 metered 엔진이 포함되는 한 유지)도 불변.

**③ 폴백 = 우선순위 목록 (이항 분기 전수 제거)**

- **다음 후보 규칙**: 실패(또는 한도 기억 적중)한 엔진의 **priority 배열상 다음 위치부터 순서대로 첫 `available()` 엔진**. 없으면 후보 없음. `other = "api" if engine == "cli" else "cli"` 류 분기는 전수 제거 대상(`build_error_info`·`apply_remembered_limit`·`_handle_engine_failure` — DoD 4).
- `error_info.fallback_available` = **다음 후보 존재 && `llm.fallback != 'off'`** (의미 일반화, 필드명·타입 불변). **`fallback_engine?: string`(다음 후보 엔진 id) 신설** — ask 정책의 [다시 시도] 버튼이 이 id로 재요청하고, 버튼 라벨은 status `engines[].label`에서 찾는다(서버 `action` 문구도 특정 엔진명 하드코딩 대신 다음 후보 label로 완성해 내려준다).
- **요청 파라미터 `engine` 확장**(`POST /api/convert`·regenerate — §4.11): `'auto' | 엔진id`. legacy `'cli'|'api'` 값은 별칭 매핑으로 계속 수용(422 아님). `auto` = priority 배열 첫 available 엔진.

**④ codex-cli 어댑터·설치 계약**

| 메서드/경로 | 설명 | 단계 |
|---|---|---|
| `POST /api/llm/engines/{id}/install` | **`installable:true` 엔진만**(현재 codex-cli — 그 외는 422). GitHub 릴리스에서 Windows x64 **단일 바이너리** 다운로드(PoC `setup_codex.py` 로직 이식) → 루트 `tools/codex/`에 격리 설치(**PATH 불변**, git·백업 제외). PATH 등 기존 설치본이 감지되면 다운로드 없이 그것을 채택. **동기 처리**(PoC 실측 4.4초 — 잡 큐 불사용, 프론트는 버튼 스피너). 응답 `{installed: true, version}`, 실패는 §3 포맷(다운로드 실패 = 502) | S15 |

- **호출**: `codex exec --json --skip-git-repo-check -C <작업디렉터리> -o <최종메시지파일>` — 최종 메시지는 **`-o` 파일이 1차**(JSONL 이벤트 스캔은 폴백 — PoC 검증에서 두 경로 산출 동일 확인, `-o`가 구현 단순).
- **진단**: `codex --version`(설치) + `codex login status` **텍스트 파싱**(`--json` 없음 — rc=0 && "logged in" 포함, PoC `check_login_status()` 이식). 자격증명은 **전역 `~/.codex` 공유**(격리 설치본도 재로그인 불필요 — PoC T1) — secrets.json에 codex 항목을 만들지 않는다.
- **오류 분류기(`classify_codex_failure`)**: 미설치/미로그인/타임아웃/기타 구조화. **429·한도 메시지 형식은 미실측**(PoC 미조우) — 실측 전에는 `kind:'other'` + "Codex 사용량 한도일 수 있습니다" 보수 안내, 실측 후 `rate_limit` 분류·한도 기억을 채운다(구현 단계 과제로 이월 — 계약은 이 문장으로 고정).

**⑤ 변환 신뢰 게이트 — 계획서 §8.2 v1.1 개정 연동 (전 엔진 공통, R7 보강)**

> 규격 원문은 계획서 §8.2(단일 출처 — v1.1로 개정). 여기는 파이프라인 계약만 확정한다. **경로 구분이 핵심**: 아래 강제 규칙은 **LLM 변환 파이프라인(convert·fetch 잡) 산출물에만** 적용하고, **사용자가 직접 올린 반입 JSON은 기존 파일 호환을 유지**한다(사람이 만든 파일 — 검증 책임은 R7 미리보기 승인).

- **`answer_source: "original" | "solved"`** — 문제 타입(question·past_question) **필수**(변환 파이프라인 산출물 기준 — 누락 = 해당 항목 검증 오류). `prompts/convert.md`에 지시 추가("정답이 원본에 명시돼 있으면 original, 네가 풀어 채웠으면 solved"). **직접 업로드 JSON은 누락 허용 → `original` 간주**(기존 파일 무변경 통과). `solved` 항목은 preview **경고 배지 + 기본 반입 제외**(사용자가 항목별 명시 승인 시에만 포함). **DB에는 저장하지 않는다** — 반입 게이트 신호일 뿐, 승인 반입 후에는 일반 문서(DDL 0건 유지. 이력 필요가 실측되면 계획서에 먼저 확정).
- **순수 JSON 위반 = 오류**: LLM 출력에 코드펜스·전후 잡문이 섞이면 관대한 벗겨내기 없이 **`error_info.kind:'invalid_output'`**(기존 kind 재사용 — "올바른 JSON이 아닙니다" 분기, §4.11)로 실패 처리한다(PoC I1 — 규율 이완 금지). 직접 업로드 파일의 JSON 파싱 실패는 기존 오류 처리 그대로.
- **`content` 필수**: 개념·문제 타입(concept·question·past_question) 공통 — 변환 파이프라인 산출물에서 누락 = 항목 오류(PoC E4).
- **객관식 `answer` = 보기 번호만**: `choices`가 있는 문항의 `answer`는 **1-base 보기 번호 문자열**(`"1"`~`"n"`)만 허용(변환 파이프라인 — 위반 = 항목 오류). 해석 규칙: `"1"`~`"n"` 범위의 숫자 문자열은 **항상 번호로 해석**(수치형 보기의 번호/텍스트 이중 해석 제거 — PoC I2). **직접 업로드 호환**: 번호가 아닌 텍스트 answer는 choices와 **전체 문자열 일치(트림 후)** 시 해당 번호로 **서버가 정규화**해 수용, 불일치면 항목 오류(조용한 추측 매칭 금지).
- **preview 계약 추가(§4.3 연동, 순수 추가)**: 항목에 `warnings: string[]`(기본 `[]`) — 값 `'solved_answer' | 'fabrication_suspect' | 'match_unavailable'`. summary에 `warning`(경고 1개 이상 항목 수, 기본 0) 추가. 프론트는 `solved_answer`·`fabrication_suspect` 항목을 **기본 체크 해제(반입 제외)** 상태로 렌더하고, `match_unavailable`은 **배지·안내만**(기본 포함 유지 — 아래 ⑥). 모르는 warning 값은 무시(전방 호환, `alternatives` 관례).

**⑥ 원문 대조 검사 (서버측 — LLM 아님. 지문·보기 창작 검출)**

> 근거: PoC 최상위 발견 — 추출 불가 글리프를 모델이 침묵 창작으로 메운다(10문항 중 6건, 보기 전체 창작 3건). 프롬프트 규칙만으로 통제 불가가 실측 결론. 목적은 **통째 창작을 확실히 잡는 것**이지 경계 정확도가 아니다 — 개인용 규모에 맞는 단순 알고리즘으로 고정(과설계 금지).

- **적용 범위**: **변환 파이프라인(convert·fetch) preview 생성 시, 문제 타입 문항의 `content`(지문)와 `choices` 각각**. 개념 문서는 제외(요약·재구성이 본질이라 부분 일치가 성립하지 않음). 직접 업로드 JSON은 원본이 서버에 없으므로 비적용(⑤의 경로 구분과 동일 — 배지 없음).
- **원본 텍스트 소스**: 텍스트 계열 파일 = 원문 그대로 · PDF = **pypdf 추출**(+`cryptography` 의존 동봉 — 암호화 PDF, PoC 실측. requirements 반영은 구현 단계) · 이미지·추출 실패 = 아래 "대조 불가". (M16 F42의 B군 추출기가 들어오면 대조 가능 포맷이 넓어진다 — 계획서 §14 순서 관계.)
- **정규화(원본·후보 동일 적용)**: 유니코드 문자(letter)·숫자만 남기고 **공백·구두점·기호 전부 제거** + 소문자화. 원본은 잡당 1회 정규화.
- **판정 알고리즘(문자열 1건당)**: ⓐ 정규화 후 길이 <10 → **판정 생략(통과 취급)**("다음 중 옳은 것은" 류 상투구 오탐 방지) ⓑ 정규화 후보가 원본 정규화 텍스트에 **부분 문자열로 존재 → 통과** ⓒ 아니면 후보를 **길이 12의 비겹침 문자 조각**으로 분할(마지막 조각은 끝에서 12자)해 각 조각의 원본 내 존재 여부를 보고, **커버리지(존재 조각 비율) ≥ 0.6 → 통과, 미만 → 불일치**. 임계 0.6 근거: 추출 시 줄바꿈·하이픈·일부 글리프 소실은 흡수하면서 통째 창작(커버리지 ~0)은 확실히 잡는다.
- **문항 판정**: 지문·보기 중 **1건이라도 불일치 → `fabrication_suspect`**(경고 배지 + 기본 반입 제외 — ⑤).
- **"대조 불가" 판정**: 원본이 없거나, 추출 실패, 또는 **원본 정규화 텍스트가 200자 미만**(이미지 PDF·추출 붕괴) → 해당 잡의 전 문항에 `match_unavailable`. **조용한 통과 금지** — 배지 + preview 상단 안내 1줄("원본에서 텍스트를 추출하지 못해 원문 대조를 수행하지 못했습니다 — 반입 전 원본과 직접 대조하세요"). 단 **기본 반입은 유지**한다(제외하면 이미지 PDF 경로 전체가 막힌다 — 최종 방어선은 기존 그대로 R7 사람 검토).
- **단위 테스트 필수 대상**(불변 규칙 7의 예외 — sm2와 같은 급): 창작 검출(원본에 없는 보기) · `solved` 기본 제외 · 대조 불가 표시 · answer 번호 정합(stage-15 체크리스트 3·5절).

**⑦ S8 화면 변경 (§5.11 그룹 ④ — 카드 목록·온보딩)**

- **엔진 카드**: 고정 2장 → **`status.engines` 배열 렌더**(엔진 추가·제거에 프론트 코드 변경이 없어야 정상 — §4.13 어댑터 격리 원칙과 동일). 카드 내용은 필드 유무로 결정(CLI형 = 설치/로그인, API형 = 키 등록 — null 필드 미렌더).
- **우선순위 UI**: 카드의 **▲▼ 순서 버튼**으로 확정(엔진 3개에 드래그는 과설계 — stage-15 계획의 "드래그 또는 순서 선택" 중 후자 채택. S7 홈 위젯 드래그 재사용도 하지 않는다) → `llm.priority`에 **엔진 id 배열로 저장**(①).
- **Codex 온보딩(카드 내 3단계 — 별도 라우트 없음)**: ⓐ **[설치]** = `POST /api/llm/engines/codex-cli/install`(④ — 기존 설치본 감지 시 "설치됨" 표시로 건너뜀) → ⓑ **로그인** = 진단이 `logged_in:true`면(전역 `~/.codex` 자격증명 감지) **건너뛰기**, 아니면 "터미널에서 `codex login`을 실행해 브라우저로 로그인하세요" 안내 + **[다시 확인]**(F34 CLI 카드 패턴 그대로 — 앱이 대화형 로그인을 대행하지 않는다) → ⓒ **진단 표시**(버전·로그인 상태).
- **프라이버시 고지(1줄, 온보딩 말미 고정)**: "Codex 실행 시 변환 원문이 이 PC의 `~/.codex` 로그·세션 기록에 남습니다."(PoC E2 — 비활성 설정이 공식 지원되면 적용 재검토). 색상은 토큰만(불변 규칙 5).

**DDL 변경 0건·Alembic 0건 — 재확인 근거 (2026-07-28, G3)**

- 이 절의 저장 지점 전수: **settings 키 값 형식 확장**(`llm.priority` 배열화·`llm.last_limit.engine` id화 — settings는 키-값 자유 텍스트라 DDL 무관) · **인메모리**(헬스·진단 캐시·잡 큐) · **secrets.json**(codex는 항목 자체가 없음 — 전역 홈 공유) · **preview JSON 필드**(`warnings` — 메모리 + `import/auto/` 파일) · **디스크 폴더**(`tools/codex/` 바이너리). `answer_source`·대조 결과는 **DB 미저장**(반입 게이트 신호 — 승인 반입 후에는 일반 문서). **새 테이블·컬럼·인덱스 0, Alembic 0.** 계획서 §6.2 무변경 — 구현 중 이 전제가 깨지면 착수 중단 후 보고(임의 확정 금지).

### 4.18 다양한 문서 포맷 반입 — 판별·추출 계층 (S16 — F42. **계약 확정 2026-07-29, stage-16 선행 절차 D1·D2·D3 해소분**)

> 근거: 계획서 §14 F42 "실측 현황"(단일 출처) — 파일 반입에 확장자·매직 바이트 검사가 없고, API 엔진의 무조건 utf-8 디코드 폴백(`convert_service._api_content_blocks_for_file`)이 docx/xlsx 바이너리를 **mojibake로 조용히 LLM에 투입**한다. 이 절은 그 결함의 수정 계약이며, 구현 중 이 계약과 어긋나는 필요(특히 DDL)가 발견되면 임의 확정 없이 착수 중단 후 보고한다(stage-16 DoD 6).
> 원칙 재확인: `sources/` 원본 불변(추출 텍스트는 저장하지 않는 파생물 — R18 정신) · 미리보기 승인 없는 자동 반입 금지(R7) · 오류 원문 노출 금지 + 안내는 **서버 완성 문장**(`error_info`·`notes` — §4.10·§4.11 관례, 프론트 포맷 분기 금지) · **서버측 자동 분할 금지**(F40-④ 결정 유지).

**① 지원 포맷 매트릭스 (포맷 × 경로(파일/URL) × 엔진)**

| 군 | 포맷(확장자) | 파일 반입 | URL 반입 | claude-cli | codex-cli | claude-api |
|---|---|---|---|---|---|---|
| 기존 | pdf | O | O(기존) | 파일 경로 전달(Read) | pypdf 추출 텍스트(§4.17) | base64 document 블록 |
| 기존 | 이미지 png·jpg·jpeg·gif·webp | O | O(기존) | 파일 경로 전달(Read) | 비지원(§4.17 — OCR 없음) | image 블록 |
| **A군** | md(markdown)·txt·html(htm·xhtml)·xml·**csv**(D2-④ 포함 확정) | O | O(⑦ MIME) | 판별 인코딩으로 디코드 후 **utf-8 tmp 경로 전달**(③) | 디코드 텍스트 프롬프트 삽입 | 디코드 텍스트 본문 삽입 |
| **B군** | docx·xlsx | O | O(⑦ MIME) | **추출 텍스트 프롬프트 삽입 — 3엔진 공통**(Claude Code Read도 docx/xlsx는 못 읽는다 — 경로 전달 무의미) | 좌동 | 좌동 |
| **C군** | hwp·hwpx·zip·doc·xls·판별 불가 바이너리 | **구조화 거부**(⑥) | MIME 미허용(⑦) + 다운로드 후 ② 판별에서도 거부 | — | — | — |

- A군의 html·xml은 **원문 그대로 투입**(서버측 태그 제거 파서를 추가하지 않는다 — LLM이 처리, 기존 URL 반입 경로와 동일). csv는 A군 텍스트로 직투입(xlsx 파서와 무관 — 라이브러리 0. 채택 근거는 D2-④: 파서 불요·xlsx 인접 수요·"암호 xlsx는 csv로 저장 후 반입" 폴백 경로 확보. tsv는 별도 등재하지 않고 txt로 취급).
- 반입 JSON 직접 업로드(§4.3)는 이 절의 대상이 아니다(convert 파이프라인이 아님 — 기존 계약 그대로).

**② 판별 규칙 (`phase='preparing'` — LLM 호출 전, 비용 0)**

판별 우선순위: **매직 바이트 > 내용(텍스트성·인코딩) > 확장자**. content-type은 URL 수신 허용 게이트(⑦)일 뿐 판별 근거가 아니다(사칭 방어 — S12 매직 바이트 교훈·qnet `_magic_ok` 전례).

1. **매직 바이트**: `%PDF`→pdf · PNG/JPEG/GIF/WEBP 시그니처→이미지 · **`PK\x03\x04`(zip 계열)→내부 판별** — zip 목록에 `word/document.xml` 있으면 docx, `xl/workbook.xml` 있으면 xlsx, 그 외는 C군 zip/hwpx(표준 라이브러리 `zipfile`만 사용 — 신규 의존 아님. **hwpx 판정은 내부 `mimetype == application/hwp+zip` 또는 최상위 `Contents/` 존재** — S16 구현 확정. **알려진 한계**: `Contents/` 휴리스틱만 맞은 일반 zip은 hwp 문구로 오안내될 수 있다 — C군 거부라는 결과 자체는 동일하고, 판정 강화 여부는 후속 결정(실수요 확인 시 계획서 먼저)) · **OLE CFB `D0 CF 11 E0 A1 B1 1A E1`→기본 C군**(doc·xls·hwp 구버전 계열 — 확장자로 ⑥ 문구만 분기, 확장자 미상이면 통합 문구). **예외 세칙(S16 구현·재검토 확정 2026-07-29)**: **OLE 매직 + 확장자 `.docx`/`.xlsx` = ECMA-376 암호화 OOXML로 판정**(암호 걸린 docx/xlsx는 OOXML zip이 아니라 OLE 컨테이너에 담긴다) → C군 `unsupported_format`이 아니라 **`parse_failed`**(④의 암호 파일 확정을 판별 단계에서 실현) — message "워드(docx)/엑셀(xlsx) 문서를 열 수 없습니다(암호가 걸려 있는 것으로 보입니다)" · action "원본은 sources/에 저장했습니다. 암호를 해제하거나 PDF로 저장한 뒤 다시 반입하세요."(원본 저장은 ④ 대칭 규칙 그대로).
2. **텍스트성 검사**: 선두 표본(8KB)에 널 바이트(0x00) 존재 → 바이너리 → C군 판별 불가. UTF-16(BOM 포함)은 널 바이트로 여기서 걸러진다 — **지원하지 않음**(⑥ 판별 불가 문구의 "UTF-8 텍스트로 저장" 안내로 해결).
3. **인코딩 판별(③) 성공 → A군.** **내용 판별이 정본, 확장자는 보조**(`file_type` 기록·프롬프트 라벨용) — `.docx` 이름의 실제 텍스트 파일은 텍스트로 투입되고, `.txt` 이름의 zip은 C군으로 거부된다. 확장자 미상 텍스트는 txt 취급.
4. 전부 실패 → `unsupported_format`(⑥). **판별 결과는 잡 상태에 기록**하고, 판별을 거치지 않은 바이트가 `_api_content_blocks_for_file`류 텍스트 폴백에 닿는 경로는 0이어야 한다(stage-16 DoD 2 — utf-8 강제 디코드 폴백은 판별 통과분 전용으로 격하).

**③ 인코딩 판별 (D2-② 확정)**

- 순서: **utf-8 BOM(utf-8-sig) → utf-8(strict) → cp949(strict)**. 전부 실패 = 판별 불가(C군 — ⑥ 문구). **chardet류 추론 라이브러리는 도입하지 않는다**(잠정 반대 → 확정. 3단 폴백으로 국내 실사용(utf-8·cp949)을 덮고, 확률 추측 판별은 mojibake를 다시 조용히 들여오는 경로다 — F42 라이브러리 원칙 "포맷당 1개"에도 반함).
- **CLI 엔진 경로 보정(실측 결함 예방)**: cp949로 판별된 파일은 tmp를 **utf-8로 재인코딩해 경로 전달**한다 — Claude Code Read는 utf-8 전제라 "기존대로 경로 전달"만으로는 DoD 3(cp949 무깨짐)이 성립하지 않는다. utf-8(BOM 포함) 파일은 기존대로 원본 tmp 그대로 전달(변경 최소화). `sources/` 원본은 어느 경우든 **원 바이트 그대로 불변**(재인코딩은 tmp 파생물뿐).

**④ B군 추출 계약 (D1 확정 — 파서 채택·직렬화·분리)**

- **파서 채택**: docx = **python-docx**, xlsx = **openpyxl** — 포맷당 1개(F42 원칙), requirements에 **`==` 정확 핀**(pypdf 전례 — 구체 버전은 구현 시 설치 검증 후 기록). python-docx의 lxml C 확장 의존은 **수용**한다(Windows 포함 주요 플랫폼 wheel 배포로 설치 무해 — F42 "wheel 배포 C 확장은 개별 판단" 조항 적용). **docx2txt 기각**: 표 텍스트 추출 불완전(stage-16 체크리스트 요구사항 미달)·유지보수 정체.
- **docx 직렬화**: 문단 텍스트를 문서 순서대로 + 표는 **Markdown 표**로. 수식(OMML)·이미지·텍스트박스는 소실 — **소실 요소 감지 시 잡 `notes`에 서버 완성 문장 1건**을 담는다("수식·그림은 텍스트 추출에서 제외되었습니다 — 미리보기에서 원본과 대조하세요", §4.10 notes 계약 재사용 — 새 API 0건. 소실 표시 여부는 이 문안으로 확정).
- **xlsx 직렬화(D2-③ 확정)**: **시트별 Markdown 표**(`## 시트: {이름}` 헤더 + 표 — 1행을 헤더 행으로). TSV 기각 근거: 산출물이 LLM 투입용인데 탭 구분은 셀 내 공백·탭과 구분되지 않고 열 경계 정보가 약하다 — Markdown 표는 열 구조를 명시적으로 보존하고 content·프롬프트 관례(Markdown)와 일치. 셀 내 `|`는 `\|` 이스케이프, 셀 내 줄바꿈은 공백 치환, 수식 셀은 **계산값**(openpyxl `data_only=True` — 캐시 없으면 빈 값).
- **상한(D2-③ 확정)**: 시트 **10개** · 시트당 **500행** · 행당 **50열**. 초과 시 **자르지 않고 실행 전 `too_large`로 중단**(⑤) — message에 초과 지점을 명시한다(예: "시트 'Sheet3'의 501행에서 행 상한(500)을 초과했습니다"). 부분 잘림 투입은 하지 않는다 — "일부만 변환된 회차"는 조용한 손실이고, 진짜 대용량 시트는 출력 상한 잘림(`invalid_output`)으로 비용만 태우게 된다.
- **추출 함수는 convert 전용이 아니다(M15 접점)**: 신규 **`services/doc_extract.py`**에 `extract_docx_text`·`extract_xlsx_text`(바이트 → 직렬화 텍스트, 실패는 사유를 가진 typed 예외)로 두고, convert 파이프라인과 **`source_match.extract_source_text`(원문 대조 §4.17 ⑥)가 같은 함수를 재사용**한다 — F42의 부수 효과(M15 대조 가능 포맷 확대)가 이 분리로 실현된다(source_match 쪽은 예외를 None="대조 불가"로 흡수). **분리만 한다** — 대조 로직 변경·추출 텍스트 저장·색인은 없음(과설계 금지).
- **파서 예외 = `parse_failed` 재사용 확정**(신규 kind 없음 — S10 신설 의미 "원본 구조 해석 불가"와 일치). 경계 규칙: **② 판별이 지원 포맷(docx/xlsx)으로 확정한 뒤의 추출 실패 = `parse_failed`**(암호 보호·손상·구조 위장 — message에 추정 사유, action "암호를 해제하거나 PDF로 저장한 뒤 다시 반입하세요"), **판별 자체가 미지원 = `unsupported_format`**(⑥). 파서 예외가 잡 크래시·조용한 실패가 되는 경로 0(stage-16 3절). **원본 저장은 `unsupported_format`과 대칭(2026-07-29 확정 — S16 검토 적발 해소)**: `parse_failed`로 종료할 때도 **원본을 `sources/`에 저장한 뒤 종료**한다 — 손상·암호 파일도 사용자의 원본 자료이고, 잡 tmp는 정리되므로 저장하지 않으면 서버에 남지 않는다(stage-16 DoD 2 "손상 파일은 원본 저장 + 구조화 오류" 문면과 정합). action 앞머리 "원본은 sources/에 저장했습니다." 고정도 ⑥과 동일하게 적용한다.

**⑤ 추출·디코드 텍스트 길이 상한 — `error_info.kind:'too_large'` 신설 (D2-⑥ 확정)**

- 상한: A군 디코드·B군 추출 텍스트 공통 **200,000자**(원문 문자 수 기준). 근거: 회차 단위 기출(60문항 ≈ 3~6만 자)의 3배 이상 여유 — "명백한 과대 입력"만 차단하는 보수 상한이다(실질 병목은 출력 상한 잘림 = `invalid_output`이고, 이 상한은 그 전에 **입력 쪽에서 비용 0으로** 멈추는 안전판). settings 키로 만들지 않는다(YAGNI — 값 변경은 계획서 확정 절차).
- 판정 시점: `phase='preparing'`(판별·추출·디코드 직후) — **LLM 호출 전**. xlsx 시트·행·열 상한 초과(④)도 같은 kind로 종료.
- 문구(서버 완성 문장): message "추출된 텍스트가 너무 깁니다(약 N자 — 상한 200,000자)" / action "원본을 과목·회차 단위로 나눠 개별 파일로 반입해 주세요"(F40-④ `invalid_output`의 분할 권고와 같은 계열 — **서버측 자동 분할은 하지 않는다**). `fallback_available=false`(엔진을 바꿔도 같음 — `invalid_output` 전례), `alternatives` 없음. §4.11 kind 목록에 등재 완료.

**⑥ `unsupported_format` 포맷별 폴백 안내 — 확정 문안 (서버 완성 문장, qnet `_unsupported_message` 전례)**

거부 시에도 **원본은 `sources/`에 저장한 뒤 종료**한다(조용한 스킵 금지 — qnet과 동일 정책, stage-16 1절). action 앞머리에 "원본은 sources/에 저장했습니다." 고정, 이후 포맷별 문장:

| 판별 결과 | message | action(뒷부분) |
|---|---|---|
| hwp·hwpx | "한글(HWP) 문서는 자동 변환할 수 없습니다" | "한글에서 PDF로 저장한 뒤 다시 반입하세요." |
| zip(내부에 docx/xlsx 마커 없음) | "압축 파일(ZIP)은 자동 변환할 수 없습니다" | "압축을 풀어 PDF·이미지·문서 파일을 하나씩 반입하세요." |
| doc(OLE + 확장자 doc) | "구버전 워드(doc) 문서는 지원하지 않습니다" | "워드에서 docx로 저장한 뒤 다시 반입하세요." |
| xls(OLE + 확장자 xls) | "구버전 엑셀(xls) 문서는 지원하지 않습니다" | "엑셀에서 xlsx로 저장한 뒤 다시 반입하세요." |
| OLE(확장자 미상) | "구버전 오피스·한글 계열 문서로 보입니다" | "PDF 또는 docx/xlsx로 저장한 뒤 다시 반입하세요." |
| 판별 불가(널 바이트·인코딩 실패) | "파일 형식을 판별할 수 없습니다(지원하지 않는 바이너리 또는 인코딩)" | "PDF·이미지 또는 UTF-8 텍스트로 저장한 뒤 다시 반입하세요." |

※ **암호화 OOXML(OLE 매직 + 확장자 `.docx`/`.xlsx`)은 이 표의 대상이 아니다** — ②-1 예외 세칙에 따라 **`parse_failed`**로 종료한다(문구·원본 저장은 ②-1·④).

**`alternatives`(2026-07-29 확정 — S16 검토 적발 해소)**: **convert 잡(파일·URL 반입)에서 발생한 `unsupported_format`·`parse_failed`는 빈 배열 `[]`** — 실패한 반입 경로 자신([파일로 반입] 버튼 → 같은 화면 회귀)이나 같은 판별·파서에 다시 걸릴 경로는 대안이 아니다. 해결책은 경로 전환이 아니라 **원본 변환 후 재반입**(위 action 문구가 안내)이며, 빈 배열이면 프론트가 아무 버튼도 렌더하지 않는 기존 계약 그대로다. **fetch 잡 발생분은 기존 기본값 유지**(`['file_import','url_import']` 등 — §4.11·S14 계약 불변: 사이트 반입에는 다른 경로가 실제 대안이다). 프론트는 문구를 그대로 나열한다(포맷 분기 금지 — 렌더 코드 불변).

**⑦ URL 반입 content-type 화이트리스트 확장 (D2-⑤ 확정)**

- **추가 5종**: `application/xml`·`text/xml` → xml · `text/csv` → csv · `application/vnd.openxmlformats-officedocument.wordprocessingml.document` → docx · `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` → xlsx. (기존: pdf·html/xhtml·markdown·text/plain·이미지 4종 — 불변.)
- **`application/octet-stream`은 계속 미허용**: 내용 미상 다운로드를 전부 여는 폭 대비 실수요 미확인(YAGNI) — 필요가 실측되면 계획서에 먼저 확정. 파일 반입 폴백이 항상 살아 있다. doc/xls/hwp MIME(`application/msword`·`application/vnd.ms-excel`·`application/x-hwp` 등)도 목록에 넣지 않는다 — C군은 내려받아도 거부될 파일이므로 전송 자체를 받지 않는다(거부 문구가 지원 포맷을 안내).
- 거부 message의 "(pdf/html/이미지/md만 허용)" 문구는 지원 포맷 나열로 갱신한다(구현 시 — 서버 완성 문장 원칙 유지).
- **다운로드 성공 후에도 ② 판별 계층을 동일하게 통과**한다 — content-type은 수신 허용 게이트일 뿐 판별 근거가 아니다(매직 바이트 우선 — 사칭 방어). 50MB 상한·SSRF 검증·리다이렉트 제한은 불변.

**DDL 변경 0건·Alembic 0건 — 재확인 근거 (2026-07-29, D3)**

- 이 절의 저장 지점 전수: **tmp 파일**(판별·추출·재인코딩 파생물 — 기존 잡 정리 규칙 그대로) · **인메모리 잡 상태**(판별 결과·notes) · **`sources/` 원본 바이트**(불변 — 추출 텍스트는 저장하지 않는 파생물, R18 정신) · **requirements 의존 2건**(python-docx·openpyxl — 계획서 F42 등재). `documents.file_type`은 자유 텍스트(CHECK 없음)라 `'docx'|'xlsx'|'xml'|'csv'` 등 값 확장은 **계획서 §6.2 주석 갱신만**이다. **새 테이블·컬럼·인덱스 0, Alembic 0, 신규 엔드포인트 0**(기존 `POST /api/convert`의 수용 포맷 확장 — 계약 신설은 `error_info.kind:'too_large'` 값 1종뿐). 구현 중 이 전제가 깨지면 착수 중단 후 보고(임의 확정 금지).

### 4.19 문서 상호참조·표현 UX — 임베드 해석·참조 인덱스 (S17 — F43. **계약 확정 2026-08-02, stage-17 선행 절차 D1~D3 해소분**)

> 근거: 계획서 §14 F43(단일 출처 — 결정 사항·채택하지 않은 후보). 이 절은 착수 전 결정 ①~⑦의 확정 계약이며, 구현 중 이 계약과 어긋나는 필요(특히 DDL)가 발견되면 임의 확정 없이 착수 중단 후 보고한다(stage-17 DoD 7).
> 원칙 재확인: **채점은 서버에서만 — 임베드 해석 응답에 answer·explanation 필드 자체가 없다**(필터링이 아니라 스키마 부재 — 불변 규칙 1) · 소프트 삭제(참조가 삭제를 막지 않는다 — 자리표시자) · 색상 하드코딩 금지(임베드 카드·접기 효과 전부 토큰) · 에러 규약 §3.

**① 레퍼런스 문법 (D1 확정 — 계획서 F43 결정 ①)**

| 문법 | 의미 | 정규식(구현 기준) |
|---|---|---|
| `![[DOC-0012]]` · `![[DOC-0012\|별칭]]` | **임베드** — 그 자리에 대상 문서 본문을 임베드 카드로 펼침(별칭은 카드 출처 배지의 표시명 대체) | `!\[\[(DOC-\d{4,})(?:\|([^\]\|]+))?\]\]` |
| `[[DOC-0012]]` · `[[DOC-0012\|별칭]]` | **링크 칩** — 문서 상세로 이동하는 버튼(임베드 안 함) | `(?<!!)\[\[(DOC-\d{4,})(?:\|([^\]\|]+))?\]\]` |
| `[[#절 제목]]` · `[[#절 제목\|별칭]]` | **같은 문서 헤딩 앵커** — 클릭 시 해당 헤딩으로 스크롤 | `\[\[#([^\]\|]+)(?:\|([^\]\|]+))?\]\]` |

- **표시명 별칭 지원 확정**(`\|` 구분 — 파서 비용이 낮고, "산술평균" 같은 자연어 표기가 실사용 핵심). 별칭은 표시 전용 — 참조 키는 항상 `doc_no`.
- **doc_no 패턴 = `DOC-\d{4,}`** — 생성 규칙 실측: `document_service._generate_doc_no()`가 `DOC-{연번:04d}`(4자리 제로 패딩, 10000 이상은 자연히 5자리+). 매칭은 문자열 정확 일치(대소문자 구분 — 소문자 `doc-` 불인정).
- 렌더(프론트)는 remark AST 기반 — 코드 블록·인라인 코드 안의 참조는 자연히 렌더되지 않는다. **서버 인덱스 파서는 본문 전체 정규식 스캔**(코드 블록 제외 없음 — 알려진 한계: 코드 블록 안 참조가 인덱스에 잡혀 사용처 집계에 +1 될 수 있으나 파생 인덱스의 과포함은 무해. 단순성 우선).
- **§8.2 반입 규격 영향 없음 확인**: 참조는 `content` 본문 문자열일 뿐 — 반입 JSON 스키마·변환 프롬프트 불변. LLM에게 참조 문법 생성을 요구하지 않는다(수동 편집·삽입 도우미 중심).

**② 가리기·접기 문법 (D2 확정 — 계획서 F43 결정 ②)**

- **remark-directive 채택**(컨테이너 directive — 프론트 신규 의존 1개). **rehype-raw(원시 HTML `<details>`)는 기각 확정** — XSS 표면 확대(stage-17 "하지 않는 것" 유지).
- 문법: `:::fold[제목]` … `:::` = **접기**(제목 줄만 표시, 클릭 펼침 — 기본 접힘) / `:::hide[제목]` … `:::` = **가리기**(내용 가림, 탭/클릭 공개 — 암기·자가 테스트용).
- **제목 생략 허용**: `:::fold` → 기본 라벨 "접힌 구간", `:::hide` → "가려진 내용"(프론트 상수 — i18n 없음).
- **중첩**: remark-directive 표준 규칙(바깥 컨테이너의 콜론 수 증가 — `::::fold` 안에 `:::hide`)을 그대로 따르고 렌더는 재귀 처리. 중첩 깊이 상한은 두지 않는다(임베드 깊이와 무관 — 같은 문서 안 마크업일 뿐).
- 알 수 없는 directive 이름(`:::foo`)은 스타일 없이 내용만 렌더(무해 통과 — 크래시 금지).

**③ 임베드 해석 엔드포인트 (D3-⑥ 확정 — 신규 1개)**

`POST /api/documents/resolve-embeds` — 본문 전용 배치 조회(읽기 전용).

- **POST인 이유**: doc_no 배열이 URL 길이 제한과 무관해야 하고 배치 의미론(§4.8 `quiz/session` 등 조회성 POST 전례). **문서별 개별 GET은 기각** — 한 문서 열람에 임베드 수만큼 요청이 나가는 N+1 경로.
- 요청: `{ "doc_nos": ["DOC-0012", "DOC-0034", ...] }` — **상한 50개**(중복 제거 후 기준). 초과·빈 배열·형식 위반 = `VALIDATION_ERROR`(422, §3).
- 응답: `200` + `{ "items": [ ... ] }` — 항목 스키마(**이 필드가 전부다**):

```json
{
  "doc_no": "DOC-0012",
  "found": true,
  "title": "산술평균",
  "type": "concept",
  "content": "…Markdown 본문…",
  "is_active": true
}
```

- **answer·explanation 필드는 응답 스키마에 존재하지 않는다** — 필터링(값 비우기)이 아니라 **부재**. QuizCard가 같은 MarkdownView를 쓰므로 임베드 해석이 퀴즈 화면의 정답 유출 경로가 되지 않게 계약 수준에서 봉인(불변 규칙 1). 기존 `GET /api/documents/batch`(DocumentDetail 반환)를 임베드 해석에 재사용하지 않는 이유가 이것이다 — 해석 전용 스키마로 분리한다.
- **부재 doc_no = 배치 부분 성공**(404 아님): 해당 항목 `{ "doc_no": "DOC-9999", "found": false }` (나머지 필드 생략/null). 요청 전체가 실패하는 경우는 §3 규약 위반 입력뿐.
- **소프트 삭제(is_active=0) 문서**: `found: true, is_active: false, title` 제공 + **`content`는 `null`**(내용 미노출 — 복원하면 다시 내려간다). 자리표시자 렌더용 최소 정보만.
- **읽기 전용 보증(학습 의미론 불변)**: 이 엔드포인트는 SELECT만 수행 — study_progress·SRS(`srs_cards`)·attempts 등 **어떤 테이블에도 쓰기 0**. 임베드로 "산술평균"을 읽어도 그 문서의 진도·복습 카드는 갱신되지 않는다(열람한 것은 상위 문서 — 이중 진도 방지. stage-17 DoD 5).
- **프론트 캐시**: 문서 열람 컴포넌트 수명 동안의 **메모리 캐시**(`Map<doc_no, item>` 수준) — 같은 열람 세션 내 동일 doc_no 재요청 0. 전역 영속 캐시·무효화 체계는 만들지 않는다(YAGNI — 개인 규모).
- **호출 형태**: MarkdownView가 본문에서 참조를 수집해 **1회 배치 호출**(임베드 `![[…]]` + 링크 칩 `[[…]]`의 제목 조회를 같은 배치에 합침). 중첩 임베드는 깊이당 최대 1회 추가 배치(아래 ④ 상한으로 유계).

**④ 임베드 렌더 규칙 — 깊이·순환·자리표시자 (D3-③ 확정)**

- **깊이 상한 = 2** (잠정 2~3에서 확정). 근거: 핵심 사용례는 "상위 문서 → 개념 모듈" 1단이고, 2단은 개념 모듈이 하위 개념을 참조하는 여유분 — 3단 이상은 문서를 더 쪼개라는 신호이지 렌더가 감당할 일이 아니다. 상위 문서 본문 = 깊이 0, 그 안의 임베드 = 깊이 1, 임베드 안의 임베드 = 깊이 2까지 펼침. **깊이 3부터는 펼치지 않고 자리표시자**.
- **순환 검출**: 렌더 경로의 **방문 집합**(루트 문서 doc_no 포함) — 조상 체인에 이미 있는 doc_no를 다시 임베드하면 순환 자리표시자(무한 재귀·무한 fetch 0). 자기 자신 임베드(`![[자기 doc_no]]`)도 순환의 최소 사례로 같은 처리.
- **자리표시자 4종 확정 문구**(프론트 상수 — 토큰 스타일, 링크 칩 부재·삭제 시에도 같은 문구를 툴팁/비활성 칩으로 재사용):

| 상황 | 문구 | 부가 |
|---|---|---|
| 순환 참조 | `순환 참조 — DOC-xxxx는 이미 펼쳐져 있습니다` | [원문 열기] 버튼은 제공 |
| 삭제된 문서(is_active=0) | `삭제된 문서 (DOC-xxxx · 제목) — 내용은 표시되지 않습니다. 복원하면 다시 보입니다` | 내용 미노출 |
| 존재하지 않는 참조(found=false) | `존재하지 않는 참조 (DOC-xxxx)` | — |
| 깊이 초과(3단+) | `깊이 제한(2단)으로 펼치지 않은 문서 (DOC-xxxx · 제목)` | [원문 열기] 버튼은 제공 |

**⑤ 헤딩 앵커 슬러그 (D3-⑤ 확정)**

- **github-slugger 계열 채택** — 프론트 헤딩 id 부여는 **rehype-slug**(내부 github-slugger, 프론트 신규 의존 — remark-directive와 합쳐 2개), `[[#절 제목]]` 매칭은 앵커 텍스트를 **같은 github-slugger로 슬러그화**해 헤딩 id와 비교(부여와 매칭이 같은 함수 — 규칙 이원화 금지).
- 규칙(github-slugger 표준): **유니코드(한국어) 보존** · 소문자화 · 공백 → 하이픈 · 구두점류 제거 · 같은 문서 내 중복 헤딩은 `-1`, `-2` 접미. 예: `## 산포의 측도 (범위·분산)` → `#산포의-측도-범위분산`.
- 매칭 실패(해당 헤딩 없음) = 스크롤 무동작 + 칩에 비활성 표시(크래시·이동 오류 금지). 임베드된 문서 내부 헤딩으로의 앵커는 지원하지 않는다(블록 단위 트랜스클루전 배제와 같은 선 — stage-17 "하지 않는 것").

**⑥ embeds 인덱스 동기화 (파생 인덱스 — 본문이 단일 출처)**

- 행 형태: `document_relations(from_document_id=상위(임베드하는) 문서, to_document_id=대상 문서, relation='embeds', created_by='embed')`. relation이 PK 일부이므로 같은 문서 쌍에 `'explains'`(F21 제안 경로)와 `'embeds'`가 공존 가능 — 충돌 없음.
- **동기화 시점(전수)**: ① `POST /api/documents`(생성) ② `PATCH /api/documents/{id}`(content 변경 시) ③ 반입 `commit`(`import_service.commit_import` — 커밋으로 생성·갱신된 문서 전부). 각 지점에서 본문을 ①의 임베드 정규식으로 스캔 → `relation='embeds' AND created_by='embed' AND from_document_id=해당 문서` 행 집합을 **스캔 결과로 치환**(사라진 참조 행 삭제·새 참조 행 추가 — upsert+prune). 문서 저장과 **같은 트랜잭션**.
- **인덱스 대상은 임베드(`![[…]]`)만** — 링크 칩 `[[…]]`은 인덱스하지 않는다(사용처 표시·삭제 경고의 의미는 "내용이 그 자리에 보이는" 임베드다. 링크까지 넣으면 경고가 과다 발화).
- 대상 doc_no가 **존재하지 않으면 행을 만들지 않는다**(FK 대상 없음 — 렌더는 어차피 부재 자리표시자). 알려진 한계: 나중에 그 doc_no가 생겨도 상위 문서를 재저장하거나 전량 재계산을 돌리기 전에는 인덱스에 잡히지 않는다(단, doc_no는 연번 생성이라 "미래 번호를 미리 참조"하는 경우 자체가 비정상 사용). 자기 자신 임베드도 행을 만들지 않는다(자기 참조 행 무의미).
- **전량 재계산 관리 함수 1개**(R20): 전 문서(is_active 무관)의 content를 재파싱해 `created_by='embed'` 행 전체를 재구축 — **멱등**(두 번 돌려도 같은 결과). 도입 시 1회 백필 겸용. 수동 실행 경로만(관리 스크립트/함수 — 신규 API로 노출하지 않는다). `created_by='manual'` 등 다른 행은 건드리지 않는다.

**⑦ 삭제 경고·사용처 표시 (실측 기반 확정 — 신규 API 0)**

- 실측: documents 라우터에 별도 사용처 엔드포인트는 없고, **`DocumentDetail`이 `usages`(분류 연결)와 `relations: List[DocumentRelationOut]`(direction `from|to`)을 이미 내려준다**(`schemas/document.py`). embeds 행은 대상 문서의 detail에서 `direction='to', relation='embeds'`로 자연 노출된다.
- **확정: 기존 `DocumentDetail.relations` 재사용 — 필드 추가·별도 API 없음.** ① 문서 상세의 사용처 영역: `relation='embeds' AND direction='to'` 항목을 **"이 문서를 임베드한 문서 N개"** 역참조 목록으로 분리 렌더(기존 관계 목록에 섞어 표시하지 않는다) ② 삭제 확인 다이얼로그: 이미 로드된 detail에서 같은 집계로 **"N개 문서에 임베드됨"** 경고 표시. **삭제 차단은 하지 않는다**(§6.3 원칙 — 자리표시자로 해결).

**⑧ 인쇄 뷰(F22) 처리 (D3-④ 확정)**

- **임베드 = 펼침 포함**(잠정안 유지 확정 — A4 정리본의 자기완결성). 깊이·순환 규칙은 화면과 동일. `break-inside` 회피 규칙을 임베드 카드에도 적용.
- **fold(접기) = 펼침 · hide(가리기) = 공개** — **인쇄는 전부 공개** 확정. 근거: 인쇄 뷰의 정체성은 "정리본"(F22)이고, 종이는 탭 공개가 불가능해 가린 채 인쇄하면 내용이 영구 소실된 출력물이 된다. "가린 채 인쇄"(암기용 시험지)는 실수요 확인 시 v1.x 후보로 계획서에 먼저 등재(지금 만들지 않는다).

**⑨ DocEditor 참조 삽입 도우미 (D3-⑦ 확정 — 최소안)**

- 툴바 버튼 1개 → **문서 검색 팝업**(기존 검색 API 재사용) → 선택 시 **커서 위치에 `![[DOC-xxxx]]` 삽입**(팝업에서 임베드/링크 칩 중 택1 — 기본 임베드) + 편집 폼에 **문법 힌트 1줄**(`![[DOC-번호|별칭]]` · `:::fold[제목]` 요약). WYSIWYG·실시간 미리보기는 만들지 않는다(stage-17 "하지 않는 것").

**DDL 변경 0건·Alembic 0건 — 재확인 근거 (2026-08-02, D4)**

- 이 절의 저장 지점 전수: **`documents.content`**(참조·directive는 본문 Markdown 문자열 — 컬럼 그대로) · **`document_relations` 값 확장**(`relation='embeds'`·`created_by='embed'` — 두 컬럼 모두 자유 텍스트(CHECK 없음), 계획서 §6.2 주석 갱신만) · **프론트 상태**(펼침/가림 여부는 화면 상태 — 저장 안 함) · **프론트 의존 2건**(remark-directive · rehype-slug). **새 테이블·컬럼·인덱스 0, Alembic 0. 신규 엔드포인트는 `POST /api/documents/resolve-embeds` 1개뿐.** 구현 중 이 전제가 깨지면 착수 중단 후 보고(임의 확정 금지 — stage-17 DoD 7).

**구현 앵커 (2026-08-02 실측 — 구현 에이전트 재탐색 방지용)**

- `backend/services/document_service.py` — `DOC_NO_PREFIX`·`_generate_doc_no()`(29·41행 부근, `DOC-{n:04d}`) · 문서 생성/수정 저장 지점(동기화 ⑥ 호출 위치) · DocumentDetail 조립(relations 목록 — 363~374행 부근)
- `backend/routers/documents.py` — `POST ""`(72행)·`PATCH "/{document_id}"`(85행)·`DELETE`(93행). **신규 `POST /resolve-embeds`는 `/{document_id}` 경로보다 앞에 등록**(FastAPI 경로 매칭 순서 — 기존 `GET /batch`(58행) 전례)
- `backend/services/import_service.py` — `commit_import()`(922행 부근, 동기화 ⑥ 지점) · `_create_relation()`(893행 — relation 행 생성 전례, embeds upsert 참고)
- `backend/models.py` — `DocumentRelation`(255행 — relation·created_by = Text·CHECK 없음, relation은 PK 일부)
- `backend/schemas/document.py` — `DocumentRelationOut`(88행, direction `from|to`)·`DocumentDetail.relations`(115행)
- 신설 제안: `backend/services/embed_service.py`(참조 파서·인덱스 동기화·전량 재계산·해석 조회를 한 파일에) + `backend/schemas/embed.py`(요청/응답 — answer·explanation 부재 스키마)
- `frontend/src/components/MarkdownView.tsx` — 공용 렌더러(현재 remark-gfm + rehype-highlight — 여기 1곳에 remark-directive·rehype-slug·참조 처리 추가, 화면별 분기 금지)
- `frontend/src/components/DocEditor.tsx` — 참조 삽입 도우미(⑨)

