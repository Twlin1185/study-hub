# Stage 28 — 디자인 커스터마이즈 2계층: 전역 앱 테마·문서별 스타일 (F53 / M27 / S28)

> 상태: **완료 — 자동 DoD 6/6 충족, 3차 검토(opus) 통과 2026-08-13. DoD 7(사용자 실사용 확인) 완료 2026-08-15 — 전 항목 종결** (착수 전 결정 ①~⑤·②-1~②-3 전건 확정 2026-08-09 — 권고안대로. 작업 지시서 생성 2026-08-13.
> 계약 정본 = 계획서 v0.39 §14 F53 + **설계 §4.26 [S28]**(api) + screens §5.3·§5.11·§6·§7(Design v1.32))
>
> 배경: 2026-08-09 사용자 요청 원문 — "설정에서도 폰트, 글자크기, 배경색을 설정해서 프로그램 전체의
> 디자인을 직접 수정가능하도록하고, 문서의 폰트 글자크기 배경색은 별도로 동작하는거야".
> **계층 분리가 이 기능의 정체성**: ① **전역 앱 테마** = 디자인 토큰 값 사용자 오버라이드(불변 규칙 5를
> 지켜온 배당금 — 토큰 1곳 변경이 전 화면 파급. settings 키 `ui.theme_custom` 1개, DDL 0) ② **문서별
> 스타일** = `documents.style` JSON 컬럼 신설(**DDL 1건** — ②-1 3안 비교로 안 1 확정: 본문 directive는
> FTS 오염·반입 필드 혼입으로 기각, settings 맵은 고아·비대로 기각). 두 계층을 한 계층으로 합치는
> 설계는 착수 전 기각됐다. F52(M26) 선행 이행 완료 — 팔레트 **이름 체계**는 공유하되 토큰 **값**은
> 용도별 분리(②-3 ⓐ).

## 범위 요약

- **DDL 1건**(`documents.style` TEXT NULL — 불변 규칙 6 절차: 계획서 §6.2 갱신(2026-08-13 반영 완료) + Alembic 마이그레이션 세트) + settings 키 1개(`ui.theme_custom`). **신규 엔드포인트 0개**(documents PATCH에 `style` 필드 추가 + 기존 settings API 재사용 — 이 전제가 깨지면 임의 확정 없이 보고). LLM 0.
- 변경 파일 예상 — 백엔드: `models.py`·`alembic/`(신규 리비전)·documents 라우터/스키마(`style` 검증)·settings 검증 지점(`ui.theme_custom` 대비 검증). 프론트: 설정 화면(그룹 ⑥ 화면)·`styles/tokens.css`(`--doc-bg-*` 14개)·테마 주입 유틸(신규)·DocEditor/문서 상세(문서 스타일 폼)·MarkdownView 사용처의 본문 래퍼(문서 스타일 적용) + 매뉴얼.
- **경계(④ 확정)**: 문서 스타일은 **그 문서 본문 영역에만**(사이드바·버튼 등 앱 크롬은 전역만 — R27 ③) · **임베드 카드 안에서는 문서 스타일 무시** · **인쇄는 배경 전부 무시**(전역·문서 공통 — 폰트·글자크기는 인쇄 유지) · **다크 모드 불변**(커스텀은 라이트·다크 각각 저장 — 한쪽만 지정하면 다른 쪽은 기본 토큰).

## 체크리스트

### 1. 백엔드 (DDL 1건 + 검증 2곳 — §4.26 계약)

