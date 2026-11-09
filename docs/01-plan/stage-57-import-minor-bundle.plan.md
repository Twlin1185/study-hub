# Stage 57 — 반입 사소 묶음: run 목록 `preview_available` + 날짜 키 정합 + 해설 규격 + 작업 센터 run 그룹 (FB-32 · FB-33 · FB-35ⓐ · FB-36) (v2.0.x · 사소)

> 상태: **구현·검토 완료 — 발행 대기(DoD 6·7 사용자 회신 → VERSION 2.04.2)**(2026-11-09 · 구현 커밋 `0a26255` + 검토 경미 반영 `6753aa9` · **Opus 검토 통과 — 치명 0 · 중요 0 · 경미 3**(②③ 반영 `6753aa9` · ① 체크박스 표기는 완료 절차 문서 묶음에서 해소) · 자동 검증 V-1(`-Full` 710 passed · invariant PASS · 빌드 성공 · 엔트리 청크 Δ +1,879 B) · **API 실측 V-2 ⓐ~ⓓ 통과**(ⓒ는 순서 변경 실측) · **브라우저 실측 V-3 ⓐⓑⓒⓔⓕⓖ 통과**(ⓓ 관찰 불가 → 코드 검토 갈음 · ⓔ 중 인쇄 미리보기 "생성일"은 빈 DB라 미확인 · 임시 포트 8765 · 빈 DB · LLM 0 — 종료·리스너 부재 확인) · DoD 1~5 충족(4의 미확인 잔여 = "생성일" 1건) · 문서 묶음 D-1~D-5 이행 — §7). 편성 2026-11-09 · 번호 57 · **사용자 확정 대기 0** — 등록부·별지에 권고안이 적힌 선택과 UX 세부(§2 C·D·E·G)는 권고안으로 확정 + 대안 표 · **사용자 이견 시 변경**(해당 규약만 교체). 사용자 지시 = 2026-11-09 "진행시켜" → 진행 대상 질의에 "반입 사소 묶음" 선택. stage-54(캡처 · 편성 보류)와 무접촉·독립.
> **버전 영향: 사소**(CHANGELOG 머리 규약 ③ — "사소 = 버그픽스·다듬기·정비"): 기존 표면(반입 건 카드·작업 센터·해설 프롬프트·히트맵/인쇄 날짜) **다듬기·버그픽스** · **새 화면 0 · 새 라우트 0 · 신규 엔드포인트 0 · DDL 0(§6.2 무변 · Alembic 0) · 기존 응답 필드 순수 가산 2(`GET /api/import/runs` 항목 `preview_available?` · `GET /api/llm/jobs` 항목 `run_label?`) · 신규 의존 0 · 기능 퇴역 0 · 잡 kind 0 · settings 키 0**. → 산출 버전 = 규약 ② PP+1 = **v2.04.2 예정**(현행 `VERSION` 2.04.1 · 미발행 핵심 stage 없음 → 단독 발행). 마스터 §14 M 행 **추가 없음**(사소 — stage-index가 담당) · §5 F 행·§15 R 행 추가 없음.
> 생성 경위: `backlog.md` §1 **FB-32**(별지 §13 523행 — stage-56 Opus 검토 등재 권고) + **FB-33**(524행 — 같은 검토 · 시각 9시간 오차 계열 전수 점검) + **FB-35 ⓐ만**(531행 — 2026-11-08 사용자 피드백 "해설이 너무 간단" · ⓑ 적응형 깊이는 **제외** — §4) + **FB-36**(532행 — 같은 날 사용자 피드백 "작업 센터에서도 그룹 단위로"). 네 건 모두 사소 · 반입·작업 센터·해설 주변 → 1 stage 동승. **편성 실측으로 정정한 등재 표기 2건**: ① FB-36 "프론트 전용" → **백엔드 가산 동반**(잡 항목 `run_label` — §2 F) ② FB-33 "`new Date(iso)` → `parseServerDate` 표준화" → **그 9곳은 정상(서버 로컬 naive)이라 무접촉 · 실제 결함은 날짜 키 7지점**(§1 실측 표 · §2 C).
> 정본 포인터: API 계약 = api **§4.34 ④ `[S57]` 단락**(목록 항목 `preview_available?`) · **§4.24 `[S57]` 추기**(잡 항목 `run_label?`) · **§4.20 ② `[S57]`**(해설 규격) · 화면 계약 = screens **§5.9 S56 B `← S57`** · **§5.14 run 그룹(S57)** · 색인 §3 날짜 규약 `← S57 실측`(**Design v1.74**) · 불변 규칙 1(응답에 정답·해설 0 — 가산 2필드는 id·라벨·불리언)·5(토큰만)·6(DDL 0)·8·9 · R7(승인 게이트·창작 금지)·R21(LLM 해설 오개념)·R37(엔트리 청크 Δ 기록) · 발행 절차 = CHANGELOG 머리 규약 ⑤.

## 1. 범위 (백엔드 5파일 가산 + 프론트 · 코드 실측 2026-11-09)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **FB-32 목록 `preview_available`**(backlog §1 25행 · 별지 §13 523행) | API 응답 순수 가산 + 카드 조건 | run 목록 항목에 `preview_available`을 실어 [자세히]를 펼치기 전에도 보존 만료 run의 [검토]를 비활성화 | 백엔드 `backend/services/import_run_service.py` — `run_to_dict:846~871`(항목 직렬화 · 목록·상세 공용) · `list_runs:874~888` · `_preview_exists:898~909`(커밋분 false → 캐시 → `preview_store.find` · **복구 호출 0**) · `get_detail:947~982`(산출식 `:968~975` — `run.preview_id` 있으면 그것 · 없으면 `summary.previews[]` 중 미커밋 조각 any) · `schemas/import_runs.py` `ImportRunItem:69~88`(필드 없음) · `ImportRunDetail.preview_available:118` · `services/preview_store.py` `find:134~139`(`AUTO_DIR.glob("{id}__*.json")` · `KEEP_MAX = 50 :32`). 프론트 `frontend/src/pages/import/RunCard.tsx:86~99`(상세 조회 `enabled: expanded :88` · `previewAvailable = detail ? detail.preview_available : true :97` · 사유 `:98~99`) · [검토] `disabled :185` · [합쳐서 검토] `:204` · 사유 문구 렌더 = `RunTimeline.tsx:157`(펼친 뒤만) · `api/types.ts` `ImportRun:1862~1882` · `ImportRunDetail.preview_available:1911` |
| **FB-33 시각 9시간 계열 전수 점검**(backlog §1 26행 · 별지 §13 524행) | 실측 분류 + 버그픽스 | `frontend/src`의 `new Date(` 30곳/19파일 + `toISOString`·`.slice(0, 10)` 전수 분류 → **날짜 키 결함 7지점/6파일 수정** · 나머지 무접촉(아래 "FB-33 실측 분류" 표가 정본) | 공용 파서 `frontend/src/editor2/api/notes.ts:41~46` `parseServerDate`(오프셋 없으면 `Z` 부착) · 사용처 3 = `pages/Trash.tsx:20·36` · `pages/import/RunTimeline.tsx:2·11` · `editor2/pages/NoteListPage.tsx:13·26`. 서버 표기 실측: DB 컬럼 = `models.py` `server_default=func.current_timestamp()`(UTC naive) · `import_run_service._utcnow:60~62`(UTC naive) ↔ 인메모리·파일 = `dt.datetime.now()`(**서버 로컬 naive**) — `convert_service.py:943·951 → :1012`(`last_activity_at`) · `:1668~1670`(잡 `created_at`·`started_at`·`finished_at`) · `llm_engine_service.py:465`(`last_success_at`) · `:706·787 → :738·821`(`resets_at`) · `improve_service.py:259·447·601·708·718`. 히트맵 키 = `stats_service.py:235·247` `date(col, 'localtime')`(서버 로컬 날짜) |
| **FB-35 ⓐ 해설 규격**(backlog §1 28행 · 별지 §13 531행 · ⓐ만) | 프롬프트 계약 개정 | AI 풀이 생성·오류 신고 재생성 프롬프트에 **구성·분량 규격**(정답 근거 + 오답 보기별 설명 + 핵심 개념 1줄) 추가 · 출력 JSON 무변 · 창작 금지 유지 | `backend/services/convert_service.py` — `_build_explain_prompt:3105~3136`(지시 2줄 `:3113~3114` — 길이·구성 규격 0 · 출력 형식 `:3129~3134` · 호출 `:3223`) · `_build_regenerate_prompt:2594~2635`("전면 재작성 금지" `:2605~2606` · 출력 형식 `:2627~2633` · 호출 `:2775`) · `_normalize_explain_draft:3139~3147`(길이 제한 0) · 풀이 대상 제한 `:3201`(`import_service.QUESTION_TYPES`)·`:3205`(해설 있으면 409). 기존 테스트 `backend/tests/test_answer_key_explain.py`(프롬프트 문구 단언 0 — 대상 제한·apply·마커만) |
| **FB-36 작업 센터 run 그룹**(backlog §1 29행 · 별지 §13 532행) | 응답 순수 가산 + 패널 묶음 표시 | 같은 반입 건(run)에 속한 잡 2개 이상을 그룹(헤더 라벨·집계·접기·[카드로 이동]·[모두 취소]·[목록에서 지우기])으로 · `run_id` 없는 잡은 평면 유지 | 백엔드 `convert_service.py` `_new_job_base` 키 `_label :2438`·`_run_id :2445` · `_job_list_item:1655~1676`(`label :1665` · `run_id :1675` — DB 0) · `job_label:2562~2566` · `import_run_service.py` `start_with_run:1094~1119`(`label = job_label :1107` → `run.label = label :1115`) · `note_split_enqueued:480~503`(조각 잡 id 목록 수신) · `note_job_assigned:545~556`(답지) · `routers/split.py` `start_analyze:93~109`(`run_id :99~101` · 잡 시작 `:102~108` · 사후 훅 없음) · `split_service.py:788~802`(조각 잡 `run_id= :797` → `note_split_enqueued :802`) · `answer_key_service.py:199~201` · `schemas/llm.py` `JobListItem:98~116`. 프론트 `components/JobCenterPanel.tsx`(258줄 — 평면 `items.map :171~235` · 대기 순번 `queuedIndex :104·172` · `requestCancel:75~85` · `confirmCancel:87~93` · `requestDismiss:97~102` · 확인 고정 문구 `:245~255`) · `api/llm.ts` `useCancelLlmJob:49~53` · `useDismissLlmJob:61~65`(`DELETE /llm/jobs/{id}`) · `utils/jobRoutes.ts:30~37`(`?run=`) · `api/types.ts` `LlmJobItem:1628~1642`(`run_id? :1641`) |

