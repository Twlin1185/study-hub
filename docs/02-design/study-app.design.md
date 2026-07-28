# Study Hub — 상세 설계 (API 명세 · 화면 상세)

> 상태: **Design v1.17** — v1.16 대비: **§4.17 신설(S15 — F41 멀티 벤더 LLM 엔진, 계약 확정 2026-07-28 — 착수 게이트 G3 해소. 구현은 게이트 G2 통과 후)**: ① **엔진 레지스트리** — 엔진 id 3종(`claude-cli`·`claude-api`·`codex-cli`)·항목 인터페이스(진단/호출/분류기/한도·헬스 키)·legacy `cli|api` 별칭의 **읽기 시 매핑**(마이그레이션 없음) ② `GET /api/llm/status`를 **엔진 배열로 교체**(기존 `cli`/`api` 톱레벨 필드 **제거 확정** — 소비처 전수 확인 근거는 §4.17 ②) ③ **폴백 = 우선순위 목록**(`llm.priority` 배열화, `error_info.fallback_engine` 추가) ④ codex-cli 어댑터·설치 계약(신규 엔드포인트 **`POST /api/llm/engines/{id}/install` 1개**) ⑤ **변환 신뢰 게이트(전 엔진 공통, R7 보강)** — 계획서 §8.2 v1.1 개정 연동(`answer_source` 필수·순수 JSON 위반=오류·`content` 필수·객관식 `answer` 번호만) + preview `warnings` 필드 ⑥ **원문 대조 검사 알고리즘 확정**(정규화·12자 조각 커버리지 ≥0.6·대조 불가 판정) ⑦ S8 화면(§5.11 그룹 ④) 확장 — 카드 목록 렌더·▲▼ 우선순위·Codex 온보딩·프라이버시 고지. **DDL 변경 0건·Alembic 0건 재확인(§4.17 말미 근거).**
> (v1.16: v1.15 대비: **S14(큐넷 공식 오픈API) 구현 완료(2026-07-27)에 따른 계약 확정 반영 — 엔드포인트 증감 0건, 기존 응답에 필드 추가만**: ① `POST /api/fetch/exams` **요청 `include_notices?`(기본 false)** + **응답 항목 `is_notice`** — 안내문 게시물 기본 숨김 + "안내문 N건 보기" 토글(같은 24h 캐시에서 파생 — **추가 API 호출 0건**) ② `GET /api/convert/{job_id}` 응답에 **`notes: string[]`(기본 `[]`)** — 성공 소표기(예: ZIP 동시 저장). **문구는 서버가 완성해 내려준다**(프론트 포맷 분기 금지) ③ `error_info.kind`에 **`unsupported_format` 확정** + `alternatives`에 **`'file_import'`** 값 추가 ④ `GET /api/fetch/adapters` qnet 항목에 `key_registered`·`key_suffix?`(예고대로 구현) ⑤ **`exam_key` 3형태 확정** — `YYYY-MM-DD`(폴더 파생 O) · **`YYYY`(연도만 — 폴더 파생 X, 회차를 창작하지 않음)** · `qnet-{artlSeq}`(식별 불가). 뒤 두 형태는 **`imported=false` 고정**·분류 경로 미생성 ⑥ **§3에 상류 실패 규약 명문화**(외부 공식 API 거절 = **HTTP 502 + code `INTERNAL`**, 코드 집합은 4종 유지 — 판단 근거는 §3). **DDL 변경 없음 · Alembic 0건.**)
> (v1.15: v1.14 대비: **S13 구현 완료(2026-07-27)에 따른 확정 사항 반영 — 계약 변경 없음, 명세 보강만**: ① §5.9 대기열이 **`previewId`를 localStorage에 함께 영속**(잡 레코드가 만료·404가 된 뒤에도 F40-① 디스크 복구로 검토를 이어가기 위함 — 검토 단계의 1차 키는 preview_id) ② **URL 반입을 파일 대기열로 통합**(폴링·재시도·재개 코드 이원화 방지 — 탭 4종·Stepper 3단계는 불변) ③ **10개 상한 = "대기열 잔여 + 신규 선택" 합계 기준** ④ **처리 중인 1건은 취소·건너뛰기 불가**를 알려진 한계로 명시(서버에 잡 취소 API 없음 — 신설하지 않음) ⑤ **[변환 JSON 내려받기]는 보존본이 있는 경로(convert·fetch 잡 preview)에만 노출**(직접 업로드 preview는 404 — §4.3). **DDL 변경 없음 · 엔드포인트 증감 없음.**)
> (v1.14: **단계 재편(계획서 v0.17 — 큐넷 실측에 따른 우선순위 변경)**: ① 큐넷 오픈API 계약(서비스키 `fetch/qnet-key`·목록/상세·`unsupported_format`·설정 카드)의 단계 태그를 **S13 → S14**로 이관(**내용 삭제 없음** — 계약은 그대로, 착수 시점만 뒤로). 사설 어댑터 제거·단일 어댑터화는 **S13 유지**. ② **F40 수동 반입 UX 계약 신설(S13)**: §4.3에 **변환 결과 디스크 보존·복구**(`GET /api/import/preview/{id}` 캐시 미스 시 복구) + **`GET /api/import/preview/{id}/json`(내려받기, 신규 1개)**, §4.11 `POST /api/convert`에 **`category_path?`**(분류 경로 제안 고정 — 사이트 반입 지시 생성기 공유) + `error_info.kind`에 **`'invalid_output'`**(출력 잘림 오안내 수정), §5.9에 **반입 대기열**(여러 파일 연속 — 새 API 0건, 서버 동시 1개 유지)·분류 경로 입력·복구 표시. **DDL 변경 없음.**)
> (v1.13: **사이트 어댑터 단일화(S13 — 사설 어댑터 comcbt·cbtbank 제거, 계획서 v0.16 §14 F35-2 제거 이력)**: §4.13에서 어댑터 3종 목록·우선순위 병합(qnet>cbtbank>comcbt)·날짜 자연 키 병합·`also_on`/`refs` 대안 어댑터 재시도·level_hint 오병합 방지 조건을 **큐넷 단일 어댑터 기준으로 정리**. **계약 형태는 유지**(`GET /api/fetch/adapters`는 계속 **배열** 반환, `POST /api/fetch/exams` 항목의 `also_on`(항상 `[]`)·`refs`(단일 항목)·`exam_key?`도 필드 유지) — 프론트 변경은 어댑터 id 유니온 축소(`'qnet'`)와 이름 폴백 맵 정리뿐. §5.9 대안 어댑터 재시도 버튼은 사문화(빈 `also_on`이라 미렌더). DDL 변경 없음.)
> (v1.12: **S13(M13 큐넷 공식 오픈API) 계약**(§4.13 S13 갱신 — qnet 어댑터를 공공데이터포털 **"국가자격 공개문제 조회 서비스"**(getOpenQstList/getOpenQst)로 실가동: 서비스키 등록 `POST/DELETE /api/fetch/qnet-key`(secrets.json — F34 전례), `fileUrl` JWT 1시간 → **상세 조회·다운로드 같은 잡 연속 수행**, HWP 전용 회차 = 원본 저장 + `error_info.kind:'unsupported_format'` 신설, 병합 그룹 level_hint 동일 조건 명시. **기존 fetch 계약(adapters/certs/exams/import)·프론트 스텝 흐름 불변**) + §5.11 데이터 그룹 서비스키 카드·§5.9 실패 렌더 1종 추가)
> 이전 이력: v1.11 — S12 계약(§4.13 cbtbank FetchedExam 첫 실사용·날짜 자연 키 병합·`fetch/import` `exam_key?`, §4.15 `GET /manual`) · v1.10 — S11 계약 신설(§4.14 F25·F16) · v1.9 — S10 구현 실측 반영(comcbt PDF 경로, qnet available:false 스텁)
> 작성일: 2026-07-22 · 갱신: 2026-07-28
> 상위 문서: `docs/01-plan/study-app.plan.md` (Draft v0.22)
> 구현 계획: `docs/01-plan/stage-1-skeleton.plan.md` ~ `stage-13-fetch-cleanup-manual-import.plan.md`(S13) · `stage-14-qnet-openapi.plan.md`(S14) · `stage-15-multi-engine-codex.plan.md`(S15 — 착수 게이트 있음, §4.17)

