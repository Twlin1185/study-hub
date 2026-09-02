# Study Hub — 개인 학습 허브

기출·학습자료를 LLM으로 구조화해 쌓고 학습→풀이→오답→복습 루프를 완성하는 로컬 웹앱
(FastAPI + SQLite + React). 개인용, 홈 네트워크 전용.

**현재 버전 v2.01.1** (2026-09-03 발행) — 버전 단일 출처 = 루트 `VERSION` · 규약·이력 =
`docs/03-release/CHANGELOG.md`. **다음**: 미편성 — 후보(캡처·D8·D11-ⓐ·FB-20 마크 탈출 등)는
v2.x 편성 시. 진척·경위는 stage-index·stage 문서에만.

## 문서 지도 (코드보다 문서가 먼저다)

| 문서 | 역할 |
|---|---|
| `docs/01-plan/study-app.plan.md` | 마스터 계획 — F01~F56 · **DDL 단일 출처(§6.2)** · 로드맵 §14 · 리스크 §15 · 버전 정의(말미) |
| `docs/01-plan/editor-v2.plan.md` | 에디터 v2(완료) 별지 — 결정 D1~D11 · R33~R41 · §13 백로그 · §14 프로젝션 손실(정본) · **GPL 의존 금지(D10 — 저장소 public)** |
| `docs/01-plan/stage-index.md` | **stage 전수 인덱스**(상태·산출 버전·경로 1표) — stage 문서는 여기서 찾는다 |
| `docs/01-plan/stage-{n}-*.plan.md` | 단계 지시서(DoD·제외 범위) — 완료 경위·잔여 정본 = 머리말 "상태" 줄 + "완료 기록" |
| `docs/02-design/study-app.design*.md` | 설계 3분할(§ 번호 불변) — 색인 `.design.md`(§1~3 공통 규약·분할 지도) / `.api.md`(§4) / `.screens.md`(§5 화면·§6 토큰·§7 상태) |
| `docs/03-release/` | 패치노트 — `CHANGELOG.md`(v2 정본 · 머리 = **버전 규약 정본**) · `CHANGELOG-v1.md`(동결) |
| `docs/04-archive/` | 완료 이력 원문 — **평소 읽지 않는다** |
| `docs/manual/user-manual.html` | 사용자 매뉴얼 — 기능 변경 시 함께 갱신 |

답은 대부분 설계 문서에 있다 — 추정 전에 읽을 것 · 문서-코드 불일치는 임의 수정 말고 보고.

## 모델 운용 정책

| 작업 | 담당 | 모델 |
|---|---|---|
| 계획·설계·아키텍처 결정 | 메인 대화 또는 `plan-architect` | **Fable**(소진 시 Opus · 에이전트 미지정=세션 상속) |
| `/stage-implement` 오케스트레이션 | 메인 대화 | **Opus 이하**(분배·중계는 기계적) |
| 백엔드/프론트 구현 | `backend-dev` / `frontend-dev` | **Sonnet**(sm2·import_service·학습모드 UX만 opus 승격) |
| 단계 검토·코드 리뷰 | `stage-reviewer` | **Opus 고정** |
| 브라우저 재현·UI 디버깅 | `browser-debugger` | **Sonnet** |

스킬: `/stage-implement` · `/stage-review` · `/stage-status` · `/browser-debug`.

## 토큰 규약 (모든 세션·에이전트)

1. `frontend/dist` 읽기·grep·diff 금지(빌드 산출물). diff는 `git diff -- . ':!frontend/dist'`.
2. 계획·설계 문서 **전체 읽기 금지** — `### 4.<n>`·`[S<n>]`·`## 5.<n>` Grep 후 `Read offset/limit`.
3. 검증은 래퍼 스크립트(§실행 — 요약 고정) · `npm run build`는 성공/실패만.
4. 불변 규칙 검사는 grep 말고 `scripts/invariant-scan.ps1` 결과(PASS/FAIL)로.
5. 서브에이전트에는 발췌·라인 범위를 프롬프트에 담아 전달 — 문서 통째 재읽기 금지.
6. stage 사이클이 끝나면 새 세션(진척 정본 = stage 문서 — 끊어도 무손실).

## 브라우저 디버깅 (claude-in-chrome)

**사용자가 띄운** `http://localhost:8000`만 사용(불가면 기동 요청·대기 — 구동 금지와 무충돌).
도구는 ToolSearch **1회 일괄 로드** · **텍스트 우선**(스크린샷 최소·GIF 요청 시만) · 콘솔
`pattern`·네트워크 URL 필터 필수(전체 덤프 금지) · 왕복 많으면 `browser-debugger` 위임(동시
1개 — 결론만 보고). 뒷정리: 연 탭 닫기 · 노트는 자동저장 — 건드렸으면 원상복구(+`/api/notes/{id}`)
· CDP 한글 IME 미지원(미열림≠결함 — ASCII·툴바 우회).

## 불변 규칙 (모든 코드 작업)

1. **채점은 서버에서만** — quiz/session 응답에 정답·해설 포함 금지.
2. **attempts 저장 + 오답노트 생성 + SM-2 갱신 = 한 트랜잭션.**
3. 문서 삭제 = 소프트 삭제(`is_active=0`) — 물리 삭제 금지. 분류 빼기 = 연결 해제.
4. `sources/` 원본 불변 — 수정·삭제 코드 금지.
5. **색상 하드코딩 금지** — `styles/tokens.css` 토큰만.
6. 스키마 변경 = plan §6.2 갱신 + Alembic 마이그레이션 세트로만.
7. 테스트 필수는 `services/sm2.py`(pytest)만 — 나머지는 실행 스모크.
8. 에러 포맷·페이지네이션 = 설계 §3 규약.
9. stage 문서의 "이 단계에서 하지 않는 것"이 우선한다.
10. 완료 시 stage 문서 체크박스 `[x]` 갱신.

## 실행

- **서버 구동 금지(2026-08-19 사용자 지시 — 전 세션·에이전트)**: uvicorn·vite를 직접 열지
  않는다 — 대리 기동 포함(주인 = `2_StartServer.bat` · 기동·재시작 = 사용자 몫). 부득이한 자체
  검증만 임시 포트(8000 금지) 짧게 — **종료 + 리스너 부재 확인**(서브에이전트에도 명시).
- **stage 완료 절차**: CHANGELOG 1항목 + (발행 시) `VERSION` 갱신 + `stage-index.md` 1행.
  CLAUDE.md는 **머리의 버전 줄 1곳만** — 경위는 stage 문서에만.
- 백엔드: `uvicorn main:app --host 0.0.0.0 --port 8000`(backend/) — 접속 PC `localhost:8000` ·
  폰 `<PC-IP>:8000` · **외부 포트포워딩 금지(R12)**.
- 프론트: `npm run dev` / 배포 `npm run build` → FastAPI가 dist 서빙 · 시작 스크립트가
  `scripts/ensure-frontend-build.ps1`로 소스 해시 비교(mtime 아님·Node 없으면 생략) 후 자동 빌드.
- 테스트: `powershell -ExecutionPolicy Bypass -File scripts/run-tests.ps1`(`-Path` 부분 · `-Full` 전체)
  — 임베디드 파이썬이라 `python -m pytest` 불가, 래퍼가 sys.path 주입.
- 불변 검사: `powershell -ExecutionPolicy Bypass -File scripts/invariant-scan.ps1`(신규 위반만 · 정당하면 `-UpdateBaseline`)
- DB: 루트 `study.db`(WAL) · 백업(F27) = **VACUUM INTO** + `sources/` zip 2종(`backend/services/backup_service.py`).
