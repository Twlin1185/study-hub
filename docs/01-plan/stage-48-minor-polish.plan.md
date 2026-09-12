# Stage 48 — 노트 복제 + 편집 표면 다듬기 3건 (FB-2-잔여 · FB-21 · FB-22 · 코드-언어select) (v2.0.x · 사소)

> 상태: **착수 전**(편성 2026-09-12 · 사용자 확정 대기 항목 0 — 곧바로 구현 착수 가능).
> **버전 영향: 사소**(CHANGELOG 규약 ③ — 경미 결함 1건(FB-21) + 관찰 정비 1건(FB-22) + 외양 다듬기 1건 + 편의
> 액션 1개(노트 복제). **DDL 0 · 기존 API 5개 무변 · 새 화면(라우트) 0 · 퇴역 0 · 신규 의존 0.** 노트 복제는 `POST
> /api/notes/{id}/duplicate` **추가 1개**지만 규약 ③의 "저장 계약(DDL/API) 변경"은 스키마·기존 계약의 **변경**을
> 뜻하고 이 엔드포인트는 기존 노트 표현을 그대로 돌려주는 부가 액션(목록 행 버튼 1개)이라 등록부 판정(사소)을
> 계승 — **편성 시점 고정**) → 산출 버전 **v2.01.3 예정**(단독 발행). 마스터 §14 로드맵 M 행 추가 없음(사소
> stage는 stage-index가 담당).
> 생성 경위: `backlog.md` §1 `FB-2-잔여`(노트 복제 — 별지 §13 FB-2의 잔여분 · [저장]/[취소]는 stage-39 완료) ·
> §1 `코드-언어select`(stage-46 §4 183행 이월) · §2 `FB-21`(stage-47 V-3 ⓖ 실측 결함 · 경미) · §2 `FB-22`
> (stage-47 검토 발견 · 동형 패턴 관찰) 4행을 한 표면(노트 목록·노트/문서 편집 표면)의 저비용 정비로 묶어 편성.
> 우선순위 신호 = 결함(FB-21) > 저비용 정비 동승(나머지 3건).
> 정본 포인터: 노트 API 계약 = api §4.28(+ 이번 편성 추기 ⑦ `[S48]`) · 화면 계약 = screens §5.16 S48 블록(편성 추기
> — Design v1.57) · 툴바 파생 상태 구독 정책 전례 = stage-47 규약 B(`toolbar/useAtomInlineGuard.ts` — 선택 + 내용
> 변경 동시 구독 · `useCallback([editor])` · 함수형 갱신 + 동치 bail-out) · 콜아웃 CSS 정본 = stage-43 F-4 재작성
> (`notes.css:153~174`) · 코드 블록 select 정돈 규약 = stage-46 규약 D(값·동작 무접촉) · 발행 절차 = CHANGELOG 머리
> 규약 ⑤.

