# Study Hub — 상세 설계 (API 명세 · 화면 상세)

> (2026-07-31 문서 구조 변경 — 판번 유지: §4 API 명세 → `study-app.design.api.md`, §5~7 화면·테마·상태 → `study-app.design.screens.md`로 **내용 이동만** 분할. § 번호·[S#] 태그는 그대로 — "설계 §4.x" 참조는 api 파일, "§5~7"은 screens 파일에서 `### <번호>` Grep)
> 상태: **Design v1.53** — v1.52 대비: **stage-43 구현 완료 반영 3건(구 편집기 퇴역 실행·노트 v2 정식 승격, 2026-09-01 — 문서만·API 계약 무변·백엔드 diff 0. 구현 계약 기준 — 브라우저 실측(V-2·V-3)·사용자 실사용은 잔여·실측 후 확정은 후속 개정)**: ① **screens §5.16 승격 계약 재개정** — 진입 = 데스크톱 사이드바 + 모바일 드로어 '노트'(탭바 5개 불변·lazy 무변·초기 청크 순감소) · 베타 딱지 해제(목록 제목·안내 문구) · 개정 사유 = stage-43 규약 C(백업 기충족 · **전역 검색(FTS)/인쇄 통합 = v2.x 이월** — 별지 `editor-v2.plan.md` §13 등재) ② **screens §5.3 재개정** — 퇴로 토글·구 편집기 분기 서술 이력화(전 진입점 새 편집기 상시 · 미전환 문서 = 메모리 변환 유지·§4.29 무변 · **변환 불가 = 본문·해설 편집 차단 + 읽기 전용 배너** — 조용한 변형 0) ③ **screens §5.11** — 실험실(베타) 카드 제거(F38 6그룹 수 불변). **엔드포인트 증감 0·DDL 0·settings 키 0·신규 의존 0.** 정본 = `stage-43-editor-retire.plan.md` §8.
> (v1.52: v1.51 대비: **screens §5.16 편성 추기 1건(stage-43 편성, 2026-09-01 — 문서만·코드 0·API 계약 무변·백엔드 diff 0)**: 노트 v2 **정식 승격이 stage-43에 편성**됨을 격리 조항(노출 방식)에 추기 — 사이드바·모바일 드로어 '노트' 노출 예정(탭바 5개 불변·lazy 유지) · 종전 승격 전제 부분 개정(백업 = 기충족 · 전역 검색(FTS)/인쇄 통합 = v2.x 이월) · 구 편집기 퇴역(N-2 실행)과 한 stage(→ v2.01.1). 승격 계약 실측 재개정 = 구현 후 v1.53 예정. **엔드포인트 증감 0·DDL 0·settings 키 0·신규 의존 0.** 정본 = `stage-43-editor-retire.plan.md`.)
> (v1.51: v1.50 대비: **screens §5.16 S41 2차 개정 1건(stage-41 결정 ① 사용자 번복 — 흐름형 ⓐ → 고정 열 ⓑ · 구현·검토·실측 완료 반영, 2026-08-30 — 문서만·API 계약 무변·백엔드 diff 0)**: `columns` > `column` 컨테이너 grid · 단 경계 키 가드 · 정규화 불변식(두 계층 동치) · 2↔3 병합/추가 · 방언 `::::columns{n=2}`/`:::column` · 리더 grid 셀·혼재 흡수 · `column` 핸들 숨김. 정본 = `stage-41-flow-columns.plan.md` 완료 기록(2차).)
> (v1.50: v1.49 대비: **screens §5.16 S41 실측 재개정 1건(stage-41 흐름형 다단 구현·검토·실측 완료 반영, 2026-08-30 — 문서만·API 계약 무변·백엔드 diff 0)**: 편집 표면 단 수 선택자 형태(노드뷰 래퍼 실측) · 리더 `data-columns` 선언 속성 CSS(인쇄 = 화면 단 수 · 모바일 screen 한정) · 빈 컨테이너 "첫 편집 시 회수" · 드래그 핸들 실측(단 경계 문단 오른단 조각 hover 시 이격 — 결정 ④ⓐ 유지) · 슬래시 별칭 항목별 · 토글 시 `attrs` `n` 소거. 정본 = `stage-41-flow-columns.plan.md` 완료 기록.)
> (v1.49 이하 설계 이력 원문(v1.12~v1.49 + "이전 이력 v1.11 이하" 요약 줄)은 `docs/04-archive/design-changelog.md`로 이관 — v1.47 이하 = 2026-08-31 stage-44 · v1.48 = 2026-09-01 stage-43 편성 시 · v1.49 = 2026-09-01 stage-43 완료 반영(v1.53) 시 밀려남. 위에는 현행 상태 줄 + 최근 3건(v1.52~v1.50)만 잔류.)
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
