# Stage 20 — 반입 자기 개선 루프: 실패 사례·개선 제안·회귀 재검증 (M20: F46)

> 상위: `study-app.plan.md` **v0.31** §14(M20)·**F46**(배경·수집·채널 3계층·확정 결정의 단일 출처) · 설계: **§4.22 신설 완료(2026-08-02, Design v1.24 — 엔드포인트 계약·수집 규약·정책 잠금·회귀 규약의 정본)**
> 배경(등재 근거 — 2026-08-01 사용자 제안): 반입 실패는 실사용에서 계속 발생한다 — 그때마다 개발 세션을 여는 대신 **프로그램이 실패에서 배우는 회로**를 갖는다. 단 **완전 자동 수정은 배제**(R7 실측: 프롬프트는 약한 레버 + convert.md 과잉 주장 사고: 원인 분석 선행 사례). 형태 = **실패 사례 축적 → LLM 개선 제안 → 제안함 승인 → 회귀 재검증**, 사람이 승인 게이트(R8).
> **상태: 완료(2026-08-02) — 검토 최종 통과(DoD 자동 검증 6/6·치명 0·중요 1(dist 미재빌드) 당일 해소·경미 7건 전건 해소, 표적 재검토 통과) + 사용자 이행 항목(DoD 7·8)도 2026-08-03 사용자 확인으로 종결.** 상세는 이 문서 말미 "완료 기록".
> 순서 관계(plan §14): 착수 순서 자유 — 반입 경로(convert·게이트) 이해가 소양. F44·F45와 파일 충돌 없음(공유 지점은 convert 잡 큐 kind 추가뿐).
> 불변 규칙 재확인: **자동 반영 금지 — 파일 쓰기는 apply 1곳뿐**(R8·R23 ①). **코드 자기 수정 금지 — 자기 개선 상한 = 데이터(사례집)·프롬프트 층**(code_issue = 재현 패키지 인계). 스키마 변경 금지(6 — **DDL 0건·DB 쓰기 0 확정**, §4.22 말미) · `sources/` 불변(4 — 읽기만) · 색상 토큰만(5) · 에러 규약 §3 · 실행 전 사용량 안내 없는 LLM 호출 금지(F35 — 수집은 비용 0이라 자동, 개선·회귀는 수동 + estimate 확인 스텝).

## 현행 실측 (2026-08-02 — 상세 앵커는 설계 §4.22 말미·§4.20 앵커 절이 정본, 여기는 요지)

- **실패는 이미 구조화돼 있다**: `unsupported_format`·`parse_failed`·`too_large`(F42 판별·추출) · `invalid_output`·`fabrication_suspect`(F41 신뢰 게이트 §4.17) · 변환 산출 보존(F40-① `import/auto/` 50건) · F30 신고·재생성(§4.10). 원본은 `sources/` 불변이라 전 사례 재현 가능 — 빠진 것은 실패를 개선으로 바꾸는 회로뿐.
- **재사용 자산**: 잡 큐 = convert·regenerate·answer_key·applied_exam 공용(kind 2종 추가로 확장) · 사용량 안내 = `fetch_service.estimate_usage` 필드 관례 + FetchImportWizard 확인 스텝(chars/1.5 보정) · 원본 추출 = `source_match.extract_source_text`·`doc_extract` · 파일 보존·프루닝 = `import/auto/` 50건 관례(R18) · 제안함 UI = `pages/Suggestions.tsx`·`SuggestionsNavBadge`.
- **suggestions 테이블은 건드리지 않는다**(결정 ① — document_id·category_id NOT NULL 전용 구조. 기존 태그 제안 플로우 §4.9 계약 불변).

## 착수 시 선행 절차 (완료 — 결정·문서를 먼저 굳혔다)

