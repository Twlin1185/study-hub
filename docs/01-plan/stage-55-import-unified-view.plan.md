# Stage 55 — 반입 화면 통합 1단계: 소스 선택 1동작 + Stepper 1개 + 큐넷 키 인라인 등록 + 드로어 가산 (FB-28 1단계 · FB-29 · FB-30 드로어분) (v2.0.x · 사소)

> 상태: **구현·검토 완료 — 발행 대기(DoD 5 사용자 실사용·폰 실기기 회신 치명 0 → `VERSION` 2.03.2 + CLAUDE.md 버전 줄)**(2026-11-08 · 편성 커밋 `d729a88` · 구현 커밋 `e5fac91` · 검토 반영+완료 절차 = 후속 커밋 1개 · **Opus 검토 조건부 통과 → 치명 0 · 중요 0 · 경미 4 전건 반영** + 의심 1건 실측 재현 후 보강 · **브라우저 실측 V-2 ⓐ~ⓙ 통과**(ⓖ는 빈 큐 환경이라 코드 검토 갈음 · 임시 포트 8765 · 빈 DB · 390px iframe 에뮬 — 종료·리스너 부재 확인) · DoD 1~4 충족 · 문서 묶음 D-1~D-5 이행 — §7). 편성 2026-11-08 · 번호 55 · **사용자 확정 대기 0** — UX 선택 3건(§2 A·B·D)은 권고안으로 확정 + 대안 표(**사용자 이견 시 변경** — 실사용 회신 시 해당 규약만 교체). stage-54(캡처 · 편성 보류)와 무접촉·독립.
> **버전 영향: 사소**(CHANGELOG 머리 규약 ③ — "사소 = 버그픽스·다듬기·정비"): 기존 `/import`·`/settings`(무변)·내비 표면 **다듬기** · **새 화면 0 · 새 라우트 0 · 신규 API 0(`POST /api/fetch/qnet-key` 재사용) · DDL 0 · 신규 의존 0** · 기능 퇴역 0(진입 모드 6종·`?mode=` 딥링크 전부 유지 — 배치·문구만 변경). → 산출 버전 = 규약 ② PP+1 = **v2.03.2 예정**. 마스터 §14 M 행 **추가 없음**(사소 — stage-index가 담당) · §5 F 행 추가 없음.
> 생성 경위: `backlog.md` §1 **FB-28**(별지 §13 514행 — "하나의 반입 프로세스를 하나로 묶어서 한번에 볼 수 있도록" · 2026-11-08 전수 점검 · **1단계만** — 2단계 `import_runs`는 핵심·DDL 1이라 이 stage 제외) + **FB-29**(별지 §13 515행 — 큐넷 서비스키 등록 위치 · 권고 ⓐ 인라인 등록 채택) + **FB-30 드로어분**(별지 §13 516행 — 드로어에 제안함·설정 가산 · 플래시카드 진입·복습 3표면 재론은 제외). 세 건 모두 사소 · 같은 "찾기 어려움" 계열 → 1 stage 동승. FB-31은 감시 유지(무접촉).
> 정본 포인터: 화면 계약 = screens **§5.9 `[S55]` 블록**(진입 구조·Stepper·엔진 접기·문구·대기열 요약·인라인 키 등록) + §5.11 큐넷 카드 1구 + §5 도입부 드로어 1구 + §5.1 빈 상태 문구 1구(**Design v1.70**) · API 계약 = api **무접촉**(§4.13 `fetch/qnet-key` 재사용) · 불변 규칙 5(토큰만)·6(DDL 0)·8(에러 §3 — 기존 응답 그대로)·9 · R7(미리보기 승인 게이트 불변) · R37(엔트리 청크 Δ 기록) · 발행 절차 = CHANGELOG 머리 규약 ⑤.

