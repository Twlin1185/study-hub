# Stage 47 — 마크 탈출 제스처 + 원자 가드 구독 정합 + 고아 모듈 정리 (v2.0.x · 사소)

> 상태: **구현·검토·실측 완료(2026-09-12) + 후속 소수정(Tab 제거 · 같은 날) — DoD 1~5 충족 · 6(사용자 확인) 회신 대기 = v2.01.2 발행 게이트(1차 회신: →·스페이스 2회 만족 · Tab 혼동 → 제거).** 착수 게이트였던 §2 규약 A-③(스페이스 2회 결과 형태)은
> 사용자 확정 ⓐ로 해소 · A-①(스타일 마크 전부)·A-③ →(커서 무이동 — 개선 여지 유지) 함께 확정. 착수 가능.
> **버전 영향: 사소**(CHANGELOG 규약 ③ — 에디터 내 입력 제스처 1개 + 경미 결함 1건 + 코드 정비 · 새 화면
> 표면 0 · DDL 0 · API 0 · 퇴역 0 · 프론트 전용) → 산출 버전 **v2.01.2 예정**(단독 발행). 마스터 §14 로드맵
> M 행 추가 없음(사소 stage는 stage-index가 담당) · `.api.md` 무변.
> 생성 경위: `backlog.md` §1 `FB-20`(사용자 제안 2026-09-03 — 최신 실수요) · §1 `고아모듈`(stage-43 유보 ①)
> · §2 `FB-6-후속①`(stage-40 범위 밖 미수정) 3행을 한 표면(BlockNote 노트·문서 편집 표면 프론트)으로
> 묶어 편성. **§2 `FB-14`는 편성 실측(2026-09-12)에서 이미 해소된 것으로 판명** — `notes.css:136~174`가
> stage-43 F-4에서 `:has()`로 재작성됐고(F-4 `[x]` · V-2 ⓓ 브라우저 매칭 실측 통과 2026-09-01 · v2.01.1
> 발행분) 등록부·별지 §13 행만 낡아 있었다 → **코드 범위에서 제외하고 등록부 정정(종결)** — 콜아웃 코드
> 변경은 없다(§1 표 참조).
> 정본 포인터: 대기 마크 판정 단일 출처 = stage-46 규약 D(`toolbar/activeStyles.ts` — `storedMarks` `[]` =
> "전부 해제" 의미론) · 공식 확장 키맵 전례 = stage-41 2차 `columnsKeymap.ts`(`createExtension({
> keyboardShortcuts })` · 우선순위 ≥ 91 > 코어 50 · 순수 판정 함수 + 헤드리스 검증 `s41-columns-editor.mjs`)
> · 툴바 구독 정책 전례 = stage-40 `blockFilter.ts` `useSelectedBlockTypes`(`useEditorSelectionChange` +
> `useEditorChange` 동시 구독) · 화면 계약 = screens §5.16 S47 블록(편성 추기 — Design v1.55) · 발행 절차
> = CHANGELOG 머리 규약 ⑤.