## 1. 범위 (백엔드 1건 + 프론트 4건 — 코드 실측 2026-09-12 동반)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **FB-2-잔여**(backlog §1 · 별지 §13 443행 FB-2) | 제안(사용자 2026-08-19 · 복제분만 잔여) | 노트 복제 — 목록에서 한 노트를 새 노트로 복사해 바로 편집 | 노트 API = `backend/routers/notes.py` 5종(`list_notes:145` · `create_note:159` · `get_note:182` · `update_note:188` · `delete_note:221`) · 헬퍼 `_check_title:39`·`_validate_blocks_shape:44`·`_check_size:65`·`_to_note_out:82`·`_get_note_or_404:107` · 복제 코드 0(`duplicate` grep 0). 프론트 훅 = `frontend/src/editor2/api/notes.ts`(`useNotes:86`·`useNote:94`·`useCreateNote:105`·`useUpdateNote:113`·`useDeleteNote:135`) · 목록 행 액션 = `pages/NoteListPage.tsx:144~153`([삭제] 버튼 1개 · 열기 = `Link:133`) · 생성 후 이동 전례 = `:72` `onSuccess: (note) => navigate('/notes/' + note.id)`(템플릿 리터럴) · 액션 오류 표시 = `setActionError`(:82) |
| **FB-21**(backlog §2 · 별지 §13 492행) | 결함(경미 · stage-43 F-4 잔재) | 콜아웃 기본 variant(`note`)에 엔진이 `data-variant`를 내보내지 않아 `[data-variant='note']` 규칙 매칭 0 → 기본 콜아웃 좌측선이 `--border`(회색)로 남음 | `frontend/src/editor2/blocknote/notes.css:153~164` 기본 규칙(`:has(> :not(.bn-block-group) [data-content-type='callout']) > .bn-block-group` — `border-left-width: 4px; border-left-color: var(--border)`) · `:166~168` note 규칙(`var(--accent)` — 영구 매칭 0) · `:169~171` warn(`var(--warning)`) · `:172~174` tip(`var(--correct)`) — stage-47 V-3 ⓖ 실측: 기본 규칙·warn 매칭 정상 |
| **FB-22**(backlog §2 · 별지 §13 493행) | 관찰(동형 패턴 · 실측 결함 0) | `NoteFormattingToolbar.tsx`의 파생 상태 2곳이 선택 변경만 구독 — 선택 좌표 불변 트랜잭션에서 갱신 누락 가능(FB-6-후속①과 동형) | `frontend/src/editor2/blocknote/toolbar/NoteFormattingToolbar.tsx:521~522`(`useState(() => columnsInsertBlocked(editor))` + `useEditorSelectionChange(() => setBlocked(columnsInsertBlocked(editor)))` — boolean) · `:561~562`(`useState<CropTarget \| null>(() => computeCropTarget(editor))` + `useEditorSelectionChange(() => setTarget(computeCropTarget(editor)))` — 객체) · 정책 정본 = `toolbar/useAtomInlineGuard.ts`(stage-47 F-2 — `:650`에서 사용 중) |
| **코드-언어select**(backlog §1 · stage-46 §4 183행) | 다듬기 | 코드 블록 언어 `<select>`의 브라우저 기본 화살표 외양 정돈 | `notes.css:466~470` 래퍼 `[data-content-type='codeBlock'] > div[contenteditable='false']`(absolute · top 6px · right 8px) · `:481~491` select(opacity 1 · position static · `background: var(--surface)` · `color: var(--text-muted)` · `border: 1px solid var(--border)` · radius 4px · 11px · padding 1px 4px) · `:497~500` hover/focus opacity 고정 — 화살표는 네이티브 기본(브라우저·테마별 외양 제각각) |

**DDL 0(계획서 §6.2 무변 · Alembic 불필요) · 기존 엔드포인트 5개 무변 · 신규 엔드포인트 1개(`[S48]` — api §4.28 ⑦)
· 신규 의존 0 · 어댑터(방언 왕복)·저장 포맷 무변 · 리더·인쇄 경로 무접촉.** 백엔드 diff는 `routers/notes.py`(+
테스트 1파일)에만 생긴다.

## 2. 확정 규약 (착수 전 결정 — 위임 판정 · 이 문서가 정본 · 사용자 확정 대기 0)

- **A. FB-21 콜아웃 기본 좌측선 = 기본 규칙 accent + note 규칙 삭제** (결정 ①)
  - `notes.css:161` `border-left-color: var(--border)` → `var(--accent)` · `:166~168` `[data-variant='note']` 규칙
    **삭제**. `warn`·`tip` 규칙 무변(특이도가 기본 규칙보다 높아 계속 이긴다 — `:has()` 안 속성 셀렉터 +1).
  - 근거: 엔진이 기본값 prop의 `data-*`를 내보내지 않는 것은 BlockNote 동작이라 우리가 바꿀 수 없고, 기본 규칙이
    곧 "note" 규칙이면 매칭 문제 자체가 사라진다. `:not([data-variant])` 대안은 규칙 1개를 더 유지하는 비용만 있고
    이점이 없다(기각). 목록 밖 variant(`:::노트[…]` 등 기존 데이터 — §5.16 "값 그대로 보존 + 기본 스타일")도
    기본 규칙을 타므로 좌측선이 accent가 된다 — **의도된 결과**(기본 스타일 = note 스타일).
  - 토큰만(불변 규칙 5) · 색 리터럴 0 · 라이트/다크 자동.
