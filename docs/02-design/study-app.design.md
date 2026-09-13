# Study Hub — 상세 설계 (API 명세 · 화면 상세)

> (2026-07-31 문서 구조 변경 — 판번 유지: §4 API 명세 → `study-app.design.api.md`, §5~7 화면·테마·상태 → `study-app.design.screens.md`로 **내용 이동만** 분할. § 번호·[S#] 태그는 그대로 — "설계 §4.x" 참조는 api 파일, "§5~7"은 screens 파일에서 `### <번호>` Grep)
> 상태: **Design v1.62** — v1.61 대비: **api §4.1 `[S50]` 구현 실측 확정 표기(18행 + 절 머리) + 실측 확정 2건 추기 + screens §5.2·§5.4 S50 실측 재개정 2곳(stage-50 분류 삭제 결함 수정 + 선택형 삭제 구현·검토·실측 완료 반영, 2026-09-13 — 문서만·API 계약 그대로 구현 · 구현 커밋 0883cbd + bdcb17d · 백엔드 diff = `routers/categories.py`·`services/category_service.py`·`schemas/category.py`·`tests/test_category_delete.py`(13건) · pytest 637 · invariant PASS(physical-delete 기준선 1→9 = 분류 행·링크·진도·이어하기·제안 물리 삭제 규약 D·E 정당분 · `documents` 무접촉) · `npm run build` 성공(엔트리 청크 무변) · Opus 검토 통과(치명·중요 0 · 경미 6 — 3 반영·3 기록) · 브라우저 실측 V-3 ⓐ~ⓕ + 390px 통과 · 잔여 = 사용자 실사용 게이트 DoD 6 · **v2.01.3 발행(stage-48·49와 한 발행 단위)**)**: ① **api 실측 확정 ⓐ** — 409 `detail.documents`는 **활성 문서 수(distinct)**(모달 "연결 n건"·`unlinked`는 링크 행 수 — 재귀 시 다중 연결 문서로 둘이 다를 수 있음 · 실노출은 트리 stale 시뿐) ② **api 실측 확정 ⓑ** — `skipped_duplicates`는 부모 중복 폐기뿐 아니라 **트리 내 다중 연결 dedup 폐기 행도 합산** → 항등 `unlinked + reparented + skipped_duplicates = 대상 트리 링크 행 수`(`study_progress` dedup은 카운터 미반영) ③ **screens 프론트 실측 확정 3건** — 요약 괄호 "(하위 포함 D건)"은 `D !== d`일 때만 · 루트 노드 라디오 "연결만 해제" 1개만 렌더 · 폴백 문구 `'삭제에 실패했습니다.'` = `useDeleteCategory` mutationFn 1곳(검토 경미 ④ 흡수). **DDL 0 · Alembic 0 · 신규 엔드포인트 0(기존 DELETE 확장 · 204→200) · 신규 의존 0 · 버전 영향 사소(v2.01.3 합류).** 정본 = `stage-50-category-delete.plan.md` §7.
> (v1.61: v1.60 대비: **api §4.1 `[S50]` 분류 삭제 선택형 계약 추기(18행 개정 + 절 신설) + screens §5.2·§5.4 S50 편성 추기 2곳(stage-50 분류 삭제 결함 수정 + 선택형 삭제 편성, 2026-09-13 — 문서만·코드 0·**착수 전** · 실측 재개정은 완료 시 v1.62)**: ① **`DELETE /api/categories/{id}` 선택 쿼리 `on_documents=unlink|reparent`·`recursive=1`** — 미지정 = 종전 409 그대로(후방 호환)이되 **활성 문서만 판정**(소프트 삭제 문서의 잔존 연결로 409 나던 결함 ① 수정) · `unlink` = 링크 행만 삭제(문서 무접촉 · 불변 규칙 3) · `reparent` = 최상위 대상의 부모로 링크 이관(문서당 1행 · 중복 = 부모 행 유지 · 루트 = 422 폴백 없음) · `recursive` = 하위 트리 분류 행만 물리 삭제 ② **FK 참조 정리 규약**(`PRAGMA foreign_keys=ON` 실측 — 진도 삭제/이관 · 이어하기 삭제 · `attempts.category_id` NULL/부모 · 제안 삭제 · **태그 규칙 = 409 사전 차단**) · 한 트랜잭션 · 응답 204→**200 통계** ③ **공용 `DeleteCategoryModal`**(3 페이지 리터럴 통합 — 실수치 요약 `doc_count` 직계 합산 · 하위 포함 체크 · 문서 처리 라디오 기본 "연결만 해제" · 옵션 0이면 단순 확인). **DDL 0 · Alembic 0 · 신규 엔드포인트 0 · settings 키 0 · 신규 의존 0 · 버전 영향 사소(사용자 확정 · v2.01.4 예정 — 48·49 미발행 시 v2.01.3 합류 여부는 완료 시 판정).** 정본 = `stage-50-category-delete.plan.md` §2.)
> (v1.60: v1.59 대비: **screens §5 S49 구현 실측 확정 표기 3곳(stage-49 모바일 전체 내비 드로어 + 코드 블록 구문 강조·복사 + 참조로 붙여넣기 구현·검토·실측 완료 반영, 2026-09-13 — 문서만·API 계약 무변·백엔드 diff 0 · pytest 624 · 헤드리스 s33/s40/s41/s47 무회귀 · 브라우저 실측 ⓐ~ⓔ 통과 · Opus 검토 통과(경미 3 반영) · 잔여 = 사용자 실사용 게이트 DoD 6 · v2.01.3 발행(stage-48과 한 발행 단위))**: ① **§5 공통 레이아웃 드로어(FB-8)** — 계약 그대로(배열 단일 출처 9 + LLM 작업·도움말 2 = 11항목 · 닫힘·active·새 탭·640px 무스크롤 · 데스크톱 diff 0) ② **§5.3 [참조 복사]** — 계약 그대로 + 검토 경미 2건(폴백 후 포커스·선택 복원 · 라벨 타이머 ref 해제) ③ **§5.16 S49** — **실측 정정 1건**: 강조 토큰 색 결선은 "다크 1규칙"이 아니라 **라이트 `var(--shiki-light)` + 다크 `var(--shiki-dark)` 2규칙**(코어 `.shiki`가 스킴 무관 항상 다크를 골라 라이트 대비가 깨짐 · 변수 참조만 · 리터럴 0) · 결선 지점 = `extensions.ts` `syntaxHighlighter` 정적 import(규약 B 실측 개정) · 라이선스 `@blocknote/code-block@0.54.0` **MPL-2.0**(전이 44종 = MIT 43 + MPL-2.0 1 · GPL 0) · **R37 실측 = 엔트리 1,583,878 B(+5,305 = 의존 유래 +3,860 ≤ 5 kB 통과 + 앱 셸 +1,445 · 신규 기준선) · 편집 청크 gzip 40.72→86.70 kB(shiki 엔진) · 지연 문법 14종 2,001,574 B·테마 22,583 B**. **DDL 0 · API 0 · 백엔드 diff 0 · 신규 의존 1.** 정본 = `stage-49-mobile-nav-code-highlight-ref-paste.plan.md` §7.)
> (v1.59: v1.58 대비: **screens §5 S49 편성 추기 3곳(stage-49 모바일 전체 내비 드로어 + 코드 블록 구문 강조·복사 + 참조로 붙여넣기 편성, 2026-09-13 — 문서만·코드 0·**착수 전** · 실측 재개정은 완료 시 v1.60) · api §4 무변(신규 API 0)**: ① **§5 공통 레이아웃 — 모바일 좌측 드로어 = 전체 내비 메뉴(FB-8)**: 사이드바와 같은 항목 배열(5+3+노트 — 단일 출처) + 하단 LLM 작업·도움말 신설 · 탭바 5개와 중복 노출 의도 · 설정 미포함(헤더 ⚙️) · 하단 탭바·사이드바 diff 0 ② **§5.3 [참조 복사](D11-ⓐ 진입점)** — 클립보드에 앱 방언 `![[DOC-nnnn]]` 그대로(새 마커 어휘 0) · 공용 유틸 `utils/clipboardWrite.ts`(Clipboard API → `execCommand` 폴백 — 폰 비보안 컨텍스트) ③ **§5.16 S49 블록** — 구문 강조 = `@blocknote/code-block@0.54.0` 신규 의존 1(라이선스 npm 메타 실측 · D10) · `createHighlighter` 동적 import 지연 팩토리(엔트리 +0 B · 코드 블록 첫 렌더 시 청크 로드) · 언어 15종 무변 · 토큰 색 = 라이브러리 산출(불변 규칙 5 판정 — `notes.css`는 `var(--shiki-dark)` 변수 참조만 · 듀얼 미지원 + 대비 불성립 시 강조 중단) · 편집 표면 한정(리더·인쇄 무접촉) / 복사 버튼 = 스펙 `render` 래핑 DOM 버튼(select 래퍼 안 · 폴백 클립보드) / 참조 붙여넣기 = `paste.ts` ①′ 분기(이미지 0 · 코드 블록 밖 · `text/plain` 전체 = embed 마커 1개 정확 일치 → `insertDocEmbedBlock` · 확인 0 · 탈출 경로 0 · 링크형·앵커형·부분 일치 = 종전 경로 · 두 표면 자동 적용) · D11-ⓑ 착수 금지 유지. **DDL 0 · API 0 · 백엔드 diff 0 · settings 키 0 · 라우트 0 · 신규 의존 1 · 버전 영향 사소(v2.01.4 예정 — stage-48 v2.01.3 선행).** 정본 = `stage-49-mobile-nav-code-highlight-ref-paste.plan.md` §2.)
> (v1.58 이하 설계 이력 원문(v1.12~v1.58 + "이전 이력 v1.11 이하" 요약 줄)은 `docs/04-archive/design-changelog.md`로 이관 — v1.47 이하 = 2026-08-31 stage-44 · v1.48 = 2026-09-01 stage-43 편성 시 · v1.49 = 2026-09-01 stage-43 완료 반영(v1.53) 시 · v1.50 = 2026-09-02 stage-46 완료 반영(v1.54) 시 · v1.51 = 2026-09-12 stage-47 편성 추기(v1.55) 시 · v1.52 = 2026-09-12 stage-47 완료 반영(v1.56) 시 · v1.53 = 2026-09-12 stage-48 편성 추기(v1.57) 시 · v1.54 = 2026-09-12 stage-48 완료 반영(v1.58) 시 · v1.55 = 2026-09-13 stage-49 편성 추기(v1.59) 시 · v1.56 = 2026-09-13 stage-49 완료 반영(v1.60) 시 · v1.57 = 2026-09-13 stage-50 편성 추기(v1.61) 시 · v1.58 = 2026-09-13 stage-50 완료 반영(v1.62) 시 밀려남. 위에는 현행 상태 줄 + 최근 3건(v1.61~v1.59)만 잔류.)
> 작성일: 2026-07-22 · 갱신: 2026-08-13
> 상위 문서: `docs/01-plan/study-app.plan.md` (Draft v0.39)
> 구현 계획: `docs/01-plan/stage-1-skeleton.plan.md` ~ `stage-13-fetch-cleanup-manual-import.plan.md`(S13) · `stage-14-qnet-openapi.plan.md`(S14) · `stage-15-multi-engine-codex.plan.md`(S15 — §4.17) · `stage-16-doc-formats.plan.md`(S16 — 착수 2026-07-29, §4.18) · `stage-17-doc-transclusion.plan.md`(S17 — 계약 확정 2026-08-02, §4.19) · `stage-18-answer-explanation.plan.md`(S18 — 계약 확정 2026-08-02, §4.20) · `stage-19-applied-exam.plan.md`(S19 — 계약 확정 2026-08-02, §4.21) · `stage-20-import-self-improve.plan.md`(S20 — 계약 확정 2026-08-02, §4.22) · `stage-21-engine-controls.plan.md`(S21 — 계약 확정 2026-08-03, §4.23) · `stage-22-llm-job-center.plan.md`(S22 — 계약 확정 2026-08-03, §4.24) · `stage-23-llm-split-import.plan.md`(S23 — 계약 확정 2026-08-04, §4.25) · `stage-24-applied-exam-mode.plan.md`(S24 — 계약 확정 2026-08-04, §4.21 S24 개정 블록) · `stage-25-explanation-display.plan.md`(S25 — 계약 확정 2026-08-04, screens §5.3 · **착수 순서 최우선**) · `stage-26-inline-formatting.plan.md`(S26 — 결정 확정 2026-08-09·지시서 2026-08-10, screens §5.3·§6 — 프론트 전용·§4 무변경) · `stage-27-editable-preview.plan.md`(S27 — 계약 확정 2026-08-11, screens §5.3 — 프론트 전용·§4 무변경) · `stage-28-doc-style.plan.md`(S28 — 결정 확정 2026-08-09·지시서 2026-08-13, **§4.26** + screens §5.3·§5.11·§6·§7) · `stage-29-image-upload.plan.md`(S29 — §4.27) · `stage-30-wysiwyg.plan.md`(S30 — screens §5.3 S30) · **에디터 v2**: `stage-31-blocknote-analysis.plan.md`(S31 — API·DDL 0) · `stage-32-transform-layer.plan.md`(S32 — API·DDL 0) · **`stage-33-notes-surface.plan.md`(S33 — §4.28 + screens §5.16·§5.11, `notes` DDL 1건)** · **`stage-34-notes-dialect.plan.md`(S34 — §4 무변경, screens §5.16 방언·참조 칩·이미지·붙여넣기 · **M33 게이트**)

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
| `study-app.design.api.md` | §4 API 명세(4.1~4.30, [S1]~[S37] 단계 태그 — §4.26 = S28 문서 스타일·전역 테마, §4.27 = S29 이미지 업로드, **§4.28 = S33 노트(베타) CRUD**, **§4.29 = S35 documents 블록 저장(+⑦ = S36 POST 확장)**, **§4.30 = S37 웹 임베드 메타 조회**) — 백엔드 구현 시 해당 절만 부분 읽기 |
| `study-app.design.screens.md` | §5 화면 상세(13개 + 전역 패널 §5.14 + 분할 반입 위저드 §5.15 + **베타 표면 §5.16** — 5.13 제안함은 S20, 5.14 작업 센터는 S22, 5.15 분할 반입 위저드는 S23, **5.16 노트(베타)는 S33·S34** 신설. **§5.3에 S26~S30·S35·S36 편집기 계약 누적** — **S30(F56 WYSIWYG 인라인 편집)은 API 0건이라 §5.3 S30 절이 단독 계약 정본**, **S35 = 에디터 v2 documents 탑재·S36 = 표면 통합·UX 마감**) · §6 테마 토큰 · §7 상태 관리 — 프론트 구현 시 해당 절만 부분 읽기 |

## 8. 비고

- 서버 채점 원칙: 정답·해설은 `quiz/session`·`exam/session` 응답에 포함하지 않는다 (풀기 전 노출 방지, 기록 무결성).
- attempts 저장과 SM-2 갱신·오답노트 생성은 하나의 트랜잭션 (모의고사 일괄 제출은 **배치 전체가 한 트랜잭션** — §4.14).
- 이 문서와 실제 구현의 갭은 각 stage 완료 시 `/pdca analyze`로 점검.