- [x] **D1. 결정 ① suggestions 확장 방식** — **확정(2026-08-02, §4.22)**: 테이블 재사용 기각 — **파일 기반 별도 저장(`improve/proposals/`) + 제안함 "화면" 일반화**(2탭 + nav 배지 합산). 근거 = 타입 확장은 곧 DDL, F21 확장의 의미는 UI 계층.
- [x] **D2. 결정 ② 보존 형식·상한** — **확정(2026-08-02, §4.22)**: `improve/` JSON 레코드, cases·proposals 각 **최근 50건**(R18 상수 관례), git·백업(F27) 제외, (kind, hash12) 중복은 count 갱신. 수집 지점 3곳·제외 kind 명시.
- [x] **D3. 결정 ③ 사례집 경계** — **확정(2026-08-02, §4.22)**: `prompts/convert.cases.md` 신설 — few-shot 처리 예시만, 정책 문장은 본문 전용 + **본문 우선 조항 1줄**.
- [x] **D4. 결정 ④ 트리거** — **확정(2026-08-02, §4.22)**: 수동 버튼만(자동 임계치 기각 — F35 충돌·R23 ② 과적합). **수집 자동·개선 수동.**
- [x] **D5. 결정 ⑤ 회귀 범위·시점** — **확정(2026-08-02, §4.22)**: 수동 + 선택 사례 1~10건 + estimate 확인 스텝. **preview·DB 무기록 검증 전용**(반입 경로 절연).
- [x] **D6. 결정 ⑥ F30 연결** — **확정(2026-08-02, §4.22)**: 신고 시점 자동 사례 수집(origin='report' — LLM 0·비용 0·F30 계약 불변·best-effort).
- [x] **D7. 결정 ⑦ 반영 안전장치** — **확정(2026-08-02, §4.22)**: convert.md **정책 잠금 마커 구간** + 서버 결정론 검증(위반 422) · 수정 계약 = **치환 헝크**(diff 파서 불도입) · 사례집 20,000자 상한.
- [x] **D8(문서). 설계 §4.22 신설** — 완료(2026-08-02, Design v1.24): 엔드포인트 13개 계약 + 수집·생성·승인·회귀 규약 + 안전장치 전수 + DDL 0건(DB 쓰기 0) 저장 지점 전수. plan §14 F46·R23·로드맵 갱신 반영.

## 목표

끝났을 때, 반입 실패(잡 실패·게이트 탈락·F30 신고)가 **자동으로 실패 사례 레코드에 쌓이고**, 사용자가 사례를 골라 **예상 사용량을 확인한 뒤** 개선 제안을 생성하면 — 사례집 추가 / 프롬프트 수정 / 코드 수정 필요(재현 패키지) 제안이 **제안함 카드**로 나타나고, **승인해야만** 파일에 반영되며, 반영 후 과거 실패 사례를 **회귀 재변환으로 재검증**해 결과가 사례 레코드에 수치로 남는다. 자동 반영 경로·정책 문장이 수정되는 경로·사용량 안내 없이 LLM이 호출되는 경로·앱이 자기 코드를 수정하는 경로가 전부 0이고, DB에는 아무것도 쓰지 않는다.

## 작업 체크리스트

> 권장 순서: **1(수집·저장소) → 2(제안 생성) → 3(승인·반영) → 4(회귀) → 5(프론트) → 6(테스트) → 7(문서)**. 1은 독립 선행 가능(다른 절의 전제). 2·3·4는 계약(§4.22)으로 병렬 가능하나 3의 정책 잠금 검증이 2의 prompt_edit 사전 시뮬레이션과 같은 함수여야 한다(이원화 금지). 프론트 5는 계약으로 병렬 착수 가능, 실기동 연결은 백엔드 완성 대기.

### 1. 백엔드 — 실패 사례 수집·저장소 (설계 §4.22 ①)

