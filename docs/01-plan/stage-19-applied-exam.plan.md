# Stage 19 — 응용 모의고사: 범위 기반 LLM 응용 문항 생성·응시 (M19: F45)

> 상위: `study-app.plan.md` **v0.30** §14(M19)·**F45**(배경·①②③·확정 결정의 단일 출처) · 설계: **§4.21 신설 완료(2026-08-02, Design v1.23 — 엔드포인트 계약·검증 게이트·격리 규약·마커 형식의 정본)**
> 배경(등재 근거 — 2026-08-01 사용자 제안): 실전 모의고사(F25)는 기출 랜덤 출제라 반복하면 "이해해서 푸는 것"과 "본 문제를 기억해서 맞히는 것"이 섞인다. F45 = 같은 개념을 **기출에 없던 다른 표현으로** 출제하는 별도 축(F25 대체 아님 — 병행).
> **상태: 착수 전 결정 ①~⑦ 전건 확정(2026-08-02) — 착수 가능.** 이 기능은 **사전 미리보기 승인이 원리상 불가능**하다(문제를 미리 보면 시험 무의미) → 방어선은 **사후 검토 리포트**(문항별 근거 문서 링크 + F30 신고·재생성)와 **격리 저장**(R22 ②·③)으로 이동한다.
> 순서 관계(plan §14): F44(M18) 선행 이행 완료 — 결정 ③이 F44 마커 관례를 상속했다. M17·M18과 파일 충돌 없음.
> 불변 규칙 재확인: **채점은 서버에서만(1)** — 응시 구성은 기존 `exam/session` 재사용, 응시 응답에 정답·해설·basis **스키마 수준 부재**(계약 불변). **제출 채점 = attempts+오답노트+SM-2 한 트랜잭션(2)** — 오답이 복습 루프에 들어가는 것이 격리 저장을 택한 이유다. 스키마 변경 금지(6 — **DDL 0건 확정**, §4.21 말미) · 색상 토큰만(5) · 에러 규약 §3 · 실행 전 사용량 안내 없는 LLM 호출 금지(F35).

## 현행 실측 (2026-08-02 — 상세 앵커는 설계 §4.21 말미·§4.20 앵커 절이 정본, 여기는 요지)

- **재사용 자산이 전부 있다**: 응시 화면·채점 = F25(§4.14 — exam/session·채점 코어(커밋 없는 공용 함수)·history 파생 로직·ExamRun·리포트) · 잡 큐 = convert·regenerate·answer_key 공용(kind 추가로 확장) · 사용량 안내 = `fetch_service.estimate_usage` 필드 관례 + FetchImportWizard 확인 스텝(chars/1.5 보정은 S18 확정) · 원문 대조 = `source_match.SourceMatcher`(§4.17 ⑥ — 이번엔 **역적용**: 복제 검출) · 마커 관례 = F44 결정 ③(§4.20) · 엔진 레지스트리·폴백 = §4.17.
- 값 확장만으로 무-DDL 성립: `attempts.mode`·`category_documents.linked_by`·`document_relations.relation/created_by` 전부 자유 텍스트(CHECK 없음 — §6.2 주석 갱신 완료).

## 착수 시 선행 절차 (완료 — 결정·문서를 먼저 굳혔다)

