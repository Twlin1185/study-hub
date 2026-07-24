# Stage 8 — LLM 인프라 (M8: 엔진 관리 · 폴백 · URL 반입) — v1.x 첫 단계

> 상위: `study-app.plan.md` v0.9 §14(M8), F34·F35 명세 · 설계: `../02-design/study-app.design.md` v1.7 **§4.11**
> 선행: v1 완성(M1~M7) · 포함 기능: **F34**(LLM 엔진 관리), **F35 1단계**(URL 반입)
> 배경: 2026-07-24 실사용에서 CLI 429 세션 한도 초과 시 원문 JSON이 노출되고 대안이 없었음.

## 목표

변환·재생성이 **한도에 걸려도 끊기지 않는다** — 오류는 사람 말로("세션 한도 초과 — 21:40 리셋"),
대안은 버튼으로(API 폴백), 콘텐츠 유입은 URL 하나로.

## 작업 체크리스트

### 1. 백엔드 — 엔진 진단·키 관리 (F34)
- [x] `services/llm_engine_service.py`: CLI 진단(설치=`claude --version`, 로그인/호출 가능=초경량 호출), API 키 검증(초경량 SDK 호출), 진단 결과 캐시(연속 호출 방지)
- [x] `secrets.json` 로더: 루트 저장, **.gitignore 추가 + 백업(F27) zip 제외** 확인. 키 해석 순서: secrets.json → 환경변수 → `ant` 프로필
- [x] `GET /api/llm/status` · `POST /api/llm/api-key`(즉석 연결 테스트 성공 시에만 저장, 응답은 `key_suffix`만) · `DELETE /api/llm/api-key` (설계 §4.11)
- [x] settings 키: `llm.priority`(기본 cli) · `llm.fallback`(기본 ask) · `llm.api_model`(기본 claude-sonnet-5)

### 2. 백엔드 — 이중 엔진 convert/regenerate (F34)
- [x] API 엔진 경로: anthropic SDK 직접 호출 — convert/regenerate와 **동일 프롬프트 템플릿**, 기존 잡 큐(동시 1개) 공유
- [x] `POST /api/convert`·regenerate에 `engine` 파라미터(`auto|cli|api`, 기본 auto=우선순위 설정)
- [x] **오류 구조화**: 잡 실패 시 CLI/API 응답 파싱 → `error_info {kind, limit_kind?, resets_at?, message, action, fallback_available}` (설계 §4.11). CLI 429 `result` 문자열에서 한도 종류·리셋 시각 추출. **원문 JSON 노출 금지**
- [x] 한도 기억: 최근 429를 settings `llm.last_limit`에 기록, 리셋 전 시도 시 실행 전 경고 응답, 경과 시 자동 무효화

### 2b. 백엔드 — 잡 진행 가시화 (F34, 설계 §4.11 `progress`)
- [x] CLI 실행을 `--output-format stream-json`으로 전환, 스트림 이벤트에서 활동·누적 usage 실시간 파싱 → 잡 `progress {phase, detail, elapsed_ms, last_activity_at, usage, eta_ms?}` 갱신 (API 엔진은 SDK 스트리밍 동일)
- [x] 단계 전이 기록: downloading(URL) → preparing → llm_running → parsing → preview_building
- [x] ETA 대략치: 과거 완료 잡의 (입력 크기→소요 시간) 이동 평균, 표본 없으면 생략

### 3. 백엔드 — URL 반입 (F35 1단계)
- [x] `POST /api/convert {url}`: 서버 다운로드 → 기존 변환 파이프라인. **안전장치 필수**: 크기 상한(예: 50MB), content-type 화이트리스트(pdf/html/이미지/md), **사설·로컬 IP 차단(SSRF)**, 타임아웃
- [x] 다운로드 원본은 sources/ 보관 관례 재사용(파일 반입과 동일)

### 4. 프론트엔드
- [x] **설정 화면 카테고리 골격 선반영**(F38 선행분): 설정을 6그룹(학습/일정/태그·분류/LLM 엔진/데이터/화면)으로 나누고 좌측 목차(모바일 아코디언) 추가 — 기존 항목은 그룹으로 이동만, 세부 재구성·태그 관리자는 M9
- [x] 설정 "LLM 엔진" 섹션: **CLI 카드**(설치/로그인/정상 3상태 + 한도 상태·리셋 시각 + 미로그인 시 "터미널에서 `claude` 실행" 안내 마법사 + [다시 확인]) · **API 카드**(키 입력→연결 테스트→마스킹 표시·삭제)
- [x] 우선 엔진 세그먼트(CLI↔API) + 폴백 정책(자동/물어보기/끔) — **자동 선택 시 과금 발생 동의 확인** 필수
- [x] 반입 화면 "URL로 시작" 입력(기존 convert 폴링·미리보기 연결 재사용)
- [x] 잡 실패 시 `error_info` 렌더: 한도면 종류·리셋 시각 + `fallback_available`이면 [API로 재시도] 버튼(`engine:'api'` 재요청). 원문 JSON 미노출
- [x] 한도 기억 경고: 리셋 전 변환 시도 시 시작 전에 배너로 안내
- [x] **진행 패널**: 단계 스텝(다운로드→준비→LLM 작업 중→결과 정리→미리보기) + 경과 시간 + 토큰/예상 비용 라이브 카운터 + 대략 ETA + "새로고침해도 작업은 서버에서 계속됩니다" 안내. `last_activity_at`이 일정 시간 갱신 없으면 "응답 지연" 표시

## 완료 기준 (DoD)

1. CLI 한도 상태에서 변환 → "Claude 구독 세션 한도 초과 — 오늘 21:40 리셋" 형태 메시지 + [API로 재시도] 동작 (원문 JSON 없음)
2. API 키 등록(즉석 테스트) → CLI 없이 API 엔진만으로 변환→미리보기→반입 성공
3. **키가 study.db·백업 zip·git 트래킹 어디에도 없음** 검증
4. 공개 기출 PDF URL 입력 → 다운로드→변환→미리보기→반입 완결 (사설 IP URL은 거부됨)
5. 폴백 '자동'은 과금 동의 후에만 설정 가능, '끔'이면 기존 A방식 안내 유지
6. 설정 CLI 카드가 미설치/미로그인/정상 3상태를 정확히 표시하고 [다시 확인]으로 갱신
7. 변환 진행 중 단계·경과 시간·누적 토큰이 실시간 갱신되고, **브라우저 새로고침 후에도 같은 잡의 진행 표시가 이어짐** (마냥 기다리는 스피너 없음)

## 이 단계에서 하지 않는 것

F35 2단계(사이트 어댑터·자격증/회차 선택 UI), 사용량 미터링·비용 추적 대시보드, 다중 API 키/프로필,
C안 전면 전환(이중 엔진 병행일 뿐), CLI 로그인 대행(불가 — 안내만), 배치 변환.

---
> 완료 후 M9(일상 다듬기 — F36 학습 UX 10건 + 검색 recall + 복원 UX)로 이어진다.