- [x] 신설 `backend/services/improve_service.py` — **사례 저장소**: `improve/cases/` JSON 레코드 읽기/쓰기(`fc_`+hex6 · 레코드 필드 = §4.22 형식 그대로) · **중복 병합**((kind, source.hash12) — report는 (kind, document_id) — 기존 레코드면 count+1·last_seen_at 갱신) · **프루닝 50건**(오래된 것부터 — 부속 `.output.txt` 동반 삭제) · `improve/` 폴더 git 제외(.gitignore) — 백업(F27) 대상에 넣지 않음 확인
- [x] **수집 훅 3지점**(전부 best-effort — 수집 실패가 원 플로우를 실패시키지 않는다, 로그만): ① convert·fetch 잡 실패 시 `error_info.kind ∈ {parse_failed, unsupported_format, invalid_output}`만 수집(**제외**: too_large·rate_limit·미설치·타임아웃 등 환경·정책 실패) — invalid_output이면 LLM 산출물 원문을 `{case_id}.output.txt`로 저장(**로그 전용 — API 미노출**) ② preview 생성 시 `fabrication_suspect` 항목 ≥1이면 **잡 단위 1건**(origin='gate' — 항목 인덱스·건수를 detail에, `preview_ref`=import/auto 파일명) ③ `start_regenerate_job`(F30)에 origin='report' 레코드(reason·문서 참조·source_detail 스냅샷 — **F30 요청·응답·플로우 무변경**)
- [x] `routers/improve.py`에 cases 3 엔드포인트: `GET /api/improve/cases`(§3 페이지 봉투·kind 필터·`has_llm_output` bool — 원문 미포함) · `GET /api/improve/cases/{case_id}` · `DELETE /api/improve/cases/{case_id}`(부속 output 동반 삭제) + `backend/schemas/improve.py`

  **구현 메모(백엔드, 2026-08-02)**: 프론트(§5, 이미 구현됨)가 목록·상세에 같은 타입(`ImproveCaseItem`)을 쓰는 것을 확인해, cases 목록도 `detail`·`preview_ref`·`regressions`를 상세와 동일하게 전부 채워 돌려주도록 맞춤(설계 문서 표기 "레코드 요약"보다 프론트 실계약을 우선 — `ImproveCaseList.tsx`가 목록 항목에서 바로 `c.regressions.length`를 참조).

### 2. 백엔드 — 제안 생성 파이프라인 (설계 §4.22 ②)

- [x] **gen prepare(LLM 0)**: `case_ids` 1~20건·실재 검증(부재 422) · 입력 조립(사례 레코드 + 원본 추출 텍스트 발췌(`extract_source_text` 재사용) + output 원문(있으면) + 현행 convert.md·convert.cases.md 전문) · 합계 200,000자 초과 422(too_large 문구 관례 — LLM 호출 전 차단) · `estimate`(`approx_input_tokens`·`assumed` — chars/1.5 보정) · gen 상태 인메모리 TTL 1시간
- [x] **생성 잡 kind `'improve_proposal'`**(공용 잡 큐 확장 — 동시 1개·§4.11 progress 계약): 프롬프트 코드 내 조립(regenerate 전례 — `prompts/convert.md` 불변·잠금 구간 수정 금지·정책 완화 금지 지시 포함) · 순수 JSON `{"proposals":[{kind,title,rationale,case_ids,payload}]}`(위반 = `invalid_output`)
- [x] **제안 검증 게이트**(단위 테스트 대상 — 순수 함수로): kind 화이트리스트(`casebook|prompt_edit|code_issue`) 외 폐기 · `case_ids` ⊆ 요청 집합(부재 = 폐기 — 서버 결정론, F44 ② 관례) · **prompt_edit 즉시 적용 시뮬레이션**(before 0회/2회+ = `hunk_unappliable` 폐기 · **잠금 구간 접촉 = `policy_locked` 폐기**) · 빈 payload 폐기 · **통과 0건 = 잡 실패**(error_info — 파일 무변경) · `discarded[]` 사유 구조화
- [x] **제안 저장**: 통과분을 `improve/proposals/{pr_hex6}.json`(status='pending')으로 저장(**저장 = 카드 등록이지 반영 아님**) · 프루닝 50건(**결정 완료(applied/rejected/acknowledged) 먼저, pending 최후**)
- [x] gen 3 엔드포인트: `POST /api/improve/gen/prepare` · `POST …/{gen_id}/generate`(202) · `GET …/{gen_id}`(result: proposal_ids·discarded)

### 3. 백엔드 — 제안함 승인·반영 (설계 §4.22 ③ — **유일한 파일 쓰기**)