**FB-33 실측 분류(정본 — `new Date(` 30곳 + 날짜 문자열 절단 · 2026-11-09 Grep)**

| 분류 | 지점(`frontend/src/` 기준 `파일:라인`) | 입력 값의 출처 | 판정 |
|---|---|---|---|
| ① 서버 ISO를 `new Date(iso)`로 직접 파싱 — **9곳/8파일** | `components/improve/ImproveCaseDetailModal.tsx:70` · `ImproveCaseList.tsx:15` · `ImproveRegressionPanel.tsx:11` · `ImproveProposalList.tsx:8` · `components/LlmJobProgress.tsx:82` · `components/LlmErrorInfo.tsx:17` · `components/LlmLimitBanner.tsx:8·23` · `components/settings/LlmEngineSection.tsx:24` | improve 사례·제안 파일(`last_seen_at`·`run_at`·`decided_at`·`created_at`) · 잡 `progress.last_activity_at` · `resets_at` · `last_success_at` — **전부 `dt.datetime.now().isoformat()` = 서버 로컬 naive** | **정상 · 무접촉** — 브라우저가 로컬로 읽는 것이 맞다. **`parseServerDate` 적용 금지**(`Z`를 붙이면 9시간 오차를 새로 만든다) |
| ② 이미 `parseServerDate` 경유 | `editor2/api/notes.ts:43·45`(정의) · `pages/import/RunTimeline.tsx:21`(`new Date(t)` — t = epoch ms) · `editor2/pages/NoteListPage.tsx:24`(주석) | notes·documents·import_runs(UTC naive) | 정상 · 무접촉 |
| ③ 현재 시각·세션 로컬 값 | `editor2/pages/NoteEditPage.tsx:343` · `editor2/documents/DocBlockEditor.tsx:349`(`setSavedAt(new Date())`) · `pages/DocumentDetail.tsx:63·74`(오늘) · `:65·76`(`${due}T00:00:00` — DATE를 로컬 자정으로) | 클라이언트 시계 · 서버 DATE | 정상 · 무접촉 |
| ④ 로컬 `Date` → `toISOString().slice(0, 10)` 날짜 키 — **6지점/5파일 · 결함** | `components/Heatmap.tsx:12`(`toDateKey` · 입력 Date 생성 `:35·38·41·46`) · `components/home/HeatmapWidget.tsx:12`(`isoDate` · `:18·20·22`) · `pages/Print.tsx:18`(`todayIso`)·`:24`(`monthAgoIso` · `:22`) · `components/print/QuizPrintView.tsx:55` · `components/print/ConceptPrintView.tsx:45`("생성일") | 로컬 자정/현재 시각을 **UTC 날짜**로 직렬화 → KST(UTC+9)에서 히트맵은 **항상 하루 전 키**(로컬 자정 = 전날 15:00Z), 인쇄 기본 날짜·생성일은 00:00~08:59에 전날 | **수정**(로컬 날짜 키) — 히트맵은 서버 키가 로컬 날짜(`date(col,'localtime')`)라 **오늘 학습분이 "내일" 칸(미래 = 투명)에 들어가 당일 미표시 + 요일 1칸 밀림**(stage-7 검토 "toISOString 타임존 의심 — 범위 밖 기록"의 실체 · 코드 독해 판정 — V-3 ⓔ에서 수정 전·후 실측) |
| ⑤ UTC naive 문자열을 날짜로 절단(`new Date(` 밖) — **1지점 · 결함** | `components/print/WrongNotePrintView.tsx:24`(`n.created_at.slice(0, 10)`) | `review_notes.created_at`(DB · UTC naive — `schemas/review_note.py:24`) | **수정** — 00:00~08:59 KST에 만든 오답노트가 전날로 분류돼 인쇄 기간 필터 경계에서 빠지거나 들어간다 |

**DDL 0(계획서 §6.2 무변 · Alembic 0 · `models.py` diff 0) · 신규 엔드포인트 0 · 기존 응답 순수 가산 2 · 잡 kind 0 · settings 키 0 · localStorage 키 0 · 새 라우트 0 · 신규 의존 0 · 응답에 정답·해설 0(불변 규칙 1 — `preview_available` 불리언 · `run_label` 파일명·URL 수준 라벨) · 미리보기 승인 게이트(R7) 무변 · 프롬프트 출력 JSON 스키마 무변.**

## 2. 확정 규약 (착수 전 결정 — 위임 판정 · 이 문서가 정본 · **사용자 확정 대기 0** · 선택 4건(C·D·E·G)은 권고안 확정 + 대안 표 — **사용자 이견 시 변경**)

- **A. FB-32 백엔드 = 목록 항목 `preview_available` 순수 가산 — `review_ready`(답지 제외)만 계산 · 그 외 `null`** (결정 ①)
  - `import_run_service.py`: 상세의 산출식(`:968~975`)을 **`_preview_available(run, summary) -> bool`** 로 추출(동작 동일 — `run.preview_id` 있으면 `_preview_exists(run.preview_id)` · 없으면 `summary.previews[]` 중 `committed_at` 없는 조각 any) → `get_detail`이 재사용.
  - `run_to_dict(run, last_event=None, *, preview_available: Optional[bool] = None)` — 반환 dict에 `"preview_available": preview_available` 1키. `list_runs`는 항목별로 **`run.status == "review_ready" and run.kind != "answer_key"`일 때만** `_preview_available(run, load_summary(run))`, 그 외 `None`. `get_detail`은 `run` 항목에도 상세와 같은 값을 넣는다(항목 형식 통일 · 최상위 `preview_available` 필드는 그대로 유지 — 기존 소비자 무변).
  - `schemas/import_runs.py` `ImportRunItem.preview_available: Optional[bool] = None`(`null` = 해당 없음 — 검토 대상 상태가 아니거나 답지 run).
  - **비용 규약**: 검사는 `_preview_exists` 그대로(커밋 집합·캐시 dict 조회 → 미스일 때만 `import/auto/` glob 1회) · **복구 호출 0 유지**(`import_service` 복구 경로 호출 금지) · 목록 1쪽(기본 50) × 검토 대기 run만 계산 · 보존본 상한 50(`KEEP_MAX`)이라 glob 1회 = 파일명 50개 내외 비교 → **추가 캐시 계층 신설 0**(YAGNI — 실측 지연이 보이면 요청당 디렉터리 1회 나열로 바꾸는 것은 구현 재량 · 계약 무관).
  - 답지 run을 빼는 이유: [검토]가 미리보기가 아니라 "답지 화면 열기"(`RunCard.tsx:192~199` · 인메모리 key 상태)라 `preview_id` 존재 검사가 의미 없다.
- **B. FB-32 프론트 = 카드가 목록 값으로 즉시 판정 · 상세 값이 오면 상세 우선** (결정 ②)
  - `api/types.ts` `ImportRun`에 `preview_available?: boolean | null`.
  - `RunCard.tsx:97` → **`const previewAvailable = detail ? detail.preview_available : run.preview_available !== false`**(목록 값이 `false`일 때만 비활성 — `null`·필드 없음(구 서버) = 종전처럼 활성) · `:98~99` → `reviewDisabledReason = reviewable && run.kind !== 'answer_key' && !previewAvailable ? '보존 만료 — 다시 반입하세요' : null`.
  - 사유 1줄을 **카드 본문에도** 노출: `reviewDisabledReason && !expanded`일 때 액션 줄 위에 `<p className="text-xs text-warning">`(펼친 상태는 `RunTimeline.tsx:157`이 이미 보여 주므로 중복 0 · 문구는 기존 것 그대로 — 새 문구 0).
  - [검토] `:185` · [합쳐서 검토] `:204`의 `disabled` 식은 그대로(`previewAvailable` 변수만 바뀜) · [변환 JSON 내려받기] `:211~219` 조건 무변.