- [x] **1-1. Alembic 마이그레이션**: `documents.style` TEXT NULL 추가(기본 NULL — 기존 행 소급 0). upgrade/downgrade **왕복 검증**(downgrade가 컬럼을 깨끗이 제거하고 재-upgrade가 성공). `models.py` 반영은 계획서 §6.2 정본(2026-08-13 갱신분) 그대로.
- [x] **1-2. documents PATCH `style` 화이트리스트 검증(§4.26 ①)**: `{font?, size?, bg?}` — `font ∈ {sans, serif, mono}` · `size ∈ {small, default, large, xl}`(②-3 ⓑ — 기존 FontScale 3단계 명명 + xl) · `bg ∈ F52 팔레트 7색 이름`(red·orange·yellow·green·blue·purple·gray). **부분 지정 허용**(있는 키만 검증·저장) · **`style: null` = 전체 해제** · 범위 밖 값·미지 키·임의 hex = **422**(임의 JSON 수용 금지 — 불변 규칙 5 재관통 방지). `GET /api/documents/{id}` 응답에 `style` 포함.
- [x] **1-3. resolve-embeds 응답에 `style` 부재 유지(§4.26 ②)**: `POST /api/documents/resolve-embeds` 항목 스키마에 `style`을 **추가하지 않는다**(필터링이 아니라 **부재** — F43이 answer·explanation을 봉인한 기법과 동일, 임베드 카드 안 무시가 계약 수준에서 끝남). 회귀 확인을 완료 기록에 남긴다.
- [x] **1-4. settings `ui.theme_custom` 서버 검증(§4.26 ③ — R27 ②)**: 기존 settings PUT 재사용(신규 엔드포인트 0) + 이 키에 한해 서버 검증 — 라이트·다크 각각 `{light?, dark?}`, 미설정 항목 = 기본 토큰 상속. **배경·서피스 계열 = 자유 색 허용 + 글자 토큰과의 명도 대비 검증(미달 = 저장 거부 422·서버 완성 문장)** · **글자색·강조색 계열 = 팔레트/프리셋 값만**(자유 hex 422 — 배경보다 실패 비용이 크다). 대비 임계값 구체 수치는 구현 실측으로 정하고 완료 기록에 남긴다(R27 ② 이행 세부 — 새 결정 아님).
- [x] **1-5. 트랜잭션·기존 계약 불변 확인**: `style` 저장은 documents PATCH의 기존 UPDATE 경로(불변 규칙 2 무관 — attempts 경로 아님). 반입 규격(§8.2)·변환 프롬프트 무변경(LLM이 style을 만들 경로 0 — ②-1 "반입 경로 격리"가 안 1의 채택 근거).

### 2. 프론트 (전역 테마 + 문서 스타일 + 토큰)