- [x] proposals 4 엔드포인트: `GET /api/improve/proposals?status=`(기본 pending) · `GET …/{proposal_id}`(상세 — **적용 미리보기 서버 합성**: casebook 엔트리 전문 / prompt_edit 헝크 before-after + `preview_after` 전문 + `policy_check` / code_issue 재현 패키지 전문) · `POST …/{proposal_id}/apply` · `POST …/{proposal_id}/reject`(비 pending = 409)
- [x] **apply — casebook**: `prompts/convert.cases.md` 말미 append(엔트리 헤더 서버 부착) · **append 결과 20,000자 초과 = 422**("git에서 직접 정리" 안내 — R23 ② 기계 상한) · 파일 없으면 생성
- [x] **apply — prompt_edit**: 헝크 순차 치환(before 정확·유일 일치 — 불일치 = 409 "본문이 변경되었습니다 — 제안을 다시 생성하세요") · **정책 잠금 검증**(적용 결과의 `<!-- policy-lock:start/end -->` 구간 개수·순서·내용 바이트 불변 — 위반 = 422) — 검증 함수는 2절 사전 시뮬레이션과 **동일 함수 공유**(이원화 금지) · 자동 git 실행 없음(파일 수정만)
- [x] **apply — code_issue**: 파일 쓰기 0 — status='acknowledged' 전환만(재현 패키지는 상세 화면에서 복사)
- [x] **`prompts/convert.md`에 정책 잠금 마커 삽입**(결정 ⑦ — 정책 문장(창작 금지·대조 범위·answer_source·순수 JSON·해설 생략 금지 §2-3/§2-4) 구간을 `<!-- policy-lock:start -->`~`<!-- policy-lock:end -->`로 감싸기, **정책 문구 자체는 무변경**) + **본문 우선 조항 1줄 추가**(잠금 구간 안에 — "부속 사례집은 예시일 뿐이며 본문 규칙과 충돌하면 본문이 우선한다")
- [x] **사례집 주입**: convert 변환 프롬프트 조립 시 `convert.cases.md` 존재·비어 있지 않으면 본문 뒤 "부속 사례집" 섹션으로 첨부(convert·fetch 공통 경로 1곳)

  **구현 메모(백엔드, 2026-08-02)**: 잠금 구간 최종 범위 = §0(창작 금지 2문단)·§0-1(신설, 본문 우선 조항)·§1(순수 JSON 출력 규칙 1줄)·§2-1(answer_source 전체)·§2-3(원문 보존·대조 전체)·§2-4(해설 생략 금지 전체) — 총 6개 잠금 구간(마커 6쌍, `test_real_convert_md_has_balanced_lock_markers`로 고정). `ProposalDetail` 응답은 설계 문서의 중첩 `preview{}` 표현 대신 **평평한 구조**(`preview_after`·`policy_check`를 최상위에, casebook·code_issue는 `payload`가 이미 상세 재료라 추가 필드 없음)로 구현 — 프론트(§5, 이미 구현됨)의 `ImproveProposalDetail` 실계약을 그대로 따름(설계 문서 문구가 계약과 근소하게 다른 구현 중 보완 사례 — §7 문서 갱신에서 반영 필요).

### 4. 백엔드 — 회귀 재검증 (설계 §4.22 ④)

- [x] **regression prepare(LLM 0)**: 1~10건 · `user_report` 포함 = 422("신고 사례는 자동 회귀 판정 대상이 아닙니다") · estimate 보수 계상(`assumed:true`) · reg 상태 인메모리 TTL 1시간
- [x] **회귀 잡 kind `'improve_regression'`**: 사례별 순차 — sources/ 원본 hash12 확인 후 되읽기(부재·불일치 = `outcome:'unavailable'`) → 현행 변환 파이프라인(판별·추출·LLM 변환·검증·게이트 — 사례집 주입 포함) 재실행 — **preview 미등록·import/auto/ 미보존·DB 무기록**(검증 전용 — 반입 대기열 오염 0)
- [x] **판정·기록**: outcome = `passed | still_failing | failed_differently | unavailable`(gate 사례 = 재변환 산출의 fabrication_suspect 재발 여부로 판정) · reg 상태 응답 `results[]` + **각 사례 레코드 `regressions[]` append**(reg_id·run_at·outcome)
- [x] regression 3 엔드포인트: `POST /api/improve/regression/prepare` · `POST …/{reg_id}/run`(202) · `GET …/{reg_id}`

  **구현 메모(백엔드, 2026-08-02)**: `results[].detail`은 설계 문서상 형식 미지정이었으나 프론트(§5)가 `string`으로 렌더(JSX에 직접 삽입)하는 계약이라 **한국어 문자열**로 구현(구조화 dict 아님). 엔진 실패 시 자동 폴백 루프는 미적용(검증 전용 — 사례별 결과를 즉시 기록해야 해 "잡 전체 재시도" 모델과 불일치, 단일 시도로 충분하다고 판단).

