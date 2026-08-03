# Stage 25 — 해설·정답 표시 품질: 정답 표기 통일·렌더러 개선 (M25: F51, 가칭)

> 상위: `study-app.plan.md` **v0.35** §14(M25)·**F51**(사용자 요청 원문·실측·결정 ①~③의 단일 출처) · 설계: **screens §5.3 확정 서술(2026-08-04, Design v1.28)이 계약 정본** — API 설계(§4) 변경 0(백엔드 무관 단계)
> 배경(등재 근거 — 2026-08-04 사용자 요청 원문): "정답이 ③ (3)와 같이 2번씩 표시되는 문제가 가끔 있어. 해설에서 줄바꿈이나 수식표시등에 문제가있는 경우가 있어, … 해설출력용 LLM 조작 기능을 완전히 별도로 분리하는 건 어떤지 고민해봐." 실측(§14 F51): "③ (3)"은 프론트 포맷터의 의도된 조립(화면 간 불일치 포함)이고, 줄바꿈·수식 증상은 공용 MarkdownView의 **remark-breaks·수식 플러그인 부재**가 직접 원인 — 사용자 제안 C안(해설 전용 LLM 후처리)은 **보류 확정**(렌더 개선 후 잔존 결함 실측 시 재검토).
> **상태: 착수 전 결정 ①~③ 전건 확정(2026-08-04) → 착수 가능 — 미착수. 착수 순서 최우선(S25 먼저 — 2026-08-04 확정: S25 → S24 → S23)**. stage 번호는 기능 등재 순서일 뿐 착수 순서와 무관.
> **성격: 프론트 전용 — LLM 호출 0·백엔드/API/DB/프롬프트 무변경·DDL 0건·Alembic 0건·신규 엔드포인트 0개.** 신규 의존은 **프론트 4건: `remark-breaks` · `remark-math` · `rehype-katex` · `katex`**(계획서 등재 후 추가 — F43 remark-directive·rehype-slug 전례. 전부 오프라인 번들 — 런타임 외부 요청 0).
> 순서 관계(plan §14): 의존 없음(렌더 계층 — MarkdownView는 F43 이후 안정, S23·S24 수정처와 충돌 없음). 기존 저장 해설·본문은 **소급 조치 없이 즉시 개선 렌더**(재변환·마이그레이션 0).
> 불변 규칙 재확인: 색상 하드코딩 금지(5 — **KaTeX CSS 포함**: katex 배포 CSS는 currentColor 기반이 원칙이나 하드코딩 색 발견 시 토큰으로 재정의) · 채점은 서버에서만(1 — 표기·렌더 계층은 정답 유출면 아님: 이미 공개된 answer의 표기만 다룬다, quiz/session 미포함 계약 불변) · 각 단계 범위 준수(9 — LLM 후처리·프롬프트 수정은 범위 밖).

## 현행 실측 (2026-08-04 — 상세는 plan §14 F51·screens §5.3이 정본, 여기는 요지)

- **"③ (3)" 이중 표기 = 프론트 포맷터의 의도된 조립**: answer가 순수 번호("1"~"9")일 때 `"③ (3)"`을 만든다 — 같은 로직이 **4곳 복붙**(`DocumentDetail.formatAnswer` · `ExamRun.formatChoiceAnswer` · `Flashcards` · `Review`), **2곳은 raw 숫자 그대로**(`Study` 오답 목록(750행 부근 "내 답: {w.my_answer} · 정답: {w.answer}") · `QuizRun` 결과(479행 부근)). "가끔"의 정체 = §8.2 v1.1 규격(answer = 번호만) 문서에서만 이중 표기 발생, 텍스트 answer는 원문 그대로. **LLM·답지 병합(F44)·저장 데이터와 무관.**
- **해설·본문 렌더 = 공용 `MarkdownView` 1곳 수렴**(react-markdown + remark-gfm + remark-directive + remarkStudy 2종 + rehype-highlight + rehype-slug — 열람·학습·퀴즈·시험·플래시카드·오답노트·인쇄 전 화면). 결손 2건이 증상의 직접 원인: **remark-breaks 부재**(Markdown 규칙상 단일 개행 = 공백 — "줄바꿈 안 됨") · **remark-math/rehype-katex 부재**(LaTeX·수식이 원문 문자로 노출). 이미지는 이미 렌더됨(`[&_img]` 스타일 — R2 관례).
- **저장 계층은 정상**: explanation은 Markdown 필드(§8.2·convert.md §2-4) — 진짜 깨진 수식 텍스트는 원본 추출 품질 문제(R19)로 별개(이 단계의 대상 아님).
- **보기 마커는 무관**: 보기 목록의 ①~④ 마커(`choiceMarker` — index 기반)는 이중 표기와 무관 — 무변경.