## 1. 범위 (프론트 편집 표면 3건 + 등록부 정정 1건 — 코드 실측 2026-09-12 동반)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **FB-20**(backlog §1 · 별지 §13 485행) | 제안(사용자 2026-09-03) | 접힌 커서로 스포일러·형광펜 등을 잇는 입력 중 **Tab · →(구간 끝) · 스페이스 2회**로 마크 밖으로 빠져나오는 제스처 | 키 처리 위치 = 공식 확장 키맵 `editor2/blocknote/columnsKeymap.ts:248~266`(`columnsEdgeShortcuts` — `ArrowRight`·`Shift-Tab`·`Enter` 등록 · 우선순위 주석 13~17행) → `extensions.ts:25~39` `createEditor2Extensions`(노트·문서 양 표면 공용) · 대기 마크 판정 = `toolbar/activeStyles.ts:35~54`(`pendingStyleRecord`·`readActiveStyles`) · document 캡처 리스너 전례 = `toolbar/useMicroMarkShortcuts.ts:25~48`(Mod+U만 — 새 단축키 금지 원칙 18행) · 코어 `link` 마크만 tiptap `exitable`(BlockNote core dist `src-BkfZVfaO.js:2124` — ArrowRight 블록 끝 탈출 + 공백 삽입 전례) · 기존 `storedMarks` 조작 코드 0(`frontend/src` Grep `setStoredMarks|removeStoredMark` 0건) |
| **FB-6-후속①**(backlog §2 · 별지 §13 451행) | 결함(경미 · stage-34/36 기존) | 원자 인라인 가드 `blocked` 상태가 `useEditorSelectionChange`만 구독 — 형제 훅 `useSelectedBlockTypes`(선택 + 내용 변경 동시 구독)와 정책 불일치 → 선택 좌표 불변 트랜잭션(슬래시 명령·원자 삽입/삭제 등)에서 가드가 낡은 값으로 남을 수 있음 | `toolbar/DockedFormattingToolbar.tsx:38~39` · `toolbar/NoteFormattingToolbar.tsx:648~650`(둘 다 `useState(() => selectionHasAtomInline(editor))` + `useEditorSelectionChange(() => setBlocked(…))`) · 정책 정본 = `toolbar/blockFilter.ts:61~99`(`useSelectedBlockTypes` — `useCallback([editor])` 고정 · 함수형 갱신 + 동치 시 이전 참조 유지 · 96~97행 두 훅 동시 구독) |
| **고아모듈**(backlog §1 · 별지 §13 475행 불릿 · stage-43 유보 ①) | 정비 | `components/RichBlockEditor.tsx`(S30) + 전용 의존 `components/markdown/richSurface.ts` 삭제 판단 | import 0 재확인(2026-09-12): `frontend`(dist·node_modules 제외) Grep `RichBlockEditor|richSurface` = `RichBlockEditor.tsx` 자기 참조뿐(20~21행 richSurface import). `richSurface.ts`의 의존 `markdown/inlineModel.ts`·`inlineSerialize.ts`와 `RichBlockEditor.tsx`의 의존 `utils/htmlPasteMarkdown.ts`·`MarkdownView.tsx`는 **다른 소비자 존재**(`editor2/transform/*`·`blocknote/paste.ts`·`looseList.ts`·`s30-roundtrip.mjs` 등) → 연쇄 고아 0 · 전용 테스트/타입 파일 0 |
| ~~FB-14~~(backlog §2 · 별지 §13 469행) | **등록부 드리프트 — 코드 범위 제외** | 콜아웃 자식 그룹 CSS `+` 형제 선택자 매칭 0 | **이미 해소**: `editor2/blocknote/notes.css:136~174` "stage-43 F-4(FB-14) 재작성" — 형제 결합자 4규칙 `:has(> :not(.bn-block-group) [data-content-type='callout'][data-variant=…]) > .bn-block-group` 치환(153·166·169·172행) + head 1규칙 자손 결합자 완화(146행) · `stage-43-editor-retire.plan.md:119~124` F-4 `[x]` · §8 7항 ⓓ 매칭 실측 전건 통과(2026-09-01) · v2.01.1 발행분. 처분 = 편성 시 등록부 §4 종결 이동 + §13 행 해소 추기(완료) · 본 stage V-3 ⓖ에서 회귀 대조 1회만(코드 0) |

**백엔드 코드 0 · DDL 0(계획서 §6.2 무변) · API 0(`.api.md` 무변) · 신규 의존 0 · 어댑터(방언 왕복) 로직
무변 · 저장 포맷 무변** — 전부 편집 표면 키 처리·툴바 구독·고아 파일 정리다. 마크 종류·저장 키·방언
기호(`||`·`==`·`++`·`:t{…}`)는 하나도 늘거나 바뀌지 않는다.

## 2. 확정 규약 (착수 전 결정 — 위임 판정 · 이 문서가 정본)