### 5. 프론트 — 제안함 일반화·개선 탭 (설계 §4.22 ③ UI)

- [x] `pages/Suggestions.tsx`에 수신함 2탭: **[분류 연결]**(기존 — 무변경) / **[반입 개선]**(신규 — `components/ImproveInbox.tsx` 등 신설) · `SuggestionsNavBadge` = 두 pending 합산(`GET /api/improve/proposals?status=pending` 병합)
- [x] **실패 사례 목록**: kind 배지·origin·count·최근 발생·[제거] — 사례 선택(체크박스) → [개선 제안 생성](prepare 호출)
- [x] **사용량 확인 스텝(필수 — 확인 없이 생성 불가)**: estimate·사례 수·엔진·과금형(`billing`) 표시(FetchImportWizard 전례) → [생성 시작](generate) → 진행 `LlmJobProgress`·`LlmErrorInfo` 재사용 · 생성 결과 요약(proposal 수 + **discarded 사유 건수 — 조용한 축소 금지**)
- [x] **제안 카드·상세**: kind 배지(사례집 추가/프롬프트 수정/코드 수정 필요) + title·rationale·근거 사례 링크 · 상세 = 적용 미리보기(casebook 전문 / prompt_edit before-after 비교 + 적용 후 전문 + policy_check 위반 표시 / code_issue 재현 패키지 + [복사]) · [승인 반영]/[거절](code_issue는 [인계 완료]) · 409·422는 서버 message 렌더
- [x] **회귀 패널**: 반영된(applied) 제안에서 [회귀 재검증] → 사례 선택(기본 = 근거 사례 + 같은 kind) → **estimate 확인 스텝** → 실행 → `results[]` outcome 표시 + 사례 레코드의 regressions 이력 소표기. 색상은 전부 토큰(불변 규칙 5)

  **구현 메모(프론트, 2026-08-02)**: `pages/Suggestions.tsx`는 로컬 `useState<'classify'|'improve'>` 탭 전환만 추가(기존 [분류 연결] JSX·로직 무변경, 조건부 렌더로 감쌈). `components/ImproveInbox.tsx`(신설, 앵커 그대로) 하위에 `components/improve/`(신설 폴더 — 기존 `home`·`markdown`·`print`·`settings` 서브폴더 관례 재사용) — `ImproveCaseList`(사례 목록+선택+삭제)·`ImproveGenWizard`(prepare→confirm→generate→progress→result, AnswerKeyImportWizard/FetchImportWizard 전례)·`ImproveProposalList`+`ImproveProposalDetailModal`(카드+상세 모달)·`ImproveRegressionPanel`+`ImproveRegressionWizard`(applied 제안 목록+회귀 위저드)·`ImproveCaseDetailModal`(근거 사례 링크 클릭 시)·`labels.ts`(kind/origin/outcome 한국어 라벨+배지 클래스, 색상은 전부 토큰 클래스). API 훅은 `api/improve.ts` 신설(gen_id·reg_id를 상태 폴링 키로 사용 — `api/answerKey.ts`의 key_id 관례와 동일, job_id는 시작 응답에만). 타입은 `api/types.ts` 말미에 `Improve*` 블록 추가.

  **프론트 판단(계약에 명시 없어 합리적으로 결정 — 최종 보고 참고)**: ① 사례 목록은 결정 ②의 "최근 50건 상한"을 근거로 `page=1&size=50` 고정 1회 조회로 전체를 가져오고 별도 페이지네이션 UI를 두지 않음(레코드 총량이 애초에 50 이하이므로 무해). ② "근거 사례 링크"는 별도 사례 상세 라우트가 없어 클릭 시 사례 상세를 모달로 여는 방식으로 구현(`ImproveCaseDetailModal` — `GET /api/improve/cases/{case_id}` 사용). ③ 회귀 사례 선택 UI에서 `user_report`(신고) kind 사례는 선택 가능 목록에서 원천 제외(계약 "UI에서도 선택 차단이 친절" 반영). ④ `ImproveGenJobResponse`·`ImproveRegressionJobResponse`는 계약에 `error`(레거시 문자열) 필드가 없어 `LlmErrorInfoView`에 `legacyError`를 넘기지 않음(error_info만 사용).

### 6. 테스트·검증