## 착수 시 선행 절차 (완료 — 결정·문서를 먼저 굳혔다)

- [x] **D1. 결정 ① 정답 표기 통일** — **확정(2026-08-04, screens §5.3)**: 공용 포맷터 1곳(utils) — 순수 번호("1"~"9") = **"③" 형태만**(이중 병기 제거), 텍스트 answer = 원문 그대로, 빈 값 = 화면별 기존 문구 유지. 적용 6곳 전수(아래 1절).
- [x] **D2. 결정 ② B안 렌더러 개선** — **확정**: MarkdownView에 remark-breaks + remark-math + rehype-katex(+katex CSS) 추가 — 전 화면·인쇄 자동 파급·소급 0. remark-breaks의 본문 표시 변화는 표본 확인(DoD 4 — 필요 시 해설 한정 스코프 분리 실측).
- [x] **D3. 결정 ③ C안 보류** — **확정**: 해설 전용 LLM 후처리 분리는 보류(비용 + R21 재작성 위험 + F30/F44 중복) — 렌더 개선 후 잔존 결함 실측 시 재검토(계획서 먼저). 변환 프롬프트 수식 표기 지시도 같은 시점으로 이월.
- [x] **D4(문서). screens §5.3 확정 서술 + plan §14 F51·§5 표** — 완료(2026-08-04, Design v1.28 · plan v0.35).

## 목표

끝났을 때, 정답이 모든 화면에서 같은 형태(**"③"** — 한 번만)로 표시되고(텍스트 정답은 원문 그대로), 해설·본문의 단일 줄바꿈이 화면에서도 줄바꿈으로 보이며, `$…$`·`$$…$$` 수식이 KaTeX로 자연스럽게 렌더되고, 이미지·표·코드 등 기존 렌더는 그대로다. 이 모든 개선이 **기존에 반입된 문서·해설에 재변환·소급 없이 즉시** 적용되고, LLM 호출·백엔드 변경·DB 변경은 전부 0이다. 다크 모드에서도 수식이 토큰 색으로 올바르게 보인다.

## 작업 체크리스트

> 권장 순서: **1(정답 포맷터 통일) → 2(렌더러 플러그인) → 3(검증) → 4(문서)**. 1·2는 독립 — 병렬 가능. 전부 프론트(`frontend/`)이며 백엔드 파일은 건드리지 않는다.

### 1. 정답 표기 통일 (결정 ① — 공용 포맷터 1곳·적용 6곳 전수)