- **B. FB-22 = 공용 파생 구독 훅으로 2곳 전환** (결정 ②)
  - 신규 훅 `toolbar/useEditorDerived.ts`(권고 경로·이름 — `useEditorDerived<T>(editor, compute: (editor) => T,
    isEqual: (a: T, b: T) => boolean = Object.is): T`). 정책 = `useAtomInlineGuard`와 동일: `useState(() =>
    compute(editor))` + `useCallback([editor, compute, isEqual])` recompute(함수형 갱신 · `isEqual(prev, next)`면
    `prev` 반환 = bail-out) + `useEditorSelectionChange(recompute, editor)` + `useEditorChange(recompute, editor)`.
    **`compute`·`isEqual`은 모듈 스코프 함수(또는 `useCallback` 고정)로 넘긴다** — 렌더마다 새 클로저를 넘기면
    구독이 매 렌더 재등록된다(R33 `useFocusTrap` 재발화 전례 · stage-40 회귀).
  - 전환: `:521~522` → `const blocked = useEditorDerived(editor, columnsInsertBlocked)`(boolean · `Object.is`) ·
    `:561~562` → `const target = useEditorDerived(editor, computeCropTarget, cropTargetEquals)`(객체 — `CropTarget`
    필드 얕은 비교 함수 1개 신설 · `null` 처리 포함). `columnsInsertBlocked`·`computeCropTarget` 순수 함수 자체는
    무변.
  - `useAtomInlineGuard`를 이 훅 위에 얹을지는 **구현자 판단**(얹으면 `useAtomInlineGuard(editor) =
    useEditorDerived(editor, selectionHasAtomInline)` 1줄 — 동작 동일해야 하며 stage-47 헤드리스·브라우저 실측
    결과 무변이 조건. 얹지 않아도 결함 아님).
  - 실측 결함 0인 정비이므로 검증 = 빌드 + 기존 헤드리스 스크립트 회귀 무변 + 브라우저에서 두 버튼 상태 회귀 0
    (V-3 ⓒ). 새 헤드리스 스크립트는 만들지 않는다(훅은 React 렌더 의존 — 순수 함수는 이미 stage-41·46 스크립트가
    덮는다).
- **C. 노트 복제 = 서버 엔드포인트 `POST /api/notes/{id}/duplicate`** (결정 ③ — 안 (a) 채택 · 계약 정본 = api §4.28 ⑦)
  - 채택 근거: ⓐ 등록부 판정("노트 API 1개 추정")과 일치 ⓑ 원자성(읽기+쓰기가 서버 1트랜잭션 · 클라이언트
    GET+POST 조합은 중간 실패 시 반쪽 상태·제목 규칙이 프론트로 새어 나감) ⓒ 제목 규칙·삭제분 처리가 서버 1곳
    ⓓ 크기 상한 재검증 불필요(원본이 이미 통과한 값을 그대로 복사). 안 (b) 기각.
  - **요청 본문 없음** · 응답 `200 OK` + **새 노트의 노트 표현**(§4.28 ② 공통 — 201 사용 안 함 = 기존 관례).
  - **제목** = `원제.rstrip() + " (사본)"` · 원제가 공백뿐이면 `"(사본)"` · 결과가 200자를 넘으면 **원제 쪽을 잘라
    맞춘다**(`200 - len(" (사본)")`자 + 접미사 — 복제가 `title_too_long` 422로 실패하는 경로 0). 반복 복제는
    `"… (사본) (사본)"`으로 누적 — 일련번호 부여 0(YAGNI · 사용자가 제목을 고치면 된다).
  - **`content_blocks`·`content`·`blocks_version` = 원본 컬럼 값 그대로 복사**(TEXT 그대로 — 서버는 JSON을
    해석하지 않는다 §4.28 원칙 ③). **블록 id 재부여 0** — 근거: 블록 id는 문서 내부 유일성만 필요(앵커 칩은 헤딩
    텍스트 기준 `schema/blocks.ts:204` · 사이드카는 로드마다 재유도 — 노트 간 id 충돌 개념 없음)이고 재부여는 서버가
    블록을 해석하게 만들어 §4.28 원칙 ③을 깬다. `created_at`·`updated_at`은 새 값(서버 기본) · `is_active=1`.
  - **삭제된 원본(`is_active=0`)은 404 `NOT_FOUND`**(존재하지 않는 id와 같은 응답 — "노트를 찾을 수 없습니다").
    근거: 복제가 삭제분의 사실상 복구 경로가 되면 §4.28 ⑥ "복구 엔드포인트 없음" 계약을 우회한다(휴지통·복구 =
    D8-구현 별도 편성). `include_inactive=1` 목록에서 복제 버튼은 애초에 노출하지 않는다(현행 목록 UI에 삭제분
    노출 0이라 자동 충족).
  - 트랜잭션 = INSERT 1건 + commit(기존 `create_note` 경로와 동일) · LLM 0 · 파일 쓰기 0 · settings 키 0.
  - 에러 = 404뿐(422 경로 없음 — 요청 본문이 없고 제목은 서버가 맞춘다) · 500 공통 핸들러.