- [x] **단위 테스트 필수**(불변 규칙 7의 예외 — 잠금·게이트·수집은 핵심 로직 취급): ① **정책 잠금**(잠금 구간 접촉 헝크 폐기·apply 422·마커 소실/개수 변경 검출·잠금 밖 수정은 통과) ② **헝크 적용**(정확 1회 일치 적용·0회/2회+ 거부) ③ **제안 검증 게이트**(kind 화이트리스트·case_ids 범위 밖 폐기·통과 0건 = 잡 실패·파일 무변경) ④ **수집**(대상 kind만 수집 — too_large·rate_limit 미수집 · 중복 count 병합 · 프루닝 50건·pending 최후) ⑤ **사례집**(append·20,000자 상한 422·주입 조립) ⑥ **회귀 무흔적**(preview 미등록·DB 무변경·regressions append) — `backend/tests/test_improve.py`(41건 신규, 전체 391건 통과. 기존 `test_convert_trust_gate.py`·`test_import_preserve_recover.py`의 `isolated_dirs` 픽스처에 `improve_service.CASES_DIR`·`PROPOSALS_DIR` 격리를 추가해 신규 게이트 수집 훅이 그 테스트들의 실제 `improve/` 디렉터리를 오염시키지 않게 함 — 회귀 무영향 유지)
- [x] 스모크(실기동): 비-LLM 경로 전수(cases CRUD·prepare 422 계열·apply/reject 409·정책 잠금 422) §3 에러 포맷 준수 + **기존 태그 제안 플로우(§4.9) 회귀 무영향 확인**(suggestions 테이블·API 무변경 증명) + F30 신고 시 사례 레코드 생성·신고 응답 불변 — LLM 생성·회귀 완주는 사용자 몫(실비용 — 자동 실행 안 함). **실측 2026-08-02**: 오케스트레이터 기동 스모크(openapi 13오퍼레이션·422/404 §3 봉투) + 검토자 라이브 검증(404/409/422 전수·잠금 밖 1줄 diff 정상 반영·suggestions 200·F30 훅 origin=report 생성·회귀 무흔적 — 스텁 LLM, 실 LLM 완주만 사용자 몫 잔여)
- [x] **제안 품질 표본 점검(R23 — 추측 확정 금지)**: 생성 제안 5건 표본을 사람이 검토(정책 완화 시도·마지막 실패 과적합 징후·사례집 엔트리 품질) — 수치를 완료 기록과 plan R23에 기록 — **2026-08-03 사용자 확인으로 완료 처리(표본 수치 미기록 — 추후 발견 시 기입)**
- [x] stage-reviewer(Opus) 검토: DoD + 자동 반영 경로 0 + 코드 자기 수정 경로 0(쓰기 경로 전수 = improve/·prompts/ 한정) + 사용량 안내 없는 LLM 호출 0 + DB 쓰기 0 + 수집 best-effort(원 플로우 무영향) — **2026-08-02 조건부 통과 → 경미 전건 해소로 최종 통과**(DoD 자동 검증 6/6·치명 0·중요 1(dist 미재빌드)은 당일 재빌드로 해소·경미 7건(②~⑧)은 사용자 승인 수정 후 표적 재검토 통과 — 완료 기록 참조)

### 7. 문서

- [x] 계획서 F46에 구현 확정 사항 기록(잠금 구간 최종 범위·표본 점검 결과) · 설계 §4.22에 구현 중 보완 반영(어긋나면 착수 중단 후 보고 — DDL·DB 쓰기는 특히) · 설계 screens(§5.11 또는 제안함 절)에 [반입 개선] 탭 블록 반영 — **2026-08-02 완료(plan-architect)**: plan F46 "구현 확정 기록" 불릿(잠금 6구간·정합 4건·pytest 391 — 표본 점검 결과는 사용자 이행 후 기입) · §4.22 응답 형태 4곳 구현 확정 병기(proposals 평면 배열·상세 평면 필드·cases 전체 필드·regression detail 문자열 — DDL·DB 쓰기 0 불변) · screens **§5.13 제안함 절 신설**(2탭·improve 컴포넌트 실명·화면 수 13개 표기 정합)
- [x] 사용자 매뉴얼(F39): 반입 개선 루프 사용법(실패 사례가 쌓이는 곳·제안 생성 비용 확인·승인/거절·정책 잠금 의미·회귀 재검증·코드 수정 필요 제안의 인계 방법) 추가 — `docs/manual/user-manual.html`에 신규 §21 "반입 개선 루프" 절 삽입(FAQ와 부록 사이, 기존 §1~20 번호·앵커·본문 전부 무변경 — 목차 `<li>` 1건 추가만). ①~⑥ 전 항목 반영, 기존 콜아웃(`note`/`warn`/`tip`)·`ol.steps`·표 관례 그대로 사용
- [x] 이 문서 체크박스 갱신(불변 규칙 10) · CLAUDE.md 문서 지도 갱신(4.1~4.22·[S20]·stage 20 표기)은 오케스트레이터 담당 — **2026-08-02 완료**(문서 지도 4.1~4.22·[S20]·화면 13개·stage 20 상태 반영)