- [x] **D1. 결정 ① 저장 방식** — **확정(2026-08-02, §4.21)**: 격리 저장 — documents type='question' + 예약 루트 "AI 응용 모의고사"(settings `applied_exam.root_category_id` 포인터) 아래 **런 단위 분류**에만 연결(`linked_by='applied_exam'`). 근거 = 불변 규칙 2(오답노트·SM-2가 참조할 실문서).
- [x] **D2. 결정 ② attempts.mode** — **확정(2026-08-02, §4.21)**: **'applied_exam' 신설** — exam/history 런 키(mode='exam' 배치) 혼입·R15 재평가 오염 방지. 이력은 `applied-exam/history`로 분리(파생 로직 재사용).
- [x] **D3. 결정 ③ 생성분 표기** — **확정(2026-08-02, §4.21)**: F44 마커 관례 상속 — content 서두 고정 마커 라인, 접두 **`[AI 생성 문항]`**(저장 시 서버 부착 — 전 화면 상시 표시, 무-DDL).
- [x] **D4. 결정 ④ 근거 연결** — **확정(2026-08-02, §4.21)**: `document_relations(relation='derived_from', created_by='applied_exam')` — F43 'embeds' 전례(값 확장·§6.2 주석만). 리포트 근거 링크의 출처.
- [x] **D5. 결정 ⑤ 부분 실패** — **확정(2026-08-02, §4.21)**: 부분 성공 저장·부분 응시 허용 — 통과 문항만 잡 말미 한 트랜잭션, 0건 = 잡 실패(DB 무변경), 미달은 `discarded[]` 정직 표시, **응시는 저장 완료 후에만**.
- [x] **D6. 결정 ⑥ 비용 규약** — **확정(2026-08-02, §4.21)**: prepare(LLM 0) `estimate` + 확인 스텝(F35·F44 관례) · 컨텍스트 200,000자 상한(too_large 관례) · 1회 실행 1~20문항.
- [x] **D7. 결정 ⑦ 품질 게이트** — **확정(2026-08-02, §4.21)**: §4.17 기계 검증 재사용(answer 위반 = **문항 전체 폐기**) + basis doc_no 서버 결정론 검증 + 복제 검출(SourceMatcher 역적용) + 전 문항 객관식 고정. **자기 검증(2차 LLM) 불채택** — 방어선은 사후 검토(R22).
- [x] **D8(문서). 설계 §4.21 신설** — 완료(2026-08-02, Design v1.23): 엔드포인트 5개 계약 + 생성 규약·검증 게이트 + 응시·제출·리포트(F25 재사용 차이 전수) + 격리 규약 + DDL 0건 저장 지점 전수. §5.12 응용 모의고사 블록·§7 examSession 확장·plan §6.2 주석·F45 확정 기록 반영.

## 목표

끝났을 때, 사용자가 분류 범위와 문항 수를 고르고 **예상 사용량을 확인한 뒤** 생성을 실행하면 — 범위 내 기출·개념을 근거로 한 **객관식 응용 문항 N개가 격리 분류에 저장**되고, 그대로 시험 형태(타이머·일괄 제출)로 응시해 **제출 후 리포트에서 문항별 근거 문서를 확인**할 수 있다. 생성 문항은 content 마커로 항상 식별되고, 일반 퀴즈·실전 모의고사·실전 이력에 섞이는 경로 · 응시 응답에 정답이 실리는 경로 · 사용량 안내 없이 LLM이 호출되는 경로가 전부 0이다. 오답은 기존 복습 루프(오답노트·SRS)에 정상 편입된다.

## 작업 체크리스트

> 권장 순서: **1(백엔드 생성) → 2(백엔드 응시·제출) → 3(프론트 생성 위저드) → 4(프론트 응시·리포트) → 5(테스트) → 6(문서·매뉴얼)**. 1↔2는 독립(병렬 가능 — 잡 큐 kind 추가만 공유). 프론트 3·4는 §4.21 계약으로 병렬 착수 가능하나 실기동 연결은 백엔드 완성 대기(아래 의존 지점).

### 1. 백엔드 — 생성 파이프라인 (설계 §4.21 생성 규약 1~5)

