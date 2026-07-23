---
name: stage-status
description: >
  Study Hub 진행 현황 요약. 사용법: /stage-status. 6개 stage 문서의 체크박스를 집계해
  단계별 진척률·현재 단계·다음 할 일을 보고한다.
---

# /stage-status — 진행 현황

1. `docs/01-plan/stage-*.plan.md` 6개를 읽어 각 문서의 `[x]` / `[ ]` 개수를 센다.
2. 표로 보고: 단계 | 이름 | 체크 n/m | 상태(미착수/진행중/완료) | MVP 여부.
3. "현재 단계" = 체크박스가 일부만 채워진 가장 낮은 번호. 그 단계의 **미완료 항목을 원문 그대로** 나열한다.
4. 코드 실재와의 대조는 가볍게만: backend/·frontend/ 디렉토리 존재, 마지막 수정 시각. (정밀 검증은 /stage-review 안내)
5. 마지막 줄에 다음 행동 1개를 권한다 — 예: "/stage-implement 2 로 반입 구현 착수".
