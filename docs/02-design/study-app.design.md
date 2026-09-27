# Study Hub — 상세 설계 (API 명세 · 화면 상세)

> (2026-07-31 문서 구조 변경 — 판번 유지: §4 API 명세 → `study-app.design.api.md`, §5~7 화면·테마·상태 → `study-app.design.screens.md`로 **내용 이동만** 분할. § 번호·[S#] 태그는 그대로 — "설계 §4.x" 참조는 api 파일, "§5~7"은 screens 파일에서 `### <번호>` Grep)
> 상태: **Design v1.69** — v1.68 대비: **api `### 4.33 [S54]` 절 신설 + §4.24 `[S54]` 추기(잡 kind 10종째 · `model?` 9곳째) + screens `### 5.18 캡처` 신설 + §5 도입부 1줄(stage-54 캡처 파이프라인 1단계 편성, 2026-09-27 — 문서만·코드 0·**편성 보류 — 사용자 확정 대기 `capture.plan.md` §10 D-C1~D-C5** · 전부 "후보안" 표기 · 확정 후 착수 문서화 시 표기 해제 + 실측 재개정은 완료 시 v1.70)**: ① **신규 엔드포인트 8**(`routers/capture.py` `prefix=/api/capture`) — `POST /api/capture`(multipart 획득 · 매직 바이트 · 20MB · `sources/capture/{hash12}_{safe_name}` 원본 불변) · `GET /api/capture`(§3 페이지네이션 · `discarded` 기본 제외) · `GET /{id}` · `GET /{id}/original`(id 기반 서빙 · R16 루트 종속 검사) · `POST /{id}/refine`(잡 kind `capture_refine` · `engine?`·`model?` · codex = 422 `engine_no_vision`) · `GET /jobs/{job_id}`(§4.11 계약) · `POST /{id}/insert`(**노트 INSERT/UPDATE + status `inserted` 한 트랜잭션** · 블록 무검증 §4.28 원칙 · provenance 스탬프 = 클라이언트) · `POST /{id}/discard`·`/restore`(파일 무접촉 · 물리 삭제 0) · 상태 전이 표(별지 §5.5 골격 `stored → refining → drafted → inserted \| discarded` · 그 외 409 `bad_transition`) ② **screens §5.18** — 내비 '캡처' 1개(하단 탭바 5 불변) · 획득 = `<input type="file" capture="environment">`(**비보안 컨텍스트 R44 — 앱 안 카메라·녹음 0**) · 목록(상태 배지 토큰만) · 리뷰(원본 + [초안] `MarkdownView` / [원문] `raw_text` · 엔진 선택 §4.23 재사용 · [정제]/[노트에 삽입]/[버리기]) · 삽입 모달(기존/새 노트 · `markdownToBlocks` + provenance) · 자동 정제·자동 삽입 0. **DDL 1(`capture_items` — 후보 DDL = `capture.plan.md` §5 · 마스터 §6.2는 확정 후 등재 · Alembic 1 예고 · R47) · 신규 엔드포인트 8 · 잡 kind +1 · 신규 의존 0(권고안) · 버전 영향 핵심(v2.04.1 예정).** 정본 = `stage-54-capture-slice-1.plan.md` §2 · 캡처 전체 정본 = `capture.plan.md`.
> (v1.68: v1.67 대비: **api §4.32 `[S53]` 구현 실측 확정 표기(추기 포인터 + ① 표 행 + ⑦ 블록 머리) + screens §5.17 S53·§5.2·§5.16·§5 도입부 1줄 4곳 확정 표기(stage-53 휴지통 비우기 + 진입 경로 구현·검토 완료 반영, 2026-09-27 — 문서만·API·화면 계약 그대로 구현 · 구현 커밋 5036392 + 검토 반영 75a296b · 백엔드 diff = `services/trash_service.py`(`empty_trash`)·`routers/trash.py`·`schemas/trash.py`·`tests/test_trash.py`(20 → 25 · 케이스 ⑧) + `scripts/invariant-scan.ps1` 규칙 문자열 1줄 + `invariant-baseline.json` `trash_service.py` 2 → 3 · `main.py` 0 · 프론트 diff 10파일(`App.tsx`·`Settings.tsx` 0) · pytest 684 · invariant PASS · `npm run build` 성공(엔트리 청크 +620 B — 앱 셸 · 의존 0 · R37 기준선 1,522,408 B 재기준) · Opus 검토 통과(치명·중요 0 · 경미 3 반영 — 비우기 확인창 오류 문구 초기화 · 탐색 링크 우측 정렬 · 테스트 무접촉 단언 강화) · 잔여 = 브라우저 V-3 ⓐ~ⓖ(사용자 기동 서버) + DoD 6 · **v2.03.1 합류 발행 대기**(stage-52와 한 발행 단위))**: ① **api 실측 편차 1** — POST 전용 `/images/empty`에 GET = **404 `NOT_FOUND`**(405 아님 · `main.py` SPA catch-all이 `/api/*` 미매칭 GET을 404 JSON으로 통일하는 앱 전역 관례 · 테스트도 404) ② **screens 실측 관찰 2**(결함 아님) — NoteEditPage 삭제 모달 `[휴지통 열기]`는 확인창 없이 이동 + 편집분 언마운트 자동 저장(이탈 가드 = `beforeunload` 한정 · 손실 0 · 우회 코드 0) · `/trash` 체류 중 다른 `?tab=` 링크 재진입은 재마운트 없어 탭 무변(마운트 1회 규약의 결과 · 감시만) ③ 불변 규칙 4 재개정·매뉴얼 3곳 반영 완료. **DDL 0 · Alembic 0 · 신규 엔드포인트 1 · 신규 의존 0 · 버전 영향 사소(v2.03.1 합류).** 정본 = `stage-53-trash-empty-entry.plan.md` §7.
> (v1.67: v1.66 대비: **api §4.32 `[S53]` 행 1 + ⑦ 블록 + 절 머리·"최종 삭제 엔드포인트 없음"·⑥·말미 `← S53` 추기 + screens §5.17 S53 추기(진입점 4 · `?tab=` · `[휴지통 비우기]`) + §5.2·§5.16·§5 도입부 내비 1줄 3곳(stage-53 휴지통 후속 — FB-26 전체 비우기 + FB-27 진입 경로 편성, 2026-09-27 — 문서만·코드 0·**착수 전** · 실측 재개정은 완료 시 v1.68)**: ① **`POST /api/trash/images/empty` 신설** — 본문 없음 · `.trash/` 직속 정규 이미지 파일 전부 `os.remove`(`trash_service.py` 1곳 · `resolve()`+`is_relative_to` 가드 · 하위 폴더·비정규 파일 무접촉 · best-effort · 폴더 없음 = `{0,0,0}`) · 응답 `{deleted, freed_bytes, skipped}` · 참조 재검사 0 · 사용자 명시 클릭 전용(자동·주기·용량 삭제 0 유지 — 별지 D8 재론 사용자 확정 2026-09-27) ② **screens §5.17 진입점 4** — 설정 카드 유지 + `Layout.tsx` 하단 그룹 첫 항목 "휴지통"(사이드바·드로어 · 하단 탭바 5 불변) + 탐색 필터바·노트 목록 헤더 링크 + 삭제 확인 모달 4곳 `ConfirmDialog footer` `[휴지통 열기]`(S50 봉인 해제) + 삭제 완료 알림 링크 2곳 · `?tab=` 초기 탭 · `[휴지통 비우기]` `danger` 확인 실수치 ③ **불변 규칙 4 재개정 동반**(계획서 §6.3 4 + `CLAUDE.md` — 최종 삭제 = 탐색기 또는 앱 [휴지통 비우기]). **DDL 0 · Alembic 0 · 신규 엔드포인트 1 · 신규 의존 0 · 버전 영향 사소(사용자 확정 · v2.03.2 예정 — v2.03.1 발행 전 완료 시 합류 판정).** 정본 = `stage-53-trash-empty-entry.plan.md` §2.)
> (v1.66: v1.65 대비: **api §4.32 `[S52]` 구현 실측 확정 표기(절 머리 + §4.2·§4.28 ① 포인터 행 2개) + 실측 확정 ⓐ 추기(`modified_at` UTC 오프셋) + screens §5.17 실측 확정 2건 + §5.11·§5.2·§5.3·§5.16 S52 1줄 4곳 확정 표기(stage-52 통합 휴지통 구현·검토 완료 반영, 2026-09-15 — 문서만·API 계약 그대로 구현 · 구현 커밋 32ae447 + 검토 반영 1a7d319 · 백엔드 diff = `routers/trash.py`·`services/trash_service.py`·`schemas/trash.py`(신규)·`routers/documents.py`·`routers/notes.py`·`services/document_service.py`·`main.py`(상수 import)·`tests/test_trash.py`(20건) · pytest 679 · invariant PASS(fs-mutate 기준선 `trash_service.py` 2곳 = 규약 C 정당분 · 규칙 4 문자열 개정) · `npm run build` 성공(엔트리 청크 −62,132 B — Trash lazy 청크 분리 리청킹) · Opus 검토: 1차 조건부 통과(치명 0 · 중요 1 · 경미 4) → 반영 후 재검토 통과(잔존 0 · 2026-09-15) · 잔여 = 브라우저 V-3(사용자 기동 서버) + 사용자 실사용 게이트 DoD 6 · **v2.03.1 발행 대기**)**: ① **api 실측 확정 ⓐ** — 스캔 보고서 `modified_at` = 파일 mtime **UTC 오프셋 포함 ISO 8601**(문서·노트 `updated_at` naive UTC와 같은 파서 공유 — 검토 경미-1) ② **screens 실측 확정** — 복원 훅 2개가 `['trash']` 쿼리 키까지 invalidate(행 소멸 — 검토 중요-1) · 이동 버튼·확인창 중립 색(되돌리기 가능한 조작) · 표 헤더 "삭제(마지막 변경)" ③ 파일 삭제 코드 0 · `.trash/` 생성은 첫 실제 이동 직전 lazy. **DDL 0 · Alembic 0 · 신규 엔드포인트 7 · 신규 의존 0 · 버전 영향 핵심(v2.03.1 발행 대기).** 정본 = `stage-52-trash-orphan-images.plan.md` §7.)
> (v1.65 이하 설계 이력 원문(v1.12~v1.65 + "이전 이력 v1.11 이하" 요약 줄)은 `docs/04-archive/design-changelog.md`로 이관 — v1.47 이하 = 2026-08-31 stage-44 · v1.48 = 2026-09-01 stage-43 편성 시 · v1.49 = 2026-09-01 stage-43 완료 반영(v1.53) 시 · v1.50 = 2026-09-02 stage-46 완료 반영(v1.54) 시 · v1.51 = 2026-09-12 stage-47 편성 추기(v1.55) 시 · v1.52 = 2026-09-12 stage-47 완료 반영(v1.56) 시 · v1.53 = 2026-09-12 stage-48 편성 추기(v1.57) 시 · v1.54 = 2026-09-12 stage-48 완료 반영(v1.58) 시 · v1.55 = 2026-09-13 stage-49 편성 추기(v1.59) 시 · v1.56 = 2026-09-13 stage-49 완료 반영(v1.60) 시 · v1.57 = 2026-09-13 stage-50 편성 추기(v1.61) 시 · v1.58 = 2026-09-13 stage-50 완료 반영(v1.62) 시 · v1.59 = 2026-09-13 stage-51 편성 추기(v1.63) 시 · v1.60 = 2026-09-13 stage-51 완료 반영(v1.64) 시 · v1.61 = 2026-09-14 stage-52 편성 추기(v1.65) 시 · v1.62 = 2026-09-15 stage-52 완료 반영(v1.66) 시 · v1.63 = 2026-09-27 stage-53 편성 추기(v1.67) 시 · v1.64 = 2026-09-27 stage-53 완료 반영(v1.68) 시 · v1.65 = 2026-09-27 stage-54 편성 추기(v1.69) 시 밀려남. 위에는 현행 상태 줄 + 최근 3건(v1.68~v1.66)만 잔류.)
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
