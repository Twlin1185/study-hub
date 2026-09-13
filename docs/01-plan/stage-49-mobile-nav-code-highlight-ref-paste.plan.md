# Stage 49 — 모바일 전체 내비 드로어 + 코드 블록 구문 강조·복사 + 참조로 붙여넣기 (FB-8 · FB-11-ⓑ · D11-ⓐ) (v2.0.x · 사소)

> 상태: **착수 전**(편성 2026-09-13 · 사용자 확정 대기 항목 0 — 위임 판정 결정 ①~⑧ · 검토·구현 시 실측 분기 2건은 §2 B-③·C-④에 판정 기준을 미리 적어 둠).
> **버전 영향: 사소**(CHANGELOG 규약 ③ — 새 화면(라우트) 0 · **DDL 0 · API 0**(신규 엔드포인트 0 · 기존 계약 무변) ·
> 퇴역 0. 실체 = 드로어 항목 확장(FB-8) + 코드 블록 강조·복사 버튼(FB-11-ⓑ) + 붙여넣기 진입 UX 1개(D11-ⓐ) — 전부
> 기존 표면 위의 다듬기·편의 액션. **신규 프론트 의존 1**(`@blocknote/code-block` — 규약 ③의 핵심 요건이 아니고 D10·R37
> 규율로 §2에서 별도 통제) → **편성 시점 고정 = 사소**) → 산출 버전 **v2.01.4 예정**(stage-48 = v2.01.3 발행 대기 선행 —
> 발행 단위 조건은 §6 ①). 마스터 §14 로드맵 M 행 추가 없음(사소 stage는 stage-index가 담당).
> 생성 경위: `backlog.md` §1 `FB-8`(모바일 드로어 전체 내비 — 별지 §13 FB-8 · 2026-08-22 사용자 제안) · §1 `FB-11-ⓑ`(코드
> 블록 구문 강조 + 복사 버튼 — 별지 §13 FB-11 ⓑ축 · stage-40에서 "실수요·번들 실측 후 별도 착수 전 결정"으로 존치 · 복사
> 버튼은 stage-40 ⓐ에서 제외분) · §1 `D11-ⓐ`(참조로 붙여넣기 — 별지 §10 D11 ⓐ · 사용자 확정 2026-08-23 "v2.x 이월" ·
> ⓑ 양방향은 착수 금지 유지) 3행을 **사소 stage 1개에 동승**(사용자 묶음 확정 2026-09-13). 우선순위 신호 = 최신 실수요
> (FB-8 · FB-11 사용자 제안) > 저비용 동승(D11-ⓐ — 저장 구조 0·진입 UX 1개).
> 정본 포인터: 화면 계약 = screens §5 공통 레이아웃 S49 단락(드로어) · §5.3 S49 불릿([참조 복사]) · §5.16 S49 블록(강조·복사·
> 붙여넣기) — 편성 추기 **Design v1.59** · api §4 무변(신규 API 0 — 색인 상태 줄에 명기) · 라이선스 규율 = 별지 §10 D10 ·
> §9 R40 · 번들 규율 = 별지 §9 R37(엔트리 청크 기준선 1,578,573 B — stage-46~48 동일) · 붙여넣기 파이프라인 정본 =
> `editor2/blocknote/paste.ts` 머리말(stage-34 규약 G) · 참조 문법 정본 = `components/markdown/refSyntax.ts`(설계 §4.19 ①) ·
> 발행 절차 = CHANGELOG 머리 규약 ⑤.

