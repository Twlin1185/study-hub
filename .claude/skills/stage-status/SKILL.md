---
name: stage-status
description: >
  Study Hub 진행 현황 + 잔여 할 일 요약. 사용법: /stage-status. stage 체크박스(정한 일의 진척)와
  잔여 등록부(M/F/D/R/FB 미종결 = 아직 정하지 않은 일)를 스크립트 1회로 집계해 "지금 뭘 해야 하는가"를
  보고한다. stage는 할 일을 정한 뒤 쓰는 산출물이므로 stage 완료 = 끝이 아니다.
---

# /stage-status — 진행 현황 + 잔여 할 일

**원칙**: 진척은 stage 문서, 잔여는 `docs/01-plan/backlog.md`(정본 = 마스터 계획 §14 M·§5 F·§15 R ·
별지 `editor-v2.plan.md` §10 D·§13 FB). 두 축을 모두 보고해야 "다음 할 일"이 나온다.

1. **스크립트 1회** (문서 5곳을 직접 grep·Read 하지 않는다 — 토큰 규약 3·4):
   `powershell -ExecutionPolicy Bypass -File scripts/backlog-scan.ps1`
   출력 = `[STAGE]` 집계·진행중 stage의 미완료 항목 원문 · `[M]/[F]/[R]/[D]/[FB]` 미종결 · `[REGISTRY]`
   등록부 대조(PASS/DRIFT) · `TODO` = 편성 대상 행. 세부가 더 필요할 때만 `-Detail`.
2. **보고 (한국어, 이 순서)**:
   - 첫 줄: 현재 버전(루트 `VERSION`) · stage 집계(총/완료/진행중) · 등록부 판정(PASS/DRIFT).
   - **진행중 stage**가 있으면: 번호·제목·n/m + 미완료 체크박스 **원문 그대로**. 이것이 "현재 단계".
   - **잔여 할 일** 표: ID | 요지 | 상태 | 편성 조건 — `TODO`(미편성·미배정·확정 대기) 행 전부 + 보류·감시는 개수만.
     요지·조건은 `backlog.md`의 해당 행에서 옮긴다(스캔 출력만으로 부족하면 그 행만 Read).
   - **DRIFT**면 `UNREGISTERED`(출처엔 열려 있는데 등록부 누락 → `/backlog` 등재)·`CHECK-CLOSED`(등록부엔
     활성인데 출처는 닫힘 → 종결 처리) 항목을 그대로 나열. 임의로 문서를 고치지 않는다.
   - 코드 실재 대조는 가볍게: backend/·frontend/src 존재 + 마지막 커밋 1줄. (정밀 검증은 `/stage-review`.)
3. **마지막 줄 = 다음 행동 1개** (우선순위 = backlog.md 머리 "우선순위 신호"):
   - 진행중 stage 있음 → `/stage-implement <n>`.
   - 없고 `TODO` 있음 → `/stage-plan <ID…>` — 결함 > 사용자 확정 대기 > 최신 실수요 > 저비용 정비 순으로
     **묶음 1개를 구체적으로** 권한다(예: "FB-14 + FB-20 + FB-6-후속① 사소 stage로 편성").
   - `TODO`도 없음 → 사용자에게 실수요 피드백 접수 요청(`/backlog`).
