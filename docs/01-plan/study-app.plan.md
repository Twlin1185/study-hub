# Study Hub — 종합 학습 관리 시스템 기획/설계 초안

> 상태: **확정 준비 (Draft v0.59)** — v0.58 대비: **stage-41 2차(고정 열 다단) — 결정 ① 사용자 번복(흐름형 ⓐ → 고정 열 ⓑ) · 재구현·검토·실측 완료 문서화 (2026-08-30 — 문서만·코드 무접촉. 스키마(§6.2)·엔드포인트·기능·리스크 번호 무변경·§14 무접촉)**: 1차 흐름형 실사용에서 "단이 안 생김·3단 입력이 1단으로 이동"(브라우저 다단 균등 배분) → 사용자 확정 ⓑ → `columns` > `column` 컨테이너 grid + 방언 `::::columns{n=2}`/`:::column` + 리더 grid 셀 · Opus 검토 조건부(치명 0·중요 3·경미 7) → 수정(단 경계 키 가드 강등 · 정규화 두 계층 동치 · 헤드리스 72건) · 브라우저 실측 전건 · 실측 = **백엔드 diff 0·신규 의존 0·초기 청크 Δ vs main JS +1,232B/CSS +63B**·회귀 무변·s41 335/335 · **잔여 = DoD 8(사용자 PC+폰 ⓐ~ⓕ) + 머지** · 설계 **Design v1.51**(screens §5.16 S41 2차). 상세 정본 = `stage-41-flow-columns.plan.md` 완료 기록(2차) — 마스터에 옮겨 적지 않는다.
> (v0.58: v0.57 대비: **stage-41(흐름형 다단 — FB-10) 구현·검토·실측 완료 문서화 (2026-08-30 — 문서만·코드 무접촉. 스키마(§6.2)·엔드포인트·기능·리스크 번호 무변경·§14 무접촉)**: `columns` 컨테이너 블록(2·3단 · 세로 구분선 · 모바일 1단) + `:::columns{n=2}` 방언 + 리더 렌더 · 검토(Opus) **조건부**(치명 0·중요 1 = 인쇄 단 수 강등·경미 5) → 수정 · 브라우저 실측에서 **편집 표면 CSS 매칭 0**(노드뷰 래퍼) 발견·선택자 재작성 · 드래그 핸들 = 단 경계 문단 오른단 조각 hover 시 이격 관찰(결정 ④ⓐ 유지) · 실측 = **백엔드 diff 0·신규 의존 0·초기 청크 JS +497B/CSS +752B**·회귀 전건 무변·s41 257/257·run-tests 611·invariant PASS · **잔여 = DoD 8(사용자 실사용 PC+폰 ⓐ~ⓔ + 인쇄 미리보기) + 머지** · 후속 등재 2건(별지 §13 FB-14 콜아웃 자식 CSS 매칭 0 의심(main 기존) · FB-15 React #185 1회 — stage-42 조건 해당 여부 = 사용자 판단) · 설계 **Design v1.50**(screens §5.16 S41 실측 재개정). 상세 정본 = `stage-41-flow-columns.plan.md` 완료 기록 — 마스터에 옮겨 적지 않는다.)
> (v0.57: v0.56 대비: **stage-40(툴바 정비 — FB-6·9·11) 구현·검토·실측 완료 문서화 (2026-08-25 — 문서만·코드 무접촉. 스키마(§6.2)·엔드포인트·기능·리스크 번호 무변경·§14 무접촉)**: 도킹 서식 툴바(부유 병행·상단 sticky·모바일 1줄 가로 스크롤) + 블록별 툴바 필터(**3단 규칙** — 텍스트 실을 수 있는 블록 0 = 숨김 / 텍스트 1개라도 = 표시 / 빈 집합 = 표시) + 인라인 [코드] 버튼 + 코드 블록·인라인 칩 토큰 외양 · 검토(Opus) **1차 반려**(치명 2·중요 1·경미 4) → 수정 → **조건부 통과** → 검토자 반례 A 실측 확정·규약 원안 복원 → 블록 타입 셀렉트 회귀 수정·재실측 통과(`3047ad1` · PR #66) · 실측 = **백엔드 diff 0·신규 의존 0·초기 청크 +3,676B**·프론트 회귀 전건 실패 0(s40 37/37)·`run-tests` 550 passed·invariant PASS · **잔여 = DoD 8(사용자 실사용 PC+폰 ⓐ~ⓔ + 부수 관찰 ⓕⓖ 판단) + 머지(dist 포함 여부 사용자 결정)** · 범위 밖 후속 등재 3건(별지 §13 — main 기존 결함 1건 포함 · stage-42 조건 해당 여부 = 사용자 판단) · 설계 **Design v1.48**(screens §5.16 S40 실측 재개정) · 별지 §9 R33 부작용 행 추기. 상세 정본 = `stage-40-editor-toolbar.plan.md` 완료 기록 — 마스터에 옮겨 적지 않는다.)
> (v0.56: v0.55 대비: **사용자 지시 "2.x는 뒤로" + stage-40/41 편성 + stage-42·v2.0.1 예정 기록 (2026-08-24 — 문서만·코드 0. 스키마(§6.2)·엔드포인트·기능·리스크 번호 무변경·§14 무접촉)**: ① **"v2.x 계획서 선확정 관례"를 뒤로 미룬다(보류)** — 별지 `editor-v2.plan.md` §13 FB-6/FB-9/FB-10/FB-11을 **stage-39 전례(v2.0.x 후속 · M 번호 미부여 · 별지 관할 · §14 압축 표 무변경)로 즉시 편성** → **`stage-40-editor-toolbar.plan.md`**(도킹 툴바(부유 병행) + 블록별 툴바 필터 + 인라인 코드 버튼·코드 블록 외양 — 표면 UI/CSS만) · **`stage-41-flow-columns.plan.md`**(흐름형 CSS 다단 `columns` 블록 + 방언 `:::columns{n=2}` — stage-40 완료 후 착수 · GPL XL 금지 불변 D10). 착수 전 결정은 **사용자 미답 → 권고안 채택(위임 판정 — 지시서 표에 재론 여지 명기)**. 계약 = DDL 0·settings 0·신규 엔드포인트 0·신규 의존 0·백엔드 diff 0 · 설계 **Design v1.47**(screens §5.16 S40·S41 추기 + §5.3 포인터) ② **stage-42(가칭 `stage-42-editor-retire`) 예정 — 조건부**(같은 날 사용자 지시): stage-40·41 중 추가 수정사항이 없으면 **구 편집기 퇴역 실행(N-2 — R38·stage-38 G-10 ⓐ 이행) + 노트 v2 정식 이식·승격 + 철저 검증 → v2.0.1 발행**(지시서는 착수 시 생성 · "기존 노트기능" 해석은 **사용자 확인 대기** — 별지 머리말 정본 · 말미 버전 정의 추기). **새 DDL·API 0.** 정본 = 별지 머리말·§5.4·§9 R38·§10 D10·§13·§14 — 마스터에 옮겨 적지 않는다.)
> (v0.55 이하 문서 이력 원문(v0.15~v0.55 · 2026-07-31 구조 변경 기록 포함)은 `docs/04-archive/plan-changelog.md`로 이관 — 2026-08-31 stage-44. 위에는 현행 상태 줄 + 최근 3건(v0.58~v0.56)만 잔류.)
> 작성일: 2026-07-22 · 갱신: 2026-08-13
> 레벨: Dynamic (로컬 웹앱, Python 백엔드 + 웹 프론트엔드)

---

## 1. 한 줄 정의

> 기출문제·학습자료를 LLM으로 구조화해 쌓고, 여러 자격증/시험이 **같은 지식 문서를 공유**하며,
> 시각화와 간격반복으로 학습→풀이→오답관리→복습 루프를 완성하는 **개인 학습 허브**.

## 2. 목표 / 비목표

### 목표 (이걸 이루면 성공)
- G1. PDF/MD/엑셀 등 원본 자료를 넣으면 구조화된 "문서(Document)"로 정리되어 쌓인다.
- G2. 자격증 > 시험 > 과목 계층 어디서든 같은 문서를 참조·공유하며 크로스 체크로 다듬는다.
- G3. 문제 풀이 기록이 자동 축적되고, 오답노트가 스스로 자란다.
- G4. 약점·진도·리듬이 시각적으로 보인다 (차트, 히트맵, 진도율).
- G5. 간격반복(SM-2)으로 "오늘 복습할 것"을 시스템이 골라준다.
- G6. 집 안 어느 기기에서든 브라우저로 접속한다 (PC 서버 + 폰/태블릿).

### 비목표 (일부러 안 하는 것 — v1 기준)
- 다중 사용자/계정 시스템 (개인용. 인증 없음 or 최소 PIN)
- 클라우드 배포, 앱스토어 출시
- 실시간 협업, 문서 공유 커뮤니티
- 앱 내 LLM 자동변환 버튼 (1단계에서는 Claude Code로 변환 → 3단계에서 API 연동)

## 3. 사용자 시나리오 (핵심 루프)

```
[수집] 기출 PDF 다운로드 → sources/에 저장
   ↓
[정리] Claude Code에 "이 PDF를 문서 JSON으로 변환해줘" → 검토 → DB 반입(import)
   ↓
[분류] 트리에서 자격증/시험/과목에 문서 연결 (기존 문서 재사용 가능)
   ↓
[학습] 개념 문서 읽기 → 플래시카드 → 문제 풀기 (자동 채점·기록)
   ↓
[복습] 대시보드에서 약점 확인 → "오늘의 복습" 큐 소화 → 오답노트 갱신
   ↺ (반복)
```

### 대표 시나리오 3개
- **S1. 저녁 30분 복습**: 폰으로 접속 → "오늘의 복습 24문제" → 풀고 자동 채점 → 틀린 3문제 오답노트에 메모 추가.
- **S2. 주말 기출 반입**: 새 회차 기출 PDF를 Claude Code로 JSON 변환 → 미리보기로 오탈자 확인 → 반입 → 트리에 연결. 이 중 12문제는 기존 개념문서(DOC-xxxx)와 자동 연결 제안됨.
- **S3. 시험 2주 전**: 시험별 대시보드에서 과목별 정답률 확인 → 정답률 60% 미만 단원만 골라 집중 모드 → 히트맵으로 매일 학습 확인.

## 4. 용어 정의 (Phase 1: Schema)

| 용어 | 정의 |
|------|------|
| **문서 (Document)** | 고유번호(DOC-xxxx)를 가진 독립 콘텐츠 단위. 타입: 개념/문제/기출문제/플래시카드 |
| **분류 (Category)** | 자기참조 트리 노드. 자격증 > 시험 > 과목 > 단원 … 깊이 무제한 |
| **연결 (Link)** | 분류↔문서 다대다 매핑. `local_note`로 맥락별 메모 부착 |
| **풀이 기록 (Attempt)** | 문제를 푼 1회의 기록. 정오답, 소요시간, 어느 분류 맥락에서 풀었는지 |
| **오답노트 (Review Note)** | 문서+사용자 메모+틀린 이유 태그의 묶음. 풀이 기록에서 자동 생성 가능 |
| **복습 카드 (SRS Card)** | 간격반복 스케줄 대상. 문서당 1개, SM-2 파라미터 보유 |
| **원본 (Source)** | 반입 전 원본 파일(PDF/MD/XLSX). sources/에 보관, 문서가 출처로 참조 |

## 5. 기능 목록 (우선순위)

### P0 — MVP (이것 없으면 앱이 아님)
| ID | 기능 | 설명 |
|----|------|------|
| F01 | 분류 트리 관리 | 자격증/시험/과목 트리 생성·수정·이동 |
| F02 | 문서 CRUD | 문서 생성·조회·수정. 분류에서 빼기=연결해제, 문서 자체 삭제=소프트 삭제(`is_active=0`) |
| F03 | 문서-분류 연결 | 문서를 여러 분류에 연결, 사용처 표시 ("3개 시험에서 사용 중") |
| F04 | JSON 반입(Import) | Claude Code가 만든 문서 JSON을 검증 후 DB 반입, 중복 감지 |
| F05 | 문제 풀기 모드 | 분류 선택 → 순차/랜덤 출제 → 채점 → 기록 저장 |
| F06 | 오답노트 | 틀린 문제 자동 수집 + 메모/틀린이유 태그 |
| F07 | 홈 네트워크 접속 | 0.0.0.0 바인딩, 폰/태블릿 반응형 UI |
| F19 | 커리큘럼 학습 모드 | 챕터 순서대로 문서 연속 학습(이전/다음), 개념→확인문제 흐름 |
| F20 | 진도 추적·이어하기 | 문서별 학습 상태, 트리 노드별 진도율, 홈 "이어하기" 카드 |

### P1 — 시각화·복습 (앱의 차별점)
| ID | 기능 | 설명 |
|----|------|------|
| F08 | 대시보드 | 시험별 진도율, 과목별 정답률 차트, 학습 히트맵(잔디) |
| F09 | 플래시카드 모드 | 카드 뒤집기 애니메이션, 스와이프(안다/모른다) |
| F10 | 간격반복 복습 큐 | SM-2 기반 "오늘의 복습 N개" 자동 선정 |
| F11 | 약점 분석 | 문서/단원별 누적 정답률, "자꾸 틀리는 개념 Top 10" |
| F12 | 검색 | 전문(full-text) 검색, 태그 검색 |
| F21 | 태그 자동 분류 | 분류별 태그 규칙 → 반입/태그변경 시 자동 연결 제안(승인 후 반영) |
| F22 | A4 인쇄/PDF 내보내기 | 문서·챕터 단위 A4 인쇄 뷰, 해설 포함/제외 토글, 브라우저 인쇄→PDF |
| F24 | 문제↔개념 연결 | 문제 화면에 관련 개념 바로가기, 반입 시 연결 제안 (`document_relations` 기반) — S2/F14의 전제 |
| F28 | 다크 모드 | 라이트/다크/시스템 테마. 디자인 토큰(CSS 변수) 기반 — 첫 단계부터 토큰으로 구축해 후반 재작업 방지 |
| F29 | 북마크 | 문서 별표 → 홈/탐색에서 모아보기, 퀴즈 출제 범위로 "북마크만" 선택 가능 |

### P2 — 자동화·확장
| ID | 기능 | 설명 |
|----|------|------|
| F13 | 앱 내 LLM 변환 | 파일 업로드 → Claude API 호출 → 문서 초안 생성 → 검토 후 반입 |
| F14 | 유사 문서 감지 | 반입 시 기존 문서와 유사도 비교 → "이미 있는 개념인데 연결할까요?" |
| F15 | 문서 분기(Fork) | 공유 문서가 시험별로 갈라져야 할 때 복제 후 독립 |
| F16 | 시험 D-Day 모드 | 남은 기간 기반 **복습 강도 조절** (D-Day 등록·홈 위젯·관리 UI 자체는 S4에서 완성 — 여기 남는 것은 강도 조절뿐) — M11 확정, 상세는 §14 |
| F17 | 통계 내보내기 | 학습 기록 CSV/이미지 내보내기 |
| F18 | PWA 설치 | 폰 홈 화면에 앱처럼 설치 |
| F23 | Claude Code 연동 변환 | 앱이 claude CLI(headless)를 호출해 파일→문서 JSON 변환 자동화 |
| F25 | 실전 모의고사 모드 | 회차/범위 선택 → 시간제한 타이머 → 일괄 제출 채점 → 과목별 점수·합격선(과락) 비교. 퀴즈 모드 화면 재사용 — M11 확정, 상세는 §14 |
| F26 | 학습 목표·스트릭 | 일일 목표(문제 수/시간) 설정, 연속 학습일(스트릭) 표시 — 히트맵·홈 카드와 연동 |
| F27 | 백업/복원 UI | study.db+sources/ 스냅샷 생성·복원 버튼, 주기 자동 백업 옵션 (R5의 기능화) |
| F30 | 문제 오류 신고·재생성 | 문제 화면에서 오류 신고(사유 입력) → claude CLI로 해당 문서만 재생성 → 기존/신규 나란히 미리보기 → 승인 시 교체. 엔진은 R9(CLI), 잡 인프라는 F23 재사용, R7 원칙(미리보기 필수 승인 — 자동 덮어쓰기 금지) 준수 |

### v1 마무리 — 홈 커스터마이즈·레이아웃 UX (S7, 순수 프론트 — 사용자 확정)
| ID | 기능 | 설명 |
|----|------|------|
| F31 | 홈 위젯 레이아웃 커스터마이즈 | 편집 모드에서 위젯 드래그 재배치·숨김 토글·열 수 선택(자동/1/2/3, 넓은 화면 다열 배치). 저장 = `settings:home.layout` JSON — **DDL 변경 없음**, 드래그는 포인터 이벤트 직접 구현(외부 라이브러리 없음) |
| F32 | D-Day 홈 즉석 편집 | 홈 D-Day 위젯에서 팝업으로 추가·수정·삭제 — 설정 화면까지 가지 않음. 설정의 D-Day 관리(DDayManager) 로직·모달 재사용, 새 API 없음 |
| F33 | 사이드바 접힘 토글 | 태블릿·PC에서 좌측 메뉴를 아이콘 레일로 접어 콘텐츠 영역 확보. 상태는 localStorage(기기별 UI 선호 — theme 관례, 서버 settings 아님) |

### v1.x — 실사용 개선 (M8~M11 + 후속 M12~M28, 상세 명세는 §14 로드맵 아래)
| ID | 기능 | 단계 |
|----|------|------|
| F34 | LLM 엔진 관리 — 이중 엔진(CLI+API)·우선순위·폴백·429 구조화·한도 기억·잡 진행 가시화 | M8 |
| F35 | 기출 소스 커넥터 — 1단계 URL 반입, 2단계 사이트 어댑터(**M13에서 사설 어댑터 제거 → 큐넷 단일 경로**), 3단계 큐넷 공식 오픈API(**M14 완료 ✅ 2026-07-27 — 실기 공개문제 전용, 필기·필답형은 범위 밖**) | M8(1단계)·M10(2단계 — comcbt/qnet 스텁)·M12(어댑터 3호 cbtbank)·**M13(comcbt·cbtbank 제거)**·**M14(3단계 qnet 실가동 ✅)** |
| F36 | 학습 UX 다듬기 11건 — 데일리 세션·복습 탭·퀴즈 단축키·틀린이유 원탭·공용 Stepper 등 | M9 |
| F37 | 챕터 학습 파이프라인 — 개념→문제→기출 연결, 임의 깊이 트리, 커리큘럼 내 문서 작성·수정, 문서 3대 공용 모듈 | M9 |
| F38 | 설정 재구성(6그룹) · 태그 관리자(오타 감지·일괄 병합) | M9(골격은 M8 선반영) |
| F39 | 사용자 매뉴얼 앱 통합 — `docs/manual/user-manual.html` 읽기 전용 서빙(`GET /manual`)·새 탭 열람, 원본이 단일 출처(빌드 복사 없음) | M12 |
| F40 | **수동 반입(파일/URL) UX** — ① 변환 결과 보존·복구(LLM 산출 JSON 유실 방지) ② 반입 대기열(여러 파일 연속) ③ 분류 경로 미리 지정 ④ 변환 출력 잘림 오안내 수정. F04·F23·F35-1에 걸친 **반입 경로 UX 묶음**(F36·F38 전례로 독립 번호) — **DDL 없음, 신규 API 1개(내려받기)** | M13 |
| F41 | **멀티 벤더 LLM 엔진(Codex CLI)** — ① 엔진 레지스트리(F34의 cli/api 이항 가정 해체 → 벤더×전송 목록·우선순위·폴백 일반화) ② codex-cli 어댑터(`exec --json -o`) ③ 온보딩(바이너리 자동 설치 + 로그인 진단) ④ **변환 신뢰 게이트**(원문 대조·`answer_source` — **§8.2 반입 규격 확장**, R7 강화) — 근거: 2026-07-27 격리 PoC 조건부 GO(§14 F41) | M15 |
| F42 | **다양한 문서 포맷 반입** — 파일·URL 반입에 docx·xml·md·txt·html·xlsx 정식 지원: ① 텍스트 계열(md/txt/html/xml) 직투입 정식화(인코딩 판별) ② docx/xlsx **서버측 텍스트 추출 후 투입**(파서 라이브러리 — 계획 결정, §14 F42) ③ 판별 불가 바이너리 `unsupported_format` 구조화 거부(현행 mojibake 조용 투입 결함 수정) ④ URL content-type 화이트리스트 확장 — **DDL 0건** | M16 |
| F43 | **문서 상호참조·표현 UX** — ① 트랜스클루전(문서 내 `![[DOC-xxxx]]` 임베드 — 개념 모듈 문서를 여러 상위 문서가 재사용) ② 가리기·접기(구간 단위) ③ 이동 버튼(문서 링크·헤딩 앵커) ④ 임베드 카드·접기 시각효과. 임베드 해석은 본문 전용 API(정답·해설 미포함), 참조 인덱스 = `document_relations('embeds')` — **DDL 0건** | M17 |
| F44 | **해설·정답 보완 플로우(가칭)** — 원본에 해설/정답이 없는(추출 불가 포함) 문항의 선택적 보완 2경로: ① **답지·해설지 반입(정본)** — M16 판별·추출 계층 재사용 → LLM 문항 매칭·가공 → 미리보기 승인 후 기존 문서에 병합(답지 텍스트 기준 원문 대조 적용 가능 — R7 위반 아님) ② **LLM 풀이 생성(보조)** — `answer_source:'solved'` 채널 + `explanation_source` 신설(경고 배지·기본 제외·수동 승인). **착수 전 결정 ①~④ 미해소**(§14 F44) — **DDL 0건 목표(잠정)** | M18 |
| F45 | **응용 모의고사** — 사용자가 범위(분류 트리) 지정 → **LLM이 범위 내 기출·개념 문서를 근거로 응용(변형) 문항 생성**(F41 엔진 레지스트리 재사용) → 시험 형태 응시(F25 시험 모드 화면 재사용) → **사후 검토 리포트**(문항별 근거 문서 링크 — 사전 미리보기 승인 불가 기능이라 방어선이 사후로 이동). 기출 반복(F25 — "본 문제 기억")과 구분되는 "개념의 다른 표현 적용" 훈련. **착수 전 결정 ①~⑦ 전건 확정(2026-08-02 — 계약 정본 = 설계 §4.21)** — **DDL 0건 확정**(격리 분류 저장·mode 'applied_exam'·relations 'derived_from' — 전부 값 확장·주석 갱신만) | M19 |
| F46 | **반입 자기 개선 루프(가칭)** — 반입 실패·게이트 탈락·F30 신고를 구조화된 **"실패 사례"로 수집**(원본 참조·실패 단계·오류 유형·LLM 산출물) → **위험도별 3계층 개선 채널**: ① 변환 사례집 추가(저위험·기본 — 프롬프트 분리 부속 문서) ② convert.md 프롬프트 diff 제안(중위험) ③ 코드 결함 판정 시 **재현 패키지** 산출(자기 수정 금지) → **제안함(F21 확장) 승인 경유**(자동 반영 금지) → 승인 후 과거 실패 사례 **재변환으로 회귀 확인**(실패 사례 = 회귀 테스트 자산). **착수 전 결정 ①~⑦ 전건 확정(2026-08-02 — 계약 정본 = 설계 §4.22)** — **DDL 0건 확정**(파일 기반 사례·제안 저장(`improve/` — R18 관례) + 제안함 "화면" 일반화(suggestions 테이블 무변경) + 사례집·convert.md는 git 파일 — **DB 쓰기 0**) | M20 |
| F47 | **엔진 운용 제어** — ⓐ **엔진별 활성 토글**(끄면 auto 해석·폴백 후보에서 원천 배제 — settings `llm.disabled` 부정 목록, 후보 자격 = "`available()` && enabled") ⓑ **엔진별 모델 선택**(레지스트리 수준 확장 — 소목록(하드코딩)+기본값, settings `llm.models`, `invoke()` 공통 적용으로 전 LLM 기능 일관 — **자유 텍스트 입력 없음**) ⓒ **엔진 선택 UI 게이팅**(비가용·비활성 = 선택 불가 + 사유 표시 + [다시 확인]) + **서버 422 방어**(명시 지정 8곳 전수). **착수 전 결정 ①~⑥ 전건 확정(2026-08-03 — 계약 정본 = 설계 §4.23)** — **DDL 0건 확정**(settings 키 2개 — 키-값 자유 텍스트·신규 엔드포인트 0개) | M21 |
| F48 | **LLM 작업 센터** — ⓐ **전역 작업 현황**(전 잡 kind 8종 진행·대기·최근 완료 목록 — PC 사이드바 하단 버튼·모바일 좌측 드로어 항목·라우트 아닌 전역 패널) ⓑ **취소·대기열 일시정지**(취소 = queued 비용 0 제거 / running 중단 — **부분 과금 정직 표기**, 일시정지 = 다음 잡 시작 보류만 — **LLM 호출 중간 정지·재개 없음**) ⓒ **요청 단위 모델 선택**(잡 시작 8곳 `model?` — **§4.23 ⓑ 결정 개정, 필요 실측**) ⓓ **재진입 진행 복원**(잡 목록 단일 출처 공용 훅 — 응용 모의고사 재진입 진행 미표시 실측 결함 해소). **착수 전 결정 ①~⑥ 전건 확정(2026-08-03 — 계약 정본 = 설계 §4.24)** — **DDL 0건 확정·DB 쓰기 0**(전부 인메모리, 신규 엔드포인트 4개) | M22 |
| F49 | **대용량 원본 LLM 분할 반입(가칭)** — `too_large`(20만 자 초과) 원본의 **다단계 사용자 개입형** 분할 플로우: 구조 분석(**휴리스틱 우선·무비용**, 불확실 시에만 저비용 LLM 정밀 분석 — 확인 스텝) → **분할안 제시 + 사용자 확인**(조각 체크박스 선택·인접 [합치기]·비용 합계) → 선택 조각을 기존 convert 잡 N개로 투입 → 조각별 미리보기 승인(R7 불변). 조각 = 원문 연속 부분 문자열(결정론 절단 — LLM 재작성 0). URL+파일 공통. **F40-④ "서버측 자동 분할 금지" 개정**(실질 3건 계승 — §14 F49). **착수 전 결정 전건 확정(2026-08-04 — 계약 정본 = 설계 §4.25)** — **DDL 0건 확정**(저장 = sources/·`import/split/` JSON·인메모리, 신규 엔드포인트 4개) | M23 |
| F50 | **응용 모의고사 누적·1회성 모드(가칭)** — 생성 시작 시 **[누적(기본)/1회성]** 선택: 누적 = 생성 출력 스키마 확장으로 **태그 부여**(추가 LLM 호출 0 — 같은 호출 출력 필드, 태그 규칙 연계는 제안 경유) · 1회성 = 현행 그대로(태그 생략 — 출력 토큰 절감). 문서 저장·격리 분류·마커는 양 모드 불변(F45 결정 ① 유지). **§4.21 격리 규약("태그 미부여") 부분 개정** — **착수 전 결정 ①~④ 전건 확정(2026-08-04 — 계약 = 설계 §4.21 S24 개정 블록)** — **DDL 0건 확정**(mode = 요청 파라미터·태그는 기존 테이블, 신규 엔드포인트 0개) | M24 |
| F51 | **해설·정답 표시 품질(가칭)** — ① 정답 표기 통일(프론트 "③ (3)" 이중 표기·화면 간 불일치 해소 — 공용 포맷터 1곳, LLM 0) ② 해설 렌더 개선: **remark-breaks(단일 개행)·수식(remark-math+KaTeX) 플러그인 추가**(공용 MarkdownView 1곳 → 전 화면 파급, LLM 0·데이터 소급 0) ③ 사용자 제안 "해설 전용 LLM 후처리 분리"는 **렌더 개선 후 잔존 결함 실측 시 재검토**(비용·R21 재작성 위험). **착수 전 결정 ①~③ 전건 확정(2026-08-04 — 확정 서술 = screens §5.3)** — **프론트 전용·백엔드 변경 0·DDL 0건 확정. 착수 순서 최우선(S25 먼저)** | M25 |
| F52 | **문서 인라인 표현 문법(가칭)** — 밑줄·형광펜(바탕색)·글자색·부분 글자크기·인라인 스포일러·콜아웃 블록. 문법 = **remark-directive 인라인 확장 + 마이크로 문법 3종**(원시 HTML/rehype-raw **기각 유지** — content 컬럼에 LLM·반입 텍스트가 함께 들어오므로 raw 허용 = 반입 경로의 주입구) · 색 = **의미 팔레트 7색 고정**(자유 hex 기각 — 다크 모드 자동 대응) · **DocEditor 툴바·단축키·분할 미리보기**(저장 소스는 Markdown 유지 — WYSIWYG 기각 불번복). bold·기울임·취소선·구간 스포일러·문서 임베드는 **F43/F51로 이미 구현 완료**. 인쇄도 색 그대로(`print-color-adjust: exact`) · 애니메이션은 후속 이월. **착수 전 결정 전건 확정(2026-08-09) · 프론트 전용·DDL 0건·API 0건·LLM 0** | M26 |
| F53 | **디자인 커스터마이즈 2계층(가칭)** — ① **전역 앱 테마**: 설정에서 폰트·기준 글자크기·배경색 등 **디자인 토큰 값 자체**를 사용자가 덮어써 앱 전체 디자인을 바꾼다(불변 규칙 5를 지켜온 배당금 — 토큰 1곳 변경이 전 화면 파급, 라이트·다크 각각 저장, settings 키·DDL 0) ② **문서별 스타일**: 문서마다 폰트·글자크기·배경을 **전역과 독립**으로(`documents.style` JSON 컬럼 — **DDL 1건**, 본문 directive 방식은 FTS 오염·반입 텍스트 혼입으로 기각) ③ 우선순위 = 문서 > 전역 > 기본 토큰 ④ **임베드 카드 안 문서 스타일 무시 · 인쇄 배경 무시 · FontScale(F36-⑨)은 문서 size 지정 시 대체**. **착수 전 결정 ①~⑤ 전건 확정(2026-08-09) · DDL 1건 · F52 선행 권장(이행 완료)** · 작업 지시서 **`stage-28-doc-style.plan.md` 생성(2026-08-13)** — **계약 정본 = 설계 §4.26(S28)** | M27 |
| F54 | **이미지 첨부(가칭)** — 업로드·**클립보드 붙여넣기**·드래그앤드롭 → 본문에 `![](/images/…)` 삽입. **인프라 재사용**(실측 2026-08-09): `sources/images/` + `GET /images/{filename}`(경로 탈출 차단 적용분) + 파일명 `{sha256[:16]}.{ext}`(내용 해시 = 중복 제거 공짜·**테이블 불요**) + **백업(F27)이 이미 sources/ zip 포함**. 신규 = **업로드 엔드포인트 1개**(매직 바이트 검사·MIME 화이트리스트(**svg 제외**)·크기 상한) + 프론트 UI. **동영상·외부 사이트 iframe은 범위 밖 확정**(X-Frame-Options로 대부분 실동작 불가). **착수 전 결정 ①~④ 전건 확정(2026-08-09) · DDL 0건·백업 개정 0건** · 작업 지시서 **`stage-29-image-upload.plan.md` 생성(2026-08-14)** — **계약 정본 = 설계 §4.27(S29)** | M28 |
| F55 | **편집 가능 미리보기 — 블록 단위 소스 편집** — 미리보기 뷰 모드에서 블록 클릭 → 그 블록만 textarea로 전환 → 확정 시 원본 오프셋 구간만 치환(무편집 = 1바이트 불변). **F43 "WYSIWYG 기각" 1차 부분 개정**(편집 표면만 확장 — contentEditable·역직렬화·rehype-raw 기각과 저장 소스 Markdown은 유지) — **프론트 전용·DDL 0건·API 0건·신규 의존 0** · 작업 지시서 `stage-27-editable-preview.plan.md` · 리스크 R28 | M29 |
| F56 | **WYSIWYG 편집(가칭)** — 블록을 클릭해도 `:t[…]{c=red}` 같은 문법이 드러나지 않고 **색·형광펜·굵게가 입힌 그대로 보이면서 타이핑**되는 편집 표면(Notion/Word 방식 — 2026-08-14 사용자 3안 중 ⓐ 채택). **F43 "WYSIWYG 기각" 2차 부분 개정** — 개정되는 것은 "편집 표면은 소스 텍스트뿐"뿐이고, **저장 소스 = Markdown · rehype-raw/원시 HTML 기각 · HTML→Markdown DOM 역직렬화 기각 · 공용 MarkdownView 단일 렌더러 · 읽기 전용 화면 불변**은 전부 유지(불번복). 직렬화는 DOM이 아니라 **인라인 모델**에서만 하고 미변경 노드는 원본 슬라이스 재출력(정규화 국소화). **착수 전 결정 ①~⑧ 전건 확정(2026-08-15 — ②·④·⑧은 권고안에서 확장)**: 자체 contentEditable·**신규 의존 0** / 리치 대상 = **문단·헤딩·목록·인용**(코퍼스 86.6%) / S27 병존 + [소스로 편집] 토글 / 붙여넣기 = **HTML 화이트리스트 변환**(plain text 강제 폐기) + **자유 hex 색 허용·다크 자동 보정(F52 결정 ③ 개정)** / 직렬화 3층 계약 / IME 조합 중 전면 보류 / undo 네이티브 승계(자체 스택은 후속 여지) / 1단계에 **목록 Enter·Backspace 규약 포함** + 퇴로 플래그 `wysiwyg?` · **계약 정본 = 설계 screens §5.3 S30(Design v1.35 — API 0건이라 §4.x 없음)** · 작업 지시서 **`stage-30-wysiwyg.plan.md`(2026-08-15 작업 지시서로 재작성 — 착수 가능)** · 리스크 R29~R32(R30 대응 격상·R32 종결) — **프론트 전용·DDL 0건·API 0건·LLM 0·신규 의존 0** | M30 |
| F57 | **노트(베타) — 에디터 v2 착지 표면**(에디터 v2 재편의 첫 사용자 대면 기능. 별지 `editor-v2.plan.md` D9) — 신규 `notes` 저장소(**DDL 1건** — §6.2 · 소프트 삭제 · FTS 미색인) 위에서 BlockNote 기반 새 편집기를 완성한다. **소스 오브 트루스 = 블록 JSON, Markdown은 파생 프로젝션**(클라이언트 변환기 산출물을 함께 저장 — 서버는 만들지도 해석하지도 않는다) · **기존 편집기 4파일·`MarkdownView`·`components/markdown/*`·`documents` 무접촉**(v1.90.1 편집 경험 1바이트 불변) · 진입은 **설정 실험실(베타) 카드 링크 1개**(상시 메뉴 미노출) · **신규 엔드포인트 5개**(§4.28), 이미지·문서 검색·임베드 해석은 기존 API 재사용 · **참조 칩 UX 재설계 ①~④ 확정**(피커 필수 · 선택 텍스트 라벨 승계 · 추종형 라벨 · 편집 표면은 팝오버·읽기 표면은 이동) · **계약 정본 = 설계 §4.28(S33) + screens §5.16** · 작업 지시서 **`stage-33-notes-surface.plan.md`(코어) + `stage-34-notes-dialect.plan.md`(방언·참조 칩·이미지·붙여넣기 · M33 게이트)** · 리스크 R41(+ 별지 R33~R40) | M33 |
| F58 | **문서 편집 에디터 v2 — 블록 저장·표면 통합·UX 마감 총괄**(v2.00.0 발행 시 부여, 2026-08-22 — 색인 행. 상세 정본 = 별지 `editor-v2.plan.md` + stage-35~38 문서) — 저장 소스 오브 트루스 = 블록 JSON·Markdown은 파생 프로젝션(D1 — 전환 문서 한정·미전환 퇴로 불변), 편집 진입점 전수 통합(stage-36)·Notion UX 마감(슬래시·드래그·표/수식·찾기/바꾸기)·모바일 마감(stage-38) | M34~M36 |
| F59 | **신규 커스텀 블록 3종 — TOC(`::toc`)·웹 임베드(`::web` — §4.30·R39)·이미지 크롭(§4.27 재사용)**(v2.00.0 발행 시 부여, 2026-08-22 — 색인 행. 상세 정본 = `stage-37-custom-blocks.plan.md`) | M35 |

## 6. 데이터 모델

### 6.1 ERD 개요

```
categories (트리) ──< category_documents >── documents ──< attempts
     │                    (다대다+메모)          │  │
     └────────────────────────────────────────────┘  ├──< review_notes
                    attempts.category_id (맥락)       ├──1 srs_cards
                                                     ├──> sources (출처)
                                                     └──< document_relations >── documents
                                                          (문제↔개념 등 문서 간 관계)
```

### 6.2 테이블 정의 (SQLite)

```sql
-- 분류 트리 (자기참조)
CREATE TABLE categories (
  id          INTEGER PRIMARY KEY,
  parent_id   INTEGER REFERENCES categories(id),
  name        TEXT NOT NULL,
  level_hint  TEXT,             -- '자격증'|'시험'|'과목'|'단원' (표시용, 강제 아님)
  exam_date   DATE,             -- D-Day 기능용 (선택)
  sort_order  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 문서 (콘텐츠의 단일 출처)
CREATE TABLE documents (
  id          INTEGER PRIMARY KEY,
  doc_no      TEXT UNIQUE NOT NULL,        -- 'DOC-0001' 표시용 고유번호
  type        TEXT NOT NULL,               -- 'concept'|'question'|'past_question'|'flashcard'
  title       TEXT NOT NULL,
  content     TEXT,                        -- 본문/문제 지문 (Markdown). M34/stage-35부터 전환 문서(blocks_version NOT NULL)에서는 content_blocks의 **프로젝션(파생)** — 리더·FTS·LLM·인쇄·백업은 계속 이 컬럼을 소비한다(무변경)
  choices     TEXT,                        -- 객관식 보기 (JSON 배열, 선택)
  answer      TEXT,                        -- 정답
  explanation TEXT,                        -- 해설 (Markdown). 전환 문서에서는 explanation_blocks의 프로젝션(M34/stage-35 — content와 동일 규약)
  difficulty  INTEGER,                     -- 1~5 (선택)
  style       TEXT,                        -- 문서별 스타일 JSON (M27/F53 — S28 Alembic 마이그레이션으로 추가. {font?, size?, bg?} 서버 화이트리스트: font ∈ sans|serif|mono · size ∈ small|default|large|xl · bg ∈ 팔레트 7색 이름(§4.26 — 임의 JSON·hex = 422). NULL = 미지정(전역 상속·기존 행 소급 0). resolve-embeds 응답에는 부재 — 임베드 무시의 계약 봉인)
  -- 에디터 v2 저장 전환 3컬럼 (M34/stage-35, 2026-08-18 — **R42**(불변 규칙 6 절차) · Alembic 세트는 stage-35 구현분 · 계약 = 설계 §4.29(S35))
  content_blocks     TEXT,                 -- 앱 중립 블록 JSON 문자열 {version, blocks} — **NULL = 미전환 문서**. NOT NULL이면 본문의 소스 오브 트루스(content는 프로젝션으로 역할 전환). 스키마 정본 = frontend/src/editor2/schema/blocks.ts (서버는 딥 검증하지 않는다 — notes 전례)
  explanation_blocks TEXT,                 -- 해설 블록 JSON(동일 규약). 전환 문서에서 해설이 없으면 NULL — **전환 판정에 쓰지 않는다**
  blocks_version     INTEGER,              -- content_blocks.version의 컬럼 사본(서버가 채움 — notes 전례). **NULL = 미전환. 전환 판정·지연 마이그레이션 SQL 조회의 단일 기준.** 블록을 동반하지 않는 content/explanation 기록은 같은 트랜잭션에서 3컬럼을 NULL로 되돌린다(전환 해제 — §4.29 ④, 이중 저장 드리프트 차단)
  -- 태그는 document_tags 테이블로 정규화 (자동분류·검색에 필요)
  source_id   INTEGER REFERENCES sources(id),
  source_detail TEXT,                      -- '2023년 2회 17번' 등
  is_active   INTEGER DEFAULT 1,          -- 소프트 삭제
  forked_from INTEGER REFERENCES documents(id),  -- 분기 원본 추적
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 분류-문서 다대다 연결
CREATE TABLE category_documents (
  category_id INTEGER NOT NULL REFERENCES categories(id),
  document_id INTEGER NOT NULL REFERENCES documents(id),
  sort_order  INTEGER DEFAULT 0,
  local_note  TEXT,                        -- 이 시험 맥락에서만 붙는 메모
  linked_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  linked_by   TEXT DEFAULT 'manual',       -- 'manual'|'import'|'rule'|'applied_exam'(M19/F45 — 응용 모의고사 생성 문항의 격리 분류 연결. 자유 텍스트라 CHECK 없음 · 마이그레이션 0건) — 연결 출처 (M6, §11 원칙)
  linked_rule_id INTEGER REFERENCES tag_rules(id),  -- linked_by='rule'일 때 만든 규칙 → "이 규칙이 연결한 것" 일괄 해제
  PRIMARY KEY (category_id, document_id)
);

-- 풀이 기록
CREATE TABLE attempts (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  category_id INTEGER REFERENCES categories(id),   -- 어느 맥락에서 풀었나
  my_answer   TEXT,
  is_correct  INTEGER NOT NULL,            -- 1/0
  time_spent  INTEGER,                     -- 초
  mode        TEXT,                        -- 'quiz'|'review'|'flashcard'|'study'|'exam'|'applied_exam' (자유 텍스트 — CHECK 제약 없음. 'exam'은 M11 모의고사, 배치 공통 answered_at이 응시 런 키 — §14 F25. 'applied_exam'은 M19/F45 응용 모의고사 — 'exam'과 분리해 이력 상호 불간섭, §4.21 결정 ② · 마이그레이션 0건)
  answered_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 오답노트 (문서당 1개 — 메모는 갱신·누적, 이력은 attempts가 담당)
CREATE TABLE review_notes (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL UNIQUE REFERENCES documents(id),
  note        TEXT,                        -- 내 메모
  wrong_reason TEXT,                       -- '개념부족'|'실수'|'함정'|'시간부족'
  is_resolved INTEGER DEFAULT 0,           -- 극복 여부
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 간격반복 카드 (SM-2)
CREATE TABLE srs_cards (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id),
  ease_factor REAL DEFAULT 2.5,
  interval_days INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  due_date    DATE,
  last_reviewed DATETIME
);

-- 원본 파일
CREATE TABLE sources (
  id          INTEGER PRIMARY KEY,
  filename    TEXT NOT NULL,               -- sources/ 내 상대경로
  file_type   TEXT,                        -- 'pdf'|'md'|'xlsx'|'image'|'txt'|'html'|'xml'|'docx'|'csv' 등 (자유 텍스트 — M16/F42에서 값 종류 확장(csv 포함 확정 2026-07-29), CHECK 제약 없음 · 마이그레이션 0건)
  file_hash   TEXT,                        -- SHA-256 — 같은 원본 파일 재반입 감지 (8.3의 문서 단위 중복 감지와 별개)
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  note        TEXT
);

-- 태그 (정규화 — 검색·자동분류의 기반)
CREATE TABLE tags (
  id          INTEGER PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL         -- '#정규화' → 'normalization' 표기 통일은 UI에서
);
CREATE TABLE document_tags (
  document_id INTEGER NOT NULL REFERENCES documents(id),
  tag_id      INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (document_id, tag_id)
);

-- 태그 자동 분류 규칙: "이 태그 조합이면 이 분류에 연결"
CREATE TABLE tag_rules (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),  -- 연결 대상 분류
  tag_query   TEXT NOT NULL,               -- 예: '정규화' 또는 '데이터베이스 AND 기출'
  mode        TEXT DEFAULT 'suggest',      -- 'suggest'(제안 후 승인) | 'auto'(즉시 연결)
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 태그 규칙 연결 제안함 (F21, M6): 규칙이 만든 "문서→분류 연결" 제안의 저장처
CREATE TABLE suggestions (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  tag_rule_id INTEGER REFERENCES tag_rules(id),   -- 발생 규칙 (규칙 삭제 시 SET NULL)
  status      TEXT DEFAULT 'pending',             -- 'pending'|'approved'|'rejected'
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  decided_at  DATETIME,
  UNIQUE (document_id, category_id)               -- 같은 문서-분류 쌍 제안은 1건 — rejected가 남아 있으면 재제안 안 함(거절 기억)
);

-- 학습 진도: 분류 맥락별 문서 학습 상태
CREATE TABLE study_progress (
  category_id INTEGER NOT NULL REFERENCES categories(id),
  document_id INTEGER NOT NULL REFERENCES documents(id),
  status      TEXT DEFAULT 'not_started',  -- 'not_started'|'in_progress'|'done'
  completed_at DATETIME,
  PRIMARY KEY (category_id, document_id)
);

-- 이어하기 위치: 학습 단위(챕터)별 마지막 위치
CREATE TABLE resume_points (
  category_id INTEGER PRIMARY KEY REFERENCES categories(id),
  document_id INTEGER REFERENCES documents(id),
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 문서 간 관계: 문제↔개념 연결 (S2 "기존 개념문서와 자동 연결 제안", F14 유사 문서 감지의 저장처)
CREATE TABLE document_relations (
  from_document_id INTEGER NOT NULL REFERENCES documents(id),
  to_document_id   INTEGER NOT NULL REFERENCES documents(id),
  relation    TEXT DEFAULT 'explains',     -- 'explains'(개념이 문제를 설명) | 'related' | 'prerequisite' | 'embeds'(M17/F43 — from이 to를 본문에 임베드. 자유 텍스트라 CHECK 없음 · 마이그레이션 0건) | 'derived_from'(M19/F45 — 생성 문항 from이 근거 문서 to에서 파생. 리포트 근거 링크의 출처 — §4.21 결정 ④)
  created_by  TEXT DEFAULT 'manual',       -- 'manual' | 'import'(반입 제안 승인) | 'llm' | 'embed'(M17/F43 — 본문 파싱 동기화. 본문이 단일 출처, 이 행은 파생 인덱스) | 'applied_exam'(M19/F45 — 생성 시 1회 기록)
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (from_document_id, to_document_id, relation)
);

-- 앱 설정 (키-값): 복습 큐 상한, 일일 목표, 백업 주기 등 "설정 가능" 항목의 저장처
-- (테마는 기기별 선호이므로 DB가 아닌 브라우저 localStorage에 저장)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 북마크 (F29)
CREATE TABLE bookmarks (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 노트(베타) — 에디터 v2의 드래프트 격리 저장소 (M33/stage-33, F57. 별지 editor-v2.plan.md §6·D9 · 계약 = 설계 §4.28)
-- documents와 **완전히 분리된 신규 테이블**이다: 새 편집기를 기존 편집기·documents 무접촉으로 완성하기 위한 착지 표면.
-- documents로의 저장 전환(content_blocks 컬럼)은 M34에서 별도 DDL로 판정한다고 예고했었다 → **2026-08-18 stage-35 착수로 판정·등재 완료**(위 documents 3컬럼 · R42 · 설계 §4.29).
CREATE TABLE notes (
  id             INTEGER PRIMARY KEY,
  title          TEXT NOT NULL DEFAULT '',    -- 빈 제목 허용("제목 없음" 표시는 프론트 몫 — 첫 헤딩 자동 추출 같은 추론 금지)
  content_blocks TEXT NOT NULL,               -- 앱 중립 블록 JSON 문자열 {version, blocks} — **소스 오브 트루스**. 스키마 정본 = frontend/src/editor2/schema/blocks.ts (서버는 딥 검증하지 않는다 — 정본 이중화 금지)
  content        TEXT NOT NULL DEFAULT '',    -- Markdown 프로젝션(파생 전용). **서버가 만들지 않는다** — 클라이언트 변환기(M32) 산출물을 함께 저장만(§4.28 ②③). FTS 미색인
  blocks_version INTEGER NOT NULL DEFAULT 1,  -- content_blocks.version의 컬럼 사본. 사유: M34 지연 마이그레이션이 "버전 n 이하"를 SQL로 찾아야 하는데 서버가 JSON을 해석하지 않는 계약과 양립하려면 컬럼이어야 한다
  is_active      INTEGER NOT NULL DEFAULT 1,  -- 소프트 삭제(불변 규칙 3 — 물리 삭제 금지). 복구 엔드포인트는 베타 범위 밖
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_notes_active_updated ON notes(is_active, updated_at DESC);  -- 목록 기본 조회 경로(활성분 최근 수정순)
```

> 추가 구현 노트
> - **FTS5**: 검색(F12)은 `documents(title, content, explanation)` 대상 FTS5 가상 테이블 + 동기화 트리거로 구현 (M6). 별도 검색엔진 불필요. **M9**: 한국어 부분어 recall(M6 검토 이월 — "제3정규형"에서 "정규형" 미매칭)을 위해 `tokenize='trigram'`으로 **재구축**(Alembic: DROP→CREATE+트리거+백필). API 계약 불변, 2자 이하 질의는 LIKE 폴백 — 설계 §4.12. 가상 테이블은 §6.2 DDL 본문이 아닌 파생 인덱스이므로 스키마 변경 아님.
> - **updated_at 갱신**: SQLite는 자동 갱신이 없으므로 앱 레이어(SQLAlchemy `onupdate`)에서 처리.
> - **인덱스**: `attempts(document_id)`, `attempts(answered_at)`, `category_documents(document_id)`, `srs_cards(due_date)` — 대시보드·복습 큐 조회 경로. **`notes(is_active, updated_at DESC)`**(M33 — 노트 목록).
> - **`notes`는 FTS 색인 대상이 아니다**(M33 확정): 검색은 `title`·`content` LIKE로 갈음한다(개인 노트는 건수가 작다 — 설계 §4.28 ④·⑥). 필요가 실측되면 계획서에 먼저 등재한 뒤 색인한다. 백업(F27)은 `study.db` VACUUM INTO라 새 테이블이 **자동 포함**된다(백업 코드 개정 0건).

### 6.3 핵심 설계 원칙
1. **문서는 분류에 소유되지 않는다** — 삭제는 "연결 해제". 고아 문서는 보관함에서 관리.
2. **풀이 기록은 문서+맥락 이중 기록** — 통합 약점 분석과 시험별 통계 둘 다 가능.
3. **소프트 삭제** — `is_active=0`. 학습 기록의 무결성 보존.
4. **원본 불변** — sources/의 원본 파일은 수정하지 않는다. 정리본(문서)만 다듬는다.

## 7. 시스템 아키텍처

```
┌─ 브라우저 (PC/폰/태블릿) ──────────────────────┐
│  SPA 프론트엔드 (React + Vite)                 │
│  - 트리 탐색 / 문서 뷰 / 퀴즈 / 대시보드        │
│  - Chart.js, CSS 애니메이션                    │
└───────────────┬───────────────────────────────┘
                │ REST API (JSON)
┌───────────────▼───────────────────────────────┐
│  FastAPI 백엔드 (Python)                       │
│  - 문서/분류/풀이/복습 API                      │
│  - SM-2 스케줄러, 통계 집계                    │
│  - JSON 반입 검증 (Pydantic)                   │
├───────────────────────────────────────────────┤
│  SQLite (study.db 파일 하나)                   │
│  sources/ (원본 파일 보관)                     │
└───────────────────────────────────────────────┘
     실행: uvicorn main:app --host 0.0.0.0 --port 8000
     접속: PC http://localhost:8000 / 폰 http://192.168.x.x:8000
```

### 기술 스택 선정
| 구분 | 선택 | 이유 |
|------|------|------|
| 백엔드 | Python 3.12 + FastAPI | 데이터 처리·LLM 연동에 강함, 자동 API 문서 |
| DB | SQLite (+FTS5) | 파일 하나, 설치 불필요, 전문검색 내장 |
| ORM | SQLAlchemy 2.x | 표준적, 마이그레이션(Alembic) 지원 |
| 프론트 | React + Vite + TypeScript | 시각효과·상태관리 자유도 최대 |
| 차트 | Chart.js | 가볍고 충분 |
| 스타일 | Tailwind CSS | 반응형(폰 대응) 빠른 구현 |
| 배포 | 로컬 uvicorn (정적 파일 동시 서빙) | 프로세스 1개로 단순화 |

> 대안 검토: 프론트를 React 대신 **서버 렌더링(Jinja2)+htmx**로 하면 더 단순해지나,
> 플래시카드 애니메이션·대시보드 상호작용의 자유도가 떨어짐. 시각효과가 핵심 요구라 React 선택.

## 8. LLM 정리 파이프라인 (반입 규격)

### 8.1 흐름 (1단계: Claude Code 활용)
```
원본 파일 → Claude Code에 변환 요청 → import/*.json 생성
→ 앱 "반입" 화면에서 미리보기·검증 → 승인 → DB 저장 → 분류 연결
```

### 8.2 반입 JSON 규격 (v1.1 — S15 개정 확정 2026-07-28. 파이프라인 계약·대조 알고리즘은 설계 §4.17이 담당)

> **v1.1 개정 요지(F41 변환 신뢰 게이트 — Codex PoC 실측 근거, 전 엔진 공통)**: `answer_source` 필드 추가 + 검증 강화 3건. `format_version`은 **1 유지** — 구조 변경이 아니라 필드 추가·검증 강화이고, 기존 파일 거부가 목적이 아니다. **강제 범위는 경로로 구분한다**: 강화 규칙은 **LLM 변환 파이프라인(convert·fetch 잡) 산출물에만** 강제하고, **사용자가 직접 올린 반입 JSON은 하위 호환**(아래 각 항목의 호환 규칙)을 유지한다.

```json
{
  "format_version": 1,
  "source": { "filename": "2023_2회_기출.pdf", "note": "정보처리기사 필기" },
  "documents": [
    {
      "type": "past_question",
      "title": "2023-2회 17번: 정규화",
      "content": "다음 중 제3정규형의 조건은...",
      "choices": ["이행적 함수 종속 제거", "...", "...", "..."],
      "answer": "1",
      "answer_source": "original",
      "explanation": "3NF는 2NF에서 이행적 함수 종속을 제거...",
      "difficulty": 3,
      "tags": ["데이터베이스", "정규화"],
      "source_detail": "2023년 2회 17번",
      "suggest_categories": ["정보처리기사/필기/데이터베이스"],
      "suggest_relations": ["DOC-0012"]
    }
  ]
}
```

- **`answer_source`(v1.1 신설)**: `"original"`(정답이 원본에 명시됨) `| "solved"`(LLM이 스스로 풀어 채움). 문제 타입(question·past_question)에서 **변환 파이프라인 산출물은 필수**(누락 = 항목 오류 — 프롬프트 `prompts/convert.md`에 지시 추가). **직접 업로드 JSON은 누락 허용 → `original` 간주**(기존 파일 무변경 통과). `solved`는 미리보기에서 경고 배지 + **기본 반입 제외**(항목별 명시 승인 시에만 포함 — R7 강화). DB에는 저장하지 않는다(반입 게이트 신호 — DDL 0건).
- **객관식 `answer`(v1.1 규격 좁힘)**: `choices`가 있으면 **1-base 보기 번호 문자열(`"1"`~`"n"`)만 허용**. `"1"`~`"n"` 범위 숫자 문자열은 항상 번호로 해석(수치형 보기의 번호/텍스트 이중 해석 제거). 직접 업로드의 텍스트 answer는 choices 전체 일치(트림 후) 시 서버가 번호로 정규화해 수용, 불일치 = 항목 오류.

### 8.3 반입 시 검증 규칙
- 필수 필드 검사 (type/title, 문제면 answer 필수. **v1.1**: 개념·문제 타입 `content` 필수 — 변환 파이프라인 산출물에서 누락 = 항목 오류)
- **순수 JSON(v1.1)**: LLM 변환 출력에 코드펜스·전후 잡문이 섞이면 관대한 벗겨내기 없이 `error_info.kind:'invalid_output'` 오류로 처리(설계 §4.11·§4.17)
- **원문 대조(v1.1 — 서버측, LLM 아님)**: 변환 파이프라인 preview 생성 시 문제 문항의 지문·보기가 원본 추출 텍스트에 실재하는지 대조 — 불일치 = `fabrication_suspect` 경고 + 기본 반입 제외, 추출 불가 원본 = "대조 불가" 표시(조용한 통과 금지, 기본 반입은 유지). 정규화·임계·알고리즘은 **설계 §4.17 ⑥이 단일 출처**
- 중복 감지: 제목+내용 해시 비교 → 중복 의심 시 나란히 보여주고 선택 (건너뛰기/새로 추가/기존에 병합)
- `suggest_categories`: 없는 분류면 생성 제안, 있으면 연결 제안 — **자동 실행이 아니라 승인 후 반영**
- `suggest_relations`: 기존 문서 번호(DOC-xxxx)로 문제↔개념 연결 제안 — 승인 시 `document_relations`에 `created_by='import'`로 기록. 존재하지 않는 번호는 경고 후 무시

## 9. 화면 구성 (주요 12개)

| # | 화면 | 핵심 요소 |
|---|------|----------|
| 1 | **홈 대시보드** | **"이어하기" 카드(최우선)**, 오늘의 복습 N개, 학습 히트맵, D-Day 배지(시험 분류 + 임의 D-Day 병합). S7: 위젯 편집 모드(드래그 재배치·숨김·열 수), D-Day 배지 팝업 즉석 편집 |
| 2 | **탐색 (트리+문서목록)** | 좌: 분류 트리(노드별 진도바) / 우: 문서 카드 목록. "N곳에서 사용 중" 배지 |
| 3 | **문서 상세** | 본문(Markdown 렌더), 태그 칩, 사용처 목록, 풀이 이력 미니차트, 편집 |
| 4 | **커리큘럼 뷰** | 시험 선택 시: 과목→챕터 아코디언, 각각 진도바, "여기서 시작/이어하기". 편집 모드로 분류 추가·수정·이동·삭제(M4 — 탐색과 동일 기능, 공용 모달 재사용) |
| 5 | **학습 모드** | 챕터 문서 연속 넘김(이전/다음), 챕터 진행바, 개념→확인문제 인터리브 |
| 6 | **퀴즈 모드** | 문제 카드, 보기 선택, 즉시 채점+해설, 진행바, 종료 후 결과 요약 |
| 7 | **플래시카드** | 카드 뒤집기, 스와이프 판정(안다/모른다), 남은 장수 |
| 8 | **오답노트** | 분류 트리 범위 필터(하위 포함), 분류 계층(대/중/소/하위 단위) 그룹 보기, 틀린이유 태그 필터, 메모 편집, "극복" 처리, 재도전 버튼 |
| 9 | **반입(Import)** | JSON 업로드 → 문서 미리보기 표 → 중복/태그규칙/분류 확인 → 반입 실행 |
| 10 | **인쇄 뷰** | A4 미리보기, 범위 선택(문서/챕터/오답노트), 해설 포함/제외, 인쇄→PDF |
| 11 | **설정** | 테마(라이트/다크/시스템), 복습 큐 상한, D-Day 관리(시험 분류 날짜 + 임의 D-Day), 백업/복원(M6) |
| 12 | **모의고사** (M11) | 과목 구성(시험 노드 직계 자식)·제한 시간·합격선 설정 → 응시(문항 네비게이터·카운트다운 타이머) → 일괄 제출 리포트(과목별 점수·과락·합격) — 퀴즈 문항 렌더 재사용 |

모바일: 하단 탭바(홈/커리큘럼/퀴즈/복습/오답노트 — 복습 탭은 M9, F36-②), 트리는 드로어로 전환.
공통 레이아웃(태블릿·PC): 좌측 사이드바 접힘 토글(F33, S7) — 접으면 아이콘 레일, 상태는 localStorage(기기별).
북마크(F29): 탐색 카드·문서 상세에 별 아이콘, 홈에 "북마크 모아보기" 진입점.

### 9.2 연속 학습 흐름 (핵심 UX)

사용자가 말한 계층 그대로: **자격증 → 필기/실기 → 과목(1~6) → 챕터 → 학습내용(문서들)**.
이 흐름이 "다음에 뭘 할지 고민할 필요 없이" 이어지는 것이 UX의 중심이다.

```
홈 ──▶ [이어하기: 정보처리기사 · 필기 · 2과목 · Ch.3  ▓▓▓▓░░ 7/12]  ← 원클릭 복귀
              │
              ▼
     학습 모드 (챕터 단위 러닝 트랙)
     ┌────────────────────────────────────────────┐
     │  Ch.3 진행바  ▓▓▓▓▓▓▓░░░░░  7/12            │
     │                                            │
     │  [개념] SQL JOIN의 종류        ← 지금 위치   │
     │   ...본문...                                │
     │                                            │
     │  ◀ 이전        다 읽었어요 → 다음 ▶          │
     └────────────────────────────────────────────┘
       개념 → 개념 → 확인문제 2~3개 → 개념 → ... → 챕터 끝
                                                │
                                                ▼
     챕터 완료 화면: 정답률 요약 + 틀린 문제 즉시 복습 제안
              │
              ▼
     [다음 챕터 시작 ▶]  (과목 마지막 챕터면 → 과목 완료 + 다음 과목 제안)
```

**동작 규칙**
- **진도 판정**: 개념 문서는 "다음" 버튼 = 완료 처리(`study_progress.done`). 문제는 풀어야 다음으로.
- **이어하기**: 학습 모드 진입/이탈 시 `resume_points` 갱신 → 홈 카드와 커리큘럼 뷰에 반영.
- **인터리브 배치**: 챕터 내 문서 순서(`sort_order`)는 "개념 몇 개 + 확인문제"가 섞이도록 반입 시 배치. LLM 변환 시 `suggest_categories`와 함께 순서도 제안.
- **진도율 전파**: 챕터 진도 = done 문서 비율 → 과목/시험/자격증으로 집계되어 트리에 진도바 표시.
- **중간 이탈 허용**: 폰으로 3분 공부하다 꺼도, 다음 접속 때 정확히 그 문서에서 재개.

## 10. 간격반복(SM-2) 동작 규칙

- 문제를 풀거나 플래시카드 판정 시 품질점수 q 산출:
  - **회복 정답**: 그 문서의 **직전 시도가 오답**이었으면, 어느 화면(퀴즈/복습/재도전)에서 맞혔든 q=3 — "간신히 회복" 신호. 화면 종류(mode)가 아니라 직전 attempt 결과로 판정한다(경로 무관 일관성).
  - 그 외 정답: 빠름(문항 평균시간 이하) q=5, 느림 q=4. 첫 풀이 정답(직전 시도 없음)도 여기 해당.
  - 오답 q=1
  - 플래시카드 "안다" q=4, "모른다" q=1
  - 근거: q=3은 EF를 −0.14 깎는 신호라 "복습 세션 정답=무조건 q3" 방식은 잘 아는 카드의 EF가 복습할수록 감소하는 역설을 만든다(2026-07 결정).
- SM-2 갱신 (표준 규칙 준수):
  - 오답(q<3): repetitions=0, interval=1일 (EF는 유지)
  - 정답: 1회차 interval=1일 → 2회차 6일 → 3회차부터 interval = 이전 interval × EF
  - EF 갱신: `EF' = EF + (0.1 − (5−q) × (0.08 + (5−q) × 0.02))`, 하한 1.3
- **카드 생성 시점**: 문서를 처음 풀거나 플래시카드로 처음 판정한 순간 자동 생성. 반입 시 일괄 생성하지 않음 — 기출 500문제 반입 즉시 복습 큐가 폭주하는 것을 방지.
- "오늘의 복습" = `due_date <= 오늘`인 카드, 우선순위: 오답노트 미해결 > 기한 초과 오래된 순.
- 상한: 하루 복습 큐 기본 30개 (`settings`에 저장, 변경 가능) — 과부하 방지.

## 11. 태그 자동 분류 설계

### 동작 방식
1. 문서에 태그 부여 (직접 입력 or LLM 변환 시 자동 제안 — `#정규화 #데이터베이스`)
2. 분류 노드에 **태그 규칙** 등록 — 예: `정보처리기사/필기/DB` 노드에 `tag_query: "정규화 OR 트랜잭션"`
3. 트리거 시점: **문서 반입 시** / **태그 변경 시** / **규칙 생성·수정 시(기존 문서 일괄 스캔)**
4. 매칭되면 → `mode='suggest'`: "이 분류에 연결할까요?" 목록에 쌓임 (기본값) / `mode='auto'`: 즉시 연결

### 원칙
- **기본은 제안-승인.** 완전 자동은 오분류가 조용히 쌓이는 위험이 있어, 규칙별로 사용자가 auto를 명시적으로 켠 경우만.
- 자동 연결된 링크는 `category_documents`에 출처 표시(수동/규칙) → 나중에 "이 규칙이 연결한 문서들" 일괄 해제 가능.
- 태그는 정규화 테이블(`tags`)로 관리 → 오타 태그 병합 기능 제공.

## 12. A4 인쇄 / PDF 내보내기 설계

### 방식: 브라우저 인쇄 엔진 활용 (v1)
- 모든 문서 본문은 **A4 폭(210mm) 기준으로 렌더링 최적화** — 이미지 `max-width:100%`, 표 자동 축소, 코드블록 줄바꿈.
- `@media print` CSS + `@page { size: A4; margin: 15mm }` — 화면용 UI(버튼·네비)는 인쇄에서 제거.
- 페이지 나눔 제어: 문제와 보기가 페이지 경계에서 잘리지 않도록 `break-inside: avoid`.
- 사용자는 **인쇄 뷰 → 브라우저 인쇄 → "PDF로 저장"** — 추가 라이브러리 0개로 A4 PDF 확보.

### 인쇄 뷰 3종
| 종류 | 구성 | 옵션 |
|------|------|------|
| 개념 정리본 | 챕터/과목 단위 개념 문서 모음 | 목차 자동 생성, 문서번호 표시 |
| 문제집 | 문제만 앞에, 정답·해설은 뒤에 모아서 | 해설 제외(시험 연습용), 풀이 칸 여백 |
| 오답노트 | 틀린 문제 + 내 메모 + 틀린이유 | 기간/분류 필터 |

### v2 확장 (필요 시)
- 서버 사이드 PDF 생성(WeasyPrint) — 버튼 한 번에 파일 생성, 헤더/푸터(페이지번호·시험명) 정교화.

## 13. Claude Code 연동 방안 (LLM 엔진 선택)

앱이 LLM을 쓰는 방법 비교 (M15에서 D. Codex CLI 추가 — 멀티 벤더 레지스트리, 설계 §4.17):

| | A. 수동 (Claude Code 대화) | B. **claude CLI headless 연동** | C. Claude API 직접 호출 | D. **Codex CLI (ChatGPT 구독)** — M15 |
|---|---|---|---|---|
| 동작 | 사용자가 Claude Code에 "이 PDF 변환해줘" → JSON 반입 | 앱 서버가 `claude -p "변환 프롬프트" --output-format json` 실행 | 앱이 API 키로 Anthropic API 호출 | 앱 서버가 `codex exec --json -o` 실행 (원본은 pypdf 추출 텍스트 삽입 — G2 실증) |
| 비용 | 기존 구독에 포함 | **기존 구독에 포함** | API 별도 과금 | **사용자의 ChatGPT 구독에 포함** (free 플랜도 호출 가능 실측) |
| 구현 난이도 | 0 (규격만 있으면 됨) | 중 (서브프로세스 관리, 타임아웃) | 중 (키 관리, 스트리밍) | 중 (서브프로세스 + 자동 설치·로그인 진단 온보딩) |
| 자동화 수준 | 낮음 — 손이 감 | **높음 — 앱 안 버튼으로 완결** | 높음 | 높음 — 설치~진단까지 앱 마법사로 완결 |
| 제약 | — | PC에 Claude Code 설치 필수 (서버가 로컬이라 가능) | 인터넷 + 키 필요 | ChatGPT 로그인(브라우저 OAuth) 필요 · 변환 원문이 전역 `~/.codex` 로그에 남음(온보딩 고지) · 429 형식 미실측(보수 안내) |

**잠정 결론: A → B 단계적 진행.**
- M2(반입)에서는 A로 시작: 변환 프롬프트 템플릿을 `prompts/convert.md`로 만들어두고 Claude Code에 파일과 함께 전달 → 규격 JSON 생성.
- M6에서 B 구현: 앱 서버가 로컬에서 실행되므로 `claude -p` 서브프로세스 호출이 가능. "파일 업로드 → 변환 → 미리보기 → 반입"이 앱 안에서 완결. API 키 관리 불필요.
- C는 B가 제약에 걸릴 때(예: 다른 PC에서 서버 운영)의 대안으로 보류.

## 14. 개발 로드맵

> 완료 마일스톤의 원문 행·결정 기록·말미 경과 서사는 `docs/04-archive/roadmap-history.md`(M1~M16 = 2026-07-31 이동 · M17~M36 = 2026-08-31 stage-44 이관), 완료 기능 상세 명세(F16·F25·F26·F34~F56 — F35-2 제거 이력·F35-3 실측 확정 포함)는 `docs/04-archive/feature-specs-done.md`에 **원문 그대로** 보존돼 있다. §14에는 압축 표만 잔류(2026-08-31 기준 전 행 완료 — 진행·예정 행 없음). 각 단계의 작업 지시서·완료 경위는 `stage-{n}-*.plan.md`가 단일 출처.
> **M31~M36(문서 작성·편집 재편 → v2.00.0, 2026-08-15 등재)**: 별지 **`docs/01-plan/editor-v2.plan.md`가 정본**(전략·아키텍처 §5·범위 §7·로드맵 §8·리스크 R33~R40·결정 D1~D10)이고, M31 판정 근거는 **`editor-v2.m31-analysis.md`**다. §14에는 **압축 표 행만** 두고 상세는 옮기지 않는다(색인 원칙). 기능 번호(F57~) 부여는 v2.00.0 범위 확정 시점으로 이월.

| 단계 | 내용 요약 | 완료 |
|------|------|------|
| **M1. 뼈대** | DB 스키마 · FastAPI 기본 API · 트리+문서 CRUD · 디자인 토큰/다크 모드(F28) | ✅ |
| **M2. 반입** | JSON 반입 규격·검증·미리보기 · 실기출 1세트 적재 | ✅ |
| **M3. 학습 루프** | 커리큘럼 뷰 · 학습 모드·진도/이어하기 · 퀴즈 · 오답노트 | ✅ |
| **M4. 시각화·인쇄** | 대시보드(차트·히트맵) · F24 연결 표시 · F29 북마크 · A4 인쇄 3종 · D-Day | ✅ |
| **M5. 복습** | SM-2 · 오늘의 복습 큐 · 플래시카드 | ✅ |
| **M6. 자동화·다듬기** | 태그 자동분류 · claude CLI 변환 · F30 오류 신고 · FTS5 검색 · PWA · F27 백업 UI | ✅ |
| **M7. 홈 커스터마이즈·레이아웃 UX** | 홈 위젯 편집 · D-Day 팝업 · 사이드바 접힘(F31~F33) — **v1 완성** | ✅ 2026-07-24 |
| **M8. LLM 인프라** | F34 엔진 관리(이중 엔진·폴백·429 구조화) + F35 1단계(URL 반입) | ✅ 2026-07-25 |
| **M9. 일상 다듬기** | F36 학습 UX 11건 · F37 챕터 파이프라인 · F38 설정 재구성·태그 관리자 | ✅ 2026-07-25 |
| **M10. 콘텐츠·동기** | F35 2단계(사이트 어댑터 — M13에서 제거) + F26 학습 목표·스트릭 | ✅ 2026-07-26 |
| **M11. 시험 직전 도구** | F25 실전 모의고사 + F16 D-Day 복습 강도 조절 — **v1.x 완성** | ✅ 2026-07-26 |
| **M12. 콘텐츠 확장·도움말** | F35 어댑터 3호(cbtbank — M13에서 제거) + F39 매뉴얼 앱 통합 | ✅ 2026-07-26 |
| **M13. 사설 어댑터 제거·수동 반입 UX** | 사설 어댑터 전면 제거(qnet 스텁만 잔존) + F40 수동 반입 UX 4건 | ✅ 2026-07-27 |
| **M14. 큐넷 공식 오픈API** | F35 3단계(qnet 실가동 — 실기 공개문제 한정, 필기·필답형 범위 밖 명시) | ✅ 2026-07-27 |
| **M15. 멀티 벤더 LLM 엔진** | F41 — 엔진 레지스트리 · codex-cli 어댑터 · 변환 신뢰 게이트 · S8 온보딩 | ✅ 2026-07-28 |
| **M16. 다양한 문서 포맷 반입** | F42 — 판별·거부 계층 + docx/xlsx 서버 추출 + `too_large`/`parse_failed` 구조화 | ✅ 2026-07-29 |
| **M17. 문서 상호참조·표현 UX** | F43 — 트랜스클루전(`![[DOC-xxxx]]`)·가리기/접기·이동 버튼·임베드 카드 · 설계 §4.19 — 상세 = 아카이브 + `stage-17-doc-transclusion.plan.md` | ✅ |
| **M18. 해설·정답 보완 플로우** | F44 — 답지·해설지 반입(정본) + LLM 풀이 생성(보조) · 설계 §4.20 — 상세 = 아카이브 + `stage-18-answer-explanation.plan.md` | ✅ |
| **M19. 응용 모의고사** | F45 — 범위 지정 LLM 응용 문항 생성·격리 저장·사후 검토 리포트 · 설계 §4.21 — 상세 = 아카이브 + `stage-19-applied-exam.plan.md` | ✅ |
| **M20. 반입 자기 개선 루프** | F46 — 실패 사례 수집·위험도 3계층 개선 채널·제안함 승인 경유 · 설계 §4.22 — 상세 = 아카이브 + `stage-20-import-self-improve.plan.md` | ✅ |
| **M21. 엔진 운용 제어** | F47 — 엔진별 활성 토글·모델 선택·UI 게이팅·서버 422 방어 · 설계 §4.23 — 상세 = 아카이브 + `stage-21-engine-controls.plan.md` | ✅ |
| **M22. LLM 작업 센터** | F48 — 전역 작업 현황·취소/일시정지·요청 단위 모델·재진입 복원 · 설계 §4.24 — 상세 = 아카이브 + `stage-22-llm-job-center.plan.md` | ✅ |
| **M23. 대용량 원본 LLM 분할 반입** | F49 — 다단계 사용자 개입형 분할(휴리스틱 우선·결정론 절단) · 설계 §4.25 — 상세 = 아카이브 + `stage-23-llm-split-import.plan.md` | ✅ |
| **M24. 응용 모의고사 누적·1회성 모드** | F50 — [누적/1회성] 선택·태그 부여(추가 LLM 호출 0) · 설계 §4.21 S24 개정 — 상세 = 아카이브 + `stage-24-applied-exam-mode.plan.md` | ✅ |
| **M25. 해설·정답 표시 품질** | F51 — 정답 표기 통일·remark-breaks·수식(KaTeX) 렌더 개선 · screens §5.3 — 상세 = 아카이브 + `stage-25-explanation-display.plan.md` | ✅ |
| **M26. 문서 인라인 표현 문법** | F52 — 밑줄·형광펜·글자색·크기·스포일러·콜아웃(remark-directive + 마이크로 문법) — 상세 = 아카이브 + `stage-26-inline-formatting.plan.md` | ✅ 2026-08-10 |
| **M27. 디자인 커스터마이즈 2계층** | F53 — 전역 앱 테마 + 문서별 스타일(`documents.style` DDL 1건) · 설계 §4.26 — 상세 = 아카이브 + `stage-28-doc-style.plan.md` | ✅ 2026-08-13 |
| **M28. 이미지 첨부** | F54 — 업로드 엔드포인트·매직 바이트 검사·해시 파일명·붙여넣기/드래그 · 설계 §4.27 — 상세 = 아카이브 + `stage-29-image-upload.plan.md` | ✅ 2026-08-14 |
| **M29. 편집 가능 미리보기** | F55 — 미리보기 블록 단위 소스 편집(오프셋 구간 치환·무편집 = 1바이트 불변) — 상세 = 아카이브 + `stage-27-editable-preview.plan.md` | ✅ 2026-08-11 |
| **M30. WYSIWYG 편집** | F56 1단계 — 리치 편집 표면(자체 구현·저장 Markdown 불변·신규 의존 0) · screens §5.3 S30 — 상세 = 아카이브 + `stage-30-wysiwyg.plan.md` | ✅ 2026-08-15 |
| **M31. 에디터 v2 — 설계·PoC·집중 분석 게이트** | BlockNote 스파이크 · 게이트 5조건 전건 합격 → D2 확정(BlockNote 0.54.0 정확 고정) — 상세 = 아카이브 + `stage-31-blocknote-analysis.plan.md` + 별지 | ✅ 2026-08-15 |
| **M32. 에디터 v2 — 변환 계층** | 중립 블록 스키마 · mdast↔블록 양방향 변환기 · 왕복 코퍼스 검증 — 상세 = 아카이브 + `stage-32-transform-layer.plan.md` | ✅ 2026-08-16 |
| **M33. 에디터 v2 — 노트(베타) 표면** | `notes` 저장(F57·R41) + 새 편집기 1차(코어·방언·이미지·붙여넣기) · stage-33+34 분할 — 상세 = 아카이브 + `stage-33-notes-surface.plan.md`·`stage-34-notes-dialect.plan.md` | ✅ 2026-08-17 게이트 통과 |
| **M34. 에디터 v2 — documents 탑재·저장 전환** | `content_blocks` 3컬럼 DDL(R42)·지연 마이그레이션·D1 확정(소스 = 블록 JSON) · 설계 §4.29 — 상세 = 아카이브 + `stage-35-documents-blocks.plan.md` | ✅ 2026-08-19 게이트 통과 |
| **M35. 에디터 v2 — Notion UX 마감** | 편집 표면 통합·슬래시·표 정렬·찾기/바꾸기 + 신규 블록(TOC·웹 임베드 §4.30·크롭) · stage-36+37 분할 — 상세 = 아카이브 + `stage-36-surface-unify.plan.md`·`stage-37-custom-blocks.plan.md` | ✅ 2026-08-22 게이트 통과 |
| **M36. 에디터 v2 — 모바일 마감 → v2.00.0** | 모바일·터치 마감 + 캡처 설계 반영 + 프로젝션 손실 목록 정본 + 퇴역 판정 ⓐ — 상세 = 아카이브 + `stage-38-mobile-v2-closeout.plan.md` | ✅ 2026-08-22 — **v2.00.0 발행** |

> **v1.x 후보(로드맵 미배정 — 실수요 확인 후 등재)**: ① 한국어 부분어 검색 recall 개선(FTS5 trigram/토크나이저 검토 — "제3정규형"에서 "정규형" 미매칭), ② 백업 복원 후 서버 재시작 강제 UX(구동 중 커넥션 stale 방지). *(2026-08-14 위치 교정 — 표 마지막 행 끝에 붙어 있던 잉여 셀을 표 밖 주석으로 옮김. 문구 무변경.)* **잔여 등록부 = `backlog.md` §1(2026-09-03 — 후보 추가 시 여기 ③④…와 등록부 1행 동반).**

## 15. 리스크 & 미결 논점 (같이 고민할 것)

> 종결 리스크 24건(R1~R6·R8~R11·R13~R15·R21~R25·R27~R32)의 원문은 `docs/04-archive/risk-history.md`로 이관(2026-08-31 stage-44 — 판정 기준·판정표 = `stage-44-docs-reorg-archive.plan.md` 완료 기록). 아래 표의 해당 행은 색인 1줄만 잔류하며, 현재 유효 리스크(R7·R12·R16~R20·R26·R33~R42)는 원문 잔류.

| # | 논점 | 초안의 잠정 입장 |
|---|------|----------------|
| R1 | *(종결 — 이관)* 문서 고유번호 체계 — 단순 연번(DOC-0001) + 태그 확정·구현 | → `risk-history.md` |
| R2 | *(종결 — 이관)* 이미지 포함 문제 처리 — Markdown 링크 + `sources/images/` 저장 확정·구현 | → `risk-history.md` |
| R3 | *(종결 — 이관)* 플래시카드 타입 — v1 별도 타입 확정 | → `risk-history.md` |
| R4 | *(종결 — 이관)* 문서 버전 관리 — v1 `updated_at`만(이력 테이블 보류 확정) | → `risk-history.md` |
| R5 | *(종결 — 이관)* 백업 전략 — F27 구현으로 종결(VACUUM INTO + sources zip) | → `risk-history.md` |
| R6 | *(종결 — 이관)* 다기기 동시 접속 — SQLite WAL로 충분 판정 | → `risk-history.md` |
| R7 | LLM 변환 품질 관리 — **PoC 실측(2026-07-27): 추출 불가 원본에서 지문·보기 창작, 정답 자체 풀이가 프롬프트 규칙만으로 통제 불가** | 반입 전 미리보기 필수 승인 + source_detail로 원본 대조 가능하게. **M15 기계적 보강(전 엔진 공통, §8.2 v1.1·설계 §4.17)**: ① `answer_source: original\|solved` — LLM이 스스로 푼 정답은 경고 배지 + 기본 반입 제외 ② 서버측 원문 대조(문제 타입 지문·보기가 원본 추출 텍스트에 실재하는지 — 불일치 = `fabrication_suspect` 기본 제외, 추출 불가 원본 = "대조 불가" 명시 표시) ③ 검증 강화(순수 JSON·content 필수·객관식 answer 번호만). G2 재실험(2026-07-28): 깨끗한 원본에서는 창작 0·정답 10/10 실증 — 게이트는 더러운 원본 대비 안전망 |
| R8 | *(종결 — 이관)* 태그 자동분류 — 제안-승인 기본 확정·구현 | → `risk-history.md` |
| R9 | *(종결 — 이관)* LLM 엔진 CLI vs API — CLI 우선 확정(F34·F41로 확장 구현) | → `risk-history.md` |
| R10 | *(종결 — 이관)* 개념 문서 완료 판정 — "다음" 버튼 = 완료 확정 | → `risk-history.md` |
| R11 | *(종결 — 이관)* 필기/실기 성격 차이 — 서술형·자가채점 방식 확정 | → `risk-history.md` |
| R12 | 홈 네트워크 보안 (0.0.0.0 바인딩) | 내부망 전용 원칙 — **공유기 포트포워딩으로 외부 노출 금지** 명시. 최소 PIN 잠금은 M6에서 검토 |
| R13 | *(종결 — 이관)* tag_query 문법 — 단일 태그 + OR만 확정 | → `risk-history.md` |
| R14 | *(종결 — 이관)* 사이트 어댑터 지속성 — F35-2 제거(M13)로 소멸 · 재도입 금지 교훈 보존 | → `risk-history.md` |
| R15 | *(종결 — 이관)* 모의고사 이력 파생 한계 — 리포트 = 제출 응답 정본 확정 | → `risk-history.md` |
| R16 | 정적 파일 서빙의 경로 탈출 — SPA 폴백(`main.py`)이 퍼센트 인코딩된 `..`을 정규화 없이 이어 붙여 `study.db`·백엔드 소스·OS 파일까지 서빙됨 (**2026-07-26 S12 검토 실측 발견**, S1부터 존재하던 결함) | `resolve()` + `is_relative_to(FRONTEND_DIST)` 검사로 dist 밖 경로는 index.html로 회귀시켜 차단(S12에서 수정 완료·회귀 테스트 5건, 수정 전 코드에서 실패함을 역검증). 교훈: R12(내부망 전용)는 노출면을 줄일 뿐 경로 검증을 대신하지 않는다 — **사용자 입력이 파일 경로에 닿는 지점은 전부 정규화 후 루트 종속 검사**(`/images`·`/manual`도 동일 규약) |
| R17 | 큐넷 오픈API(F35 3단계)의 외부 의존 제약 — 쿼터(개발계정 일 1,000건)·`fileUrl` JWT 1시간 만료(에러 941)·스펙 변경/서비스 중단·커버리지 기대치. **[실측 갱신 2026-07-27]** 실호출로 확인: `numOfRows` **최대 50**(초과 시 930 — 스펙 문서 미기재), 목록 304건 중 **메타데이터 전 필드 빈값 43건(14%)** 으로 종목 그룹핑이 깨질 수 있음, 첨부 실제 비대응 포맷은 HWP가 아니라 **ZIP**, 제목 형식 불규칙 + **안내문 게시물 혼입**, 그리고 **필기·필답형 종목 미수록**(품질경영기사 `totalCount 0`) — 즉 **이 API는 사용자의 주 학습 대상을 커버하지 못한다**(→ M14 후순위 결정 근거). **M13 갱신(2026-07-27): 사설 어댑터 제거로 자동 수집 경로가 이 API 하나로 집중** — 오픈API가 중단·개편·키 발급 정책 변경되면 **자동 수집 기능 전체가 멈춘다**(부분 저하가 아니라 전면 정지) | 24h 목록 캐시·1회차 단위 반입으로 쿼터 여유 확보(월 1회 갱신 데이터에 충분), 941은 **상세 조회→다운로드 같은 잡 연속 수행**으로 원천 회피(만료 시 상세 재조회 1회 재시도), 에러코드는 사람 말 매핑(원문 미노출 — F34 원칙). **의존 집중 대응**: ① 자동 수집은 어디까지나 편의 경로이고 **정식 반입 경로는 파일 반입·URL 반입(F35-1)** — 두 경로는 외부 서비스에 의존하지 않으므로 오픈API가 죽어도 앱의 핵심(학습 루프·반입)은 무손상, ② qnet 장애 시 `available:false` + "URL/파일 반입으로 진행" 안내(스텁 동작 복귀 경로가 이미 존재 — 키 미등록 상태와 동일), ③ 사설 어댑터로의 폴백은 **정책상 재도입하지 않는다**(§14 F35-2 제거 이력 — 가용성 목적의 번복 금지). 커버리지 한계(필기 기출 미제공)는 §14 F35-3·어댑터 notice·매뉴얼에 명문화. 스키마는 API 결과에 의존하지 않음(반입 후엔 일반 문서). **④ 실측 반영(M14 착수 조건)**: 페이지 크기 50 고정·메타 빈값 방어·안내문 필터·제목 파싱 표본 테스트를 stage-14 체크리스트·DoD로 고정해 "추측 구현"을 막는다. **⑤ M14 완료 후 잔여(2026-07-27)**: **미검증 1건**(941 재시도 실발생 — convert→미리보기 완주는 S14 검토 라이브 반입으로 확인·해소, F35-3 "검증 상태" 참조)은 다음 실사용에서 확인한다 — 실패해도 폴백(파일 반입)이 살아 있어 학습 루프에는 영향이 없다. **접두어 있는 안내성 게시물이 목록에 남는 한계**는 수용(전부 ZIP 전용 → `unsupported_format` 안내로 귀결). **자동 분류 커버리지가 낮은 것도 수용**(연도만/식별 불가 회차는 폴더를 만들지 않는다 — 회차 창작 금지가 우선) |
| R18 | **변환 산출 JSON의 디스크 보존(F40-①, `import/auto/`)** — 백업(F27) 대상이 아니라 복원 후에는 복구되지 않고, 방치하면 디스크에 쌓인다. 반대로 보존하지 않으면 preview TTL 1시간·서버 재시작만으로 **LLM 비용을 치른 결과가 사라진다**(현행 동작) | **보존을 택하되 관리 비용을 상수로 묶는다** — 최근 **50건**만 유지(초과 시 오래된 것부터 삭제), git·백업 제외를 명시. 손실 시 대가는 "재변환 비용"뿐이다(원본은 sources/에 있고 백업된다 — 자료 자체는 안전). DB로 옮기지 않는 이유: preview는 본질적으로 **임시 상태**이고 테이블화하면 정리·마이그레이션 부담이 영구화된다(§6.2 DDL 0건 원칙 유지). 실사용에서 50건이 부족하거나 복원 후 복구 요구가 생기면 그때 계획서에 먼저 확정 |
| R19 | **문서 파서 의존·추출 품질(F42 B군)** — 서버 파싱 라이브러리 0개 원칙이 처음 깨진다(M16에서 docx/xlsx 파서, M15에서 pypdf 예정). 파서가 못 읽는 변형 파일(암호 걸린 xlsx, 구버전 doc/xls, 손상 파일)과 **추출 품질 저하**(표·수식·이미지 소실 — docx 수식은 OMML이라 텍스트 추출에서 유실됨)가 새 실패 유형이 된다 | **의존은 원칙으로 묶는다**(F42 — 순수 파이썬·오프라인·포맷당 1개·계획서 등재 후 추가). 파서 실패는 mojibake 투입이 아니라 **구조화 오류(`parse_failed`/`unsupported_format`) + 폴백 안내**("PDF로 변환 후 반입" 등 — 조용한 실패 금지, F35-3 관례)로 표출. 구버전 `doc`/`xls`는 지원 목록에서 명시적으로 제외(변환 안내). 추출 품질 한계(수식·복잡 표)는 화면·매뉴얼에 기대치로 명문화하고, 최종 방어선은 기존 그대로 **미리보기 승인(R7)** — 추출이 부실하면 사용자가 반입 전에 본다. M15 원문 대조가 들어오면 추출 텍스트가 대조 기준으로도 쓰이므로 품질 문제가 이중으로 드러난다(조용히 썩지 않음). **[S16 구현 반영 2026-07-29]** 판별·추출 계층(doc_extract) 구현으로 mojibake 조용 투입 경로가 차단되고 파서 실패 = 구조화 오류 + 폴백 안내가 실동작. `parse_failed`도 **원본 sources/ 저장으로 확정**(unsupported와 대칭 — 손상 파일 자료 소실 방지, 설계 §4.18 ④). Opus 검토가 **변형 파일 오탐 2건** 적발 — ① hwpx(zip 컨테이너)가 ZIP 일반 문구로 오안내 ② openpyxl `max_row`가 서식만 남은 빈 행을 세어 행 상한(500) 오탐(서식 부풀림) — 둘 다 수정 지시됨(진척 정본은 stage-16 문서 체크리스트) |
| R20 | **트랜스클루전 참조 무결성·유출면(F43)** — 참조가 본문 자유 텍스트에 살므로: 본문 수정과 `document_relations('embeds')` 인덱스가 어긋날 수 있고, 순환 참조·삭제 대상·깊이 폭주가 렌더를 깨뜨릴 수 있으며, 임베드 해석 API가 새 **정답 유출면**이 될 수 있다(QuizCard가 같은 렌더러를 공유) | **본문이 단일 출처, 인덱스는 파생** — 어긋나면 저장 시 재파싱으로 수렴(전량 재계산 명령 1개 확보 — 인덱스는 언제든 버리고 재생성 가능). 순환 = 방문 집합 검출 + 자리표시자, 깊이 = 상한 고정, 삭제 = 자리표시자(참조가 삭제를 막지 않음 — §6.3 연장). 유출은 **계약 수준 봉인**: 해석 API 응답 스키마에 answer·explanation 필드 자체가 없다(필터링이 아니라 부재 — 불변 규칙 1). 학습 의미론 불변(임베드 열람은 진도·SRS 미갱신 — 이중 기록 방지) |
| R21 | *(종결 — 이관)* LLM 생성 해설 오개념 — F44 대응 구현(기본 제외·수동 승인) | → `risk-history.md` |
| R22 | *(종결 — 이관)* LLM 생성 문항 정답 신뢰 — F45 대응 구현(격리 저장·사후 리포트) | → `risk-history.md` |
| R23 | *(종결 — 이관)* 자기 개선 루프 드리프트 — F46 대응 구현(승인 게이트·자동 반영 금지) | → `risk-history.md` |
| R24 | *(종결 — 이관)* 잡 취소 신뢰성·부분 과금 — F48 정직 표기 계약으로 종결 | → `risk-history.md` |
| R25 | *(종결 — 이관)* 분할 반입 경계 오판·다단 비용 — F49 결정론 절단 계약으로 종결 | → `risk-history.md` |
| R26 | **표현 문법의 신뢰 경계·전 화면 파급(F52)** — ① `documents.content`는 사용자 손편집분과 **LLM 변환 산출물·URL 반입·docx/xlsx 추출 텍스트**를 **같은 컬럼에 담는다**. 표현 문법을 열면 그 문법이 반입 경로로도 들어올 수 있고, 원문 대조 게이트(§4.17 ⑥)는 지문·보기의 *내용*만 검사하지 **마크업은 검사하지 않는다** ② 공용 `MarkdownView` 1곳 확장이 문서 상세·학습·퀴즈·시험·플래시카드·오답노트·**인쇄**에 동시 파급된다(F51 remark-breaks 전례 — 이점이자 리스크) ③ 새 문법 기호가 기존 본문의 평범한 문자(`=`, `+`, `\|`)와 충돌해 **기존 저장 문서의 표시가 조용히 바뀔** 수 있다 | ① **rehype-raw(원시 HTML) 기각 유지**(F43 D2 불번복) + **화이트리스트 문법만**(directive 이름·팔레트 이름·크기 단계가 전부 고정 집합 — 임의 CSS·스크립트가 표현될 문자열 자체가 없다) + **변환 프롬프트는 순수 내용만 유지**(표현 문법은 손편집 전용 — F52 결정 ⑥) ② **표본 확인을 착수 계약에 내장**(F51 DoD 4 전례 — 기존 저장 문서에서 새 기호의 우연 매칭 빈도를 실측하고, 충돌이 실측되면 기호를 바꾸거나 스코프를 좁힌다. "조용한 전면 적용" 금지) + 되돌리기 퇴로(F51 `breaks?` prop 전례 — 플러그인 on/off 1줄) ③ **인쇄는 색 그대로 유지 확정**(2026-08-09 사용자 — `print-color-adjust: exact`, 인쇄 전용 토큰 0개·라이트 팔레트 재사용). 대신 **팔레트 설계에 "7색 전부 검정 글자 대비 확보"를 강제 조건**으로 넣어 흑백 변환 후에도 글자가 읽히게 한다 — 흑백 프린터에서 색 구분이 사라지는 것은 CSS로 고칠 수 없는 물리적 한계라 **수용 + 매뉴얼 명문화**(조용한 실패 금지 원칙: 사용자가 미리 안다) ④ **인라인 스포일러는 채점 경계가 아님**을 매뉴얼·설계에 명시(불변 규칙 1은 서버 계약이 담당 — 렌더 계층은 정답 유출면이 아니다, F51 관례) |
| R27 | *(종결 — 이관)* 디자인 커스터마이즈 복구 경로 — F53 대응 구현 | → `risk-history.md` |
| R28 | *(종결 — 이관)* 블록 스캐너 정합성 — F55 대응 구현(원본 구간 치환만) | → `risk-history.md` |
| R29 | *(종결 — 이관)* WYSIWYG 왕복 직렬화 손실 — S30 대응 구현 · 에디터 v2에서는 R34가 계승 | → `risk-history.md` |
| R30 | *(종결 — 이관)* contentEditable 붙여넣기 정화 — S30 화이트리스트 변환 구현 | → `risk-history.md` |
| R31 | *(종결 — 이관)* 한글 IME·모바일 편집 안정성 — S30 대응 · 에디터 v2에서는 R35가 계승 | → `risk-history.md` |
| R32 | *(종결 — 이관)* 편집기 의존 문법 이중화·번들 비대 — 종결 2026-08-15(원문에 명시) | → `risk-history.md` |
| R33~R40 | **에디터 v2(→ v2.00.0) 신규 리스크 8건** — R33 BlockNote 0.x 브레이킹 · R34 프로젝션 손실 · R35 한글 IME · R36 마이그레이션 손상 · R37 번들·PWA 비대 · R38 편집기 2개 병존 유지비 · R39 웹사이트 임베드 · R40 공개 저장소 라이선스(GPL 의존 금지) | **정본은 별지 `editor-v2.plan.md` §9**(대응·실측 이력 포함). 이 표는 색인 역할이며 별지와 어긋나면 별지가 이긴다. 현재 상태 요약: R35는 M31 실기기 실측 통과(**2차 관문 = M33 노트 실사용 — stage-34 DoD 12로 대기 중**) · R37은 지연 청크로 초기 +0.4KB 실측(stage-33 = **증가 0** · **stage-34 = +0.22 kB**, 한도 5 kB) · **R40은 stage-34에서 첫 신규 의존 1건 통과**(`@blocknote/math-block@0.54.0` — MPL-2.0·전이 GPL 0건 실측, `@blocknote/xl-*`는 optional peerDependency라 미설치) · **R34에 경로 추가(2026-08-16, stage-33)** — 손실은 프로젝션 방향뿐 아니라 **엔진 모델 방향**에도 있다(코어 CommonMark/GFM 7종을 BlockNote 코어가 못 담는다. 소유 배정 = 별지 §5.4 말미 표 · **3건은 사용자 판정 대기, 시한 = stage-35 착수 전**) · R40은 **D10 확정으로 원천 차단**(MPL·MIT·Apache-2.0·BSD만, `@blocknote/xl-*` 영구 금지) |
| R41 | **`notes` 테이블 신설(M33/stage-33) — Stage 1 이후의 스키마 변경**(불변 규칙 6 절차 이행 기록). 사유: 에디터 v2를 **`documents` 무접촉**으로 완성하기 위한 드래프트 격리 저장소가 필요하다(D9). 위험 3가지 — ① `documents`와 **저장소가 둘**이 되어 노트가 검색(FTS)·인쇄·퀴즈·백업 UX에서 빠진 채로 늘어난다 ② 베타 노트에 실사용 데이터가 쌓인 뒤 M34에서 구조를 바꾸면 **두 번째 마이그레이션 대상**이 된다 ③ 삭제 복구 UI가 없어 사용자가 소프트 삭제분을 되살릴 수단이 없다 | ① **병존 상한을 로드맵으로 고정** — notes는 M36(구 편집기 퇴역 판단)까지의 한시 저장소이며, `documents` 정식 전환은 M34 게이트가 판정한다(무기한 병존 금지 — R38과 같은 정신) ② **스키마 진화 대비 = `blocks_version` 컬럼**(JSON 안 `version`의 사본 — 서버가 JSON을 해석하지 않고도 SQL로 대상 조회 가능. §6.2 주석·설계 §4.28 ②) ③ **백업은 자동 포함**(VACUUM INTO — 코드 개정 0), 물리 삭제 코드 0(불변 규칙 3) ④ 복구는 `?include_inactive=1`로 확인 가능하며 휴지통 UI는 실수요 확인 후 계획서 먼저 ⑤ 노트를 정식 기능으로 노출하지 않는다(설정 실험실 카드 1개 — screens §5.16) — 검증 전 데이터 유입을 구조적으로 억제한다 |
| R42 | **`documents` 블록 저장 전환(M34/stage-35) — Stage 1 이후의 스키마 변경**(불변 규칙 6 절차 이행 기록, 2026-08-18). 사유: 에디터 v2 저장 소스 전환(별지 D1)을 위해 `content_blocks`·`explanation_blocks`·`blocks_version` 3컬럼 추가 — 전환 문서는 블록 JSON이 소스 오브 트루스가 되고 `content`·`explanation`은 프로젝션 저장소로 역할 전환(§6.2·설계 §4.29). 위험 3가지 — ① **이중 저장 드리프트**: 서버가 `content`/`explanation`을 직접 쓰는 기존 경로(F30 재생성 [교체]·F44 답지/해설 반입 등)는 블록을 모른다 — 결선 없이는 옛 블록이 다음 편집에서 최신 본문을 되돌린다(조용한 손실) ② 지연 마이그레이션 손상(R36 — 별지 정본) ③ 편집기 2개 병존 장기화(R38·R41) | ① **전환 해제 규약으로 드리프트 원천 차단**(설계 §4.29 ④) — 블록을 동반하지 않는 모든 content/explanation 기록은 **같은 트랜잭션에서 3컬럼 NULL**(프로젝션이 소스로 승격 — 다음 편집 시 지연 전환이 재전환 = 복구 경로. 공용 헬퍼 1곳·경로 전수 목록은 stage-35 완료 기록) ② **일괄 변환 금지·`content` 원본 무수정·기존 행 소급 0**(전부 NULL = 미전환) — 미전환 문서는 구 편집기로 그대로 열린다(퇴로 = M34 게이트 조건) ③ 병존 상한은 M36 퇴역 판단으로 고정(R38) ④ 백업 자동 포함(VACUUM INTO — 코드 개정 0) · FTS는 계속 프로젝션 색인(blocks 미색인) · quiz/session 등 파생 응답에 블록 필드 **부재** 봉인(불변 규칙 1) |

---
> 다음 단계: 상세 설계는 `docs/02-design/study-app.design.md` (API 명세·화면 상세),
> 구현 순서는 `docs/01-plan/stage-1-skeleton.plan.md` ~ `stage-14-qnet-openapi.plan.md` 참조.
> **버전 정의(2026-09-01 개정 — v2.00.1 발행 · stage-45)**: 현재 앱 버전 = **v2.00.1**(문서 체계 재편 — stage-44·45). 버전 단일 출처 = 루트 `VERSION` · bump 규약(핵심/사소)·릴리스 이력 정본 = `docs/03-release/CHANGELOG.md` 머리 · stage별 산출 버전 = `docs/01-plan/stage-index.md`. 아래 구 서술의 "stage-42(가칭 — 퇴역)"는 이후 **stage-43**으로 번호 이월(stage-42는 반입 결함 4건이 차지), "다음 버전 = v2.0.1"은 새 체계의 **v2.00.1(문서 재편)·v2.01.1(stage-43 완료 시)**로 대체됨 — 원문은 경위 보존용으로 잔류.
> **버전 정의(2026-08-22 개정 — v2.00.0 발행)**: 현재 앱 버전 = **v2.00.0** — **문서 작성·편집 재편(M31~M36 · stage 31~38 · F57~F59) 완료 시점의 스냅샷**. 발행일 = 2026-08-22 · 발행 근거 = **M36 게이트 종결(폰 실기기 DoD 8 사용자 확인 치명 0 + 자동 검증 전건 — Claude 위임 판정, 정본 = `stage-38-mobile-v2-closeout.plan.md` 말미)**. 잔여 사용자 결정 = **N-2(구 편집기 퇴역 실행 여부 — 판정은 ⓐ 권고 확정, 확정 시 v2.0.x 후속 stage)**. 이후 작업(캡처 파이프라인·§13 백로그)은 v2.x 계획서를 먼저 확정한 뒤 착수(관례). **← 2026-08-24 개정(사용자 지시 "2.x는 뒤로")**: 위 관례를 **뒤로 미루고** v2.0.x 후속 stage를 이어 간다 — **stage-39**(FB-2 [저장]/[취소] — 구현·검토 종결) → **stage-40**(툴바 정비 — 구현·검토·실측 완료 2026-08-25 · 잔여 DoD 8·머지) → **stage-41**(다단 — 1차 흐름형 머지 PR #74 → 같은 날 사용자 번복 → **2차 고정 열** 구현·검토·실측 완료 2026-08-30 · 잔여 DoD 8·머지) → **stage-42**(가칭 — 구 편집기 퇴역 실행(N-2) + 노트 v2 정식 이식·승격 + 철저 검증). **다음 버전 = v2.0.1** — stage-40·41·42 완료·철저 검증 후 발행 예정(2026-08-24 사용자 · 조건 = 중간에 추가 수정사항 미발견, 발견 시 그 수정이 먼저). stage-42 지시서는 착수 시 생성 · "기존 노트기능" 해석(구 편집기 vs 다른 것)은 사용자 확인 대기 — 정본 = 별지 `editor-v2.plan.md` 머리말.
> 릴리스 이력 정본 = `docs/03-release/CHANGELOG.md`(v2 대 현행) · `docs/03-release/CHANGELOG-v1.md`(v1 대 동결 — 구 버전 정의(v1.90.1) 원문 포함) · 말미 경과 서사 원문(stage 12~30 · 에디터 v2 M31~M36) = `docs/04-archive/roadmap-history.md` (2026-08-31 stage-44 이관).
> 이후 항목은 실사용 피드백을 모아 신규 로드맵을 이 계획서에 먼저 확정한 뒤 착수한다.