- **D. 복제 진입점 = 노트 목록 행 [복제] 버튼 1곳 · 성공 시 새 노트 편집 화면으로 이동** (결정 ④)
  - `NoteListPage.tsx` 행 액션 = **[복제] · [삭제]** 순(기존 [삭제] 버튼 왼쪽 · 같은 크기·토큰 클래스 · hover 색은
    `hover:text-primary`류 — `text-wrong`은 삭제 전용). **확인 다이얼로그 없음**(복제는 파괴적이지 않고 결과가
    삭제로 되돌려진다) · 성공 = `navigate('/notes/' + newNote.id)`(생성 전례 `:72`와 동일 경로) → S39 세션 스냅샷은 새
    노트 진입 시점에 정상 생성 · 실패 = `setActionError(서버 message)`(§3 관례 — 기존 삭제 오류 표시 재사용) ·
    진행 중 버튼 비활성(중복 클릭 = 사본 2개 방지).
  - **편집 화면(`NoteEditPage`) 상단 [복제]는 두지 않는다** — 자동저장·세션 스냅샷(S39)이 있는 표면에서 "복제
    시점의 서버 상태 vs 미저장 편집분" 문제를 만들고(flush 선행·dirty 비활성 등 규약이 더 필요) 실수요 미확인.
    실수요 시 별지 §13 FB 등재 후 편성(§4).
  - 훅 = `api/notes.ts`에 `useDuplicateNote()` 추가(`useMutation` · 성공 시 목록 쿼리 무효화 — `useDeleteNote`와
    같은 키 관례) · `Note` 타입 무변.
  - 모바일: 행 버튼 2개가 390px에서 제목 폭을 잠식하지 않게 `shrink-0` 유지 · 텍스트 버튼 그대로(아이콘 도입 0).
- **E. 코드 블록 언어 select 화살표 = 래퍼 `::after` chevron + `appearance: none`** (결정 ⑤)
  - select에 `appearance: none; -webkit-appearance: none; padding-right: 18px`(값·동작·옵션 무접촉 — stage-46
    규약 D 계승) · 래퍼 `div[contenteditable='false']`에 `::after`(빈 content · `position: absolute` · 우측 약 8px ·
    세로 중앙 · 6px 정사각 · `border-right`/`border-bottom` 1.5px solid `var(--text-muted)` · `rotate(45deg)` ·
    `pointer-events: none`). 래퍼가 이미 `position: absolute`라 컨테이닝 블록 추가 0.
  - **배경 SVG data-URI 방식 금지** — `background-image`에 색 리터럴이 들어가 불변 규칙 5 위반(`currentColor`가
    data-URI에서 안 통한다). `::after` border 방식은 토큰만 쓴다.
  - 특이도: 기존 select 규칙(`:481` — (0,4,2))에 선언을 **추가**하면 된다(새 셀렉터 신설 불필요) · hover/focus 규칙
    `:497~500` 무변 · 포커스 링은 브라우저 기본 유지(접근성 — `outline` 제거 0). 구현자 재량 = 정확한 px·위치
    (위 값은 권고).
- **F. 공통 한도**: 신규 의존 0(D10) · 색상 토큰만(불변 규칙 5) · **R37 초기 청크 증가 금지**(훅 1개·훅 호출 1개 ·
  버튼 1개 — 전부 lazy 노트 청크 또는 ui 청크 안 · 엔트리 청크 수치 기록) · 백엔드 diff = `routers/notes.py` +
  `tests/test_notes_duplicate.py`뿐(`models.py`·`schemas/note.py`·`main.py`·Alembic 무접촉 — `NoteOut` 재사용) ·
  어댑터·저장 포맷 무접촉.

## 3. 체크리스트

### 묶음 B — 백엔드 (규약 C)

