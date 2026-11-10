# Stage 2 — 반입 (M2: JSON Import 파이프라인)

> 상위: `study-app.plan.md` v0.4 · 설계: `../02-design/study-app.design.md` §4.3, §5.9
> 선행: Stage 1 · 포함 기능: F04 + 변환 프롬프트 템플릿
> MVP 여부: **MVP 2/3**

## 목표

Claude Code로 변환한 기출 JSON을 미리보기·검증·중복 처리 거쳐 DB에 적재한다.
**실데이터 100문제 이상**이 들어와야 Stage 3(학습 루프)을 실물로 검증할 수 있다.

## 작업 체크리스트

### 1. 변환 프롬프트 템플릿
- [x] `prompts/convert.md` 작성 — 반입 JSON 규격(계획서 §8.2, format_version 1) 명세 +
      타입 판별 기준, 태그 부여 지침, `suggest_categories`/`suggest_relations` 작성 규칙,
      인터리브 배치(개념 몇 개+확인문제) 순서 제안 지침
- [x] 샘플 원본(기출 PDF 1개)으로 Claude Code 변환 → `import/*.json` 실물 확보
      (2020-4회 품질경영기사 필기 100문항 — 정답은 공식 기출 정답 웹 교차 검증, 반입 완료)
      (실제 기출 PDF 미확보로 보류. 스모크는 합성 샘플 JSON으로 검증 완료)

### 2. 백엔드 — import_service
- [x] Pydantic으로 규격 검증 (필수 필드, 타입별 조건: 문제면 answer 필수)
- [x] 중복 감지: 제목+내용 정규화 해시 → `duplicate_suspect` + 대상 문서 반환
- [x] `suggest_categories` 해석: 경로 문자열 → 기존 노드 매칭 or "생성 제안"
- [x] `suggest_relations` 해석: doc_no 조회, 없으면 `found:false` 경고
- [x] `POST /api/import/preview`: multipart(JSON + 원본 파일 선택) → 리포트(설계 §4.3 응답 형태).
      원본은 `sources/` 저장 + SHA-256 → 같은 해시 재반입 시 `duplicate_source:true`
- [x] `POST /api/import/commit`: 항목별 결정(new/skip/merge) 반영, 분류 연결·관계 생성,
      트랜잭션 1개, 결과 요약 반환. preview 캐시 TTL 1시간(만료 409)
- [x] merge 동작: 기존 문서에 태그·source_detail 병합, 본문 불변

### 3. 프론트엔드 — 반입 위저드 (설계 §5.9)
- [x] 3단계 위저드: 파일 선택 → 미리보기 표 → 실행 결과
- [x] 미리보기: 상태 배지(정상/중복 의심/오류), 중복 나란히 비교 + 라디오(건너뛰기/새로/병합),
      분류·관계 제안 체크박스(기본 체크), 오류 항목 사유 표시
- [x] 결과 화면: 생성/병합/건너뜀 카운트 + 새 문서 목록 바로가기

## 완료 기준 (DoD)

1. 실제 기출 1회분을 Claude Code로 변환 → 반입 → **DB에 100문제 이상** 적재
2. 같은 JSON을 다시 반입하면 전 항목 중복 의심으로 잡히고, 전체 건너뛰기 가능
3. `suggest_categories`의 미존재 분류가 "생성 제안"으로 표시되고 승인 시 노드 생성+연결
4. 반입된 문서가 탐색 화면 트리에서 정상 조회
5. 잘못된 JSON(필수 필드 누락) 업로드 시 명확한 항목별 오류 표시, 부분 반입 가능

## 이 단계에서 하지 않는 것

앱 내 LLM 변환(F13/F23 — S6), 유사 문서 감지 고도화(F14 — 해시 동일 수준만), 태그 규칙 매칭(S6).
