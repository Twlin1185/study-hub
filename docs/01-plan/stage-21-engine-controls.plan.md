# Stage 21 — 엔진 운용 제어: 활성 토글·모델 선택·선택 UI 게이팅 (M21: F47)

> 상위: `study-app.plan.md` **v0.32** §14(M21)·**F47**(배경·ⓐⓑⓒ·확정 결정의 단일 출처) · 설계: **§4.23 신설 완료(2026-08-03, Design v1.25 — 후보 자격 개정·모델 계약·게이팅·422 방어의 정본)**
> 배경(등재 근거 — 2026-08-03 사용자 제안·승인): 현행 레지스트리(F41, §4.17)는 `available()`과 priority만 안다 — **"쓸 수 있지만 쓰고 싶지 않은" 엔진(예: 종량 과금 claude-api)을 배제할 수단이 없고**, CLI 엔진의 모델 선택 수단이 없으며, 비가용 엔진이 선택 UI에 눌리는 채로 노출된다. F47 = 활성(쓸지)·모델(무엇으로)·게이팅(어디서 고를 수 있는지)의 운용 계층.
> **상태: 착수 전 결정 ①~⑥ 전건 확정(2026-08-03) — 착수 가능.**
> 순서 관계(plan §14): F41 레지스트리 완성 전제(이행 완료) — F44~F46의 engine 파라미터 지점이 전부 구현돼 있어 422 방어 8곳을 한 번에 덮는 지금이 적기. 파일 충돌 없음.
> 불변 규칙 재확인: 스키마 변경 금지(6 — **DDL 0건·신규 엔드포인트 0개 확정**, §4.23 말미) · 채점·정답 무관(1·2 — 이 단계는 응답 계약에 정답·해설을 건드리지 않는다) · 색상 토큰만(5) · 에러 규약 §3(422는 서버 완성 문장) · 오류 원문 노출 금지(§4.11) · **이 단계의 계층은 전부 LLM 호출 0**(설정·상태·시작 전 검증 — F35 사용량 안내 규약과 충돌 지점 없음).

## 현행 실측 (2026-08-03 — 상세는 설계 §4.23·§4.17이 정본, 여기는 요지)

- **후보 자격 = `available()`뿐**: auto 해석·폴백 다음 후보(§4.17 ③)가 설치·로그인·키만 보고 산출된다 — 사용자 의사(끄기) 축이 없다. 헬스·진단 캐시(TTL 60초)·한도 기억은 엔진 id 키(§4.17 ①) — 이 단계에서 불변.
- **모델 선택은 `llm.api_model`(API 엔진 한정 settings)뿐**: claude-cli·codex-cli는 사용자 CLI 구성 기본값으로만 돈다. `invoke()`가 엔진 공통 경로(§4.17 ①)라 모델 적용 지점은 1곳으로 수렴 가능.
- **engine 파라미터 수용 잡 시작 엔드포인트 = 8곳**(§4.23 ⓒ 전수): convert · regenerate · fetch/import · answer-key process · explain · applied-exam generate · improve gen generate · improve regression run. 현재 명시 지정 엔진이 비가용이면 잡 실행 중 error_info로 드러난다(시작 전 검증 없음).
- **재사용 자산**: S15 카드 목록 렌더·▲▼ 우선순위·[다시 확인] 재진단(F34 패턴 — `LlmEngineSection`) · settings GET/PUT(키-값 자유 — `llm.priority` 배열 전례) · legacy 별칭 읽기 매핑(§4.17 ①).

## 착수 시 선행 절차 (완료 — 결정·문서를 먼저 굳혔다)

