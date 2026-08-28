# Stage 42 — 반입 파이프라인 결함 4건: Codex 설치 SSL · 분할 반입 정리·병합 · 검토 본문 열람·편집 · LLM 분류 누락 (v2.0.x 후속 · 버그 최우선)

> 상태: **구현·검토 완료 (2026-08-29) — Opus 1차 반려(치명 1·중요 2·경미 10) → 전건 수정 → 재검토 통과(잔여 경미 ⓐⓑ도 수정). 잔여 = DoD 8(사용자 실사용 1회 "치명 없음")**. 커밋 `6120764`(B1)·`f64fa6a`(구현)·`8f9314b`(검토 수정) · 브랜치 `stage-42-import-bugfix`.
> (편성 시 상태 — 이력: 편성 완료 · 구현 착수 (2026-08-28 생성 — 사용자 지시 "버그 발견 최우선 진행")).
> 진척은 이 줄 + 말미 "완료 기록"이 정본.
> (생성 경위: 2026-08-28 사용자 실사용 결함 보고 4건. 사용자 지시(2026-08-24) "중간에 추가 수정사항이 나오면 그
> 수정이 먼저"에 따라 stage-41(흐름형 다단)보다 **먼저 착수**. 종전 "stage-42 = 구 편집기 퇴역(조건부)"는
> **stage-43으로 번호 이월**(CLAUDE.md·stage-40 머리말의 "stage-42" 언급은 이 이월을 뜻한다).)
> 범위: 반입 파이프라인(`/import` · 분할 위저드 · LLM 작업 센터 · Codex 설치)의 **결함 수정 + 결함 해소에 꼭
> 필요한 최소 계약 추가**(신규 엔드포인트 2 · 응답 필드 추가 · 요청 필드 추가). 에디터 v2·노트·학습 루프
> 무접촉. **구 편집기 코드(`DocEditor` 소스 폼·`MarkdownFieldEditor`·`EditablePreview`) 무접촉**(stage-36 규약
> A — 퇴역 대상이므로 검토 단계 편집 UI에 재사용하지 않는다).
> **DDL 0 · Alembic 0 · settings 키 0 · 신규 npm/파이썬 의존 0(certifi는 이미 설치됨) · LLM 프롬프트 변경 있음
> (분류 지시 문구·taxonomy 첨부 — 케이스북 회귀 재검증 대상 아님, 형식 변경 없음)**.
> 정본: 설계 추기 = api **§4.3(미리보기 항목 본문·병합·override) · §4.24(잡 삭제) · §4.25(조각 라벨·경로 규칙
> 정정) · §4.11(분류 지시 우선순위)** — 구현 후 실측 반영(본 문서 말미 "설계 추기 초안"이 원문).

## 결함 진단 요약 (2026-08-28 · Explore 3건 + 메인 대화 실측)