## DoD (완료 정의)

**자동 검증 가능 항목** (구현·검토에서 증명):

1. **자동 반영 경로 0**: 이 기능의 파일 쓰기는 `POST /api/improve/proposals/{id}/apply` 1곳뿐 — 수집·생성·저장·회귀 어디서도 convert.md·사례집이 변경되지 않는다.
2. **정책 잠금**: 잠금 구간을 건드리는 prompt_edit은 생성 게이트에서 폐기되고 apply에서도 422로 거부된다(이중 방어 — 같은 검증 함수). 잠금 밖 수정은 정상 반영.
3. **코드 자기 수정 경로 0**: improve 계열의 쓰기 경로 전수 = `improve/`·`prompts/`(backend/·frontend/·sources/·study.db 쓰기 0). code_issue는 상태 전환뿐.
4. **실행 전 사용량 안내 없이 LLM이 호출되는 경로 0**(gen·regression 모두 prepare estimate 확인 스텝 필수).
5. **DB 쓰기 0·DDL 0건·Alembic 0건**(§4.22 재확인 — 어긋나면 착수 중단 후 보고) + 기존 suggestions(§4.9) 계약·동작 무영향(회귀 확인). 신규 엔드포인트는 13개뿐.
6. **수집 3지점 실동작 + best-effort**(수집 실패가 잡·preview·신고를 실패시키지 않음) + 중복 count 병합 + 50건 프루닝 + 회귀 실행이 preview·DB·import/auto/에 흔적 0.

**사용자 이행 항목** (실 LLM 비용 — 자동 실행하지 않음):

7. **라이브 루프 완주 1회**: 실제 반입 실패 사례 → 사용량 확인 → 제안 생성 → 카드 검토·승인 반영 → 회귀 재검증에서 outcome 확인.
8. **제안 품질 표본 점검(R23)**: 생성 제안 5건 사람 검토 — 정책 완화 시도·과적합 징후 발견 수치를 이 문서와 plan R23에 기록.

## 이 단계에서 하지 않는 것

- **완전 자동 수정·자동 반영** — 배제 확정(2026-08-01 논의·R23 ①). 승인 게이트 생략·임계치 자동 생성·apply 후 자동 회귀 전부 금지 — 재제안 시 근거 필요.
- **코드 자기 수정** — 자기 개선 상한 = 데이터(사례집)·프롬프트 층. 재현 패키지 인계까지가 앱의 역할(자동 이슈 등록·외부 전송도 없음).
- **F44 답지·explain, F45 applied_exam 잡 실패의 수집** — F46 범위는 반입 경로(convert·fetch 잡 + 반입 게이트 + F30) 우선(plan §14 F46 순서 관계). 확장은 계획서에 먼저 확정.
- **suggestions 테이블 확장(DDL)** — 결정 ①에서 기각(기존 테이블·API 무변경). 재제안 시 근거 필요.
- **unified diff 파서 도입** — 치환 헝크(before 정확·유일 일치) 계약으로 대체(결정 ⑦).
- **사례집 앱 내 편집·삭제 UI** — append만. 정리는 git에서 직접 편집(20,000자 상한이 정리 시점을 강제).
- **정책 문장 자체의 변경** — 어느 채널로도 불가(잠금). 정책 개정은 개발 세션에서 계획서 먼저.
- **전체 사례 일괄 회귀** — 선택 사례 1~10건만(결정 ⑤).
- **실패 사례·제안의 DB 테이블화** — 파일 기반 확정(R18 논리). 이력·검색 필요가 실측되면 §6.2 갱신 + Alembic 세트로 먼저.
- **`user_report` 사례의 자동 회귀 판정** — 신고는 사람 판단 영역(F30 재생성 경로가 담당).