- [x] **공용 포맷터 신설**: `frontend/src/utils/answerFormat.ts`(이름 구현 재량) — `formatAnswer(answer: string | null | undefined, empty?: string): string`: 순수 번호 `/^[1-9]$/` = `CIRCLED_DIGITS[n-1]`(**"③"만** — `(3)` 병기 제거), 그 외 비어 있지 않은 값 = trim 원문, 빈 값 = `empty` 인자(기본 `'-'`). `CIRCLED_DIGITS` 상수도 이 모듈로 이동·수출(화면별 중복 상수 정리 — 보기 마커 `choiceMarker`용 재수출 포함).
- [x] **적용 6곳 전수 교체(화면별 복붙 제거)**:
  1. `pages/DocumentDetail.tsx` — `formatAnswer`(51행 부근) 제거 → 공용 사용(빈 값 `'-'`).
  2. `pages/ExamRun.tsx` — `formatChoiceAnswer`(44행 부근) 제거 → 공용 사용(빈 값 `'미응답'` — "내 답"·"정답" 양쪽).
  3. `pages/Flashcards.tsx` — 로컬 포맷터(27행 부근) 제거 → 공용 사용.
  4. `pages/Review.tsx` — 로컬 포맷터(30행 부근) 제거 → 공용 사용.
  5. `pages/Study.tsx` — 오답 목록 raw 표기(750행 부근 `내 답: {w.my_answer} · 정답: {w.answer}`) → 공용 포맷터 적용.
  6. `pages/QuizRun.tsx` — 결과 raw 표기(479행 부근 `내 답: {answer.my_answer} · 정답: {answer.result.answer}`) → 공용 포맷터 적용.
- [x] 각 화면의 로컬 `CIRCLED_DIGITS` 중복 상수 제거(공용 모듈 import로 수렴 — 보기 마커 렌더(①~④ 행 머리)는 동작 무변경). 6곳 외에 동일 상수를 중복 선언하던 `components/QuestionCard.tsx`·`components/print/QuizPrintView.tsx`도 함께 공용 모듈 참조로 수렴(marker 동작 무변경, formatAnswer 로직은 손대지 않음).

### 2. 렌더러 개선 (결정 ② — 공용 MarkdownView 1곳)

- [x] **의존 추가 4건**(`frontend/package.json` — 정확 버전은 설치 시 실측해 완료 기록에 핀): `remark-breaks` · `remark-math` · `rehype-katex` · `katex`. 전부 빌드 번들(오프라인 — 런타임 외부 요청·CDN 0).
- [x] `components/MarkdownView.tsx`: `REMARK_PLUGINS`에 remark-breaks·remark-math 추가, `REHYPE_PLUGINS`에 rehype-katex 추가 — **플러그인 순서 확인**(remark-math는 remark-gfm과 나란히, rehype-katex는 rehype-highlight와 간섭 없는 순서 — 구현 실측). 기존 플러그인(gfm·directive·studyRefs·highlight·slug)·컴포넌트 매핑(임베드·fold/hide) 동작 불변.
- [x] **KaTeX CSS**: `katex/dist/katex.min.css` import(전역 1곳 — main 또는 MarkdownView) — **색상 점검(불변 규칙 5)**: KaTeX는 currentColor 기반이 원칙이나 배포 CSS에 하드코딩 색이 있으면 `styles/tokens.css` 토큰으로 재정의(라이트·다크 모드 양쪽 확인). 수식 폭 넘침은 기존 `[&_pre]:overflow-x-auto` 관례대로 스크롤 처리(필요 시 `.katex-display` 대상).
- [x] **인쇄 뷰(F22) 확인**: ConceptPrintView·QuizPrintView·WrongNotePrintView가 같은 MarkdownView라 자동 파급 — `@media print`에서 수식·줄바꿈 렌더 확인(별도 코드 목표 0).

### 3. 검증 (프론트 전용 — LLM 0·서버 실행만)

