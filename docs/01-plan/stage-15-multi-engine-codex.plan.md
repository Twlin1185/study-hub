# Stage 15 — 멀티 벤더 LLM 엔진: Codex CLI (M15: F41)

> 상위: `study-app.plan.md` **v0.18** §14(M15)·**F41** · 실측 근거: **PoC `C:\Users\rlawh\Desktop\codex_engine_test\`** (2026-07-27 — `results\SUMMARY.md` v2가 정본, Opus 검증 재검토 통과·조건부 GO) · 설계: **§4.17 신설 완료(✅ 2026-07-28, 설계 v1.17 — G3 해소. 당초 §4.16으로 예약했으나 설계 v1.16이 §4.16을 '앱 버전 확인'에 사용해 2026-07-28 §4.17로 재지정 — plan v0.21)**, S8(LLM 엔진 설정) 확장
> 순서 관계(plan v0.21 §14): **M16(stage-16 문서 포맷 반입)과 동시 착수 금지** — 둘 다 convert 경로를 수정한다. M16·M17은 이 단계의 게이트와 무관하게 선행 가능.
> 배경: 배포 시나리오 — **도구만 배포 + 시험 데이터는 각자 수집(저작권 안전) + LLM은 각 사용자의 ChatGPT 구독(Codex CLI)**. 운영자 아이디·키 대여 없음. 대상 사용자군은 ChatGPT 구독 보유 확인됨(free 플랜도 호출 성공 실측 — 맛보기 가능).
> **상태: M15 완료(✅ 2026-07-28)** — 게이트 3건 통과 → 구현(레지스트리·codex 어댑터(stdin 전달)·신뢰 게이트·S8 온보딩) → Opus 검토 3회전(중요 5건 전건 수정, 치명 0) → **최종 조건부 통과**(잔여 = 차단성 없는 경미 8건 + DoD 1 사용자 확인 1건 — 검토 기록은 5절 참조).
> 불변 규칙 재확인: 채점은 서버에서만(1) · `sources/` 원본 불변(4) · **미리보기 승인 없는 자동 반입 금지(R7)** — 이 단계의 신뢰 게이트는 R7의 기계적 보강이다 · 키·자격증명은 `secrets.json`/전역 홈 단일 출처, DB·settings 금지(F34 전례) · 오류 원문 노출 금지(`error_info` 구조화).

## 착수 게이트 (전부 통과 후 착수 — 통과 여부를 이 문서에 기록)

- [x] **G1. M13·M14 종료** — 반입 경로(수동 UX·큐넷)가 안정된 뒤 엔진 층을 건드린다. 작업공간 동시 수정 충돌 방지 목적도 있다. **✅ 2026-07-28 충족 — M14 검토 통과·main 머지(커밋 1be8baf).**
- [x] **G2. 품질 재실험 통과** — **정답표 있는 텍스트 정상 원본**(수식 폰트 추출 가능)으로 지문·보기·정답 추출 정확도 측정. PoC 원본은 정답표 부재 + 수식 추출 불가로 정량 측정이 오염됐다(SUMMARY §6 — 창작 6/10은 이 병리에 크게 의존, 정상 원본에서의 창작률은 미측정). 재실험은 격리 공간에서 PoC 하니스 재사용 — **재사용 전 `pure_json`을 pass 조건에 반영**(검증 수용 조건). 권장 2트랙: 큐넷 실기 공개문제(M14 산출물 — 실제 배포 경로 재현) + 정답 포함 자료(정답 정확도 측정). **✅ 2026-07-28 통과 — 격리 공간 `Desktop\codex_engine_g2\`(`results\G2_report.md` 정본, pure_json pass 조건 반영). 트랙 B(DB 승인 문항 10개 합성 시험지+정답표, 2회): 정답 10/10·10/10, 창작 보기 0건, 2회 정답 완전 일치(정답표가 있으면 비결정성 소멸), 비축자 차이는 표 정렬 마커·위첨자뿐. 트랙 A(큐넷 봉제기능사, 배포 경로 재현): PDF 직접 읽기는 샌드박스 제약을 정직 보고(창작 0 — 어댑터는 추출 텍스트 삽입이 정본임을 실증), 추출 텍스트 경로는 concept 6건·정답 창작 0·시각 자료는 "원본 확인 필요" 명시. PoC의 창작 병리는 원본 병리 기인이었음이 실증 — 단, 더러운 원본 대비 신뢰 게이트(3절)는 여전히 필수.**
- [x] **G3(문서). 설계 §4.17 신설** — 엔진 레지스트리 계약(id·표시명·진단·호출·분류기 인터페이스)·`GET /api/llm/status` 응답 확장·S8 화면 변경·§8.2 규격 개정(`answer_source`)을 설계 문서에 먼저 확정. plan §6.2 DDL 변경은 없다는 전제를 설계에서 재확인(어긋나면 보고). **✅ 2026-07-28 해소 — 설계 v1.17 §4.17 신설 + plan v0.22 §8.2 v1.1 개정(status는 `cli`/`api` 필드 제거 후 엔진 배열로 교체, 기존 반입 JSON은 누락=original·텍스트 answer 정규화로 호환 유지, DDL 0건 재확인).**

## 목표

끝났을 때, ChatGPT 구독만 있는 사용자가 **API 키도 터미널도 모른 채** 설정 화면에서 [Codex 설치] → [로그인 확인]을 눌러 온보딩을 마치고, 파일 반입·변환을 Claude 사용자와 동일한 UX로 완주한다.
그리고 **어떤 엔진이든** 원본에 없는 지문·보기·정답이 경고 없이 반입되는 경로가 0이다 — 변환 신뢰 게이트는 Codex 전용이 아니라 파이프라인 공통이다.

## 작업 체크리스트

> 권장 순서: **1(레지스트리 리팩터) → 2(codex 어댑터) → 3(신뢰 게이트) → 4(온보딩·설정 UI) → 5(테스트) → 6(문서·매뉴얼)**.
> 1이 끝난 시점에도 기존 Claude cli/api 2엔진이 회귀 없이 동작해야 한다(리팩터 단독 배포 가능 상태).

### 1. 백엔드 — 엔진 레지스트리 (F34 이항 가정 해체)

- [x] `llm_engine_service`의 엔진 식별을 `cli|api` 2값에서 **레지스트리 목록**(예: `claude-cli`, `claude-api`, `codex-cli`)으로 일반화 — 진단·호출·오류 분류기를 엔진 항목의 인터페이스로 통일. 기존 설정값(`llm.priority: cli|api`)은 읽기 시 신 id로 매핑(마이그레이션 없는 하위 호환)
- [x] **폴백 = 우선순위 목록**: `other = "api" if engine == "cli" else "cli"` 류의 이항 분기 전수 제거(`llm_engine_service`·`convert_service` — PoC에서 위치 파악 완료). `apply_remembered_limit`·`build_error_info`·`_handle_engine_failure`가 "다음 후보 엔진"을 목록에서 뽑도록 변경. 폴백 정책(auto/ask/off)·과금 동의 원칙은 그대로
- [x] 한도 기억(`llm.last_limit`)·헬스(`_ENGINE_HEALTH`)를 엔진 id 키로 일반화. `GET /api/llm/status` 응답을 엔진 배열로 확장(설계 §4.17 계약 — 기존 `cli`/`api` 필드는 **제거 확정**대로 구현 — 호환 유지 없음)
- [x] 회귀 확인: Claude cli/api 2엔진 구성에서 기존 시나리오(우선순위·폴백·한도 기억·429 안내) 전부 동작 — 스모크로 검증하고 결과 보고(아래 "구현 결과" 참조)

### 2. codex-cli 어댑터

- [x] 호출: `codex exec --json --skip-git-repo-check -C <작업디렉터리> -o <최종메시지파일> -` — **프롬프트는 위치 인자가 아니라 stdin으로 전달**(마지막 `-` = "stdin에서 읽어라", `codex exec --help` 실측). 최종 메시지는 `-o` 파일이 1차, JSONL 이벤트 스캔은 폴백(두 경로 산출 동일 확인). ~~PoC 확정 플래그(프롬프트를 위치 인자로)~~는 **2026-07-28 통합 스모크에서 실호출 결함으로 폐기**(아래 결함 기록 참조)
- [x] 진단: `codex --version`(설치)·`login status` 텍스트 파싱(`--json` 없음 — rc=0 + "logged in" 포함. PoC `check_login_status()` 로직 이식)
- [x] **오류·한도 분류기 codex판**(`classify_codex_failure`): 미설치/미로그인/타임아웃/기타 구조화. **429·한도 메시지 형식은 미실측**(PoC에서 미조우) — 착수 후 실측해 채우고, 실측 전에는 `kind:'other'`+"Codex 사용량 한도일 수 있습니다" 보수적 안내
- [x] 변환 프롬프트는 기존 `prompts/convert.md` 공유(벤더 중립 확인됨). `_fetch_directives` 등 지시 생성기 재사용 — 중복 구현 금지. **G2 실증(2026-07-28)에 따라 codex 경로는 pypdf 추출 텍스트를 프롬프트에 삽입**(`codex_adapter.build_text_for_prompt`) — 직접 PDF 읽기는 사용하지 않음

**구현 결과(2026-07-28, backend-dev)**: `services/codex_adapter.py` 신설(진단·설치·`exec` 호출·`classify_codex_failure`·`build_text_for_prompt`) + `services/llm_engine_service.py` 전면 리팩터(`ENGINE_REGISTRY`·`normalize_engine_id`·`normalize_priority`·`resolve_engine`·`next_fallback_engine`·`classify_engine_failure`·`get_status` 엔진 배열화) + `services/convert_service.py`(_do_convert·_do_fetch·_do_regenerate·`_handle_engine_failure`에 codex-cli 분기 추가, 이항 리터럴 전수 제거) + `schemas/llm.py`·`schemas/convert.py`(`EngineStatus`·`LlmStatus.engines`·`ErrorInfo.fallback_engine`) + `routers/llm.py`(`POST /api/llm/engines/{id}/install`) + `routers/convert.py`(engine 검증 확장). `requirements.txt`에 `pypdf` 추가, `.gitignore`에 `tools/codex/` 추가. 단위 테스트 `tests/test_llm_engine_registry.py`(32건, 정규화·폴백·분류기) 신설.

**결함 기록·수정(2026-07-28, 통합 스모크 발견 → backend-dev 원인 규명·수정)**: 신뢰 게이트 담당의 통합 스모크(`sources/da8b6fb942e0_s15_smoke_source.txt`, 3문항)에서 codex 실호출이 `invalid_output`(codex가 "원본을 보내달라" 류 대화 응답)로 실패. 재현·원인 규명 결과 — **프롬프트 자체는 정상 조립돼 있었고, 문제는 전달 방식이었다**: 이 dev 환경의 `codex`는 npm 설치본이라 PATH가 가리키는 실행 파일이 네이티브 `.exe`가 아니라 `.cmd` 배치 셸(`codex.CMD`)이다. 여러 줄·따옴표·백틱이 섞인 긴 프롬프트를 **CLI 위치 인자**로 넘기면, Windows가 `.cmd`를 `cmd.exe /c`로 경유 실행하는 과정에서 인자가 셸 메타문자로 재해석돼 프롬프트가 훼손된다(Node.js `child_process`의 `.cmd`/`.bat` 인자 주입 취약점(CVE-2024-27980)과 같은 부류의 Windows 고유 함정). 같은 프롬프트를 네이티브 `codex.exe`(PoC/G2가 실제로 썼던 그 바이너리, `codex_engine_test\bin\codex.exe`)에 위치 인자로 넘기면 정상 동작했다 — 즉 **G2가 4/4 성공했던 것은 네이티브 바이너리만 썼기 때문**이고, 앱은 사용자 PATH에 어떤 종류의 `codex`가 있을지 통제할 수 없으므로 위치 인자 방식 자체가 구조적으로 불안전했다. **수정**: `codex exec --help`가 명시하는 "PROMPT 인자를 생략하거나 `-`를 주면 stdin에서 읽는다" 경로로 전환 — 프롬프트를 CLI 인자에서 빼고 자식 프로세스 stdin에 씀(`.cmd`/`.exe` 어느 쪽이든 동일하게 안전, 재현 확인). 구현은 stdin 쓰기를 별도 스레드로 분리(`_stdin_writer`)해 stdout·stderr 읽기 스레드와 동시에 돌린다 — 큰 프롬프트를 메인 스레드에서 다 쓰기 전에 자식이 stdout을 채우면 상호 대기 교착이 날 수 있어서다(claude CLI 스트리밍은 프롬프트가 짧아 메인 스레드 순차 쓰기로도 안전했지만 codex는 수만 자 추출 텍스트가 통째로 들어가 이 완화가 필요). **item 4(대형 원본 인자 상한) 결론**: stdin 전환으로 Windows 명령줄 길이 상한(~32,767자)이 구조적으로 무관해졌다 — 별도의 "프롬프트 파일 폴백" 같은 신규 메커니즘 설계·계획 결정은 불필요(원 결함의 수정 자체가 부수적으로 해결). PoC T4의 "6만 자 프롬프트를 인자로 넘겨 성공" 기록은 그 실행이 네이티브 `.exe`였기 때문으로 설명되며, stdin 경로에서는 이 구분 자체가 무의미해진다.

**최종 검증**: 전체 `pytest tests/` **211 passed**(신뢰 게이트 3절 테스트 포함, 무회귀). uvicorn 기동 스모크: `GET /api/llm/status`가 `cli`/`api` 필드 없이 엔진 3종 배열 반환(이 dev 환경은 codex-cli가 실제 설치·로그인돼 있어 `installed:true, logged_in:true` 실측) · `POST /api/llm/engines/codex-cli/install`(이미 설치 감지 → 다운로드 생략, 200) · `POST /api/llm/engines/claude-cli/install`(422) · legacy `engine:"cli"` 요청 검증 통과(SSRF 차단으로 조기 종료, LLM 미호출) 확인. **codex 실호출 스모크(결함 수정 후, 1회, 체크리스트 5절 겸용)**: `POST /api/convert`(`sources/da8b6fb942e0_s15_smoke_source.txt`, `engine=codex-cli`) → 잡 `cvt_341b7426` `status:"done"`(28.8초) → `result_preview_id:imp_3a26b137` → 미리보기 `summary:{total:3, ok:3, error:0, warning:0}`, 문항 1·2는 `type:question`(원본에 정답 명시), 문항 3은 원본에 정답이 없어 `type:concept`으로 정상 분류(정답 창작 없음) — 순수 JSON·warnings 정상 확인.

### 3. 변환 신뢰 게이트 (§8.2 규격 확장 — **전 엔진 공통**, R7 보강)

> 근거(PoC 실측): 수식 추출 불가 PDF에서 지문·보기 창작 6/10(보기 전체 창작 3건 — 창작 보기에 정답 공식이 없는 문항 발생), 정답 생성 여부가 동일 프롬프트에서 비결정(공란 10/10 ↔ 자체 풀이 10/10). **프롬프트 규칙만으로 통제 불가.**

- [x] `prompts/convert.md`·§8.2에 **`answer_source: "original" | "solved"`** 필드 추가(문제 타입 필수) — "정답이 원본에 명시돼 있으면 original, 네가 풀어 채웠으면 solved" 지시. `solved`는 preview에서 **경고 배지 + 기본 반입 제외**(사용자가 항목별로 명시 승인해야 포함)
- [x] **원문 대조 검사(서버측, LLM 아님)**: preview 생성 시 각 문항의 지문·보기 문자열이 **원본 추출 텍스트에 실재하는지** 대조(정규화 후 부분 일치 — 임계·알고리즘은 설계 §4.17에서 확정). 불일치 항목은 `fabrication_suspect` 경고 + 기본 반입 제외. 원본 텍스트 추출이 불가한 형식(이미지·암호화 수식)은 "대조 불가" 상태로 별도 표시(조용한 통과 금지)
- [x] pypdf 폴백 경로에 `cryptography` 의존 추가(암호화 PDF — PoC 실측), requirements 반영
- [x] 검증기 이월 결함 3건 반영(PoC 검증 수용 조건): import 검증에서 ① 순수 JSON 위반을 오류로 집계 ② `content` 필수(개념·문제) ③ 객관식 `answer`는 **보기 번호만 허용**으로 규격 좁히기(§8.2 개정 — 수치형 보기의 번호/텍스트 이중 해석 제거). 기존 반입 JSON과의 호환(텍스트 answer 허용 여부)은 설계에서 확정
- [x] 단위 테스트: 창작 의심 검출(원본에 없는 보기 문자열) · `answer_source:solved` 기본 제외 · 대조 불가 상태 표시 · 번호 정합

**구현 결과(2026-07-28, backend-dev — 3절 신뢰 게이트)**: `services/source_match.py` 신설(정규화·pypdf 추출·`SourceMatcher` — 설계 §4.17 ⑥ 알고리즘 그대로: 부분 문자열 → 12자 비겹침 조각 커버리지 0.6, 길이<10 생략, 원본 정규화 <200자 = 대조 불가) + `import_service`(`_validate_item(strict=)` §8.2 v1.1 3종 강화 + `_normalize_choice_answer` + `_item_warnings` + `create_preview(gate=, strict=, source_text=)`) + `schemas/import_schema.py`(`PreviewItem.warnings`·`PreviewSummary.warning` 순수 추가) + `convert_service`(`_do_convert`·`_do_fetch`에 `gate=True, strict=True`, 사이트 반입 구조화 텍스트는 `source_text`로 전달, `_parse_json_payload`를 **순수 JSON 전용**으로 좁히고 `InvalidLlmOutputError.impure` 추가) + `codex_adapter.build_text_for_prompt`가 `source_match.extract_pdf_text`를 공유(프롬프트 텍스트 = 대조 텍스트, 중복 구현 제거) + `prompts/convert.md` §2 표·§2-1~2-3·§7 체크리스트·예시 갱신 + `requirements.txt`에 `cryptography`(+cffi·pycparser) 추가.
  - **DDL 0건 · Alembic 0건** (`answer_source`·대조 결과는 preview 신호로만 존재 — DB 미저장).
  - **경로 구분**(설계 §4.17 ⑤): 강화 검증(`strict`)·대조 배지(`gate`)는 변환 파이프라인 산출물에만. 직접 업로드 JSON은 `answer_source` 누락=original·텍스트 answer는 choices 전체 일치 시 번호 정규화(불일치만 오류)로 하위 호환.
  - **복구 경로 정합(F40-①)**: `recover_preview`는 `gate=True`(warnings 유지)·`strict=False`(S15 이전 보존 파일이 전 항목 오류로 되살아나 복구 계약을 깨뜨리지 않도록) — 구현 판단, 보고 사항.
  - 테스트: `tests/test_convert_trust_gate.py` **34건 신설**(알고리즘·창작 검출·solved·대조 불가·번호 정합·순수 JSON·직접 업로드 무배지·복구 시 warnings 유지) + 기존 2건 규격 개정 반영 → **`pytest tests/` 211 passed**(176 → 211).
  - 스모크(uvicorn:8012): ① 직접 업로드 preview HTTP 200 — 텍스트 answer 번호 정규화·`solved_answer` 배지·`summary.warning=1`·대조 배지 없음 확인 ② 작은 텍스트 원본(3문항, 정답표에 1·2번만 수록)으로 **claude-cli 실변환 1회** — 3항목 전부 `ok`, 정답이 원본에 없던 3번만 `solved_answer`, 깨끗한 원본에서 **오탐(fabrication_suspect) 0건**, 보존 JSON에 `answer_source: original/original/solved`·번호형 answer 확인.
  - **검토 지적 2건 수정(2026-07-28, 같은 날 후속)**: ① **DoD 3 구멍** — 원본 파일이 없는 경로(사이트 반입 `FetchedExam` 구조화 텍스트)에서 보존본을 복구하면 `fabrication_suspect`가 `match_unavailable`로 강등돼 기본 반입에 포함됐다. 권고 ⓐ 채택 — `preview_store.save`가 최초 판정을 `preview_warnings` 사이드카(`{"index": [...]}`, §8.2 규격 밖 키라 재반입 시 무시)로 같은 파일에 남기고, `recover_preview`가 그것을 `warnings_override`로 복원한다(**복구는 상태 복원이지 재판정이 아니다** — 사이드카 없는 구버전 보존본은 기존 재계산 유지). ② **설계 이탈** — 범위 밖 숫자 answer가 보기 텍스트와 완전 일치해도 오류였다. §8.2 v1.1대로 "1~n 범위 숫자만 번호, 범위 밖은 텍스트 경로로 강하"로 수정(직접 업로드에서 `choices:["10","20","30"], answer:"20"` → `"2"`. 텍스트와도 불일치면 기존 범위 오류 문구 유지, 파이프라인(strict)은 여전히 번호만 허용). 회귀 테스트 5건 추가(원본 없는 보존본 복구 시 `fabrication_suspect` 유지 · 사이드카 기록/재반입 무시 · 구버전 보존본 재계산 · 수치형 보기 정규화 · 파이프라인 오류 유지) → 216 passed, 직접 업로드 preview HTTP 재스모크 확인.
  - **3차 검토 지적 수정(사이드카가 만든 인접 결함)**: 사이드카가 "경고 있는 항목"만 담아 **"경고 없음(판정됨)"과 "판정 안 됨(최초 error 항목)"이 구분되지 않았고**, 복구(strict=False)에서 살아난 옛 error 항목에 `[]`가 씌워져 배지 0으로 기본 반입에 포함됐다. → ① preserve 시 **판정된 모든 항목**을 기록(경고 없으면 `[]` 명시) ② 복구 시 사이드카에 **키가 있으면**(빈 배열 포함) 보존값, **키가 없으면** `_item_warnings`로 재계산(그래서 원본이 없으면 최소 `match_unavailable`) — 이를 위해 복구 경로도 대조기를 준비한다. 회귀 테스트 2건 추가("최초 error → 복구 시 살아난 항목에 배지 부착", "경고 0 항목도 `[]`로 기록·복원") → **`pytest tests/` 218 passed**.
  - **범위 밖 발견(2절 codex 어댑터 — 보고만)**: 같은 원본으로 `engine=codex-cli` 실호출 시 codex가 변환 대신 "원본 자료를 보내주시면 변환하겠습니다" 류 대화 응답을 반환해 `invalid_output`으로 실패했다(프롬프트에는 추출 텍스트가 정상 삽입됨을 별도 확인). 게이트 로직과 무관한 codex 어댑터/프롬프트 전달 문제로, 2절·5절(codex 실호출 스모크)에서 재현·조치 필요.

> **2026-07-28 프론트 선반영**: preview `warnings`/`summary.warning` 렌더(§4.17⑤·⑥ 계약)는 `pages/Import.tsx`에 타입·UI 선구현 완료(필드 부재 시 경고 없음으로 우아하게 동작) — `solved_answer`·`fabrication_suspect`는 기본 반입 제외(체크 해제), `match_unavailable`은 배지+상단 안내 1줄(기본 포함 유지). **백엔드가 이 필드를 채워 2026-07-28 연결 완료** — 서버는 warnings 신호만 싣고 "기본 반입 제외"는 프론트가 처리한다(이중 구현 없음, 필드명·타입 대조 완료: `ImportItem.warnings`·`ImportSummary.warning`).

### 4. 온보딩·설정 UI (S8 확장)

- [x] S8 LLM 설정: 엔진 카드 2개 고정 → **레지스트리 목록 렌더**(Claude CLI / Claude API / Codex CLI). 우선순위를 드래그 또는 순서 선택으로(설계 §4.17 확정안 따름) — **2026-07-28 프론트 구현 완료**: `LlmEngineSection.tsx`가 `status.engines[]`를 렌더(필드 유무로 CLI형/API형 결정, 하드코딩 2장 제거) + ▲▼ 버튼으로 `llm.priority`(엔진 id 배열) 재정렬. 백엔드 `GET /api/llm/status`(`schemas/llm.py EngineStatus/LlmStatus`)·`llm_engine_service.normalize_priority` 배열 저장은 1절에서 병렬 구현·머지 완료 — 필드명·타입 대조 완료(일치), 실통합(dev 서버 동시 기동) 스모크는 아직 미수행.
- [x] **Codex 온보딩 마법사**: [설치] — GitHub 릴리스에서 Windows x64 단일 바이너리 자동 다운로드(PoC `setup_codex.py` 로직 이식, 앱 관리 폴더에 격리 설치·PATH 불변) → [로그인] — **전역 자격증명 감지 시 건너뛰기**(PoC 실측: `~/.codex` 공유), 없으면 `codex login` 실행 안내(브라우저 OAuth) + [다시 확인](F34 CLI 카드 패턴 재사용) → [진단] — 버전·로그인 상태 표시 — **2026-07-28 프론트 구현 완료**: `CliDiagnosis`가 `engine.installable && !engine.installed`일 때 [설치] 버튼(`POST /api/llm/engines/{id}/install`, `useInstallEngine`)을 먼저 보여주고, 이후 로그인 유무에 따라 안내+[다시 확인] 또는 정상 표시로 분기(engine.id 하드코딩 없이 installable 플래그 기준). 백엔드 `routers/llm.py`의 같은 엔드포인트와 응답 필드(`installed`·`version`) 대조 완료.
- [x] 프라이버시 고지(PoC 검증 E2): codex 실행 시 변환 원문이 사용자 PC의 전역 `~/.codex` 로그·세션 DB에 남는다 — 온보딩 마지막 단계에 1줄 고지(비활성 설정이 공식 지원되면 적용 검토) — `CliDiagnosis`에서 `engine.installable` 카드 하단에 고정 노출.
- [x] 색상 하드코딩 금지(토큰) · 매뉴얼(F39) "Codex로 시작하기" 섹션 추가 — `docs/manual/user-manual.html` §15에 반영(엔진 3종 표 갱신 포함).
- [x] **§4.17③ 폴백 이항 잔재 제거(프론트, 2026-07-28 후속 지시로 이 단계 범위에 포함)**: `LlmErrorInfo.tsx`의 "API로 재시도" 하드코딩·`onRetryWithApi:() => void` 시그니처를 `onRetry:(engineId: string) => void`로 교체, `error_info.fallback_engine`(신규, 백엔드 `schemas/convert.py ErrorInfo.fallback_engine`과 필드명·타입 대조 완료)로 재시도 대상 엔진을 동적 결정하고 버튼 라벨은 `status.engines[]`에서 `label`을 찾아 완성(못 찾으면 id 원문 — 하드코딩 이름 금지). 소비처 `ImportQueue.tsx`(`onRetryApi(entryId, engineId?)`)·`Import.tsx`(`queue.retryEntry(id, engineId)`)·`RegenerateJobPanel.tsx`(`handleRetry(engineId)`, 기존 `engine:'api'` 리터럴 제거)·`useConvertQueue.ts`(`retryEntry`는 원래도 `engine` 매개변수를 받고 있어 시그니처 변경 없음, 주석만 갱신) 전부 갱신. `FetchImportWizard.tsx`의 수동 엔진 선택 드롭다운(`ENGINE_OPTIONS`)도 하드코딩 3종(`auto`/`cli`/`api`) 고정에서 `status.engines[]` 기반 동적 목록(`useEngineOptions`)으로 교체(현재 auto+3엔진, 등록 엔진 변경에 프론트 코드 변경 불필요). **과도기 규칙(설계 §4.17③에 명시 없음 — 프론트 결정, 보고 사항)**: `fallback_engine` 필드가 없는 응답에서는 기존 legacy `'api'` 폴백 동작을 그대로 유지한다(`LlmErrorInfoView`의 `retryEngineId = fallbackId ?? 'api'`). 매뉴얼(§15·방법 B 카드·트러블슈팅)의 "[API로 재시도]" 고정 문구도 "[◯◯로 재시도](다음 차례 엔진 이름)"로 갱신. `npm run build` 재확인 통과.
- [x] **stage-15 Opus 검토 결함 수정(2026-07-28)**: ① [중요·DoD 4] `LlmLimitBanner.tsx`가 `claude-api` id를 하드코딩해 무료 구독 엔진(codex-cli)이 있어도 유료 API 등록을 권유하던 결함 — `status.priority`·`status.engines`에서 **priority[0](한도에 걸렸다고 간주 — `limit` 계약은 {kind,resets_at}뿐이라 엔진 id를 직접 알 수 없음, 프론트 결정)을 제외한 다음 available 엔진**을 우선순위 순으로 찾아 라벨을 동적으로 안내("『{label}』로 계속 변환할 수 있습니다"), 없으면 특정 엔진을 지목하지 않는 일반 안내로 교체. ② [경미·문서] 매뉴얼에 신뢰 게이트 배지 3종(§4.17⑤·⑥) 설명 누락 — `docs/manual/user-manual.html` §5(반입)에 "미리보기 경고 배지 — 자동 변환 결과만" 소절 신설(배지별 뜻·기본 포함/제외 표 + 방법 A는 비적용이라는 점 명시). `npm run build` 재확인 통과.

### 5. 테스트·검증

- [x] `services/sm2.py` 외에는 실행 스모크 원칙(불변 규칙 7) — 단 **신뢰 게이트(3절)는 단위 테스트 필수**(반입 정확성 직결, sm2와 같은 급의 핵심 로직으로 취급) — 신뢰 게이트 34건 + 검토 후속 7건, 레지스트리 32건 신설. 전체 **218 passed**(사전 144 → 218).
- [x] 레지스트리 회귀 스모크(1절) + codex 실호출 스모크 1회(구독 사용량 소모 최소화 — 스모크급 입력) — status/install/priority 라운드트립·legacy `engine:"cli"` 수용 스모크(1절 노트) + **codex 실호출 스모크 1회 성공**(`.CMD` 심 argv 훼손 결함 수정(stdin 전달) 후: 3문항 원본 → done 28.8초 → preview ok 3·창작 0·정답 없는 항목 concept 강등, 2절 노트).
- [x] stage-reviewer(Opus) 검토: DoD + §8.2 개정 정합 + 이항 잔재 검색 — **2026-07-28 1차 조건부 통과**(치명 0·중요 4·경미 9): 중요 4건(복구 시 warnings 강등·범위 밖 숫자 answer 계약 이탈·한도 배너 claude-api 하드코딩·루트 convert_tmp 미ignore) 전건 수정 → 2차 재검토에서 수정 #1이 만든 인접 결함 1건(최초 error 항목이 복구 후 배지 0으로 부활) 적발 → 사이드카 의미론 교정("키 있음(빈 배열 포함)=최초 판정 정본 / 키 없음=미판정→재계산") 후 3차 확인 **해소**. **최종 판정: 조건부 통과 — 치명 0·중요 0, 218 passed.** 잔여 = 차단성 없는 경미 8건(프론트 legacy 'api' 기본값 2건·invoke else=claude-api 폴스루·엔진 파라미터 검증 비대칭·설치 실패 원문 노출·action 문구 미완성·카드 id 분기 1건·codex 파이프 미close·다운로드 바이너리 무결성 미검증 — 수정 여부는 사용자 결정) + DoD 1 사용자 확인 1건(Claude 미설치 PC에서 codex 단독 완주).

### 6. 문서

- [x] 계획서 §8.2(규격)·§13(엔진 비교표에 Codex 열)·R7 갱신, 설계 §4.17·S8 확정본 반영 — §8.2 v1.1(G3, plan v0.22)·§13 D열(Codex CLI)·R7 신뢰 게이트 보강 명세 반영 완료(2026-07-28).
- [x] 이 문서 체크박스 갱신(불변 규칙 10) · CLAUDE.md 문서 지도 확인 — CLAUDE.md의 stage 15 상태를 "게이트 통과·구현 완료"로 갱신(2026-07-28).

## DoD (완료 정의)

1. Claude 구독 없이 **ChatGPT 구독만으로** 파일 반입→변환→미리보기→반입이 완주된다 (Codex 온보딩은 설치~진단까지 마법사 안에서 종결, 터미널 개입 0).
2. 기존 Claude cli/api 사용자 회귀 0 (우선순위·폴백·한도 기억·429 안내 동작 동일).
3. **원본에 없는 지문·보기·정답이 경고 없이 반입되는 경로 0** — `answer_source:solved`·`fabrication_suspect`·"대조 불가"가 preview에서 구분 표시되고 기본 제외된다 (전 엔진 공통).
4. 코드베이스에 엔진 이항 분기(`engine == "cli"` 류) 잔재 0건.
5. DDL 변경 0건·Alembic 0건 (설계 §4.17에서 재확인 — 어긋나면 착수 중단 후 보고).

## 이 단계에서 하지 않는 것

- **멀티유저·호스팅·앱 패키징** — 별도 로드맵 결정(패키징은 온보딩의 나머지 절반이지만 별도 F로 분리).
- **OpenAI API 키 방식 엔진** — BYO-구독(Codex CLI)이 원칙. 키 방식은 실수요 확인 후 별건.
- **Gemini 등 3사 이상 확장** — 레지스트리가 자리를 만들 뿐, 어댑터 추가는 각각 별건으로 계획 확정 후.
- **프롬프트 벤더별 분기 튜닝** — convert.md는 벤더 중립 단일본 유지(품질 문제는 신뢰 게이트로 잡는다. 분기가 필요하다는 실측이 나오면 계획서에 먼저 확정).
- **사설 사이트 수집 부활** — 큐넷 공식 API 외 수집 경로 금지(qnet-only 정책, F35-2 제거 이력 참조).
