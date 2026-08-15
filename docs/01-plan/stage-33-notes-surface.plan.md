# Stage 33 — 에디터 v2: 노트(베타) 저장·표면 골격 (M33-1)

> 상태: **착수 가능(2026-08-16 지시서 확정)** — 선행 M32(stage-32) 완료·검토 통과.
> 범위: **M33의 앞 절반** — `notes` 저장소(DDL·API) + BlockNote 편집 표면 골격 + **코어 블록** 왕복.
> 방언 이식(F52 인라인·콜아웃)·참조 칩 UX·이미지·붙여넣기는 **stage-34**가 맡는다(아래 "범위 분할" 참조).
> M33 게이트(패리티 체크리스트 + 노트 실사용)는 **stage-34 말미**에 판정한다 — 이 단계는 게이트 전 단계다.
>
> 정본: `editor-v2.plan.md` §5.2(저장 모델)·§5.4(팔레트·전달 사항 ⓐ~ⓕ 확정분)·§8 M33 행·§12(D9 드래프트 격리) ·
> 계약 정본 = 설계 **api §4.28 [S33]** + **screens §5.16** · 스키마 정본 = 계획서 **§6.2 `notes`** ·
> 블록 스키마 정본 = `frontend/src/editor2/schema/blocks.ts`(M32 산출물 — **수정 금지, import만**).

## 범위 분할 (M33 = stage-33 + stage-34 — 2026-08-16 판단·근거)

M33 원문 범위는 "신규 저장 + 새 편집기 1차 + 방언 이식 + 이미지 + 붙여넣기 + 참조 칩 UX 재설계"로,
**백엔드 신규 테이블·신규 API 5개 + 프론트 신규 화면 2개 + 커스텀 스펙 8종 + 피커 UX + 붙여넣기 파이프라인**이
한 단계에 들어간다. 지금까지 단일 단계의 최대치(stage-20 = 엔드포인트 13개, stage-30 = 프론트 전용 12 DoD)를
양쪽 축에서 동시에 넘는다. 분할 근거 4가지:

1. **검증 성격이 다르다** — 앞 절반은 "저장·왕복이 성립하는가"(기계 검증 가능), 뒤 절반은 "현행 문법이 전부
   재현되는가 + 손으로 써서 불편이 없는가"(패리티 체크리스트 + 실사용). 한 단계에 섞으면 실패 지점이 흐려진다.
2. **분배 단위가 다르다** — 앞 절반만 백엔드 묶음이 있고(`backend-dev`), 뒤 절반은 프론트 전용이다.
3. **되돌림 비용** — 어댑터(앱 블록↔BlockNote)가 흔들리면 방언 스펙 8종이 통째로 재작업된다. 어댑터를
   코어 범위에서 먼저 **왕복 스크립트로 고정**한 뒤 방언을 얹는 것이 M32가 스키마→변환기 순으로 간 것과 같은 순서다.
4. **중간 산출물이 실사용 가능하다** — stage-33 종료 시점에 "코어 블록만 되는 노트"가 실제로 돌아가므로
   한글 IME 1차 실측(R35 2차 관문의 예비 관문)을 방언 작업 전에 앞당겨 할 수 있다.

**M 번호 ↔ stage 번호 대응표(이 분할로 처음 어긋난다 — 이후 문서는 이 표를 따른다)**

| 로드맵 M | stage 문서 | 비고 |
|---|---|---|
| M31 | stage-31 | 1:1 |
| M32 | stage-32 | 1:1 |
| **M33** | **stage-33 + stage-34** | **본 분할** — M33 게이트 판정은 stage-34 말미 |
| M34(documents 탑재·저장 전환) | stage-35 | 번호 +1 |
| M35(Notion UX 마감) | stage-36 | 번호 +1 |
| M36(모바일 마감 → v2.00.0) | stage-37 | 번호 +1 |

## 범위 요약