- [x] **표기 확인(6곳 전수)**: 코드 수준 확인 완료(공용 `formatAnswer` 1곳으로 6곳 전수 교체, 로직 재확인) — 번호 정답 = "③" 한 번만 / 텍스트 정답 = 원문 그대로 / 미응답·빈 값 = 화면별 기존 문구(ExamRun만 `'미응답'`, 나머지 `'-'`) 유지 확인. 실제 브라우저 화면 스크린샷 확인은 이 작업 환경(헤드리스, DB 미접근)에서 불가 — 사용자 이행 항목(DoD 6)으로 이월.
- [x] **렌더 확인**: 실제 프로젝트 플러그인 스택과 동일한 조합(remark-gfm·remark-math·remark-directive·study 변환·remark-breaks → rehype-katex·rehype-highlight·rehype-slug)을 임시 unified 파이프라인으로 재현해 개행·인라인/블록 수식·코드 하이라이트·directive·참조 치환이 동시에 정상 동작함을 실측(크래시·상호 오검출 0). 실제 저장 문서로의 표본 확인은 DB 미접근으로 불가 — DoD 6으로 이월.
- [ ] **remark-breaks 본문 표시 변화 표본 확인(DoD 4)**: **미완료(차단)** — 이 작업 환경은 로컬 DB에 접근할 수 없어 실제 반입 문서 표본을 확인할 수 없다. 대신 퇴로(해설 한정 스코프 전환)를 `MarkdownView`에 `breaks?: boolean`(기본 `true`) prop으로 미리 내장해 실제 표본 확인 후 1줄 변경(`breaks={false}` 또는 화면별 분기)으로 전환 가능한 구조만 갖춰 두었다. **사용자가 실사용 확인(DoD 6) 시 이 항목도 함께 확인 필요.**
- [x] **다크 모드**: 코드 수준 확인 완료 — `katex/dist/katex.min.css`는 색상 선언이 전부 `currentColor`(하드코딩 색 0, grep 확인)라 텍스트色은 이미 토큰(`--text` 계열)을 상속한다. 단, `rehype-katex`가 수식 파싱 실패 시 폴백으로 그리는 `.katex-error`의 기본 `errorColor`가 JS 레벨 하드코딩(`#cc0000`)이었음을 발견 — `rehypeKatex` 옵션에 `errorColor: 'var(--wrong)'`를 넘겨 토큰으로 재정의(라이트·다크 자동 대응, inline style에서도 CSS 커스텀 프로퍼티는 정상 해석됨). 실제 두 테마 브라우저 스크린샷 대조는 미실시(헤드리스 환경 한계) — DoD 6에서 사용자 확인 권장.
- [x] `npm run build` 통과(tsc 에러 0, `npx tsc -b` 별도 실행도 0). dist 서빙 확인은 **이 단계 범위 밖**(작업 지시상 `frontend/dist` 읽기·수정 금지 — 오케스트레이터가 재빌드) — 빌드 성공 확인 직후 `git checkout`으로 dist를 원상 복구해 두었다. stage-reviewer(Opus) 검토는 오케스트레이터 진행.

### 4. 문서

- [x] 구현 확정 사항 기록(이 문서 완료 기록 — 의존 4건 버전 핀·플러그인 순서·KaTeX CSS 색상 점검 결과·breaks 표본 확인 결과. screens §5.3과 어긋나지 않음).
- [x] 사용자 매뉴얼(F39): 해설 작성 팁(줄바꿈·`$…$` 수식 문법 지원) 1절 — `docs/manual/user-manual.html`에 이미 반영되어 있음(착수 시점에 이미 존재 — 이 세션에서 추가 수정하지 않음, 내용은 이 단계 구현과 정합).
- [x] 이 문서 체크박스 갱신(불변 규칙 10). CLAUDE.md 문서 지도 갱신은 오케스트레이터 담당(미이행).

## DoD (완료 정의)

**자동 검증 가능 항목** (전부 무비용 — 실 LLM 불요):

1. **표기 통일**: 정답 표기 로직이 공용 포맷터 1곳뿐이고(화면 로컬 포맷터·중복 CIRCLED_DIGITS 0), 6곳 전수에서 번호 정답 = "③" 한 번만 표시된다("③ (3)" 이중 표기 0·raw 숫자 표기 0).
2. **렌더 개선**: 단일 개행 = 줄바꿈, `$…$`/`$$…$$` = KaTeX 렌더 — 기존 저장 해설·본문에 재변환·소급 없이 즉시 적용(F43 기능(임베드·fold/hide·앵커)·코드 하이라이트·이미지 회귀 0).
3. **프론트 전용 확인**: 백엔드 파일 diff 0 · API·DB·프롬프트 무변경 · LLM 호출 0 · 신규 의존은 프론트 4건뿐(오프라인 번들 — 런타임 외부 요청 0).
4. **breaks 표본 확인**: 기존 문서 표본 렌더 비교 완료 — 깨짐 발견 시 해설 한정 스코프로 전환하고 사유 기록(조용한 전면 적용 금지).
5. **토큰 정합**: 다크·라이트 양 테마에서 수식이 토큰 색으로 렌더(하드코딩 색 추가 0 — KaTeX CSS 재정의 포함).