- [x] **D1. 결정 ① 활성 토글 저장 형태** — **확정(2026-08-03, §4.23)**: settings `llm.disabled`(비활성 엔진 id 배열 — **부정 목록**). 근거 = 신규 엔진 기본 활성 전방 호환·`llm.priority` 배열 관례(긍정 목록·엔진별 boolean 키 기각).
- [x] **D2. 결정 ② 후보 자격 개정** — **확정(2026-08-03, §4.23 ⓐ)**: "`available()` && enabled" 일관 개정 — auto 해석·폴백 다음 후보·`fallback_available` 전수, **후보 함수 1곳**(호출처별 분기 금지). 신규 오류 kind 0 — 후보 0은 기존 경로.
- [x] **D3. 결정 ③ 모델 선택 계약** — **확정(2026-08-03, §4.23 ⓑ)**: 레지스트리 수준 확장(`models` 소목록 하드코딩 + `default_model`) + settings `llm.models` + `invoke()` 공통 적용. **자유 텍스트 입력 기각 확정**. legacy `llm.api_model` 읽기 별칭.
- [x] **D4. 결정 ④ 모델 소목록 구체 값** — **구현 실측 이월 확정(계약 문장 = §4.23 결정 ④)**: 엔진당 2~4개·**무설정 시 동작 불변**(CLI형 기본 = null 미전달, claude-api = `llm.api_model` 승계) — 실측 결과를 완료 기록·§4.23에 기입.
- [x] **D5. 결정 ⑤ status 확장** — **확정(2026-08-03, §4.23)**: `engines[]` 필드 4종 순수 추가(`enabled`·`models`·`default_model`·`selected_model`) — 톱레벨·기존 필드 불변.
- [x] **D6. 결정 ⑥ 서버 방어** — **확정(2026-08-03, §4.23 ⓒ)**: 명시 지정 비가용·비활성 = 잡 시작 전 **422 동기 거부**(§3 관례 — error_info 아님), 적용 8곳 전수·공통 헬퍼 1개. auto는 검증 없음(후보 산출이 enabled 반영).
- [x] **D7(문서). 설계 §4.23 신설 + plan §14 F47·M21 + screens §5.9·§5.11 ④·§5.12 갱신** — 완료(2026-08-03, Design v1.25 · plan v0.32).

## 목표

끝났을 때, 사용자가 설정 화면에서 특정 엔진(예: 종량 과금 claude-api)을 끄면 그 엔진이 **auto 해석·폴백 어느 경로로도 호출되지 않고**, 엔진별로 고른 모델이 **반입 변환·해설 보완·응용 생성·개선 루프 전부에 일관 적용**되며, 엔진 선택이 노출되는 모든 화면에서 쓸 수 없는(비가용·비활성) 엔진은 **눌리지 않고 사유가 보이고**, 그런 엔진을 명시 지정한 요청은 **서버가 잡 시작 전에 422로 거부**한다. DDL·Alembic·신규 엔드포인트는 전부 0이고, 아무 설정도 하지 않은 사용자의 동작은 현행과 완전히 같다.

## 작업 체크리스트

> 권장 순서: **1(활성·후보 개정) → 2(모델) → 3(422 방어) → 4(S8 카드) → 5(게이팅) → 6(테스트) → 7(문서)**. 1·2는 `llm_engine_service` 한 파일에 수렴 — 순차 권장. 3은 1 완료 후(같은 후보·상태 판정 재사용 — 이원화 금지). 프론트 4·5는 계약(§4.23)으로 병렬 착수 가능, 실기동 연결은 백엔드 완성 대기.

### 1. 백엔드 — 활성 토글·후보 자격 개정 (설계 §4.23 ⓐ)