- [x] 신설 `backend/services/applied_exam_service.py` — **prepare(LLM 0)**: 범위(하위 포함) 기출·개념 수집 · `source_counts` · `estimate`(`approx_input_tokens`·`assumed` — chars/1.5 보정 관례) · 근거 0건 422 · count 1~20 검증 · 컨텍스트 200,000자 초과 422(too_large 문구 관례 — LLM 호출 전 차단) · gen 상태 인메모리 TTL 1시간
- [x] **격리 분류 관리**: 예약 루트 "AI 응용 모의고사" find-or-create + settings `applied_exam.root_category_id` 포인터(부재·삭제 시 재생성·갱신) · 런 분류 생성(이름 = `{scope_label} — {YYYY-MM-DD HH:MM}`)
- [x] **생성 잡 kind `'applied_exam'`**(공용 잡 큐 확장 — 동시 1개·§4.11 progress 계약): 프롬프트 코드 내 조립(regenerate 전례 — `prompts/convert.md` 불변) — 객관식 4지선다 고정·문항별 `basis` doc_no 필수·기출에 없던 표현 지시·순수 JSON `{"items":[{content,choices,answer,explanation,basis}]}`(위반 = `invalid_output`) — `convert_service.py`에 kind 추가(`_do_applied_exam_job`·`start_applied_exam_job`·`get_applied_exam_job`)
- [x] **검증 게이트**(단위 테스트 대상 — §4.21 생성 규약 3): content·choices(4)·explanation 필수 · answer 1-base 강제(위반 = **문항 전체 폐기** — F44 "answer만 제거" 해석 부적용) · **basis 서버 결정론 검증**(prepare 수집 집합 대조 — 부재·범위 밖 = 폐기) · **복제 검출**(`SourceMatcher` — 근거 텍스트와 커버리지 ≥0.6 일치 = `duplicate_of_source` 폐기) · `discarded[]` 사유 구조화 — `applied_exam_service.validate_items`(순수 함수)
- [x] **저장(잡 말미 한 트랜잭션)**: 통과 문항만 — documents INSERT(**content 서두 마커 서버 부착**(접두 `[AI 생성 문항]`·날짜·엔진 label) · `source_detail="AI 응용 생성 {날짜}"`(**"N번" 패턴 금지** — F44 답지 매칭 키 오염 방지) · **태그 미부여**(규칙 자동 연결 차단)) + category_documents(`linked_by='applied_exam'`·sort_order=생성 순번) + document_relations(`'derived_from'`/`'applied_exam'`). **통과 0건 = 잡 실패·DB 무변경** — `applied_exam_service._save_generated`(별도 apply 승인 엔드포인트 없이 잡 워커 스레드가 직접 `SessionLocal()`로 커밋 — 미리보기 승인이 원리상 불가능한 기능이라는 설계 §4.21 결정 ⑤에 따른 의도적 구조)
- [x] `routers/applied_exam.py`에 3 엔드포인트: `POST /api/applied-exam/prepare` · `POST …/{gen_id}/generate`(202) · `GET …/{gen_id}`(result: run_category_id·requested·generated·discarded·document_ids) + `backend/schemas/applied_exam.py`

### 2. 백엔드 — 응시·제출·이력 (설계 §4.21 응시 절)

- [x] **응시 구성 = 기존 `POST /api/exam/session` 재사용 확인**(신규 세션 API 금지 — 런 분류 1과목·전체 문항. 응답 QuizQuestionOut에 정답·해설·basis 부재 그대로 — 계약 불변) — `exam_service.py`·`schemas/exam.py` 무변경 확인(신규 함수 미추가)
- [x] `POST /api/applied-exam/submit`: **채점 코어 공유**(§4.14 공용 함수 — 채점 규칙 이원화 금지) · `mode='applied_exam'` 기록 · **subject_category_id가 applied 루트 서브트리인지 검증**(아니면 422 — 실전/응용 교차 제출 차단) · attempts+오답노트+SM-2+study_progress **배치 한 트랜잭션**(불변 규칙 2) · 리포트에 `results[].basis[]`(derived_from 파생) 추가 — `applied_exam_service.submit_applied_exam`(`attempt_service.grade_and_record` 공유)
- [x] `GET /api/applied-exam/history?limit=20`: mode='applied_exam' 그룹 파생(exam/history 로직 재사용 — 라벨 = 런 분류 이름). **기존 `exam/history`에 applied 혼입 0** 확인 — 단위 테스트로 검증

### 3. 프론트 — 생성 위저드