- **C. FB-33 = 실측 분류 표(§1)를 확정 — 날짜 키 7지점 수정 · `new Date(iso)` 9곳 무접촉 · 공용 유틸 1파일 신설** (결정 ③ · **사용자 이견 시 변경**)
  - 신설 **`frontend/src/utils/serverDate.ts`** — ⓐ `parseServerDate`를 **이 파일로 이동**(구현·주석 그대로) + ⓑ **`toLocalDateKey(d: Date): string`**(`getFullYear`·`getMonth() + 1`·`getDate()`를 `padStart(2, '0')`로 `YYYY-MM-DD` — 로컬 달력 날짜) + ⓒ 파일 머리 주석에 **서버 시각 표기 2종**을 적는다: "UTC naive = DB 컬럼 유래(notes·documents·review_notes 등 `current_timestamp`) + import_runs → `parseServerDate` / 서버 로컬 naive = 인메모리 잡(`created_at`·`started_at`·`finished_at`·`progress.last_activity_at`)·LLM 상태(`resets_at`·`last_success_at`)·improve 파일(`created_at`·`last_seen_at`·`run_at`·`decided_at`) → `new Date(iso)` 그대로 / DATE 키(히트맵 등) = 서버 로컬 날짜 → `toLocalDateKey`".
  - `editor2/api/notes.ts`는 정의를 지우고 **재수출 1줄**(`export { parseServerDate } from '../../utils/serverDate'`) — 기존 import 3곳(`Trash.tsx`·`RunTimeline.tsx`·`NoteListPage.tsx`) **경로 diff 0**. 신규 사용처는 `utils/serverDate`에서 직접 import.
  - 수정 7지점: ⓐ `Heatmap.tsx` `toDateKey` 본문 → `toLocalDateKey(d)`(로컬 함수 삭제하고 import로 대체해도 됨) ⓑ `HeatmapWidget.tsx` `isoDate` 동일 ⓒ `Print.tsx` `todayIso()` → `toLocalDateKey(new Date())` · `monthAgoIso()` → `toLocalDateKey(d)` ⓓ `QuizPrintView.tsx:55` · `ConceptPrintView.tsx:45` "생성일" → `toLocalDateKey(new Date())` ⓔ `WrongNotePrintView.tsx:24` → `const parsed = parseServerDate(n.created_at); const created = Number.isNaN(parsed.getTime()) ? n.created_at.slice(0, 10) : toLocalDateKey(parsed)`.
  - **무접촉(금지)**: 분류 ① 9곳에 `parseServerDate`를 쓰지 않는다 · 분류 ②③ diff 0 · 백엔드 시각 표기 통일(로컬 naive → UTC 또는 오프셋 부착)은 **이 stage 범위 밖**(응답 값 계약 변경 — §4) · 색인 §3 "날짜" 규약에 실측 1구만 추기(편성 시 완료).
  - 전제: 서버와 브라우저(PC·폰)가 같은 시간대(Asia/Seoul — 색인 §3 · 홈 네트워크 전용). 다른 시간대 접속 대응 0.
  - 대안 표(권고 = ⓐ):

    | 안 | 형태 | 장점 | 단점 |
    |---|---|---|---|
    | **ⓐ 날짜 키 7지점을 FB-33 범위로 함께 수정(권고)** | 유틸 1 + 6파일 1~2줄씩 | 같은 "UTC↔KST" 계열을 한 번에 닫음 · 히트맵 당일 미표시 해소 · 백엔드 0 | FB-33 등재 문구("`new Date(iso)` 표준화")보다 범위가 넓다(등재 문구의 9곳은 오히려 무접촉) |
    | ⓑ FB-33은 "지점 0 — 실측 종결"로 닫고 날짜 키 결함은 새 FB로 등재만 | 이 stage 프론트 diff 감소 | 등재 문구에 충실 | 실측으로 확인된 결함(히트맵)을 한 사이클 더 방치 |
- **D. FB-35ⓐ = 해설 규격 블록을 공용 헬퍼 1개로 조립 · 풀이 생성은 항상 · 재생성은 "해설을 고쳐 쓸 때만"** (결정 ④ · **사용자 이견 시 변경**)
  - `convert_service.py`에 **`_explanation_spec_lines(choices: Optional[List[str]]) -> List[str]`** 신설(풀이 생성 절 근처) — `choices`가 2개 이상이면 **객관식 블록**, 아니면 **단답·서술형 블록**을 줄 목록으로 반환. 문구는 아래 정본 그대로(코드에 그대로 옮긴다 — 임의 수정 금지).

    객관식 블록:
    ```text
    ## 해설 작성 규격(explanation 필드 — Markdown · 엄수)
    explanation은 아래 세 부분을 이 순서로 쓴다. 각 부분은 굵은 라벨 한 줄로 시작한다(라벨 문구 고정).
    **정답 근거** — 정답 보기가 왜 맞는지를 2~4문장으로: 핵심 개념의 정의 + 이 문제의 조건이 그 정의에 어떻게 대응하는지.
    **오답 보기** — 정답이 아닌 보기를 하나도 빠뜨리지 말고 보기 번호(1부터) 순서의 목록으로 쓴다. 보기마다 1~2문장: 그 보기가 가리키는 개념이 무엇인지 + 왜 이 문제의 답이 아닌지(정답과의 차이). 형식: "- 1번(보기 내용 요약): 설명"
    **핵심 개념** — 이 문제에서 외울 포인트 한 줄.
    분량: 전체 400~700자(보기가 5개 이상이면 900자까지). 그보다 짧게 끝내지 말고, 같은 말을 반복해 늘리지도 않는다.
    창작 금지: 교과서·표준 정의 수준의 사실만 쓴다. 확신할 수 없는 보기는 추측하지 말고 "근거 부족 — 원본 확인 필요"라고만 적는다. 원본 자료에 해설이 있으면 그 내용을 우선하고 이 규격에 맞게 배열만 한다. 문제·보기에 없는 수치·출처·사례를 만들어 넣지 않는다.
    ```
    단답·서술형 블록:
    ```text
    ## 해설 작성 규격(explanation 필드 — Markdown · 엄수)
    explanation은 아래 두 부분을 이 순서로 쓴다. 각 부분은 굵은 라벨 한 줄로 시작한다(라벨 문구 고정).
    **정답 근거** — 정답이 왜 그렇게 되는지를 3~5문장으로: 핵심 개념의 정의 + 풀이 과정(계산 문제는 단계별 식).
    **핵심 개념** — 이 문제에서 외울 포인트 한 줄.
    분량: 전체 200~400자. 그보다 짧게 끝내지 말고, 같은 말을 반복해 늘리지도 않는다.
    창작 금지: 교과서·표준 정의 수준의 사실만 쓴다. 확신할 수 없는 내용은 추측하지 말고 "근거 부족 — 원본 확인 필요"라고만 적는다. 원본 자료에 해설이 있으면 그 내용을 우선하고 이 규격에 맞게 배열만 한다. 문제에 없는 수치·출처·사례를 만들어 넣지 않는다.
    ```
  - **풀이 생성**(`_build_explain_prompt`): 규격 블록을 `"## 출력 형식(엄수)"` **바로 앞**에 삽입(빈 줄 1 + 블록) · 머리 지시 2줄(`:3113~3114`)·문제 블록·원본 대조 지시·출력 형식 줄 **문구 무변**.
  - **재생성**(`_build_regenerate_prompt`): `document.type in import_service.QUESTION_TYPES`일 때만 같은 위치(`"## 출력 형식(엄수)"` 앞)에 **조건 1줄 + 규격 블록** — 조건 문구 정본: `explanation을 새로 쓰거나 고쳐 쓰는 경우에만 아래 규격을 따른다. 신고 사유가 해설과 무관하면 기존 explanation을 그대로 둔다(규격에 맞추려고 다시 쓰지 않는다).` → "전면 재작성 금지"(`:2605~2606`) 원칙과 충돌 0. 개념(concept) 등 비문제 타입 = 규격 미삽입(현행 그대로).
  - **무변**: 출력 JSON 스키마(`{"explanation", "answer"}` · 재생성 7필드) · `_normalize_explain_draft`·`_normalize_regenerate_draft`(길이 검증·잘라내기 0 — 규격은 프롬프트 지시만) · 마커 라인(`[AI 생성 해설` — apply 시 서버 부착) · 대상 제한(해설 있으면 409) · 사용량 확인 스텝 · 엔진·모델·타임아웃 · `prompts/convert.md`(변환은 해설을 만들지 않는다 — 원본에 있으면 옮기기만) · 답지 가공·AI 응용 문항(§4.21) 프롬프트.
  - 기존 짧은 AI 해설의 보강 = 사용자가 [오류 신고] 사유에 해설 보강을 적어 재생성(경로 그대로 · 일괄 재생성 0).
  - 대안 표(권고 = ⓐ):

    | 안 | 형태 | 장점 | 단점 |
    |---|---|---|---|
    | **ⓐ 굵은 라벨 3부(권고)** | `**정답 근거**` 류 라벨 + 목록 | 해설 패널·오답노트·인쇄에서 본문 크기 그대로 · 기존 Markdown 렌더 무변 | 라벨이 제목만큼 눈에 띄지는 않음 |
    | ⓑ Markdown 소제목(`###`) 3부 | 헤딩 3개 | 구획이 뚜렷 | 문서 본문 헤딩 스타일·목차·인쇄 여백과 섞임(해설 안 헤딩 전례 0) |
    | ⓒ 구성 자유 + 분량만 지시 | 길이 지시 1줄 | 프롬프트 최소 | "오답 보기별 설명" 요구(FB-35 원문)를 보장 못 함 |