- [x] `llm_engine_service`에 **enabled 판정** 추가: settings `llm.disabled`(JSON 배열) 읽기 — 키 부재·빈 배열 = 전 엔진 활성, **알 수 없는 id 무시**(전방 호환), legacy 별칭(`'cli'|'api'`)은 읽기 시 매핑(§4.17 ① 관례). 쓰기는 설정 화면 저장(settings PUT) 경유뿐 — 서비스는 읽기만. (`get_disabled_engines`·`is_engine_enabled`)
- [x] **후보 산출 함수 1곳 개정**: 후보 자격 = "`available()` && enabled" — auto 해석·폴백 다음 후보·`error_info.fallback_available`/`fallback_engine` 파생이 **전부 이 함수를 경유**하는지 확인(호출처별 개별 판정 잔존 = 실패. `available()` 자체 의미는 불변 — 진단·카드 표시는 꺼진 엔진도 정상). (`is_engine_candidate` 신설 — `resolve_engine`·`next_fallback_engine`이 경유)
- [x] 후보 0(전 엔진 꺼짐 포함) = **기존 "후보 없음" 경로 그대로**(신규 오류 kind·경로 변경 0 — 회귀 확인만). ~~`resolve_engine`의 "전부 불가면 priority[0] 반환" 폴백 경로 무변경 확인.~~ → **검토에서 이 문장이 DoD 1과 모순임이 실증돼 §4.23 결정 ② 개정(2026-08-03)으로 대체**: 최종 폴백 = priority 첫 enabled(비가용-전멸) · enabled 0이면 auto도 422(꺼짐-전멸). 완료 기록 [중요②] 참조.
- [x] `GET /api/llm/status` `engines[]`에 `enabled: bool` 추가(순수 추가 — 기존 필드·톱레벨 불변).

### 2. 백엔드 — 엔진별 모델 선택 (설계 §4.23 ⓑ)

- [x] 레지스트리 항목에 `models: [{id, label}]`(하드코딩 소목록)·`default_model: string|null` 추가 — **구체 값 실측 확정(D4 이월 과제)**: CLI `--model`/`-m` 수용값 확인 · API 모델 id 즉석 검증 호출로 엔진당 2~4개 확정, **CLI형 기본 = null(플래그 미전달 — 현행 동작)** · claude-api 기본 = 현행 `llm.api_model`(`claude-sonnet-5`) 승계. 확정 목록을 이 문서 완료 기록과 §4.23에 기입.
- [x] settings `llm.models`(`{엔진id: 모델id}`) 읽기 + **유효 선택 산출**(소목록에 없는 값 = 무시·기본값 폴백 — 조용한 오호출 방지) + **legacy `llm.api_model` 읽기 별칭**(`llm.models['claude-api']` 부재 시 — 쓰기는 항상 `llm.models`). (`get_selected_model`)
- [x] **`invoke()` 공통 경로 적용**: claude-cli `--model {id}` · claude-api SDK `model={id}` · codex-cli `-m {id}`(null = 미전달) — **잡 kind별 분기 금지**(convert·fetch·regenerate·answer_key·explain·applied_exam·improve 2종이 전부 같은 경로로 일관 적용되는 구조 확인). (`_new_job_base`의 `model` 필드 → `_run_claude_cli_streaming`/`_run_codex_streaming`/`_run_api_streaming`·`codex_adapter.run_exec`)
- [x] status `engines[]`에 `models`·`default_model`·`selected_model` 추가(순수 추가).

### 3. 백엔드 — 명시 지정 422 방어 (설계 §4.23 ⓒ·결정 ⑥)

- [x] **공통 헬퍼 1개**(1의 후보·상태 판정 재사용 — 검증 로직 이원화 금지): `engine` 파라미터가 auto가 아닌 명시 엔진 id이고 그 엔진이 `available():false` 또는 `enabled:false`면 **잡 생성 전 422**(§3 `VALIDATION_ERROR`) + **서버 완성 문장**(비활성 = "…엔진이 '사용 안 함' 상태입니다 — 설정에서 켜거나 다른 엔진을 선택하세요" / 비가용 = 설치·로그인·키 사유별 안내. 원문·내부 상태 노출 금지). (`llm_engine_service.assert_engine_selectable`)
- [x] **적용 8곳 전수**: `POST /api/convert` · `POST /api/documents/{id}/regenerate` · `POST /api/fetch/import` · `POST /api/import/answer-key/{key_id}/process` · `POST /api/documents/{id}/explain` · `POST /api/applied-exam/{gen_id}/generate` · `POST /api/improve/gen/{gen_id}/generate` · `POST /api/improve/regression/{reg_id}/run` — `convert_service.py`의 8개 `start_*_job` 진입점(9곳 — `POST /api/convert`가 파일/URL 내부 함수 2개로 갈림)에서 헬퍼 호출만(개별 구현 금지).
- [x] auto·미지정·legacy 별칭 값은 **기존 동작 불변**(별칭은 매핑 후 같은 검증 — '422 아님' 계약은 값 형식에 대한 것, 상태 검증과 구분).