## 1. 범위 (프론트 3건 — 백엔드 0 · 코드 실측 2026-09-13 동반)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **FB-8**(backlog §1 · 별지 §13 454행) | 제안(사용자 2026-08-22) | 모바일 좌측 드로어를 **전체 내비 메뉴**로 확장 — 데스크톱 사이드바와 대등 | `frontend/src/components/Layout.tsx` — 하단 탭바 5개 `NAV_ITEMS:21~27`(홈·**커리큘럼**·퀴즈·복습·오답노트 — FB-8 원문의 "학습"은 실제로는 커리큘럼 · 렌더 `:230~234`) · 데스크톱 전용 `DESKTOP_EXTRA_ITEMS:31~35`(탐색·반입·인쇄) · `NOTES_NAV_ITEM:40` · 데스크톱 사이드바 = `:154~164`(5+3+노트+제안 배지) + 하단 그룹 `:165~184`(설정·LLM 작업·도움말 `<a href="/manual" target="_blank">`) · 모바일 헤더 `:198~223`(☰ `:202~209` · 검색 · 제안 배지 · ⚙️ 설정 `:215~221`) · **드로어 `:237~275`** = 노트 1항목(`:266`) + LLM 작업(`:267~272`)뿐 · 예비 주석 `:239` "향후 다른 항목이 필요해지면 이 자리에 늘린다" · `NavButton:42~91`(`compact`/`collapsed`/`onClick` 지원 — 드로어는 비압축 행 레이아웃 `:264~266`). **모바일에서 탐색·반입·인쇄·도움말 진입점 0**(도움말은 설정 화면 링크 경유 — screens §5 17행) |
| **FB-11-ⓑ**(backlog §1 · 별지 §13 462행 ⓑ축) | 제안(사용자 2026-08-24) + stage-40 이월분 | 코드 블록 **구문 강조**(`@blocknote/code-block` shiki) + **복사 버튼** | `frontend/src/editor2/blocknote/schema.ts` — `CODE_LANGUAGES:62~78`(15종: text·javascript·typescript·python·java·c·cpp·csharp·sql·html·css·json·yaml·bash·markdown · 별칭 포함) · `codeBlockSpecWithInfo:98~107`(`createCodeBlockSpec({ supportedLanguages })` — **`createHighlighter` 미지정 = 강조 없음**) · 스키마 등록 `:136` · `useEditorTheme:251~259`(`BlockNoteView theme=` — `NoteEditPage.tsx:680`·`BlockSurface.tsx:225` 등) · 머리 주석 `:56~59` "이 모듈은 DOM·번들러 없이도 로드될 수 있어야 한다"(헤드리스 `s33-adapter-roundtrip.mjs` 계열이 그대로 import) · `schema/blocks.ts:533` 표에 "하이라이트 = 무료 `@blocknote/code-block`" 예고 · 외양 CSS = `notes.css:443~528`(stage-40 규약 D + stage-48 F-4 — 블록 `:443~450` `background: var(--bg); color: var(--text)` · `pre:458~466` · select 래퍼 `:471~475`(absolute · top 6px · right 8px) · chevron `::after:482~493` · select `:504~519`) · `frontend/package.json:14~17,40` `@blocknote/core·mantine·math-block·react·server-util` **전부 0.54.0 고정** — `@blocknote/code-block` 미설치(`node_modules` 밖 근거 = package.json에 없음) · 복사 버튼 코드 0(`navigator.clipboard`·`writeText` grep = `frontend/src` 0건 — 공용 클립보드 유틸 없음) |
| **D11-ⓐ**(backlog §1 · 별지 §10 400행 D11 ⓐ) | 기능(사용자 확정 2026-08-23 v2.x 이월) | **참조로 붙여넣기** — 붙여넣을 자리에 문서 임베드 블록 삽입(원본→사본 단방향 = F43 성질로 기성립 · 저장 구조 0) | 임베드 블록 = `editor2/blocknote/specs/blocks.tsx:65~73` `docEmbed`(props `target`·`label` · `content:'none'`) · 삽입 커맨드 `refPicker/insert.ts:54~64` `insertDocEmbedBlock(editor, target, label)`(빈 문단이면 치환 · 아니면 뒤에 삽입 · 선택 미덮어쓰기) · 슬래시 진입 `slash/slashTable.ts:83`(`ref/embed`) · `:112`(`임베드` 항목 — 피커 경유) · target 도메인 `schema/refDomain.ts:109` `DOC_NO_RE = /^DOC-\d{4,}$/`(`isDocNo:111`) · 방언 문법 정본 `components/markdown/refSyntax.ts:18~27`(`REF_SCAN_RE` — `![[DOC-nnnn|별칭]]` = embed · `parseRefMatch`) · 깊이 상한 `:35` `MAX_EMBED_DEPTH = 2` · 붙여넣기 훅 = `editor2/blocknote/paste.ts:302~391` `createPasteHandler`(⓪ `blocknote/html:317` → ① 이미지 파일 `:330~341` → ② `text/html:344~373` → ③ 파일만 `:379~384` → 평문 기본 위임 `:389`) — **노트(`NoteEditPage.tsx:196`)·문서 블록 표면(`documents/BlockSurface.tsx:105`) 두 표면이 같은 팩토리를 공유** · 문서 상세 헤더 `pages/DocumentDetail.tsx:178~209`(좌 = 타입 배지·`doc_no:183`·북마크 `:184` / 우 = [편집]·[삭제] `:190~206`, 블록 편집 중 숨김 `:188`) · "참조 복사" 코드 0 |

**DDL 0(계획서 §6.2 무변 · Alembic 불필요) · 백엔드 diff 0 · API 0(기존 엔드포인트 무변 · 신규 0) · settings 키 0 ·
새 라우트 0 · 신규 프론트 의존 1(`@blocknote/code-block@0.54.0` — 규약 B) · 어댑터(방언 왕복)·저장 포맷 무변(임베드
블록은 기존 `docEmbed` 그대로 · 코드 블록 prop 무변) · 리더(`MarkdownView`)·인쇄 경로 무접촉.**

## 2. 확정 규약 (착수 전 결정 — 위임 판정 · 이 문서가 정본 · 사용자 확정 대기 0)

- **A. FB-8 드로어 = 데스크톱 사이드바의 거울(항목 데이터 단일 출처) — 하단 탭 5개 불변** (결정 ①)
  - 드로어 상단 그룹 = **`NAV_ITEMS`(5) + `DESKTOP_EXTRA_ITEMS`(3) + `NOTES_NAV_ITEM`** 순서 그대로(홈·커리큘럼·퀴즈·복습·
    오답노트·탐색·반입·인쇄·노트 — 사이드바 `:154~162`와 동일 배열을 map · 항목 리터럴 복제 금지). 하단 그룹 = **LLM 작업
    (기존) + 도움말**(사이드바 `:172~183`과 같은 `<a href="/manual" target="_blank" rel="noopener">` — 모바일 도움말 진입점
    신설 · screens §5 17행 "설정 화면 링크 경유"는 병존). 각 항목 탭 = `onClick`으로 드로어 닫힘(기존 `:266` 관례) ·
    `NavLink` active 표시 그대로.
  - **하단 탭바 5개와 중복 노출을 의도한다** — 근거: 사용자 원문이 "메뉴에 홈·커리큘럼 등이 다 빠져 있다"(= 드로어를 전체
    메뉴로 인식) · 부분 목록(탭바 제외분 4개만)은 "왜 이건 있고 저건 없나"를 다시 만든다 · F39 "탭 추가 금지"는 탭바
    한정이라 무충돌(FB-8 원문 판정 계승).
  - **설정은 드로어에 넣지 않는다** — 헤더 ⚙️(`:215~221`)가 1탭 거리라 드로어 경유(2탭)가 더 멀다 · 제안함 배지도 헤더에
    있어 미중복. (실수요 시 항목 1줄 추가로 끝나는 구조 — 등재만.)
  - 레이아웃: 드로어 패널(`:246~252`)에 **`overflow-y-auto`** + PWA standalone 상태바 회피 `pt-[calc(0.75rem+env(safe-area-inset-top))]`
    (헤더 `:198` 전례 — 브라우저 탭에서는 env()=0 무변) · 폭 `w-64 max-w-[80vw]` 무변 · 항목 11개 × ≈40px ≈ 440px + 머리
    — 소형 폰(640px 세로)에서도 스크롤 없이 들어가되 가로 모드는 스크롤. 아이콘·라벨 = `NavItem` 그대로(신규 아이콘 0).
  - 주석 `:237~239`("FB-8 전면 확장은 이번 범위 아님") 정정 · 예비 문구 삭제. 데스크톱 사이드바·탭바 diff 0(항목 배열
    참조만 공유). `aria-modal` 드로어의 포커스 트랩·ESC 닫기는 **현행대로**(기존에도 없음 — 이번 범위 밖 · §4).