- **E. FB-35ⓐ 검증 = 프롬프트 조립 단위 테스트(LLM 0) + 사용자 실사용 표본 10문항(발행 게이트) — 에이전트 LLM 실호출 0** (결정 ⑤ · **사용자 이견 시 변경**)
  - 자동(에이전트): `backend/tests/test_explanation_spec.py` 신설 — 규격 블록 포함·분기·출력 형식 줄 불변을 문자열 단언(B-7). **LLM 실호출 0**(사용자 PC의 Claude CLI 사용량을 에이전트가 쓰지 않는다).
  - 사용자(DoD 6 — 발행 게이트): 실사용에서 **표본 10문항**(권장 = 객관식 8 + 단답·서술형 2 · 해설 없는 문항은 문서 상세 [AI 풀이 생성] · 기존 짧은 AI 해설은 [오류 신고] → 사유 "해설 보강" 재생성)의 **초안**을 확인 — 기준 4: ① 오답 보기가 전부 언급됨 ② 정답 근거가 문제 조건과 맞물림 ③ 창작 의심(문제에 없는 수치·출처·사례) 0 ④ 분량이 과소·과다 아님. 부적합 초안은 **승인하지 않고 폐기**(R7 — 실 문서 무변). **부적합 2건 이하 = 통과 · 3건 이상 = 규격 문구 보정 후 재표본(발행 보류)**.
  - 대안 표(권고 = ⓐ):

    | 안 | 형태 | 장점 | 단점 |
    |---|---|---|---|
    | **ⓐ 사용자 실사용 표본으로 갈음(권고)** | 발행 게이트에 표본 10문항 회신 | 사용량 지출을 사용자가 통제 · 실 문항·실 엔진 조건 그대로 · 승인 게이트가 오염 차단 | 발행이 사용자 회신에 묶임 |
    | ⓑ 에이전트 실호출(사용자 명시 승인 시에만) | 스크립트가 프롬프트를 만들어 CLI에 직접 전달 | 발행 전 수치 근거 확보 | 사용량 소모 — **상한 10회(문항당 1회 · 재시도 0 · 폴백 0)** · 서버 구동 0 · `study.db` 읽기 전용 열기 또는 사본 · **저장 0(apply 0)** · 결과는 §7에 판정 요약만(해설 원문 커밋 금지) |
- **F. FB-36 백엔드 = 잡 항목 `run_label` 순수 가산(결정 1 = 등록부 권장안) — 잡 레코드에 시작 시 심고 목록은 그대로 옮긴다(DB 조회 0 유지)** (결정 ⑥)
  - `convert_service.py`: `_new_job_base`에 **`"_run_label": None`**(`_run_id` 다음 줄) · `_job_list_item`에 **`"run_label": job.get("_run_label")`**(`run_id` 다음 줄 — §4.24 ① "인메모리 파생 · DB 0" 불변) · 신설 **`set_job_run_label(job_ids: Sequence[str], label: Optional[str]) -> None`**(`_JOBS_LOCK` 안에서 존재하는 잡의 `_run_label`만 설정 · `label`이 비면 no-op · `job_label` 근처).
  - `import_run_service.py`: 신설 **`plant_run_label(db, run_id: Optional[int], job_ids: Sequence[str]) -> None`** — `run_id`가 None이거나 run이 없으면 no-op · `run.label`을 **읽기만** 해 `convert_service.set_job_run_label(job_ids, run.label)` 호출 · 예외는 삼키고 경고 로그(best-effort — 원 흐름 무영향 · DB 쓰기 0). 심는 지점 4: ⓐ `start_with_run` — `label` 산출·`run.label` 갱신 블록(`:1104~1118`) 안에서 `convert_service.set_job_run_label([job_id], label)`(추가 DB 읽기 0 — run 라벨 = 잡 라벨) ⓑ `note_split_enqueued` 끝(`_best_effort` 뒤) `plant_run_label(db, run_id, job_ids)` ⓒ `note_job_assigned` 끝 `plant_run_label(db, run_id, [job_id])` ⓓ `routers/split.py` `start_analyze` — 잡 시작(`:102~108`) 직후 `import_run_service.plant_run_label(db, run_id, [job_id])` 1줄.
  - `schemas/llm.py` `JobListItem.run_label: Optional[str] = None`(`run_id` 다음).
  - 값의 뜻: **반입 건 라벨(시작 시점 스냅숏 · 서버 완성 문구 · 파일명·URL·회차 수준 — 정답·해설 0)**. 비반입 kind·레거시 잡·심기 전 찰나 = `null`. 잡 `label`(조각별 문구)과 별개 필드 — `label` 무변.
  - 기각: 클라이언트가 `GET /api/import/runs`와 조인(요청 1회 추가 + 비활성·다른 쪽 run 누락 가능) · `start_*_job` 5곳에 `run_label=` 인자 추가(시그니처 변경 범위 과다).