- **백엔드 신규**: `notes` 테이블 1개(DDL — 불변 규칙 6: 계획서 §6.2 등재 완료 + **Alembic 세트 필수**) +
  라우터 1개(`backend/routers/notes.py`) + 엔드포인트 5개(§4.28). **기존 테이블·라우터·서비스 diff 0.**
- **프론트 신규**: `frontend/src/editor2/` 아래에만 — `blocknote/`(스키마·테마 결선)·`adapter/`(앱 블록↔BlockNote,
  **순수 JSON 변환**)·`api/`(노트 훅)·`pages/`(목록·편집). 라우트 2개(lazy) + 설정 화면 진입 링크 1개.
- **신규 npm 의존 0건** — `@blocknote/core`·`@blocknote/react`·`@blocknote/mantine` **0.54.0**(전부 MPL-2.0)과
  `@mantine/core`·`@mantine/hooks`(MIT)는 **stage-31 PoC 때 이미 설치돼 있다**(`frontend/package.json` 실측).
  이 단계는 **버전을 1자도 올리지 않는다**(D2 = 0.54.0 정확 고정·R33). 추가 도입 후보(`@blocknote/code-block`·
  `@blocknote/math-block`)는 **stage-34에서 라이선스 확인 후 판정** — 이 단계에서 설치 금지.
  **`@blocknote/xl-*`는 영구 금지(GPL-3.0 — D10·R40).**
- **코어 블록만** 다룬다: paragraph · heading(1~6) · listItem(bullet/ordered/check, 중첩) · quote · codeBlock ·
  table · image(블록) · divider. 인라인은 **내장 마크만**(bold·italic·strike·underline) + inlineCode + link.
  방언(형광펜·스포일러·`:t`·콜아웃·참조 칩·문서 임베드·수식·인라인 이미지·sourceFallback)은 **stage-34**.
- **D9 드래프트 격리** — 아래 "격리 계약" 절이 허용 접촉점의 전수 목록이다. 그 밖은 1바이트도 수정 금지.

## 격리 계약 (D9 — 위반 = 즉시 롤백 사유)

**수정 절대 금지**(경로 실측 2026-08-16): `components/MarkdownFieldEditor.tsx` · `components/EditablePreview.tsx` ·
`components/RichBlockEditor.tsx` · `components/DocEditor.tsx` · `components/MarkdownView.tsx` ·
`components/markdown/**`(`remarkStudy.ts`·`palette.ts` 등) · `utils/htmlPasteMarkdown.ts`(실측 경로 — S30 붙여넣기
화이트리스트. stage-34가 **import만** 한다) · `frontend/src/editor2/poc/**` ·
`frontend/src/editor2/schema/blocks.ts` · `frontend/src/editor2/transform/**` · `backend/**`의 기존 파일
(단 `main.py` 라우터 등록 1줄과 `models.py` 모델 추가는 아래 허용 목록). **import는 전부 허용**한다.

**허용 접촉점(이 6곳뿐 — diff가 이 목록 밖으로 나가면 보고)**

| 파일 | 허용 변경 |
|---|---|
| `backend/models.py` | `Note` 모델 클래스 추가만 |
| `backend/main.py` | notes 라우터 등록 1줄 |
| `backend/alembic/versions/*` | 신규 리비전 파일 1개 |
| `frontend/src/App.tsx` | lazy 라우트 2개 추가(`/notes`·`/notes/:id`) — stage-31 `/editor2-poc` 전례 |
| `frontend/src/pages/Settings.tsx`(실측 확인 2026-08-16) | 그룹 ⑥ 아래 **실험실(베타) 카드 1개** — 링크 1개뿐(로직 0·신규 색 0 · screens §5.11) |
| `frontend/package.json`·lockfile | **이 단계에서는 변경 0이 정상** — 변경이 필요해지면 착수 중단·보고 |

`documents` 테이블·기존 API·FTS·백업(F27)은 **무접촉**이다. notes는 FTS 색인 대상이 **아니다**(§4.28 ⑥).