- **A. 마크 탈출 제스처(FB-20) — 공통 정의**
  - **A-① 대상 마크 = 스타일 마크 전부**(`editor.schema.styleSchema` 등재 키 — bold·italic·underline·strike·
    code·spoiler·highlight·`t`(글자색·바탕색·크기) 등). 스포일러·형광펜만 특별 취급하지 않는다.
    **← 사용자 확정(2026-09-12): 스타일 마크 전부 적용.** 근거:
    ⓐ ProseMirror `storedMarks`는 "다음 입력에 붙을 마크 **전체 목록**"이라 `[]`가 "전부 해제"를 뜻한다
    (stage-46 규약 D · `activeStyles.ts:15~19` 판정 규약과 같은 의미론 — 부분 해제는 별도 필터 로직이 필요해
    두 판정이 갈라질 여지를 만든다) ⓑ 사용자 학습 부담 = 제스처 1벌·마크 무관 ⓒ 마크별 분기는 YAGNI.
    **`link`는 제외**(스타일 마크 아님 · 코어가 이미 `exitable` — tiptap `Mark.handleExit` 전례 · `inclusive:false`라
    상속도 없음). 링크 위에서 제스처를 써도 링크 마크는 건드리지 않는다.
  - **A-② "구간 끝" 사실(순수 판정 입력)**: `collapsed`(선택 없음) · `pending`(다음 입력에 붙을 스타일 마크 =
    `state.storedMarks ?? $cursor.marks()`를 styleSchema 키로 거른 집합 — **비어 있지 않을 때만** 제스처 후보)
    · `nextInherits`(같은 텍스트 블록 안에 다음 문자가 있고 그 문자가 `pending` 전부를 갖고 있음 = 구간
    **중간**). **구간 끝 = `collapsed && pending ≠ ∅ && !nextInherits`**. 대기 마크가 걸렸을 뿐 아직 아무
    글자도 안 친 상태(버튼 클릭 직후)도 구간 끝이다(= 버튼 재클릭과 같은 결과).
  - **A-③ 제스처 3종(전부 구간 끝에서만 발동 · 그 밖에는 `false` 반환 = 코어·브라우저 기본 동작 그대로)**:
    - `ArrowRight`: **커서 이동 없이** `pending` 스타일 마크를 대기 마크에서 제거(`tr.setStoredMarks(현재
      마크 − 스타일 마크)` — 링크 등 비-스타일 마크는 보존) → `true`. 이미 탈출한 상태(`pending = ∅`)의
      두 번째 →는 정상 이동. 코어 `link` exitable 핸들러(공백 삽입 방식)와 달리 **공백을 넣지 않는다**
      (사용자 제안은 "빠져나오기" — 공백은 스페이스 제스처가 담당). **← 사용자 확정(2026-09-12): 일단
      이대로 적용하되 개선 여지 유지** — 최우선 기준 = 사용 편의성(UI/UX). 실사용(DoD 6 ⓔ)에서 "→ 한 번에
      커서가 안 움직여 어색함"이 관찰되면 후속 FB로 대안 재론(후보: 해제 + 이동 1칸 · 해제 + 공백 1개 ·
      탈출 시각 힌트). 판정·커맨드를 순수 함수로 격리해 대안 교체가 `markEscape.ts` 1곳 수정이 되게 한다.
    - ~~`Tab`~~ **← 후속 소수정으로 제거(2026-09-12 · 사용자 실사용 회신 · 안 ①)**: 1회째 탈출이 보이지 않아 한 번 더
      누르면 코어 들여쓰기(블록 중첩 24px)로 문단이 바뀌어 "인용 블록처럼" 보이는 혼동. →(2회째 = 무해한 이동)·스페이스
      (2회째가 곧 탈출)와 달리 Tab은 2회째의 대가가 크고 기존 의미(들여쓰기)가 강해 제거 — **Tab = 항상 코어 들여쓰기**.
      대안 비교(§7 참조): ② 탈출+공백 삽입 · ③ 시각 힌트 · ④ 직후 Tab 무시 — 전부 2회째 들여쓰기를 못 막거나 예측 불가.
      아래 원 규약은 이력으로 남긴다:
      (원안) 구간 끝이면 위와 동일 처리 → `true`(코어 `nestBlock` 들여쓰기 **미실행**). 구간 끝이 아니면
      `false` → 코어 들여쓰기. **충돌 판정**: 코어 Tab 키맵은 우선순위 50, 공식 확장 `keyboardShortcuts`는
      ≥ 91(`columnsKeymap.ts:13~17` dist 실측)이라 우리 핸들러가 **먼저** 돈다 — 가로채기 순서 문제 없음.
      **예외 = 표(`table`) 안에서는 Tab 제스처 비활성**(셀 이동 관례 우선 — `readColumnEdgeFacts`의 TABLE
      판정 전례 재사용). →·스페이스는 표 안에서도 동작.
    - `Space` **2회**: 1회째는 평소대로(코어가 상속 마크 붙은 공백 삽입). 2회째 = "구간 끝 + **직전 문자가
      스타일 마크 붙은 공백 1개**"이면 그 공백에서 스타일 마크를 벗기고(`tr.removeMark`) 대기 마크를 비운
      뒤(`setStoredMarks`) **두 번째 공백은 삽입하지 않는다** → 결과 = **마크 밖 공백 1개**, 커서는 그 뒤
      → `true`. 그 밖의 스페이스는 `false`(정상 삽입) — 세 번째 스페이스는 직전 공백에 마크가 없으므로
      정상 삽입된다(폭주 없음). **← 사용자 확정(2026-09-12): ⓐ 치환·공백 1개 채택** — 대안 ⓑ(두 번째
      공백도 삽입 · 마크 밖 공백 2개)는 기각. 근거: 문장 안 이중 공백 잔존 0 · 모바일(Tab·→ 없음)의 주
      제스처라 결과가 단순해야 함 · 코어 link exit도 공백 1개 관례.
  - **A-④ 위치·형태**: 신규 모듈 `editor2/blocknote/toolbar/markEscape.ts`(권고 경로 — 순수 판정
    `readMarkEscapeFacts(state)` + `shouldEscapeOn{ArrowRight,Tab,Space}(facts)` + 커맨드 + 단축키 표
    `markEscapeShortcuts`) → `createMarkEscapeKeymapExtension()`을 `extensions.ts` `createEditor2Extensions`에
    **columns 확장 뒤에** 추가(노트·문서 양 표면 자동 공용). **document 캡처 리스너 방식 금지**(그 방식은
    Mod+U처럼 PM 자체 키맵을 이겨야 할 때만 — `useMicroMarkShortcuts.ts:7~16`; 여기서는 공식 키맵 우선순위로
    충분). `editor._tiptapEditor`·내부 옵션 접근 금지(R33). **columns `ArrowRight`와의 순서**: 단 마지막
    블록 끝 + 대기 마크 상태에서 → = **탈출이 먼저**(이동 없음), 다음 →가 단 이동 — 확장 배열 순서로 우선순위가
    정해지므로(`91 + (idx + r) * 10`) V-2 헤드리스 검증에서 실측 고정. 반대로 돌면 배열 순서만 바꾼다.
  - **A-⑤ IME·모바일**: PM은 조합 중 keydown을 키맵에 넘기지 않으므로 한글 조합 중에는 발동하지 않는다
    (조합 확정 후 키부터) — R35 계열 실측은 DoD 사용자 확인 항목. 폰 가상 키보드에는 Tab·→가 없어 **스페이스
    2회가 주 제스처**다. iOS·Android의 "스페이스 2회 → 마침표" OS 치환과 겹칠 수 있음(관찰 항목 — 겹치면
    보고만·설정 강요 없음).
  - **A-⑥ 불변**: FB-16 현행 우회(마크 버튼 재클릭 = 대기 마크 토글 해제)는 그대로 유지 · 새 단축키
    조합(Mod+…) 신설 0 · 마크 종류·저장 포맷·방언 왕복 무변 · 툴바 active 표시는 기존 헬퍼
    (`useActiveStyleRecord` — `on:'all'` 구독)가 `setStoredMarks` 트랜잭션을 그대로 반영하므로 표시 코드
    추가 0(반영 안 되면 헬퍼 쪽 결함으로 보고).