- **B. FB-11-ⓑ 구문 강조 = `@blocknote/code-block@0.54.0` · `createHighlighter`는 동적 import · 엔트리 +0 B** (결정 ②)
  - **패키지**: `@blocknote/code-block` **0.54.0 정확 고정**(다른 5개 `@blocknote/*`와 동일 버전 — 잠금 승격 시 6개 일괄 · R33
    관례). **라이선스 확인 항목 = 체크리스트 F-3 ①**: 등록부 행은 "MIT"로 적었으나 BlockNote 저장소 패키지는 MPL-2.0이
    통례 — `npm view @blocknote/code-block@0.54.0 license`(npm 메타)로 실측해 값(MIT 또는 MPL-2.0 — **둘 다 D10 허용**)을 §7에
    기록 · 전이 의존(`shiki`/`@shikijs/*` = MIT) GPL 0건 확인(`math-block` 도입 전례 `schema.ts:33~36`). GPL·LGPL·AGPL이
    나오면 **도입 중단 → 자체 구현 후순위(D10) 보고**(이 stage에서 임의 대체 금지).
  - **결선 방식**: `codeBlockSpecWithInfo()`의 `createCodeBlockSpec({ supportedLanguages: CODE_LANGUAGES, createHighlighter })`에
    `createHighlighter: () => import('@blocknote/code-block').then((m) => m.codeBlock.createHighlighter())` 형태의 **지연 팩토리**
    를 넘긴다. 근거: ⓐ `schema.ts` 머리 계약 "DOM·번들러 없이 로드"(헤드리스 스크립트가 import) — 정적 import를 두면
    노드 왕복 스크립트가 shiki를 통째로 로드 · ⓑ **R37**: 엔트리 청크 +0 B는 당연하고(스키마는 이미 노트 lazy 청크) 편집
    청크에도 shiki 본체를 얹지 않는다 — **코드 블록이 실제로 처음 렌더될 때** 별도 청크 1회 로드 · ⓒ 코드 블록이 없는
    노트는 종전과 바이트 동일. 지연 팩토리를 엔진이 언제 호출하는지(첫 코드 블록 데코레이션 시점인지)는 **F-3 ③ 실측**
    으로 확인 — 스키마 생성 시점에 즉시 호출된다면 팩토리 안에서 한 번 더 미루는 대신 **그 사실을 §7에 기록하고 편집 청크
    증가분을 R37 수치로 남긴다**(엔트리 +0 B 원칙은 어느 경우에도 유지).
  - **언어 세트 = `CODE_LANGUAGES` 15종 무변**(select 옵션·값·별칭·저장 prop 무접촉 — stage-46 규약 D·stage-48 규약 E 계승).
    패키지의 `codeBlock.supportedLanguages`는 **쓰지 않는다**(한국어 라벨·우리 목록이 정본). 15종 각각을 강조 실측(F-3 ④) —
    패키지 shiki 번들에 없는 키가 있으면 **평문 폴백 + 콘솔 오류 0**이 조건이고, 오류가 나면 `createHighlighter` 래퍼에서
    미포함 언어를 평문으로 흘리는 최소 처리(언어 목록 제거·추가는 0 — 저장 데이터 호환). `text`는 강조 대상 아님(엔진
    관례).
  - **③ 테마·불변 규칙 5 판정**: shiki 토큰 색은 **라이브러리가 런타임에 산출하는 콘텐츠 표현 팔레트**(KaTeX 배포 CSS
    전례 — screens §5.3 S25)이지 앱 소스의 색 리터럴이 아니다 → 불변 규칙 5 위반 아님. **앱 소스 규율**: `notes.css`·TS에
    hex/rgb 리터럴 0 · 코드 블록 배경·테두리·기본 글자색은 계속 토큰(`--bg`·`--border`·`--text` — `notes.css:443~450` 무변) ·
    강조 span 색만 shiki 산출. **라이트/다크** = 패키지 기본 듀얼 테마(`github-light`/`github-dark`)를 그대로 쓰고, 엔진이
    span에 `--shiki-light`/`--shiki-dark` 변수 쌍을 내보내는지 실측(F-3 ⑤) → 내보내면 `notes.css`에 **`.bn-container[data-color-scheme='dark']`
    (또는 실측된 다크 표식) 하위 `[data-content-type='codeBlock'] pre span { color: var(--shiki-dark) }`** 1규칙(변수 참조만 —
    리터럴 0 · invariant-scan 패턴 `#hex|rgba?(` 무매칭). 단일 색만 내보내면(듀얼 미지원) **라이트·다크 양쪽 대비가 성립하는
    테마 1개를 고르지 못하는 경우 강조 도입을 중단하고 보고**(대비 깨진 채 발행 금지 — stage-40 "라이트 모드 글자 비가시"
    치명 회귀 전례). shiki 구 `css-variables` 테마 = **기각**(1.x에서 폐기 · 유지보수 불가).
  - 강조는 **편집 표면(노트·문서 블록 표면) 한정** — 리더 `MarkdownView`(퀴즈·학습·인쇄·임베드 카드 공유 표면 · 엔트리 청크
    · D5 v1 리더 유지)와 인쇄는 **무접촉**(§4 — 등재 0 · 실수요 시 FB).