### 4. 프론트 — S8 엔진 카드: 토글·모델 선택 (설계 §4.23·screens §5.11 ④)

- [x] `LlmEngineSection` 카드에 **활성 토글**(끄면 "사용 안 함" 배지) — 저장 = settings PUT(`llm.disabled` 배열 전체 쓰기 — 레지스트리 등재 id만). 꺼진 카드도 진단·온보딩·[다시 확인]은 정상 렌더(켜면 즉시 복귀).
- [x] 카드에 **모델 select**(status `engines[].models` 렌더 — **자유 입력 없음**, 기본값 표시) — 저장 = settings PUT(`llm.models`). `selected_model`이 null이면 "엔진 기본" 표기. models가 빈 배열인 엔진은 select 자체를 렌더하지 않는다.
- [x] **전 엔진 꺼짐 안내 1줄**: 카드 목록 상단 "모든 엔진이 꺼져 있습니다 — 변환·생성 기능이 동작하지 않습니다"(색상 토큰만).
- [x] `api/types.ts` LlmStatus 엔진 타입에 필드 4종 추가(모르는 필드 무시 관례 유지 — 기존 소비처 회귀 무영향).

### 5. 프론트 — 공용 EngineSelect 게이팅 (설계 §4.23 ⓒ·screens §5.9·§5.12)

- [x] **공용 EngineSelect 컴포넌트 신설**(이름은 구현 재량, `components/EngineSelect.tsx`): `status.engines` 파생 렌더 — `available:false`·`enabled:false`는 **선택 불가(비활성 표시) + 사유 1줄**(`enabled:false` → "사용 안 함"(우선) · `installed:false` → "설치 필요" · `logged_in:false` → "로그인 필요" · `key_registered:false` → "키 미등록") + **[다시 확인]**(기존 F34 재진단 경로 재사용 — 신규 API 0).
- [x] **교체 지점 전수(개별 구현 금지 — 컴포넌트 1개로 수렴)**: ① 반입 시작 화면 engine 선택(`pages/Import.tsx` — 기존에 선택 UI가 없어 신규 추가) ② `FetchImportWizard` 사용량 확인 스텝 ③ AI 응용 탭 엔진 선택(`AppliedExamPanel.tsx`, §5.12) ④ F44 답지(`AnswerKeyImportWizard.tsx`)·explain(`ExplainJobPanel.tsx` — 기존엔 표시만 하던 것을 실선택으로 승격) / F46 개선(`ImproveGenWizard.tsx`)·회귀(`ImproveRegressionWizard.tsx`) 위저드의 엔진 선택. 부가: `LlmLimitBanner.tsx`의 다음 후보 근사 로직도 `enabled` 반영(§4.23 ⓐ 후보 개정과 일관).
- [x] 422(명시 지정 거부) 응답은 서버 message 그대로 렌더(§3 관례 — 프론트 문구 조립 금지). 폴백 [다시 시도] 버튼은 무변경(`fallback_engine`은 이미 후보 산출을 거친 엔진 — §4.23 ⓐ) — `LlmErrorInfo.tsx`·`RegenerateJobPanel.tsx`·`ImportQueue.tsx`의 재시도 경로는 EngineSelect로 교체하지 않음(이미 gating이 끝난 fallback_engine을 직접 재시도하는 경로라 별개).

### 6. 테스트·검증