- [x] B-1. `backend/routers/notes.py`에 `@router.post("/{note_id}/duplicate", response_model=NoteOut)`
      `duplicate_note(note_id, db)` 추가 — `_get_note_or_404` 재사용 후 **`is_active` 거짓이면 같은 404**(별도
      메시지 없음) · 제목 규칙(`rstrip` + `" (사본)"` · 공백뿐 → `"(사본)"` · 200자 초과 시 원제 절단) 헬퍼
      `_duplicate_title(title: str) -> str` 1개(순수 함수 — 테스트 대상) · `models.Note(title=…,
      content_blocks=원본.content_blocks, content=원본.content, blocks_version=원본.blocks_version)` INSERT ·
      commit · refresh · `_to_note_out`. 기존 5개 핸들러 무변(diff = 추가만). 라우트 순서: `/{note_id}` 계열
      뒤에 두어도 FastAPI가 경로 세그먼트 수로 구분하므로 충돌 0(확인만).
- [x] B-2. `backend/tests/test_notes_duplicate.py` 신설(`test_documents_blocks_post.py`의 in-memory
      SQLite + `TestClient` 픽스처 관례) — ⓐ 생성 → 복제 → 응답 `id ≠ 원본` · `title == 원제 + " (사본)"` ·
      `content_blocks`·`content`·`blocks_version` 동일 · `is_active` true ⓑ 목록에 2건 · 원본 무변(`GET` 재조회)
      ⓒ 공백 제목 → `"(사본)"` ⓓ 199~200자 제목 → 결과 정확히 200자 이하 + 접미사 유지 ⓔ 삭제(`DELETE`) 후
      복제 → 404 ⓕ 없는 id → 404 ⓖ 반복 복제 → `" (사본) (사본)"`. `_duplicate_title` 단위 케이스 포함.
- [x] B-3. `powershell -ExecutionPolicy Bypass -File scripts/run-tests.ps1 -Path tests/test_notes_duplicate.py`
      통과 · `-Full` 무회귀(applied_exam 2건 PATH 의존 실패는 기존 관찰 — 회귀 아님).

### 묶음 F — 프론트 구현 (권장 순서 F-1 → F-2 → F-3 → F-4 — 상호 독립)

- [x] F-1. **FB-21**(규약 A) — `notes.css:161` `var(--border)` → `var(--accent)` · `:166~168` note 규칙 삭제 ·
      주석 1줄(FB-21 · "기본 규칙 = note 스타일 — 엔진이 기본값 prop `data-variant`를 내보내지 않음") · `warn`·
      `tip` 무변.
- [x] F-2. **FB-22**(규약 B) — `toolbar/useEditorDerived.ts` 신설 + `NoteFormattingToolbar.tsx:521~522`·`:561~562`
      전환(`cropTargetEquals` 얕은 비교 1개 신설 · `computeCropTarget`·`columnsInsertBlocked` 무변) ·
      `useAtomInlineGuard` 재구성은 구현자 판단(하면 동작 동일 확인) — 재구성함(1줄 위임, 동작 동일).
- [x] F-3. **노트 복제 UI**(규약 D) — `api/notes.ts` `useDuplicateNote()` + `NoteListPage.tsx` 행 [복제] 버튼
      (진행 중 비활성 · 성공 navigate · 실패 `setActionError`) · 색은 기존 클래스 토큰만.
- [x] F-4. **코드 언어 select 화살표**(규약 E) — `notes.css:481` 규칙에 `appearance: none` + `padding-right` 추가 ·
      래퍼 `::after` chevron 규칙 신설(주석: 배경 SVG 금지 사유 = 불변 규칙 5).

### 묶음 V — 검증 (구현 후)

- [x] V-1. `npm run build` 성공(성공/실패만) + **엔트리 청크(`index-*.js`) 증감 수치 — R37 증가 없음**(stage-47 기준선
      = stage-46 1,578,573 B와 동일 · 노트 lazy 청크 증가분만 기록) — 빌드 성공, 엔트리 청크 1,578,573 B로
      동일(증가 0). `NoteListPage` lazy 청크 4,574 B(복제 버튼분 증가).
- [ ] V-2. `scripts/run-tests.ps1`(B-3) 통과 · 기존 헤드리스 스크립트(`s41-columns-editor.mjs`·`s47-mark-escape.mjs`
      등 run-tests 편입분) 무회귀 · `scripts/invariant-scan.ps1` **PASS**(색 리터럴 0 — `::after` border 색 토큰
      확인).