## 확정 규약 (구현 전 결정 — 이 문서 + §4.28 + screens §5.16이 정본)

### A. 저장 계약 — 프로젝션은 서버가 만들지 않는다

- 소스 오브 트루스 = **블록 JSON**(`notes.content_blocks`). Markdown(`notes.content`)은 **파생 프로젝션**이며
  **클라이언트 변환기(`editor2/transform/blocksToMarkdown`)의 산출물을 요청에 함께 실어 저장**한다.
  서버는 Markdown을 **만들지도, 해석하지도, 검증하지도 않는다**(변환기가 프론트에만 존재 — 파서 2개 금지 원칙 D4).
- 따라서 `content_blocks`와 `content`는 **항상 같은 요청에 함께** 온다(둘 중 하나만 = 422 `projection_required`).
- 서버 검증은 **얕게**: JSON 객체이고 `version`이 1 이상 정수이며 `blocks`가 배열인지까지. **블록 내부 구조를
  서버가 검증하지 않는다** — 검증하는 순간 스키마 정본이 둘이 된다(`blocks.ts`가 단일 출처).
- `blocks_version` = `content_blocks.version`의 **컬럼 사본**. 사유: M34 지연 마이그레이션이 "버전 n 이하 전부"를
  **SQL로** 찾아야 하는데, 서버가 JSON을 해석하지 않는 계약과 양립하려면 컬럼이어야 한다(§6.2 주석에 동일 기록).

### B. 어댑터 = 순수 JSON 변환 (엔진 격리 + 검증 가능성)

- `editor2/adapter/`는 **BlockNote 에디터 인스턴스를 쓰지 않는다** — 앱 블록(JSON) ↔ BlockNote 블록(JSON)의
  **순수 함수**로만 작성한다(`toBlockNoteBlocks(doc)` / `fromBlockNoteBlocks(blocks)`).
- 이유 2가지: ① **DOM 없이 Node 스크립트로 왕복 검증**이 가능해진다(이 앱에는 테스트 러너가 pytest뿐이다)
  ② 엔진 교체(후보 C) 시 갈아끼울 지점이 이 파일들로 국소화된다(R33).
- BlockNote 쪽 타입은 `@blocknote/core`의 타입만 참조(런타임 import 최소화 — 어댑터 모듈이 편집기 청크를
  끌어오지 않도록 `import type` 우선).
- **어댑터가 없는 곳에서 BlockNote 타입을 쓰지 않는다** — 화면 코드는 어댑터 공개 API만 부른다.

### C. 자동 저장·저장 상태

- 저장 = **디바운스 자동 저장**(유휴 1.5초, 최대 대기 10초) + **명시 저장(Ctrl+S / [저장] 버튼)**.
- **IME 조합 중에는 저장을 트리거하지 않는다**(`compositionstart`~`end` 보류 — S30 ⑥ 규약 계승).
- 저장 상태 3종 표시: `저장됨(시각)` / `저장 중…` / `저장 실패 — 다시 시도`(서버 `message` 그대로 렌더 — §3).
- 실패 시 로컬 편집분을 **버리지 않는다**(다음 자동 저장 주기에 재시도 · 이탈 시 `beforeunload` 경고).
- 낙관적 잠금(updated_at 조건부 저장)은 **하지 않는다** — 단일 사용자 전제(§7.2). 기록만.

### D. 빈 문단 처리 확정 (M32 전달 사항 ⓓ)

- **현 변환기 동작(② 블록 JSON에는 보존·프로젝션에서만 생략)을 확정 채택**한다. 저장 시 빈 문단을 제거하지 않는다.
  근거: 블록 JSON이 소스 오브 트루스이고, 사용자가 의도적으로 만든 빈 줄을 저장 때마다 지우면 캐럿이 사라지는
  파괴적 편집이 된다.
- **단 하나의 예외 = 문서 말미 연속 빈 문단 트림**. BlockNote는 구조상 말미에 빈 문단을 유지하므로 그대로 두면
  저장을 반복할 때마다 빈 문단이 누적된다. **말미의 연속 빈 문단은 1개만 남기고 잘라 저장**한다(본문 중간은 불변).