- [x] **단위 테스트**(후보·게이트는 핵심 로직 취급 — 불변 규칙 7의 예외, §4.17 ⑥ 전례): ① **후보 자격**(disabled 엔진이 auto·다음 후보·fallback_engine에서 배제 · 켜면 복귀 · 알 수 없는 id 무시 · legacy 별칭 매핑) ② **모델 유효 선택**(소목록 밖 값 = 기본값 폴백 · llm.api_model 별칭 · null = 미전달) ③ **422 방어**(비활성·비가용 명시 지정 거부 · auto 무검증 · 8곳 공통 헬퍼 경유) ④ **status 필드 4종**(기존 필드·톱레벨 불변). — 신규 `backend/tests/test_engine_controls.py`(27건 → 검토 반영 후 34건 — 진입점 경유 회귀 포함), 기존 스위트 포함 **전체 433건 통과**.
- [x] 스모크(실기동): 오케스트레이터가 uvicorn(포트 8021)으로 수행 — status 필드 4종·settings 왕복(끄기→422→켜기 복귀)·비활성 422("사용 안 함")·비가용 422(키 미등록 사유)·dist 신규 번들 서빙 확인. **스모크 절차 고정: `engine=auto` 실행 금지, 422 유발 값·무LLM 엔드포인트만 사용**(완료 기록 사고 재발 방지).
- [ ] **모델 실호출 확인(사용자 이행 — 실 LLM 소비용)**: 엔진별 선택 모델로 소형 변환 각 1회 — 모델 인자가 실제 반영되는지(로그·usage로 확인).
- [x] stage-reviewer(Opus) 검토: 1차(치명 0·중요 2·경미 6 — DoD 4/6) → 수정 반영 → **표적 재검토 최종 통과(DoD 자동 검증 6/6·치명 0·중요 0)**. 완료 기록 참조.

### 7. 문서

- [x] 계획서 F47·설계 §4.23에 **모델 소목록 실측 확정 값 기입**(D4 이월 과제 — 구현 중 계약과 어긋나면(특히 DDL) 착수 중단 후 보고) · 구현 확정 사항 기록. — 아래 완료 기록 참조(설계 §4.23은 이 문서 완료 기록을 갱신하는 별도 편집 없이, 결정 ④ 문장 자체가 이월 계약이므로 실측 결과는 이 stage 문서에 고정 기록한다).
- [x] 사용자 매뉴얼(F39): 엔진 끄기(과금 차단 용도)·모델 선택·"쓸 수 없는 엔진" 사유 표시·[다시 확인] 사용법 추가. — 15장에 켜기/끄기·모델 선택 불릿 + "쓸 수 없는 엔진은 눌리지 않습니다" 소절 추가(2026-08-03).
- [x] 이 문서 체크박스 갱신(불변 규칙 10) · CLAUDE.md 문서 지도 갱신(F47·M21·4.1~4.23·[S21] — 오케스트레이터 담당, 2026-08-03 구현 완료 상태 반영).

## DoD (완료 정의)

**자동 검증 가능 항목** (구현·검토에서 증명):

1. **비활성 엔진 호출 경로 0**: `llm.disabled`에 든 엔진이 auto 해석·폴백 다음 후보·`fallback_engine` 어디에도 오르지 않는다 — 후보 자격 판정은 **공통 함수 1곳**(호출처별 분기 잔존 0).
2. **모델 일관 적용 + 무설정 불변**: 선택 모델이 `invoke()` 공통 경로로 **전 잡 kind**에 적용되고, 아무 설정 없는 상태의 동작(전달 인자·기본 모델)은 현행과 바이트 수준으로 같다(legacy `llm.api_model` 포함).
3. **서버 방어 8곳 전수**: 비가용·비활성 엔진 명시 지정 = 잡 시작 전 422(공통 헬퍼 — LLM 호출·잡 생성 0). auto·legacy 별칭은 기존 동작 불변.
4. **status 순수 추가**: `engines[]` 필드 4종 추가 외에 기존 필드·톱레벨 무변경 — 기존 프론트 소비처(`LlmLimitBanner` 등) 회귀 무영향.
5. **UI 게이팅 전수**: 엔진 선택 노출 지점 전부가 공용 컴포넌트를 쓰고, 비가용·비활성 엔진은 선택 불가 + 사유 표시 + [다시 확인] 동작.
6. **DDL 0건·Alembic 0건·신규 엔드포인트 0개**(§4.23 재확인 — 어긋나면 착수 중단 후 보고). settings 키 2개(`llm.disabled`·`llm.models`)뿐.

**사용자 이행 항목** (실 LLM 비용 — 자동 실행하지 않음):