- **C. 복사 버튼 = 코드 블록 스펙 render 래핑으로 DOM 버튼 1개 · 클립보드 공용 유틸 신설** (결정 ③)
  - 구현 지점: `codeBlockSpecWithInfo()`가 돌려주는 스펙의 `implementation.render`를 **감싸서**(엔진 코드 복제 0 — R33) 결과
    `dom`에 `<button type="button" contenteditable="false" data-code-copy aria-label="코드 복사">복사</button>`를 붙인다 —
    권고 위치 = 기존 언어 select 래퍼 `div[contenteditable='false']` **안의 첫 자식**(래퍼를 `display:flex; gap:4px`로 —
    select 폭이 언어명마다 달라 절대좌표 계산이 필요 없다 · `::after` chevron·`> select` 선택자 무변). 래퍼가 없는 상태
    (엔진이 비편집 모드에서 select를 생략)면 버튼도 생략(우리 읽기 표면은 `MarkdownView`라 실사용 영향 0). 엔진 0.54의
    `render` 반환 shape(`{ dom, contentDOM }`)이 다르면 구현자가 **동등한 접점**(스펙 결과 dom에 append)으로 조정하되 스펙
    파일 복제·엔진 내부 노드 접근은 금지.
  - 동작: `mousedown` `preventDefault`(에디터 선택 유지) · `click` → 코드 텍스트 = `contentDOM.textContent`(또는
    `editor.getBlock(id)` 내용 — 구현자 재량 · 줄바꿈 보존 확인) → **공용 유틸 `utils/clipboardWrite.ts`** `writeClipboardText(text):
    Promise<boolean>` — `navigator.clipboard.writeText` 우선, **없거나 실패하면 `document.execCommand('copy')` 폴백**(임시
    textarea · 사용자 제스처 안) → 결과에 따라 라벨 **"복사됨"/"복사 실패"** 1.5초 후 복원(전역 토스트 0 · stage-48 [복제]
    라벨 관례). **폴백이 필수인 이유**: 폰은 `http://<PC-IP>:8000`(비보안 컨텍스트)이라 `navigator.clipboard`가 **없다**
    — `localhost`만 보안 컨텍스트. 같은 유틸을 규약 D [참조 복사]가 쓴다(중복 구현 0).
  - CSS = `notes.css` 토큰만(`--surface`·`--border`·`--text-muted` · select와 같은 11px·radius 4px) · hover `--text` ·
    390px에서 select·chevron과 겹침 0(래퍼 flex) · 인쇄 `@media print`에서 숨김(래퍼 전체 — 현행 select도 인쇄에 남는지
    실측 후 같은 규칙에 묶음).
  - 복사 버튼은 강조와 **독립**(강조 청크 로드 전에도 동작 · 강조 도입이 B-③에서 중단돼도 복사 버튼은 진행).