- 계약 명문화: 노트의 왕복 계약은 **md→블록→md**(M32 DoD)이며, **블록→md→블록**은 빈 문단만큼 비대칭이다.
  이 비대칭은 손실이 아니라 프로젝션 소비(리더·LLM·검색)의 정상 동작이다.

### E. 블록 메타데이터 입력 도메인 (M32 전달 사항 ⓔ — 이 단계 해당분)

- **코드 블록**: 언어는 **드롭다운 선택만**(BlockNote 내장 목록). 펜스 정보 문자열(`info`) **자유 입력 UI를 만들지
  않는다** — 백틱·개행이 들어갈 경로가 원천적으로 없다. 기존 데이터의 `info` 잔여분은 **보존만**(어댑터가 props로
  왕복시키되 편집 UI를 노출하지 않는다).
- 콜아웃 variant/title, `:t` 속성 편집 등 나머지 ⓔ 항목은 **stage-34**가 다룬다(이 단계에 해당 블록이 없다).

### F. 화면·라우트

- 라우트 2개: `/notes`(목록) · `/notes/:id`(편집). 둘 다 **lazy 청크**(stage-31 PoC 전례).
- 사이드바·하단 탭바·홈은 **무변경** — 진입은 **설정 화면의 실험실(베타) 카드 링크 1개** + 직접 URL.
  베타 표면을 상시 메뉴에 올리지 않는 것이 D9 격리의 UI 측면이다(정식 노출은 M34 이후 판단).
- 상세는 screens §5.16.

## 체크리스트

### 백엔드 묶음 — 담당 `backend-dev`(Sonnet). 계약 정본 = 설계 §4.28

- [x] B-1. **Alembic 마이그레이션 세트 1개** — 계획서 §6.2의 `notes` DDL + 인덱스 `ix_notes_active_updated`를
      그대로 생성. `upgrade`/`downgrade` **왕복 실행 확인**(downgrade = DROP TABLE). 기존 리비전 체인 말미에 연결.
- [x] B-2. `backend/models.py`에 `Note` 모델 추가(§6.2와 컬럼·기본값 1:1 · `updated_at`은 SQLAlchemy `onupdate`
      — §6.2 추가 구현 노트의 기존 관례). **다른 모델 diff 0.**
- [x] B-3. `backend/routers/notes.py` 신설 + `main.py` 등록 — 엔드포인트 5개(§4.28 ①): 목록·생성·단건·수정·소프트 삭제.
      Pydantic 스키마는 `backend/schemas/note.py`(리소스별 파일 관례).
- [x] B-4. **저장 계약 검증**(§4.28 ②③) — `content_blocks`는 객체이고 `version`(≥1 정수)·`blocks`(배열) 존재만
      확인(딥 검증 금지), `content_blocks`↔`content` **동반 필수**(한쪽만 = 422 `projection_required`),
      크기 상한(`content_blocks` 직렬화 1,000,000자 · `content` 200,000자 · `title` 200자) 초과 = 422.
      DB 저장은 `json.dumps(ensure_ascii=False)` 문자열, 응답은 객체로 역직렬화. `blocks_version` 컬럼 동기화.
- [x] B-5. **목록 계약**(§4.28 ④) — 페이지네이션 §3(`page`·`size`, 기본 50) · 기본 `is_active=1`만 ·
      `include_inactive=1` 노출 · `q` = `title`·`content` LIKE(**FTS 미사용**) · 정렬 `updated_at DESC` ·
      항목에 `content_blocks`·`content` **미포함**, 대신 `excerpt`(서버가 `content` 앞 200자 슬라이스 + 개행·연속
      공백 1칸 축약. Markdown 기호 제거 없음 — 서버는 Markdown을 해석하지 않는다).