- [x] **2-1. 설정 화면 전역 테마 편집(그룹 ⑥ 화면 확장 — F38 6그룹 수 불변)**: **라이트·다크 각각** 편집 탭/토글 — **프리셋 몇 종(세피아·고대비 등 — 구체 목록 구현 재량) + 커스텀**. 커스텀: **배경·서피스 = 자유 색 선택 + 대비 자동 검증 표시**(미달 조합은 저장 버튼 비활성 + 사유 1줄 — 서버 422가 최종 게이트, 프론트는 즉시 피드백) · **글자색·강조색 = 팔레트/프리셋 선택만**(자유 입력 UI 없음) · 폰트 = 시스템 폰트 스택 프리셋 3종(sans/serif/mono — ⑤) · 기준 글자크기. 저장 = settings PUT `ui.theme_custom`. (`components/settings/ThemeCustomSection.tsx` — 프리셋 3종: 세피아·고대비·소프트 그레이. 글자색·강조색은 백엔드 `settings_service.THEME_PALETTE_NAMES`와 대조해 F52 팔레트 7색 이름으로 정합.)
- [x] **2-2. CSS 변수 런타임 주입**: 저장된 `ui.theme_custom`을 **`<html>` 수준 CSS 변수로 주입**(빌드 불요 — 토큰만 참조해온 컴포넌트에 자동 파급). 라이트·다크 전환(`class="dark"` 토글) 시 해당 테마의 오버라이드만 적용 — 미설정 항목은 기본 토큰 그대로(§6 이중 구조 불변). (`utils/themeCustomInject.ts` + `hooks/useApplyThemeCustom.ts`, `App.tsx`에서 1회 호출 — 색 오버라이드는 `@media screen`으로만 감싸 인쇄 강제 라이트 규칙과 절대 충돌하지 않게 하고, 폰트·기준 글자크기는 매체 제한 없이 선언해 인쇄에도 유지.)
- [x] **2-3. 복구 경로(R27 ① — 계약)**: 설정 화면에 **[기본값으로 되돌리기] 상시 노출**(전역 커스텀 전체 해제) + **토큰 무시 안전 모드 1개**(URL 쿼리 등 — 커스텀이 아무리 깨져도 기본 토큰으로 진입 가능한 문. 구체 형태 구현 재량·매뉴얼 명시). (안전 모드 = `?safe_theme=1` 쿼리 — `utils/themeCustomInject.ts`의 `isSafeThemeMode()`. 되돌리기 = `ui.theme_custom: null` 저장.)
- [x] **2-4. 문서 스타일 폼(§5.3 S28)**: DocEditor(편집 모드)·문서 상세에서 **폼 필드**로 font/size/bg 지정 — 각 항목 "전역 따름(기본)" + 화이트리스트 값 선택(bg는 팔레트 7색 이름 — 색상 견본은 `--doc-bg-*` 토큰), **부분 지정·개별 해제** 지원. 저장 = documents PATCH `style`(본문 폼과 같은 저장 경로 — 본문 텍스트 조작 없음). (`components/DocStyleFields.tsx` 공용 서브컴포넌트 — `DocEditor.tsx`(편집 모드 전용) + `DocumentDetail.tsx`(`DocStyleSection` 즉시 저장) 양쪽 재사용.)
- [x] **2-5. 우선순위 적용(③)**: **문서 지정값 > 전역 설정 > 기본 토큰** — 문서 미지정 항목은 전역 상속. 적용 범위 = 그 문서의 **본문 렌더 영역만**(DocViewer·학습·퀴즈 등 MarkdownView 래퍼 수준 — 앱 크롬 불변). (`hooks/useDocStyle.ts`(훅) + `utils/docStyle.ts`의 `resolveDocStyle`(순수 함수, 인쇄 뷰 반복문에서 재사용) — 적용 지점: `DocumentDetail.tsx`·`Study.tsx`(개념 트랙)·`QuizRun.tsx`(현재 문항의 documents 상세 재사용)·`Flashcards.tsx`(범위 경로)·`ConceptPrintView.tsx`·`QuizPrintView.tsx`. **미적용(백엔드 스키마에 style 없음 — 계약 범위 밖, 아래 보고 참조)**: `ExamRun.tsx`·`Review.tsx`·`WrongNotePrintView.tsx`·Study.tsx의 `QuizStage`(연습·기출 퀴즈 인라인 단계) — 전부 lean 스키마(QuizQuestion·ReviewNoteDocument 등)만 쓰고 documents 상세를 조회하지 않음.)
- [x] **2-6. `--doc-bg-{7색}` 토큰 신설(②-3 ⓐ)**: `tokens.css`에 문서 배경용 **연한 틴트** 토큰 7색 × 라이트·다크 쌍(14개). **F52 형광펜 `--mark-*`와 이름 체계는 공유하되 값은 분리**(형광펜 강도의 전면 배경은 눈부시다 — 같은 "yellow"라도 다른 값). 7색 전부 글자 토큰 대비 확보(R26 ③ 관례 연장).
- [x] **2-7. FontScale 대체 규칙(④ ⓒ)**: 문서 `style.size` 지정 문서에서는 그 값이 `study.font_scale`(F36-⑨)을 **대체**(곱연산 기각 — 결과 예측 불가). size 미지정 문서는 기존 FontScale 동작 그대로(중복 축 방치 없음). F52 `:t` `s=`의 상대 배율(em) 곱 합성은 별개 계층 — 무변경. (`useDocStyle`/`resolveDocStyle`가 `style?.size ?? globalScale`로 대체 — MarkdownView `scale` prop을 `FontScale|'xl'`로 확장.)
- [x] **2-8. 경계 구현(④ ⓐ·ⓑ)**: **임베드 카드 안 = 문서 스타일 무시**(resolve-embeds에 style이 없으므로 프론트 추가 규칙 최소 — 카드 내부에 상위 문서 스타일도 새지 않게 래퍼 경계 확인) · **인쇄 = 배경 전부 무시**(전역·문서 공통 — §6 "인쇄는 항상 라이트" 연장. `--doc-bg-*`에 `print-color-adjust: exact`를 걸지 않는다 — F52 형광펜·글자색 한정 결정 불변) · **폰트·글자크기는 인쇄 유지**(잉크와 무관 — 정리본이 화면과 같은 서체). (임베드 경계: MarkdownView가 임베드 재귀 렌더에서 `scale`을 항상 전역값으로 되돌리고, `EmbedCard.tsx` 내부 래퍼에 `.doc-style-reset` 클래스로 폰트를 전역 `--font-base`로 복귀 — 배경은 `background-color` 비상속 + EmbedCard 자체 `bg-surface-raised`로 자연 격리. 인쇄 경계: `DOC_BG_PRINT_RESET_CLASS = 'print:bg-transparent'`를 배경 적용 지점마다 병기.)

### 3. 문서·매뉴얼