## 1. 범위 (프론트 전용 — `/import` 재배치·문구 + 드로어 2항목 · 코드 실측 2026-11-08)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **FB-28 1단계 ① 진입 구조**(backlog §1 25행 · 별지 §13 514행) | 화면 재배치 | 탭 5(축 혼합) → **"새 반입" 소스 선택 4(파일·URL·사이트·JSON) 1줄** + 답지 반입은 **후속 작업 진입**으로 분리 · 기본 소스 = 파일 | `frontend/src/pages/Import.tsx`(1,515줄) — `EntryMode` 6종 `:42`(`json`·`convert`·`url`·`fetch`·`answer_key`·`split_import`) · `initialEntryMode():117~124`(큐 비면 **`'json'`** `:119`) · `?mode=` 초기값·재반응 `:131~146` · `ModeTab` 5개 행 `:417~433`(`flex flex-wrap gap-2` — 긴 라벨 "반입 JSON 파일 선택"·"원본 파일로 시작 (자동 변환)"이 390px에서 3줄) · `ModeTab` 정의 `:613~634` · `resetWizard():235~242`(`setEntryMode('json'):237`) · `backToQueue():245~250` · 답지 분기 `:497~505`(소개문 `:499~502`) · 분할 분기 `:506~572`. 딥링크 `frontend/src/utils/jobRoutes.ts:13`(`/import?mode=answer_key`)·`:22~25`(`?mode=split_import&split_id=`) |
| **FB-28 1단계 ② Stepper 1개** | 표시 조건 | 사이트·답지·분할 모드에서 페이지 Stepper(3단)와 하위 Stepper(4·6·4단) **이중 표시 제거** | 페이지 Stepper `Import.tsx:378~380`(`StepIndicator` — 모드 무관 항상 렌더) · 라벨 `:636~641`(`select: '파일 선택' :638`) · 하위 Stepper = `components/FetchImportWizard.tsx:302`(`SUB_STEP_LABELS:27~33` 자격증·회차·확인·실행) · `components/AnswerKeyImportWizard.tsx:212`(`STEP_LABELS:35~43` 6단) · `components/SplitImportWizard.tsx:358`(`STEP_LABELS:70~76` 4단) · 공용 `components/Stepper.tsx:22` |
| **FB-28 1단계 ③ 엔진 블록 접기** | 표시 다듬기 | 파일·URL 시작 화면의 엔진 블록 = **"현재 엔진 1줄 + [변경]"** · 펼치면 기존 `EngineSelect` | `Import.tsx` `StartConvertPanel:661` · 상태 `engine`·`model` `:669~671` · 블록 `:759~762`(`<EngineSelect … modelValue onModelChange>` — 전 엔진 행 + 게이팅 사유 "키 미등록·설치 필요" + [다시 확인] 상시 노출) · `components/EngineSelect.tsx`(142줄 · `gateReason:12~19` · props `:21~38` · 사용처 7곳 공통 — **이 stage diff 0**) · 자동 해석 근거 = `api/types.ts:1044~1049` `LlmStatusResponse.priority`(정규화 배열 — 프론트 단일 출처) + `engines[].available·enabled` |
| **FB-28 1단계 ④ 문구 정정** | 문구 4곳 | S13 이후 정본 경로(파일·URL)와 불일치하는 설명문·라벨·빈 상태 | `Import.tsx:375` "Claude Code로 변환한 기출 JSON을 미리보고 검증한 뒤 DB에 적재합니다." · `:638` "파일 선택" · `pages/Home.tsx:96` "기출 JSON을 반입해 시작하세요." · screens §5.1 엣지(26행) 동일 문구 |
| **FB-28 1단계 ⑤ 대기열 요약 상시** | 표시 조건 | 선택 단계에서 대기열 요약을 **전 모드**에 노출(현행 json·fetch만) | `Import.tsx:436~440`(`entryMode === 'json' \|\| entryMode === 'fetch'`) · 파일·URL은 전체 목록 `ImportQueueList:456~478` · preview `:578`·result `:600`은 이미 상시 · `components/ImportQueue.tsx` `ImportQueueSummary:445~471`(검토 대기·진행 0이면 `null :452~455` — 빈 큐 노이즈 0) |
| **FB-29 큐넷 키 인라인 등록**(backlog §1 26행 · 별지 §13 515행 · 권고 ⓐ) | 컴포넌트 재사용 | 사이트 소스의 "키 미등록" 안내 화면 안에서 바로 등록 · 설정 카드는 유지 | `FetchImportWizard.tsx:255~298` 전 어댑터 unavailable 분기 · `qnetKeyMissing:262` · 문구+`<Link to="/settings">:267~273` · 대안 버튼 `:280~295`. `components/settings/QnetKeySection.tsx:14~119`(입력·즉석 검증·마스킹·삭제·커버리지 한계·발급 안내 — 자체 완결 카드) · 훅 `api/fetch.ts:56~62` `useSetQnetKey`(`onSuccess` → `['fetch','adapters']` invalidate — **등록 즉시 위저드 분기 자동 해제**) · 설정 배치 `pages/Settings.tsx:373~375`(그룹 ⑤ 데이터 · 백업 다음). 백엔드 `backend/routers/fetch.py:49`(`POST /qnet-key`)·`:57`(`DELETE`) — 무접촉 |
| **FB-30 드로어 가산**(backlog §1 27행 · 별지 §13 516행 · 드로어분만) | 내비 배열 +2 | 폰 드로어에 **제안함**(상단 그룹 끝)·**설정**(하단 그룹 휴지통 다음) — 사이드바와 같은 구성 | `components/Layout.tsx`(306줄) — `NAV_ITEMS:21~27`(하단 탭바 5 — 불변 `:236~240`) · `DESKTOP_EXTRA_ITEMS:31~35` · `NOTES_NAV_ITEM:40` · `TRASH_NAV_ITEM:44` · 사이드바 상단 `:158~168`(제안함 = `<SuggestionsNavBadge compact={collapsed} /> :167`) · 사이드바 하단 `:169~190`(휴지통 `:171` → 설정 리터럴 `:172` → LLM 작업 `:175` → 도움말 `:178~189`) · 헤더 📮·⚙️ `:220~227` · 드로어 주석 `:243~248`("설정은 헤더에 이미 있어 드로어에는 넣지 않는다") · 드로어 상단 `:273~275`(9) · 하단 `:276~298`(휴지통 `:279` → LLM 작업 → 도움말 = 3). `components/SuggestionsNavBadge.tsx:9`(props = `compact`만 · **`onClick` 없음** → 드로어 닫힘 연결 불가) · 비compact 렌더 `:31~48`(📮 + "제안함" + 배지) |

**API 0(신규·변경 모두 0 — api 문서 무접촉) · DDL 0(계획서 §6.2 무변 · Alembic 0 · settings 키 0 · localStorage 키 신설 0) · 새 라우트 0 · `?mode=` 값 6종·`jobRoutes.ts` diff 0 · 신규 의존 0 · 백엔드 diff 0 · 응답에 정답·해설 0(불변 규칙 1 — 화면 배치만) · 미리보기 승인 게이트(R7) 무변 · 하단 탭바 5 무변.**

## 2. 확정 규약 (착수 전 결정 — 위임 판정 · 이 문서가 정본 · **사용자 확정 대기 0** · UX 선택 3건(A·B·D)은 권고안 확정 + 대안 표 — **사용자 이견 시 변경**)

