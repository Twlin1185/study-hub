# Stage 41 — 흐름형 다단(세로 단나누기 · FB-10 ⓐ): `columns` 컨테이너 블록 + `:::columns{n=2}` 방언 (v2.0.x 후속)

> 상태: **편성 완료 · 착수 가능 — 단 stage-40 완료 후 착수 (2026-08-24 생성)** — 착수 전 결정 ①~④는 **사용자
> 미답 → 메인 대화(Claude) 권고안 채택으로 진행(위임 판정 — 재론 여지 있음)**. 구현 착수 = `/stage-implement 41`.
> (생성 경위: 2026-08-24 사용자 실사용 피드백 FB-10(별지 `editor-v2.plan.md` §13 — "세로 구분선으로 2단·3단을
> 골라 Word의 단처럼") + 같은 날 사용자 지시 **"2.x는 뒤로"** → stage-39 전례(v2.0.x 후속 · M 번호 미부여 ·
> 별지 관할 · 마스터 §14 압축 표 무변경)로 즉시 편성. **D10(GPL XL 도입 금지 — `@blocknote/xl-multi-column`)
> 확정 후 "자체 구현·후순위"로 남겨 둔 첫 대상의 실행**이다. stage-40(툴바 정비)과 분리한 근거 = 신규
> 컨테이너 블록 + 신규 방언 + 프로젝션·리더 렌더가 걸려 위험 축이 다르다.)
> 범위: **흐름형 CSS 다단(Word 단)** — 컨테이너 커스텀 블록 `columns`(2·3단) + 슬래시/툴바 진입 + 단 수
> 변경·해제 UI + 방언 `:::columns{n=2} … :::` 왕복 + 리더(`MarkdownView`) 렌더 + 모바일 1단 강등.
> **선행 = stage-40**(툴바 항목 빌더·블록 필터 단일 출처 위에 다단 메뉴를 가산한다 — 순서 고정).
> **후속 = stage-42(가칭 `stage-42-editor-retire` — 구 편집기 퇴역 실행 + 노트 v2 정식 이식 + 철저 검증 →
> v2.0.1 발행 예정 · 조건부 — 2026-08-24 사용자 지시, 별지 머리말 정본)**. 그래서 이 단계에서도 **구 편집기
> 코드 무접촉(stage-36 규약 A)이 더욱 중요**하다 — 리더 `MarkdownView`는 퇴역 **비대상**(stage-38 규약 C)이라
> 접촉 허용(아래 규약 D).
> 정본: 화면 계약 = **screens §5.16 "툴바 정비·다단(S40·S41)" 추기(Design v1.47 — 구현 후 실측 재개정)** ·
> 방언 = **별지 §5.4 표 "세로 단나누기" 행 확정 개정(2026-08-24)** · 손실 = **별지 §14 11번(신규)** · 저장 계약 =
> **api §4.28 ③·§4.29 무개정 계승**(블록 JSON + 프로젝션 동반 규칙 그대로 — 신규 블록 타입 1개가 실릴 뿐).
> **DDL 0 · Alembic 0 · settings 키 0 · LLM 0 · 신규 엔드포인트 0 · 신규 npm/파이썬 의존 0(D10 — GPL XL 금지
> 불변) · 백엔드 diff 0(실측: `backend/`에 `:::` directive 처리 코드 0 — 리더는 프론트 `MarkdownView`) ·
> 초기 청크 증가 ≤ 5KB(min)(R37 — `MarkdownView`/`DirectiveBlocks`는 초기 청크라 리더 렌더 1종만 가산)**
> (위반이 필요해지면 착수 중단·사용자 보고).

## 착수 전 결정 (권고안 채택 — 2026-08-24 메인 대화 위임 판정 · 사용자 미답 = 위임 · 재론 여지)

> 관례(D1·D7 전례): 권고안을 명기하되 확정은 사용자(또는 사용자의 명시 위임 판정)만 한다. 사용자가 "즉시
> 편성"만 지시하고 선택지에 답하지 않아 **권고안을 채택해 진행**한다. **사용자가 다른 선택지를 답하면 그
> 시점에 이 표·규약을 개정한다.**