---

## 1. 범위

계획서의 데이터 모델(§6)을 전제로, **REST API 명세**와 **화면 상세**를 확정한다.
스키마 DDL은 계획서 §6.2가 단일 출처(source of truth)이며 여기서 반복하지 않는다.

## 2. 프로젝트 구조

```
study-hub/
├─ backend/
│  ├─ main.py               # FastAPI 앱 생성, 라우터 등록, 정적 파일(frontend/dist) 서빙, GET /manual(S12 — §4.15)
│  ├─ database.py           # engine(SQLite WAL), SessionLocal, get_db
│  ├─ models.py             # SQLAlchemy 모델 (계획서 §6.2 그대로)
│  ├─ schemas/              # Pydantic 요청/응답 모델 (리소스별 파일)
│  ├─ routers/              # categories, documents, imports, study, quiz, srs,
│  │                        # review_notes, stats, search, tags, suggestions, settings, exam(S11)
│  ├─ services/             # sm2.py, import_service.py, stats_service.py,
│  │                        # tag_rule_service.py, convert_service.py(M6), backup_service.py(M6),
│  │                        # fetchers/(S10 — base·registry·qnet, §4.13. S13: 사설 어댑터 comcbt·cbtbank 제거), exam_service.py(S11 — §4.14)
│  └─ alembic/              # 마이그레이션
├─ frontend/
│  └─ src/
│     ├─ api/               # client.ts(fetch 래퍼), 리소스별 React Query 훅
│     ├─ components/        # 공용: Tree, DocCard, MarkdownView, ProgressBar, TagChip, …
│     ├─ pages/             # 화면 12개 (§5)
│     ├─ stores/            # zustand: quizSession, flashcardSession, examSession(S11), theme, sidebar(S7)
│     ├─ styles/tokens.css  # 디자인 토큰 (§6)
│     └─ App.tsx            # React Router 라우트
├─ sources/                 # 원본 파일 (불변)
├─ import/                  # 반입 JSON — 최상위: 사람이 넣은 파일(Claude Code 산출물 등)
│  └─ auto/                 # S13(F40-①): 앱이 변환한 반입 JSON 자동 보존(최근 50건, git·백업 제외 — §4.3)
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
- **상류(외부 공식 API) 실패 규약 — S14 확정(2026-07-27)**: 큐넷 오픈API 같은 **외부 서비스가 요청을 거절**한 경우(쿼터 초과·서비스키 오류·토큰 만료 등)는 **HTTP `502` + `code:"INTERNAL"`** 로 응답한다.
  - **코드 집합은 위 4종에서 늘리지 않는다.** 괄호 안 상태 코드는 각 코드의 *기본값*이며, `INTERNAL`만 예외적으로 **500(우리 쪽 결함) / 502(상대편 사정)** 두 상태를 쓴다.
  - **이렇게 정한 이유**(구현 확정 사항의 사후 검토 결과 — 그대로 채택): ① 이 실패를 **"검색 결과 0건"으로 위장시키지 않는 것**이 목적인데(§4.13 S14 — 0건은 "이 종목의 공개문제가 없습니다"라는 **정상 안내**라 뜻이 정반대다), 그 구분은 상태 코드 하나로 충분히 달성된다. ② 프론트는 **`code`로 분기하지 않는다** — `client.ts`가 `code`를 열린 문자열로 두고 화면은 서버가 준 **사람 말 `message`를 그대로 렌더**하므로 새 코드를 만들어도 소비자가 없다(YAGNI). ③ 원인 구분자가 필요하면 이미 `detail.reason`(`quota`|`key`|`token`|`no_key`|`other` — 서버 내부 분류)이 실려 온다.
  - `message`는 항상 **한국어 사람 말 + 다음 행동**이며, **원문 XML/JSON·서비스키 원문은 어떤 필드에도 담지 않는다**(§4.11 원칙 동일).
  - **후속 조건(기록만 — 지금 만들지 않는다)**: `code` 값으로 분기해야 하는 소비자(예: 자동 재시도 클라이언트)가 실제로 생기면, 그때 `UPSTREAM_ERROR`(502)를 계획서에 먼저 확정한 뒤 신설한다. 현재는 코드 신설이 **프론트 유니온 타입 수정만 유발하고 얻는 것이 없다.**
- **페이지네이션**: `?page=1&size=50` → `{ "items": [...], "total": 231, "page": 1, "size": 50 }`
- **날짜**: ISO 8601, 서버 로컬(Asia/Seoul) 기준. DATE는 `YYYY-MM-DD`.
- **소프트 삭제**: 삭제된 문서(`is_active=0`)는 모든 목록에서 기본 제외, `?include_inactive=1`로 노출.
- ID는 정수 PK. `doc_no`(DOC-0001)는 표시·반입 참조용.

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
- **오류 구조화**: convert/regenerate 잡 상태 응답에 `error_info` 추가 — `{kind: 'rate_limit'\|'auth'\|'not_installed'\|'timeout'\|'other', limit_kind?: 'session'\|'daily'\|'weekly'\|'model'\|'overall', resets_at?, message(사람이 읽는 한국어), action(다음 행동 안내), fallback_available: bool}`. (S10: kind에 `'parse_failed'` 추가 — 사이트 어댑터 파싱 실패, §4.13. **S13: `'invalid_output'` 추가 — 아래. S14: `'unsupported_format'` 추가 — qnet의 PDF 없는 게시물(ZIP·HWP), §4.13.**) **CLI/API 원문 JSON은 사용자에게 노출 금지.**
  - **`alternatives`(프론트 대안 버튼 힌트, S10 신설)**: 값은 **`'url_import'` · `'file_import'`(S14 추가) · `'other_adapter'`(사문화 — 단일 어댑터라 서버가 더 내려보내지 않지만 값 자체는 남겨 둔다)**. `unsupported_format`·상류 실패 계열은 기본이 `['file_import','url_import']`(원본이 이미 `sources/`에 있으므로 **파일 반입이 첫 번째 행동**), `parse_failed`는 `['url_import']`가 기본. 프론트는 **아는 값만 버튼으로 렌더하고 모르는 값은 무시**한다(전방 호환). CLI 429의 `result` 문자열에서 한도 종류·리셋 시각을 파싱한다.
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

## 5. 화면 상세 (12개)

라우팅: React Router. 모바일(<768px)은 하단 탭바(홈/커리큘럼/퀴즈/**복습**/오답노트 — 복습 탭은 S9, F36-②: 홈 경유 없이 오늘의 복습 직행) + 트리 드로어.

**문서 3대 공용 모듈(S9, F37 구현 원칙)**: **DocViewer**(Markdown 렌더 + 문제 정답 가림) · **QuizCard**(풀이+채점+해설) · **DocEditor**(작성/수정 폼). 앞 둘은 이미 공용(퀴즈/학습/복습/재도전 재사용 중) — S9에서 **DocEditor를 문서 상세 전용 폼에서 모달/패널 모듈로 분리**해 커리큘럼·탐색·검색 결과·오답노트 어디서든 "그 자리에서 보고·풀고·수정"이 되게 한다.

**공통 레이아웃 — 사이드바 접힘(S7, F33)**: 태블릿·PC(≥768px)의 좌측 사이드바에 접힘 토글(« / »).
- 접으면 **아이콘 전용 레일**(라벨 숨김, `title` 툴팁 유지) — 완전 숨김이 아니라 레일 유지: 다시 펼칠 진입점이 항상 보이고, 내비게이션은 한 번의 클릭 거리를 유지.
- 상태: zustand `sidebar` 스토어 + **localStorage `sidebar`**(`'expanded' | 'collapsed'`) — 기기별 UI 선호이므로 서버 settings가 아닌 localStorage(theme 관례, §6).
- 저장값 없을 때 기본: **768~1023px(태블릿) = collapsed, ≥1024px(PC) = expanded.** 모바일(<768px)은 사이드바 자체가 없으므로 토글 미노출(하단 탭바 유지).

**도움말 진입점(S12, F39 — §4.15)**: 사이드바 **하단**에 "도움말" 항목(물음표 아이콘) — `/manual`을 **새 탭**(`target="_blank" rel="noopener"`)으로 연다(학습 중 화면·세션 상태를 떠나지 않게 — 앱 내 라우트 아님). 접힘 레일에서는 아이콘+`title` 툴팁. 모바일(<768px — 사이드바 없음)은 설정 화면의 매뉴얼 링크(§5.11)가 진입 경로(하단 탭바에 도움말 탭은 추가하지 않는다 — 탭 5개 유지).

### 5.1 홈 대시보드 — `/`
- **구성(우선순위 순)**: ① 이어하기 카드(최대 3, 탭하면 `/study/:categoryId`로 즉시 복귀) ② "오늘의 복습 N개" 버튼(S5) ③ 학습 히트맵(S4 — 당초 12주 고정, S7부터 반응형 주 수) ④ D-Day 배지들(시험 분류 + 임의 D-Day 병합 — §4.8, S4 완성) ⑤ 북마크 모아보기 진입(S4)
- **API**: `GET /api/dashboard`
- **엣지**: 데이터 0건이면 온보딩 카드("기출 JSON을 반입해 시작하세요" → `/import`).
- **위젯 레지스트리(S7, F31)** — 홈 섹션을 9개 위젯 컴포넌트로 분리, id 고정:
  `continue`(이어하기) · `today_review`(오늘의 복습) · `dday`(D-Day) · `heatmap`(학습 히트맵 — 반응형 주 수) · `exam_progress`(시험별 진도 도넛) · `recent7d`(최근 7일 풀이/정답률) · `accuracy_trend`(최근 정답률 추이) · `weakness`(자꾸 틀리는 개념 Top 10) · `bookmarks`(북마크 모아보기 진입) · **`daily_start`(S9 — 아래, 레지스트리 10종으로 확장)** · **`streak`(S10 — 아래, 레지스트리 11종으로 확장)**.
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
- **스트릭 위젯(S10, F26) — `streak`**: "N일 연속 학습" 대표 수치 + 오늘 진행(목표 설정 시 "문제 12/20 · 15분/30분" 게이지, `goal_met`이면 달성 배지) + 최고 기록 소표기. 데이터 = `GET /api/stats/streak`(§4.13). 스트릭 0 **그리고** 목표 미설정이면 위젯 미표시(기존 0건 관례). 위젯 순서 기본값은 `heatmap` 바로 위 — 기존 저장 레이아웃에는 전방 호환 규칙(누락 id 보충)으로 자동 등장.
- **히트맵 목표 연동(S10, F26)**: heatmap 응답의 `goal_met=true` 날짜 셀에 **링(테두리) 강조** + 툴팁에 "목표 달성" 표기 — 토큰 기반 스타일, 목표 미설정이면 기존 렌더 그대로. 새 요청 없음(기존 heatmap 1회 조회의 필드 확장).
- **원탭 데일리 세션(S9, F36-①) — `daily_start` 위젯**: [오늘 공부 시작] CTA + 분량 예고("복습 12 + 2과목 Ch.3 이어하기 · 예상 25분" — `dashboard.today_review`·`continue[0]`·`today_review_minutes` §4.12). 탭 → 복습 큐 잔여가 있으면 `/review`로, 복습 완료 화면의 [이어하기로 계속]이 `/study/:categoryId`로 연결(F36-③, §5.7). 복습 0건이면 곧장 이어하기로. 복습 0건·이어하기도 없으면 위젯 미표시(기존 관례). 위젯 순서 기본값은 `continue`보다 위(첫 번째) — 기존 저장 레이아웃에는 전방 호환 규칙(누락 id = 표시·마지막 순서 보충)으로 자동 등장.
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
- **SRS 사람 말 표기(S9, F36-⑩)**: 복습 상태를 "3일 후 복습 예정"·"오늘 복습 대상" 형태로 표시 — EF·interval·repetitions 수치는 기본 숨김(접힘 "자세히"로만 노출). 데이터는 기존 `documents/{id}`의 `stats.srs` 그대로 — 표기만 변경.
- **본문 글자 크기(S9, F36-⑨)**: `settings:study.font_scale` 3단계를 본문 Markdown 렌더(문서 상세·학습 모드 공통)에 적용 — 토큰 기반 크기 클래스만 사용.
- **오류 신고·재생성(S6, F30)**: [오류 신고] 버튼(진입점: 문서 상세·학습 모드 §5.5·퀴즈 해설 §5.6) → 사유 입력 모달 → 재생성 잡 생성(진행 중 배지 표시) → 완료 시 **문서 상세에서 기존 vs 신규 나란히 비교** → [교체](apply — 같은 문서 유지) / [폐기]. 자동 덮어쓰기 없음.
- **API**: `documents/{id}`, PATCH, tags PUT, relations, bookmark, regenerate(S6, §4.10).

### 5.4 커리큘럼 — `/curriculum`, `/curriculum/:categoryId`
- `/curriculum`: 최상위(자격증) 카드 목록 → 시험 선택. 카드 목록에 [+ 시험 추가].
- `/curriculum/:id`: 과목→챕터 아코디언. 각 행 = 이름 + 진도바(done/total) + [이어하기|여기서 시작] 버튼. 완료 챕터는 ✓.
- **분류 관리(S4)**: 분류 편집이 탐색 §5.2 전용이 아니라 커리큘럼에서도 가능해야 한다 — 편집 모드 토글(연필 아이콘) 시 각 행/카드에 [추가(하위 분류)] [이름·시험일 수정] [이동(순서·부모 변경)] [삭제] 노출. 탐색과 동일한 공용 모달(CategoryFormModal·MoveCategoryModal·ConfirmDialog)과 기존 categories API를 재사용하며, 삭제 규칙(§4.1 — 하위·연결 문서 있으면 409)도 동일. 변경 즉시 트리·진도 invalidate.
- **챕터 파이프라인(S9, F37)** — "챕터"는 고정 계층이 아니다: **어느 깊이의 노드든 파이프라인 단위**이며 집계·출제 범위는 항상 노드+하위 트리 전체(§4.6 deep 원칙). 아코디언은 임의 깊이 중첩 렌더.
  - **노드 행**: 기존 진도바에 더해 **3단 진도**(개념 ✓ · 문제 ✓ · 기출 —, 공용 Stepper §5.9 재사용 — 완료 ✓/진행 ●/미시작 ○) + 타입별 개수 칩(개념 N·문제 N·기출 N — `tree?pipeline=1`의 `stage_progress`, §4.12) + 단계별 직접 진입 버튼 **[학습]·[문제]·[기출]**(순서 강제 아님 — 여정은 권장 동선). [학습]=`/study/:id`(개념 트랙), [문제]=`quiz/session{types:['question']}`, [기출]=`quiz/session{types:['past_question']}` — 셋 다 하위 포함.
  - **노드 펼침**: 타입별 탭(학습내용/문제/기출) 문서 목록 + 각 탭에 **[+ 문서 추가]**(현재 탭 타입이 기본값, 해당 분류 자동 연결 — DocEditor 모듈, documents POST + links 재사용) + 각 문서 행에 [편집](DocEditor 모달 — 문서 상세로 이동하지 않음). Stage 4의 "분류 편집도 커리큘럼에서" 원칙을 문서까지 확장 — **새 API 없음**.
- **API**: `categories/tree`(진도 포함, S9: `?pipeline=1` 3단 집계), `study/continue`, categories POST/PATCH/move/DELETE(S4 확장), documents POST/PATCH + links(S9 — 문서 추가·편집).

### 5.5 학습 모드 — `/study/:categoryId` (핵심 UX)
- **구성**: 상단 챕터 진행바(7/12), 본문 영역(개념=Markdown / 문제=퀴즈 카드 인라인), 하단 [◀ 이전] [다음 ▶].
- **동작**: 개념 문서에서 "다음" = `study/events{action:complete}` 후 다음 문서. 문제 문서는 풀어야(=attempts 성공 제출) "다음" 활성화. 진입·이동 시 `action:position`으로 resume 갱신.
- **챕터 완료 화면**: 정답률 요약 + 틀린 문제 목록("지금 다시 풀기" = wrong_only 미니 퀴즈) + [다음 챕터 ▶].
- **챕터 3단계 여정(S9, F37)**: ① 개념 트랙(기존 흐름 — `study-track deep=1&types=concept,question` 인터리브) 완료 화면에 **[문제 풀이로 이어가기]** → ② 챕터 연습문제 퀴즈(`quiz/session{types:['question']}`, 하위 포함) → 결과 요약에 **[기출로 마무리]** → ③ 챕터 기출 퀴즈(`types:['past_question']`) → **챕터 최종 완료 화면**: 단계별 정답률 요약(3단 Stepper) + 틀린 문제 재도전 + [다음 챕터 ▶]. 각 단계 건너뛰기 가능. 재개는 저장 없이 **next_stage 파생**(§4.12) — 커리큘럼 [이어하기]가 첫 미완료 단계로 진입, 개념 트랙 내 위치는 기존 resume_points 그대로. 해당 타입 문서 0개인 단계는 여정에서 자동 생략.
- **집중 모드(S9, F36-⑦)**: 헤더 토글로 사이드바·헤더 숨김 전체화면 — 상태는 화면 로컬(저장 안 함), Esc/토글로 복귀. 모바일은 하단 탭바 유지.
- **엣지**: 챕터에 문서 0개면 "문서를 연결하세요" 안내. 마지막 챕터 완료 시 과목 완료 화면.
- **완료 문제 재방문**: 이미 done인 문제로 돌아가면 마지막 풀이를 복원해 표시 — 내가 고른 보기(정오 색상)·정답·해설을 그대로 보여주고, [다시 풀기] 버튼으로 재제출 가능(새 attempt 누적, 이력 미니차트에 반영). 데이터는 `documents/{id}`의 `stats.last_attempt {my_answer, is_correct, created_at}`.
- **오류 신고(S6)**: 문제 카드에 [오류 신고] 버튼 → §5.3의 재생성 흐름으로 진입.
- **API**: `categories/{id}/study-track`, `study/events`, `attempts`.

### 5.6 퀴즈 — `/quiz` (설정) → `/quiz/run`
- **설정 화면**: 범위(트리 선택), 모드(순차/랜덤/오답만/북마크만), 문항 수(기본 `settings:quiz.default_count`).
- **실전 모의고사 진입(S11, F25)**: 설정 화면 상단 탭 [일반 퀴즈 | 실전 모의고사] — 모의고사는 §5.12 별도 흐름(일괄 제출 채점 — 즉시 채점인 이 화면과 경로 분리).
- **런 화면**: 문제 카드(지문 Markdown + 보기 4개 버튼), 선택 즉시 제출 → 정오 색상 + 해설 펼침 + 관련 개념 링크(S4) + [오류 신고](S6 — §5.3 재생성 흐름) → [다음]. 상단 진행바 + 경과 시간.
- **종료 요약**: 정답률, 소요 시간, 틀린 문제 리스트(각각 오답노트 메모 바로 입력).
- **키보드 단축키(S9, F36-④)**: 1~4 = 보기 선택(즉시 제출), Enter = 다음, B = 북마크 토글 — 입력 필드 포커스 중에는 무시. 해설 하단에 단축키 힌트 소표기.
- **틀린이유 원탭(S9, F36-⑤)**: 오답 직후 해설 화면에 4버튼(개념부족/실수/함정/시간부족) — attempts 응답의 `review_note_id`로 `PATCH /api/review-notes/{id}` 즉시 기록(선택 상태 토글 표시, 재탭 시 변경).
- **정답 자동 다음(S9, F36-⑥)**: `settings:quiz.auto_advance` on이면 정답 시 1.5초 후 자동 [다음](카운트다운 표시, 아무 키/탭으로 즉시 진행) — **오답은 항상 정지**(해설·틀린이유 기록 시간 보장).
- **상태**: 세션은 zustand 스토어(새로고침 시 세션 종료 확인 모달). 문항별 `time_spent`는 카드 표시~제출 시각.
- **API**: `quiz/session`, `attempts`.

### 5.7 플래시카드 — `/flashcards?category_id=` (S5) · 오늘의 복습 — `/review`
- 카드 뒤집기(탭/스페이스), 스와이프 좌="모른다"(q=1)/우="안다"(q=4). 남은 장수 + 오늘 큐 진행.
- **판정 undo 1회(S9, F36-⑧)**: 직전 판정을 [되돌리기]로 취소(오조작 SM-2 오염 방지) — 구현은 **전송 지연**(§4.12): 판정은 다음 카드 진입 시(마지막 카드는 세션 종료 시) 확정 전송, undo = 미전송 취소 후 카드 복귀. 새 API 없음.
- **복습 완료 화면(S9, F36-③)**: 오늘 큐 소화 완료 시 요약 + **"내일 N개 예정"**(`GET /api/srs/summary`) + **[이어하기로 계속]**(`study/continue` 첫 카드로 — daily_start 여정 §5.1의 후반부). **S10(F26·F36-③ 연계)**: 스트릭 배지 추가 — "N일 연속 학습 중"(`GET /api/stats/streak`), 오늘 목표 달성 시 달성 표기 — 내일 예고와 나란히 "오늘의 마무리" 블록.
- **D-Day 강화 모드(S11, F16)**: `srs/summary`의 `dday_boost` 발동 시 복습 헤더에 배지 — "『정보처리기사 필기』 D-7 · 오늘 복습 60개로 강화"(name·d_day·effective_limit). `ahead:true` 카드에는 "선행 복습" 소배지(§4.14 — 아직 due 전이지만 시험 대비로 당겨왔다는 표시). 미발동 시 기존 화면 그대로.
- **API**: `srs/today`(flashcard 타입 필터) 또는 범위 선택, `srs/answer`, `srs/summary`(S9).

### 5.8 오답노트 — `/review-notes`
- **구성**: 필터(분류 범위·틀린이유·해결여부) + 분류 계층 그룹 리스트(아래) — 카드 = 문제 요약, 내 메모 인라인 편집, 틀린이유 태그 선택, [극복] 토글, [재도전].
- **분류 범위 필터(S4)**: 평면 셀렉트가 아니라 퀴즈 설정(§5.6)의 범위 트리 선택과 동일 패턴(공용 컴포넌트화) — 선택한 범위의 **하위 전체 포함**(§4.6 하위 트리 필터).
- **계층 그룹 보기(S4)**: 리스트를 분류 경로(`category_path`) 기준 그룹 섹션으로 표시 — 상위 단위(대단위) 헤더 → 하위 단위(중/소/하위 단위) 소제목, 접기/펼치기, 그룹 헤더에 건수 배지. 여러 분류에 연결된 문서는 선택 범위 안의 경로를 우선, 없으면 첫 연결 경로 기준 1곳에만 표시. 어느 분류에도 연결 안 된 문서는 "미분류" 그룹.
- [재도전] = 해당 문서들로 `quiz/session{mode:wrong_only}`. 카드별 개별 [재도전] = `quiz/session{mode:sequential, document_ids:[해당 문서]}` — 누른 그 문제만 출제. **`wrong_only`가 아닌 `sequential`을 쓰는 이유**: wrong_only는 미해결 오답노트 조인이라 극복(resolved) 처리된 문제·오답노트 없는 문서는 0문항이 된다. 특정 문서를 지목하는 재도전(오답노트 개별·약점 위젯 §5.1)은 모두 `sequential + document_ids`.
- **API**: `review-notes`(S4: 하위 포함·경로), PATCH, `quiz/session`.

### 5.9 반입 — `/import`
- **3단계 위저드**: ① 파일 선택(JSON + 원본 선택) → ② 미리보기 표(항목별 상태 배지: 정상/중복 의심/오류. 중복은 기존 문서와 나란히 비교, 라디오: 건너뛰기/새로 추가/병합. 분류·관계 제안 체크박스) → ③ 반입 실행 → 결과 요약(생성 N, 병합 N, 건너뜀 N + 새 문서 바로가기).
- **공용 Stepper(S9, F36-⑪)**: 위저드 헤더 ①②③을 공용 Stepper 컴포넌트로 교체 — **지나온 단계(✓)는 실제 클릭으로 되돌아가기**(진행 중 결과가 버려지는 파괴적 복귀는 확인 후), 현재(●)는 강조, **미래(○)는 흐림+비클릭이 명확한 스타일·점선 연결**(눌릴 것처럼 보이지 않게). 토큰 기반 스타일. F37 3단 진도(§5.4)·챕터 최종 완료 화면(§5.5)에도 재사용.
- **엣지**: preview 만료(1h) 시 재업로드 안내. 오류 항목은 개별 오류 메시지 표시, 커밋에서 자동 제외. (**S13부터 만료는 먼저 디스크 복구를 시도한다** — §4.3.)
- **수동 반입 UX(S13, F40 — 계획서 §14 F40. 큐넷 실측 이후 **파일·URL 반입이 정본 경로**가 된 데 따른 정비)**:
  - **① 반입 대기열(F40-②)**: ①단계(선택)의 파일 입력을 **다중 선택(최대 10)** 으로 확장 → 선택한 파일 수만큼 기존 `POST /api/convert` 호출로 서버 큐에 적재(**새 API 0건 · 서버 동시 실행 1개 유지 — 병렬 금지**). 화면에는 파일 카드 목록(파일명 · 상태 배지 **대기 / 변환 중 / 검토 대기 / 반입 완료 / 실패**)이 뜨고, **진행 표시(LlmJobProgress)는 현재 처리 중 1건에만**(나머지는 배지만, 폴링 간격 완화). 완료 항목 [검토] → 기존 ②(미리보기) 단계로 진입 → 커밋 후 **[대기열로 돌아가기]**. 대기열은 ②·③ 단계에서 접힌 요약("검토 대기 N건")으로 유지. **Stepper 단계 수는 늘리지 않는다**(대기열은 ①단계 안에 산다). 잡 기록은 localStorage **배열**로 보존(기존 단건 레코드는 읽기 시 1건 큐로 승격 — 호환) → 새로고침·재접속 후 목록·상태 복원. 실패 항목은 목록에 남기고 [API로 재시도]·[건너뛰기](파일 소스는 새로고침 후 재선택 안내 — 기존 문구 재사용).
    - **`previewId`를 큐 레코드에 함께 영속(S13 구현 확정)**: 잡 완료 시 받은 `result_preview_id`를 localStorage 큐 항목에 저장한다. 잡 레코드는 서버 메모리라 만료·재시작 후 `GET /api/convert/{job_id}`가 404가 되는데, **preview_id만 남아 있으면 F40-①의 디스크 복구로 검토를 이어갈 수 있다**(잡 소실 = 검토 불가가 되지 않게). 즉 큐가 추적하는 1차 키는 잡이지만, **검토 단계의 1차 키는 preview_id**다.
    - **URL 반입도 같은 대기열로 통합(S13 구현 확정)**: URL 반입(F35-1)은 별도 단건 추적을 두지 않고 파일 항목과 같은 큐 레코드(소스 종류만 `file|url`로 구분)로 관리한다 — **폴링·재시도·새로고침 재개 코드의 이원화를 막는 것이 목적**. 화면 구성(탭 4종 · Stepper 3단계)은 불변이며, URL 탭에서 시작해도 결과는 같은 대기열 목록에 나타난다.
    - **10개 상한의 기준(S13 구현 확정)**: **"현재 대기열에 남아 있는 항목 + 이번에 새로 선택한 항목"의 합계**로 판정한다(신규 선택분만 세지 않는다) — 반입 완료·건너뛴 항목을 정리하면 다시 걸 수 있다. 초과 시 추가하지 않고 안내만 띄운다.
    - **알려진 한계(S13 — 명시)**: **처리 중인 1건은 취소·건너뛰기 불가**. 서버에 잡 취소 API가 없고(§4.10 잡 큐 계약) 이 단계에서 신설하지 않기로 했으므로(YAGNI — 동시 1개라 곧 끝난다), 취소·건너뛰기는 **아직 시작하지 않은 대기 항목에만** 노출한다. 화면·매뉴얼에 한계로 적는다.
  - **② 분류 경로 지정(F40-③)**: 시작 화면(파일·URL 공통)에 접이식 **"분류 경로 지정 (선택)"** — 기존 노드는 `CategoryScopePicker` 재사용으로 고르고 뒤에 회차 등 하위 경로를 텍스트로 덧붙인다(완성 경로 미리보기 문자열 표시 — 오타를 시작 전에 드러낸다) → `POST /api/convert`의 `category_path`(§4.11). 대기열에서는 **"모든 파일에 같은 상위 경로 적용"** + 파일별 마지막 칸(회차)만 개별 입력. **제안 고정일 뿐 확정은 ②단계 승인**(R7).
  - **③ 복구·내려받기(F40-①)**: 미리보기가 디스크에서 복구된 경우 상단에 소표기("이전 미리보기를 복구했습니다 — 중복 판정은 현재 DB 기준입니다", §4.3 `recovered`). ②단계와 실패 화면에 **[변환 JSON 내려받기]**(`GET /api/import/preview/{id}/json`) — 최악의 경우에도 JSON을 손에 쥐고 "반입 JSON 파일 선택" 경로로 이어갈 수 있다. **노출 조건(S13 구현 확정)**: 보존본이 존재하는 경로 = **convert·fetch 잡에서 온 preview에만** 버튼을 렌더한다. 사용자가 직접 올린 JSON의 preview는 보존 대상이 아니라 눌러도 404이고, 애초에 파일이 사용자 손에 있으므로 버튼 자체를 두지 않는다(§4.3).
  - **④ 잘림 안내(F40-④)**: `error_info.kind:'invalid_output'` 렌더 1종 추가(§4.11) — 사람 말 메시지 + [파일 나눠서 다시 올리기](시작 화면 복귀). 원문(raw) 미노출, 색상은 토큰만.
- **변환 신뢰 게이트 배지(S15 예정, §4.17 ⑤·⑥)**: ②(미리보기) 표에 경고 배지 3종 — **`solved`**(정답을 LLM이 풀어 채움 — `answer_source:"solved"`) · **창작 의심**(`fabrication_suspect` — 지문·보기가 원본 추출 텍스트와 불일치) · **대조 불가**(`match_unavailable` — 원본 텍스트 추출 불가). 앞 둘은 **기본 반입 제외(체크 해제)** — 항목별 명시 승인 시에만 포함, 대조 불가는 배지 + 상단 안내 1줄(기본 포함 유지). 변환 파이프라인(convert·fetch) preview에만 나타난다(직접 업로드 JSON은 비적용 — §4.17). 색상은 토큰만.
- **사이트에서 가져오기(S10, F35-2)**: 반입 화면 진입 방식에 [파일]·[URL](S8)과 나란히 **[사이트에서 가져오기]** 추가 → 공용 Stepper(S9, F36-⑪ 재사용) 4단계 서브플로:
  - **상태(S13 → S14 갱신)**: S13 종료 시점에는 등록 어댑터가 **qnet 스텁 1개(`available:false`)** 뿐이라 이 탭이 **"준비 중" 안내 + [URL로 반입]·[파일로 반입] 대안 버튼**만 렌더했다. **S14 완료 후에는 서비스키 등록 여부가 그 자리를 결정한다** — **미등록이면 같은 안내 화면**(문구만 "설정 > 데이터에서 공공데이터포털 서비스키를 등록하세요" + 설정 링크, 대안 버튼 유지), **등록되면 아래 ①~④ 서브플로가 그대로 살아난다**. 두 상태 모두 `fetch/adapters` 응답 메타로만 갈린다(빈 화면·오류 금지).
  - ① **자격증 검색·선택** — `GET /api/fetch/certs?q=`(어댑터 병합 결과, 출처 사이트 배지 표시). **S14: 결과 0건은 오류가 아니라 안내**("이 종목의 공개문제가 없습니다 — 필기·필답형은 이 API 범위 밖입니다", 실측 근거는 계획서 §14 F35-3)
  - ② **회차 선택** — `POST /api/fetch/exams` 목록: 회차 라벨 + 어댑터 배지(**S13: 항상 큐넷 1종**, `also_on`이 비어 있으므로 대안 출처 소표기는 렌더되지 않는다 — 렌더 분기 자체는 남겨 둔다) + 문항 수(미상이면 "약 60문항 가정") + **"이미 반입됨" 배지**(`imported` — S14: 연도만/식별 불가 회차는 분류 경로를 만들지 않으므로 이 배지가 뜨지 않는 것이 정상). 한 번에 1회차 선택(라디오). **S14 안내문 토글**: 목록 하단에 **"안내문 N건 보기"** 토글 — 켜면 같은 요청을 `include_notices:true`로 다시 보내 `is_notice:true` 항목까지 표시하고, 그 항목에는 **안내문 배지**를 붙인다(§4.13). 기본은 숨김이며 **N건이 0이면 토글 자체를 렌더하지 않는다**(0건 관례). 어댑터 배지·목록은 `fetch/adapters`·`fetch/exams` 응답 메타 그대로 렌더 — 어댑터 추가·제거로 프론트 코드 변경이 없어야 정상(어댑터 격리 원칙 검증 겸용. S13 예외: 어댑터 id 유니온 타입·이름 폴백 맵만 정리).
  - ③ **예상 사용량 확인** — `estimate`(문항 수·대략 입력 토큰·가정치 여부) + 사용 엔진(auto/cli/api — §4.11 계약)과 **한도 기억 경고 배너(S8 재사용)** + **고정 고지: "개인 학습 전용 — 수집물 재배포 금지"**. 확인 없이는 실행 불가.
  - ④ **실행** — `POST /api/fetch/import`(목록 응답의 `exam_key`를 그대로 전달 — §4.13) → 기존 진행 패널 재사용(단계 스텝에 '사이트 수집' = `fetching` 추가, 경과·토큰·ETA·새로고침 안내 그대로) → 완료 시 `result_preview_id`로 **기존 위저드 ②(미리보기)에 합류** — 이후 중복 비교·분류 제안·커밋은 기존 흐름 그대로. **S14: 잡 응답의 `notes`(§4.10)가 비어 있지 않으면 미리보기 상단에 소표기로 그대로 나열**(예: 도면 묶음 ZIP 동시 저장 안내) — 문자열 가공·조건 분기 없이 출력만 한다.
  - 실패 시: `error_info` 렌더(§4.11 규칙) — `parse_failed`면 [URL로 반입]·[파일로 반입] 대안 버튼(**S13: [다른 어댑터로 재시도]는 사문화** — `also_on`이 항상 비어 있어 렌더되지 않는다). **S14**: `unsupported_format`이면 "원본은 sources/에 저장됨" 안내 + [파일 반입으로 이어가기] 버튼(ZIP은 "압축을 풀어 PDF/이미지 반입", HWP는 "한글→PDF 변환 후" — §4.13 비지원 포맷 정책). 버튼 구성은 `error_info.alternatives`(`file_import`·`url_import`, §4.11)를 따르고 **모르는 값은 무시**한다. 원문 HTML/XML 미노출. **S14 상류 실패**: 검색·목록 단계에서 쿼터 초과·키 오류가 나면 잡이 아니라 **HTTP 502 + 사람 말 `message`**(§3)로 오므로, 이 문구를 **0건 안내와 다른 오류 배너로** 렌더한다 — "결과 없음"으로 보이게 하면 안 된다.
  - **S13·S14 프론트 변경 최소 원칙**: 사설 어댑터 제거(S13)·qnet 실가동(S14) 모두 ①~④ 스텝의 렌더 로직을 바꾸지 않는다 — 응답 메타(`available`·배지·목록)를 그대로 렌더. **허용되는 프론트 변경은 딱 둘**: 어댑터 id 유니온을 `'qnet'`으로 좁히기(`FetchAdapterId`)와 이름 폴백 맵에서 제거된 어댑터 항목 삭제 — 유니온을 좁히면 타입 검사가 잔존 참조를 잡아 준다(DoD "참조 0건" 보조 수단).
- **API**: `import/preview`, `import/commit`. S6: "파일만 던지면 변환부터"(`convert`) 버튼 추가. S10: `fetch/*`(§4.13). **S13: `convert`의 `category_path?`(§4.11) · `import/preview/{id}`(복구) · `import/preview/{id}/json`(내려받기, §4.3)**. **S14: `fetch/exams`의 `include_notices?` · 잡 응답 `notes`(§4.10) — 서비스키 등록(`fetch/qnet-key`)은 설정 화면(§5.11)이 담당한다.**

### 5.10 인쇄 뷰 — `/print?type=&category_id=&options=`
- **종류 3종**(계획서 §12): 개념 정리본 / 문제집(문제 앞·해설 뒤 분리) / 오답노트.
- 옵션 패널(화면에서만 보임): 해설 포함/제외, 풀이 여백, 기간 필터(오답노트). 본문은 A4 폭 렌더 + `@media print` 규칙.
- **API**: `study-track`·`documents/batch`·`review-notes` 조합 (전용 API 없음).

### 5.11 설정 — `/settings`
- 테마(라이트/다크/시스템 — localStorage, §6), 복습 큐 상한, 기본 문항 수, D-Day 관리(S4, 아래), 백업/복원(S6), 태그 병합 도구(S6 — S9에서 태그 관리자로 승격).
- **6그룹 구성(F38 — 골격은 S8 선반영 완료, S9는 내용 완성)**: 좌측 목차(카테고리 점프, 모바일 아코디언) + ① **학습**(복습 상한·기본 문항 수 + S9: 글자 크기 `study.font_scale`·정답 자동 다음 `quiz.auto_advance` + **S10: 일일 목표** — 문제 수 `goal.daily_questions`·시간(분) `goal.daily_minutes` 숫자 입력, 비움/0 = 목표 없음, 저장 시 스트릭·히트맵 위젯 invalidate. "시간은 문제 풀이 시간 기준" 도움말 소표기 §4.13 + **S11: D-Day 복습 강화 토글** `srs.dday_boost`(기본 on) — "시험 14일 전부터 복습 상한을 늘리고 임박 시험 범위를 우선합니다" 도움말, §4.14) ② **일정**(D-Day 관리) ③ **태그·분류**(태그 규칙 + S9: **태그 관리자** — 아래) ④ **LLM 엔진**(S8 §4.11 — **S15 예정**: 카드 2장 고정 → 레지스트리 목록 렌더 + ▲▼ 우선순위 + Codex 온보딩 마법사·프라이버시 고지, §4.17 ⑦) ⑤ **데이터**(백업/복원·CSV 내보내기 + S9: 복원 후 강제 리로드 모달 §4.12 + **S14(구현 완료 2026-07-27): 큐넷 오픈API 카드** — 공공데이터포털 서비스키 등록(입력 시 즉석 검증 — 실패 사유 표시)·등록 후 마지막 4자리 마스킹 표시·삭제, 발급 방법(공공데이터포털 활용신청) 안내 소표기 + **커버리지 한계 한 줄**(실기 공개문제 위주 — 필기·필답형은 파일·URL 반입)로 등록 전에 기대치를 맞춘다. `fetch/qnet-key` §4.13 — F34 API 키 카드 UX 미러. 배치 근거: 데이터 유입(반입 소스) 계열 — **F38 6그룹 수 불변**, 그룹 내 카드 추가만) ⑥ **화면**(테마).
- **매뉴얼 링크(S12, F39)**: 좌측 목차 **하단**(모바일 아코디언 하단)에 "사용 설명서 열기" 링크 — `/manual` 새 탭(`target="_blank" rel="noopener"`, §4.15). **7번째 그룹이 아닌 단순 링크**(F38 6그룹 구조 불변). 모바일(<768px)에서는 이것이 유일한 매뉴얼 진입 경로(§5 공통 레이아웃 — 사이드바 없음).
- **태그 관리자(S9, F38)** — 병합 "도구"(TagMergeTool)를 관리 "화면"으로 승격:
  - **목록 테이블**: 이름 · 사용 문서 수(doc_count) · 규칙 사용 배지(rule_count>0) — 검색·정렬(이름/사용 수). 행 클릭 = 사용 문서 보기(탐색 `?tag=` 필터 링크).
  - **유사 태그 제안**: `GET /api/tags/similar` 결과를 "『정규화』↔『정규 화』 병합할까요?" 목록으로 — [병합](방향 선택 = 남길 이름 지정, 기존 `tags/merge`) / [무시](세션 내 숨김 — 저장 안 함, 과설계 방지).
  - **행 액션**: 이름 변경(`PATCH /api/tags/{id}` — 중복이면 409를 "병합을 사용하세요"로 안내) · 병합(대상 선택) · 삭제(**미사용만** — 사용 중이면 비활성+사유 툴팁).
- **D-Day 관리(S4)** — DDL 변경 없이 두 종류:
  - 시험 분류 D-Day: 트리에서 시험 분류 선택 → `exam_date` 추가/변경/제거 (`PATCH /api/categories/{id}` 재사용).
  - 임의 D-Day(접수 마감·발표일 등 분류와 무관): 라벨+날짜 추가/수정/삭제 — `settings:ddays.custom = [{id, label, date}]` (settings GET/PUT 재사용).
  - 홈 D-Day 배지는 두 종류를 병합한 `dashboard.ddays`(§4.8) 사용.
- **API**: `settings`, `categories` PATCH, `backups`(S6).

### 5.12 모의고사 — `/exam` (구성) → `/exam/run` → 결과 (S11, F25)

- **구성 화면**: 진입은 퀴즈 설정(§5.6) 탭. ① 트리에서 시험 노드 선택 → ② **직계 자식 체크리스트**로 과목 구성(문제 보유 노드는 기본 전체 선택 — 회차 노드가 섞여 있으면 사용자가 해제. **회차 노드 1개만 선택 = "회차 그대로" 모의**: 전체 문항·순차가 기본값으로 전환) → ③ 과목당 문항 수(기본 20) · 제한 시간(기본 총 문항 × 1.5분 자동 계산, 수정 가능) · 합격선(기본 40/60 표기 "과목 40점 과락 · 평균 60점 합격", 수정 가능) · 출제 순서(랜덤/순차) → [응시 시작] = `POST /api/exam/session`.
- **런 화면(`/exam/run`)**: **QuizCard의 문항 렌더(지문 Markdown + 보기 버튼)를 재사용하되 채점 상호작용은 제거** — 보기 선택 = 답안 저장만(정오 색상·해설·오답노트 없음), 답 변경·이전/다음 자유 이동. 우측(모바일 하단 시트) **문항 네비게이터**: 과목 구분 + 문항별 응답/미응답 표시, 탭 이동. 상단 **카운트다운 타이머(프론트 주도 — §4.14)**: 잔여 5분 경고색(토큰), 0초 도달 시 확인 없이 **미응답 포함 자동 일괄 제출**. [제출] 버튼 = 미응답 N개 경고 확인 모달 후 `POST /api/exam/submit`. 세션은 zustand `examSession`(제출 전엔 서버 무상태) — 새로고침·이탈 시 "시험이 사라집니다" 경고(beforeunload + 라우터 가드).
- **결과 리포트**: 총점 + 합격/불합격 배지, **과목별 점수 바**(subject_min 컷 라인 표시, 과락 과목 `--wrong` 계열 배지), 소요 시간. **문항별 리뷰**(제출 후이므로 정답·해설 공개 — results 기반): 내 답 vs 정답, 해설 펼침, 오답 문항엔 **틀린이유 원탭(F36-⑤ 재사용** — `review_note_id`로 PATCH). 하단 [틀린 문제 재도전](`quiz/session{mode:'sequential', document_ids}` — §5.8 관례) · [오답노트 가기] · **최근 응시 이력**(`GET /api/exam/history` — 점수 추이 소표기).
- **엣지**: 선택 과목 전부 0문항 → 시작 불가 안내(422 메시지 렌더). 0문항 과목은 구성 화면에서 미리 비활성(개수 칩 0). 결과 화면은 리포트 데이터가 examSession에 있는 동안만 — 이탈 후엔 이력(history)에서 요약만 확인 가능(당시 상세 리포트 재열람은 저장하지 않음 — R15).
- **API**: `exam/session`, `exam/submit`, `exam/history`(§4.14), `quiz/session`(재도전).

## 6. 테마 · 디자인 토큰 (F28)

- Tailwind `darkMode: 'class'` + `styles/tokens.css`의 CSS 변수 이중 구조. 컴포넌트는 **토큰만 참조**(`bg-surface`, `text-primary` 등) — 색상 하드코딩 금지.
- 토큰(라이트/다크 각 1세트): `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-soft`, `--on-accent`(accent 배경 위 텍스트 — `text-white` 대체), `--correct`, `--wrong`, `--warning`, 히트맵 5단계.
- 테마 스토어: `theme = 'system' | 'light' | 'dark'` (localStorage `theme`). system이면 `prefers-color-scheme` 미디어쿼리 구독. `<html>`에 `class="dark"` 토글.
- 인쇄 뷰는 테마 무시하고 항상 라이트로 렌더.

## 7. 프론트 상태 관리

- **서버 상태**: TanStack Query — 캐시 키 = 리소스 경로. 변경(mutation) 후 관련 쿼리 invalidate.
- **로컬 상태**: zustand 5개 — `quizSession`(문항·답안·타이머), `flashcardSession`, `examSession`(S11 — 문항·답안·카운트다운·리포트, 제출 전엔 전부 로컬(서버 무상태 §4.14), persist 없음), `theme`, `sidebar`(S7 — `'expanded'|'collapsed'`, localStorage `sidebar` persist, 기본값 규칙은 §5 도입부).
- 홈 레이아웃(S7)은 스토어를 두지 않는다: 저장본은 서버 `settings:home.layout`(TanStack Query), 편집 중 드래프트는 홈 컴포넌트 로컬 상태 — [완료] 시에만 PUT, 취소 시 폐기.
- 낙관적 업데이트는 북마크·진도 완료(체감 속도 중요)에만 적용, 나머지는 단순 invalidate.

## 8. 비고

- 서버 채점 원칙: 정답·해설은 `quiz/session`·`exam/session` 응답에 포함하지 않는다 (풀기 전 노출 방지, 기록 무결성).
- attempts 저장과 SM-2 갱신·오답노트 생성은 하나의 트랜잭션 (모의고사 일괄 제출은 **배치 전체가 한 트랜잭션** — §4.14).
- 이 문서와 실제 구현의 갭은 각 stage 완료 시 `/pdca analyze`로 점검.