- [x] **3-1. 매뉴얼 갱신**(`docs/manual/user-manual.html`): 설정 §에 전역 테마 편집(라이트·다크 각각·프리셋+커스텀·대비 검증·[기본값으로 되돌리기]·안전 모드) + 문서 §에 문서별 스타일(우선순위 문서>전역>기본·임베드/인쇄 경계) 반영.
- [x] **3-2. stage 문서 체크박스 갱신**(불변 규칙 10) + 완료 기록 작성(대비 임계값 실측·resolve-embeds 회귀 확인 결과 포함).

## 완료 기록 (2026-08-13)

- **구현**: backend-dev·frontend-dev(sonnet) 병렬 2묶음. 백엔드 = Alembic 리비전 `a1c9f3d8e421`(`documents.style` TEXT NULL — M17~M25 무-DDL 행진 이후 첫 DDL, §6.2+Alembic 세트 절차 이행. 사본 DB 224행 왕복 검증·소급 0) · `DocumentStyle` 화이트리스트(`extra="forbid"`) · settings `ui.theme_custom` 키별 검증 훅(다른 키 계약 §4.10 영향 0 — 선검증·후일괄쓰기 유지). 프론트 = 설정 그룹 ⑥ 전역 테마 편집(`ThemeCustomSection`)·`<html>` CSS 변수 주입(`themeCustomInject` — 라이트 `html:not(.dark)`/다크 `html.dark` 상호배타 선택자)·문서 스타일 폼(`DocStyleFields` — DocEditor·문서 상세 공용)·`--doc-bg-{7색}`×라이트·다크 14토큰(형광펜 `--mark-*`와 값 분리)·`resolveDocStyle`(size 지정 시 FontScale 대체).
- **구현 재량 결정(정본 기록)**: ⓐ 프리셋 3종 = 세피아·고대비·소프트 그레이(라이트·다크 각각) ⓑ 안전 모드 = `?safe_theme=1` 쿼리(주입 전체 스킵) ⓒ `ui.theme_custom` 테마 객체 키 6개 = `font`/`size`/`bg`/`surface`/`text`/`accent`(size 명명은 문서 스타일과 동일 4단계 재사용) ⓓ 전역 기준 글자크기 px = small 14·default 16·large 18·xl 20 ⓔ style 하위 키 명시적 `null` = 422(해제는 키 생략 또는 `style:null` 전체 해제 — §4.26 ① "엄격" 해석) + 저장 전 None 제거·디코딩 시 비문자열 값 드롭 3중 방어.
- **대비 임계값(1-4·R27 ② 실측 확정)**: 본문 `--text` ≥ **4.5:1**(WCAG AA) + 보조 `--text-muted` ≥ **3.0:1**(WCAG 큰 텍스트/UI 완화 기준) — 서버·프론트 동일 2축, `bg`/`surface` 미지정 시에도 effective 값으로 상시 검사(스킵 경로 0). muted hex = 라이트 `#6b7280`·다크 `#9aa1ae`(tokens.css 미러). 프리셋 3종×2모드 전수 통과(최저 = 세피아 라이트 surface↔muted 3.82:1).
- **resolve-embeds 회귀(1-3·DoD 5)**: 스키마 부재 + style 지정 문서(DOC-0224) live 호출로 style·answer·explanation 0건 확인 — 계약 수준 봉인 유지.
- **검토(stage-reviewer opus)**: 1차 **반려**(치명 2 — ① 프리셋·글자크기 저장 `fontSize`/`size` 키 불일치 422 ② style 하위 키 명시적 null → 500+문서 상세 파손 · 중요 1 — muted 대비 미검증 · 경미 7) → 전건 수정 → 2차 **반려**(신규 치명 1 — 주입 `:root`가 tokens.css `.dark`를 캐스케이드로 덮어 "라이트만 저장→다크 전환" 시 1.03:1 붕괴) → 선택자 상호배타화 수정 → 3차 **통과**(3케이스 실측: 라이트만/양쪽/다크만 저장 전건 정상, 자동 DoD 6/6).
- **검증**: `npm run build` 0 에러 · `run-tests.ps1` **512 passed**(신규 = tokens.css ↔ 백엔드 `_INK_HEX`·기본 토큰 사본 동기 pytest 3건) · `invariant-scan.ps1` PASS(신규 hardcoded-color 3파일은 검토자 파일별 정당 판정 — JS 대비 계산 폴백·프리셋/팔레트 미러 데이터 — 후 기준선 갱신) · 422/200 매트릭스 전건 · 마이그레이션 왕복 · 무지정 렌더 diff 0(주입 CSS 0바이트·`--font-size-base` 토큰 제거로 html font-size 선언 부재 = 브라우저 접근성 기본값 복원).
- **DoD**: 자동 1~6 전건 충족. **7(사용자 이행 — PC·폰 실사용 확인) 완료(2026-08-15 사용자 확인).**
- **잔여 알려진 항목(미수정·기록)**: 전역 커스텀 시 `--surface-raised`가 `--surface`와 동일값(깊이감 평탄화 — 재량 수용) · 플래시카드는 문서 배경 미적용(폰트·크기만) · 보기(choices) 목록에 문서 폰트 미적용(본문 영역 경계가 화면마다 다름) · **스코프 갭**: 시험 응시(ExamRun)·복습(Review)·오답 인쇄(WrongNotePrintView)·학습 문제 단계(QuizStage)는 경량 스키마(style 미포함)라 문서 스타일 미적용 — §4.26이 지정하지 않은 경로로 검토자 "계약상 타당한 수용" 판정, 매뉴얼 명문화 완료 · 토큰 3중 복제(tokens.css·백엔드·프론트) 중 **기계 봉인은 백엔드 1변뿐**(프론트 미러 스테일은 테스트로 안 잡힘) · `{"style":{}}`는 NULL 아닌 빈 객체 저장(렌더 영향 0·UI 미발생 경로) · 전역 size small=14px 시 `text-xs` 10.5px(밀집 UI 가독성은 DoD 7 관찰).