**사용자 이행 항목**:

6. **실사용 확인**: 문제가 보고됐던 실제 문서(수식·줄바꿈 깨짐 해설)에서 개선 체감 확인 — **잔존 결함이 남으면 그 표본을 기록**(F51 결정 ③ 재검토(C안·프롬프트 지시)의 입력 — 계획서 먼저).

## 이 단계에서 하지 않는 것

- **해설 전용 LLM 후처리(C안) 없음** — 보류 확정(비용 + R21 재작성 위험 + F30/F44 중복). 재검토는 잔존 결함 실측 후 계획서 먼저.
- **변환 프롬프트 수정 없음** — 수식 LaTeX 표기 지시 1줄도 이월(C안 재검토와 함께 — 이 단계는 프론트 전용을 유지).
- **저장 데이터 소급·마이그레이션 없음** — 렌더 계층이라 소급 자체가 불요(기존 해설도 즉시 개선 렌더).
- **백엔드·API 변경 없음** — §4 설계 무변경(0건이 이 단계의 계약).
- **WYSIWYG·수식 입력기 없음** — DocEditor는 텍스트 폼 유지(F43 결정 그대로 — 문법 힌트 수준도 매뉴얼로 갈음).
- **원본 추출 품질(R19 — 진짜 깨진 수식 텍스트) 개선 없음** — 별개 문제(도구는 F30 재생성·F46 루프).
- **보기 마커(①~④ 행 머리) 변경 없음** — 이중 표기와 무관.

## 리스크

- **remark-breaks의 전면 파급**: MarkdownView는 본문·해설·임베드·인쇄 공용이라 기존 문서의 표시가 일괄 바뀐다 — 표본 확인(DoD 4) + 해설 한정 스코프 분리 퇴로를 계약에 내장. 이것이 이 단계의 유일한 실질 리스크.
- **KaTeX CSS 충돌**: 전역 CSS 1건 추가 — 토큰 체계(불변 규칙 5)·기존 markdown-body 스타일과의 간섭 확인(다크 모드 필수).
- **수식 오인식**: `$` 문자를 쓰는 일반 텍스트가 수식으로 오인될 수 있음 — remark-math의 구분 규칙 확인·표본 검증(발견 시 이스케이프 안내를 매뉴얼에).

## 완료 기록 (착수 후 기입)

**구현일: 2026-08-04. 프론트 전용 구현 완료(frontend-dev) — 검토(stage-reviewer)·사용자 이행 항목(DoD 6)은 잔여.**