- **B. FB-6-후속① — 구독 정책 통일**: `blocked` 산출을 **공용 훅 1개**(`useAtomInlineGuard(editor): boolean`
  — 위치 권고 `toolbar/blockFilter.ts` `useSelectedBlockTypes` 인접 또는 `toolbar/atoms.ts` 옆 신규 훅
  파일)로 뽑아 `DockedFormattingToolbar`·`NoteFormattingToolbar` 둘 다 그 훅을 쓴다. 정책 =
  `useSelectedBlockTypes`와 동일(`useEditorSelectionChange` + `useEditorChange` 동시 구독 · `useCallback([editor])`
  고정 · 함수형 갱신 + 값 동일 시 setState 생략 — stage-40 검토 "블록 타입 셀렉트 즉시 닫힘" 회귀 전례:
  불필요 리렌더가 엔진 `useFocusTrap`을 재발화시킨다). 같은 파일의 동류 패턴 2곳(`NoteFormattingToolbar.tsx:521`
  `columnsInsertBlocked` · `:561` `computeCropTarget`)은 **범위 밖**(등재된 결함은 원자 가드뿐 — 구현 중
  동일 결함이 실측되면 §7에 보고·등재만).
- **C. 고아 모듈 = 삭제**: `frontend/src/components/RichBlockEditor.tsx` + `frontend/src/components/markdown/richSurface.ts`
  **2파일만** 삭제. 근거: import 0·번들 미포함(stage-43 실측 + 2026-09-12 재확인) · `EditablePreview`
  퇴역(stage-43)으로 도달 경로 소멸 · GPL 무관(자체 코드) · 유지비만 남음. 연쇄 삭제 금지 — 삭제 후 새로
  import 0이 되는 모듈이 나오면 삭제하지 않고 §7에 보고 + 별지 §13 등재(§1 실측상 0 예상). stage-30~34
  문서의 `RichBlockEditor` 언급은 이력이라 무접촉.