- **A. 진입 구조 = "새 반입" 소스 세그먼트 4개 1줄 + 답지는 헤더 우측 보조 진입** (결정 ① · **사용자 이견 시 변경**)
  - 선택 단계(`step === 'select'`) 맨 위 = 캡션 `새 반입`(`text-xs font-semibold text-muted`) + **세그먼트 4개 1줄**: `파일`(→ `convert`) · `URL`(→ `url`) · `사이트(큐넷)`(→ `fetch`) · `변환된 JSON`(→ `json`) — 순서 = 정본 경로 우선(파일·URL이 S13 이후 정본 · JSON은 "이미 변환된 결과" 보조). 기존 `ModeTab` 재사용(`rounded-full` 토큰 클래스 무변) · 행 = `flex flex-nowrap gap-2`(390px − 좌우 패딩 32px = 358px 안에 4개 · 짧은 라벨이 1줄을 보장 — 줄바꿈 대비 `overflow-x-auto` 1클래스 허용).
  - **답지·해설지 반입은 소스 축이 아니다**(반입 **후** 보완) → 세그먼트에서 빼고 **페이지 제목 줄 우측 텍스트 링크** `답지·해설지로 정답 채우기 →`(`text-xs text-accent hover:underline` · `<h1>반입</h1>`과 `flex justify-between` 1줄) = `setEntryMode('answer_key')`. 선택 단계 + `entryMode`가 `answer_key`·`split_import`가 아닐 때만 노출.
  - **답지 모드 화면**: 세그먼트 **숨김** · 위저드 위 1줄 = `답지·해설지 반입` 소제목 + `[← 새 반입으로]`(`setEntryMode('convert')`) · 기존 소개문 `:499~502` 유지. **분할 모드**도 세그먼트 숨김(진입 = 대기열 too_large·딥링크 전용 — 현행 위저드 `onCancel`이 복귀 담당 · 추가 버튼 0).
  - **기본 소스 = 파일**: `initialEntryMode()` 큐 비었을 때 `'json'` → **`'convert'`**(`:119`) · `resetWizard()` `setEntryMode('json')` → **`'convert'`**(`:237`). `EntryMode` 타입·`?mode=answer_key|split_import` 초기값·재반응 `:131~146`·`backToQueue`·`jobRoutes.ts` **diff 0**(딥링크 계약 무변). **← 보강(2026-11-08 · 검토 의심 → 390px 에뮬 재현)**: `[← 새 반입으로]`는 URL의 `?mode`를 함께 지운다(`setSearchParams(…, {replace:true})` · `:131~146` 재반응 로직 무변) — 지우지 않으면 작업 센터 [화면으로 이동]으로 **같은 URL 재진입** 시 `modeParam`이 불변이라 답지 화면이 다시 열리지 않는다(수정 후 재진입 정상 실측).
  - 대안 표(권고 = ⓐ):

    | 안 | 형태 | 장점 | 단점 |
    |---|---|---|---|
    | **ⓐ 세그먼트 4 + 답지 헤더 링크(권고)** | 소스 1줄 · 답지 = 제목 줄 우측 링크 | 390px 1줄 · 첫 화면 높이 최소 · 축 분리 명확 | 답지 진입이 텍스트 링크라 덜 눈에 띔 |
    | ⓑ 세그먼트 4 + 하단 "반입 후 보완" 카드 | 선택 단계 맨 아래 카드 1장 | 설명 1줄을 붙일 수 있음 | 파일·URL 모드는 대기열 목록 아래로 밀려 사실상 안 보임 |
    | ⓒ 카드형 소스 4(2×2 · 아이콘+설명) | 큰 카드 선택 후 패널 | 처음 쓰는 사람에게 친절 | 첫 화면 높이 증가(FB-28 실측 58% 문제 재발) · 재방문 시 1탭 추가 |
- **B. Stepper = 모드별 1개 — 하위 위저드를 가진 모드는 페이지 Stepper를 숨긴다** (결정 ② · **사용자 이견 시 변경**)
  - 페이지 `StepIndicator`(`:378~380`) 렌더 조건 = **`!(step === 'select' && (entryMode === 'fetch' || entryMode === 'answer_key' || entryMode === 'split_import'))`**. 즉 파일·URL·JSON = 페이지 3단(소스 선택 → 미리보기 → 결과) 1개 · 사이트 = 선택 단계에선 하위 4단 1개 → `result_preview_id`로 미리보기 합류(§5.9 S10 ④) 시점부터 페이지 3단 1개(하위 위저드 언마운트 — 동시 표시 0) · 답지 = 하위 6단 1개(페이지 미리보기에 합류하지 않음) · 분할 = 하위 4단 1개(완료 시 대기열로 복귀).
  - 페이지 단계 라벨 `select: '파일 선택'` → **`'소스 선택'`**(`:638` · 미리보기·결과 무변). 하위 위저드 3개·`Stepper.tsx` **diff 0**. **← 실측 추기(2026-11-08 · 검토 경미 1)**: 사이트 소스에서 전 어댑터 unavailable(키 미등록 포함)이면 위저드가 안내 화면을 조기 반환해 하위 Stepper도 없다 → 그 화면은 **Stepper 0**(안내 화면이라 정당 · "하위 4단 1개"는 키 등록 상태 기준 · V-2 ⓒ 동일 해석).
  - 대안 표(권고 = ⓐ):

    | 안 | 형태 | 장점 | 단점 |
    |---|---|---|---|
    | **ⓐ 하위 위저드 모드에서 페이지 Stepper 숨김(권고)** | 표시 조건 1줄 | 코드 최소 · 위저드 3개 무접촉 | 사이트 모드는 미리보기 합류 순간 Stepper 종류가 바뀜(4단 → 3단) |
    | ⓑ 하위 단계를 페이지 Stepper에 병합(사이트 = 자격증·회차·확인·실행·미리보기·결과 6단) | 위저드 Stepper 제거 + 페이지 단계 동적 | 흐름 1개로 끝까지 연속 | 위저드 3개 상태를 페이지로 끌어올림 — `Import.tsx` 비대 가속 · 1단계 범위 초과 |
