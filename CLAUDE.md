# Study Hub — 개인 학습 허브

기출문제·학습자료를 LLM으로 구조화해 쌓고, 학습→풀이→오답관리→복습 루프를 완성하는
로컬 웹앱 (FastAPI + SQLite + React). 개인용, 홈 네트워크 전용.

## 문서 지도 (코드보다 문서가 먼저다)

| 문서 | 역할 |
|---|---|
| `docs/01-plan/study-app.plan.md` | 마스터 계획 — 기능 F01~F51, **스키마 DDL 단일 출처(§6.2)**, 로드맵 M1~M25(압축 표 + 진행·예정 F43~F51 상세), 리스크 R1~R25 |
| `docs/02-design/study-app.design.md` | 설계 **색인** — §1~3(범위·구조·API 공통 규약) + 파일 분할 지도. § 번호는 분할 전과 동일 |
| `docs/02-design/study-app.design.api.md` | §4 API 명세(4.1~4.25, [S1]~[S25] 태그) — 필요한 절만 `### 4.<n>` Grep 후 부분 읽기 |
| `docs/02-design/study-app.design.screens.md` | §5 화면 상세 + 전역 패널·위저드 · §6 테마 토큰 · §7 상태 관리 — 필요한 절만 부분 읽기 |
| `docs/04-archive/` | 완료 이력 원문(M1~M16 로드맵 행·결정 기록, 완료 기능 상세). **평소 읽지 않는다** |
| `docs/01-plan/stage-{1..25}-*.plan.md` | 단계별 작업 지시서 — 체크리스트·DoD·제외 범위. **stage 1~25 전 단계 완료**(2026-08-05 — 22~25의 사용자 이행 항목(실사용 확인)까지 종료). 완료 경위·게이트 기록·잔여 항목은 **각 stage 문서**가 정본(15단계 이후는 머리말 "상태" 줄 + 말미 "완료 기록", 그 이전은 체크박스) — CLAUDE.md에 옮겨 적지 말 것 |
| `docs/manual/user-manual.html` | 사용자 매뉴얼 — 기능 변경 시 함께 갱신 |

구현 관련 질문의 답은 대부분 설계 문서에 이미 있다 — 추정하기 전에 먼저 읽을 것.
문서와 코드가 어긋나면 임의로 코드를 맞추지 말고 사용자에게 보고.

## 모델 운용 정책

| 작업 | 담당 | 모델 |
|---|---|---|
| 계획·설계 변경, 아키텍처 결정 | 메인 대화 또는 `plan-architect` | **Fable** (한도 소진 시 Opus — 에이전트는 모델 미지정=세션 상속) |
| 구현 사이클 오케스트레이션(`/stage-implement` 진행 중 메인 대화) | 메인 대화 | **Opus 이하** — 문서 Grep·에이전트 분배·결과 중계는 기계적이다. Fable은 계획·설계 대화에만 쓴다 |
| 백엔드/프론트 구현 | `backend-dev` / `frontend-dev` | **Sonnet** (예외: sm2·import_service·학습모드 UX는 opus 승격) |
| 단계 검토·코드 리뷰 | `stage-reviewer` | **Opus 고정** |

워크플로 스킬: `/stage-implement <n>` (구현+검토 한 사이클) · `/stage-review <n>` (검토만) · `/stage-status` (진행 현황).

## 토큰 규약 (모든 세션·에이전트)

1. `frontend/dist`는 빌드 산출물 — 읽기·grep·diff 금지. diff는 `git diff -- . ':!frontend/dist'`.
2. 계획·설계 문서는 **전체를 읽지 않는다** — Grep으로 `### 4.<n>`·`[S<n>]`·`## 5.<n>` 위치를 찾아 `Read offset/limit`으로 그 구간만.
3. 검증은 래퍼 스크립트로 — 출력이 요약 몇 줄로 고정된다(§실행 참조). `npm run build`는 성공/실패와 에러 줄만 확인.
4. 불변 규칙 기계 검사는 LLM이 grep하지 말고 `scripts/invariant-scan.ps1` 실행 결과(PASS/FAIL)로 갈음한다.
5. 서브에이전트에는 필요한 발췌·라인 범위를 프롬프트에 담아 전달 — 문서를 통째로 다시 읽게 하지 않는다.
6. 한 단계(stage) 사이클이 끝나면 새 세션으로 — 진척의 단일 출처는 stage 문서이므로 세션을 끊어도 잃는 게 없다.

## 불변 규칙 (모든 코드 작업에 적용)

1. **채점은 서버에서만** — quiz/session 응답에 정답·해설 포함 금지.
2. **attempts 저장 + 오답노트 생성 + SM-2 갱신 = 한 트랜잭션.**
3. 문서 삭제 = 소프트 삭제(`is_active=0`). 물리 삭제 금지. 분류에서 빼기 = 연결 해제.
4. `sources/` 원본 파일은 불변 — 수정·삭제 코드 금지.
5. **색상 하드코딩 금지** — `styles/tokens.css` 토큰만. 다크 모드는 토큰으로 공짜여야 한다.
6. 스키마 변경은 plan §6.2 갱신 + Alembic 마이그레이션 세트로만.
7. 테스트는 `services/sm2.py`만 필수(pytest). 나머지는 실행 스모크로 검증하고 결과 보고.
8. 에러 포맷·페이지네이션은 설계 §3 규약 준수.
9. 각 단계 범위를 지킬 것 — stage 문서의 "이 단계에서 하지 않는 것"이 우선한다.
10. 작업 완료 시 해당 stage 문서의 체크박스를 `[x]`로 갱신 (문서가 진척의 단일 출처).

## 실행

- 백엔드: `uvicorn main:app --host 0.0.0.0 --port 8000` (backend/에서)
- 프론트 개발: `npm run dev` (frontend/에서) / 배포 빌드는 `npm run build` → FastAPI가 dist 서빙
- 테스트: `powershell -ExecutionPolicy Bypass -File scripts/run-tests.ps1` (요약만 출력 · `-Path tests/test_sm2.py` 부분 실행 · `-Full` 전체 로그)
  — 임베디드 파이썬(`python-embed/`, `_pth`)이라 `python -m pytest`는 임포트 실패한다. 래퍼가 sys.path를 주입한다.
- 불변 규칙 검사: `powershell -ExecutionPolicy Bypass -File scripts/invariant-scan.ps1` (기준선 대비 신규 위반만 보고 · 정당한 변화면 `-UpdateBaseline`)
- DB: 프로젝트 루트 `study.db` (SQLite WAL). 백업 = 파일 복사.
- 접속: PC `http://localhost:8000`, 폰 `http://<PC-IP>:8000` — **외부 포트포워딩 금지(R12)**.