- [x] 모의고사 구성 화면(§5.12)에 모드 탭 **[실전(기출)] / [AI 응용]** — AI 응용: 범위 선택(기존 분류 트리 재사용)·문항 수(1~20)·엔진 선택 → [생성 준비](prepare) — `pages/Exam.tsx`(모드 탭) + `components/AppliedExamPanel.tsx`(신설, setup 단계)
- [x] **사용량 확인 스텝(필수 — 확인 없이 생성 불가)**: estimate·source_counts·엔진·과금형(`billing`) 표시(FetchImportWizard 전례) → [생성 시작](generate) → 진행 `LlmJobProgress`·`LlmErrorInfo` 재사용 · 422(범위 과대·근거 0건)는 서버 메시지 렌더 — `AppliedExamPanel.tsx`(confirm·process 단계)
- [x] 생성 결과 요약: generated/requested + **미달 시 경고 배지·폐기 사유 건수**(조용한 축소 금지) → [응시 시작] — `AppliedExamPanel.tsx`(summary 단계)

### 4. 프론트 — 응시·리포트

- [x] [응시 시작] = `exam/session`(런 분류·sequential 기본) → **ExamRun·타이머·네비게이터 재사용**(content 마커 인용구 그대로 렌더 — 숨기지 않음) · zustand `examSession`에 applied 컨텍스트 확장(런 분류 id·플래그 — §7, 신규 스토어 없음) — `stores/examSession.ts`(`applied`·`appliedRunCategoryId` 필드 추가), `AppliedExamPanel.tsx`(exam/session 호출·start()·navigate)
- [x] 제출 분기: applied면 `applied-exam/submit` → 리포트 = F25 재사용 + **문항별 [근거 문서] 링크(basis)** + **[오류 신고](F30 `ReportErrorButton` 재사용)** + "AI 생성 모의고사" 배지 · 틀린 문제 재도전·오답노트 가기 기존 그대로 — `pages/ExamRun.tsx`(doSubmit 분기·ResultRow basis/신고 버튼·배지), `api/appliedExam.ts`(useSubmitAppliedExam)
- [x] AI 응용 탭 하단 응시 이력 소표기(`applied-exam/history` — 실전 이력과 분리 표시). 색상은 전부 토큰(불변 규칙 5) — `AppliedExamPanel.tsx` 하단 섹션, `api/appliedExam.ts`(useAppliedExamHistory)

### 5. 테스트·검증

- [x] **단위 테스트 필수**(불변 규칙 7의 예외 — 격리·게이트는 핵심 로직 취급): ① 검증 게이트(answer 위반 폐기·basis 범위 밖 폐기·복제 검출·통과 0건 = 잡 실패·DB 무변경) ② 마커 부착(접두·날짜·엔진 label) ③ **격리**(생성 문항이 실전 분류 기준 quiz/exam 세션에 미등장 + 태그 0 + source_detail "번" 패턴 부재) ④ submit(applied 루트 밖 422·mode='applied_exam' 기록·exam/history 혼입 0) ⑤ 부분 성공 저장 트랜잭션(통과분만·relations·sort_order) — `backend/tests/test_applied_exam.py`(20건, 전체 pytest 340 passed)
- [x] 스모크(실기동): 비-LLM 경로(prepare 422 계열·상태 404·submit 검증) + **exam/session 응답에 정답·해설 부재 재확인**(기존 회귀 — 계약 불변 증명) + srs/today에 응용 오답 카드 등장(복습 루프 편입) — LLM 생성·응시 완주는 사용자 몫(실비용 — 자동 실행 안 함). **실측 2026-08-02**: uvicorn 기동·openapi 5경로·422/404 전 경로 §3 포맷 준수(오케스트레이터) + exam/session 라이브 응답 무정답·srs 카드 생성→due 도래 시 today 큐 등장(검토자 in-process — due=내일은 SM-2 기본 동작, F25 실전 오답과 동일)
- [x] **생성 문항 정답 품질 표본 검증(R22 — plan §15 "stage-19 착수 시 표본 검증" 이행)**: 생성 문항 10건 표본을 사람이 검토(정답 오류·오개념·복제 여부), 수치를 완료 기록과 plan F45·R22에 남긴다(추측 확정 금지) — **2026-08-02 사용자 확인으로 완료 처리(표본 수치 미기록 — 추후 발견 시 기입)**
- [x] stage-reviewer(Opus) 검토: DoD + 격리 전수(일반 출제·이력·통계 혼입 0) + 응시 응답 계약 + 사용량 안내 없는 LLM 호출 0 + 트랜잭션(규칙 2) — **2026-08-02 통과**(DoD 자동 검증 6/6·치명 0·중요 1(basis 원소 타입 미방어)은 수정 후 표적 재검토로 해소·pytest 344. 경미 6건은 사용자 승인으로 전건 해소·표적 재검토 통과 — 완료 기록 참조)