- **G. FB-36 프론트 = "같은 run의 잡이 2개 이상일 때만" 그룹 · 헤더 집계는 목록에 보이는 잡 기준** (결정 ⑦ · **사용자 이견 시 변경**)
  - **묶음 규칙**(순수 함수 `utils/jobGroups.ts` `groupJobsByRun(items)` 신설): `run_id != null`인 잡을 run별로 세어 **2개 이상인 run만 그룹** · 1개뿐이면 **평면 그대로**(헤더 + 1행 중복 방지 — 비분할 반입은 잡 1개 = 종전 화면) · `run_id` 없는 잡(regenerate·explain·applied_exam·improve·레거시) = 평면. 반환 = `Array<{ type: 'single'; item } | { type: 'group'; runId; label; items }>`.
  - **순서**: 서버 정렬(running → queued 등록순 → 종료 최신순)을 보존 — 그룹은 **그 run의 첫 항목이 나온 자리**에 1번 놓고 나머지 항목은 서버 순서대로 그룹 안에 모은다(→ 진행 중 잡이 있는 그룹이 자연히 위 · 정렬 재계산 0).
  - **헤더**: 라벨 = 그룹 내 첫 non-null `run_label`(서버 값 그대로) · 전부 null이면 그룹 첫 항목의 `label`(서버 값 — 프론트 문구 조립 0) + 집계 1줄 **`작업 N개 · 진행 중 a · 대기 b · 완료 c · 실패 d · 취소 e`**(0인 항목 생략 · 유한 상태 enum → 고정 한국어 라벨 + 숫자 — §5.14 관례). **"조각 k/N"은 쓰지 않는다** — 잡 목록에는 조각 총수가 없고 TTL·지우기로 빠진 잡은 세지 못한다(정확한 조각 k/N의 정본 = 반입 건 카드 — [카드로 이동]).
  - **접기/펼치기**: 헤더 클릭(버튼 `aria-expanded`) · **기본 펼침** · 접힘 상태 = 패널 로컬 `useState`(run id 집합 · 저장 0 · localStorage 0) · 접힌 그룹 = 헤더(라벨·집계·액션)만.
  - **헤더 액션 3**: ⓐ **[카드로 이동]** = `<Link to={`/import?run=${runId}`}>` + `onClose` · 그룹 안 개별 잡의 [화면으로 이동]은 **숨김**(같은 목적지 중복) ⓑ **[모두 취소]** — 그룹에 취소 가능(`queued`·`running`) 잡이 1개 이상일 때만 · **대기 잡 전부 먼저 → 실행 중 잡 마지막** 순서로 `POST /api/llm/jobs/{id}/cancel` 순차 호출(서버 일괄 API 0 — 실행 중을 먼저 끊으면 다음 대기 잡이 곧장 시작된다) · 실행 중 잡이 **있으면** 기존 확인 다이얼로그(제목 "작업 취소" · 고정 문구 "실행 중 취소는 이미 처리된 토큰만큼 요금이 발생할 수 있습니다." — `:245~255` 재사용 · 문구 무변) 승인 후 전체 실행 · 다이얼로그를 닫으면 **아무것도 취소하지 않는다** · 실행 중 잡이 **없으면** 확인 없이 즉시(대기 취소 = 비용 0 — §4.24 ② 관례) ⓒ **[목록에서 지우기]** — 그룹에 종료(`done`·`error`·`cancelled`) 잡이 1개 이상일 때만 · 그 잡들을 `DELETE /api/llm/jobs/{id}` 순차 호출(잡 목록에서만 사라진다 — 반입 건 카드·run 상태 무관).
  - **순차 호출 오류 처리**: `mutateAsync` 루프 · `ApiError.status`가 **409·404면 건너뜀**(완료 경합·TTL 만료 — 표시 0) · 그 외 오류는 **중단하지 않고 계속**한 뒤 첫 오류의 서버 `message`를 기존 `actionError` 자리에 표시 · 실행 동안 그룹 액션 버튼 `disabled`.
  - **그룹 안 잡 행**: 종전 행 그대로(상태 배지 · `label` · 진행 표시 · 오류 문구 · 개별 [취소] · 개별 [목록에서 지우기]) — [화면으로 이동]만 헤더로 올라간다. **대기 순번**(`대기 중 (n번째)`)은 그룹과 무관한 **전역 순번**(그룹화 전에 `job_id → 순번` 맵으로 계산).
  - **구성**: `components/JobCenterRunGroup.tsx` 신설(헤더·접기·일괄 액션) + `JobCenterPanel.tsx`는 잡 1행 렌더를 내부 함수/컴포넌트로 뽑아 평면·그룹이 공유(행 마크업·클래스 diff 최소) · 색 = 기존 토큰 클래스만(그룹 테두리 `border-border` · 헤더 `bg-surface-raised` 류 — 새 색 리터럴 0).
  - **무변**: 사이드바·드로어 배지 수(진행 잡 수) · 폴링(전역 1곳) · 일시정지 토글·안내 문구 · `jobRoutes.ts` · 빈 목록 문구 · 폰 바텀 시트/PC 슬라이드 오버 레이아웃.
  - 대안 표(권고 = ⓐ):

    | 안 | 형태 | 장점 | 단점 |
    |---|---|---|---|
    | **ⓐ 2개 이상만 그룹 · 목록 기준 집계 · 실행 중 포함 시에만 확인(권고)** | 위 규약 | 비분할 반입 화면 무변 · 백엔드 가산 1필드 · 등록부 문구("대기 즉시 + 실행 중 확인")와 일치 | 헤더가 "조각 k/N"이 아님 · 대기 다건이 확인 없이 한 번에 취소됨 |
    | ⓑ `run_id` 있으면 1개여도 항상 그룹 | 일관 표시 | 규칙 단순 | 잡 1개 반입마다 헤더 + 1행 중복 |
    | ⓒ 헤더에 "조각 k/N"(잡 항목 `run_chunks_total` 추가 가산) | 카드와 같은 숫자 | 숫자 일치 | 백엔드 가산 1필드 더 + 분할 투입 시 DB 읽기 추가 · 카드가 이미 정본 |
    | ⓓ [모두 취소]는 항상 확인 다이얼로그 | 실수 방지 | 다건 오취소 0 | §4.24 ② "대기 취소 = 확인 없음" 관례와 불일치 · 새 문구 필요 |
- **H. 매뉴얼** (결정 ⑧) — `docs/manual/user-manual.html`: ⓐ LLM 작업 센터 설명 절(Grep `LLM 작업` — 1729·1754·2191~2241행 부근)에 "분할 반입처럼 한 반입 건에 작업이 여러 개면 묶음으로 보이고, 묶음에서 [카드로 이동]·[모두 취소]·[목록에서 지우기]를 쓸 수 있다" 1문단 ⓑ AI 풀이 생성 절(Grep `풀이 생성` — 1845~1852·2193·2218행 부근)에 "해설은 정답 근거 · 오답 보기별 설명 · 핵심 개념 순으로 생성된다 · 기존 짧은 해설은 [오류 신고]로 보강" 1구 ⓒ 반입 건 카드 설명에 "보존 기간이 지난 건은 [검토]가 비활성으로 보인다" 1구(해당 문단이 있으면). 완료 시 반영(D-1) · 행 번호는 구현 시 Grep 재확인.

## 3. 체크리스트

**B. 백엔드 (`backend/`)**
- [x] B-1 (FB-32 · 규약 A) `services/import_run_service.py` — `_preview_available(run, summary)` 추출(`get_detail :968~975` 식 그대로) · `run_to_dict`에 키워드 인자 `preview_available: Optional[bool] = None` + 반환 dict 1키 · `list_runs`가 `review_ready`(답지 제외) 항목만 계산해 전달(그 외 `None`) · `get_detail`은 `run` 항목·최상위 필드에 같은 값. `_preview_exists` 본문 diff 0(복구 호출 0 유지). ← 실측(2026-11-09): 목록 계산 조건은 헬퍼 `_list_checks_preview(run)` 1개로 분리(규약 A 그대로 · 편차 0).
- [x] B-2 (FB-32) `schemas/import_runs.py` `ImportRunItem`에 `preview_available: Optional[bool] = None`.
- [x] B-3 (FB-36 · 규약 F) `services/convert_service.py` — `_new_job_base` `"_run_label": None` · `_job_list_item` `"run_label": job.get("_run_label")` · `set_job_run_label(job_ids, label)` 신설(`_JOBS_LOCK` · 인메모리만).
- [x] B-4 (FB-36 · 규약 F) `services/import_run_service.py` `plant_run_label(db, run_id, job_ids)` 신설(읽기 1 · 쓰기 0 · best-effort) + 심는 지점 ⓐ `start_with_run` ⓑ `note_split_enqueued` ⓒ `note_job_assigned` · ⓓ `routers/split.py` `start_analyze` 잡 시작 직후 1줄.
- [x] B-5 (FB-36) `schemas/llm.py` `JobListItem`에 `run_label: Optional[str] = None`.
- [x] B-6 (FB-35ⓐ · 규약 D) `services/convert_service.py` — `_explanation_spec_lines(choices)` 신설(객관식·단답 블록 문구 = §2 D 정본 그대로) · `_build_explain_prompt`의 `"## 출력 형식(엄수)"` 앞 삽입 · `_build_regenerate_prompt`는 `document.type in import_service.QUESTION_TYPES`일 때만 조건 1줄 + 블록 삽입. 출력 형식 줄·정규화 함수·마커·대상 제한 diff 0.
- [x] B-7 테스트(LLM 0) — `tests/test_import_runs.py`에 ⓐ 목록 항목 `preview_available`: `review_ready` + 캐시 존재 = true · 커밋 완료 또는 캐시·보존본 없음 = false · `queued`·`failed`·답지 run = null ⓑ 잡 항목 `run_label`: `start_with_run` 경로 = run 라벨 · `plant_run_label`(분할 조각 2개) = 같은 라벨 · run 없는 잡 = null. `tests/test_explanation_spec.py` 신설 — ⓒ 객관식 풀이 프롬프트에 "정답 근거"·"오답 보기"·"핵심 개념"·"400~700자"·"창작 금지" 포함 ⓓ `choices=None`이면 "오답 보기" 미포함 + "200~400자" ⓔ 재생성(문제 타입)에 조건 1줄 + 블록 ⓕ 재생성(concept)에 블록 미포함 ⓖ 두 프롬프트의 출력 형식 JSON 줄 문자열 불변. ← 실측(2026-11-09): `test_import_runs.py` 21 passed · `test_explanation_spec.py` 5 passed(신규) · 검토 경미 ③ = `run_label` 단언 보강(`assert run_label` — `6753aa9`).
- [x] B-8 DDL 0 확인 — `git diff --stat -- backend/models.py backend/alembic` 빈 출력 · `routers/` diff = `split.py` 1줄뿐 · 신규 라우트 0. ← 실측(2026-11-09): `models.py`·`alembic/`·`prompts/` diff 0 · `routers/` diff = `split.py` 1줄.