| # | 보고 | 원인(실측) | 판정 |
|---|---|---|---|
| B1 | [Codex 설치] 시 `URLError … CERTIFICATE_VERIFY_FAILED unable to get local issuer certificate` | 임베디드 파이썬의 OpenSSL은 Windows AIA 중간 인증서 자동 조회를 못 한다 — OS 저장소에 GitHub 체인이 캐시돼 있지 않은 시점이면 간헐 실패. `codex_adapter`가 기본 컨텍스트로 `urlopen`. certifi는 이미 설치돼 있으나 미사용 | **결함 — 메인 대화에서 선수정 완료**(`net_safety.ssl_context()` = OS 저장소 + certifi 번들 합집합 · codex 설치·URL 반입·웹 임베드 3곳 적용) |
| B2-1 | URL 한 번에 반입 실패 → [분할 반입] 선택 시 **LLM 작업 센터의 실패 잡이 남는다** | 잡 삭제 API 부재(`routers/llm.py` — jobs/cancel/pause/resume뿐) · `cancel_job`은 종료 잡 409 · 실패 잡은 TTL 1시간까지 잔존. ImportQueue 쪽 앵커(`split_in_progress`)는 §5.15 계약대로 동작 | **결함 — 종료 잡 삭제 계약 추가** |
| B2-2 | 분할 후 LLM 작업이 끝나면 **조각 데이터가 한곳에 합쳐져야 하는데 안 된다** | (ⅰ) 설계 §4.25에 병합 단계가 없다(조각 = 독립 convert 잡 → 독립 preview → 독립 commit). (ⅱ) 유일한 묶음 수단인 `category_path`를 위저드가 **조각마다 다른 라벨**로 기본 세팅(`pathSuffix: c.label`) — URL 반입은 구조 미탐지 → 균등 분할 라벨 `"… 임시 균등 1/2"`의 `/`가 분류 2단으로 쪼개져 조각마다 엉뚱한 분류 생성. (ⅲ) 원 항목의 `categoryPath`가 위저드에 전달되지 않음 | **결함(ⅱ·ⅲ) + 계약 공백(ⅰ) — 조각 미리보기 병합 엔드포인트 추가** |
| B3 | 검토 단계에서 **문서를 직접 열어 확인·검토·편집할 수 없다** | `PreviewItem`에 본문(content/choices/answer/explanation)이 없다 — 설계 §5 ②가 "배지 표"만 규정한 설계 공백. 서버 `_PREVIEW_CACHE[..]["items"][i]["doc"]`에 정규화 본문이 이미 있으나 응답에 싣지 않음. 편집 수단·계약 없음 | **설계 공백 — 본문 응답 + 항목별 편집(override) 계약 추가** |
| B4 | LLM 반입 시 **대분류·중분류 분류가 안 되는 경우** 발생 | S1 `suggest_categories` 누락 시 항목 정상 표시·분류 블록 자체 미렌더 → 무분류 반입(가장 유력). S2 고정 경로 지시와 taxonomy "회차+과목 2경로" 규칙이 프롬프트 안에서 충돌. S3 `prompts/taxonomy.md`가 "단일 출처"로 선언돼 있으나 **프롬프트에 첨부되지 않음**. S4 `>`·`＞`·`\` 구분자 경로가 한 덩어리 분류명으로 생성. S5 `_find_child` 정확 일치(공백·NFC·대소문자)로 형제 중복 생성. S6 LLM 경로에 깊이·길이 검증 부재. S7 `suggest_categories` 형식 오류가 **항목 전체 error** → 반입 누락. S8 컨테이너 노드 제안이 기본 체크. S12 안내 문구 "해제·수정" 중 수정 UI 부재 | **결함 다발 — 항목별 최소 수정** |

## 착수 전 결정 (메인 대화 위임 판정 — 사용자 미답 = 위임 · 재론 여지)

| # | 결정 | 판정 |
|---|---|---|
| ① | 실패 잡 제거 시점 | **[분할 반입] → `POST /api/import/split` 성공 직후** 원 convert 잡을 `DELETE /api/llm/jobs/{id}`로 제거(종료 잡만 삭제 가능 — running/queued = 409). 작업 센터 종료 잡 카드에도 **[목록에서 지우기]** 추가(일반화). ImportQueue의 `split_in_progress` 앵커(§5.15)는 **유지**(사용자 요청으로 만든 기능 — 조각 투입 시 제거되는 현행 그대로) |
| ② | "한곳에 합치기"의 의미 | ⓐ 분류 경로 통일(기본) + ⓑ **미리보기 병합** 둘 다. ⓐ = 위저드 조각 접미 기본값 **빈 문자열**(모든 조각이 공통 경로 하나로) · 원 항목 `categoryPath`를 공통 경로 초기값으로 전달 · 라벨의 `/`는 서버·프론트 양쪽에서 제거. ⓑ = `POST /api/import/preview/merge {preview_ids}` → 새 preview 1개(항목 재인덱스·경고 승계·보존) — ImportQueue가 같은 `splitId` 조각을 묶어 **모든 조각이 종료되면 [합쳐서 검토]** 제공. 조각별 개별 [검토]도 그대로 가능(병합은 선택) |
| ③ | 검토 단계 편집 수단 | 구 편집기(`MarkdownFieldEditor`) 재사용 **금지**(퇴역 대상). **항목 접기/펼치기 [본문 보기] = 공용 `MarkdownView` 읽기 + [편집] = 제목 `input` · 본문/정답/해설 `textarea`(마크다운 원문)**. 저장은 클라이언트 `decisions`에 `override`로 보관 → commit `ImportDecision.override?`로 전송. 선택지(`choices`) 편집은 **제외**(구조 편집은 반입 후 문서 편집기에서) |
| ④ | 분류 제안 없음/오류 처리 | 제안이 비어도 분류 블록을 **항상 렌더**("분류 제안 없음" + 경로 직접 입력) · `suggest_categories` 형식 오류 = 항목 `warning`(`'category_malformed'`)으로 강등(문서 누락 금지) · 컨테이너 제안은 **기본 미체크** · LLM 경로는 사용자 경로와 **같은 정규화기**(구분자 통일·5단·60자)로 통과, 실패분만 버림 |
| ⑤ | taxonomy 첨부 | `load_convert_prompt_with_casebook()`에 `prompts/taxonomy.md`(3.3KB) 전문을 "## 부속 분류 정책" 절로 첨부(케이스북과 같은 방식). 고정 경로 지시 문구에 **"§분류 정책의 2경로 규칙보다 이 지시가 우선"** 명기 |

## 체크리스트

### 백엔드 (`backend-dev` · sonnet)

- [x] **B1** `services/net_safety.py` `ssl_context()`·`https_handler()` 신설 → `codex_adapter`(릴리스 API·자산 다운로드) · `convert_service._download_source_url` · `web_embed_service.fetch_preview` 적용 (2026-08-28 메인 대화 선수정 · 테스트 web_embed 13·engine_controls 34 통과)
- [x] **B2-1** `DELETE /api/llm/jobs/{job_id}` (`routers/llm.py`) → `convert_service.dismiss_job(job_id)`: `_JOBS_LOCK` 아래 **종료(done·error·cancelled) 잡만** pop → `{status:'dismissed'}` · running/queued = 409 CONFLICT("진행 중인 작업은 취소 후 지울 수 있습니다") · 미존재 = 404
- [x] **B2-1** `_job_ref`(convert) 에 `split_id` 추가(`{"preview_id", "split_id"}`) — 순수 추가
- [x] **B2-2** `split_service` 조각 라벨에서 `/` 제거: `f'{label} ({idx+1}/{pieces})'` → `f'{label} ({idx+1}-{pieces})'`, 균등 분할 라벨 동일 · `_normalize_chunks`·LLM 정제 라벨도 `/` → `-` 치환(라벨은 분류 접미 초안이므로 경로 구분자를 포함하면 안 된다)
- [x] **B2-2** `enqueue_split`: `category_paths` 전부를 잡 등록 **루프 이전에** `normalize_category_path`로 검증(부분 등록 후 422 방지)
- [x] **B2-2** `POST /api/import/preview/merge` (`routers/imports.py`) body `{preview_ids: [str,…]}`(2개 이상 · 각각 `_PREVIEW_CACHE` 존재 또는 보존본 복구 가능) → 각 preview의 정규화 문서(`items[i]["doc"]`)를 **주어진 순서로 연결**한 `{"documents":[…]}`로 `create_preview(preserve=True, warnings_override=<재인덱스한 조각 경고>, source_filename="<첫 조각 파일명> (분할 병합 N조각)")` 호출 → `PreviewResponse` 그대로 응답. 누락·만료 preview = 404(어느 id인지 detail). 원 조각 preview는 삭제하지 않는다(TTL 자연 만료)
- [x] **B3** `schemas/import_schema.py` `PreviewItem`에 `content: Optional[str]`, `choices: Optional[list]`, `answer: Optional[str]`, `explanation: Optional[str]` (모두 기본 None) → `create_preview`에서 `norm`으로 채움(정규화 문서의 키 이름은 `import_service` 정규화 결과 기준 — 없는 키는 None)
- [x] **B3** `ImportDecision.override: Optional[ItemOverride]` (`title?`, `content?`, `answer?`, `explanation?` — 모두 Optional str) → `commit_import`에서 해당 항목 `doc`에 **얕은 덮어쓰기 후** 기존 new/merge 경로 진행. 빈 문자열 title·content는 422 · merge 액션은 본문 불변(override 미반영 — 프론트가 [편집] 숨김) · 테스트 `tests/test_import_override.py` 5건(검토 1차 후 추가)
- [x] **B4-S4/S6** `convert_service.normalize_category_path`의 본체를 **관대 정규화기**로 분리(`normalize_category_path_lenient(path) -> Optional[str]`: `>`·`＞`·`»`·`≫`·`\`·`::` → `/` 치환 → 세그먼트 strip·NFC → 빈 세그먼트 제거 → 5단·60자 초과면 None) — 기존 엄격 함수는 동작 불변(사용자 입력 422 유지)
- [x] **B4-S7/S1** `import_service._validate_item`: `suggest_categories`가 list가 아니거나 원소가 str이 아니면 **항목 error가 아니라** str 원소만 회수(dict면 `path` 키) + warning `'category_malformed'`; 각 경로는 관대 정규화기 통과(None이면 버림). 제안이 0개면 warning `'no_category'`
- [x] **B4-S5** `import_service._find_child`: 형제 노드를 파이썬 측 NFC·strip·`casefold` 전수 비교(SQLite `lower()`는 비ASCII 폴딩을 보장하지 않아 `func.lower` 대신 — 구현 실측 정정 · `_path_names`는 무변경) — 생성 시에는 원문(정규화·strip) 그대로 저장. 커밋 `_apply_categories`의 문자열 경로도 관대 정규화기 통과
- [x] **B4-S2/S3** `improve_service.load_convert_prompt_with_casebook`: `prompts/taxonomy.md` 첨부("## 부속 분류 정책"). `convert_service._category_directive_lines`: "이 지시가 분류 정책의 2경로 규칙보다 우선한다 — 다른 경로를 추가하지 말 것" 1줄 추가
- [x] 테스트: `tests/test_import_categories_lenient.py`(신규 — S4·S5·S7·no_category 경고) · `tests/test_preview_merge.py`(신규 — 2 preview 병합 재인덱스·경고 승계·404) · `tests/test_job_center.py`에 dismiss 3케이스 추가 · 기존 전체 `run-tests.ps1` 통과(577 passed · applied_exam 2건은 Claude CLI 미탐지 환경 사유 — 회귀 아님)

### 프론트 (`frontend-dev` · sonnet)

- [x] **B2-1** `api/llm.ts` `useDismissLlmJob()`(DELETE `/llm/jobs/{id}`) → `Import.tsx` `onSplitStarted`(split 시작 성공 시) 앵커 항목의 `entry.jobId`가 있으면 호출(실패는 무시·콘솔 경고만, 성공 시 훅이 `llmJobsKey` 무효화). `JobCenterPanel.tsx` 종료 잡(done·error·cancelled) 카드에 [목록에서 지우기] 버튼 추가
- [x] **B2-2** `SplitImportWizard.tsx`: `initialCommonPath?: string | null` prop(공통 경로 초기값) · 조각 `pathSuffix` 기본값 **`''`** · `mergeWithNext`는 `a.pathSuffix` 유지 · 접미(`updateSuffix`)·병합 라벨의 `/`는 `-`로 치환(`sanitizePathSuffix`). `Import.tsx` `handleSplitImport`에서 `item.entry.categoryPath`를 `splitInitialCommonPath`로 저장해 전달
- [x] **B2-2** `useConvertQueue.addJobs`: 생성 항목에 `splitId`(인자)·`splitTotal: jobs.length` 보존 · 앵커 제거는 `sourceKind !== 'split'`만 대상. `mergeSplitEntries(entryIds, merged)` 신규(병합 결과를 새 항목 1개로 편입 + 병합분 제거, 새 entry id 반환). `ImportQueue.tsx`: 같은 `splitId` 조각을 그룹 헤더("분할 조각 k/N 검토 대기")로 묶고 모든 조각이 종료(ready·error)이고 ready≥2면 [합쳐서 검토] → `useMergePreviews()` → `mergeSplitEntries` + 기존 `onReview` 경로로 곧장 검토 진입(실패 조각은 그룹에 남김, 병합 실패는 그룹별 인라인 에러). `jobId:null && previewId` 항목은 기존 상태 산출 순서상 이미 `ready`로 판정됨을 확인(주석 보강)
- [x] **B3** `api/types.ts` `ImportItem`에 `content?/choices?/answer?/explanation?` · `ImportItemOverride` · `ImportDecision.override?`. `Import.tsx` `ItemRow`: [본문 보기]/[본문 접기] 토글(접힘 기본) → `MarkdownView`로 본문·선택지(번호 목록·`choiceLabel` 방어적 해석)·정답·해설 렌더 · [편집] 토글 → 제목 `input` + 본문/정답/해설 `textarea`(정답·해설은 `type`이 `question`/`past_question`일 때만) · 변경분은 `decisions[index].override`에 보관(원본과 동일하면 필드 생략) · 편집된 항목은 "편집됨" 배지 · commit 요청에 `override` 포함(미편집 항목은 생략). 색상은 토큰만
- [x] **B4-S1/S8/S12** `Import.tsx`: 분류 블록 **항상 렌더**(제안 0 = "분류 제안 없음 — 아래에 경로를 입력하면 생성·연결합니다") + 항목별 `CategoryPathField` 재사용으로 **경로 추가**(추가분은 "직접 추가" 칩 + 개별 취소) → `approvedCategoryIds`에 문자열로 추가. `buildInitialDecisions`에서 `container === true` 제안은 기본 미체크. `WARNING_BADGE`에 `'no_category'`·`'category_malformed'` 문구 추가. `CategoryPathField.tsx:88` 안내 문구를 "해제·추가"로 정정
- [x] `npm run build` 성공(타입 에러 0) · 메인 청크 raw +9.2KB/gzip +2.1KB — 10KB(min raw 기준) 한도 내

### 문서·검증 (메인 대화)

- [x] 설계 api §4.3·§4.11·§4.24·§4.25 추기(말미 초안 반영 + 검토 1차 ⑥⑦ 문장) · screens §5.9 ①(그룹 헤더·[합쳐서 검토])·②(본문·편집) 문장 추가
- [x] `docs/manual/user-manual.html` 반입 절: 본문 보기·편집, 분할 [합쳐서 검토], 작업 센터 [목록에서 지우기] 반영
- [x] `scripts/invariant-scan.ps1` PASS · `run-tests.ps1` 전체 통과(582 passed · applied_exam 2건 환경 사유) · `stage-reviewer`(Opus) 1차 반려(치명 1·중요 2·경미 10) → 전건 수정 → 재검토(아래 완료 기록)
- [x] CLAUDE.md: stage-42 = 본 단계 · 구 편집기 퇴역 = stage-43으로 이월 표기

## DoD

1. [Codex 설치]가 인증서 오류 없이 완료(또는 네트워크 외 사유의 명확한 메시지).
2. URL 반입 too_large → [분할 반입] 직후 작업 센터에 원 실패 잡이 **없다**; 작업 센터 종료 잡에 [목록에서 지우기]가 있다.
3. 분할 조각을 기본값으로 투입하면 모든 조각의 제안 분류가 **원 항목의 경로 하나**로 같다; 라벨에 `/`가 들어가지 않는다.
4. 조각이 모두 끝나면 [합쳐서 검토]로 **하나의 미리보기**(항목 재인덱스, 경고 유지)를 검토·반입할 수 있다.
5. 검토 단계에서 각 항목의 본문·선택지·정답·해설을 펼쳐 볼 수 있고, 제목·본문·정답·해설을 편집해 반입하면 편집본이 저장된다.
6. `suggest_categories`가 비었거나 형식이 틀린 항목이 **반입에서 누락되지 않고** 경고 배지 + 경로 직접 입력으로 분류할 수 있다; `>` 구분 경로가 계층으로 생성된다; 공백/대소문자만 다른 기존 분류에 중복 형제가 생기지 않는다.
7. 기존 pytest 전체·invariant-scan PASS · 빌드 성공.
8. 사용자 실사용 1회 "치명 없음".

## 이 단계에서 하지 않는 것

- 분류 트리 `UNIQUE(parent_id, name)` 제약(DDL·Alembic — v2.x 편성 시 판단) · 기존 중복 분류 정리 도구.
- 선택지(`choices`) 구조 편집 · 검토 단계에서 editor2(BlockNote) 사용.
- 분할 조각 문서와 `sources/` 원본 연결(stage-23 (C) 공백 — 그대로).
- 잡 삭제의 서버 영속화(잡은 인메모리 — §4.24 ① 계약 그대로).
- `source_detail` 회차 추론 정정(S13) · `_apply_categories` 미사용 인자 정리(S11 — 무해).

## 설계 추기 초안 (구현 후 api.md에 옮긴다)

- **§4.3** `PreviewItem` += `content?·choices?·answer?·explanation?`(정규화 본문 — 검토 단계 열람용, 기본 null). `ImportDecision` += `override?: {title?, content?, answer?, explanation?}`(검토 단계 편집분 — commit에서 정규화 문서에 얕은 덮어쓰기 후 new/merge 진행 · title 빈 문자열 422). **`POST /api/import/preview/merge`** `{preview_ids:[…]}`(≥2) → 새 `PreviewResponse`(문서 순서 연결·재인덱스·경고 승계·보존 O · 원 preview 불변 · 누락 404). item `warnings` 값 += `'no_category'`·`'category_malformed'`(배지·안내만).
- **§4.11** `category_path` 고정 지시는 taxonomy 2경로 규칙보다 **우선**한다고 프롬프트에 명기. LLM 제안 경로는 사용자 경로와 같은 규칙(5단·60자)으로 **관대 정규화**(`>`·`＞`·`»`·`\`·`::` → `/`, NFC·strip) — 위반분은 버리고 항목 error로 만들지 않는다. `prompts/taxonomy.md`는 convert 프롬프트에 첨부된다.
- **§4.24** `DELETE /api/llm/jobs/{job_id}` — 종료 잡만 목록에서 제거(`{status:'dismissed'}`) · running/queued 409 · 미존재 404. [분할 반입] 시작 시 프론트가 원 실패 잡에 호출. `_job_ref`(convert) += `split_id?`.
- **§4.25** 조각 라벨에 `/` 금지(`n-m` 표기) · 위저드 조각 접미 기본 빈값(공통 경로 하나로 모임) · 원 항목 `categoryPath` = 공통 경로 초기값 · `enqueue` `category_paths` 선검증 · 조각 preview 병합은 §4.3 merge 사용(ImportQueue [합쳐서 검토]).

## 완료 기록

- **2026-08-28** 편성·B1 선수정(`6120764`) → 백엔드(sonnet)·프론트(sonnet) 병렬 구현(`f64fa6a`) — 백엔드 577 passed · 빌드 성공(메인 청크 +9.2KB raw/+2.1KB gzip) · invariant PASS.
- **2026-08-29** stage-reviewer(Opus) 1차 **반려**: 치명 ①(조각 항목에 splitId를 심자 `split_in_progress` 판정이 조각까지 삼켜 진행바·[취소] 소실 + [분할안 열기] 오클릭 시 조각 잡 중복 등록) · 중요 ②(딥링크 앵커가 조각을 앵커로 오인) ③([경로 추가] 후 입력 미초기화) · 경미 ④~⑬. **전건 수정**: ① `useConvertQueue` 상태 판정에 `sourceKind !== 'split'` 조건 · ② 앵커 탐색 동일 조건 · ③ `CategoryPathField` key 리마운트 · ④ merge 항목 [편집] 숨김 + §4.3 명기 · ⑤ error 항목 본문 토글 숨김 · ⑥ §4.11 사용자 경로 관대 폐기 명기 · ⑦ §4.3 병합 제외/422/409/sources 미연결 문장 · ⑧ screens §5.9 배치 정정 · ⑨ 체크리스트 실측 정정 · ⑩ 체크박스 · ⑪ `fetchers/registry.py` https_handler 적용(4번째 아웃바운드 경로) · ⑫ 조각 항목 `categoryPath` 보존(위저드 → addJobs) · ⑬ content 빈 문자열 override 422. 추가: `tests/test_import_override.py` 5건. 재검증 582 passed · 빌드 성공 · invariant PASS. **재검토(Opus) 통과** — 잔여 경미 ⓐ(빈 본문 저장 선차단) ⓑ(merge 전환 시 편집됨 배지 잔존)도 같은 날 수정.