- [ ] V-3. **브라우저 실측**(사용자가 띄운 `localhost:8000` 우선 — 불가 시 임시 포트 자체 기동 허용 · **8000 금지 ·
      종료 + 리스너 부재 확인 필수**). ⓐ **FB-21** — 노트에 콜아웃 3종(기본·warn·tip) 삽입 → 각 `.bn-block-group`의
      `getComputedStyle(...).borderLeftColor`가 `--accent`·`--warning`·`--correct` 계산값과 일치 · 라이트/다크 전환
      후 재확인 · 기존 데이터의 목록 밖 variant(있으면)도 accent ⓑ **코드 select** — 코드 블록 삽입 → 네이티브
      화살표 0 + chevron 표시 · 클릭 시 드롭다운 열림·언어 변경 정상(값·동작 무접촉) · 다크 테마 chevron 색 토큰
      추종 · 390px 에뮬에서 위치 유지 ⓒ **FB-22 회귀 0** — 툴바 [다단] 버튼 비활성 판정(표/다단 안팎 이동) ·
      [자르기] 대상 판정(이미지 선택/해제)이 기존 경로에서 동일 + 선택 좌표 불변 트랜잭션 1건(예: 이미지 블록
      슬래시 삽입 직후 Ctrl+Z/Ctrl+Y)에서 버튼 상태가 갱신됨 · 블록 타입 셀렉트 드롭다운 즉시 닫힘 회귀 0(stage-40
      `useFocusTrap` 전례) ⓓ **노트 복제** — 목록 [복제] → 새 노트 편집 화면 진입 · 제목 `" (사본)"` · 본문(콜아웃·
      이미지·참조 칩 포함 노트로) 동일 렌더 · 목록 복귀 시 2건 · 원본 무변 · [취소]/복구 다이얼로그 오작동 0(S39
      스냅샷은 새 노트 기준) · 네트워크 `POST /api/notes/{id}/duplicate` 1회(중복 클릭 시 1회) ⓔ 모바일 에뮬(390px)
      — 목록 행 [복제]·[삭제] 2버튼과 제목 줄 겹침 0. 테스트 노트는 전부 `DELETE` 원상복구.
- [ ] V-4. **백엔드 diff = `routers/notes.py` + `tests/test_notes_duplicate.py`뿐**(`git diff --stat -- backend`) ·
      `alembic/versions` diff 0 · `package.json`·잠금 파일 diff 0.

### 묶음 D — 문서 (검증 종료 후)

- [ ] D-1. **api §4.28 ⑦ `[S48]` 실측 확정 표기**(편성 추기 → "구현 실측 2026-xx-xx" 부기 · 행 번호 앵커) + **screens
      §5.16 S48 블록 실측 재개정 = Design v1.58**(편성 추기 v1.57 → 실측 반영 · 색인 헤더 승급 · 관례대로 밀려나는
      v1.54 괄호 줄은 `docs/04-archive/design-changelog.md` 맨 위로 원문 이동).