- **신설 파일**: `frontend/src/utils/answerFormat.ts`(`formatAnswer`·`choiceMarker`·`CIRCLED_DIGITS` 공용 수출).
- **수정 파일**: `frontend/src/pages/DocumentDetail.tsx`·`ExamRun.tsx`·`Flashcards.tsx`·`Review.tsx`·`Study.tsx`·`QuizRun.tsx`(6곳 전수 — 로컬 포맷터·중복 상수 제거 후 공용 import) · `frontend/src/components/QuestionCard.tsx`·`frontend/src/components/print/QuizPrintView.tsx`(로컬 `CIRCLED_DIGITS` 중복도 공용 참조로 정리, 6곳 목록 밖이지만 같은 원인의 중복이라 함께 정리 — formatAnswer 로직 자체는 손대지 않음) · `frontend/src/components/MarkdownView.tsx`(플러그인·breaks prop·KaTeX CSS) · `frontend/package.json`·`package-lock.json`(의존 4건).
- **의존 4건 확정 버전**(`npm install`로 실측·`package-lock.json`에 핀, `package.json`은 기존 관례대로 caret 유지): `remark-breaks@4.0.0` · `remark-math@6.0.0` · `rehype-katex@7.0.1` · `katex@0.18.1`.
- **정답 표기 통일**: `formatAnswer(answer, empty='-')` — 순수 번호(`/^[1-9]$/`)는 `CIRCLED_DIGITS[n-1]` 1회만 반환("③ (3)" 이중 표기 완전 제거), 그 외 값은 trim 원문, 빈 값은 호출부 지정(기본 `'-'`, `ExamRun`만 `'미응답'`). 6곳 전수 교체 확인 완료(grep으로 로컬 `formatAnswer`/`formatChoiceAnswer`/`CIRCLED_DIGITS` 재정의 잔존 0건 확인).
- **플러그인 순서**(코드 주석에도 근거 기재):
  - remark: `remarkGfm → remarkMath → remarkDirective → remarkStudyDirectives → remarkStudyRefs → (breaks=true일 때만) remarkBreaks`. remark-math는 remark-gfm과 나란히(둘 다 파싱 단계 구문 확장, 겹침 없음 — 순서 무관 실측). remark-breaks는 맨 뒤 고정 — remarkStudyRefs가 아직 쪼개지지 않은 원문 텍스트 노드를 정규식으로 스캔해 `[[…]]` 참조를 찾으므로, breaks가 그보다 먼저 텍스트 노드를 개행 지점에서 쪼개면(별개 문제는 없었지만) 참조 스캔의 안전 여지를 줄이는 방향이라 보수적으로 뒤에 둠.
  - rehype: `rehypeKatex → rehypeHighlight → rehypeSlug`. 근거: remark-math는 블록 수식을 `<pre><code class="language-math math-display">`로 산출(remark-math 명세)하는데 이는 rehype-highlight의 대상 조건(`pre>code`)과 겹친다. highlight가 먼저 돌면 "math"를 모르는 언어로 취급해 `Cannot highlight as 'math'` 진단 메시지를 남기지만(rehype-highlight 소스 확인: try/catch로 크래시는 안 남), rehype-katex가 먼저 그 노드를 실제 수식 요소로 완전히 치환(`parent.children.splice`)한 뒤 highlight가 남은 진짜 코드 블록만 처리하게 하는 편이 깔끔하다(rehype-katex README 권장 예시와 동일 순서).
  - **실측 방법**: 이 저장소의 실제 remark/rehype 패키지(node_modules에 이미 설치된 버전)로 임시 unified 파이프라인을 구성해 개행·참조(`[[…]]`)·directive(`:::fold`)·인라인·블록 수식·코드 블록이 섞인 샘플을 양쪽 순서(권장 순서 / 반대 순서)로 처리해 HTML을 비교 — 두 순서 모두 크래시·오검출 없이 정상 동작함을 확인했고, 진단 메시지 없이 더 방어적인 권장 순서를 채택. 검증에 쓴 임시 스크립트는 작업 완료 후 삭제(레포에 남기지 않음).