## 후속 정리 기록 (2026-08-13 — 사용자 승인 "남은 결함 검토·완료")

- **해소 5건**(위 잔여 목록 중 — 표적 검토 조건부 통과 → 기준선 갱신으로 전건 마감): ① `--surface-raised` = 커스텀 surface에서 4% 밝힘 혼합 파생(다크만 — 라이트 기본 쌍(`#ffffff`/`#ffffff`) 역산상 ratio 0이 일관) ② 플래시카드 배경 적용(`FlipCard` 옵션 prop — Review 화면은 기본값 경로로 무영향) ③ 보기 목록에 문서 폰트·크기 적용(`MARKDOWN_SCALE_CLASS` 공용 상수 추출 — 선택·정오 상태 색 불변) ④ 토큰 3중 복제 **전변 기계 봉인**(pytest가 프론트 `INK_HEX`·`DEFAULT_TOKEN_VALUES`·`CONTRAST_MIN(_MUTED)`까지 TS 텍스트 파싱 대조 — 총 6건, 파서는 싱글쿼트 리터럴 전제·포매터 변경 시 실패로 드러나는 안전한 취약성) ⑤ `{"style":{}}` = NULL 정규화(저장·디코딩 대칭, DB 실측 SQL NULL).
- **의도된 부수 변화**: 전역 `study.font_scale`을 small/large로 쓰는 사용자는 보기 목록·보기 버튼도 그 크기를 따른다(종전 고정 `text-sm` — F36-⑨ 취지 부합, 무지정 기본 사용자는 변화 0).
- **신규 관찰(수용)**: 문서 배경 지정 플래시카드는 앞·뒷면 배경이 같아져 뒷면 `bg-surface-raised` 구분이 사라짐(Flashcards 한정) · 라이트 커스텀 surface는 여전히 raised와 동일값(기본 설계 일관).
- **검증**: `run-tests.ps1` **515 passed**(+3) · `npm run build` 0 에러 · invariant-scan PASS(신규 1건 `mixHex` 흰색 기준점 — 검토자 정당 판정 후 기준선 갱신) · 422/200 매트릭스·resolve-embeds 회귀 0 재확인.
- **미이월 확정**: 스코프 갭 배선(경량 스키마 화면)·small=14px 가독성은 각각 아키텍처 결정·DoD 7 실사용 관찰 사안으로 이번 정리에서 제외.
- **배포 갭 발견·조치(2026-08-13 실사용 이행 중)**: 시작 스크립트(`2_StartServer.bat`·`Dev_StartServer.bat`)가 `study.db` **존재 시 마이그레이션을 건너뛰어**(if not exist 조건) M17~M25 무-DDL 기간에는 무해했으나 첫 DDL(S28)에서 전 화면 500(`no such column: documents.style`) 발생. 조치 = ① 실 DB에 `alembic upgrade head` 수동 적용(구동 중 적용 — WAL이라 재시작 불요, 소급 0 확인) ② 두 스크립트를 **매 시작마다 upgrade head 실행**(멱등 — head면 no-op)으로 수정.

## DoD (Definition of Done)