- **C. 엔진 블록 = 요약 1줄 + [변경] — 래퍼 컴포넌트 신설 · `EngineSelect` diff 0** (결정 ③)
  - 신설 `components/EngineSelectCollapsible.tsx`(props = `EngineSelect`의 `value`·`onChange`·`modelValue`·`onModelChange` 그대로 전달). 접힌 상태 1줄 = `사용 엔진: {요약}` + `[변경]`(`text-xs text-accent`) · 요약 = `value === 'auto'` → **`자동 → {해석 엔진 label}`**(해석 = `status.priority` 순서로 `engines`에서 **첫 `available && enabled`** — 서버 auto 해석 규칙(§4.17①·§4.23)의 프론트 파생 · 신규 API 0) · 구체 엔진 → `{label}` · 모델 지정 시 `· {모델 label}` 부가. 펼침 = 기존 `<EngineSelect>` 그대로 + `[접기]`.
  - **강제 펼침(경고를 숨기지 않는다)**: ⓐ `auto`인데 해석 가능한 엔진 0 ⓑ 현재 선택 구체 엔진이 `available:false`·`enabled:false` → 접기 불가 · 펼친 `EngineSelect`가 사유·[다시 확인]을 그대로 보인다. 상태 로딩 중 = `사용 엔진: 확인 중…`. **← 추기(2026-11-08 · 검토 경미 4)**: 상태 조회 **오류**(`isError`)면 '확인 중…' 고착 대신 `EngineSelect`를 펼친 채 보인다(종전 동작 동등 · [다시 확인] 경로 유지).
  - 펼침 상태 = 컴포넌트 로컬(`useState(false)` · 저장 0 · localStorage 0). 사용처 = **`StartConvertPanel` 1곳만**(`:759~762` 교체) — 사이트 ③ 확인 단계·답지·AI 응용 등 나머지 6곳은 **현행 `EngineSelect` 유지**(확인 단계는 엔진을 보여 주는 것 자체가 목적).
- **D. 큐넷 키 = 사이트 소스 안내 화면 안 인라인 등록(FB-29 ⓐ) — `QnetKeySection` 그대로 재사용 · 설정 카드 유지** (결정 ④ · **사용자 이견 시 변경**)
  - `FetchImportWizard.tsx` `qnetKeyMissing`(`:262`) 분기: 제목 `사이트에서 가져오기 — 준비 중` → **`사이트에서 가져오기 — 서비스키 등록 필요`** · 문구 `:268~273` → **"큐넷 공개문제를 가져오려면 공공데이터포털 서비스키를 한 번 등록하세요. 등록한 키는 설정 › 데이터에서도 관리할 수 있습니다."**(`/settings` 링크는 문장 끝 "설정 › 데이터" 텍스트 링크로 유지) + 그 아래 **`<QnetKeySection />`**(입력·즉석 검증·실패 사유·커버리지 한계·발급 안내 — 카드 그대로) + 기존 대안 버튼(URL·파일) 유지.
  - 등록 성공 → `useSetQnetKey` `onSuccess`가 `['fetch','adapters']` invalidate(`api/fetch.ts:60`) → `allAdaptersUnavailable` 거짓 → **위저드 ① 자격증 검색이 자동으로 나타난다**(추가 상태·코드 0). 키는 있는데 다른 사유로 unavailable(`qnetKeyMissing` 거짓) = 현행 "준비 중" 문구 무변.
  - `QnetKeySection.tsx`·`Settings.tsx` **diff 0**(설정 그룹 ⑤ 카드 위치·F38 6그룹 수 불변 — FB-29 ⓑ "카드 이동" 기각). **← 실측 예외(2026-11-08 · 검토 경미 2)**: `QnetKeySection.tsx:45` 설명문의 옛 라벨 "[사이트에서 가져오기]"가 인라인 카드에 그대로 노출 → **문구 1줄만** "[사이트(큐넷)] 소스"로 정정(로직·props diff 0 · §4·DoD 2의 diff 0 명단에서 이 1줄 예외).
  - 대안 표(권고 = ⓐ):

    | 안 | 형태 | 장점 | 단점 |
    |---|---|---|---|
    | **ⓐ 사이트 안내 화면 인라인 등록(권고)** | 기존 카드 컴포넌트 재사용 | 필요한 순간·자리에서 등록 · 신규 API 0 · 중복 코드 0 | 설정과 반입 두 곳에 같은 카드(의도된 병존) |
    | ⓑ 설정 "LLM 엔진" 그룹으로 카드 이동 | 카드 위치만 이동 | 설정 한 곳 유지 | 여전히 반입 → 설정 왕복 · "데이터 유입 계열" 배치 근거(§5.11 S14) 번복 필요 |
- **E. 문구 정정 4곳** (결정 ⑤)
  - `Import.tsx:375` → **"기출 원본(파일·URL·사이트)을 반입 JSON으로 변환해 미리보기에서 확인한 뒤 DB에 적재합니다. 이미 변환된 JSON도 넣을 수 있습니다."**
  - `Import.tsx:638` → `'소스 선택'`(규약 B).
  - `Home.tsx:96` → **"기출 원본 파일(PDF·이미지 등)이나 URL을 반입해 시작하세요."**(버튼 "반입하러 가기" 무변 · 도착 기본 소스 = 파일 — 규약 A와 정합).
  - screens §5.1 엣지 문구 동기(편성 시 추기 완료).
- **F. 대기열 요약 = 선택 단계 전 모드 상시(파일·URL은 전체 목록이 대신)** (결정 ⑥)
  - `Import.tsx:436` 조건 `(entryMode === 'json' || entryMode === 'fetch')` → **`entryMode !== 'convert' && entryMode !== 'url'`**(= json·fetch·answer_key·split_import). `ImportQueueSummary` 자체 diff 0(빈 큐·진행 0이면 `null` — 노이즈 0). `[대기열 보기]` = 기존 `backToQueue`(파일 소스로 전환) 무변.