| # | 결정 | 선택지 · 판정 |
|---|---|---|
| ① | **다단 방식** | ⓐ **흐름형 CSS 다단(Word 단)** — 컨테이너 커스텀 블록(자식 블록 = 내용) + 자식 그룹에 `column-count` · 텍스트가 단을 넘어 흐른다 · 엔진 내부 노드 비접촉(콜아웃 전례 · R33) · 비용 낮음 / ⓑ 고정 열(Notion 컬럼) — 열마다 독립 컨테이너 = 엔진 내부 노드(blockContainer 중첩) 재구현·업그레이드 리스크·비용 높음. **← 채택 ⓐ(권고 — 2026-08-24 위임 판정) · ⓑ 착수 금지** |
| ② | **단 수 범위** | 2·3단만(사용자 원문 "2단·3단") vs 4단 이상 허용. **← 채택 2·3단(권고)** — 4 이상 금지(입력 UI 고정 · 유입 데이터의 범위 밖 값은 규약 B ④) |
| ③ | **중첩 규칙** | columns 안 columns = 금지(1단) · **콜아웃 안 columns** = ⓐ 허용 / ⓑ 금지. **← 채택 ⓑ 금지(권고 — 단순화)**: 콜아웃 안은 폭이 좁고 펜스 중첩 산정이 복잡해진다. **columns 안 콜아웃·표·코드·이미지 등 모든 블록은 허용**(자식 제한 0 — 단 CSS 흐름은 블록 단위로 깨질 수 있음 = 알려진 한계 §14 11번 ⓒ) |
| ④ | **흐름 단위** | ⓐ **문단 내부도 단을 넘어 흐른다**(진짜 Word 단 — 긴 문단이 단 경계에서 이어진다) / ⓑ 블록 단위 흐름(`break-inside: avoid` — 문단이 통째로 다음 단으로 이동). **← 채택 ⓐ(권고 — 사용자 표현 "Word의 단"과 일치) · 단 원자·표·이미지·코드 블록은 `break-inside: avoid`**(잘리면 뜻이 깨진다). **실측 강등 경로**: 드래그 핸들·사이드 메뉴가 단 경계에 걸친 블록에서 오동작하면 F-2 실측 후 ⓑ로 강등하거나 컨테이너 내부 드래그 비활성(규약 E) — 강등 시 이 표에 기록 |

## 확정 규약 (①~④ 위임 판정으로 유효 — 이 문서 + screens §5.16 S41 추기 + 별지 §5.4/§14 개정분이 정본)

### A. 블록 실체 — `columns` 컨테이너

- **앱 중립 블록**(`editor2/schema/blocks.ts` — `CalloutBlock` 351~362행 전례): `ColumnsBlock { type: 'columns',
  count: number, children: Block[] }`. `attrs`(미지 속성 쌍 통짜 보존 — 콜아웃 전례)는 **둔다**(`{n=2 x=1}`
  같은 유입 데이터 손실 0 원칙 — 자유 편집 UI는 만들지 않는다).
- **편집기 스펙**(`blocknote/specs/blocks.tsx` — `createReactBlockSpec` · `createCalloutBlockSpec` 25~55행
  전례): `type: 'columns'` · `propSchema { count: { default: 2 }, attrs }` · `content: 'none'` · **자식 = 내용**
  (BlockNote 중첩 그룹 `.bn-block-group`). 렌더 = 상단 얇은 컨트롤 띠(2/3 토글 + [단 해제]) — 색·테두리
  전부 토큰(불변 규칙 5).
- **어댑터**(`adapter/toBlockNote.ts`·`fromBlockNote.ts` — 콜아웃 전례 대칭) 양방향 1:1 · 미지 `attrs` 왕복.
- **CSS**(`notes.css`): 컨테이너 블록의 **자식 그룹**에 `column-count: 2|3` · `column-gap`(토큰 간격) ·
  **`column-rule: 1px solid var(--border)`**(사용자 표현 "세로 구분선" — 토큰 색) · 원자·표·이미지·코드 블록
  `break-inside: avoid`(결정 ④) · **모바일(<768px) = `column-count: 1`·구분선 없음**(강등 — 데이터 무변).
  단 수는 prop → DOM 속성(엔진이 prop을 `data-*`로 방출하는지 실측 후 — 아니면 렌더에서 `data-count`
  부여·구현 재량). 콜아웃 children 시각 소속 CSS(stage-36 F-8)와 같은 계층·같은 특이도 규칙.
