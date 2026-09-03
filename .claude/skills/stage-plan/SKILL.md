---
name: stage-plan
description: >
  잔여 등록부(backlog.md)의 항목을 골라 새 stage 지시서를 편성하는 워크플로. 사용법:
  /stage-plan <ID…|설명> (예: /stage-plan FB-14 FB-20). "무엇을 할지"를 확정하고 stage-{n} 문서·
  설계 계약·stage-index 행·등록부 상태까지 plan-architect(Fable)가 한 번에 만든다. 코드 0 —
  구현은 /stage-implement.
---

# /stage-plan <ID…|설명> — 할 일 확정 → stage 편성

stage 문서는 "할 일을 정한 뒤" 쓰는 산출물이다. 이 스킬이 그 "정하는" 단계다. **코드는 쓰지 않는다.**

## 0. 후보 확정
1. `powershell -ExecutionPolicy Bypass -File scripts/backlog-scan.ps1` 1회 → `TODO` 행과 진행중 stage 확인.
   진행중 stage가 있으면 편성보다 `/stage-implement <n>`이 먼저인지 사용자에게 1줄로 확인.
2. 인자가 ID면 `docs/01-plan/backlog.md`에서 **그 행만** Read(요지·출처·편성 조건). 인자가 자유 설명이면
   먼저 `/backlog` 절차로 등재(FB-n 부여)한 뒤 진행. 인자 없음 → `TODO` 중 우선순위 신호(결함 > 확정 대기 >
   최신 실수요 > 저비용 정비) 순 묶음 1개를 제안하고 확인받는다.
3. 묶음 규칙: 같은 표면·같은 버전 영향(핵심/사소)끼리 1 stage. **핵심**(새 기능 표면·DDL/API·퇴역)은
   단독 편성, **사소**(버그·다듬기·정비)는 3~5건 동승 가능. 착수 금지(`보류`) 행은 편성하지 않는다 —
   해제가 필요하면 착수 전 결정(D)부터.
4. 번호 = `stage-index.md` 마지막 행 + 1. 파일명 `docs/01-plan/stage-<n>-<slug>.plan.md`.

## 1. plan-architect 위임 (모델 = 세션 상속 · Fable)
프롬프트에 **발췌를 직접 담아** 전달(문서 통째 재읽기 금지 — 토큰 규약 5):
- 편성 대상 backlog 행 원문 + 각 출처 행 원문(별지 §13 FB 행 / §10 D 행 / 마스터 §15 R 행 — Grep 후 그 줄만).
- 번호·파일명·버전 영향 판정 초안(핵심/사소 — CHANGELOG 머리 규약 ③ 기준)과 근거.
- 요구 산출물(전부 필수):
  1. **stage 문서** — plan-architect 정의의 "stage 지시서 표준 절" 8개를 갖출 것(상태 줄 · 범위 표 · 착수 전
     결정/규약 · 체크리스트(백엔드/프론트/검증/문서 묶음) · 하지 않는 것 · DoD · 완료 시 절차 · 완료 기록(빈 절)).
  2. **설계 계약** — 신규 API는 `study-app.design.api.md` §4에 `[S<n>]` 태그 절, 화면은 `.screens.md` §5.
     DDL이 필요하면 plan §6.2 + Alembic 필요성 명시(불변 규칙 6). 스키마 변경 없으면 "DDL 0" 명기.
  3. **stage-index.md 1행 추가**(상태 = 착수 전 · 버전 영향 핵심/사소 명기).
  4. **backlog.md 상태 갱신** — 해당 행 상태 = `편성 = stage-<n>` (행은 §1/§2에 그대로).
  5. **출처 추기 1줄** — 별지 §13 FB 행 / §10 D 행 배정 셀 끝에 `← 편성(YYYY-MM-DD): stage-<n>`.
  6. 마스터 계획 §14 로드맵에는 **핵심 stage만** M 행 추가(사소 stage는 로드맵 미등재 — stage-index가 담당).
- 요구 보고: 변경 파일 목록 · 확정 결정 · 사용자 확정이 필요한 항목(있으면 **편성 보류로 표시** — 임의 확정 금지).

## 2. 마무리
- `backlog-scan.ps1` 재실행 → PASS 확인(편성한 행이 `TODO`에서 빠졌는지).
- 사용자 보고: stage 번호·제목·버전 영향·묶인 ID·사용자 확정 대기 항목 · 다음 = `/stage-implement <n>`.
- 편성 커밋 1개(문서만). 구현은 새 세션에서 시작하도록 안내(토큰 규약 6).