- [x] B-6. **소프트 삭제**(불변 규칙 3) — `DELETE`는 `is_active=0` UPDATE만(물리 삭제 코드 0), **재삭제 멱등**,
      응답 = 삭제된 노트 표현(`is_active:false`). 단건 GET은 삭제분도 200 + `is_active:false`.
      `PATCH`로 `is_active`를 바꾸는 경로는 **만들지 않는다**(복구 UI는 이 단계 범위 밖 — "하지 않는 것").
- [x] B-7. **회귀·무접촉 확인** — `documents`·FTS 트리거·백업(F27)·기존 라우터 **diff 0**, notes는 FTS 색인 대상이
      아님을 코드로 확인(트리거·인덱스 추가 0). `scripts/run-tests.ps1` 통과(sm2 필수 테스트 무영향).
- [x] B-8. **스모크 실행 보고** — 생성 → 목록(검색·페이지) → 단건 → 수정 → 삭제 → 목록 제외 확인 → 재삭제 멱등,
      그리고 422 4종(`projection_required`·`blocks_invalid`·`too_large`·`title_too_long`)·404 각 1회.

### 프론트 묶음 — 담당 `frontend-dev`(Sonnet · **F-3/F-4 어댑터는 opus 승격 권장**)

- [x] F-1. `editor2/api/notes.ts` — 기존 `api/client.ts` 재사용한 React Query 훅 5종(목록·단건·생성·수정·삭제).
      쿼리 키 관례는 기존 리소스 훅을 따른다. **기존 `api/` 파일 수정 0**(신규 파일만).
- [x] F-2. `editor2/blocknote/schema.ts` — 코어 블록 스키마 정의(내장 블록 세트 + `divider` 커스텀 블록 1종) +
      `dictionary: ko`(`@blocknote/core/locales`) + **테마 결선**(`useThemeStore` 연동 · 색은 `tokens.css` 변수만 —
      불변 규칙 5. PoC `poc.css`의 결선 방식을 **복제**하되 PoC 파일은 수정하지 않는다).
- [x] F-3. `editor2/adapter/toBlockNote.ts` — 앱 블록 → BlockNote 블록(**순수 JSON**, 규약 B).
      코어 범위: paragraph·heading·listItem(bullet/numbered/check + children 중첩)·quote·codeBlock·table·
      image(width→`previewWidth`)·divider + 인라인(bold·italic·strike·underline·inlineCode·link·hardBreak/softBreak).
      **팔레트 밖(방언) 노드를 만나면 손실 없이 보류**: 이 단계에서는 해당 노트를 편집 표면에 올리지 않고
      "이 노트에는 아직 지원하지 않는 서식이 있습니다" 안내 + 읽기 전용(미리보기) 폴백(하단 F-8).
- [x] F-4. `editor2/adapter/fromBlockNote.ts` + `index.ts` — 역방향. **id는 새로 부여하지 않고 왕복 보존**
      (BlockNote가 부여한 id를 앱 블록 `id`로 그대로 쓴다 — 동형성 비교에서는 제외되는 필드다).
      규약 D의 **말미 빈 문단 트림**을 여기서 적용(저장 직전 1곳 — 화면 코드에 흩뿌리지 않는다).
- [x] F-5. **어댑터 왕복 검증 스크립트** `frontend/scripts/s33-adapter-roundtrip.mjs`(jiti 로더 관례 계승) —
      계열 3종: ① `roundtrip-corpus.mjs`(M32 공용 코퍼스)의 **코어 범위 표본**을 md→블록→BN→블록으로 돌려
      **id 제외 동등** ② 그 블록을 다시 `blocksToMarkdown`으로 투영해 M32 정규형 동등(`s32-normalize.mjs` 재사용)
      ③ 방언 표본 입력 시 **어댑터가 조용히 버리지 않고 명시적으로 미지원을 보고**하는지(손실 0 계약).
      **총 검사 수·실패 수를 보고**한다(실패 0이 DoD).