## 리스크

- **R23(계획서 §15 — 이 단계의 최상위)**: ① 조용한 프롬프트 드리프트 — 대응 = 정책 잠금(서버 결정론 검증) + 승인 게이트 + 본문 우선 조항 ② 땜질 규칙 과적합 누적 — 대응 = 기본 채널 사례집 분리 + 20,000자 상한 + 회귀 수치화 + **제안 품질 표본 점검(DoD 8)** ③ 회귀 비용 — 대응 = 수동·선택 사례·estimate 확인.
- **사례집 주입의 변환 품질 영향**: 사례집이 커질수록 convert 입력 토큰이 늘고, 잘못된 예시는 전 변환에 파급된다 — 상한·승인 게이트·git 롤백이 방어. 실측 이상 징후는 사례집 비우기(git)로 즉시 복구 가능.
- **잠금 마커 자체의 취약성**: 사용자가 convert.md를 수동 편집하며 마커를 깨뜨리면 잠금 검증이 오작동할 수 있다 — apply 시 마커 쌍 개수·순서 검사로 검출(불일치 = 422·수동 복구 안내). 마커 4줄이 LLM 변환 입력에 노출되는 것은 무해(지시 없음).
- **수집 노이즈**: 같은 원본 반복 실패로 50건 창이 소모될 수 있다 — 중복 count 병합 + DELETE(수동 정리)가 방어.

## 완료 기록 (착수 후 기입)

- **경위**: 2026-08-02 하루에 완주 — 선행 절차 D1~D8(plan-architect, 결정 ①~⑦ 전건 확정·§4.22 신설) → 백엔드(sonnet, 1~4절+테스트 41건)·프론트(sonnet, 5절) 병렬 구현 → 오케스트레이터 기동 스모크 → 문서 정합(§4.22 구현 확정 4건 병기·screens §5.13 신설·매뉴얼 §21) → Opus 검토 조건부 통과 → 중요 ①(dist 미재빌드) 당일 해소.
- **DoD 판정**: 자동 검증 1~6 **전건 충족**(검토 실증 — 자동 반영 경로 0·정책 잠금 이중 방어 동일 함수·코드 자기 수정 0·estimate 확인 스텝 필수·DB 쓰기 0(단 공용 엔진 한도 기억 경로는 예외 — 경미 ⑧ 문서 병기 권고)·수집 3지점 best-effort). 중요 ①(배포 dist에 stage-20 부재)은 재빌드·커밋으로 해소.
- **검토 경미 7건(②~⑧) — 전건 해소(2026-08-02 사용자 승인 수정·표적 재검토 통과)**: ② types.ts `ImproveJobStatus = ConvertJobStatus | 'prepared'` ③ improve 잡 `invalid_output`·전량 폐기 안내 분기(타 job_kind 문구 불변 실측) ④ 폐기 사유·회귀 outcome 한국어 라벨(`DISCARD_REASON_LABEL` — 백엔드와 코드 일치·미지 폴백) ⑤ 사례 선택 20건 캡(차단·disabled·카운터) ⑥ 회귀 원문 대조 불가(정규화 <200자) = `unavailable` 판정 가드(정상 경로 불변 실측) ⑦ hash12 부재 시 preview_ref 병합 키(분리·병합·최후 폴백 7시나리오 실측) ⑧ §4.22 말미 DB 쓰기 예외(공용 `remember_limit`) 병기. 표적 재검토가 함께 지적한 dist stale·완료 기록 구본은 마무리 커밋에서 해소.
- **사용자 확인 항목**(라이브 루프 완주 DoD 7 · 제안 품질 표본 DoD 8 — 결과 수치): **2026-08-03 사용자 확인으로 완료 처리**(표본 수치·완주 결과 미기록 — 실사용 중 발견 사항이 생기면 여기와 plan F46·R23에 기입).
- **테스트 최종**: pytest **399 passed**(test_improve.py 49건 = 최초 41 + 경미 수정분 8 — 검토자 재실행 확인) · 프론트 `npm run build` 타입 에러 0 · dist는 경미 수정 반영 재빌드로 최종 커밋.