- [ ] D-2. `editor-v2.plan.md` §13 — FB-2 행(복제 부기 뒤)·FB-21·FB-22 행에 `← 완료(stage-48 · 날짜)` 1줄씩 추기.
- [ ] D-3. 매뉴얼 `docs/manual/user-manual.html` 노트 절에 **복제 1줄**("목록의 [복제]로 사본을 만들어 바로 편집 —
      제목에 ' (사본)'이 붙습니다"). 나머지 3건은 매뉴얼 무변(외양·내부 정비).
- [ ] D-4. 본 문서 완료 기록(§7)·체크박스 + §6 절차(CHANGELOG·VERSION·stage-index·backlog).

## 4. 이 단계에서 하지 않는 것

- **DDL 0**(계획서 §6.2 무변 · Alembic 리비전 0 · `models.py`·`schemas/note.py` 무접촉) · 마스터 §14 M 행 추가 0.
- **기존 노트 API 5개 계약 변경 0** — 목록 파라미터·표현·에러 표 무변. 복제는 추가 1개뿐.
- **노트 복구·휴지통 0**(D8-구현 별도 · §4.28 ⑥ 유지) — 삭제분 복제 = 404가 그 경계다.
- **편집 화면 상단 [복제] 0**(규약 D — 실수요 시 FB 등재) · 복제 시 제목 일련번호·중복 감지 0 · 문서(`documents`)
  복제 0(노트 전용).
- **FB-11-ⓑ 코드 블록 구문 강조·복사 버튼 착수 0**(신규 의존 lazy 청크 판단 동반 — 별도 편성) · 언어 select의
  옵션 목록·값·동작 변경 0(외양만).
- **콜아웃 variant 추가·리더(`MarkdownView`)·인쇄 경로 CSS 변경 0** — FB-21은 편집 표면 `notes.css`만.
- **`useEditorDerived` 전면 확산 0** — FB-22 2곳(+ 구현자 판단으로 `useAtomInlineGuard`)만. 다른 툴바 구독은
  등재된 결함 아님.
- **신규 의존 0**(D10) · 새 라우트·설정 키·단축키 0 · 어댑터·방언 왕복·저장 포맷 무변.
- **FB-8 모바일 드로어 확장 · D11-ⓐ 참조 붙여넣기 · 노트-FTS·인쇄 통합 착수 0**(backlog §1 존치).
- **v2.x 백로그 착수 0** — 신규 아이디어는 별지 §13 FB 등재 + backlog 1행.

## 5. DoD (완료 정의)

**자동 검증(에이전트 수행):**
1. `npm run build` 성공 + 엔트리 청크 증가 없음(R37 — 수치 기록).
2. `test_notes_duplicate.py` 신설·통과 + `run-tests.ps1 -Full` 무회귀 · `invariant-scan.ps1` PASS.
3. 백엔드 diff = `routers/notes.py` + 테스트 1파일뿐 · Alembic diff 0 · 신규 의존 0.
4. 브라우저 V-3 ⓐ~ⓔ 전건 통과(콜아웃 3색 계산값 · select chevron · FB-22 회귀 0 · 복제 왕복 · 모바일 에뮬).
5. 문서 묶음 D 전건(Design v1.58 · §13 추기 3행 · 매뉴얼 1줄).

**사용자 확인(게이트 본체):**
6. ⓐ PC 실사용 — 기본 콜아웃 좌측선 accent 체감 · 코드 블록 언어 화살표 외양 · 노트 [복제] → 사본 편집 ⓑ **폰
   실기기** — 목록 행 [복제]/[삭제] 터치 오조작 0 · 사본 진입 정상 ⓒ 툴바 [다단]/[자르기] 회귀 체감 0 ⓓ **치명
   결함 0 회신**.

**게이트**: 1~5 전건 + 6 치명 0 → **v2.01.3 발행**(§6). 치명 발견 시 발행 보류·수정 선행.

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` — **v2.01.3 항목 1개**(stage-48 1불릿 — 노트 복제 API+버튼 · FB-21 콜아웃 기본
   좌측선 · FB-22 파생 구독 통일 · 코드 언어 select chevron).
2. 루트 `VERSION` = `2.01.3`.
3. `stage-index.md` 48행 갱신(완료·일자·산출 버전 v2.01.3).
4. `backlog.md` — §1 `코드-언어select`·`FB-2-잔여` · §2 `FB-21`·`FB-22` 4행을 §4로 **종결 이동**(`종결(stage-48 ·
   날짜)`) · `scripts/backlog-scan.ps1` PASS 확인.
5. 출처 추기 — 별지 §13 FB-2(복제 부기 뒤)·FB-21·FB-22 `← 완료(stage-48 · 날짜)`(D-2). 코드-언어select는 별지 행이
   없으므로 등록부 종결 행만.
6. 매뉴얼 1줄(D-3) · `CLAUDE.md` 머리 버전 줄 1곳(경위 전재 금지) · git tag `v2.01.3`(머지 커밋 대상).

## 7. 완료 기록 (구현·검증·문서 경위 정본 — 착수 후 추기)

- **편성**(2026-09-12): 지시서 확정 — 규약 A~F(사용자 확정 대기 0 · 결정 ①~⑤ 위임 판정) · api §4.28 ⑦ `[S48]`
  추기 · screens §5.16 S48 블록 추기(Design v1.57) · stage-index 48행 · backlog 4행 `편성 = stage-48` · 별지 §13
  FB-2·FB-21·FB-22 편성 추기.