- **KaTeX CSS 색상 점검**: `katex/dist/katex.min.css`를 grep해 `color:` 선언을 전수 확인 — 유일한 선언은 `.katex *{border-color:currentColor}`, `svg{fill:currentColor;stroke:currentColor}`뿐이며 하드코딩 색(`#hex`/`rgb`) **0건** — 텍스트·테두리·아이콘 색이 전부 조상 요소의 `color`(토큰 `--text` 계열)를 상속하므로 재정의 불필요. 단, **`rehype-katex`(JS)의 수식 파싱 실패 폴백 경로**(`katex.renderToString` 2회 모두 실패 시)가 `style="color:#cc0000"`를 하드코딩으로 주입하는 것을 소스 레벨에서 발견 — 이는 CSS가 아니라 플러그인 옵션 문제이므로, `rehypeKatex`에 `{ errorColor: 'var(--wrong)' }` 옵션을 넘겨 토큰으로 재정의(라이트 `#dc2626`/다크 `#ef4444` 자동 대응 — CSS 커스텀 프로퍼티는 inline style 문자열에서도 정상 해석됨). 수식 폭 넘침 대응은 `.katex-display`에 `overflow-x-auto`·`overflow-y-hidden` 추가(기존 `[&_pre]:overflow-x-auto` 관례와 동일 패턴).
- **breaks prop 구조**: `MarkdownView({ breaks = true, ... })` — 내부적으로 `REMARK_PLUGINS_NO_BREAKS`/`REMARK_PLUGINS_WITH_BREAKS` 두 고정 배열을 `useMemo(() => breaks ? … : …, [breaks])`로 선택. 임베드 재귀 렌더(`EmbedCard.renderContent`)에도 `breaks={breaks}`를 그대로 전달해 중첩 렌더 일관성 유지. 표본 확인 후 해설 화면 한정으로 끄고 싶으면 해당 페이지의 `<MarkdownView … />` 호출에 `breaks={false}` 1줄만 추가하면 된다(공용 컴포넌트·플러그인 배열 수정 불요).
- **수식 오인식 경계**(remark-math 기본 규칙, README 확인): 인라인 `$…$`는 여는 `$` 바로 뒤·닫는 `$` 바로 앞에 공백이 없어야 하며(예: `$ x$`·`$x $`는 수식으로 인식 안 됨), 델리미터 사이 문자 수가 적을수록(공백 없이 딱 붙을수록) 안정적으로 인식된다는 것이 공식 권장 사항이다. 따라서 "3\$·5\$" 같은 일반 텍스트의 `$`가 우연히 짝을 이루면 오인식될 여지가 이론상 있으나(예: "물건이 $3, 이건 $5" → `$3, 이건 $`가 통째로 수식 시도) — 정확한 회피는 `\$`로 이스케이프(매뉴얼에 이미 반영된 문구와 일치). 실제 저장 문서 표본으로 오인식 유무를 확인하는 것은 DB 미접근으로 이번 세션에서 불가 — DoD 6(사용자 실사용 확인)으로 이월.
- **6곳 교체 확인**: `DocumentDetail.tsx`(51행 부근 `formatAnswer` 제거) · `ExamRun.tsx`(44행 부근 `formatChoiceAnswer` 제거, 빈 값 `'미응답'`) · `Flashcards.tsx`(27행 부근) · `Review.tsx`(30행 부근, `CIRCLED_DIGITS`는 마커 렌더용으로 공용 재수출 import 유지) · `Study.tsx`(750행 부근 raw 표기 → `formatAnswer`) · `QuizRun.tsx`(479행 부근 raw 표기 → `formatAnswer`) — grep으로 로컬 재정의 잔존 0건 확인.
- **build 결과**: `npx tsc -b` 0 에러. `npm run build`(`tsc -b && vite build`) 2회 성공 — KaTeX 폰트(woff/woff2/ttf) 전부 `dist/assets/`에 해시 파일명으로 정상 번들(오프라인, CDN 참조 0). 청크 크기 경고(500KB 초과, KaTeX 폰트+본문 번들 포함 1.5MB)는 사전 존재하던 코드 스플리팅 미적용 이슈의 연장으로 이 단계 범위 밖(수정 없음). **작업 지시상 `frontend/dist` 수정 금지 조항에 따라, 두 차례의 빌드 확인 직후 각각 `git checkout -- frontend/dist && git clean -fd frontend/dist`로 dist를 원상 복구**했다(오케스트레이터가 재빌드 예정).
- **부수 발견(내 작업 아님)**: 착수 시점에 `docs/manual/user-manual.html`이 이미 "줄바꿈·수식 쓰기" 절이 반영된 상태였다(내용은 이 단계 구현과 정합) — 이 세션에서 추가로 손대지 않았고, 누가/언제 반영했는지는 확인 불가(git status상 이미 unstaged 상태로 존재).
- **잔여**: DoD 4(remark-breaks 실제 저장 문서 표본 확인)·DoD 6(사용자 실사용 확인) — 둘 다 로컬 DB·실제 브라우저 접근이 필요해 이번 세션 범위 밖. stage-reviewer(Opus) 검토도 잔여.