- **D. 공통 한도**: 신규 의존 0(D10 — GPL 금지·저장소 public) · 색상 토큰만(불변 규칙 5 — 이 stage는 CSS 변경
  0 예상) · **R37 초기 청크 증가 금지**(키맵 모듈 수백 B 수준 + 고아 삭제는 번들 미포함이라 0 — 수치 기록)
  · 백엔드 diff 0(백엔드 변경 권한 없음) · 어댑터 무접촉.

## 3. 체크리스트

### 묶음 B — 백엔드

- 없음(백엔드 코드 0 · DDL 0 · API 0). V-4에서 `git diff -- backend` 빈 결과로 봉인.

### 묶음 F — 프론트 구현 (권장 순서 F-1 → F-2 → F-3 — F-3은 독립이라 먼저 해도 무방)

- [x] F-1. **FB-20 마크 탈출 제스처**(규약 A) — `toolbar/markEscape.ts` 신설: ① 사실 추출
      `readMarkEscapeFacts(state, styleMarkNames)`(`collapsed`·`pending`·`nextInherits`·`prevIsMarkedSpace`·
      `inTable`) ② 순수 판정 `shouldEscapeOnArrowRight`·`shouldEscapeOnTab`·`shouldEscapeOnSpace` ③ 커맨드
      `escapeMarks(editor)`(대기 마크에서 스타일 마크만 제거 — 비-스타일 마크 보존) ·
      `escapeMarksReplacingSpace(editor)`(직전 공백 마크 제거 + 대기 마크 비움 · 삽입 없음) ④ 단축키 표
      `markEscapeShortcuts = { ArrowRight, Tab, Space }` ⑤ `createMarkEscapeKeymapExtension()` →
      `extensions.ts` `createEditor2Extensions` 배열 **columns 확장 뒤**에 추가. 스타일 마크 이름 집합은
      `editor.schema.styleSchema` 키에서 얻는다(`activeStyles.ts`와 같은 조회 — 상수 복제 금지). 키 이름
      `Space`가 PM keymap 정규화(`" "`)로 잡히는지 실측(안 잡히면 `' '`).
- [x] F-2. **FB-6-후속①**(규약 B) — 공용 훅 `useAtomInlineGuard(editor)` 신설 + 두 툴바의 `useState`/
      `useEditorSelectionChange` 2줄을 훅 호출 1줄로 교체. `selectionHasAtomInline`(`atoms.ts`) 자체는 무변.
- [x] F-3. **고아 모듈 삭제**(규약 C) — `git grep -n "RichBlockEditor\|richSurface" -- frontend/src frontend/scripts`
      결과가 `RichBlockEditor.tsx` 자기 참조뿐임을 확인 후 2파일 `git rm`. 이어 `tsc`(빌드)로 미참조 확인 ·
      삭제로 새 고아가 생기는지 `inlineModel|inlineSerialize|htmlPasteMarkdown` 소비자 잔존 확인(§1 실측 =
      잔존 — 보고만).

### 묶음 V — 검증 (구현 후)

- [x] V-1. `npm run build` 성공(성공/실패만) + **초기 청크(엔트리 `index-*.js`) 증감 수치 — R37 증가 없음**
      (stage-46 기준선 1,578,573 B · 키맵 모듈 추가분 기록).
- [x] V-2. **헤드리스 자동 검증 신설** `frontend/scripts/s47-mark-escape.mjs`(`s41-columns-editor.mjs` 관례 —
      `ServerBlockNoteEditor` + 실제 `noteSchema` · jiti 캐시 ON): ⓐ 순수 판정 전수표(구간 끝/중간/대기
      마크만/빈 pending/표 안 Tab/직전 공백 마크 유무 × 3키) ⓑ 커맨드 결과(→: 커서 위치 불변 + storedMarks에
      스타일 마크 0 · Space 2회: 문서 텍스트 공백 1개 + 그 공백 마크 0 + 뒤 입력 무마크 · 링크 마크 보존 ·
      bold+spoiler 동시 pending 전부 해제) ⓒ **columns 상호작용** — 단 마지막 블록 끝 + 대기 마크에서
      `ArrowRight` 핸들러 체인 순서 실측(탈출 먼저) ⓓ 비발동 경로(`pending = ∅`에서 3키 전부 `false`).
      `scripts/run-tests.ps1` 통과(무회귀 — s33 999/999 · s34 · s36 · s40 · s41 계열 무변) ·
      `scripts/invariant-scan.ps1` **PASS**.
