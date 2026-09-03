---
name: stage-review
description: >
  Study Hub 특정 단계의 구현을 검토만 수행 (구현 없이). 사용법: /stage-review <번호>.
  opus 검토자(stage-reviewer)가 DoD 실행 검증 + 설계-구현 갭 + 불변 규칙 위반 + 완료 절차(문서 4종)
  이행 여부를 보고한다.
---

# /stage-review <n> — 단계 검토

1. 인자 없음 → `scripts/backlog-scan.ps1` 1회로 진행중 stage(없으면 `stage-index.md` 마지막 완료 stage)를
   대상으로 제안하고 확인받는다.
2. `stage-reviewer`(opus) 실행. 전달: 단계 번호 · stage 문서 경로 · "DoD를 실행 수준으로 검증" · "`frontend/dist`
   제외" · "완료 절차 4종(stage 문서 상태 줄·CHANGELOG·stage-index·backlog) 이행 여부도 판정".
3. 사용자 보고:
   - 판정(통과/조건부/반려) 첫 줄
   - 결함 심각도순 + `파일:라인`
   - "미검증"(폰 실기기 등)은 사용자 확인 필요 목록으로 분리
   - 완료 절차 누락이 있으면 별도 줄(문서만 고치면 되는 것과 코드 수정이 필요한 것을 구분)
4. 반려면 수정 방안만 제시 — **수정은 하지 않는다**. 사용자가 `/stage-implement <n>` 재실행 또는 개별 수정을
   결정한다. 범위 밖 발견은 `/backlog` 등재를 권한다.
