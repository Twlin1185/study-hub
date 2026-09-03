---
name: stage-implement
description: >
  Study Hub의 특정 단계(stage 문서가 있는 단계)를 계획 문서대로 구현하는 워크플로. 사용법:
  /stage-implement <번호>. 단계 계획을 읽고 백엔드/프론트 작업을 분배(sonnet 에이전트), 구현 후
  opus 검토(stage-reviewer)·완료 절차(CHANGELOG·stage-index·backlog)까지 한 사이클로 돈다.
  stage 문서가 없는 번호는 구현하지 않는다 — /stage-plan으로 먼저 편성.
---

# /stage-implement <n> — 단계 구현 워크플로

인자 n의 stage 문서(`docs/01-plan/stage-<n>-*.plan.md`)를 작업 지시서로 삼는다.
- 인자 없음 → `scripts/backlog-scan.ps1` 1회로 **진행중 stage**를 찾아 제안·확인. 진행중이 없으면 구현할
  것이 없다 — `/stage-plan`(편성)을 안내하고 끝낸다.
- 문서 없음 → **구현하지 말고** `/stage-plan <ID…>`를 안내한다(stage는 할 일을 정한 뒤 쓰는 산출물).

## 0. 준비 확인
1. stage 문서를 읽는다(전체 — 지시서는 예외). "이 단계에서 하지 않는 것"이 최우선(불변 규칙 9).
2. 선행 조건: `stage-index.md`에서 직전 stage 상태가 완료인지, 문서의 "착수 전 결정"에 **사용자 확정 대기**가
   남아 있지 않은지. 미충족이면 **시작하지 말고** 보고.
3. 설계는 3분할(§ 번호 불변): 공통 규약 `docs/02-design/study-app.design.md`(§1~3) · API
   `study-app.design.api.md`(§4 — `[S<n>]` Grep) · 화면 `study-app.design.screens.md`(§5). 라인 범위만 잡는다.
4. 작업 브랜치 `stage-<n>-<slug>`(main 직접 작업 금지).

## 1. 작업 분배 (구현 = sonnet)
- 체크리스트를 **백엔드 묶음 / 프론트 묶음 / 검증 묶음 / 문서 묶음**으로 나눈다(stage 문서 §3 관례).
- API 계약이 확정돼 있으므로 독립 묶음은 `backend-dev`·`frontend-dev`를 **병렬**로, 신규 API 의존은 순차로.
- **에이전트 프롬프트 (토큰 규약 5)** — 문서를 다시 읽게 하지 말고 담아 보낸다:
  1. stage 번호 + 담당 체크리스트 **원문** + "하지 않는 것" 원문 + 관련 규약(착수 전 결정) 원문.
  2. 설계 발췌: 짧으면 붙여넣기, 길면 `study-app.design.api.md:<시작라인>`(백엔드) /
     `study-app.design.screens.md:<시작라인>`(프론트)로 `Read offset/limit` 지시.
  3. 명시: "계획·설계 전체 읽기 금지 · `frontend/dist` 금지 · **서버 구동 금지**(스모크는 임시 포트 짧게 +
     종료·리스너 부재 확인, 8000 금지) · 불변 규칙은 에이전트 정의 참조".
- **모델 승격**: `services/sm2.py` · `services/import_service.py` · 학습 모드 UX(§5.5) · 편집기 코어(BlockNote
  스펙·어댑터) 묶음만 `model: opus`.
- 설계 변경 필요 보고 → 구현 중단 → `plan-architect`로 결정(문서 갱신) → 재개.

## 2. 통합 확인
- 래퍼 스크립트만(원시 로그 금지): `scripts/run-tests.ps1` · `scripts/invariant-scan.ps1` · 프론트
  `npm run build` 성공/실패. 셋 다 통과해야 검토로.
- 실행 확인이 꼭 필요하면 **임시 포트**로 짧게 띄우고 종료 + 리스너 부재 확인(CLAUDE.md §실행). 브라우저
  확인은 사용자가 띄운 8000만(`/browser-debug`).
- 실패 → 해당 에이전트에 SendMessage로 수정 지시(새 에이전트 금지 — 맥락 유지).

## 3. 검토 (opus)
- `stage-reviewer` 실행: stage 번호 + 문서 경로 + "DoD 실행 수준 검증 · dist 제외".
- 치명/중요 → 구현 에이전트 수정 → 재검토(최대 3회, 잔존 시 사용자 판단). 경미 → 목록 보고(처분은 사용자).

## 4. 완료 절차 (CHANGELOG 규약 ⑤ — 전부 필수)
1. stage 문서: 체크박스 `[x]` 실제 일치 · 머리말 **상태 줄** 갱신 · "완료 기록" 절에 경위(검토 판정·머지 PR).
   CLAUDE.md에는 옮겨 적지 않는다(버전 줄 1곳만).
2. `docs/03-release/CHANGELOG.md` 1항목(신→구) · 발행이면 루트 `VERSION` bump(핵심 = MM+1·PP=1, 사소 = PP+1)
   + CLAUDE.md 버전 줄.
3. `stage-index.md` 해당 행: 상태 완료 · 완료일 · 산출 버전.
4. **`backlog.md`**: 편성됐던 행 → 상태 `종결(stage-<n> · 날짜)`로 §4 이동 · 범위 밖에서 새로 발견한 항목은
   `/backlog` 절차로 등재(출처 행 + 등록부 행). 출처(별지 §13 FB / §10 D) 배정 셀에 `← 완료(stage-<n> · 날짜)` 추기.
5. `scripts/backlog-scan.ps1` → PASS 확인(DRIFT면 여기서 잡는다).
6. 매뉴얼(`docs/manual/user-manual.html`)은 사용자 대면 기능 변경 시 갱신.
- 보고: DoD n/m · 검토 판정 · 남은 결함 · 사용자 직접 확인 항목(폰 실기기 등 자동 검증 불가) · 다음 행동
  (`/stage-status`). 사이클 종료 후 **새 세션 시작 안내**(토큰 규약 6).