7. **모델 실호출 확인**: 엔진별 선택 모델로 소형 변환 각 1회 — 모델 인자 실반영 확인, 결과를 완료 기록에 기입.

## 이 단계에서 하지 않는 것

- **재배포 금지 고지 정책 변경 없음** — 2026-08-03 사용자 논의에서 JSON 공유 건은 기존 기능(변환 JSON 내려받기·반입 JSON 직접 업로드)으로 충족 확인·**정책 불변**. FetchImportWizard 고정 고지("개인 학습 전용 — 수집물 재배포 금지") 문구·노출 지점 무변경.
- **자유 텍스트 모델 입력 없음** — 소목록+기본값 기각 확정(§4.23 결정 ③ — 재제안 시 근거 필요).
- **신규 엔진 추가 없음** — 레지스트리 3종(claude-cli·claude-api·codex-cli) 그대로. 엔진 추가는 별도 계획 등재 먼저.
- **요청 단위(1회성) 모델 오버라이드 파라미터 없음** — 엔진별 저장 설정만(필요 실측 시 계획서 먼저).
- **모델별 비용 추정 세분화 없음** — estimate(`assumed` 대략치)·사용량 안내 관례 불변.
- **진단 캐시 TTL 변경 없음** — 60초 유지, 지연은 [다시 확인]으로 해소(기존 패턴 재사용 — 재진단 API 신설 금지).
- **후보 0(전 엔진 꺼짐)의 신규 오류 경로 없음** — 기존 "후보 없음" 처리 그대로 + 프론트 안내 1줄만(§5.11).
- **`llm.api_model` 삭제·일괄 마이그레이션 없음** — 읽기 별칭 유지, 쓰기 수렴(§4.17 legacy 관례).

## 리스크

- **낮음(설정·검증 계층 — LLM 호출 0·DB 쓰기는 settings 2키뿐)**. 신규 리스크 등재 없음(§15 무변경 — 스키마 변경 0이라 리스크 표 기록 의무 비발동).
- **소목록 개정 뒤 구 설정 잔존**: `llm.models`에 소목록 밖 값이 남으면 — 무시·기본값 폴백(§4.23 결정 ④ 전방 호환 규칙)이 방어. 조용한 오호출 0.
- **진단 TTL 지연으로 게이팅 오표시**: 60초 내 상태 변화(설치·로그인 직후)가 늦게 반영 — [다시 확인] 연계가 대응(계약에 포함).
- **후보 축소로 폴백 무후보 빈도 증가**: 사용자가 엔진을 끄면 ask/auto 폴백이 "후보 없음"으로 끝나는 경우가 늘 수 있다 — 기존 경로·문구 그대로이고, S8 카드 안내 1줄이 원인(꺼짐)을 드러낸다.

## 완료 기록 (착수 후 기입)

