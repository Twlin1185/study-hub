# Study Hub — 상세 설계 (API 명세 · 화면 상세)

> (2026-07-31 문서 구조 변경 — 판번 유지: §4 API 명세 → `study-app.design.api.md`, §5~7 화면·테마·상태 → `study-app.design.screens.md`로 **내용 이동만** 분할. § 번호·[S#] 태그는 그대로 — "설계 §4.x" 참조는 api 파일, "§5~7"은 screens 파일에서 `### <번호>` Grep)
> 상태: **Design v1.20** — v1.19 대비: **§4.18 ②-1·⑥ 보강(S16 재검토 통과(DoD 6/6) 시 지적된 문서-코드 불일치 1건 해소 — 2026-07-29, 문서만)**: ① **암호화 OOXML 판별 세칙 명문화** — OLE CFB 매직 + 확장자 `.docx`/`.xlsx` = **ECMA-376 암호화 OOXML로 판정 → C군 `unsupported_format`이 아니라 `parse_failed`**(④의 암호 파일 확정을 실현하는 세칙 — 확정 문구·원본 sources/ 저장 포함, ⑥ 표 비적용 주석 추가) ② **hwpx 휴리스틱 알려진 한계 기록** — zip 내부 `mimetype == application/hwp+zip` 또는 최상위 `Contents/` 존재로 판정(구현 확정), `Contents/`만으로는 일반 zip이 hwp 문구로 오안내될 수 있음(C군 거부 자체는 동일 — 강화 여부는 후속 결정). 계약 형태·DDL 증감 0.
> (v1.19: v1.18 대비: **§4.18 ④·⑥ 보강 + §4.11 주석 (S16 구현의 Opus 검토 적발 2건 해소 — 2026-07-29, 문서 확정·코드 지시는 별도)**: ① **`parse_failed` 종료 시에도 원본을 `sources/`에 저장 후 종료**(`unsupported_format`과 대칭 — 손상·암호 파일도 사용자의 원본 자료이고 잡 tmp는 정리되므로 저장하지 않으면 서버에 남지 않는다. stage-16 DoD 2 문면과 정합 — 종전 §4.18 ⑥이 저장을 unsupported 한정으로 읽히게 한 어긋남 해소) ② **convert 잡(파일·URL 반입)에서 발생한 `unsupported_format`·`parse_failed`의 `alternatives` = 빈 배열 확정**(실패한 반입 경로 자신([파일로 반입] → 같은 화면 회귀)이나 같은 판별·파서에 다시 걸릴 경로는 대안이 아니다 — **fetch 잡 발생분은 기존 기본값 유지**, §4.11 계약 불변). DDL·Alembic·엔드포인트 증감 0.)
> (v1.18: v1.17 대비: **§4.18 신설(S16 — F42 다양한 문서 포맷 반입, 계약 확정 2026-07-29 — stage-16 선행 절차 D1·D2·D3 해소분. 문서만·코드 0)**: ① 지원 포맷 매트릭스(A군 md·txt·html·xml·**csv** 직투입 / B군 docx·xlsx 서버 추출 / C군 hwp·zip·doc·xls·판별 불가 = 구조화 거부) ② 판별 규칙(**매직 바이트 우선** — zip 내부 판별(docx/xlsx/hwpx도 zip)·OLE 시그니처·텍스트성 검사, content-type·확장자 사칭 방어) ③ 인코딩 판별 확정(utf-8 BOM→utf-8→cp949, chardet류 불도입 — **cp949는 CLI 전달 시 utf-8 재인코딩**) ④ 파서 채택(docx=**python-docx**·xlsx=**openpyxl**, `==` 정확 핀) + xlsx **시트별 Markdown 표**(시트 10·행 500·열 50 상한) + 추출기 `services/doc_extract.py` 분리(원문 대조 §4.17 ⑥ 재사용) + 파서 예외 = **`parse_failed` 재사용 확정** ⑤ **`error_info.kind:'too_large'` 신설**(추출·디코드 텍스트 **200,000자** 상한 — LLM 호출 전 비용 0 차단, 분할 권고 — 서버측 자동 분할 금지) ⑥ `unsupported_format` 포맷별 폴백 **확정 문안**(hwp→PDF 저장·zip→압축 해제·doc/xls→docx/xlsx 저장) ⑦ URL content-type 화이트리스트 확장(xml 2종·text/csv·officedocument 2종 — `application/octet-stream`은 미허용 유지). **DDL 변경 0건·Alembic 0건·신규 엔드포인트 0건 재확인(§4.18 말미 근거).**)
> (v1.17: v1.16 대비: **§4.17 신설(S15 — F41 멀티 벤더 LLM 엔진, 계약 확정 2026-07-28 — 착수 게이트 G3 해소. 구현은 게이트 G2 통과 후)**: ① **엔진 레지스트리** — 엔진 id 3종(`claude-cli`·`claude-api`·`codex-cli`)·항목 인터페이스(진단/호출/분류기/한도·헬스 키)·legacy `cli|api` 별칭의 **읽기 시 매핑**(마이그레이션 없음) ② `GET /api/llm/status`를 **엔진 배열로 교체**(기존 `cli`/`api` 톱레벨 필드 **제거 확정** — 소비처 전수 확인 근거는 §4.17 ②) ③ **폴백 = 우선순위 목록**(`llm.priority` 배열화, `error_info.fallback_engine` 추가) ④ codex-cli 어댑터·설치 계약(신규 엔드포인트 **`POST /api/llm/engines/{id}/install` 1개**) ⑤ **변환 신뢰 게이트(전 엔진 공통, R7 보강)** — 계획서 §8.2 v1.1 개정 연동(`answer_source` 필수·순수 JSON 위반=오류·`content` 필수·객관식 `answer` 번호만) + preview `warnings` 필드 ⑥ **원문 대조 검사 알고리즘 확정**(정규화·12자 조각 커버리지 ≥0.6·대조 불가 판정) ⑦ S8 화면(§5.11 그룹 ④) 확장 — 카드 목록 렌더·▲▼ 우선순위·Codex 온보딩·프라이버시 고지. **DDL 변경 0건·Alembic 0건 재확인(§4.17 말미 근거).**)
> (v1.16: v1.15 대비: **S14(큐넷 공식 오픈API) 구현 완료(2026-07-27)에 따른 계약 확정 반영 — 엔드포인트 증감 0건, 기존 응답에 필드 추가만**: ① `POST /api/fetch/exams` **요청 `include_notices?`(기본 false)** + **응답 항목 `is_notice`** — 안내문 게시물 기본 숨김 + "안내문 N건 보기" 토글(같은 24h 캐시에서 파생 — **추가 API 호출 0건**) ② `GET /api/convert/{job_id}` 응답에 **`notes: string[]`(기본 `[]`)** — 성공 소표기(예: ZIP 동시 저장). **문구는 서버가 완성해 내려준다**(프론트 포맷 분기 금지) ③ `error_info.kind`에 **`unsupported_format` 확정** + `alternatives`에 **`'file_import'`** 값 추가 ④ `GET /api/fetch/adapters` qnet 항목에 `key_registered`·`key_suffix?`(예고대로 구현) ⑤ **`exam_key` 3형태 확정** — `YYYY-MM-DD`(폴더 파생 O) · **`YYYY`(연도만 — 폴더 파생 X, 회차를 창작하지 않음)** · `qnet-{artlSeq}`(식별 불가). 뒤 두 형태는 **`imported=false` 고정**·분류 경로 미생성 ⑥ **§3에 상류 실패 규약 명문화**(외부 공식 API 거절 = **HTTP 502 + code `INTERNAL`**, 코드 집합은 4종 유지 — 판단 근거는 §3). **DDL 변경 없음 · Alembic 0건.**)
> (v1.15: v1.14 대비: **S13 구현 완료(2026-07-27)에 따른 확정 사항 반영 — 계약 변경 없음, 명세 보강만**: ① §5.9 대기열이 **`previewId`를 localStorage에 함께 영속**(잡 레코드가 만료·404가 된 뒤에도 F40-① 디스크 복구로 검토를 이어가기 위함 — 검토 단계의 1차 키는 preview_id) ② **URL 반입을 파일 대기열로 통합**(폴링·재시도·재개 코드 이원화 방지 — 탭 4종·Stepper 3단계는 불변) ③ **10개 상한 = "대기열 잔여 + 신규 선택" 합계 기준** ④ **처리 중인 1건은 취소·건너뛰기 불가**를 알려진 한계로 명시(서버에 잡 취소 API 없음 — 신설하지 않음) ⑤ **[변환 JSON 내려받기]는 보존본이 있는 경로(convert·fetch 잡 preview)에만 노출**(직접 업로드 preview는 404 — §4.3). **DDL 변경 없음 · 엔드포인트 증감 없음.**)
> (v1.14: **단계 재편(계획서 v0.17 — 큐넷 실측에 따른 우선순위 변경)**: ① 큐넷 오픈API 계약(서비스키 `fetch/qnet-key`·목록/상세·`unsupported_format`·설정 카드)의 단계 태그를 **S13 → S14**로 이관(**내용 삭제 없음** — 계약은 그대로, 착수 시점만 뒤로). 사설 어댑터 제거·단일 어댑터화는 **S13 유지**. ② **F40 수동 반입 UX 계약 신설(S13)**: §4.3에 **변환 결과 디스크 보존·복구**(`GET /api/import/preview/{id}` 캐시 미스 시 복구) + **`GET /api/import/preview/{id}/json`(내려받기, 신규 1개)**, §4.11 `POST /api/convert`에 **`category_path?`**(분류 경로 제안 고정 — 사이트 반입 지시 생성기 공유) + `error_info.kind`에 **`'invalid_output'`**(출력 잘림 오안내 수정), §5.9에 **반입 대기열**(여러 파일 연속 — 새 API 0건, 서버 동시 1개 유지)·분류 경로 입력·복구 표시. **DDL 변경 없음.**)
> (v1.13: **사이트 어댑터 단일화(S13 — 사설 어댑터 comcbt·cbtbank 제거, 계획서 v0.16 §14 F35-2 제거 이력)**: §4.13에서 어댑터 3종 목록·우선순위 병합(qnet>cbtbank>comcbt)·날짜 자연 키 병합·`also_on`/`refs` 대안 어댑터 재시도·level_hint 오병합 방지 조건을 **큐넷 단일 어댑터 기준으로 정리**. **계약 형태는 유지**(`GET /api/fetch/adapters`는 계속 **배열** 반환, `POST /api/fetch/exams` 항목의 `also_on`(항상 `[]`)·`refs`(단일 항목)·`exam_key?`도 필드 유지) — 프론트 변경은 어댑터 id 유니온 축소(`'qnet'`)와 이름 폴백 맵 정리뿐. §5.9 대안 어댑터 재시도 버튼은 사문화(빈 `also_on`이라 미렌더). DDL 변경 없음.)
> (v1.12: **S13(M13 큐넷 공식 오픈API) 계약**(§4.13 S13 갱신 — qnet 어댑터를 공공데이터포털 **"국가자격 공개문제 조회 서비스"**(getOpenQstList/getOpenQst)로 실가동: 서비스키 등록 `POST/DELETE /api/fetch/qnet-key`(secrets.json — F34 전례), `fileUrl` JWT 1시간 → **상세 조회·다운로드 같은 잡 연속 수행**, HWP 전용 회차 = 원본 저장 + `error_info.kind:'unsupported_format'` 신설, 병합 그룹 level_hint 동일 조건 명시. **기존 fetch 계약(adapters/certs/exams/import)·프론트 스텝 흐름 불변**) + §5.11 데이터 그룹 서비스키 카드·§5.9 실패 렌더 1종 추가)
> 이전 이력: v1.11 — S12 계약(§4.13 cbtbank FetchedExam 첫 실사용·날짜 자연 키 병합·`fetch/import` `exam_key?`, §4.15 `GET /manual`) · v1.10 — S11 계약 신설(§4.14 F25·F16) · v1.9 — S10 구현 실측 반영(comcbt PDF 경로, qnet available:false 스텁)
> 작성일: 2026-07-22 · 갱신: 2026-07-29
> 상위 문서: `docs/01-plan/study-app.plan.md` (Draft v0.24)
> 구현 계획: `docs/01-plan/stage-1-skeleton.plan.md` ~ `stage-13-fetch-cleanup-manual-import.plan.md`(S13) · `stage-14-qnet-openapi.plan.md`(S14) · `stage-15-multi-engine-codex.plan.md`(S15 — §4.17) · `stage-16-doc-formats.plan.md`(S16 — 착수 2026-07-29, §4.18)

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

## 파일 분할 지도 (2026-07-31)

| 파일 | 내용 |
|---|---|
| (이 파일) | §1 범위 · §2 프로젝트 구조 · §3 API 공통 규약 · §8 비고 — 모든 구현 에이전트 공통 선행 지식 |
| `study-app.design.api.md` | §4 API 명세(4.1~4.18, [S1]~[S16] 단계 태그) — 백엔드 구현 시 해당 절만 부분 읽기 |
| `study-app.design.screens.md` | §5 화면 상세(12개) · §6 테마 토큰 · §7 상태 관리 — 프론트 구현 시 해당 절만 부분 읽기 |

## 8. 비고

- 서버 채점 원칙: 정답·해설은 `quiz/session`·`exam/session` 응답에 포함하지 않는다 (풀기 전 노출 방지, 기록 무결성).
- attempts 저장과 SM-2 갱신·오답노트 생성은 하나의 트랜잭션 (모의고사 일괄 제출은 **배치 전체가 한 트랜잭션** — §4.14).
- 이 문서와 실제 구현의 갭은 각 stage 완료 시 `/pdca analyze`로 점검.