**F. 프론트 (`frontend/src/`)**
- [x] F-1 `api/types.ts` — `ImportRun.preview_available?: boolean | null`(FB-32) · `LlmJobItem.run_label?: string | null`(FB-36 · `run_id` 다음 줄). ← 실측(2026-11-09): 타입 2줄은 메인이 선반영(프론트 2묶음 병렬의 공통 전제).
- [x] F-2 (FB-32 · 규약 B) `pages/import/RunCard.tsx` — `previewAvailable`·`reviewDisabledReason` 식 교체(`:97~99`) · 접힌 상태 사유 1줄(`text-xs text-warning`) · [검토]·[합쳐서 검토] `disabled` 식과 [변환 JSON 내려받기] 조건 무변 · `RunTimeline.tsx` diff 0.
- [x] F-3 (FB-33 · 규약 C) `utils/serverDate.ts` 신설(`parseServerDate` 이동 + `toLocalDateKey` + 머리 주석 "서버 시각 표기 2종") · `editor2/api/notes.ts`는 정의 삭제 + 재수출 1줄(기존 import 3곳 경로 diff 0).
- [x] F-4 (FB-33 · 규약 C) 날짜 키 7지점 — `components/Heatmap.tsx:12` · `components/home/HeatmapWidget.tsx:12` · `pages/Print.tsx:18·24` · `components/print/QuizPrintView.tsx:55` · `components/print/ConceptPrintView.tsx:45` → `toLocalDateKey` · `components/print/WrongNotePrintView.tsx:24` → `toLocalDateKey(parseServerDate(…))`(NaN이면 종전 절단). **분류 ① 9곳·②③ 무접촉**(§1 표).
- [x] F-5 (FB-36 · 규약 G) `utils/jobGroups.ts` 신설 — `groupJobsByRun(items)`(2개 이상만 그룹 · 첫 등장 자리 · 서버 순서 보존 · 라벨 폴백).
- [x] F-6 (FB-36 · 규약 G) `components/JobCenterRunGroup.tsx` 신설(헤더 라벨·집계·접기·[카드로 이동]·[모두 취소]·[목록에서 지우기]) + `components/JobCenterPanel.tsx` — 잡 1행 렌더 공유 · 전역 대기 순번 맵 · 그룹 접힘 로컬 상태 · 일괄 취소(대기 → 실행 중 순 · 실행 중 포함 시 기존 확인 다이얼로그 재사용)·일괄 지우기(순차 · 409·404 건너뜀) · 그룹 안 [화면으로 이동] 숨김. `api/llm.ts`·`utils/jobRoutes.ts`·`LlmJobProgress.tsx`·`ConfirmDialog.tsx` diff 0.
- [x] F-7 색·간격 = 토큰·기존 유틸 클래스만(불변 규칙 5 · `tokens.css` 무변 · 새 색 리터럴 0) · `npx tsc --noEmit` 통과 · 엔트리 청크 Δ 기록(R37 — 직전 커밋 dist 대비 · `JobCenterPanel`·`serverDate` = 앱 셸) · 빌드 산출물 커밋 정책은 저장소 관례대로. ← 실측(2026-11-09): `tsc --noEmit` 0 · 엔트리 청크 1,532,227 → 1,534,106 B(Δ +1,879 B · R37 — 기준선 1,532,227 대비) · 검토 경미 ② = `JobCenterPanel.tsx` 잉여 빈 줄 정리(`6753aa9`).

**V. 검증 (서버 구동 금지 — `2_StartServer.bat` 주인은 사용자 · 자체 검증만 임시 포트 8765(8000 금지) · 종료 + 리스너 부재 확인 · 실 데이터 무접촉 — 빈 DB(`alembic upgrade head`)·격리 워크트리 · **LLM 실호출 0**(규약 E))**
- [x] V-1 `powershell -ExecutionPolicy Bypass -File scripts/run-tests.ps1 -Path tests/test_import_runs.py`·`-Path tests/test_explanation_spec.py`·`-Path tests/test_job_center.py`·`-Path tests/test_answer_key_explain.py` 통과 + `-Full` 1회(회귀 0 — `applied_exam` 2건의 claude CLI PATH 의존 실패는 코드 회귀 아님) · `scripts/invariant-scan.ps1` PASS(신규 위반 0 — 기준선 갱신 0) · `npm run build` 성공(성공/실패만). ← 실측(2026-11-09): 21 · 5 · 36 · 22 passed · `-Full` 710 passed(실패 0 — `applied_exam` 2건도 통과) · invariant PASS(신규 위반 0 · 기준선 갱신 0) · 빌드 성공.
- [x] V-2 API 실측(임시 포트 8765 · 빈 DB · LLM 0): ⓐ 변환 JSON 업로드(`POST /api/import/preview`) → `GET /api/import/runs` 항목 `preview_available: true` → 커밋 후 항목 `null`(상태 `committed`) ⓑ `import/auto/` 보존본·캐시가 없는 `review_ready` run(서버 재시작으로 캐시 소실 + json_upload는 보존본 없음) → 항목 `false` ⓒ 비지원 포맷 파일 `POST /api/convert`(LLM 도달 전 실패 — stage-56 실측 전례 `failed/unsupported_format`) → `GET /api/llm/jobs` 항목 `run_label` = run `label`(격리 환경에 가용 엔진이 없어 시작 자체가 거부되면 이 항목과 null 케이스는 B-7 테스트로 갈음) ⓓ 응답 어디에도 정답·해설 키 0. ← 실측(2026-11-09): ⓐⓑⓓ 원문대로 통과 · **ⓒ는 원문(비지원 포맷 실패 경로)과 다르게 "큐 일시정지 → `POST /api/convert`(OLE 매직 `.doc`) → `queued` 유지" 순서로 실측**(LLM 도달 가능성 0 보장 목적의 순서 변경 — 잡 항목 `run_label` = run `label` 확인 → 잡 취소 → 재개).
- [x] V-3 브라우저 실측(사용자가 띄운 `localhost:8000` 또는 임시 포트 8765 + 빈 DB · 데스크톱 폭 + 390px 에뮬 · 콘솔 `pattern` 필터): ⓐ **FB-32** — V-2 ⓑ 상태의 카드가 [자세히]를 펼치지 않아도 [검토] 비활성 + "보존 만료 — 다시 반입하세요" 1줄 · 펼치면 사유 1줄만(중복 0) · 정상 run은 [검토] 활성 ⓑ **FB-36 그룹** — 큰 텍스트(26만 자 txt)를 파일 소스로 올려 `too_large` 실패(LLM 도달 전 — stage-56 실측 전례)를 만든 뒤 **작업 센터 [일시정지]를 먼저 누르고** 카드 [분할 반입] → 분할 위저드(휴리스틱 분할안만 — **LLM 정밀 분석 버튼은 누르지 않는다**) → 조각 2개 이상 투입(일시정지라 전부 `queued` — **LLM 0**) → 작업 센터에 그룹 1개(헤더 라벨 = 반입 건 라벨 · "작업 N개 · 대기 N") · 접기/펼치기 · [카드로 이동] = `/import?run=` + 패널 닫힘 · 대기 순번이 전역 순번 ⓒ 그룹 [모두 취소] = 확인 없이 전부 취소됨(대기만) → 헤더 집계 "취소 N" → [목록에서 지우기]로 그룹 소멸 → **[재개]로 일시정지 해제**(뒷정리) ⓓ `run_id` 없는 잡·잡 1개 run은 평면 그대로(코드 검토 갈음 가능) · 실행 중 포함 [모두 취소]의 확인 다이얼로그 경로는 **코드 검토 갈음**(LLM 실호출 금지) ⓔ **FB-33** — 홈 히트맵에서 미래가 아닌 마지막 칸의 툴팁 날짜 = **오늘(로컬)** · 요일 행이 실제 요일과 일치(수정 전 dist로 "어제 날짜"가 재현되면 전·후를 §7에 기록) · `/print` 오답노트 기본 종료일 = 오늘 · "생성일" = 오늘 ⓕ 390px — 그룹 헤더 액션 줄바꿈 허용 · 가로 스크롤 0 · 하단 탭바 5 무변 ⓖ 콘솔 에러 0. ← 실측(2026-11-09): ⓐⓑⓒⓔⓕⓖ 통과 · **ⓓ 관찰 불가**(단일 잡 run·`run_id` 없는 잡이 목록에 없었음 — 코드 검토 갈음) · **ⓔ 중 인쇄 미리보기 "생성일"은 빈 DB라 미리보기가 렌더되지 않아 미확인**(코드 변경은 동일 유틸 1줄 치환) · ⓖ는 도구 특성상 `/print` 로드 이후 구간만 추적 — 상세 §7.

**D. 문서**
- [x] D-1 매뉴얼 `docs/manual/user-manual.html`(규약 H — 작업 센터 묶음 · 해설 구성 · [검토] 비활성 1구).
- [x] D-2 설계 — api §4.34 ④ `[S57]`·§4.24 `[S57]`·§4.20 ② `[S57]` + screens §5.9 S56 B `← S57`·§5.14 run 그룹 "편성" → "구현 실측 확정" 표기(편차 있으면 1구) · 색인 상태 줄 **v1.75**(최근 3건 규칙으로 밀리는 판 v1.71은 `docs/04-archive/design-changelog.md` 맨 위로 이동만).
- [x] D-3 `docs/03-release/CHANGELOG.md` 항목(§6 ①) · `stage-index.md` 57행 · 이 문서 §7 완료 기록 · 체크박스 `[x]`.
- [x] D-4 `backlog.md` — FB-32·FB-33·FB-36 §4 종결 이동 · FB-35는 §1 잔류(ⓑ) — §6 ④ · 기준일 줄 · `scripts/backlog-scan.ps1` PASS.
- [x] D-5 출처 추기 — 별지 §13 FB-32·FB-33·FB-35·FB-36 배정 셀 끝 `← 완료(stage-57 · 날짜 · …)` · `CLAUDE.md` 머리 버전 줄·`VERSION`(발행 시 — 사용자 회신 후). ← 이행(2026-11-09): **출처 추기분만** 이행 — `VERSION`(2.04.1 유지)·`CLAUDE.md` 버전 줄·git tag는 **발행 시**(DoD 6·7 사용자 회신 후 별도 release PR).