- [x] V-3. **브라우저 실측**(사용자가 띄운 `localhost:8000` 우선 — 불가 시 임시 포트 자체 기동 허용 · **8000
      금지 · 종료 + 리스너 부재 확인 필수**). CDP 한글 IME 미지원이라 ASCII로: ⓐ 빈 문단 `abc` → 접힌 커서
      [스포일러] → `def` → **→ 1회** → `ghi` 입력 = `abcdefghi` · 블록 JSON에서 `def`만 spoiler · 캐럿 이동
      0 · 툴바 [스포일러] 눌림 표시가 → 직후 해제 ⓑ 같은 절차 **Tab**(문단 들여쓰기 미발생 · 구간 중간에서는
      들여쓰기 정상) ⓒ 같은 절차 **스페이스 2회**(결과 `def ghi` · 공백 1개 무마크 · 형광펜으로도 반복 —
      `<mark>` 렌더가 공백 앞에서 끝남) ⓓ 회귀 대조 — 대기 마크 없는 문단에서 →·Tab·스페이스 정상 ·
      링크 끝 → 코어 exit 무변 · 표 셀 Tab = 셀 이동 · 단(columns) 마지막 블록 끝 → = 탈출 후 재→ 단 이동 ·
      FB-16 버튼 재클릭 우회 그대로 동작 ⓔ **FB-6-후속①** — 문단에 이미지/원자 임베드가 있는 상태에서 선택
      좌표 불변 트랜잭션(예: 원자 블록 슬래시 삽입·되돌리기)으로 가드 갱신 확인 + 기존 선택 경로 회귀 0
      (부유·도킹 양쪽) ⓕ 모바일 에뮬(390px) — 도킹 툴바에서 스페이스 2회 탈출 + active 표시 해제
      ⓖ **FB-14 회귀 대조 1회(코드 0)** — 콜아웃(variant note) 자식 그룹 `querySelector` 매칭 ≠ null · 배경/
      좌측선 적용 유지. 테스트 노트는 전부 DELETE 원상복구.
- [x] V-4. **백엔드 diff 0**(`git diff -- backend` 빈 결과) · 신규 의존 0(`package.json`·잠금 파일 diff 0) ·
      `RichBlockEditor|richSurface` grep 0(dist 제외).

### 묶음 D — 문서 (검증 종료 후)

- [x] D-1. **screens §5.16 S47 블록 실측 재개정 = Design v1.56**(편성 추기 v1.55 → 구현 실측 반영 · 색인 헤더
      승급 · 관례대로 밀려나는 v1.52 괄호 줄은 `docs/04-archive/design-changelog.md` 맨 위로 원문 이동) —
      제스처 3종 최종 동작(스페이스 확정안 반영)·비발동 경로·columns 순서·원자 가드 훅 서술.
- [x] D-2. `editor-v2.plan.md` §13 — FB-20 행·FB-6 행(후속 ① 문구 뒤)·475행 고아 모듈 불릿에 `← 완료(stage-47 ·
      날짜)` 1줄씩 추기(관례).
- [x] D-3. 매뉴얼 `docs/manual/user-manual.html` `#doc-inline-format` 절 단축키 문단(557~558행 부근)에 **마크
      탈출 제스처 1줄** 추가("서식 구간 끝에서 → · Tab · 스페이스 2회 = 서식 밖으로 · 폰은 스페이스 2회").
- [x] D-4. 본 문서 완료 기록(§7)·체크박스 + §6 절차(CHANGELOG·VERSION·stage-index·backlog).

## 4. 이 단계에서 하지 않는 것

- **백엔드·스키마·API**: 서버 코드 0 · DDL 0(계획서 §6.2 무변) · `.api.md` 무변 · 마스터 §14 M 행 추가 0.
- **마크 종류 신설·저장 포맷·방언 왕복 변경 0** — 어댑터(`marks.ts`·직렬화·정규화) 무접촉 · 별지 §14
  프로젝션 손실 목록 무변(새 블록·마크 0).
- **새 단축키 조합 신설 0**(screens §5.16 "가로채는 단축키는 기존 Mod+U 하나뿐" 불변) — Tab·→·스페이스는
  이미 존재하는 키의 **구간 끝 한정** 의미 추가일 뿐.
- **FB-11-ⓑ 코드 블록 구문 강조·복사 버튼** · **코드-언어select 화살표 외양** · **FB-8 모바일 드로어
  확장** · **FB-2-잔여 노트 복제** · **D11-ⓐ 참조 붙여넣기** — 착수 0(backlog §1 존치).