### 6. 문서

- [x] 계획서 F45에 구현 확정 사항 기록(마커 최종 문구·표본 검증 결과) · 설계 §4.21에 구현 중 보완 반영(어긋나면 착수 중단 후 보고 — DDL은 특히) — plan §14 F45 "구현 확정 기록" 추가(표본 검증 결과는 사용자 이행 후 기입). 설계 이탈 없음 — 미명시 판단 3건(title 합성·scope_label·status `error` 필드)은 검토에서 전건 타당 판정, DDL 0 유지
- [x] 사용자 매뉴얼(F39): AI 응용 모의고사 사용법(비용 확인·격리 분류·마커 의미·근거 링크·오류 신고 경로) 추가 — `docs/manual/user-manual.html` §8 "AI 응용 모의고사" 신설
- [x] 이 문서 체크박스 갱신(불변 규칙 10) · CLAUDE.md 문서 지도 갱신은 오케스트레이터 담당(4.1~4.21·[S19]·stage 19 완료 표기) — 2026-08-02 완료

## DoD (완료 정의)

**자동 검증 가능 항목** (구현·검토에서 증명):

1. **격리**: 생성 문항이 일반 퀴즈 세션·실전 모의고사(F25) 세션·실전 응시 이력(exam/history)·실전 분류 기준 통계에 혼입되는 경로 0 — 분류 격리 + mode 분리(테스트 ③·④).
2. **응시 응답 계약 불변**: exam/session 재사용 응답에 정답·해설·basis 부재(스키마 수준 — 회귀 스모크).
3. **쓰기 격리**: 생성 잡의 DB 쓰기는 격리 분류(예약 루트 서브트리)와 그 연결·관계 행에 한정 + 통과 0건 시 DB 무변경 + content 마커 상시 부착.
4. **실행 전 사용량 안내 없이 LLM이 호출되는 경로 0**(prepare estimate 확인 스텝 필수).
5. **제출 채점 = 배치 전체 한 트랜잭션**(attempts(mode='applied_exam')+오답노트+SM-2+진도 — 불변 규칙 2) + 응용 오답 카드가 srs/today에 등장(복습 루프 편입 실증).
6. **DDL 변경 0건·Alembic 0건**(§4.21 재확인 — 어긋나면 착수 중단 후 보고). 신규 엔드포인트는 5개뿐(prepare·generate·상태·submit·history).

**사용자 이행 항목** (실 LLM 비용 — 자동 실행하지 않음):

7. **라이브 완주 1회**: 범위 지정 → 사용량 확인 → 생성 → 응시 → 제출 → 리포트에서 근거 문서 링크 확인.
8. **생성 문항 정답 품질 표본 검증(R22)**: 표본 10건 사람 검토 — 정답 오류·오개념·복제 발견 수치를 이 문서와 plan F45·R22에 기록.

## 이 단계에서 하지 않는 것

- **사전 미리보기 승인** — 원리상 불가(시험 무의미). 방어선은 사후 검토·격리·마커로 확정(R22) — 재도입 제안은 근거 필요.
- **자기 검증(2차 LLM 패스)** — 결정 ⑦에서 불채택(비용 2배·프롬프트는 약한 레버). 재제안 시 근거 필요.
- **단답·서술형 생성** — 전 문항 객관식 고정(생성 단답의 정규화 채점 취약 — R22 채점 오염 최소화).
- **생성 문항의 본류 승격(격리 해제)·편집 경로** — 실수요 확인 시 계획서에 먼저 확정(v1.x 후보 기록만).
- **런 분류·생성 문항의 자동 정리·만료** — 기존 분류 관리·소프트 삭제 경로 그대로(YAGNI).
- **F25 계약 변경** — exam/session·exam/submit·exam/history 요청·응답 불변(응시 구성 재사용은 호출일 뿐).
- **생성 옵션 확장**(난이도 지정·문항 유형 배합·과목별 배분 등) — 범위·문항 수·엔진만. 필요가 실측되면 계획서에 먼저.
- **여러 런 누적 분석·응용 전용 약점 통계** — 이력 소표기까지만.
- **`answer_source`·생성 이력의 DB 저장** — 응답 전용(§4.17 관례). 이력 필요가 실측되면 §6.2 갱신 + Alembic 세트로 먼저.