## 4. 이 단계에서 하지 않는 것 (불변 규칙 9 — 이 절이 우선)

- **FB-35 ⓑ 적응형 깊이 0** — 난이도(`difficulty`) 산출 규칙 · 오답 이력(`attempts`·`stats_service`) 프롬프트 주입 · 상세 등급 3단 · [더 자세히] 온디맨드 생성 · 등급 메타 저장 · 출력 토큰 상한 조정 전부 **미편성**(핵심 후보 · 착수 전 결정 D 필요 — 별지 §13 531행). **순서 = ⓐ 발행 → 사용자 회신 → ⓑ 별도 편성.**
- **기존 해설 일괄 재생성 0**(비용 — 별도 결정) · `prompts/convert.md`·답지 가공·AI 응용 문항·개선 제안 프롬프트 무접촉 · 출력 JSON 스키마·정규화·마커 라인·대상 제한(409)·사용량 확인 스텝 무변 · 해설 길이 서버 검증·잘라내기 0 · 해설 렌더(MarkdownView)·인쇄 레이아웃 diff 0.
- **백엔드 시각 표기 통일 0** — UTC naive(DB 유래)와 서버 로컬 naive(인메모리·파일 유래)의 혼재는 **실측 기록만**(색인 §3 1구 · `serverDate.ts` 주석) · 응답 값 계약 변경(오프셋 부착·UTC 통일)은 별도 결정 사항. **분류 ① 9곳에 `parseServerDate` 적용 금지** · `BackupManager`의 시각 원문 표기 · SRS due·D-Day 계산 · `stats_service` 무접촉 · 다른 시간대 접속 대응 0.
- **서버 일괄 취소·일괄 지우기 API 0**(클라이언트 순차 호출만) · 잡 영속화·이력 테이블 0 · 잡 지우기 ↔ run dismiss 연동 0 · `run_chunks_total` 등 추가 가산 0 · `run_id` 없는 잡의 kind별 묶음 0 · 그룹 접힘 상태 저장 0 · 배지 수치·폴링 간격·정렬 계약·일시정지·취소 응답 무변 · `jobRoutes.ts` diff 0 · `start_*_job` 시그니처 변경 0.
- **FB-32 범위 한정** — 목록에서 미리보기 복구 호출 0 · 답지 run 계산 0(`null`) · 캐시 계층 신설 0 · [변환 JSON 내려받기] 노출 조건 변경 0 · 타임라인 조각별 [검토]는 상세 값 그대로 · 보존 정책(R18 — 50건·TTL 1h) 무변.
- **FB-34(`runs/adopt` 퇴역) 0** — 다음 핵심 stage 동승 조건 그대로 · `legacyQueueAdopt.ts` 무접촉.
- **stage-54 캡처 무접촉** — `capture.plan.md`·`stage-54-capture-slice-1.plan.md`·api §4.33·screens §5.18 diff 0.
- DDL 0(§6.2·`models.py`·Alembic) · 신규 엔드포인트 0 · 신규 의존 0 · settings 키 0 · localStorage 키 0 · 새 라우트 0 · 하단 탭바 5 무변 · 미리보기 승인·커밋 흐름(R7) 무변 · 응답에 정답·해설 0(불변 규칙 1).

## 5. DoD (완료 정의)

**자동 검증(에이전트 수행):**
1. `run-tests.ps1` 대상 4파일 + `-Full` 통과(회귀 0) · `invariant-scan.ps1` PASS(기준선 갱신 0) · `npm run build` 성공 · DDL 0(B-8).
2. 백엔드 diff = `services/import_run_service.py`·`services/convert_service.py`·`schemas/import_runs.py`·`schemas/llm.py`·`routers/split.py` + `tests/test_import_runs.py`·`tests/test_explanation_spec.py`(신규) **안** · `models.py`·`alembic/`·`prompts/` 무접촉.
3. 프론트 diff = `api/types.ts`·`pages/import/RunCard.tsx`·`utils/serverDate.ts`(신규)·`editor2/api/notes.ts`·`components/Heatmap.tsx`·`components/home/HeatmapWidget.tsx`·`pages/Print.tsx`·`components/print/{QuizPrintView,ConceptPrintView,WrongNotePrintView}.tsx`·`utils/jobGroups.ts`(신규)·`components/JobCenterRunGroup.tsx`(신규)·`components/JobCenterPanel.tsx` **13파일 안** · §1 분류 ① 8파일·`RunTimeline.tsx`·`jobRoutes.ts`·`api/llm.ts` 무접촉 · 새 색 리터럴 0 · 엔트리 청크 Δ 기록(R37).
4. API 실측 V-2 ⓐ~ⓓ + 브라우저 V-3 ⓐ~ⓖ 통과(LLM 실호출 0 · 실 데이터 무접촉 · 임시 서버 종료 + 리스너 부재 확인).
5. 문서 묶음 D-1~D-5(매뉴얼 · Design v1.75 · CHANGELOG · stage-index · backlog · 별지 FB `← 완료`).

**사용자 확인(게이트 본체):**
6. **해설 표본 10문항**(규약 E ⓐ) — 기준 4(오답 보기 전부 언급 · 정답 근거가 문제 조건과 맞물림 · 창작 의심 0 · 분량 적정) · **부적합 2건 이하 회신 = 통과** · 굵은 라벨 3부 형식이 읽기 좋은지(**규약 D 대안 ⓑ·ⓒ로 바꿀지 회신**).
7. **실사용** — ⓐ 작업 센터에서 분할 반입 잡이 한 묶음으로 보이고 [모두 취소]·[목록에서 지우기]가 기대대로 동작(**규약 G 대안 ⓑ·ⓒ·ⓓ 필요 여부 회신**) ⓑ 보존 만료 반입 건의 [검토]가 펼치기 전부터 비활성 ⓒ 홈 히트맵에 오늘 학습분이 당일 표시되고 요일이 맞음 · 오답노트 인쇄 기간 필터가 날짜 경계에서 맞음 ⓓ **폰 실기기** — 작업 센터 바텀 시트의 그룹 헤더·액션 줄바꿈 · 히트맵 오늘 칸 · **치명 결함 0 회신** = 발행 게이트.