- [x] F-6. `editor2/pages/NoteListPage.tsx` — 목록·검색·[새 노트]·삭제(확인 후)·빈 상태·페이지네이션(screens §5.16).
- [x] F-7. `editor2/pages/NoteEditPage.tsx` — 제목 입력 + BlockNote 뷰(`BlockNoteView` · `@blocknote/mantine`) +
      저장 상태 표시(규약 C) + [삭제] + **[Markdown 미리보기] 토글**(프로젝션 문자열을 공용 `MarkdownView`로
      렌더 — **import만·무수정**. D5 이행 + 왕복 육안 검증 도구를 공짜로 얻는다).
- [x] F-8. **저장·로드 파이프라인** — 로드: `content_blocks` → 어댑터 → BlockNote 초기 콘텐츠. 저장: BlockNote →
      어댑터 → 앱 블록 → `blocksToMarkdown` 프로젝션 → `PATCH {content_blocks, content}`(둘 항상 동반 — 규약 A).
      미지원 서식 포함 노트는 F-3의 읽기 전용 폴백(편집 표면에 올리지 않으므로 **덮어쓰기 사고 0**).
- [x] F-9. **라우트·진입점** — `App.tsx` lazy 라우트 2개 + 설정 화면 **실험실(베타) 카드 1개**(링크뿐 · 신규 색 0 ·
      screens §5.11 반영분). 사이드바·탭바 **무변경**.
- [x] F-10. **번들·코드 스플리팅**(R37) — `npm run build`에서 **초기 청크 증가 ≤ 5KB(min)** 확인(편집기·Mantine은
      전부 지연 청크). 초과 시 원인(정적 import 누출) 제거 후 재측정 — 수치를 완료 기록에 남긴다.
- [x] F-11. **검증 일괄** — `tsc -b` + `npm run build` 성공 · `invariant-scan.ps1` PASS ·
      **s32 왕복 723건 회귀 무변**(`node frontend/scripts/s32-roundtrip-blocks.mjs`) · s30 회귀 365
      (`node frontend/scripts/s30-roundtrip.mjs 86d171d^` — 인자 주의, stage-32 기록 참조).

### 문서 묶음

- [ ] D-1. 본 문서 체크박스 `[x]` + 말미 **완료 기록**(경위·DoD 근거·번들 실측치·잔여·stage-34 인계 사항).
- [ ] D-2. `editor-v2.plan.md` §8 M33 행에 stage-33 완료 표기(과도한 개정 금지 — 상세는 이 문서가 정본).

## 이 단계에서 하지 않는 것 (stage-34 이후 — 착수 금지)

- **방언 이식 전부** — 형광펜(`==`)·스포일러(`||`)·밑줄 이외의 마이크로 마크·`:t`(글자색/바탕색/크기)·
  콜아웃(`:::note`)·문서 임베드·참조 칩·인라인 이미지·수식(`$`·`$$`)·sourceFallback 블록. **stage-34.**
- **참조 칩 UX(피커·라벨·클릭 동작)** — 결정은 `editor-v2.plan.md` §5.4에 확정돼 있으나 **구현은 stage-34**.
- **이미지 업로드·붙여넣기·드래그앤드롭** — stage-34(기존 `POST /api/uploads` §4.27 재사용, 신규 API 0).
- **`@blocknote/code-block`·`@blocknote/math-block` 설치** — 라이선스 확인 + 성숙도 판정 후 stage-34에서.
  **`@blocknote/xl-*`는 영구 금지(GPL — D10).** 어떤 이유로도 이 단계에서 의존을 추가하지 않는다.
- **`documents` 연결·지연 마이그레이션·`content_blocks` 컬럼** — M34(stage-35).
- **슬래시 메뉴 커스터마이즈·블록 드래그·찾기/바꾸기·TOC·웹 임베드·이미지 크롭·다단·문제 블록** — M35(stage-36).
- **모바일 터치 마감** — M36(stage-37). 이 단계는 "폰에서 열리고 글자가 들어간다" 수준까지만 확인한다.
- **노트 복구(휴지통) UI·노트 인쇄·노트 검색(FTS)·노트↔문서 상호 변환·백업 대상 확장** — 실수요 확인 전 금지.
  (백업은 `study.db` VACUUM INTO이므로 notes 테이블이 **자동 포함**된다 — 개정 0건.)
