# Stage 41 — 다단(세로 단나누기 · FB-10): **고정 열 `columns` > `column` 컨테이너** + `::::columns{n=2} / :::column` 방언 (v2.0.x 후속 · **2차 개정 2026-08-30**)

> 상태: **완료(2026-08-31)** — 2차(고정 열 ⓑ) 구현·검토·실측(2026-08-30) → **머지 완료**(본편 PR `f2ca820` + 후속 3건 PR `238dc7c` · dist 포함 · 2026-08-30) → **DoD 8 1차 실사용 판정(2026-08-31 사용자): "당장은 치명적인 결함은 안 보임" = 치명 없음**(ⓐ~ⓕ 개별 명시 확인은 아님 — 이후 실사용 중 결함 발견 시 후속 stage로 즉시 편성, 2026-08-24 지시). 경위: 묶음 A(변환기·어댑터·리더·코퍼스)·B(스펙·정규화 훅·UX) 병렬 구현(opus) → Opus 검토 **조건부**(치명 0·중요 3·경미 7) → 수정 라운드(단 경계 **키 가드 강등 채택** · 두 계층 정규화 동치 고정 · 편집기 계층 헤드리스 검사 72건 · 병합 빈 줄 보존 · 리더 혼재 흡수) → 브라우저 실측 2회(삽입 즉시 2·3셀 grid · 단 내 Enter · 3단 입력 1단 무이동 · 2↔3 병합 손실 0 · 해제 · Delete/Backspace/Shift+Tab 단 경계 무동작 · `column` 핸들 숨김 · 390px 적층 · 리더 grid) → 표적 재검토 → H-8. 상세 = 말미 "완료 기록(2차)". (종전 2차 편성 문구: 1차(흐름형 ⓐ)는 구현·검토·실측·머지(PR #74)까지
> 끝났으나 **사용자 실사용 피드백(2026-08-30)으로 결정 ①이 ⓑ로 번복**됐다: "다단을 눌렀는데 단이 생기지 않는다 ·
> 왼쪽 단에서 엔터를 눌러야만 옆 단으로 · 1·2·3단 각각 컨테이너가 있어야 하고 각 단에서 엔터는 그 단 안에서 아래로 ·
> 3단에서 줄바꿈하면 1단으로 데이터가 이동" = 흐름형(브라우저 다단 **균등 배분**)의 본질이 요구와 어긋남 → 메인
> 대화가 진단·선택지 제시 → **사용자 확정 "ⓑ 고정 열로 전환"**. 이 문서는 그 개정본이며, **1차 구현은 2차가 대체**
> 한다(1차 이력·수치는 말미 "1차(흐름형) 이력" 절에 보존). 구현 착수 = `/stage-implement 41`(2차 체크리스트 H-1~H-8).
> (생성 경위·편성 근거는 1차와 같다: 2026-08-24 사용자 피드백 FB-10 + "2.x는 뒤로" 지시 → stage-39 전례(v2.0.x 후속 ·
> M 번호 미부여 · 별지 관할 · 마스터 §14 압축 표 무변경) · D10(GPL XL `@blocknote/xl-multi-column` 금지 불변) 첫 자체
> 구현 대상. 선행 stage-40 완료 · 후속 stage-43(구 편집기 퇴역) 조건부.)
> 범위: **고정 열 다단(Notion 컬럼)** — 컨테이너 블록 `columns`(2·3단) 안에 **단 컨테이너 블록 `column` n개**(각각
> 독립 내용 · 엔터는 그 단 안에서 아래로) + 슬래시/툴바 진입 + 단 수 변경(병합·추가)·[단 해제] + 방언
> `::::columns{n=2} … :::column … ::: … ::::` 왕복 + 리더(`MarkdownView`) grid 렌더 + 모바일 세로 적층(1단).
> 정본: 화면 계약 = **screens §5.16 "툴바 정비·다단(S40·S41)" — 2차 개정(Design v1.51 예정 · 구현 후 실측 재개정)** ·
> 방언 = **별지 §5.4 "세로 단나누기" 행 2차 개정** · 손실 = **별지 §14 11번 2차 개정** · 저장 계약 = §4.28 ③·§4.29
> 무개정 계승(블록 타입 2개가 실릴 뿐).
> **DDL 0 · Alembic 0 · settings 키 0 · LLM 0 · 신규 엔드포인트 0 · 신규 npm/파이썬 의존 0(D10) · 백엔드 diff 0 ·
> 초기 청크 증가 ≤ 5KB(min)(R37 — 1차 기준선 위 가산분이 아니라 **main 대비 총합**) · 엔진 내부 패치 0(R33)**
> (위반이 필요해지면 착수 중단·사용자 보고).

## 착수 전 결정 (2차 — 2026-08-30)

| # | 결정 | 선택지 · 판정 |
|---|---|---|
| ① | **다단 방식** | ⓐ 흐름형 CSS 다단(1차 구현 — 텍스트가 단을 넘어 흐르고 브라우저가 균등 배분) / ⓑ **고정 열** — `columns` 안에 `column` 컨테이너 n개, 각 단이 독립 내용·독립 커서 흐름. **← ⓑ 확정(2026-08-30 사용자 — 1차 ⓐ 실사용 후 번복)**. 1차 지시서의 "ⓑ = 엔진 내부 노드 재구현·고비용" 판단은 **철회**: 콜아웃·1차 columns와 같은 `createReactBlockSpec` 컨테이너 2종(`columns`·`column`) + 자식 그룹 **grid CSS**로 엔진 내부 비접촉 구현이 가능하다(1차에서 확보한 선택자 형태 `.bn-block:has(> :not(.bn-block-group) [data-…]) > .bn-block-group` 재사용) |
| ② | **단 수 범위** | **2·3단 유지**(1차와 동일 · 4 이상 입력 UI 없음 · 유입 데이터의 4단 이상은 값·단 보존, 표시는 grid가 그대로 n열 — 고정 열은 상한 강등이 필요 없다(폭만 좁아진다) · 권고안 채택) |
| ③ | **중첩 규칙** | **columns 안 columns 금지 · 콜아웃 안 columns 금지**(1차와 동일 — 삽입 가드) · **column 안의 모든 블록 허용**(콜아웃·표·코드·이미지·목록·수식). 유입 데이터의 중첩(드래그로 생긴 것 포함)은 **보존·grid로 그대로 렌더**(폭만 좁아짐 — 1단 강등 규칙 폐기) |
| ④ | **단 경계 편집 규칙**(1차 "흐름 단위"를 대체) | 각 `column`은 **항상 자식 ≥ 1**(빈 단 = 빈 문단 1개 — 클릭 가능) · 단의 마지막 문단에서 Enter = 그 단 안에 새 문단 · 단의 첫 문단 맨 앞 Backspace/Shift+Tab(엔진 기본 = 부모 밖으로 승격)은 **정규화가 되돌려 단 안에 유지**(내용 이동 0) · 방향키는 문서 순서(1단 끝 → 2단 처음)를 따른다(엔진 기본) · **단 수 3→2 = 3단 내용을 2단 끝에 병합(손실 0) · 2→3 = 빈 단 추가** · **[단 해제] = 1단·2단·3단 내용을 순서대로 승격**(undo 1단위) · 컨테이너 제거 = 블록 삭제 또는 [단 해제]뿐(**"빈 컨테이너 자동 제거" 규칙 폐기** — 빈 단 n개도 사용자가 둔 레이아웃이다) — 권고안 채택 · 실측 후 재개정 여지 **← H-6 실측(2026-08-30 · CDP 합성 키)**: 엔진 기본 승격이 예상보다 파괴적 — **Delete(단 끝) = 다음 단 내용 전부를 현재 단으로 병합(단 소실)** · **Backspace(단 첫 블록 맨 앞) = 뒤 형제들을 자식으로 끌고 승격** → 정규화 되돌림만으로는 순서/중첩 변형이 남는다 → **규약 E 강등 채택 = 단 경계 키 가드**(`blocknote/columnsKeymap.ts` · BlockNote 확장 `createExtension({keyboardShortcuts})` priority 101 > 코어 50 · Backspace 단 최상위 첫 자식 시작 · Delete 단 서브트리 마지막 잎 끝 · Shift-Tab 부모 column = no-op · **표 안은 전부 해제**(셀 이동 회귀 방지) · 그 외 키 무개입) — 재실측: 세 키 모두 구조 무변·Enter/타이핑/단 밖 편집 정상. 단을 빠져나가는 수단 = [단 해제]·드래그·컨테이너 삭제(설계 의도) |

## 확정 규약 (2차 — 이 문서 + screens §5.16 2차 개정 + 별지 §5.4/§14 2차 개정분이 정본)

### A. 블록 실체 — `columns` > `column`

- **앱 중립 블록**(`editor2/schema/blocks.ts`): `ColumnsBlock { type: 'columns', count: number, attrs?: AttrPair[], children: Block[] }`
  **유지**(children은 정규 상태에서 전부 `ColumnBlock`) + **신규 `ColumnBlock { type: 'column', children: Block[] }`**(prop 없음 ·
  `attrs` 없음 — `:::column`에는 속성을 두지 않는다). `blockChildren()`에 `column` 가산. 정규 불변식(변환기·어댑터·정규화가
  공유하는 함수 `normalizeColumnsBlock` 1개 — `editor2/schema` 또는 `transform`에 두고 세 곳이 import):
  ① `columns.children`은 전부 `column` — 아닌 자식은 **직전 `column`의 끝**(없으면 첫 `column`의 앞)으로 이동
  ② `column`이 0개면 `count`개 생성 · `count`는 **`column` 수로 갱신**(children이 정본 · `n=` 속성은 표기)
  ③ 각 `column.children ≥ 1`(0이면 빈 문단 삽입)
  ④ `column`의 부모가 `columns`가 아니면 **해제**(자식을 제자리에 승격).
- **편집기 스펙**(`blocknote/specs/blocks.tsx`): `columns` = 1차 스펙 유지(`count`·`meta` prop · `content: 'none'` · 상단 컨트롤 띠
  = 2/3 토글 + [단 해제] · `data-columns-view={count}` 선언 속성) — 단 **빈 컨테이너 제거 훅(`ensureColumnsEmptyCleanup`)은
  정규화 훅 `ensureColumnsNormalized`로 대체**. **신규 `column` 스펙**: `type: 'column'` · prop 없음 · `content: 'none'` ·
  렌더 = 높이 0에 가까운 빈 `div`(`data-column-cell`) — 셀의 시각(구분선·여백)은 CSS가 `.bn-block-outer` 단위로 그린다.
  `blocknote/schema.ts`에 등록(2행). 슬래시 메뉴에는 **`column` 항목을 두지 않는다**(사용자는 columns 단위로만 만든다).
- **어댑터**(`adapter/toBlockNote.ts`·`fromBlockNote.ts`·`types.ts`): `BnColumn { type: 'column', props: {}, children }` 추가 ·
  양방향 1:1 · `fromBlockNote` 컨테이너 평탄화 예외에 `column` 가산(자식이 형제로 새지 않게) · 되읽기 직후
  `normalizeColumnsBlock` 적용(유입 JSON이 비정규여도 편집 표면은 정규 상태만 본다).
- **CSS**(`notes.css` — 1차 흐름형 규칙 **전부 삭제**하고 grid로 대체): 컨테이너의 자식 그룹
  `.note-editor-frame .bn-block:has(> :not(.bn-block-group) [data-columns-view='2']) > .bn-block-group { display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; }`(3단 동형) · 각 단 셀(`> .bn-block-group > .bn-block-outer`)
  두 번째부터 **`border-left: 1px solid var(--border)`**(세로 구분선 — 토큰 색) + 왼쪽 여백 · 셀 안 `.bn-block-content`
  `max-width: 100%`(표는 기존 가로 스크롤 규칙 유지) · **모바일(<768px) = `grid-template-columns: 1fr` 세로 적층 · 구분선
  없음**(데이터 무변). 선택자는 1차에서 실측한 형태(`.bn-block:has(> :not(.bn-block-group) …) > .bn-block-group` —
  리액트 스펙 블록의 tiptap 노드뷰 래퍼 때문에 `+ .bn-block-group` 형제 선택자는 매칭 0)를 그대로 쓴다.
  `break-inside`·`column-*` 규칙은 흐름형 전용이었으므로 제거.
- **범위 밖 값**(`n=4`·비정수): 값 보존 · `column` 수가 정본이므로 표시는 그 수만큼 grid 열(4열도 그대로 — 결정 ②).

### B. 진입·조작 UX

- **슬래시**: `/단나누기`(별칭 `/columns`·`/다단` 공통 · `/2단`·`/3단`은 그 항목만 — 1차 경-4 형태 유지) → `columns` + 빈 `column`
  n개(각 빈 문단 1) 삽입 · **커서 = 1단의 빈 문단**.
- **툴바 [다단]**(`ColumnsMenu` — stage-40 빌더 블록 기능군 · 부유·도킹 동시): 2단·3단. **선택 블록이 있으면 그 블록들을 1단에
  넣고 나머지 단은 빈 문단**, 없으면 빈 columns 삽입 · 중첩 차단(columns 안·콜아웃 안 = 비활성 + 사유 툴팁 — 1차와 동일 ·
  `columnsInsertBlocked`는 `column` 안도 "columns 안"으로 판정).
- **단 수 변경**(컨트롤 띠 2/3 토글): 2→3 = 빈 `column` 추가 · **3→2 = 마지막 단 내용을 앞 단 끝에 병합**(손실 0 · 한 트랜잭션 ·
  undo 1단위). `count` prop과 `column` 수를 함께 갱신.
- **[단 해제]**: 모든 단의 자식을 **1단→2단→3단 순서로 컨테이너 자리에 승격**(컨테이너 삭제 + 자식 삽입 — 한 트랜잭션 · undo 1단위).
- **단 경계 편집**(결정 ④): 정규화 훅이 `editor.onChange` 뒤 `setTimeout 0`(1차 재진입 방지 관례)에 `normalizeColumnsBlock`
  불변식 ①~④를 적용한다 — 변경이 없으면 dispatch하지 않는다(무한 루프 방지 · 1차 프리즈 교훈: **PM 관리 DOM 변이 금지**,
  블록 API만). 알려진 한계: 사용자 조작 + 정규화 = undo 2단계(첫 Ctrl+Z가 중간 상태를 보일 수 있음 — 실측 기록).
- **사이드 메뉴**: `column` 블록 자체는 **드래그 핸들·＋ 버튼을 숨긴다**(셀을 끌어내는 조작 금지 — `SideMenuController`의
  커스텀 `sideMenu`가 `block.type === 'column'`이면 null · 다른 블록은 기본 `SideMenu`). columns 컨테이너 자체는 핸들 유지(통째
  이동·삭제). 단 안 블록은 각 셀 안에 경계 상자가 있으므로 핸들 위치가 정상이다(1차 이격 문제 해소).
- **빈 컨테이너**: 자동 제거 없음(결정 ④). 저장 시 빈 단은 `:::column\n:::`으로 실린다 — "빈 `::::columns` 펜스"(단 0개)는
  정규화가 만들지 않으므로 저장 경로 0.

### C. 방언·프로젝션 — `::::columns{n=2}` / `:::column`

- **직렬화**(`transform/blocksToMarkdown.ts`): `columns` = `{fence}columns{n=<count>}{attrs}` + 각 `column` 직렬화 + `{fence}` ·
  `column` = `{fence}column` + 자식 + `{fence}`(빈 단 = `:::column\n:::`). 펜스 길이 = **`calloutFence(inner)` 재사용**(단 안에
  콜아웃이 있으면 `column` 펜스 4 · 바깥 `columns` 펜스 5 — 중첩 산정 단일 출처). 정규형 예:
  ```
  ::::columns{n=2}
  :::column
  1단 내용
  :::
  :::column
  2단 내용
  :::
  ::::
  ```
- **파싱**(`transform/mdastToBlocks.ts`): `containerDirective` `columns` 분기(1차) 안에서 자식 `containerDirective` `column`을
  `ColumnBlock`으로 · 그 밖의 자식(1차 형식 `:::columns{n=2}` + 평문 자식 = **레거시 수용**)은 `normalizeColumnsBlock`이
  1단으로 모으고 빈 단을 채운다(재직렬화는 2차 정규형 — 계열 ② "정규화 수용"). 라벨 동반 `:::columns[제목]`·`:::column[제목]`은
  1차와 같이 `sourceFallback` 원문 보존. **`column` directive가 `columns` 밖에 단독으로 오면** 콜아웃 분기로 떨어지지 않게
  `columns` 분기 **앞**에서 잡아 자식을 제자리에 승격(불변식 ④).
- **리더**(`components/MarkdownView.tsx` + `DirectiveBlocks.tsx`): `columns` → `ColumnsSection`(**grid** · `data-columns={n}` ·
  `index.css` `.md-columns { display: grid; grid-template-columns: repeat(n) }` — 1차 `column-count` 규칙 삭제) · **신규 `column`
  → `ColumnCell`**(`.md-column` · 두 번째부터 `border-left` 토큰 구분선) · `columns` 직계 자식 중 `column`이 아닌 것(레거시)은 1단
  셀로 묶는다 · **모바일(<768px, `@media screen` 한정) 세로 적층** · **인쇄 = 화면과 같은 열 수**(grid는 인쇄 폭에서도 유지 —
  1차 중-1 교훈: `md:` 유틸 금지). `remarkStudy.ts`: `column` directive에도 `hProperties` 통과(F52 퇴로 목록 가입 여부는 1차
  판단 유지 = 미가입 · 계약 = **`columns`가 없는 기존 문서 렌더 diff 0**).
- **프로젝션 손실(별지 §14 11번 2차)**: 외부 Markdown 소비자는 두 펜스(`::::columns` / `:::column`)가 평문으로 보이고 단 내용이
  **1단→2단→3단 순서대로 나열**된다 — 리더·편집·재전환은 무손실.
- **왕복 코퍼스**(`s41-columns-roundtrip.mjs` **2차로 재작성**): ① 정규형 고정점(2단/3단 · 단마다 문단·목록·표·코드·이미지·
  콜아웃(펜스 4/5)·수식·헤딩·빈 단) ② 정규화 수용(**1차 레거시 `:::columns{n=2}` 평문 자식** → 1단 + 빈 단 · `n` 결손 ·
  `n`과 `column` 수 불일치 → `column` 수 우선 · `column` 안 비-column 섞임) ③ 값 보존·폴백(`n=4`(4열 보존) · `n=abc` · 미지
  attrs · 라벨 동반 → sourceFallback · `columns` 밖 단독 `:::column` → 승격) ④ 어댑터(`column` 왕복 · 평탄화 예외 · 사이드카
  불요 · 실제 스키마 적재) ⑤ 실문서(directive 이름 **`columns`·`column` 표본 수** 병기 — 예상 0 · 프로젝션 고정점). 기존
  s30~s40 회귀 건수 무변(s33 블록 표는 **18종**으로 갱신 — `column` 가산).

### D. 격리·검증

- 접촉 파일(프론트 한정): `editor2/schema/blocks.ts` · `editor2/adapter/{toBlockNote,fromBlockNote,types}.ts` ·
  `editor2/transform/{blocksToMarkdown,mdastToBlocks}.ts`(+ 정규화 함수 파일 1개 신설) · `blocknote/schema.ts` ·
  `blocknote/specs/blocks.tsx` · `blocknote/slash/slashTable.ts` · `blocknote/toolbar/**` · `blocknote/refPicker/insert.ts` ·
  `blocknote/notes.css` · 편집기 뷰 파일(`SideMenuController` 커스텀 — `BlockNoteView`를 그리는 파일 1곳) ·
  리더 `components/MarkdownView.tsx`·`components/markdown/DirectiveBlocks.tsx`·`remarkStudy.ts`·`src/index.css` ·
  `scripts/s41-columns-roundtrip.mjs`·`s33-adapter-roundtrip.mjs`(블록 표). **백엔드·구 편집기·저장 API 무접촉.**
- 회귀 = 기존 회귀 스크립트 전건 건수 무변·실패 0 + s41 2차 전건 + `s32-realdoc-check` · `tsc -b`·`npm run build` ·
  `invariant-scan.ps1` PASS · `run-tests.ps1` 무회귀 · 초기 청크 ≤ main +5KB · 백엔드 diff 0 · `package.json` diff 0.

### E. 알려진 위험·강등 경로

- **엔진 기본 승격 동작**(Backspace/Shift+Tab/드래그로 블록이 `column` 밖으로): 정규화 훅이 되돌린다 — 실측에서 "되돌림이
  보이는 깜빡임" 또는 undo 2단계가 불편하면 **키 가로채기(Backspace at column start = no-op)** 를 2차 강등으로 검토(엔진 내부
  패치 금지 — `keyboardShortcuts`/tiptap extension 수준만).
- **`column` 셀 클릭 진입**: 빈 단은 빈 문단 1개를 보장하므로 항상 클릭 가능 — 문단 높이 이하 여백 클릭은 엔진 기본.
- **grid 셀 폭보다 넓은 표·이미지**: 셀 `min-width: 0` + 표 가로 스크롤(기존 D2 봉인) — 강제 축소 없음.
- **레거시 1차 문서**: 실문서 표본 0(1차 실측) — 변환 규칙만 두고 마이그레이션 없음.

## 체크리스트 (2차 — 고정 열)

### 백엔드 묶음

- 없음 — 백엔드 diff 0 계약(1차와 동일).

### 프론트 묶음 A — 변환기·어댑터·리더 (담당 opus 승격 — 변환기 신중 관례)

- [x] H-1. **스키마·정규화** — `ColumnBlock` 타입 · `blockChildren` 가산 · `normalizeColumnsBlock` 불변식 ①~④(순수 함수 · 단위
      검사는 H-5 코퍼스에 포함).
      (구현 2026-08-30 — 신설 `editor2/schema/columnsNormalize.ts`: `normalizeColumnsBlock`(①~③ · 변경 없으면 **입력 객체 참조
      그대로**) · `unwrapStrayColumns`(④만) · `normalizeColumnsTree`(④ + 모든 columns ①~③ · 어댑터 되읽기 진입점). 새 블록 id는
      순수성 유지를 위해 **컨테이너 id 파생**(`<id>~1`)이 기본이고 `options.makeId`로 호출부 관례를 주입한다. 단 없는 컨테이너에서
      새로 만드는 단 수는 상한 12(병적 `n=9999` 방어 — 내용은 1단에 전부 산다).)
      (검토 반영 2026-08-30 · 경-1 — 단 0개 + `count`가 **수가 아니거나 없을 때** 생성 단 수 폴백을 1 → **2**로 정렬
      (스키마 기본값·파서 `n` 결손 기본·편집기 계층과 동일). 명시된 `count: 0`·음수는 종전대로 1단으로 접는다.
      생성 상한은 A 12 · B 3으로 아직 다르다 — 단 0개 컨테이너에서만 갈리므로 **잔여 정렬 항목으로 보고**.)
- [x] H-2. **변환기** — 직렬화(`column` 케이스 · `calloutFence` 재사용) · 파싱(`columns` 안 `column` · 레거시 평문 자식 수용 ·
      단독 `column` 승격 · 라벨 동반 폴백) · 어댑터 `BnColumn` 왕복 · 평탄화 예외 · 되읽기 정규화.
      (구현 2026-08-30 — 단 펜스끼리는 **빈 줄 없이** 잇는다(규약 C 정규형 예시대로 · 비정규 자식 혼재분만 종전 블록 시퀀스 규칙).
      `:::column`의 **속성 동반**(`{x=1}`)도 라벨 동반과 같이 원문 보존(sourceFallback)으로 보낸다 — 단에는 담을 자리가 없어
      흡수하면 값이 조용히 사라진다. 어댑터 `BnColumn` = prop 0(`props: {}`) · `fromBlockNoteBlocks`가 되읽기 끝에
      `normalizeColumnsTree`를 돌린다(정규 문서는 참조 동일 = 비용 0). `toBlockNote`는 정규화하지 않는다(어댑터 무정규화 원칙 —
      편집 표면은 H-4 훅이 지킨다).)
- [x] H-3. **리더** — `ColumnsSection` grid + `ColumnCell` · 레거시 1단 묶음 · `index.css` grid/구분선/모바일 screen/인쇄 동일 ·
      `remarkStudy` `column` 통과 · 기존 문서 렌더 diff 0(`s32-realdoc-check` 442/442).
      (구현 2026-08-30 — 열 수의 정본은 **hast 직계 `column` 자식 수**(`columnCellCount`)이고 `n=`은 레거시(단 없는 columns)에서만
      읽는다: 레거시는 내용을 셀 하나로 묶고 나머지 단을 빈 셀로 채워 정규화 결과와 같은 모습이 된다. 4열 이상은 인라인
      `grid-template-columns` 대신 **커스텀 프로퍼티 `--md-columns`**로 낸다 — 인라인 선언은 모바일 미디어 쿼리를 이겨 폰에서
      4열이 남는다. `remarkStudy`는 `column`에 **정규 표기 여부**(`data-directive-normative`)만 실어 변환기의 흡수/폴백 판정과
      리더를 일치시킨다. 1차 흐름형 `column-count` 규칙은 전부 삭제. **화면 실측(폰 390px·인쇄 미리보기)은 브라우저 단계**.)
      (검토 반영 2026-08-30 · 경-4 — **혼재 입력 흡수**: `columns` 직계의 비-`column` 자식(레거시 평문 · 속성 동반
      `:::column{x=1}` 폴백 div)을 리더도 불변식 ①과 같은 규칙으로 **직전 셀 끝**(앞에 셀이 없으면 첫 셀 앞)에 넣는다
      (`groupColumnsChildren` — 혼재가 없으면 입력 children을 그대로 돌려 정규 문서 렌더 diff 0). 열 수는 여전히 직계
      `column` 수. SSR 실측: 뒤 평문 → 셀1 끝·2열 유지 / 앞 평문 → 셀1 앞·1열 / 속성 동반 column → 셀1 안 흡수·1열
      = 변환기 투영과 같은 결론.)
- [x] H-5. **왕복 코퍼스 2차** — `s41-columns-roundtrip.mjs` 재작성(계열 ①~⑤) · `s33` 블록 18종 표 · `columns`·`column` 실문서
      표본 수 병기 · 기존 회귀 건수 무변.
      (2026-08-30 · 검토 반영 후 재실행 — **s41 2차 335건 전건 통과**(① 102 · ② 55 · ③ 47 · ③-b 정규화 함수 단위 16 · ④ 104 · ⑤ 11 · 실제 `noteSchema`
      적재 왕복 12/12 = 묶음 B 스펙 등록 확인). 실문서 442표면에서 directive `columns` **0건** · `column` **0건**(기존 문서 변환·
      렌더 diff 0). 회귀: s30 365 · s32-realdoc 442/442 · s32-blocks 751 · s33 **999**(블록 18종으로 갱신) · s37 191 · s35 3062
      (= 7×437표면+3 — DB 표면 수가 1차 실측 때보다 1건 줄어든 데이터 변동이고 검사 항목은 무변) · `tsc -b` 0 · `npm run build` 성공 ·
      `invariant-scan` PASS.)

### 프론트 묶음 B — 편집기 스펙·정규화 훅·UX (담당 opus 승격 — 1차 프리즈 전례)

- [x] H-4. **스펙·CSS·정규화 훅** — `column` 스펙 + 등록 · 1차 흐름형 CSS 삭제 → grid/구분선/모바일 · `ensureColumnsNormalized`
      (`onChange` + `setTimeout 0` · 변경 없으면 dispatch 0) · `column` 사이드 메뉴 숨김(`SideMenuController`).
      (구현 2026-08-30 — 계산은 신설 `blocknote/columnsNormalize.ts`(잎 모듈)에, dispatch는 `specs/blocks.tsx`
      `ensureColumnsNormalized`/`applyColumnsNormalization`에. 0.54의 커스텀 `sideMenu`는 props를 받지 않아
      대상 블록을 `useExtensionState(SideMenuExtension)`로 읽는다. **검토 반영(2026-08-30)**: 앱 계층
      정규화(A `normalizeColumnsTree`)와 **동치**로 맞췄다(생성 상한 `MAX_GENERATED_COLUMNS`를 A에서
      import · 단 0개+`count` 비정수/미지정 = 2단 · 빈 stray `column`은 통째 제거) — `scripts/s41-columns-editor.mjs`
      계열 ②(픽스처 13종 트리 비교)가 고정한다. 지연 실행 시 파괴된 편집기 방어·`onChange` 해제 함수 보관 포함.)
- [x] H-6. **진입·조작 UX** — 슬래시/툴바 삽입(빈 단 n개 · 커서 1단) · 선택 감싸기(1단) · 2↔3 토글(추가/병합) · [단 해제] 순서
      승격 · 중첩 차단(`column` 안 포함) · 단 경계 Enter/Backspace/Shift+Tab 실측 기록.
      (코드 완료 2026-08-30 · `scripts/s41-columns-editor.mjs` 계열 ③이 삽입·커서·병합(내부 빈 문단 보존)·해제·
      감싸기·차단을 고정. **단 경계 실측 결과(2026-08-30)**: ⓐ 단 끝 Delete = 엔진이 다음 단 내용을 통째로
      끌어와 뒤 단 소실 ⓑ 단 첫 블록 맨 앞 Backspace = lift가 뒤 형제를 자식으로 달고 나가 구조 변형
      ⓒ Tab·Shift+Tab·Enter는 정상 → **규약 E 강등 채택**: `blocknote/columnsKeymap.ts`(공식 확장 API
      `createExtension({ keyboardShortcuts })` · 우선순위 101 > 코어 키맵 50)로 Backspace(단 첫 블록 시작)·
      Delete(단 마지막 잎 끝)·Shift+Tab(단 최상위)만 no-op. 표 안에서는 전부 해제(셀 이동 보존).
      **결정 ④ 본문에 이 강등을 반영해야 한다**(H-8).)
- [x] H-7. **모바일·실기기 표면 준비** — iframe 390px 에뮬(1차 관례): 세로 적층·구분선 없음·컨트롤 띠 36px.
      (CSS 준비 완료 2026-08-30 — `@media (max-width: 767px)`에서 `grid-template-columns: 1fr` + 구분선·왼쪽
      여백 제거 · 컨트롤 띠 버튼 `min-h-9` 유지. **에뮬 실측 자체는 브라우저 단계**.)

### 공통

- [x] H-8. **검증 일괄 + 문서 반영** — 규약 D 전건 · 본 문서 체크박스·완료 기록(결정 ④ 실측 결과) · **screens §5.16 S41 2차
      실측 재개정(Design v1.51)** · 별지 §5.4 행·§13 FB-10·§14 11번 2차 · 마스터 머리말 1줄 · 매뉴얼(단나누기 사용법을 고정
      열로 다시 씀 — 방언 예시 포함).

## 이 단계에서 하지 않는 것 (착수 금지)

- **열 폭 드래그(비율 조정)** · **단 내 독립 스크롤** · **4단 이상 입력 UI**(유입 데이터 4열 보존·표시는 함) · **단 병합/분할 UI**
  (2↔3 토글 외).
- **`@blocknote/xl-multi-column` 등 XL(GPL) 도입** — D10 불변.
- **콜아웃 안 다단 허용**(결정 ③) · **구문 강조(FB-11 ⓑ)** · **columns를 위한 서버측 처리** · **구 편집기 접촉** · **엔진 내부
  (blockContainer·PM 노드) 패치**(R33) · **리더 블록 네이티브 뷰**(D5).
- **1차 흐름형 옵션 병존**(ⓐ/ⓑ 선택 UI) — 고정 열로 단일화.

## DoD (2차)

**자동 검증(구현 사이클 내 확인)**

1. **착수 전 결정 ①~④(2차) 기록 존재** — ① 사용자 확정 · ②③④ 권고안 채택(④는 H-6 실측 결과 추기). **← ① 충족(2026-08-30).**
2. **왕복 동형** — s41 2차 전건 + 기존 회귀 건수 무변·실패 0 · `columns`·`column` 기존 표본 0 확인 · 레거시 1차 형식 수용.
3. **편집 표면** — 삽입 즉시 n개 단이 **비어 있어도 보인다**(구분선·셀) · 각 단에서 Enter = 그 단 안 아래 · 3단 입력이 1단으로
   이동하지 않음 · Backspace/Shift+Tab 승격이 정규화로 되돌아옴 · 2↔3 토글(병합 손실 0) · [단 해제] · 중첩 차단 · `column` 핸들
   숨김 · 콘솔 오류 0·프리즈 0.
4. **리더·인쇄** — 미리보기·문서 상세·인쇄 같은 열 수(grid) · 모바일 적층 · 기존 문서 렌더 diff 0.
5. **조용한 손실 0** — 병합·해제·정규화·범위 밖 값·미지 `attrs`·레거시 수용 어느 경로에서도 본문이 사라지지 않음.
6. **검증 일괄 통과**(규약 D — 회귀·청크·invariant·run-tests·백엔드 diff 0·신규 의존 0).
7. **문서 반영 완료**(H-8).

**사용자 이행**

8. **실사용 확인** — PC + 폰: ⓐ [다단] 즉시 2·3단 상자가 보임 ⓑ 각 단에서 엔터가 그 단 안에서 내려감 ⓒ 3단 입력이 1단으로
   안 감 ⓓ 세로 구분선 ⓔ 폰에서 위→아래 적층 ⓕ 인쇄 미리보기 열 수. 발견 결함 보고 — 치명이면 완료 보류.

## 게이트/판정 규칙

- 이 단계는 게이트가 아니다 — 완료 = DoD 전건 충족(8 포함) + stage-reviewer 검토 통과.
- 결정 ①은 **사용자 확정**(재론 없음) · ②~④는 권고안 채택(사용자 답변 도착 시 개정).
- stage-43 조건(추가 수정사항 발견 시 그 수정이 먼저)은 별지 머리말 정본.

## 구현 순서·분배 힌트 (2차)

- 묶음 A(H-1→H-2→H-3→H-5)와 묶음 B(H-4→H-6→H-7)는 **병렬** — 계약 = 이 문서 규약 A의 타입·불변식·선택자 형태. B는 A의
  `normalizeColumnsBlock`을 import하되, A가 끝나기 전엔 같은 시그니처의 로컬 스텁으로 진행 가능(통합 시 교체).
- 서브에이전트 프롬프트에 담을 것: 결정 ①~④(2차) · 규약 A~E 발췌 · 1차 코드 위치(`schema/blocks.ts:448` ColumnsBlock ·
  `specs/blocks.tsx` 219~ 정리 훅·250~ columns 스펙 · `refPicker/insert.ts:98~` columnsInsertBlocked/insertColumnsBlock/
  wrapInColumns/unwrapColumns · `mdastToBlocks.ts:362·464~` · `blocksToMarkdown.ts:616` · `fromBlockNote.ts:467·576` ·
  `toBlockNote.ts:409` · `notes.css` stage-41 구획 · `DirectiveBlocks.tsx:121~` · `MarkdownView.tsx:221~` · `remarkStudy.ts:187` ·
  `index.css` `.md-columns`) · **백엔드·구 편집기 무접촉 · `frontend/dist` 금지 · 서버 검증 시 임시 포트 + 종료 의무**.
- 완료 후 리뷰 = `stage-reviewer`(Opus) + 브라우저 실측(1차 관례: 임시 8766 · iframe 390px · 콘솔 pattern 필터).

## 완료 기록 (2차 · 고정 열 · 2026-08-30)

- **구현**: 묶음 A(opus — `schema/blocks.ts` `ColumnBlock` · `schema/columnsNormalize.ts`(순수 정규화 ①~④ · `MAX_GENERATED_COLUMNS` 12 단일 출처) · 변환기(`column` 직렬화 · `columns` 안 `column` 파싱 · 레거시 1차 형식 수용 · 단독 `column` 승격 · 라벨/속성 동반 `column` = sourceFallback) · 어댑터 `BnColumn` · 리더 `ColumnsSection` grid + `ColumnCell` + 혼재 흡수 `groupColumnsChildren` · `index.css` grid/구분선/screen 한정 모바일 · `s41-columns-roundtrip.mjs` 2차 재작성 · s33 블록 18종) + 묶음 B(opus — `column` 스펙·등록 · `blocknote/columnsNormalize.ts`(BN JSON 계층 정규화 — A와 동치 계약·상수 import) · `ensureColumnsNormalized` 훅(onChange → 계획 0이면 dispatch 0 → `setTimeout 0` → `transact` 1회 · 파괴된 편집기 방어) · `columnsKeymap.ts` 키 가드 · `extensions.ts` 등록(두 표면 공용) · `ColumnAwareSideMenu`(`useExtensionState(SideMenuExtension)` — 0.54 커스텀 sideMenu는 props 0) · `insert.ts` 삽입/감싸기/`setColumnsCount`(2→3 빈 단 · 3→2 병합 — tail이 빈 문단만일 때만 버림)/해제/차단 · `notes.css` grid·셀 구분선·컨테이너 상자·모바일 · `s41-columns-editor.mjs` 67건).
- **Opus 검토(1차)**: 조건부 — 중-1 정규화 두 계층 발산 · 중-2 승격 되돌림이 순서 변형(결정 ④ 위반) · 중-3 B 계층 자동 검증 0 · 경-1~7(폴백 단 수 1/2 · 빈 stray 처리 · 병합이 빈 줄 삭제 · 리더 혼재 독립 셀 · 커서 start · onChange 해제 · 두 표면). → 수정 라운드에서 중-1/2/3·경-1/2/3/4/6 해소, 경-5/7 현행 유지.
- **브라우저 실측**(메인 대화 · 임시 8766 · Chrome CDP · 키 입력은 PM 뷰 합성 이벤트 — 숨김 탭 제약): 삽입 즉시 2셀 grid(290px×2 · 2셀 `border-left` 1px) · 1단 Enter → 1단 안 새 문단 · 2단/3단 입력 시 다른 단 무변 · 3단 토글 3셀(185px×3) · 2단 병합 col2=[c,d,e,f] 손실 0 · 저장 `::::columns{n=2}\n:::column\na\n\nb\n:::\n:::column\nc\n\nd\n:::\n::::` · 데스크톱 리더 grid 2셀(339px) 구분선 · iframe 390px 편집 1열 세로 적층·구분선 없음·버튼 36px / 리더 1열 · `column` 셀 hover 사이드 메뉴 없음 / 문단 hover 정상 · **가드 전**: Delete(단 끝) → col2 소실·Backspace(단 첫) → 뒤 형제 중첩 → **가드 후** 세 키 구조 무변 · 콘솔 오류 0. 도구 제약: 숨김 탭(다른 창에 가림)은 CDP 키 입력·Mantine 드롭다운·타이머가 죽는다 — `SetWindowPos(HWND_TOPMOST, NOACTIVATE)`로 가림 해제 · 슬래시/툴바 메뉴 경로는 헤드리스(s41-editor)로 갈음.
- **F/H-8 최종 수치**: s41 2차 335/335 · s41-columns-editor 72/72(정규화 9·A/B 동치 14·조작 19·키 가드 30) · 회귀 무변(s30 365 · s32-realdoc 442/442 · s32-blocks 751 · s33 999 · s34 PASS/99 · s35 3062(DB 표면 수 변동) · s36 40 · s37 191 · s40 37) · `columns`·`column` 실문서 표본 0 · tsc 0 · build ✓ · 초기 청크 Δ vs main JS +1,232B / CSS +63B · invariant PASS · run-tests 611 · 백엔드/package.json/구 편집기 diff 0.
- **Opus 표적 재검토(2차)**: **통과**(중요 잔존 0 · 경미 6) — 키 가드 priority 근거 성립(`91+(idx+r)*10 ≥ 91` > 코어 50) · 표 예외 단 밖 무영향 · A/B 동치 검사 자기 참조 아님 · 경-3/4 손실 0. 머지 전 반영: **신-1** 단 첫 블록이 목록·헤딩·코드·인용일 때 Backspace가 유형 해제까지 막던 것 → 가드에 `isParagraph` 조건(④-3b·26~29 추가 = 72건) · 신-2 리더 혼재 흡수 key 중복 → 묶음별 재키 · 잔-4 주석 수치 정정. 잔존(현행 유지) = Shift-Tab 가드 collapsed 미검사 · `_tiptapEditor.isDestroyed` 사설 필드 읽기 · 커서 복원 start.
- **알려진 한계(사용자 판단 항목)**: ⓐ 단 첫 블록 Backspace·단 끝 Delete·Shift+Tab이 무동작(안내 없음) — 단을 빠져나가려면 [단 해제]/드래그/컨테이너 삭제 ⓑ 드래그로 블록을 단 사이(columns 직계)에 떨어뜨리면 정규화가 직전 단 끝으로 보낸다(undo 2단계 가능) ⓒ 한글 IME 조합 중 정규화 dispatch는 미실측(가드로 정규화 발화 자체가 드묾).
- **후속 3건(2026-08-30 사용자 실사용 피드백 — 머지 후 즉시 반영)**: ① **편집 중 세로줄 이상** — 실측 원인 2개: 코어 `.bn-block-content{padding:3px 0}`가 컨트롤 띠와 셀 상자 사이 3px 틈을 만들어 좌우 테두리가 끊김(→ columns 콘텐츠 패딩 0) + 코어 `bn-trailing-block` 위젯(30px)이 `column` 셀 맨 위에 빈 띠를 만들어 구분선이 텍스트보다 33px 위로 뻗음(→ 셀 안 위젯 `display:none`) · 재실측 접합 틈 0px·셀 상단→텍스트 3px ② **빈 문단 Enter 무동작** — 코어 Enter가 빈 중첩 블록을 부모 밖으로 승격하려 하고 정규화가 되돌려 결과 무변 → 키 가드에 `Enter`(단 최상위 빈 문단) = 아래 새 문단 삽입 + 커서 이동 ③ **왼쪽 단에서 → 키 = 바로 오른쪽 단으로** — `ArrowRight`(블록 끝) = 다음 단 첫 블록 시작 · `ArrowLeft`(블록 시작) = 이전 단 마지막 잎 끝 · 이동할 단이 없거나 글자 중간이면 코어 기본. 순수 판정 `shouldInsertParagraphOnEnter`/`shouldJumpRight`/`shouldJumpLeft` + `locateColumnOfBlock` · s41-columns-editor ④-30~38(**81건**) · 브라우저 재실측 전건 정상 · 초기 청크 무변(편집 CSS는 지연 청크 `style-*.css`) · s41 왕복 계열 ⑤의 "실문서 표본 0" 단언은 같은 날 사용자 문서에 다단이 쓰이기 시작해(columns 1·column 2) **정보 출력 + "표본 전건 2차 정규형·폴백 0" 검사**로 교체.
- **잔여 해소 기록**: 머지 = 본편 PR(`f2ca820`) + 후속 3건 PR(`238dc7c`) 2026-08-30 완료(dist 포함). DoD 8(사용자 — PC+폰 ⓐ 삽입 즉시 단 표시 ⓑ 단 내 엔터 ⓒ 3단 입력 무이동 ⓓ 구분선 ⓔ 폰 적층 ⓕ 인쇄 열 수 + 위 한계 ⓐ 체감) = **1차 실사용 판정 2026-08-31 "당장은 치명적인 결함은 안 보임" → 치명 없음으로 충족**(ⓐ~ⓕ 항목별 명시 확인은 아님 · 알려진 한계 ⓐ~ⓒ는 현행 유지 — 이후 결함 발견 시 후속 stage 즉시 편성). → **stage-41 완료**.

---

## 1차(흐름형 ⓐ) 이력 — 대체됨 (2026-08-24 편성 → 2026-08-30 구현·검토·실측·머지 PR #74 → 같은 날 사용자 번복)

- **1차 결정**: ① ⓐ 흐름형 CSS 다단(위임 판정) · ② 2·3단 · ③ 중첩 금지(안쪽 1단 표시) · ④ 문단 내 흐름 + 원자 블록
  `break-inside: avoid` — F-2 실측: 단 경계 문단의 오른단 조각 hover 시 핸들이 컨테이너 상단 왼쪽에 뜸(귀속 정확·위치 이격) →
  ⓐ 유지 판정.
- **1차 규약 요지**: `columns`(자식 = 내용) + 자식 그룹 `column-count`/`column-rule` · 방언 `:::columns{n=2} … :::`(자식 평문) ·
  리더 `column-count` · 빈 컨테이너 자동 제거 · 슬래시 5별칭 · 툴바 [다단] · 2/3 토글 · [단 해제].
- **1차 완료 기록(2026-08-30)**: 구현 `011b10c`·`972dbbc`(삽입 프리즈 — PM 관리 DOM 변이 → `data-columns-view` 선언 속성) ·
  Opus 검토 조건부(치명 0·중요 1 인쇄 단 수 강등·경미 5·의심 1) → 수정 5건(`a131a7f`: 인쇄 = `data-columns` 속성 CSS +
  screen 한정 모바일 · 토글 시 attrs `n` 소거 · 별칭 분리 · 주석 정정 · **편집 표면 선택자 재작성** — 브라우저 실측에서
  `[data-content-type='columns'] + .bn-block-group`이 노드뷰 래퍼 때문에 매칭 0) · 실측 2회(편집 2/3단·문단 내 흐름 · iframe
  390px 1단 · 리더 2/3단 · 토글/해제/undo 정상 · undo 트랩 없음) · F-7 수치: 회귀 전건 무변 · s41 257/257 · `columns` 표본 0 ·
  초기 청크 Δ JS +497B/CSS +752B · invariant PASS · run-tests 611 · 백엔드/의존 diff 0 · 후속 등재 별지 §13 FB-14(콜아웃 자식
  CSS 매칭 0 의심 — main 기존)·FB-15(React #185 1회).
- **번복 사유(2026-08-30 사용자)**: 빈 컨테이너에 단이 보이지 않음 · 왼단이 차야 오른단으로 · 3단 입력이 균등 배분으로 1단
  쪽에 재배치 — 요구 = 단마다 독립 컨테이너. 흐름형의 본질이라 CSS로 해소 불가(`column-fill: auto`는 고정 높이 전제).
- **1차에서 2차로 계승한 자산**: 선택자 형태(`.bn-block:has(> :not(.bn-block-group) …) > .bn-block-group`) · `data-columns-view`
  선언 속성 관례 · 리더 `data-columns` 속성 CSS + screen 한정 모바일(인쇄 동일) · 토글 시 `attrs` `n` 소거 · 별칭 규칙 ·
  `columnsInsertBlocked`·`wrapInColumns`·`unwrapColumns` 골격 · s41 스크립트 골격(jiti 로더·계열 구조) · 브라우저 실측 절차
  (임시 8766 · iframe 390px · 콘솔 pattern).