- **G. 드로어 가산 = 사이드바 거울 완성(10 + 4 = 14)** (결정 ⑦ · S49 규약 A·S53 규약 F의 "설정은 드로어 미포함" **번복** — 사유: FB-30 실측 "드로어 = 전체 메뉴"를 표방한 S49 원칙(사용자 원문 "메뉴에 … 빠져 있다")에 비해 제안함·설정 2항목이 빠져 헤더 아이콘(📮·⚙️ — 라벨 없음)으로만 찾아야 했음 · 헤더 아이콘은 **병존 유지**)
  - **상단 그룹 끝**(노트 다음) = `<SuggestionsNavBadge onClick={() => setMobileDrawerOpen(false)} />`(비compact — 📮 + "제안함" + 배지 · 사이드바 `:167`과 같은 위치). `SuggestionsNavBadge.tsx`에 **`onClick?: () => void` 1옵션**(compact·비compact 두 `NavLink`에 전달 · 미지정 = 현행 · 기존 호출처 2곳 diff 0).
  - **하단 그룹** = **휴지통 → 설정 → LLM 작업 → 도움말**(사이드바 `:169~190`과 같은 순서). 설정 = `SETTINGS_NAV_ITEM` 상수 신설(`{ to: '/settings', label: '설정', icon: '⚙️' }`) — 사이드바 리터럴 `:172`도 이 상수로 교체(단일 출처 · 리터럴 복제 0 · 사이드바 렌더 결과 diff 0).
  - 드로어 주석 `:243~248` 갱신("9+3=12 · 설정 미포함" → "10+4=14 · 사이드바와 동일 구성"). `NAV_ITEMS`·하단 탭바 5·헤더 📮⚙️·사이드바 표시 **무변**. 높이: 14항목 ≈ 기존 12항목 + 2행 — 844px(폰 실기기 기준) 무스크롤 목표 · 640px 이하는 기존 `overflow-y-auto`로 스크롤 허용(S49 "640px 무스크롤" 실측 조건은 이 stage에서 완화 — §7 기록).
- **H. 매뉴얼** (결정 ⑧) — `docs/manual/user-manual.html` `#import` 절(870행~): 876행 방법 A~D 도입 문단(탭 → "새 반입의 소스 4개 — 파일·URL·사이트(큐넷)·변환된 JSON") · 916행 "원본 파일로 시작" → "새 반입 › [파일]" · 1014·2008행 "반입 JSON 파일 선택" → "[변환된 JSON]" · 1060~1093행 방법 D "탭" → "소스" + "1) 서비스키 등록" = **반입 화면에서 바로 등록 가능**(설정 › 데이터 경로 병기) · 1157~1161행 답지 "[답지·해설지 반입] 탭" → "반입 제목 줄 오른쪽 [답지·해설지로 정답 채우기]" · 1952행 소제목 "변환(원본 파일로 시작)" → "변환([파일]·[URL])" · 1987행 "탭에 안내 화면만" → "사이트 소스에 등록 안내만 — 그 자리에서 키 등록" + 모바일 메뉴 문단 1864행(☰ 메뉴 항목 나열)에 "제안함·설정" 추가 1구. 완료 시 반영(D-1). **← 추기(2026-11-08 · 검토 경미 3)**: 985행 방법 C "URL로 시작" → "새 반입 › [URL]" 1구 추가(총 11곳 · 이행 완료).

## 3. 체크리스트

**B. 백엔드 (`backend/`)**
- [x] B-0 백엔드 diff 0 확인(`git diff --stat -- backend` 빈 출력 · `routers/fetch.py:49,57` 무접촉 · Alembic 0).

**F. 프론트 (`frontend/src/`)**
- [x] F-1 `pages/Import.tsx` 진입 구조(규약 A) — `ModeTab` 행 `:417~433` → 캡션 `새 반입` + 세그먼트 4(`파일`·`URL`·`사이트(큐넷)`·`변환된 JSON` · `flex-nowrap`) · 답지·분할 모드에서 세그먼트 숨김 · 제목 줄 `:373` `flex justify-between` + 우측 `답지·해설지로 정답 채우기 →` 링크(선택 단계 + 답지·분할 아닐 때) · 답지 모드 소제목 + `[← 새 반입으로]` · `initialEntryMode` `:119`·`resetWizard` `:237` 기본값 `'convert'` · `EntryMode`·`?mode=` 처리 `:131~146` diff 0.
- [x] F-2 `pages/Import.tsx` Stepper(규약 B) — `StepIndicator` `:378~380` 렌더 조건(select + fetch·answer_key·split_import면 숨김) · `STEP_LABELS.select` `:638` = `'소스 선택'`. 하위 위저드 3파일·`Stepper.tsx` diff 0.
- [x] F-3 `components/EngineSelectCollapsible.tsx` 신설(규약 C — 요약 1줄 · `자동 → {해석 label}` · 강제 펼침 2조건 · 로딩 문구 · `[변경]`/`[접기]` · 로컬 상태) + `Import.tsx` `StartConvertPanel` `:759~762` 교체(라벨 `사용 엔진` `p` 제거 — 래퍼 1줄에 흡수). `EngineSelect.tsx` diff 0.
- [x] F-4 문구(규약 E) — `Import.tsx:375` · `pages/Home.tsx:96`.
- [x] F-5 대기열 요약 조건(규약 F) — `Import.tsx:436` `entryMode !== 'convert' && entryMode !== 'url'`.
- [x] F-6 `components/FetchImportWizard.tsx` 인라인 키 등록(규약 D) — `qnetKeyMissing` 분기 `:263~298` 제목·문구 교체 + `<QnetKeySection />` 렌더(import `./settings/QnetKeySection`) + 대안 버튼 유지 · 키 등록 외 unavailable 문구 무변 · `QnetKeySection.tsx`·`Settings.tsx` diff 0.
- [x] F-7 `components/SuggestionsNavBadge.tsx` — `onClick?: () => void` 1옵션(두 `NavLink` 전달 · 미지정 = 현행).
- [x] F-8 `components/Layout.tsx`(규약 G) — `SETTINGS_NAV_ITEM` 상수 + 사이드바 `:172` 리터럴 교체(렌더 diff 0) · 드로어 상단 그룹 끝 `SuggestionsNavBadge`(비compact · 닫힘 `onClick`) · 드로어 하단 그룹 휴지통 다음 `NavButton item={SETTINGS_NAV_ITEM}`(닫힘 `onClick`) · 주석 `:243~248` 갱신 · `NAV_ITEMS`·하단 탭바·헤더 무접촉.
- [x] F-9 색·간격 = 토큰·기존 유틸 클래스만(불변 규칙 5 · `tokens.css` 무변 · 새 색 리터럴 0) · 엔트리 청크 Δ 기록(R37 — 직전 커밋 dist 대비 · Layout·SuggestionsNavBadge = 앱 셸 · Import·FetchImportWizard = 라우트 청크) · 빌드 산출물 커밋 정책은 저장소 관례(stage-53 F-8)대로.