- 기존 편집기·리더 개선(이미지 `{w=}` 리더 반영 포함) — D9 격리 유지.

## DoD

1. **Alembic 왕복 성공** — upgrade 후 `notes` 테이블·인덱스 생성 확인, downgrade 후 원복 확인.
   계획서 §6.2의 DDL과 실제 스키마가 **1:1 일치**.
2. **API 스모크 전건 통과**(B-8의 정상 6단계 + 오류 5종) — 응답 형태가 §4.28과 일치.
3. **어댑터 왕복 스크립트(s33) 전건 통과** — 실패 0, 코어 범위 표본에서 **조용한 손실 0**.
4. **s32(723) · s30(365) 회귀 무변** · `run-tests.ps1` 통과.
5. **노트 CRUD 실동작** — 브라우저에서 노트 생성 → 코어 블록(문단·헤딩·목록 중첩·인용·코드·표·구분선·이미지 블록)
   입력 → 자동 저장 → 새로고침 후 동일 복원 → Markdown 미리보기가 내용과 일치 → 삭제 후 목록에서 사라짐.
6. **초기 번들 청크 증가 ≤ 5KB(min)** — 실측치 기록(R37).
7. **격리 확인** — `git diff -- . ':!frontend/dist'`가 "허용 접촉점" 표 + 신규 파일 밖으로 나가지 않음.
   금지 목록 파일 diff 0 · `documents` 관련 백엔드 diff 0 · **package.json diff 0**.
8. `tsc -b`·`npm run build` 성공 · `invariant-scan.ps1` PASS.
9. 문서 반영 완료(D-1·D-2).
10. **(사용자 이행) 한글 IME 1차 실측** — PC + 폰에서 노트 본문에 한글을 조합 입력·서식 적용·확정·이탈했을 때
    음절 소실·조합 깨짐이 없음을 확인(R35의 예비 관문. **2차 관문 = stage-34 말미 노트 실사용**).

## 게이트/판정 규칙

| 상황 | 판정 | 후속 |
|---|---|---|
| DoD 1~9 충족 | **stage-33 종결** | stage-34(방언 이식) 착수. 10은 병행 가능 |
| 어댑터 왕복에서 코어 범위 손실 발견 | **어댑터 보강이 원칙**(강등 금지 — M32 게이트 규칙 계승) | 보강 불가로 판명되면 손실 목록 + 표본 수를 정리해 **사용자 보고**(R34) |
| BlockNote 0.54.0의 결함으로 코어 블록 왕복이 불가 | **버전 상향 금지**(D2 = 0.54.0 정확 고정) — 회피책을 어댑터에 두고 기록 | 회피 불가 시 R33 실현으로 보고(엔진 재론은 사용자 결정 사항) |
| 신규 npm 의존이 필요해짐 | **착수 중단·보고** — 라이선스(MPL·MIT·Apache-2.0·BSD만) 확인 후 계획서 등재가 선행(D10·R40) | 등재 후 재개 |

## 구현 순서·분배 힌트

- **백엔드(B-1~B-8)와 프론트 F-2~F-5(어댑터)는 병렬 가능** — 접점이 §4.28 계약뿐이다.
- 프론트 순서: F-2(스키마) → F-3·F-4(어댑터) → **F-5(왕복 스크립트로 고정)** → F-1·F-6~F-9(화면) → F-10·F-11.
  어댑터를 스크립트로 붙잡기 전에 화면부터 만들면 디버깅이 UI를 통해서만 가능해진다(M32에서 확인된 패턴).
- 완료 후 리뷰는 관례대로 `stage-reviewer`(Opus). 완료 시 말미에 "완료 기록"을 추가한다.