- **범위 밖 값**(유입 데이터 `n=4`·비정수 등): **값 보존 · 표시는 3단 상한으로 강등**(콜아웃 variant "값
  그대로 보존 + 기본 스타일" 전례 — 조용한 변형 금지). 입력 UI는 2·3만 준다(결정 ②).

### B. 진입·조작 UX

- **슬래시**: `/단나누기`(별칭 `/columns`·`/2단`·`/3단`·`/다단`) — `slash/slashTable.ts` 전수표(stage-36 F-5)에
  행 가산(그룹 = 기존 그룹명 재사용 — 새 그룹명 금지 관례). `/2단`·`/3단`은 단 수 지정 삽입.
- **툴바 메뉴**(`ColumnsMenu` — `CalloutMenu` 380~422행 전례): stage-40 항목 빌더의 **블록 기능군**에 가산
  (부유·도킹 동시 노출 — 단일 출처) · 항목 = 2단·3단. **선택 블록이 있으면 그 블록들을 감싸고**, 없으면 빈
  2단(자식 = 빈 문단 1개) 삽입(`insertCalloutBlock` 전례 — `refPicker/insert.ts`).
- **단 수 변경**: 컨테이너 상단 컨트롤 띠 2/3 토글(prop 갱신만 — 자식 무변).
- **[단 해제]**: 자식 블록을 컨테이너 자리에 **순서대로 승격**(컨테이너 삭제 + 자식 삽입 — 한 트랜잭션 · 조용한
  손실 0 · undo 1단위).
- **중첩 차단(결정 ③)**: 커서/선택이 columns 안 또는 콜아웃 안이면 다단 메뉴·슬래시 항목 **비활성 + 사유
  툴팁**(숨기지 않는다 — 원자 가드 관례). 유입 데이터의 중첩은 보존하고 안쪽은 CSS로 1단 표시.
- **빈 컨테이너**: 자식이 0이 되면(마지막 자식 삭제) 컨테이너도 제거 — 빈 껍데기 잔존 금지(구현 재량이되
  "빈 `:::columns` 펜스가 저장되는 경로 0"이 계약).

### C. 방언·프로젝션 — `:::columns{n=2} … :::`

- **직렬화**(`transform/blocksToMarkdown.ts` — 609~612행 `callout` 케이스 전례): 컨테이너 directive
  `:::columns{n=<count>}` + 자식 블록 + `:::`. 펜스 길이 = **`calloutFence(inner)` 재사용**(자식에 콜아웃이
  있으면 바깥 펜스가 길어진다 — 중첩 산정 단일 출처). `attrs` 미지 쌍은 `n` 뒤에 그대로.
- **파싱**(`transform/mdastToBlocks.ts` — 438행 `containerDirective` → `calloutBlock` 분기 **앞**에
  `node.name === 'columns'` 분기 신설 → `ColumnsBlock`). `n` 결손·비정수 = 기본 2(값 보존 원칙은 `attrs`로).
  **주의(실측)**: 현행은 모든 `containerDirective`가 콜아웃이 되므로 기존 문서에 `:::columns` 이름의 콜아웃이
  있었다면 의미가 바뀐다 → **F-5 코퍼스·실문서 전수 검사에 "directive 이름 `columns` 기존 표본 수" 항목
  필수**(예상 0 — 0이 아니면 사용자 보고 후 결정).
- **리더**(`components/MarkdownView.tsx` 203~219행 directive 분기 — `fold`/`hide`/콜아웃 전례): `columns`
  분기 신설 → `DirectiveBlocks.tsx`에 `ColumnsSection`(같은 토큰 CSS 다단 — 편집 표면과 동일 외양 · 모바일
  1단 · **인쇄 = 화면과 같은 단 수**(강등 없음 — 인쇄 폭에서 3단이 좁으면 실사용 DoD로 판단)).
  `remarkStudy.ts` 59행 `F52_DIRECTIVE_NAMES`(inlineFormat off 표면의 원문 노출 퇴로) 가입 여부는 **구현
  실측 판단** — 계약 = **`:::columns`가 없는 기존 문서의 렌더 diff 0**(`{w=}` 전례).
- **프로젝션 손실(별지 §14 11번 — ⓐ 명문화된 강등 손실)**: Markdown **외부 소비자**(remark-directive 없는
  렌더러)는 펜스 줄이 평문으로 보이고 내용은 **순차 나열**로 읽는다. **리더·편집·재전환은 무손실**(왕복
  동형 — directive 자체가 소스). 별지 §5.4 종전 "프로젝션 강등 = 순차 나열" 문구는 이 뜻으로 **한정 개정**.
- **왕복 코퍼스**(`s35-doc-roundtrip` 전례 — **신규 `s41-columns-roundtrip.mjs`**): 2단/3단 · 자식에 문단·
  목록·표·코드·이미지·콜아웃 · `attrs` 미지 쌍 · 범위 밖 `n` · 빈 자식 · 콜아웃 안 columns(유입 보존) 표본 —
  블록→md→블록 동형 + md→블록→md 문자열 동형. 기존 s30~s37 회귀 건수 무변.

### D. 격리·검증

- 접촉 파일(프론트 한정): `editor2/schema/blocks.ts`(타입 1) · `editor2/adapter/toBlockNote.ts`·
  `fromBlockNote.ts`·`types.ts` · `editor2/transform/blocksToMarkdown.ts`·`mdastToBlocks.ts` ·
  `blocknote/schema.ts`(스펙 등록 1행) · `blocknote/specs/blocks.tsx`(스펙) · `blocknote/slash/slashTable.ts` ·
  `blocknote/toolbar/**`(다단 메뉴 — stage-40 빌더 위) · `blocknote/notes.css` · **리더 = `components/MarkdownView.tsx`·
  `components/markdown/DirectiveBlocks.tsx`(+ 필요 시 `remarkStudy.ts`)**. **백엔드·구 편집기(DocEditor 소스 폼·
  `MarkdownFieldEditor`·`EditablePreview`·퇴로 토글)·저장 API 무접촉.**
- 리더 접촉의 정당성: stage-38 규약 C 퇴역 대상 정의에서 `MarkdownView`는 **비대상(존치 — D5)**이고, 방언
  렌더 추가는 `::toc`/`::web`(stage-37) 전례. 리더 diff는 `columns` 분기 1곳 + `ColumnsSection` 1개로 한정 —
  **기존 문서 렌더 diff 0**이 계약.
- 회귀 = 기존 회귀 스크립트 전건 건수 무변·실패 0 + `s41-columns-roundtrip.mjs` + `s32-realdoc-check`
  (실문서 전수 — directive 이름 `columns` 표본 수 병기) · `tsc -b`·`npm run build` · `invariant-scan.ps1` PASS ·
  `run-tests.ps1` 무회귀 · 초기 청크 ≤ +5KB(min) · 백엔드 diff 0 · 신규 의존 0(`package.json` diff 0).

### E. 알려진 위험·강등 경로

- **드래그 핸들·사이드 메뉴 위치**(엔진 부유 배치 — 별지 §13 FB-10 "제약"): CSS 다단 안 블록의 DOM rect가
  단 경계에서 둘로 갈라지면 핸들이 엉뚱한 자리에 뜰 수 있다. **F-2 실측 필수** → 문제 시 순서대로 강등:
  ⓐ 결정 ④ⓑ(블록 단위 흐름 `break-inside: avoid` 전면) → ⓑ 컨테이너 내부 드래그 비활성(사이드 메뉴 숨김 —
  자식 재배열은 [단 해제] 후) — 채택한 강등을 착수 전 결정 표 ④에 기록. **엔진 내부 패치 금지**(R33 —
  `createReactBlockSpec`만).
- **커서 이동**: 단 경계에서 방향키·클릭 캐럿은 브라우저 CSS 다단 처리에 맡긴다(contenteditable 표준 동작) —
  이상 시 실기기 DoD 보고 항목.
- **표·이미지가 단 폭보다 넓을 때**: 자식 블록 `max-width: 100%`·표는 가로 스크롤(기존 규칙) — 강제 축소 없음.

## 체크리스트

### 백엔드 묶음

- 없음 — **백엔드 diff 0이 이 단계의 계약이다**(실측 근거 = `backend/`에 `:::` 처리 0 · DoD 6).

### 프론트 묶음 (담당 `frontend-dev` · Sonnet — 변환기·어댑터 부분은 stage-34/35 전례대로 신중, 필요 시 opus 승격)

- [ ] F-1. **스키마·어댑터·변환기**(규약 A·C) — `ColumnsBlock` 타입 · 스펙 등록 · to/fromBlockNote 대칭 ·
      `blocksToMarkdown` 케이스(`calloutFence` 재사용) · `mdastToBlocks` `columns` 분기(콜아웃 앞) ·
      범위 밖 값·`attrs` 보존.
- [ ] F-2. **편집기 스펙·CSS·드래그 실측**(규약 A·E) — `createReactBlockSpec` 컨테이너 렌더(컨트롤 띠) · 자식 그룹
      `column-count`/`column-gap`/`column-rule`(토큰) · `break-inside` 규칙 · 모바일 1단 · **드래그 핸들·사이드
      메뉴 실측 기록**(정상 / 강등 ⓐ / 강등 ⓑ — 결정 ④ 표에 추기).
- [ ] F-3. **진입·조작 UX**(규약 B) — 슬래시 5별칭 · 툴바 `ColumnsMenu`(stage-40 빌더 블록 기능군) · 감싸기/빈
      삽입 · 2/3 토글 · [단 해제](승격 · undo 1단위) · 중첩 차단(비활성 + 사유) · 빈 컨테이너 제거.
- [ ] F-4. **리더 렌더**(규약 C) — `MarkdownView` `columns` 분기 + `DirectiveBlocks.ColumnsSection`(같은 토큰 CSS ·
      모바일 1단 · 인쇄 동일 단 수) · 기존 문서 렌더 diff 0 확인(`s32-realdoc-check`).
- [ ] F-5. **왕복 코퍼스·실문서 검사**(규약 C·D) — `s41-columns-roundtrip.mjs` 표본 전건 동형 · 기존 회귀 건수
      무변 · **directive 이름 `columns` 기존 표본 수 = 0 확인**(0 아니면 보고).
- [ ] F-6. **모바일·실기기 표면 준비** — 390px 에뮬: 1단 강등·구분선 없음·컨트롤 띠 터치 타깃 36px. (실기기
      최종 = DoD 8.)
- [ ] F-7. **검증 일괄**(규약 D) — 회귀 전건 · 신규 스크립트 · `tsc -b`·`npm run build` · 초기 청크 ≤ +5KB(min) ·
      `invariant-scan.ps1` PASS · `run-tests.ps1` 무회귀 · 백엔드 diff 0 · `package.json` diff 0.

### 공통

- [ ] G-8. **문서 반영** — 본 문서 체크박스·완료 기록(결정 ④ 실측 결과 포함) · **screens §5.16 S41 실측 재개정**
      (Design 판번 +1) · 별지 `editor-v2.plan.md` §13 FB-10 행 완료 추기 · §5.4 표 행 실측 확정 · §14 11번 상태
      갱신 · §10 D10 행 1구 · 마스터 머리말 이력 1줄 · `docs/manual/user-manual.html` 갱신(단나누기 사용법·
      모바일 1단·Markdown 소비자 강등 안내).

## 이 단계에서 하지 않는 것 (착수 금지)

- **고정 열(Notion 컬럼 — 결정 ①ⓑ)** · **열 폭 드래그** · **단 내 독립 스크롤** · **4단 이상**.
- **`@blocknote/xl-multi-column` 등 XL(GPL) 도입** — D10 불변(저장소 public).
- **구문 강조(FB-11 ⓑ)** — stage-40과 동일하게 제외·등재만.
- **콜아웃 안 다단 허용**(결정 ③ⓑ) — 실수요 실측 후 재론.
- **columns를 위한 서버측 처리·프로젝션 생성** — 백엔드 diff 0(영구 금지 조항 §4.28/§4.29 계승).
- **구 편집기 접촉** — stage-36 규약 A · stage-42 대조표 보전. 구 편집기에서 `:::columns` 문서를 열면 소스
  폼에 펜스가 평문으로 보이는 것은 **정상**(콜아웃 `:::note` 전례와 동일 — 손대지 않는다).
- **리더 블록 네이티브 뷰**(D5 재보류 불변) — 리더 접촉은 directive 렌더 분기 1곳뿐.
- **엔진 내부(blockContainer·PM 노드) 패치** — R33.

## DoD

**자동 검증(구현 사이클 내 확인)**

1. **착수 전 결정 ①~④ 판정 기록 존재**(위임 판정·재론 조건 · ④는 F-2 실측 결과 추기). **← ①~④ 판정
   충족(2026-08-24) · ④ 실측 추기는 F-2.**
2. **왕복 동형** — `s41-columns-roundtrip.mjs` 전건 + 기존 회귀 건수 무변·실패 0 · `columns` 기존 표본 0 확인.
3. **편집 표면** — 2단/3단 표시(세로 구분선·토큰 색) · 슬래시/툴바 진입 · 감싸기·해제·단 수 변경 · 중첩 차단 ·
   빈 컨테이너 잔존 0 · 드래그 실측 기록(정상 또는 채택 강등).
4. **리더·인쇄** — 미리보기·문서 상세·인쇄에서 같은 단 수 · 모바일 1단 · **기존 문서 렌더 diff 0**.
5. **조용한 손실 0** — [단 해제]·자식 삭제·범위 밖 값·미지 `attrs` 어느 경로에서도 본문이 사라지지 않음.
6. **검증 일괄 통과**(F-7 — 회귀·청크·invariant·run-tests·**백엔드 diff 0·신규 의존 0**).
7. **문서 반영 완료**(G-8 — §5.16·별지 §5.4/§13/§14·매뉴얼).

**사용자 이행**

8. **실사용 확인** — PC + 폰: ⓐ 2단·3단 작성이 "Word의 단"처럼 흐름 ⓑ 세로 구분선 ⓒ 폰에서 1단으로 읽힘
   ⓓ 드래그·커서 이동 이상 없음 ⓔ 인쇄 미리보기 단 표시. 발견 결함 보고 — 치명이면 완료 보류.

## 게이트/판정 규칙

- **이 단계는 게이트가 아니다** — 완료 = DoD 전건 충족(8 포함) + stage-reviewer 검토 통과.
- **stage-40 완료 전 착수 금지**(툴바 빌더·필터 단일 출처 의존).
- 착수 전 결정 위임 판정 = 사용자 답변 도착 시 즉시 반영(①ⓑ로 바뀌면 이 지시서 전면 재작성 — 착수 중단).
- **stage-42 조건**: 이 단계에서 추가 수정사항(결함)이 발견되면 그 수정이 먼저이고 stage-42 번호는 밀린다
  (2026-08-24 사용자 지시 — 별지 머리말 정본). 발견분은 별지 §13에 등재.

## 구현 순서·분배 힌트

- 순서: F-1(변환기·어댑터 — 왕복이 성립해야 나머지가 의미 있다) → F-5 초판(코퍼스 스크립트를 먼저 만들어
  F-1을 검증) → F-2(스펙·CSS·**드래그 실측 = 결정 ④ 확정 지점**) → F-3 → F-4 → F-6 → F-7 → 검토 → G-8.
- 서브에이전트 프롬프트에 담을 것: 결정 ①~④ 판정 원문 · 규약 A~E 발췌 · 접촉 파일 목록(규약 D) · 실측
  라인(`schema/blocks.ts` 350~362행 · `specs/blocks.tsx` 25~55행 · `blocksToMarkdown.ts` 561·609행 ·
  `mdastToBlocks.ts` 337~349·438행 · `MarkdownView.tsx` 203~219행 · `remarkStudy.ts` 59행 · `slashTable.ts` ·
  `NoteFormattingToolbar.tsx` 380~422행) · **백엔드·구 편집기 무접촉 · `frontend/dist` 금지** · 서버 검증이
  필요하면 임시 포트 + 종료·리스너 부재 확인 의무.
- 완료 후 리뷰 = `stage-reviewer`(Opus). 말미에 "완료 기록"을 추가한다(머리말 "상태" 줄 갱신 + 말미 완료 기록).
