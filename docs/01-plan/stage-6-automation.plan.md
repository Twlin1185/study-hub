# Stage 6 — 자동화 · 다듬기 (M6: 태그 규칙 · 검색 · CLI 변환 · PWA · 백업)

> 상위: `study-app.plan.md` v0.4 §11, §13 · 설계: `../02-design/study-app.design.md` §4.9, §4.10
> 선행: Stage 2(반입)·Stage 4 권장 · 포함 기능: F12, F17, F18, F21, F23, F27

## 목표

반입→분류→검색이 앱 안에서 완결. "파일을 던지면 변환·반입·분류 제안까지" 자동화.

## 작업 체크리스트

### 1. 태그 자동 분류 (F21, 계획서 §11)
- [ ] tag_query 파서: **단일 태그 + OR만** (R13 — AND/괄호는 하지 않음)
- [ ] 트리거 3곳: 반입 커밋 시 / 태그 변경 시 / 규칙 생성·수정 시 일괄 스캔(`POST /tag-rules/{id}/scan`)
- [ ] suggestions 저장·조회·apply(승인/거절). `mode='auto'` 규칙은 즉시 연결하되 연결 출처 기록
- [ ] UI: 설정 또는 탐색 내 규칙 관리 + 홈/탐색에 "제안 N건" 배지 → 제안함 화면
- [ ] "이 규칙이 연결한 문서들" 일괄 해제

### 2. 전문 검색 (F12)
- [ ] FTS5 가상 테이블(title/content/explanation) + insert/update/delete 동기화 트리거 마이그레이션
- [ ] `GET /api/search?q=&type=`: 스니펫(매칭 부분 하이라이트) 포함
- [ ] UI: 헤더 검색창(단축키 `/`), 결과 화면 — 타입 배지·스니펫·태그 검색 통합

### 3. Claude CLI 변환 (F23, 계획서 §13-B)
- [ ] `services/convert_service.py`: `claude -p` 서브프로세스 (`--output-format json`,
      프롬프트 = `prompts/convert.md` + 파일), 타임아웃(기본 10분)·에러 캡처, 잡 큐(동시 1개)
- [ ] `POST /api/convert` → job_id / `GET /api/convert/{job_id}` 폴링 → 완료 시 반입 preview로 자동 연결
- [ ] claude CLI 부재/실패 시 명확한 에러 + 수동 반입(A방식) 안내 폴백
- [ ] 반입 화면에 "원본 파일로 시작" 업로드 경로 추가

### 4. PWA · 백업 · 마무리
- [ ] PWA(F18): manifest + 아이콘 + 최소 service worker(앱 셸 캐시. 데이터 캐시는 안 함 — 로컬 서버라 오프라인 의미 없음)
- [ ] 백업(F27): `POST /api/backups`(study.db `VACUUM INTO` + sources/ zip, `backups/`에 타임스탬프 저장),
      목록, restore(확인 문구 타이핑 필수, 복원 전 자동 스냅샷 1개 생성)
- [ ] 자동 백업 옵션(`backup.auto=daily` — 앱 기동 시 마지막 백업 24h 경과면 실행)
- [ ] 통계 CSV 내보내기(F17): attempts 원본 + 문서/분류 메타 조인
- [ ] 태그 병합 도구(`POST /api/tags/merge`) UI

## 완료 기준 (DoD)

1. 기출 PDF를 앱에 업로드 → 변환 → 미리보기 → 반입 → 태그 규칙이 분류 연결 제안 → 승인 — **전 과정이 앱 안에서 완결** (시나리오 S2의 완전 자동화판)
2. 검색창에 "정규화" → 개념·문제 스니펫과 함께 즉시 결과
3. 폰 홈 화면에 PWA 설치, 아이콘으로 실행
4. 백업 생성 → DB 파일 삭제(시뮬레이션) → 복원 → 데이터 원상 확인
5. 규칙 오분류 시 "이 규칙이 연결한 것" 일괄 해제 동작

## 이 단계에서 하지 않는 것

Claude API 직접 호출(C안 — 원격 운영 필요 시), 유사도 기반 문서 감지 고도화(F14), 모의고사·스트릭(v1.x 별도 계획).

---
> v1 완성 지점. 이후: 실사용 피드백 → v1.x 계획(F25 모의고사, F26 스트릭, F15 분기, F16 D-Day 강도) 수립.