**V. 검증 (서버 구동 금지 — `2_StartServer.bat` 주인은 사용자 · 브라우저 실측은 사용자가 띄운 `localhost:8000`만 · 실 데이터 무접촉 — 반입 커밋 0 · 키 등록 실측은 사용자 승인 하에만)**
- [x] V-1 `npm run build` 성공(성공/실패만) · `invariant-scan.ps1` PASS(신규 위반 0 — 기준선 갱신 0) · `run-tests.ps1` 생략 가능(백엔드 diff 0 — B-0으로 갈음 · 불변 규칙 7 대상 `sm2.py` 무접촉).
- [x] V-2 브라우저 실측(사용자 기동 서버 · 데스크톱 폭 + 390px 에뮬): ⓐ `/import` 첫 진입(빈 큐) = 세그먼트 `파일` 선택 상태 · 페이지 Stepper 1개(라벨 "소스 선택") · 설명문 새 문구 ⓑ **390px 세그먼트 1줄(꺾임 0)** · 제목 줄 답지 링크 1줄 · 전체 1열 ⓒ `사이트(큐넷)` = 페이지 Stepper **숨김** · 하위 4단 1개만 · (키 미등록 환경이면) "서비스키 등록 필요" + `QnetKeySection` 인라인 카드 + 대안 버튼 — **실제 키 입력은 하지 않음**(사용자 승인 시만 · 키 보유 환경이면 분기 미노출이 정상 — 이 경우 ⓒ는 "키 등록 상태에서 자격증 검색 화면 + Stepper 1개" 확인으로 갈음) ⓓ 답지 링크 → 세그먼트·페이지 Stepper 숨김 · 6단 Stepper 1개 · `[← 새 반입으로]` 복귀 · 390px 첫 화면에서 위저드 첫 입력이 접힘 없이 보임(FB-28 실측 58% 대비 개선 수치 기록) ⓔ `/import?mode=answer_key` 직접 진입 = 답지 화면(딥링크 무변) · 작업 센터 [화면으로 이동] 동일 ⓕ `파일` 엔진 블록 = `사용 엔진: 자동 → Claude CLI`(실측 환경 기준) 1줄 + `[변경]` → 펼침 = 기존 엔진 목록·게이팅 사유 · `[접기]` · 구체 엔진·모델 선택 후 요약 반영 ⓖ 대기열에 항목이 있을 때 `변환된 JSON`·`사이트`·답지 모드에 요약 줄 노출 · 빈 큐면 없음 ⓗ 홈 빈 상태 문구(데이터 0 환경이 아니면 코드 리뷰로 갈음 — 실 DB 비우기 금지) ⓘ 390px 드로어 = 상단 10(… 노트 → 제안함 + 배지) · 하단 4(휴지통 → 설정 → LLM 작업 → 도움말) · 제안함·설정 탭 = 이동 + 닫힘 · active 강조 · **하단 탭바 5 무변** · 헤더 📮⚙️ 무변 · 데스크톱 사이드바 표시 diff 0 ⓙ 콘솔 에러 0(`pattern` 필터).

**D. 문서**
- [x] D-1 매뉴얼 `docs/manual/user-manual.html` 반입 절·트러블슈팅·모바일 메뉴(규약 H).
- [x] D-2 설계 — screens §5.9 `[S55]` 블록·§5.11·§5 도입부·§5.1 "편성 추기" → "구현 실측 확정" 표기(편차 있으면 1구) · 색인 상태 줄 **v1.71**(최근 3건 규칙으로 밀리는 판은 `docs/04-archive/design-changelog.md` 맨 위로 이동만).
- [x] D-3 `docs/03-release/CHANGELOG.md` 항목(§6 ①) · `stage-index.md` 55행 · 이 문서 §7 완료 기록 · 체크박스 `[x]`.
- [x] D-4 `backlog.md` — FB-29·FB-30(드로어분)·FB-28(1단계) 처리(§6 ④) · 기준일 줄 · `scripts/backlog-scan.ps1` PASS.
- [x] D-5 출처 추기 — 별지 §13 FB-28·FB-29·FB-30 배정 셀 끝 `← 완료(stage-55 · 날짜 · …)` · `CLAUDE.md` 머리 버전 줄·`VERSION`(발행 시 — 사용자 회신 후).

## 4. 이 단계에서 하지 않는 것 (불변 규칙 9 — 이 절이 우선)