- **FB-14 콜아웃 CSS 코드 변경 0** — 이미 해소(stage-43 F-4). 본 stage는 회귀 대조 1회 + 등록부 정정만.
- **`NoteFormattingToolbar.tsx:521·561`의 동류 구독 패턴** — 등재된 결함 아님. 실측 결함 시 보고·등재만.
- **연쇄 고아 삭제 0** — 2파일 외 삭제 금지(규약 C).
- **부분 탈출(특정 마크만 벗기기)·설정 항목 신설·OS 이중 스페이스 치환 대응 0** — 관찰 시 등재만.
- **리더(`MarkdownView`)·인쇄 경로 변경 0**.
- **v2.x 백로그 착수 0** — 신규 아이디어는 별지 §13 FB 등재 + backlog 1행.

## 5. DoD (완료 정의)

**자동 검증(에이전트 수행):**
1. `npm run build` 성공 + 초기 청크 증가 없음(R37 — 수치 기록).
2. `s47-mark-escape.mjs` 신설·통과 + `run-tests.ps1` 통과(무회귀) · `invariant-scan.ps1` PASS.
3. 백엔드 diff 0 · 신규 의존 0 · 고아 2파일 삭제 후 참조 grep 0.
4. 브라우저 V-3 ⓐ~ⓖ 전건 통과(제스처 3종 + 비발동 회귀 + FB-6-후속① + 모바일 에뮬 + FB-14 회귀 대조).
5. 문서 묶음 D 전건(Design v1.56 · §13 추기 · 매뉴얼 1줄).

**사용자 확인(게이트 본체):**
6. ⓐ PC 실사용 — 한글 입력 후 →·Tab·스페이스 2회 탈출(CDP가 못 보는 IME 경로 · R35) ⓑ **폰 실기기** —
   스페이스 2회 탈출 + OS "스페이스 2회 → 마침표" 치환 겹침 여부 관찰 ⓒ 툴바 가드 회귀 체감 0 ⓓ 치명
   결함 0 회신 ⓔ **→ 탈출(커서 무이동)의 사용감 회신** — 어색하면 FB 등재(A-③ 개선 여지 조항).