자동(구현·검토 세션에서 확인):
1. `npm run build` 0 에러 · `run-tests.ps1` 기존 통과 유지 · `invariant-scan.ps1` PASS(신규 위반 0 — 신규 클래스 전부 토큰).
2. **마이그레이션 왕복**: upgrade→downgrade→upgrade 성공 + 기존 행 `style` NULL 확인(소급 0).
3. **422 검증**: `style` 범위 밖 값(`{"bg":"#ff0000"}`·미지 키·잘못된 size) = 422, 부분 지정·`null` 해제 = 200. `ui.theme_custom` 대비 미달 조합·글자색 자유 hex = 422.
4. **무지정 문서 렌더 불변**: `style` NULL 문서 + `ui.theme_custom` 미설정 상태에서 전 화면 렌더 diff 0(기존 사용자 화면이 1픽셀도 변하지 않는다).
5. resolve-embeds 응답에 `style` 필드 부재(스키마 수준 — 회귀 확인).
6. 우선순위 동작: 문서 지정 항목이 전역을 덮고, 미지정 항목이 전역을 상속하며, 전역 미설정 항목이 기본 토큰으로 귀결. FontScale은 size 지정 문서에서만 대체됨.

사용자 이행(서버는 사용자가 직접 구동 — Claude는 서버를 남기지 않는다):
7. 실사용 확인 — PC·폰에서 전역 테마 변경(라이트·다크 각각)·문서 스타일 지정·다크 전환·임베드 화면·인쇄 미리보기(배경 무시·폰트 유지) 체감 + 복구 경로([기본값으로 되돌리기]·안전 모드) 동작 확인.

## 이 단계에서 하지 않는 것

- **스타일 프리셋 JSON(`{"preset":"노트"}` 형태) 없음** — 1차 구현은 직접 지정만(②-2 YAGNI — JSON이라 스키마 변경 없이 담을 수 있음은 확장 여지로만 기록).
- **웹폰트 번들 없음** — 시스템 폰트 스택 프리셋 3종만(⑤ — PWA 캐시·dist 용량, 임의 글꼴명 자유 입력도 없음).
- **임의 hex 글자색 없음** — 문서별은 팔레트만, 전역도 글자색·강조색 계열은 팔레트/프리셋만(자유 색은 전역 배경·서피스 한정 + 대비 검증).
- **본문 directive 방식(`:::docstyle{…}`) 없음** — ②-1에서 기각 확정(FTS 오염·반입 필드 혼입·이중 출처).
- **F54 이미지 첨부 없음** — 별개 기능(M28 — 독립 착수).
- **`meta` 범용 서랍 없음** — 컬럼명은 `style`로 좁힌다(②-2 — 다른 문서 메타는 필요 실측 후).
- **문서 스타일의 앱 크롬 적용 없음** — 본문 영역만(R27 ③ — 조합 폭발의 절반을 구조로 제거).

## 리스크

- **R27 디자인 커스터마이즈의 자기 발등 찍기(이 단계 최대 리스크 — plan §15 원문 인용)**: "사용자가 전역 토큰 값을 직접 바꾸므로 **글자색과 배경색을 같게 만들면 화면이 안 보이고**, 그 상태에서 설정 화면 자체도 안 보여 **되돌릴 수 없는 상태에 빠질 수 있다**(개인용 로컬앱이라 지원 창구가 없다). 또한 문서별 스타일이 전역과 독립이라 **두 계층이 곱해지는 조합 폭발**(전역 다크 + 문서 흰 배경 + 형광펜)에서 가독성이 깨지는 경우를 전수 검증할 수 없다" — 대응 4종이 계약: ① 복구 경로 내장(2-3 — [기본값으로 되돌리기] + 안전 모드) ② 대비 최소값 강제(1-4·2-1 — 미달 = 저장 거부) ③ 문서 스타일은 본문 영역만 + 임베드/인쇄 경계 고정(2-5·2-8) ④ 라이트·다크 각각 저장(테마 전환 불변).
- **조합 가독성 전수 검증 불가(R27 후단)**: 구조적 완화(③·④) 후 잔여는 DoD 7 실사용 관찰로 — 깨지는 조합이 실측되면 팔레트 값 조정 또는 조합 경고로 대응(조용한 수용 금지).
- **settings 검증의 키 특정화**: settings API는 범용 키-값인데 `ui.theme_custom`만 서버 검증이 붙는다 — 검증을 settings 저장 경로의 키별 훅으로 격리해 다른 키 계약(§4.10)에 영향 0을 확인(1-4).