- **FB-28 2단계 0** — `import_runs` 테이블·run_id·타임라인 카드·`/import` 반입 건 목록·작업 센터 [화면으로 이동] → run 카드 전부 **미편성**(핵심 · DDL 1 · 착수 전 결정 = run 보존 수명↔R18 · 큐 이관 · R7 불변 · FB-31 거취 — 별지 §13 514행). §6.2·Alembic·api 문서 무접촉.
- **localStorage 변환 대기열 이관·폐기·키 변경 0**(`useConvertQueue`·`readQueue` 형식 무변 — 기기 종속 해소는 2단계) · **작업 센터와 대기열의 중복 표시 정리 0**(2단계 run 카드가 흡수).
- **`Import.tsx` 구조 분해·분할 재진입 state 8개 정리 0**(재배치·조건·문구만 — 대규모 리팩터는 2단계와 함께) · 하위 위저드 3개(`FetchImportWizard`는 규약 D 분기만)·`ImportQueue.tsx`·`Stepper.tsx`·`EngineSelect.tsx`·`jobRoutes.ts` 내부 로직 diff 0 · `?mode=` 값 추가·변경 0 · 새 라우트 0(`/import/answer-key` 등 신설 0).
- **엔진 접기는 파일·URL 시작 화면 1곳만** — 사이트 ③ 확인·답지·AI 응용·개선·회귀·explain의 `EngineSelect` 무변 · 엔진 기본값 저장(settings 키) 0 · 엔진 우선순위 UI 변경 0.
- **설정 화면 diff 0** — 큐넷 카드 위치 이동(FB-29 ⓑ) 0 · 6그룹 구성 무변 · 신규 API 0(`fetch/qnet-key` POST·DELETE 재사용만).
- **FB-30 플래시카드 내비 진입·복습 3표면(복습·플래시카드·오답노트) 정리 0**(실수요 확인 후 재론 — 별지 §13 516행) · **하단 탭바 변경 0**(`NAV_ITEMS` 5 · F39) · 하단 탭 라벨 표시 0 · 헤더 📮⚙️ 제거 0 · 사이드바 구성 변경 0.
- **FB-31(오류 신고 77회 누적) 무접촉** — 감시 유지 · 제안함 "반입 개선" 탭 diff 0.
- **stage-54 캡처 무접촉** — `capture.plan.md`·`stage-54-capture-slice-1.plan.md`·api §4.33·screens §5.18 diff 0 · 캡처 내비 항목 선반영 0.
- 미리보기 표·승인 체크박스·커밋 흐름(R7 · §5.9 ②③)·변환 신뢰 배지·분류 경로 지정 UI diff 0 · 반입 성공·실패 판정 로직 diff 0 · DDL 0 · 신규 의존 0.

## 5. DoD (완료 정의)

**자동 검증(에이전트 수행):**
1. `npm run build` 성공 · `invariant-scan.ps1` PASS(기준선 갱신 0) · 백엔드 diff 0(B-0).
2. 프론트 diff = `pages/Import.tsx`·`pages/Home.tsx`·`components/FetchImportWizard.tsx`·`components/EngineSelectCollapsible.tsx`(신규)·`components/SuggestionsNavBadge.tsx`·`components/Layout.tsx` **6파일 안** · `EngineSelect.tsx`·`QnetKeySection.tsx`(설명문 1줄 예외 — 규약 D 추기)·`Settings.tsx`·`AnswerKeyImportWizard.tsx`·`SplitImportWizard.tsx`·`ImportQueue.tsx`·`Stepper.tsx`·`jobRoutes.ts`·`App.tsx` 무접촉 · 새 색 리터럴 0 · 엔트리 청크 Δ 기록(R37).
3. 브라우저 V-2 ⓐ~ⓙ 전건 통과(실 데이터 무접촉 · 키 입력 0 — 사용자 승인 시 예외).
4. 문서 묶음 D-1~D-5(매뉴얼 · Design v1.71 · CHANGELOG · stage-index · backlog · 별지 FB `← 완료`).

**사용자 확인(게이트 본체):**
5. **실사용** — ⓐ 반입 화면에서 "어디서 시작하는지"가 한눈에 보임(소스 4개 1줄 · 답지 진입 위치가 찾기 쉬운지 — **규약 A 대안 ⓑ·ⓒ로 바꿀지 회신**) ⓑ Stepper가 화면마다 1개로 보임(사이트 모드의 미리보기 합류 시 Stepper 전환이 어색하지 않은지 — **규약 B 대안 ⓑ 필요 여부 회신**) ⓒ 엔진 1줄 요약이 실사용 엔진(Claude CLI)과 일치 ⓓ (키를 새로 등록할 일이 있으면) 사이트 소스 안에서 등록 → 바로 검색으로 넘어감 ⓔ **폰 실기기** — 반입 화면 1열·세그먼트 꺾임 0 · 드로어 제안함·설정 탭 · 14항목 스크롤 여부 회신 · **치명 결함 0 회신** = 발행 게이트.