- **D. D11-ⓐ 참조로 붙여넣기 = 마커는 앱 방언 `![[DOC-nnnn]]` 그대로 · 진입점 = 문서 상세 [참조 복사] 1곳 · 붙여넣기 즉시 임베드 블록** (결정 ④~⑧)
  - **④ 마커 형식 = 앱 참조 방언 자체**(`![[DOC-0012]]` · 선택적 별칭 `![[DOC-0012|라벨]]` — `refSyntax.ts:18` `REF_SCAN_RE`의
    embed 대안과 1:1). `study-hub-ref:` 같은 **새 어휘 기각** — 근거: ⓐ 방언은 이미 리더·문서 편집기·v1 Markdown이 이해하는
    공개 문법이라 다른 앱에 붙여넣어도 의미가 유지된다 ⓑ 새 마커는 노트에 문자 그대로 남으면 쓰레기지만 방언은 그 자체로
    임베드 의미 ⓒ 사용자가 손으로 `![[DOC-0012]]`를 쳐서 복사해도 같은 경로가 열린다(발견성 공짜). 커스텀 MIME(`ClipboardItem`)
    은 폰 비보안 컨텍스트·브라우저 편차로 기각.
  - **⑤ 진입점 = 문서 상세(`/docs/:id`) 헤더 좌측 그룹(`DocumentDetail.tsx:179~185` — `doc_no` 옆) [참조 복사] 텍스트 버튼
    1곳**(북마크 별 오른쪽 · `text-xs text-muted hover:text-primary` · `title="노트에 붙여넣으면 이 문서의 임베드 블록이
    됩니다"`). 클릭 = 규약 C 유틸로 `![[<doc_no>]]` 기록(별칭 없음 — 추종형) → 라벨 "복사됨"/"복사 실패" 1.5초. **블록 편집
    중에도 노출**(비파괴 — `:188` 숨김 그룹 밖). 탐색 카드·커리큘럼·노트 목록 등 다른 진입점 0(YAGNI — 실수요 시 FB).
    대상은 **문서(`DOC-`)만** — 노트는 임베드 target 도메인 밖(`DOC_NO_RE`)이라 [참조 복사] 없음(§4).
  - **⑥ 붙여넣기 분기 = `paste.ts` ①(이미지 파일) 뒤·②(HTML) 앞에 ①′ 삽입**: `imageFiles.length === 0`이고 `text/plain`의
    **trim 결과 전체가 embed 마커 1개와 정확히 일치**(`REF_SCAN_RE` 재사용 — `parseRefMatch` kind `'embed'` · 매치가 문자열
    전체를 소비 · `isDocNo(target)`)하면 → `insertDocEmbedBlock(editor, target, label)`(label = 별칭 trim · `isSafeRefText`
    실패 시 `''`) → `flushNotices()` → `return true`. 그 외(마커 앞뒤에 다른 글자 · 마커 2개 이상 · `[[DOC-…]]` 링크형 ·
    앵커형)는 **종전 경로 그대로**(②/③/기본 위임 — 링크 칩 변환은 §4 범위 밖). ①′가 ②보다 앞인 이유: 웹페이지에서
    `![[DOC-0012]]` 문자열을 복사하면 `text/html`이 동반되는데, 정확 일치 마커는 HTML보다 사용자 의도가 명확하다(②를 타도
    방언 변환기가 임베드로 만들지만 경로를 1개로 고정). **두 표면(노트·문서 블록 표면)에 자동 적용**(팩토리 공유 — 표면별
    분기 0).
  - **⑦ 확인 없이 즉시 삽입 · 별도 탈출 경로 없음** — 근거: ⓐ 결과는 `Ctrl+Z` 1회로 되돌아간다(`insertDocEmbedBlock`은
    1트랜잭션 — stage-36 실측) ⓑ 마커 문자열을 **문자 그대로** 노트에 두고 싶은 실수요는 없다(방언이라 리더가 어차피
    임베드로 렌더 — 문자 그대로 두면 오히려 편집 표면과 리더가 어긋난다) ⓒ 확인 다이얼로그는 붙여넣기 리듬을 끊는다
    (stage-48 [복제] 무확인 전례). 코드 블록 안에 붙여넣기(커서 블록이 `codeBlock`)는 **①′ 제외 — 평문 그대로**(코드 안
    참조는 §4.19 ① "코드 블록 제외" 원칙 · 구현 = 커서 블록 타입 검사 1줄).
  - **⑧ 자기 참조·순환 미차단** — 문서 A 편집 중 `![[A]]`를 붙여넣어도 삽입한다(슬래시 피커 경로도 차단하지 않음 — 일관) ·
    렌더 시 깊이 상한(`MAX_EMBED_DEPTH = 2` · R20 방문 집합)이 정본이라 폭주 0. 삭제된 문서 참조 = 기존 자리표시자 규칙.
    붙여넣기 시 서버 조회 0(임베드 블록이 제목 추종을 스스로 요청 — `DocEmbedRender:80~82`).
  - 저장·프로젝션·어댑터 무변: 삽입 결과는 슬래시 경로와 **동일 블록**이므로 왕복·사이드카·`document_relations('embeds')`
    파생(저장 시 재파싱 — R20)은 기존 경로가 그대로 담당. 세션 사이드카 병합 0(임베드 블록은 사이드카 흡수분 없음).
- **E. 공통 한도**: 신규 의존 = `@blocknote/code-block@0.54.0` **1개뿐**(전이 의존 라이선스 확인 동반 · 그 외 0) · 색상 토큰만
  (불변 규칙 5 — B-③ 판정 포함) · **R37 엔트리 청크 +0 B**(기준선 1,578,573 B · 노트/편집 청크 증감과 강조 지연 청크 크기를
  수치로 기록) · 백엔드 diff 0(`git diff --stat -- backend` 0줄) · Alembic 0 · 어댑터·저장 포맷·리더·인쇄 무접촉 · 새 단축키
  0 · settings 키 0 · 헤드리스 스크립트(s33·s40·s41·s47) 무회귀(스키마 import가 shiki를 끌지 않아야 한다 — B 결선 방식의
  검증 지점).

## 3. 체크리스트

### 묶음 B — 백엔드

- 없음(백엔드 diff 0 — V-4에서 `git diff --stat -- backend` 0줄 확인).

### 묶음 F — 프론트 구현 (권장 순서 F-1 → F-2 → F-4 → F-3 — F-3(강조)은 의존 추가·실측 분기가 있어 마지막)

- [ ] F-1. **FB-8 드로어**(규약 A) — `Layout.tsx` 드로어 본문을 `[...NAV_ITEMS, ...DESKTOP_EXTRA_ITEMS, NOTES_NAV_ITEM].map(
      (item) => <NavButton item={item} onClick={close} />)` + 하단 그룹(LLM 작업 기존 · 도움말 `<a target="_blank">` 신설 —
      사이드바 `:172~183`과 같은 속성·클래스 토큰)으로 교체 · 패널 `overflow-y-auto` + safe-area 상단 패딩 · 주석 `:237~239`
      정정(FB-8 완료 표기 · "예비 자리" 문구 삭제) · 사이드바·탭바·헤더 JSX 무변(diff = 드로어 블록 + 주석).
- [ ] F-2. **클립보드 공용 유틸**(규약 C·D 공유) — `frontend/src/utils/clipboardWrite.ts` `writeClipboardText(text: string):
      Promise<boolean>`(`navigator.clipboard?.writeText` → 실패/부재 시 `document.execCommand('copy')` 폴백 — 임시 textarea는
      `position:fixed; opacity:0`·`readonly`·선택 후 즉시 제거 · 둘 다 실패 = `false`) · 머리 주석에 "폰 = 비보안 컨텍스트
      (`http://<IP>:8000`)라 폴백 필수" 명기.
