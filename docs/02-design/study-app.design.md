# Study Hub — 상세 설계 (API 명세 · 화면 상세)

> (2026-07-31 문서 구조 변경 — 판번 유지: §4 API 명세 → `study-app.design.api.md`, §5~7 화면·테마·상태 → `study-app.design.screens.md`로 **내용 이동만** 분할. § 번호·[S#] 태그는 그대로 — "설계 §4.x" 참조는 api 파일, "§5~7"은 screens 파일에서 `### <번호>` Grep)
> 상태: **Design v1.76** — v1.75 대비: **색인 §3 `[S58]` Host/Origin 가드 규약 1단락 + api §4.3·§4.10·§4.14·§4.21·§4.22·§4.24·§4.25 `[S58]` 각 1줄(stage-58 보안 신뢰 경계 + 데이터 무결성 긴급 묶음 편성 — FB-37 · FB-38, 2026-11-10 — 문서만·코드 0·**착수 전** · 사용자 확정 대기 0 · 실측 재개정은 완료 시 다음 판번)**: ① **Host/Origin 가드** — ASGI 미들웨어 1개 · Host = `localhost`·IP 리터럴·PC 이름(+`.local`)·`STUDY_HUB_ALLOWED_HOSTS`만 · `/api` 변경 메서드의 `Origin` 불일치 거부 · 거부 = **403 + `VALIDATION_ERROR`**(코드 신설 0 — §3 "4종 고정" 유지) ② **경로 id 가드** — improve case·proposal · backup restore · split id = 문자 집합 화이트리스트 + 루트 종속 → 불일치 404 ③ **업로드 상한 50MB** — convert·split·imports 5지점 → 422 `upload_too_large` ④ **시험 중복 문항** — 세션 과목 간 dedupe + 제출 중복 422(실전·응용 양쪽) ⑤ **복원 안전** — 활성 잡·체크포인트 busy = 409 ⑥ **잡 TTL** — 종료 잡만 종료 시각 기준 삭제 ⑦ Claude CLI = Read 전용(`bypassPermissions` 제거). screens 무변(프론트 3건 = 가드·보류 로직 · 새 UI·문구 0). **DDL 0 · 신규 엔드포인트 0 · 응답 가산 0 · 에러 코드 신설 0 · 신규 의존 0 · 버전 영향 사소(v2.04.3 예정).** 정본 = `stage-58-security-integrity.plan.md` §2.
> (v1.75: v1.74 대비: **api §4.34 ④ `[S57]` 단락·목록 행 `← S57` + §4.24 `[S57]` 추기 + §4.20 ② `[S57]` 해설 규격 + screens §5.9 S56 B `← S57` + §5.14 run 그룹의 "편성 · 착수 전" → "구현 실측 확정" 표기(stage-57 반입 사소 묶음 구현·검토 완료 반영, 2026-11-09 — 문서만 · 계약 그대로 구현 · 구현 커밋 `0a26255` + 검토 경미 반영 `6753aa9` · `test_import_runs.py` 21 · `test_explanation_spec.py` 5(신규) · pytest 710 · invariant PASS(기준선 갱신 0) · `npm run build` 성공(엔트리 청크 1,532,227 → 1,534,106 B · Δ +1,879 B · R37 기준선 1,532,227 대비) · Opus 검토 통과 — 치명 0 · 중요 0 · 경미 3 해소 · API 실측 V-2 ⓐ~ⓓ 통과 · 브라우저 실측 V-3 ⓐⓑⓒⓔⓕⓖ 통과(ⓓ 관찰 불가 → 코드 검토 갈음 · 인쇄 미리보기 "생성일"은 빈 DB라 미확인) · 잔여 = DoD 6 해설 표본 10문항 + DoD 7 사용자 실사용·폰 실기기 회신 → **v2.04.2 발행 대기**)**: ① **계약 편차 0** — 응답 가산 2필드(`preview_available?`·`run_label?`) · 작업 센터 run 그룹 · 해설 규격 블록(코드 문구 = 지시서 §2 D 정본과 줄 단위 일치) · 날짜 키 7지점 전부 편성 계약 그대로 ② **검증 절차 편차 1(계약 무관)** — V-2 ⓒ를 지시서의 "비지원 포맷 실패 경로" 대신 "큐 일시정지 → `POST /api/convert`(OLE 매직 `.doc`) → `queued` 유지"로 실측(LLM 도달 가능성 0 보장) → 잡 항목 `run_label` = run `label` 확인 ③ **구현 앵커 가산 1** — 목록 계산 조건 헬퍼 `import_run_service._list_checks_preview(run)`(규약 A 그대로) ④ **검토 미확인 의심 2(결함 아님 · 기록만)** — `start_with_run`에서 잡 라벨이 None이면 `run_label` null(프론트 폴백 존재 · §4.24) · 그룹 [모두 취소]는 클릭 시점 목록만 대상(§5.14). 색인 §3 "날짜" `← S57 실측` 1구는 편성 표기 그대로(계약 무변). **DDL 0 · 신규 엔드포인트 0 · 응답 순수 가산 2 · 신규 의존 0 · 버전 영향 사소(v2.04.2 발행 대기).** 정본 = `stage-57-import-minor-bundle.plan.md` §7.)
> (v1.74: v1.73 대비: **api §4.34 ④ `[S57]` 단락(+ 목록 행 `← S57` 1구) + §4.24 `[S57]` 추기 + §4.20 ② `[S57]` 해설 규격 + screens §5.9 S56 B `← S57` 1구 + §5.14 run 그룹 1구 + 색인 §3 "날짜" 규약 `← S57 실측` 1구(stage-57 반입 사소 묶음 편성 — FB-32 · FB-33 · FB-35 ⓐ · FB-36, 2026-11-09 — 문서만·코드 0·**착수 전** · 사용자 확정 대기 0(권고안 확정 + 대안 표 · 이견 시 변경) · 실측 재개정은 완료 시 다음 판번)**: ① **목록 항목 `preview_available?`**(FB-32) — `GET /api/import/runs` 항목에 불리언 또는 null 순수 가산(`review_ready`·답지 제외만 계산 · 존재 검사만 · 복구 호출 0) → 반입 건 카드가 [자세히]를 펼치기 전부터 보존 만료 [검토] 비활성 + 사유 1줄 ② **잡 항목 `run_label?`**(FB-36) — 반입 건 라벨 스냅숏을 잡 레코드에 시작 시 심어 그대로 노출(목록 조회 DB 0 유지 · 등록부 "프론트 전용" 표기 정정 = 백엔드 가산 동반) → 작업 센터가 같은 `run_id` 잡 2개 이상을 **run 그룹**으로(헤더 라벨·집계·접기·[카드로 이동]·[모두 취소] 대기 → 실행 중 순차·[목록에서 지우기] · 서버 일괄 API 0 · 1개뿐인 run·비반입 잡은 평면) ③ **해설 규격**(FB-35 ⓐ) — 풀이 생성·재생성 프롬프트에 굵은 라벨 3부(정답 근거 · 오답 보기 전부 · 핵심 개념) + 분량(객관식 400~700자 · 단답 200~400자) + 창작 금지 유지 · 출력 JSON 무변 · 재생성은 "해설을 고쳐 쓸 때만" · 검증 = 프롬프트 단위 테스트 + 사용자 표본 10문항(발행 게이트 · 에이전트 LLM 실호출 0) · ⓑ 적응형 깊이는 계약 밖 ④ **시각 실측**(FB-33) — 서버 시각 표기 2종(DB 유래 UTC naive ↔ 인메모리·파일 유래 서버 로컬 naive)을 §3에 기록 · 프론트 `new Date(iso)` 직접 파싱 9곳은 로컬 naive라 정상(무접촉) · 실제 결함 = 로컬 날짜를 `toISOString()`으로 키화한 6지점(히트맵 하루 밀림·인쇄 기본 날짜·생성일) + UTC naive 문자열 날짜 절단 1지점(오답노트 인쇄 필터) → 프론트 유틸 `utils/serverDate.ts`로 수정(API 계약 무변). **DDL 0 · 신규 엔드포인트 0 · 기존 응답 순수 가산 2 · 잡 kind 0 · 신규 의존 0 · 버전 영향 사소(v2.04.2 예정).** 정본 = `stage-57-import-minor-bundle.plan.md` §2.)
> (v1.73: v1.72 대비: **api §4.34 `[S56]` 절 머리 + ④ dismiss 행 + ⑤ 에러 행 + 절 말미 `[S56 구현 실측 확정 2026-11-08]` 단락 + 구현 앵커 확정 · §4.24·§4.3 `[S56]` 추기 "편성" → "구현 실측 확정" + screens §5.9 S56 블록 머리 + 절 머리 포인터 + §5 도입부 + §5.14 2구 확정 표기(stage-56 반입 건 영속·타임라인 구현·검토 완료 반영, 2026-11-08 — 문서만 · 계약 그대로 구현 · 구현 커밋 `96f64a4` + 검토 반영 `2c1bd0f` · Alembic `d4e7a2b91c56` 왕복 성공 · `test_import_runs.py` 19건 · pytest 703 · invariant PASS · `npm run build` 성공(엔트리 청크 1,524,813 → 1,532,227 B · Δ +7,414 B 앱 셸 · 의존 0 · R37 기준선 재기준) · Opus 검토 조건부 통과 → 치명 0 · 중요 3 · 경미 4 전건 반영 · API 실측 전건 통과 · UI 실측 ⓐⓑⓒⓖⓙ는 DoD 6 합류 · 잔여 = 사용자 실사용·폰 실기기 회신 → **v2.04.1 발행 대기(stage-55 v2.03.2 합류)**)**: ① **구현 실측 확정 편차 ⓐ~ⓛ**(결함 아님 · §4.34 말미) — ⓐ `summary` 키 3 추가(`chunks_total`·`chunks_failed`·`fetch_request` · DDL 무변 · 마스터 §6.2 주석 갱신) ⓑ **dismiss 409 조건 축소** = 진행 중 ∧ 활성 잡 존재(`no_active_job` 200 — 검토 중요 ①) ⓒ `FetchImportWizard` localStorage 슬롯 제거 + `onRunStarted`(퇴역 F-6과 충돌 · 예외 1) ⓓ 사이트 반입 완료 합류 = run 카드 [검토]만 ⓔ 답지 run [검토] = `?mode=answer_key` 열기 ⓕ `preview_available` 커밋 여부 반영 · 상세 조회 시만 ⓖ [다시 시도] = URL `source_url` · 사이트 `fetch_request` 재제출 ⓗ 분할 조각 실패 = run `failed` 아님(`chunks_failed` 누적) ⓘ `split_chunk_index=` ⓙ 실패 사례 `run_id` 최신값 ⓚ 답지 경로 `/api/import/answer-key` ⓛ `notes` best-effort ② **검토 반영** — [분할 이어서] · 잡 없는 진행 중 run [목록에서 지우기] · 상대 시각 `parseServerDate`(UTC naive 9시간 오차) · 분할 run 폴링 `chunks_total` 조건 · `canMerge`·조각 [검토] 숨김·[취소] 라벨·`committed_at` ③ FB-31 원인 = 테스트 오염(격리 수정 · run 연결 완료) · 등재 권고 → 별지 §13 FB-32(목록 `preview_available`)·FB-33(UTC naive 전수)·FB-34(`adopt` 퇴역). **DDL 2(Alembic 1 완료) · 신규 엔드포인트 4 · 신규 의존 0 · 버전 영향 핵심(v2.04.1 발행 대기).** 정본 = `stage-56-import-runs.plan.md` §7.)
> (v1.71 이하 설계 이력 원문(v1.12~v1.71 + "이전 이력 v1.11 이하" 요약 줄)은 `docs/04-archive/design-changelog.md`로 이관 — v1.47 이하 = 2026-08-31 stage-44 · v1.48 = 2026-09-01 stage-43 편성 시 · v1.49 = 2026-09-01 stage-43 완료 반영(v1.53) 시 · v1.50 = 2026-09-02 stage-46 완료 반영(v1.54) 시 · v1.51 = 2026-09-12 stage-47 편성 추기(v1.55) 시 · v1.52 = 2026-09-12 stage-47 완료 반영(v1.56) 시 · v1.53 = 2026-09-12 stage-48 편성 추기(v1.57) 시 · v1.54 = 2026-09-12 stage-48 완료 반영(v1.58) 시 · v1.55 = 2026-09-13 stage-49 편성 추기(v1.59) 시 · v1.56 = 2026-09-13 stage-49 완료 반영(v1.60) 시 · v1.57 = 2026-09-13 stage-50 편성 추기(v1.61) 시 · v1.58 = 2026-09-13 stage-50 완료 반영(v1.62) 시 · v1.59 = 2026-09-13 stage-51 편성 추기(v1.63) 시 · v1.60 = 2026-09-13 stage-51 완료 반영(v1.64) 시 · v1.61 = 2026-09-14 stage-52 편성 추기(v1.65) 시 · v1.62 = 2026-09-15 stage-52 완료 반영(v1.66) 시 · v1.63 = 2026-09-27 stage-53 편성 추기(v1.67) 시 · v1.64 = 2026-09-27 stage-53 완료 반영(v1.68) 시 · v1.65 = 2026-09-27 stage-54 편성 추기(v1.69) 시 · v1.66 = 2026-11-08 stage-55 편성 추기(v1.70) 시 · v1.67 = 2026-11-08 stage-55 완료 반영(v1.71) 시 · v1.68 = 2026-11-08 stage-56 편성 추기(v1.72) 시 · v1.69 = 2026-11-08 stage-56 완료 반영(v1.73) 시 · v1.70 = 2026-11-09 stage-57 편성 추기(v1.74) 시 · v1.71 = 2026-11-09 stage-57 완료 반영(v1.75) 시 · v1.72 = 2026-11-10 stage-58 편성 추기(v1.76) 시 밀려남. 위에는 현행 상태 줄 + 최근 3건(v1.75~v1.73)만 잔류.)
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
- **Host/Origin 가드 `[S58]`(구현·검토 2026-11-10 · 실측 확정 — 정본 `stage-58-security-integrity.plan.md` §2 C)**: 홈 네트워크 전용 앱의 신뢰 경계(R12가 막지 못하는 DNS 리바인딩·교차 사이트 요청 — R49). `main.py` ASGI 미들웨어 1개가 **모든 HTTP 요청**에 적용한다.
  - **Host**: 포트를 뗀 호스트가 `localhost` · IP 리터럴(v4·v6) · PC 이름(`socket.gethostname()` — 대소문자 무시 · `.local` 허용) · 환경변수 `STUDY_HUB_ALLOWED_HOSTS`(쉼표 구분 · 기동 시 1회) 중 하나가 아니면 거부. 폰 `http://<PC-IP>:8000`은 IP 리터럴이라 무영향.
  - **Origin**: `/api` 하위 `POST·PUT·PATCH·DELETE`에서 `Origin` 헤더가 있고 그 `host[:port]`가 Host와 다르면 거부(`null` 포함 · 헤더 부재 = 통과 · GET 미검사).
  - **거부 응답 = HTTP `403` + `code:"VALIDATION_ERROR"`** · `detail.reason` = `host_not_allowed` | `origin_mismatch`. **코드 집합은 늘리지 않는다**(위 S14 원칙 그대로 — `VALIDATION_ERROR`가 422 외에 403을 쓰는 예외 1건 · 기존 `http_exception_handler`의 "404 외 = `VALIDATION_ERROR`" 매핑과 같은 선).
- **페이지네이션**: `?page=1&size=50` → `{ "items": [...], "total": 231, "page": 1, "size": 50 }`
- **날짜**: ISO 8601, 서버 로컬(Asia/Seoul) 기준. DATE는 `YYYY-MM-DD`. **← S57 실측(2026-11-09 · FB-33 — 계약 변경 아님 · 현행 코드 기록)**: DATETIME의 실제 표기는 **2종**이다 — ⓐ **DB 컬럼 유래**(`server_default=current_timestamp` — documents·notes·review_notes 등 + `import_runs`·`import_run_events`)는 **오프셋 없는 UTC**(이 규약과 다름 — 프론트는 `parseServerDate`로 해석) ⓑ **인메모리·파일 유래**(잡 `created_at`·`started_at`·`finished_at`·`progress.last_activity_at` · LLM 상태 `resets_at`·`last_success_at` · improve 사례·제안의 `created_at`·`last_seen_at`·`run_at`·`decided_at`)는 **오프셋 없는 서버 로컬**(이 규약 그대로 — 프론트는 `new Date(iso)`) · DATE 키(히트맵 등)는 서버 로컬 날짜(`date(col, 'localtime')`) — 프론트가 로컬 `Date`를 날짜 키로 바꿀 때는 `toISOString()`(UTC) 금지 · `toLocalDateKey`. 표기 통일(오프셋 부착·UTC 일원화)은 응답 값 계약 변경이라 **별도 결정**(stage-57 범위 밖). 전제 = 서버·브라우저 같은 시간대.
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