**게이트**: 1~5 전건 + 6 통과 + 7 치명 0 → 발행(§6 ①). 6에서 부적합 3건 이상이면 규격 문구 보정 후 재표본(발행 보류 — FB-32·33·36분만 먼저 발행할지는 그때 사용자 판단). **착수 게이트: 없음**(사용자 확정 대기 0 — 권고안 확정 · 이견 시 해당 규약만 교체).

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` — **v2.04.2 항목 1개**(사소 · 규약 ② PP+1). **단독 발행**: 미발행 핵심 stage 없음(stage-54는 착수 전) → stage-57은 v2.04.2로 단독 발행(stage-57 완료 전에 stage-54가 완료·미발행 상태가 되면 그때 v2.05.1 합류 판정). 불릿 = 반입 건 카드 [검토] 보존 만료 즉시 표시 · 작업 센터 반입 건 묶음(모두 취소·지우기) · AI 해설 구성 규격(정답 근거·오답 보기·핵심 개념) · 히트맵·인쇄 날짜 하루 밀림 수정 · 신규 엔드포인트 0 · DDL 0.
2. 루트 `VERSION` 2.04.2 — 사용자 회신(DoD 6·7) 후.
3. `stage-index.md` 57행 갱신(완료·일자·산출 버전).
4. `backlog.md` — **FB-32·FB-33·FB-36** 행 §1 → §4 종결 이동(`종결(stage-57 · 날짜)`) · **FB-35**는 ⓐ만 종결이라 행 **§1 잔류** + 상태 `미편성(ⓑ 적응형 깊이 — ⓐ 완료 stage-57 · 날짜 · ⓐ 회신 후 착수 전 결정 D 등재)` · 기준일 줄 갱신 · `scripts/backlog-scan.ps1` PASS 확인(DRIFT 시 §4에 부분 종결 보정 행 1개).
5. 출처 추기 — 별지 §13 FB-32 배정 셀 끝 `← 완료(stage-57 · 날짜)` · FB-33 `← 완료(stage-57 · 날짜 키 7지점 수정 · 직접 파싱 9곳 무접촉 확정 · 날짜)` · FB-35 `← 완료(stage-57 · ⓐ · 날짜 — ⓑ 잔여)` · FB-36 `← 완료(stage-57 · 날짜)`.
6. 설계 — api §4.34·§4.24·§4.20 `[S57]` + screens §5.9·§5.14 확정 표기 · 색인 상태 줄 v1.75(밀리는 판 archive 이동만).
7. 매뉴얼(규약 H) · `CLAUDE.md` 머리 버전 줄 1곳(발행 시) · git tag `v2.04.2`(release PR 별도 — stage-47 전례).

## 7. 완료 기록 (구현·검증·문서 경위 정본 — 착수 후 추기)

- **편성**(2026-11-09): 지시서 확정 — 묶음 FB-32 + FB-33 + FB-35ⓐ + FB-36 · 버전 영향 사소(v2.04.2 예정 · 단독 발행) · 위임 판정 규약 A~H(선택 C·D·E·G는 권고안 확정 + 대안 표 — 사용자 이견 시 변경) · **사용자 확정 대기 0** · 등재 표기 정정 2(FB-36 백엔드 가산 동반 · FB-33 `new Date(iso)` 9곳 = 서버 로컬 naive라 무접촉 → 날짜 키 7지점 수정으로 재정의) · api §4.34 ④·§4.24·§4.20 ② `[S57]` + screens §5.9·§5.14 + 색인 §3 실측 1구(Design v1.74 · v1.70 archive 이동) · stage-index 57행 · backlog FB-32·33·35·36 상태 + 기준일 · 별지 §13 FB-32·33·35·36 편성 추기 · 로드맵 M 행 추가 없음(사소) · 마스터 계획 무접촉(DDL 0 · R 행 0).
- **구현**(2026-11-09 · 커밋 `0a26255`(feat) + 검토 경미 반영 `6753aa9`(fix) · 브랜치 `stage-57-import-minor-bundle`): backend-dev 1(B-1~B-8) + frontend-dev 2묶음 병렬(F-2~F-4 / F-5·F-6) · F-1(타입 2줄)은 메인이 선반영 · **지시서 대비 편차 0**(세 에이전트 보고 + 검토 대조) · 백엔드 추가 헬퍼 1 = `import_run_service._list_checks_preview(run)`(목록 계산 조건 — 규약 A 그대로).
- **자동 검증 V-1**(2026-11-09): `run-tests.ps1` — `test_import_runs.py` 21 · `test_explanation_spec.py` 5(신규) · `test_job_center.py` 36 · `test_answer_key_explain.py` 22 passed · **`-Full` 710 passed**(실패 0 — applied_exam 2건도 통과) · `invariant-scan.ps1` PASS(신규 위반 0 · 기준선 갱신 0) · `npm run build` 성공 · `tsc --noEmit` 0 · **엔트리 청크 1,532,227 → 1,534,106 B(Δ +1,879 B · R37 — 기준선 1,532,227 대비)** · DDL 0(B-8: `models.py`·`alembic/`·`prompts/` diff 0 · `routers/` diff = `split.py` 1줄).
- **API 실측 V-2**(2026-11-09 · 격리 워크트리 · 빈 DB · 임시 포트 8765 · LLM 0 · 종료 + 리스너 부재 확인): ⓐ 통과(변환 JSON 업로드 → 목록 `preview_available: true` → 커밋 후 `null`(`committed`)) ⓑ 통과(서버 재시작(캐시 소실 · json_upload 보존본 없음) → `review_ready` 항목 `false` · 상세 최상위·`run` 항목도 `false`) ⓒ 통과 — **지시서 원문(비지원 포맷 실패 경로)과 다르게 "큐 일시정지 → `POST /api/convert`(OLE 매직 `.doc`) → `queued` 유지"로 실측**(LLM 도달 가능성 0을 보장하려는 순서 변경): 잡 항목 `run_label` = run `label`(`『v2-legacy.doc』 변환`) → 잡 취소 → 재개 ⓓ 통과(runs 목록·상세·jobs 목록 응답에 `answer`·`explanation` 키 0).
- **브라우저 실측 V-3**(2026-11-09 · 같은 임시 서버 · Chrome 확장 — 미연결이라 메인이 Chrome 직접 기동 후 연결 · `browser-debugger` 위임 · LLM 0): ⓐ 통과(접힌 카드 [검토] `disabled` + "보존 만료 — 다시 반입하세요" 1줄 · 펼치면 1번만 · 다른 상태 카드에 문구 없음) ⓑ 통과(일시정지 → run 4 [분할 반입] → 휴리스틱 8조각 중 2개 투입 → `queued` 2 · `running` 0 → 그룹 1개 · 헤더 `『v3-big.txt』 변환` · "작업 2개 · 대기 2" · `aria-expanded` 토글 · "대기 중 (1번째)"·"(2번째)" · 행에 [화면으로 이동] 없음 · [카드로 이동] = `/import?run=4` + 패널 닫힘) ⓒ 통과([모두 취소] 확인 다이얼로그 없이 즉시 → "작업 2개 · 취소 2" → [목록에서 지우기] → 그룹 소멸 · jobs `[]` → [재개]) ⓓ **관찰 불가**(단일 잡 run·`run_id` 없는 잡이 목록에 없었음 — 코드 검토로 갈음: `groupJobsByRun` 2개 미만 = `single` · 실행 중 포함 [모두 취소] 확인 다이얼로그 경로도 Opus 코드 검토 갈음) ⓔ 통과(히트맵 미래 아닌 마지막 칸 title `2026-11-09: 0건` · '월' 행 · **수정 전 공식 `toISOString` = `2026-11-08` vs 수정 후 로컬 = `2026-11-09`**(Asia/Seoul · 페이지 콘솔 계산) · `/print` 오답노트 기본 기간 `2026-10-09`~`2026-11-09`) — **단 인쇄 미리보기 "생성일"은 빈 DB라 미리보기가 렌더되지 않아 미확인**(코드 변경은 동일 유틸 1줄 치환) ⓕ 통과(390×844 iframe 에뮬 · 문서·패널 가로 스크롤 0 · 하단 탭바 5 · 그룹 헤더 액션 줄바꿈) ⓖ 통과(콘솔 에러 0 — 단 도구 특성상 `/print` 로드 이후 구간만 추적).
- **실측 관찰**(2026-11-09 · 결함 아님 · 범위 밖 · **FB 등재 0 — 등재 여부는 사용자 판단**): run 카드 [분할 반입]으로 연 분할 위저드가 원본 파일을 이어받지 않고 다시 지정을 요구한다 — 실측 시점에는 설계 의도 여부 미확인. **문서 대조(완료 절차 · plan-architect)**: screens §5.9 S56 B의 [분할 반입] 계약 문언 = "파일 run = 파일 재선택 · URL run = `source_url` 자동" — 실측 run 4(`v3-big.txt` · 파일 소스)의 동작은 이 문언과 일치한다(재선택 생략을 원하면 UX 개선 요구로 별도 등재 — 사용자 판단).
- **검토**(2026-11-09 · Opus `stage-reviewer`): **통과 — 치명 0 · 중요 0 · 경미 3** ① 지시서 체크박스 표기 불일치(F-1·F-5~F-7 미체크 — 완료 절차 문서 묶음에서 해소) ② `JobCenterPanel.tsx` 잉여 빈 줄(반영 `6753aa9`) ③ `test_import_runs.py` `run_label` 단언 약함(`assert run_label` 추가 — 반영 `6753aa9`). 해설 규격 문구 = 지시서 §2 D 정본과 줄 단위 완전 일치(스크립트 대조) · 설계-구현 갭 0 · §4 침범 0 · 등재 권고 0. **미확인 의심 2(결함 아님 · 기록만)**: ⓐ `start_with_run`에서 `job_label(job_id)`가 None이면 run 라벨이 있어도 잡 `run_label` null(규약 F 문언 그대로 · 프론트 폴백 존재 · 실경로 미확인) ⓑ 일괄 취소는 클릭 시점 목록만 대상 — 이후 같은 run에 들어온 잡은 미취소(규약 범위 안 엣지).
- **완료 절차**(2026-11-09): 체크박스 전건 `[x]` · CHANGELOG v2.04.2 항목(발행 대기) · stage-index 57행 · backlog FB-32·FB-33·FB-36 §4 종결 · FB-35 `미편성(ⓑ 적응형 깊이 — ⓐ 완료 …)` §1 잔류 · 기준일 줄 · 별지 §13 FB-32·33·35·36 `← 완료` · api §4.34 ④·§4.24·§4.20 ② `[S57]` + screens §5.9·§5.14 확정 표기 + Design v1.75(v1.71 archive 이동) · 매뉴얼 3곳(5장 반입 건 카드 [검토] · 16장 AI 풀이 생성 초안 확인 · 22장 작업 센터 묶음) · 마스터 계획 무접촉(사소 — M 행 0 · DDL 0 · R 행 0) · R37 Δ의 별지 §9·backlog §3 추기는 생략(stage-55·56 추기 전례 없음 — Δ 기록 정본 = CHANGELOG·이 절). **잔여 = DoD 6**(해설 표본 10문항 — 사용자) **· DoD 7**(실사용·폰 실기기 — 사용자) → 통과·치명 0이면 `VERSION` 2.04.2 + CLAUDE.md 버전 줄 + tag `v2.04.2`(release PR 별도).
- **머지**(2026-11-09): PR #119(`stage-57-import-minor-bundle` → main · 구현 `0a26255` + 검토 경미 반영 `6753aa9` + 완료 절차 문서) · 편성 PR #118 · 발행(v2.04.2)은 DoD 6·7 사용자 회신 후 release PR 별도.