- [ ] F-3. **FB-11-ⓑ 구문 강조**(규약 B) —
      ① `npm view @blocknote/code-block@0.54.0 license` + 전이 의존(`shiki`·`@shikijs/*`) 라이선스 확인 → 값 §7 기록(GPL 계열
         발견 시 **중단·보고**) → `npm i -E @blocknote/code-block@0.54.0`(package.json·잠금 파일 diff = 이 1건).
      ② `schema.ts` `codeBlockSpecWithInfo()` — `createCodeBlockSpec({ supportedLanguages: CODE_LANGUAGES, createHighlighter:
         () => import('@blocknote/code-block').then((m) => m.codeBlock.createHighlighter()) })` · 타입은 `import type`만 ·
         `CODE_LANGUAGES` 무변 · 머리 주석에 지연 사유(R37 · 헤드리스 로드 계약) 1단락.
      ③ 팩토리 호출 시점 실측(스키마 생성 시 vs 첫 코드 블록 렌더 시) — 결과와 청크 수치 §7 기록.
      ④ 15종 언어 강조 실측(`csharp`·`bash`·`markdown` 등 번들 포함 여부) — 미포함 키는 평문 폴백 + 콘솔 오류 0 조건(오류
         시 래퍼에서 흘리기).
      ⑤ 테마 실측 — span 출력이 `--shiki-light`/`--shiki-dark` 변수 쌍이면 `notes.css`에 다크 결선 1규칙(변수 참조만 ·
         주석에 불변 규칙 5 판정 B-③ 인용) · 라이트/다크 전환(설정 토글) 즉시 반영 확인 · 단일 색이면 B-③ 중단 기준 적용.
- [ ] F-4. **복사 버튼**(규약 C) — `schema.ts`(또는 `blocknote/specs/` 신규 파일 — 구현자 재량, 단 `schema.ts`의 헤드리스 로드
      계약 유지 = DOM API는 render 안에서만) 스펙 `implementation.render` 래핑 → 언어 select 래퍼 안 첫 자식 `<button
      data-code-copy>` · `mousedown preventDefault` · click → `writeClipboardText(코드 텍스트)` → 라벨 "복사됨"/"복사 실패"
      1.5초 · `notes.css` 래퍼 `display:flex; align-items:center; gap:4px` + 버튼 규칙(토큰만) + 인쇄 숨김 · 기존 `::after`
      chevron·select 규칙 무변 확인.
- [ ] F-5. **D11-ⓐ 붙여넣기 분기**(규약 D ⑥~⑧) — `paste.ts` ①′: `imageFiles.length === 0` && 커서 블록 ≠ `codeBlock` &&
      `text/plain` trim 전체 = embed 마커 1개(`REF_SCAN_RE` + `parseRefMatch` 재사용 · `lastIndex` 리셋 주의 — 전역 플래그 정규식
      · `isDocNo`) → `insertDocEmbedBlock(editor, target, safeLabel)` → `flushNotices()` → `return true` · 머리말 네 갈래 주석에
      ①′ 1줄 추가(stage-34 규약 G 계승 표기) · 링크형·앵커형·부분 일치는 종전 경로(주석에 명기).
- [ ] F-6. **[참조 복사] 진입점**(규약 D ⑤) — `DocumentDetail.tsx:179~185` 좌측 그룹에 버튼 1개(`writeClipboardText('![[' +
      doc.doc_no + ']]')` · 라벨 상태 1.5초 · `title` 문구) · 블록 편집 중에도 노출 · 클래스 토큰만 · 모바일 390px에서 헤더
      좌측 그룹 줄바꿈(`flex-wrap` 기존 `:178`) 허용 — 겹침 0.

### 묶음 V — 검증 (구현 후)

- [ ] V-1. `npm run build` 성공(성공/실패만) + **엔트리 청크(`index-*.js`) = 1,578,573 B 동일(+0 B)** · 노트/편집 lazy 청크 증감 ·
      **강조 지연 청크(shiki 본체·언어·테마) 파일 수와 합계 B** 기록(R37 수치 — 별지 §9 R37 행에 1줄 추기는 D-2).
- [ ] V-2. `scripts/run-tests.ps1 -Full` 무회귀(백엔드 diff 0이라 기대 = stage-48과 동일 624) · 헤드리스 `s33`·`s40`·`s41`·`s47`
      계열 무회귀(**스키마 import가 shiki를 로드하지 않는지** — 노드 실행 시간·의존 로드 로그로 확인) · `scripts/invariant-scan.ps1`
      **PASS**(`notes.css` 신규 규칙 = 변수 참조만).