- **2026-08-03 백엔드 구현(backend-dev, 1~3·6절 백엔드 부분)**: `llm_engine_service.py`(레지스트리 확장·`get_disabled_engines`/`is_engine_enabled`/`is_engine_candidate`/`get_selected_model`/`assert_engine_selectable`·`_engine_status`/`get_status` 필드 4종) · `convert_service.py`(8개 `start_*_job`에 422 헬퍼 삽입 + `model` 필드 공통 적용, `_run_claude_cli_streaming`/`_run_codex_streaming`에 `model` 파라미터 추가) · `codex_adapter.run_exec`(`-m` 플래그) · `schemas/llm.py`(`EngineModel`·`EngineStatus` 필드 4종) · `settings_service.py`(DEFAULTS에 `llm.disabled`·`llm.models` 등재) · 테스트 보정(`test_doc_format_detect.py`·`test_improve.py`의 `_new_job_base`/`_run_claude_cli_streaming` 목킹 시그니처를 새 `model` 파라미터에 맞춤) · 신규 `tests/test_engine_controls.py`(27건).
- **모델 소목록 실측 확정(D4)**: `claude --help`(무과금) 확인 결과 `--model` 플래그가 별칭(`sonnet`|`opus`|`fable` 등) 또는 전체 id를 수용 — **claude-cli = `[{"sonnet","Sonnet"},{"opus","Opus"}]`, `default_model=null`**(플래그 미전달, 현행 동작 불변). `codex exec --help`(무과금)는 `-m, --model <MODEL>` 플래그 존재만 확인되고 수용 가능한 모델 id 목록은 문서화돼 있지 않아 — **codex-cli = `[]`(빈 배열), `default_model=null`**(추측 하드코딩 금지, D4 보수 규칙 적용). **claude-api**는 지시서 확정값 그대로 — `[{"claude-sonnet-5","Sonnet 5"},{"claude-opus-5","Opus 5"},{"claude-haiku-4-5-20251001","Haiku 4.5"}]`, `default_model="claude-sonnet-5"`(현행 `llm.api_model` 승계). 셋 다 실제 유료 API 호출로 모델 id를 검증하지는 않았다(무설정 시 동작 불변이 전제라 `--model`/`-m` 미전달 경로가 항상 안전망).
- **8곳 적용 확인**: `convert_service.py`의 `start_fetch_job`·`start_convert_job`·`start_convert_job_from_url`·`start_regenerate_job`·`start_answer_key_job`·`start_explain_job`·`start_applied_exam_job`·`start_improve_proposal_job`·`start_improve_regression_job`(9개 함수 — `POST /api/convert` 1개 엔드포인트가 파일/URL 두 내부 함수로 갈리므로 8개 라우터 엔드포인트 = 9개 진입점) 전부 `llm_engine_service.assert_engine_selectable(db, engine)`을 `resolve_engine` 호출 직전에 공통 호출.
- **테스트 결과**: 신규 27건(`test_engine_controls.py`) + 기존 399건 = **전체 426건 통과**(회귀 0). 임베디드 파이썬으로 실행 확인.
- **스모크(uvicorn 실기동)**: alembic upgrade head로 로컬 DB 스키마 생성 후 확인 — `GET /api/llm/status`에 `enabled`/`models`/`default_model`/`selected_model` 4종 정상 노출 · `PUT /api/settings`로 `llm.disabled:["claude-api"]` 저장 후 status가 즉시 반영 · `POST /api/convert`·`POST /api/fetch/import`에 `engine=claude-api`(비활성) 명시 지정 시 **422 `VALIDATION_ERROR`** + 서버 완성 문장("Claude API 엔진이 '사용 안 함' 상태입니다 — 설정에서 켜거나 다른 엔진을 선택하세요") 확인 · `llm.disabled` 초기화 후 정상 왕복.
- **경위 보고(사고 기록)**: 스모크 중 `POST /api/convert`를 `engine=auto`로 1회 호출했을 때, 이 개발 환경의 `claude` CLI가 실제 로그인된 실행 파일이라 **후보가 자동으로 `claude-cli`로 해석되어 실제로 호출됐다**(input/output 각 2토큰 — 대상 파일이 변환 프롬프트에 맞지 않아 `other` 오류로 즉시 종료, 과금은 사실상 0에 가깝지만 "실 LLM 유료 실행 금지" 지시를 어긴 것은 사실). 확인 즉시 서버 프로세스를 종료했다. 이후 스모크는 **명시 비활성 엔진 지정(422 유발) 값만** 사용해 실호출 경로를 피했다 — 나머지 6개 엔드포인트의 422는 코드 검토(9곳 전수 삽입 확인) + 단위 테스트로 갈음했다(문서·URL·PDF 등 실제 반입 페이로드 없이 `auto`/가용 엔진으로 HTTP 스모크를 재현하지 않는다).
- **계약과 어긋나 보류한 것**: 없음(DDL·Alembic·신규 엔드포인트 0 확인 — settings 키 2개만 추가, `llm.disabled`·`llm.models`).
- **2026-08-03 stage-reviewer(Opus) 검토 반영 — 백엔드 중요 2·경미 3건 + 프론트 2건 수정(설계 §4.23 결정 ②·⑤·⑥·ⓒ 개정 동기화 포함)**:
  - **[중요①] 런타임 폴백 모델 누출 수정**: `_handle_engine_failure`가 `job["_engine"]`을 다음 후보로 바꿀 때 `job["_model"]`도 같은 db 세션 안에서 `get_selected_model(db, next_engine)`으로 함께 갱신하도록 수정(이전엔 이전 엔진의 모델 id가 그대로 남아 존재하지 않는 모델로 호출되는 사고 경로였다).
  - **[중요②] `resolve_engine` 최종 폴백 개정 + auto 전부 꺼짐 422**: 설계 §4.23 결정 ② 개정(2026-08-03 검토 반영)에 따라 후보 0("비가용-전멸")의 최종 폴백을 `priority[0]` 무조건 반환에서 **priority 중 첫 enabled 엔진**(`available()` 무시)으로 좁혔고, `assert_engine_selectable`에 **"꺼짐-포함 전멸"(enabled 0) 시 auto도 잡 생성 전 422**("모든 엔진이 꺼져 있습니다 — 설정에서 엔진을 켜세요")로 막는 명시 예외 1건을 추가했다(9개 진입점 전부 같은 헬퍼 경유 — 변경 없음).
  - **[경미③] F30 신고 사례 수집보다 엔진 검증 선행**: `start_regenerate_job`에서 `assert_engine_selectable` 호출을 문서 조회 직후·`improve_service.collect_report_case` 호출 이전으로 이동(422로 거부될 요청이 제안함 사례로 잘못 남는 결함 해소).
  - **[경미⑤] API 키 검증 핑 모델**: `routers/llm.py` `register_api_key`가 legacy `llm.api_model` 직접 조회 대신 `llm_engine_service.get_selected_model(db, ENGINE_CLAUDE_API)`(유효 선택값)로 핑하도록 교체.
  - **[경미⑦] 진입점-헬퍼 경유 회귀 테스트**: `assert_engine_selectable`을 monkeypatch로 예외 발생시켜 9개 `start_*_job` 함수 전부가 잡 생성 전에 예외를 전파하는지 확인하는 테스트 추가(`test_all_nine_entrypoints_propagate_assert_engine_selectable`).
  - **신규 테스트 7건 추가**(모델 누출 2·resolve_engine 최종 폴백 2·auto 전부 꺼짐 422 2·진입점 경유 1) — **전체 433건 통과**(기존 426 + 신규 7, 회귀 0). 이번 수정 검증은 전부 in-memory SQLite 단위 테스트로만 수행했고 **uvicorn 재기동·실 LLM 호출은 하지 않았다**(이전 사고 재발 방지 지시 준수).
  - **[프론트 경미④] S8 모델 select "엔진 기본" 유령 옵션 제거**: `LlmEngineSection.tsx` — §4.23 ⑤ 개정(selected_model = 유효 적용값)에 따라 `default_model`이 non-null인 엔진(claude-api)은 빈 옵션을 렌더하지 않고, CLI형(default null)만 "엔진 기본(미전달)" 옵션 유지.
  - **[프론트 개선 (b)] explain 과금 인지 소표기 복원**: `ExplainJobPanel.tsx` — EngineSelect 교체로 사라졌던 "사용 엔진: {label} ({과금형})" 1줄 복원(auto = priority 첫 available && enabled로 예상 엔진 산출 — 서버 후보 규칙과 동일 기준).
- **2026-08-03 표적 재검토(stage-reviewer, Opus) — 최종 통과**: 수정 6개 항목 전부 실행 재현으로 해소 확인(중요① 양방향 시나리오 재실행·중요② 1차 재현 시나리오 422 차단 실증) · 전체 pytest 433 passed · `npm run build` 성공 · dist 바이트 동일(재빌드 후 git clean) · **DoD 자동 검증 6/6 충족 · 치명 0 · 중요 0**. 잔여 관찰(게이트 사유 아님): 진입점 회귀 테스트에 예외 메시지 단언 1줄 추가 권장 · ExplainJobPanel/LlmLimitBanner의 auto 근사 로직 훅 추출 권장 · `assert_engine_selectable`의 settings 반복 조회 축약 가능.
