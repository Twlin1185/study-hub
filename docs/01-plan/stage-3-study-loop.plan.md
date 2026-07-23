# Stage 3 — 학습 루프 (M3: 커리큘럼 · 퀴즈 · 오답노트 · 이어하기)

> 상위: `study-app.plan.md` v0.4 · 설계: `../02-design/study-app.design.md` §4.4~4.6, §4.8, §5.1, §5.4~5.6, §5.8
> 선행: Stage 2 (실데이터 필요) · 포함 기능: F05, F06, F19, F20 + 홈 1차 + 설정 API
> MVP 여부: **MVP 3/3 — 이 단계가 끝나면 매일 쓸 수 있는 앱**

## 목표

계획서 §9.2의 연속 학습 흐름 완성: 홈 "이어하기" → 챕터 학습(개념→확인문제) →
챕터 완료 → 퀴즈/오답노트. 폰으로 3분 공부하다 꺼도 정확히 그 자리에서 재개.

## 작업 체크리스트

### 1. 백엔드 — 진도·이어하기
- [x] `GET /api/categories/{id}/study-track`: sort_order순 문서 + study_progress 상태 + resume 위치
- [x] `POST /api/study/events`: `complete`(progress=done, 트리 진도 반영) / `position`(resume_points upsert)
- [x] `GET /api/study/continue`: 최근 갱신순 이어하기 카드 3개 (분류 경로 문자열 조립 포함)
- [x] categories/tree 응답에 진도율 채우기 — 하위 트리 집계(done/total), 재귀 CTE 1쿼리

### 2. 백엔드 — 퀴즈·채점·오답노트
- [x] `POST /api/quiz/session`: sequential/random/wrong_only 모드, 정답·해설 제외 응답
- [x] `POST /api/attempts`: **서버 채점**(정규화 비교: 공백·대소문자), attempts 기록,
      오답 시 review_notes 자동 생성(있으면 재사용, UNIQUE) — 한 트랜잭션.
      응답에 정답·해설·review_note_id 포함 (srs는 null — S5에서 연결)
- [x] review-notes: GET(필터 resolved/reason/category) + PATCH
- [x] `GET /api/dashboard` 1차: continue + ddays (heatmap·복습수는 S4/S5에서)
- [x] settings GET/PUT (`quiz.default_count` 사용 시작)

### 3. 프론트엔드
- [x] **커리큘럼** `/curriculum(/:id)`: 시험 카드 → 과목·챕터 아코디언 + 진도바 + [이어하기/여기서 시작]
- [x] **학습 모드** `/study/:categoryId` (설계 §5.5): 진행바, 개념=Markdown·문제=인라인 퀴즈 카드,
      개념 "다음"=complete, 문제는 제출해야 다음 활성화, 이탈 시 position 저장
- [x] 챕터 완료 화면: 정답률 + 틀린 문제 즉시 재도전(wrong_only 미니 세션) + [다음 챕터]
- [x] **퀴즈** `/quiz`→`/quiz/run` (설계 §5.6): 설정(범위 트리·모드·문항수), 즉시 채점 카드,
      해설 펼침, 종료 요약. quizSession zustand(문항 타이머 포함)
- [x] **오답노트** `/review-notes`: 필터, 메모 인라인 편집, 틀린이유 태그, 극복 토글, 재도전
- [x] **홈 대시보드 1차**: 이어하기 카드 + D-Day (리다이렉트 제거)
- [x] 문서 상세에 풀이 이력 미니차트(최근 10회 ○×)

## 완료 기준 (DoD)

1. 폰에서: 홈 이어하기 탭 → 학습 모드 정확한 문서 복귀 → 개념 2개·문제 1개 진행 →
   앱 종료 → 재접속 시 그 문제부터 재개 (**끊김 없는 왕복 시연**)
2. 챕터 12문서 완주 → 완료 화면 정답률 표시 → 트리·커리큘럼 진도바 갱신 확인
3. 퀴즈 20문항 랜덤 세션 → 오답이 오답노트에 자동 수집 → 메모 작성 → "재도전"으로 그 문제만 다시 풀기
4. 채점이 서버에서만 일어남: quiz/session 응답 페이로드에 정답·해설 부재 확인
5. 여기까지로 "매일 저녁 30분 학습"(시나리오 S1)이 실사용 가능

## 이 단계에서 하지 않는 것

SM-2·복습 큐(S5), 플래시카드(S5), 히트맵·약점 분석(S4), 북마크·관계 UI(S4), 모의고사(v1.x).