- [ ] V-3. **브라우저 실측**(사용자가 띄운 `localhost:8000` 우선 — 불가 시 임시 포트 자체 기동 허용 · **8000 금지 · 종료 +
      리스너 부재 확인 필수**). ⓐ **드로어**(390px 에뮬) — ☰ → 항목 11개(9 + LLM 작업 + 도움말) 순서·아이콘 · 각 항목 탭 =
      라우트 이동 + 드로어 닫힘 · 현재 라우트 active 강조 · 도움말 = 새 탭 · 640px 세로에서 스크롤 없이 들어감 · 데스크톱
      (≥768px) 사이드바·탭바 diff 0 ⓑ **강조** — 노트에 코드 블록(javascript·python·csharp·bash·text) 삽입 → 토큰 span 생성 ·
      언어 변경 시 재강조 · `text` 무강조 · 라이트/다크 전환 후 토큰 색 변화·배경 `--bg` 유지 · **코드 블록 없는 노트 열기
      → 강조 청크 미요청**(네트워크 URL 필터) · 코드 블록 첫 렌더 → 청크 1회 로드 · 콘솔 오류 0(FB-11 후속 ② `Language  is
      not supported`가 재현되면 강조 도입 전후 비교해 귀책만 기록 — §4) ⓒ **복사 버튼** — 클릭 → 클립보드 = 코드 원문(줄바꿈
      보존) · 라벨 "복사됨" 1.5초 · 에디터 선택·커서 무변 · select·chevron 겹침 0 · 390px 위치 · 인쇄 미리보기에서 버튼
      비표시 ⓓ **참조 붙여넣기** — 문서 상세 [참조 복사] → 라벨 "복사됨" → 노트 편집 표면에 Ctrl+V → `docEmbed` 블록 1개
      (제목 추종 · 펼치기 동작) · 빈 문단 치환/비어있지 않으면 뒤 삽입 · Ctrl+Z 1회 복원 · 문서 블록 표면에서도 동일 ·
      `![[DOC-0012|별칭]]` 손 입력 복사 → label 별칭 · 마커 + 다른 글자 → 평문 붙여넣기(종전) · 코드 블록 안 → 평문 · 저장 →
      재로드 → 임베드 유지 · 리더(문서 상세 본문 · 노트 프로젝션)에서 임베드 카드 렌더 ⓔ 테스트 노트·문서 변경분 전부
      원상복구(`DELETE /api/notes/{id}` · 문서는 편집 전 상태로).
- [ ] V-4. **diff 범위** — `git diff --stat -- backend` 0줄 · `alembic/versions` 0 · `package.json`·잠금 파일 diff = `@blocknote/code-block`
      1건 · `frontend/dist` 제외(`git diff -- . ':!frontend/dist'`).

### 묶음 D — 문서 (검증 종료 후)

- [ ] D-1. **screens §5 S49 3곳 실측 확정 표기**(공통 레이아웃 단락 · §5.3 불릿 · §5.16 블록 — 편성 추기 → "구현 실측
      2026-xx-xx" 부기) = **Design v1.60**(색인 `study-app.design.md` 헤더 승급 · 관례대로 밀려나는 v1.56 괄호 줄은
      `docs/04-archive/design-changelog.md` 맨 위로 원문 이동).