## 리스크

- **R22(계획서 §15 — 이 단계의 최상위)**: 생성 문항의 정답 오류는 채점 자체를 오염(해설 R21보다 한 단계 위) + 원문 대조·사전 미리보기 둘 다 원리상 불가 — 대응 = 격리 저장(본류 무오염) + 마커 상시 + 사후 검토 리포트(근거 링크·F30) + 객관식 고정 + **표본 검증 10건**(DoD 8). 틀린 정답으로 오답노트·SRS가 오염될 수 있으나 격리 분류·마커로 식별 가능하고 F30 재생성이 교정 경로.
- **복제 검출의 한계**: SourceMatcher 커버리지는 통째 복제만 잡는다 — 표현만 바꾼 실질 동일 문항은 기계로 못 잡는다(사후 검토 몫 — 과설계 금지, §4.17 ⑥ 원칙 그대로).
- **격리 우회 경로**: 태그 자동 연결·수동 분류 연결로 생성 문항이 실전 트리에 들어갈 수 있다 — 태그 미부여(생성 시)로 자동 경로 차단, 수동 연결은 사용자 의사로 수용(마커가 최후 식별선).

## 완료 기록 (착수 후 기입)

- **경위**: 2026-08-02 하루에 선행 절차(plan-architect — 결정 ①~⑦ 확정·설계 §4.21·이 문서 생성) → 백엔드·프론트 병렬 구현(sonnet) → 통합 확인(pytest·uvicorn 스모크) → Opus 검토 → 중요 1건 수정·표적 재검토 해소.
- **DoD 판정**: 자동 검증 1~6 **전건 충족**(검토자 실측 — 격리·응시 응답 계약·쓰기 격리·사용량 안내·트랜잭션(srs 편입 포함)·DDL 0). 7·8은 사용자 이행 대기.
- **검토 경미 6건 — 전건 해소(2026-08-02 사용자 승인 수정, 표적 재검토 통과)**: ① prepare 범위에서 applied 서브트리 차집합 제외(자기참조 생성 차단 — 전체가 applied면 근거 0건 422 귀결) ② 복제 판정에 정규화 10자 미만 후보 생략 가드(`MIN_CANDIDATE_CHARS` 재사용 — 부작용: 10자 미만 퇴화 지문은 복제 판정 없이 통과, 설계상 계약 위반 아님·사후 검토 몫) ③ `invalid_output` 문구 applied_exam 분기 ④ 통과 0건 실패 메시지에 폐기 사유 요약 합성(§4.11 원문 미노출 준수) ⑤ 프론트 status 타입 `'prepared'` 확장(소비처 무변경) ⑥ dist 재빌드 — 완료 커밋에 포함. 재검토 실측: 기존 prepare 동작·복제 검출 강도·convert/regenerate 문구 전부 무영향. **문언 긴장 1(잔존·수용)**: 실전 탭에서 applied 분류를 명시 선택해 응시하면 mode='exam'으로 실전 이력에 들어가는 옵트인 경로(§4.21이 옵트인 예외로 수용 — F25 계약 불변이라 코드 수정 안 함).
- **사용자 확인 항목**(라이브 완주 DoD 7 · 표본 검증 DoD 8 — 결과 수치): **대기** — 완료 시 여기와 plan F45·R22에 기록.
- **테스트 최종**: pytest **350 passed**(신규 30 = 본 구현 20 + 중요 수정 4 + 경미 수정 6) · `npm run build` 통과(TS 오류 0) · 스모크 전 항목 정상.