**게이트**: 1~5 전건 + 6 치명 0 → **v2.01.2 발행**(§6). 치명 발견 시 발행 보류·수정 선행.

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` — **v2.01.2 항목 1개**(stage-47 1불릿 — FB-20 제스처·FB-6-후속① 가드
   구독·고아 2파일 삭제 · FB-14 등록부 정정 부기).
2. 루트 `VERSION` = `2.01.2`.
3. `stage-index.md` 47행 갱신(완료·일자·산출 버전 v2.01.2).
4. `backlog.md` — §1 `FB-20`·`고아모듈` · §2 `FB-6-후속①` 3행을 §4로 **종결 이동**(`종결(stage-47 · 날짜)`)
   · §4 FB-14 정정 행은 그대로.
5. 출처 추기 — 별지 §13 FB-20·FB-6·475행 불릿 `← 완료(stage-47 · 날짜)`(D-2).
6. 매뉴얼 1줄(D-3) · `CLAUDE.md` 머리 버전 줄 1곳(경위 전재 금지) · git tag `v2.01.2`(머지 커밋 대상).

## 7. 완료 기록 (구현·검증·문서 경위 정본 — 착수 후 추기)

- **편성**(2026-09-12): 지시서 확정 — 규약 A~D · FB-14 이미 해소 판명(등록부 §4 종결 이동 + §13 469행 해소
  추기 = 편성 시 처리) · screens §5.16 S47 편성 추기(Design v1.55) · 착수 게이트 = 규약 A-③ 스페이스 결과
  형태 사용자 회신 1건 → **같은 날 해소**(ⓐ 채택 · A-① 전부 · A-③ → 잠정 적용 + UX 개선 여지 조항).
- **구현**(2026-09-12 · 커밋 `63b0d76` · 브랜치 `stage-47-mark-escape`): F-1 `toolbar/markEscape.ts`(순수 판정 + 커맨드 +
  공식 확장 키맵 · `extensions.ts` columns 뒤) · F-2 `toolbar/useAtomInlineGuard.ts`(부유·도킹 공용) · F-3 고아 2파일 `git rm`
  (연쇄 고아 0). V-1 빌드 성공 · 엔트리 청크 **+0 B**(1,578,573 B 유지) · lazy `ui-*.js` +1,625 B. V-2 `s47-mark-escape.mjs`
  **95/95** · 기존 헤드리스 8종 무회귀 · pytest 611 · invariant PASS. 실측: `Space` 키 이름 그대로 잡힘 · columns → 순서 =
  탈출 먼저(배열 순서 변경 불필요 — tiptap이 같은 우선순위 계층에서 확장 배열을 뒤집어 쌓음).
- **검토**(2026-09-12 · stage-reviewer Opus): **통과** — 치명·중요 0 · 경미 2(문서 서술: ① 코어 exitable은 `link`뿐 아니라
  **`code`도** — 1회째 →는 우리 탈출이 선점하고 `code` 구간 끝 = 블록 끝일 때 2회째 →는 코어가 공백 1개 삽입(기존 동작) ②
  screens S47 "확정 대기" 문구 잔존) → D-1(v1.56)에서 정정. 보고된 보완 판단 4건 전부 수용. 범위 밖 발견 =
  `NoteFormattingToolbar.tsx:521·561` 동형 구독 패턴 → **FB-22** 등재.
- **V-3 브라우저 실측**(2026-09-12 · 사용자 기동 `localhost:8000` · 임시 노트 #19 생성→소프트 삭제 · 창 가림(`visibilityState`
  hidden)으로 CDP 타이핑 불가 → PM `insertText` + 합성 `keydown`으로 구동): ⓐ 스포일러 대기 → `def` → → → `ghi` = `def`만
  spoiler · 캐럿 무이동 · 툴바 눌림 해제 ✓ ⓑ Tab 구간 끝 = 해제·들여쓰기 0 · 구간 중간 = 우리 핸들러 미발동(코어) ✓ ⓒ 형광펜
  `hl` + 스페이스 2회 = `hl{highlight}| next` 공백 1개 무마크 · `<mark>` 가 `hl`에서 끝남 · 3회째 정상 삽입 ✓ ⓓ 대기 마크 없음
  3키 기본 동작 · 링크 끝(스타일 대기 0) 우리 핸들러 미발동 · 링크 끝 + bold 대기 = 스타일만 해제·링크 보존 · 표 셀 Tab = 셀
  이동 ✓ ⓔ lineBreak 원자 포함 범위 선택 → 선택 좌표 불변 치환 트랜잭션에서 disabled 9→2 갱신 ✓ ⓕ 390px iframe 에뮬 도킹
  툴바 — 형광펜 대기·스페이스 2회 탈출·눌림 해제 ✓ ⓖ FB-14 회귀 — 기본 규칙 매칭·배경·좌측선 4px · `warn` variant `--warning`
  적용 ✓ **단 신규 발견 FB-21**: 기본 variant `note`는 BlockNote가 `data-variant`를 내보내지 않아(기본값 = 속성 생략)
  `[data-variant='note']` 규칙 영구 매칭 0 → 기본 콜아웃 좌측선이 `--border`로 남음(stage-43 F-4 잔재 · 코드 0 — 등재).
  FB-16 버튼 재클릭 우회는 합성 클릭으로 재현 불가(툴바 경로 = 헤드리스·s46 관례) — 미변경 코드라 회귀 대상 아님.
- **문서**(2026-09-12): D-1 screens §5.16 S47 실측 재개정 Design v1.56 · D-2 §13 완료 추기 3곳 · D-3 매뉴얼 1줄 · FB-21·FB-22
  등재(별지 §13 + backlog §2). §6 절차: CHANGELOG v2.01.2 항목(발행 대기 표기) · stage-index 47행 · backlog 3행 §4 종결 이동.
  **VERSION·CLAUDE.md 버전 줄·git tag는 DoD 6 회신(치명 0) 후** — 회신 시 `2.01.2` 확정.
- **후속 소수정 — Tab 제거**(2026-09-12 · 사용자 실사용 1차 회신): "Tab을 연속 두 번 누르면 인용 블록으로 바뀐다"(실체 = 코어
  들여쓰기 · 블록 중첩 24px) · "스페이스 2번·화살표 탈출은 좋다". 원인 = 세 제스처 모두 1회째가 보이지 않는 동작인데 2회째의
  대가가 다름(→ = 이동 1칸 무해 · 스페이스 = 2회째가 곧 탈출 · **Tab = 코어 들여쓰기**). 대안 ①~④ 비교 후 **① Tab을 제스처에서
  제거**(Tab = 항상 들여쓰기 · 폰엔 Tab 없어 손실 0 · 코드 삭제뿐) 사용자 확정. 처리 = `markEscape.ts` Tab 단축키·
  `shouldEscapeOnTab`·`inTable` 사실 삭제 · `s47-mark-escape.mjs` 77/77(Tab 케이스 정리 + Tab 미등록·1회째 코어 nest 단언) · 엔트리 청크 불변 · screens S47·매뉴얼·
  CHANGELOG·§13 FB-20 정정. 규약 A-③ Tab 항은 취소선 + 원안 이력 보존.