- [ ] D-2. `editor-v2.plan.md` — §13 FB-8·FB-11 행 · §10 D11 행에 `← 완료(stage-49 · 날짜)` 추기(FB-11은 "ⓑ + 복사 버튼 완료 —
      후속 ② 결함은 존치" · D11은 "ⓐ 완료 · ⓑ 보류·착수 금지 유지") · §9 R37 행에 강조 지연 청크 실측 1줄(V-1 수치).
- [ ] D-3. 매뉴얼 `docs/manual/user-manual.html` — 모바일 절에 "☰ 메뉴에서 모든 화면으로 이동" 1줄 · 노트 절에 "코드 블록 언어
      선택 시 구문 강조 · [복사]" 1줄 · 문서/노트 절에 "문서 상세 [참조 복사] → 노트에 붙여넣기 = 임베드 블록" 1줄.
- [ ] D-4. 본 문서 완료 기록(§7)·체크박스 + §6 절차(CHANGELOG·VERSION·stage-index·backlog).

## 4. 이 단계에서 하지 않는 것

- **DDL 0 · API 0 · 백엔드 diff 0**(계획서 §6.2 무변 · Alembic 리비전 0 · `routers/`·`models.py` 무접촉) · 마스터 §14 M 행 추가 0.
- **D11-ⓑ 양방향 임베드 편집 착수 0**(별지 §10 D11 ⓑ — v2.x 보류·**착수 금지 유지** · 별도 착수 전 결정 + 리스크 등재 선행) —
  임베드 카드 안에서의 편집·원본 갱신 경로를 이 stage에서 만들지 않는다.
- **하단 탭바 5개 변경 0**(F39 관례 — 탭 추가·교체·순서 변경 없음) · 설정 항목 드로어 중복 0 · 드로어 포커스 트랩·ESC·스와이프
  제스처 신설 0(현행 무변) · 데스크톱 사이드바 항목 변경 0.
- **FB-11 후속 ② 콘솔 `Error: Language  is not supported.` 결함 수정 0**(main 기존 결함 · 재현 조건 미특정) — V-3 ⓑ에서 재현
  여부·강조 도입 귀책만 기록. 강조 도입이 **새로** 만든 오류만 이 stage 결함.
- **언어 세트 확장·축소 0**(`CODE_LANGUAGES` 15종 무변 · 자유 입력 0 — stage-34 규약 E) · 코드 블록 prop(`language`·`info`)
  무변 · 줄 번호·자동 줄바꿈 토글·테마 선택 UI 0.
- **리더(`MarkdownView`)·인쇄·임베드 읽기 카드의 코드 강조 0**(규약 B 판정 — 공유 표면·엔트리 청크·D5 v1 리더 유지 · 등재 0 —
  실수요 시 FB) · 인쇄 경로 CSS 변경은 복사 버튼 숨김 1규칙만.
- **`[[DOC-…]]` 링크 칩·`[[#앵커]]` 붙여넣기 변환 0** · 마커 여러 개·본문 섞임 변환 0 · 노트를 임베드 대상으로 삼는 참조 0
  (`DOC_NO_RE` 도메인 밖) · 탐색·커리큘럼·노트 목록 등 [참조 복사] 추가 진입점 0 · 붙여넣기 확인 다이얼로그 0 · 자기 참조
  차단 0(렌더 깊이 상한이 정본).
- **신규 의존은 `@blocknote/code-block` 1개뿐**(D10 — 라이선스 확인 후) · shiki 직접 의존·언어 패키지 개별 설치 0 · BlockNote 6종
  버전 승격 0(0.54.0 고정).
- **노트-FTS·인쇄 통합 · D8-구현 · 캡처 착수 0**(backlog §1 존치) · v2.x 백로그 착수 0 — 신규 아이디어는 별지 §13 FB 등재 +
  backlog 1행.

## 5. DoD (완료 정의)

**자동 검증(에이전트 수행):**
1. `npm run build` 성공 + **엔트리 청크 +0 B**(1,578,573 B 동일 — R37) + 강조 지연 청크 수치 기록.
2. `run-tests.ps1 -Full` 무회귀 · 헤드리스 s33/s40/s41/s47 무회귀(스키마 import에 shiki 미로드) · `invariant-scan.ps1` PASS.
3. 백엔드 diff 0 · Alembic diff 0 · 신규 의존 = `@blocknote/code-block@0.54.0` 1건(라이선스 값 §7 기록 · GPL 계열 0).
4. 브라우저 V-3 ⓐ~ⓔ 전건 통과(드로어 11항목 · 강조 라이트/다크 · 강조 청크 지연 로드 · 복사 · 참조 붙여넣기 왕복 · 원상복구).
5. 문서 묶음 D 전건(Design v1.60 · 별지 3행 + R37 추기 · 매뉴얼 3줄).

**사용자 확인(게이트 본체):**
6. ⓐ **폰 실기기**(`<PC-IP>:8000`) — ☰ 드로어에서 탐색·반입·인쇄·커리큘럼 진입 · 항목 탭 후 드로어 닫힘 · PWA standalone
   상단 겹침 0 · **코드 블록 [복사]가 비보안 컨텍스트에서 동작**(폴백 경로) · 문서 상세 [참조 복사] → 노트 붙여넣기(길게
   눌러 붙여넣기) = 임베드 ⓑ PC 실사용 — 코드 블록 강조 체감(라이트/다크) · 언어 select·chevron 회귀 0 · 참조 붙여넣기
   리듬(확인 없음)이 불편하지 않음 ⓒ **치명 결함 0 회신**.

**게이트**: 1~5 전건 + 6 치명 0 → **v2.01.4 발행**(§6 ① 조건). 치명 발견 시 발행 보류·수정 선행. B-③ 중단 기준(테마 대비
불성립·GPL 발견)이 발동하면 강조만 제외하고 나머지(드로어·복사·참조 붙여넣기)로 완료 — 제외 사실을 §7·CHANGELOG·별지
FB-11 행에 기록하고 FB-11-ⓑ 강조분은 backlog §1에 재존치.

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` — **발행 단위 판단**: ⓐ stage-48 DoD 6 회신이 끝나 **v2.01.3이 발행된 뒤** stage-49가
   끝나면 **v2.01.4 항목 1개**(단독) ⓑ stage-48 회신이 아직이면 **v2.01.3 항목에 stage-49 불릿을 합류**("v2.01.3 — stage-48·49
   한 발행 단위" · v2.01.1 = 43+46 묶음 전례 · 규약 ② 번호 재부여 없음) — 어느 쪽인지는 완료 시점의 stage-48 상태로
   기계적으로 정한다(stage-index 두 행의 "산출 버전"을 같은 표기로 맞춘다). 불릿 = 드로어 전체 내비(FB-8) · 코드 블록 구문
   강조(`@blocknote/code-block` 지연 청크 + 라이선스 값) + [복사](FB-11-ⓑ) · 참조로 붙여넣기(D11-ⓐ — [참조 복사] + 마커
   붙여넣기) · R37 수치.
2. 루트 `VERSION` = 발행 버전(`2.01.4` 또는 묶음 시 `2.01.3`) — 사용자 회신(DoD 6) 후.
3. `stage-index.md` 49행 갱신(완료·일자·산출 버전).
4. `backlog.md` — §1 `FB-8`·`FB-11-ⓑ`·`D11-ⓐ` 3행을 §4로 **종결 이동**(`종결(stage-49 · 날짜)`) · §3 `R37` 행 비고에 "강조
   지연 청크 실측 완료(수치)" 갱신(행은 감시 유지) · `scripts/backlog-scan.ps1` PASS 확인. 강조가 B-③으로 제외되면 `FB-11-ⓑ`
   행은 §1 잔존("복사 버튼 완료 · 강조 = 중단 사유")로 갱신.
5. 출처 추기 — 별지 §13 FB-8·FB-11 · §10 D11 `← 완료(stage-49 · 날짜)`(D-2) · §9 R37 실측 1줄.
6. 매뉴얼 3줄(D-3) · `CLAUDE.md` 머리 버전 줄 1곳(경위 전재 금지) · git tag(발행 버전 · 머지 커밋 대상 — stage-47 전례대로
   release PR 별도).

## 7. 완료 기록 (구현·검증·문서 경위 정본 — 착수 후 추기)

- **편성**(2026-09-13): 지시서 확정 — 규약 A~E(사용자 확정 대기 0 · 결정 ①~⑧ 위임 판정 · 구현 중 실측 분기 = B-③ 테마
  듀얼 여부·F-3 ③ 팩토리 호출 시점 — 판정 기준 선기재) · screens §5 공통 레이아웃 S49 단락 + §5.3 S49 불릿 + §5.16 S49
  블록 추기(Design v1.59 · api §4 무변 = API 0) · stage-index 49행 · backlog 3행 `편성 = stage-49` · 별지 §13 FB-8·FB-11 ·
  §10 D11 편성 추기.