**게이트**: 1~4 전건 + 5 치명 0 → 발행(§6 ①). 치명 발견 시 발행 보류·수정 선행. **착수 게이트**: 없음(사용자 확정 대기 0 — 권고안 확정 · 이견 시 해당 규약만 교체).

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` — **v2.03.2 항목 1개**(사소 · 규약 ② PP+1). **단독 발행 판단**: stage-54(핵심)는 착수 전(편성 보류)이라 미발행 완료분이 없으므로 **stage-55는 v2.03.2로 단독 발행 가능**(합류 대상 0 — stage-53 §6 ① ⓑ "사소가 미발행 핵심에 합류" 전례는 해당 없음 · 만약 stage-55 완료 전에 stage-54가 완료·미발행 상태가 되면 그때 stage-54 v2.04.1에 합류 판정). 불릿 = 반입 화면 소스 선택 1줄(파일·URL·사이트·JSON) · 답지 반입 진입 분리 · Stepper 1개 · 엔진 1줄 요약 · 큐넷 키 반입 화면 인라인 등록 · 문구 정정 · 폰 드로어 제안함·설정 · 신규 API 0 · DDL 0.
2. 루트 `VERSION` 2.03.2 — 사용자 회신(DoD 5) 후.
3. `stage-index.md` 55행 갱신(완료·일자·산출 버전).
4. `backlog.md` — **FB-29** 행 §1 → §4 종결 이동(`종결(stage-55 · 날짜)`) · **FB-28**은 1단계만 종결이라 행 **§1 잔류** + 상태 `미편성(2단계 — 1단계 종결 stage-55 · 날짜)` · **FB-30**도 §1 잔류 + 상태 `미배정(실수요 확인 후 — 플래시카드·복습 3표면 재론 · 드로어분 종결 stage-55 · 날짜)` · 기준일 줄 갱신 · `scripts/backlog-scan.ps1` PASS 확인(DRIFT 시 §4에 부분 종결 보정 행 1개씩).
5. 출처 추기 — 별지 §13 FB-28 배정 셀 끝 `← 완료(stage-55 · 1단계 · 날짜)` · FB-29 `← 완료(stage-55 · ⓐ · 날짜)` · FB-30 `← 완료(stage-55 · 드로어분 · 날짜)`.
6. 설계 — screens §5.9 `[S55]`·§5.11·§5 도입부·§5.1 확정 표기 · 색인 상태 줄 v1.71(밀리는 판 archive 이동만).
7. 매뉴얼(규약 H) · `CLAUDE.md` 머리 버전 줄 1곳(발행 시) · git tag `v2.03.2`(release PR 별도 — stage-47 전례).

## 7. 완료 기록 (구현·검증·문서 경위 정본 — 착수 후 추기)

- **편성**(2026-11-08): 지시서 확정 — 묶음 FB-28 1단계 + FB-29(ⓐ 인라인 등록) + FB-30 드로어분 · 버전 영향 사소(v2.03.2 예정) · 위임 판정 규약 A~H(UX 선택 A·B·D는 권고안 확정 + 대안 표 — 사용자 이견 시 변경) · **사용자 확정 대기 0** · S49 규약 A·S53 규약 F "설정은 드로어 미포함" 번복(규약 G 사유) · screens §5.9 `[S55]` 블록 + §5.11·§5 도입부·§5.1 1구(Design v1.70) · api 무접촉 · stage-index 55행 · backlog FB-28·29·30 상태 + 기준일 · 별지 §13 FB-28·29·30 편성 추기 · 로드맵 M 행 추가 없음(사소).
- **구현**(2026-11-08 · 커밋 `e5fac91` · 브랜치 `stage-55-import-unified-view`): frontend-dev 2묶음 병렬(F-1~F-5 `Import.tsx`·`Home.tsx`·`EngineSelectCollapsible.tsx` 신설 / F-6~F-8 `FetchImportWizard.tsx`·`SuggestionsNavBadge.tsx`·`Layout.tsx`) · 규약 A~G 편차 0 · `npx tsc --noEmit` 통과 · 매뉴얼 규약 H 10곳(메인 직접) · **B-0 백엔드 diff 0** · `npm run build` 성공 · `invariant-scan.ps1` PASS(기준선 갱신 0) · 엔트리 청크 1,522,408 → 1,524,494 B.
- **검토**(2026-11-08 · Opus `stage-reviewer`): **조건부 통과 — 치명 0 · 중요 0 · 경미 4** ① 키 미등록 안내 화면 Stepper 0(규약 B·V-2 ⓒ 추기로 정당화) ② `QnetKeySection:45` 옛 라벨 → 문구 1줄 정정(§4 diff 0 예외 · 규약 D 추기) ③ 매뉴얼 985행 "URL로 시작" 누락 → 정정(규약 H 추기) ④ 엔진 상태 조회 오류 시 '확인 중…' 고착 → `isError`면 `EngineSelect` 펼침(규약 C 추기) — **전건 반영**. 의심 1건(답지 복귀 후 같은 URL 재진입 시 답지 화면 미재개) = 390px 에뮬로 **재현 확인** → `[← 새 반입으로]`가 `?mode` 제거(규약 A 보강). 등재 권고(코드 동작 무관 · 다음 사소 stage 동승 후보): 옛 라벨 주석 `Import.tsx:685`·`api/convert.ts:63`·`FetchImportWizard.tsx:23` · `Layout.tsx` 드로어 주석의 사이드바 라인 참조 어긋남.
- **브라우저 실측 V-2**(2026-11-08 · 임시 포트 8765 · 워크트리 빌드 · 빈 DB(`alembic upgrade head`) · 데스크톱 1060px + 390×844 iframe 에뮬 · 종료 후 리스너 부재 확인): ⓐ 통과(세그먼트 4 · `파일` 선택 · Stepper 1 "소스 선택" · 새 설명문) ⓑ 통과(**세그먼트 4개 offsetTop 동일 · 행 scrollWidth=clientWidth 358 · 문서 가로 스크롤 0** · 제목 줄+답지 링크 1줄 · 첫 입력 498px) ⓒ 통과(키 미등록 → "서비스키 등록 필요" + `QnetKeySection` 인라인 + 대안 버튼 · Stepper 0 — 경미 1 해석) ⓓ 통과(세그먼트 숨김 · 6단 Stepper 1개 · 소제목 · **첫 입력 top 306px — FB-28 실측 494px 대비 −188px** · 복귀 정상) ⓔ 통과(`?mode=answer_key` 직접 진입 = 답지 · 복귀 시 URL `/import` · 같은 URL 재진입 = 답지 재개 — 보강 후) ⓕ 통과("사용 엔진: 자동 → Claude CLI" ↔ [변경] 펼침(Claude API 키 미등록·Codex 설치 필요·[다시 확인] 노출) ↔ [접기]) ⓖ **코드 검토 갈음**(빈 큐 — 조건식 검토자 확인) ⓗ 통과(홈 빈 상태 새 문구) ⓘ 통과(**드로어 14항목** 홈·커리큘럼·퀴즈·복습·오답노트·탐색·반입·인쇄·노트·제안함 / 휴지통·설정·LLM 작업·도움말 · 844px 무스크롤 · 설정 탭 = `/settings` 이동 + 닫힘 · 하단 탭 5) ⓙ 콘솔 오류 0. 검토 반영 후 재빌드: 엔트리 청크 **1,524,813 B(Δ 기준선 대비 +2,405 B · 앱 셸 · 의존 0 → R37 기준선 stage-56+)** · invariant PASS.
- **완료 절차**(2026-11-08): 체크박스 전건 `[x]` · CHANGELOG v2.03.2 항목(발행 대기) · stage-index 55행 · backlog FB-29 §4 종결 · FB-28 `미편성(2단계 — 1단계 종결)` · FB-30 `미배정(…드로어분 종결)` · 별지 §13 FB-28·29·30 `← 완료` · screens §5.9·§5.11·§5 도입부·§5.1 확정 표기 + Design v1.71(v1.67 archive 이동) · 매뉴얼 11곳. **잔여 = DoD 5**(사용자 실사용·폰 실기기 회신 — 규약 A·B·D 대안 선택 포함) → 치명 0이면 `VERSION` 2.03.2 + CLAUDE.md 버전 줄 + tag.
