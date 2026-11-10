# Stage 12 — 콘텐츠 확장·도움말 (M12: F35 어댑터 3호 cbtbank · F39 사용자 매뉴얼 통합)

> 상위: `study-app.plan.md` v0.14 §14(M12), F35·F39 명세 · 설계: `../02-design/study-app.design.md` v1.11 **§4.13(갱신)·§4.15(신설)** + §5(공통 레이아웃 도움말 진입점·5.9·5.11)
> 선행: Stage 10 완료(M10 — fetchers/ 인프라: base·registry·comcbt·qnet, FetchClient 스로틀·robots·SSRF, convert `_do_fetch`의 FetchedExam 분기·이미지 저장 — 전부 구현돼 있고 FetchedExam 경로만 실사용 대기) · 포함: **F35 어댑터 3호**(cbtbank.kr — FetchedExam 구조화 추출 경로 첫 실사용, 날짜 자연 키 병합), **F39**(사용자 매뉴얼 읽기 전용 서빙·진입점)
> **스키마(§6.2 DDL) 변경 없음 — Alembic 마이그레이션 0건.** 근거는 계획서 §14 F35(회차=categories 노드·source_detail·sources.note로 충분 — M12 추가 정보(시험 날짜·과목 구분)는 어댑터 dataclass·병합·프롬프트 계층에서만 흐름)·F39(정적 파일 서빙뿐 — 저장·상태 없음) 명세.
> 불변 규칙 재확인: 크롤링 예의 강제 조항(robots 존중 · 사이트별 **최소 2초** 스로틀 · UA `StudyHub-Personal/1.0` · 목록 캐시 24h · **로그인/CAPTCHA 우회 금지** — cbtbank는 기출 열람에 로그인이 불필요함을 실측 확인, 로그인 코드 일절 작성 금지) · 개인 학습 전용·재배포 금지 고지 · 실행 전 예상 LLM 사용량 안내 · `sources/` 원본 불변 · **`docs/manual/` 읽기 전용 — 쓰기·수정 코드 금지**(sources 불변과 동일 정신).

## 목표

자격증 검색에서 **cbtbank.kr 회차를 골라 반입하면 문항·보기·정답·해설·과목·이미지가 구조화된 채로 미리보기에 도달**한다(PDF 우회 없이 — LLM 사용량도 낮게). comcbt와 같은 회차는 시험 날짜로 알아보고 하나로 병합된다.
사용 설명서가 **앱 안 진입점(사이드바·설정)에서 새 탭으로 열리고**, `docs/manual/` 원본을 고치면 새로고침만으로 반영된다.

## 작업 체크리스트

### 1. 백엔드 — cbtbank 어댑터 (F35-2 3호, 설계 §4.13)
- [x] `fetchers/base.py` 확장: `ExamEntry.exam_date?`(`YYYY-MM-DD`) + `FetchedQuestion.subject?`(과목 구분) — 기본값 None, 기존 어댑터·호출부 하위 호환(dataclass 필드 추가만 — DDL 아님)
- [x] `services/fetchers/cbtbank.py` 신설 — id `'cbtbank'`, name "CBT문제은행 (cbtbank.kr)", **priority=2**, notice(개인 학습 전용·재배포 금지). DOM/URL 상수는 모듈 상단 격리(R14 — comcbt 전례). `search_certs`: 자격증 색인(**구현 시 실측 확정** — `sitemap_index.xml` 또는 색인 페이지, 추측 셀렉터 금지) → 24h 캐시(`cbtbank:certmap`), cert_ref = 카테고리 슬러그(공백→하이픈). `list_exams`: `/category/{슬러그}` 회차 링크(라벨 "자격증명 (YYYY-MM-DD)") → `exam_date` + 잠정 날짜형 exam_key. `fetch_exam`: `/exam/{code}` 정적 HTML 파싱 → **FetchedExam**(no·stem·choices 4개·answer·explanation(사이트 해설 원문 그대로)·subject(과목 구분)·images 원본 URL — 다운로드는 기존 `_save_fetch_images`가 담당). 구조 파싱 불가 시 `ParseFailedError`(원문 HTML 미노출)
- [x] 우선순위 갱신: **qnet=1, cbtbank=2, comcbt=3** — `comcbt.py` priority 상수 2→3 수정 + registry 등록·주석 갱신(`fetch/adapters` 응답에 자동 반영 확인)
- [x] `fetch_service` 병합 확장(설계 §4.13 병합 규칙): ① `exam_date` 보유 항목끼리 **날짜 1차 병합**, 없으면 기존 `YYYY-N` 키 병합(하위 호환) ② **대표 exam_key** = 그룹 내 회차 번호 보유 키(`YYYY-N`) 우선, 없으면 날짜형 ③ 채택 = priority 최소, `also_on`·`refs` 계약 불변. `comcbt.py`가 제목의 날짜("YYYY년 MM월 DD일")를 `exam_date`로 채우도록 보강(회차 번호 제공자 역할)
- [x] **키→분류 폴더명 파생 함수 단일화**: `YYYY-N` → "YYYY년 N회", `YYYY-MM-DD` → "YYYY년 M월 D일"(앞자리 0 제거) — `fetch_service._is_imported`와 `convert_service._fetch_category_path`가 **같은 함수를 공유**(불일치 금지)
- [x] `POST /api/fetch/import`에 `exam_key?`(병합 대표 키) 추가 — 서버가 수집 결과(FetchedExam/FetchedFile)의 exam_key를 이 값으로 덮어써 목록 표기·분류 경로·imported 판정 일치. 미지정 시 기존 동작 완전 불변(기존 comcbt·qnet 회귀 없음)
- [x] `convert_service` FetchedExam 경로 보강: `_fetched_exam_to_text`에 `subject` 줄("과목: …") 직렬화 + `_fetch_directives`에 "과목명은 태그로 제안하라" 지시(분류 경로는 회차까지 — 기존 강제 지시 불변). 날짜형 exam_key 경로 지원(`_fetch_category_path` — 위 공유 함수로 교체)
- [x] 병합·키 파생 **단위 테스트**(S10 병합 테스트 전례): comcbt(날짜+회차)↔cbtbank(날짜만) 병합 → 대표 키 `YYYY-N`·채택 cbtbank·also_on comcbt / cbtbank 단독 → 날짜형 키·"YYYY년 M월 D일" 폴더 / 날짜 없는 qnet 항목의 기존 키 병합 회귀 / 우선순위 3단

### 2. 백엔드 — 매뉴얼 서빙 (F39, 설계 §4.15)
- [x] `GET /manual` — `docs/manual/user-manual.html`을 `FileResponse`(`text/html; charset=utf-8`)로 서빙. **main.py 정적 서빙 블록에 직접 등록**(전용 라우터 불요 — 엔드포인트 1개), **SPA catch-all 폴백보다 먼저 매칭**되도록 등록 순서 확인. 파일 없으면 404
- [x] 원본이 단일 출처인지 확인 — 빌드 복사·캐시 사본 없음(파일 수정 → 새로고침만으로 반영), `docs/manual/` 쓰기 코드 0건

### 3. 프론트 — 도움말 진입점 (F39, 설계 §5 공통 레이아웃·§5.11)
- [x] 사이드바 **하단** "도움말" 항목(물음표 아이콘) — `/manual` 새 탭(`target="_blank" rel="noopener"`). 접힘 레일에서 아이콘+`title` 툴팁. 앱 라우트 추가 없음(외부 링크 취급)
- [x] 설정 화면 목차 하단 "사용 설명서 열기" 링크(모바일 아코디언 하단 포함) — 모바일(<768px, 사이드바 없음)의 진입 경로. 7번째 설정 그룹이 아닌 단순 링크(F38 6그룹 불변)

### 4. 프론트 — 반입 화면 (F35, 설계 §5.9)
- [x] 회차 목록의 채택 어댑터 배지·also_on이 cbtbank 포함 3종으로 렌더 — `fetch/adapters`·`fetch/exams` 응답 메타 그대로 사용, **프론트 코드 변경 0이 정상**(어댑터 격리 검증 겸용 — 하드코딩된 어댑터 id 분기가 있으면 제거)
- [x] `fetch/import` 호출에 목록 응답의 `exam_key` 전달(④ 실행 스텝 — §5.9)

## 완료 기준 (DoD)

1. 자격증 검색(예: "품질경영기사")에 cbtbank 결과가 병합돼 나오고, 회차 목록에 채택 어댑터 배지가 표시된다
2. cbtbank 회차 반입 → **FetchedExam 경로**로 convert 완료 → 미리보기에 문항·보기·정답·해설이 구조화돼 도달하고, 과목명이 태그 제안에, 그림 문제 이미지가 `sources/images/` 저장 + 본문 Markdown 링크로 반영된다(FetchedExam·이미지 분기 첫 실사용 스모크)
3. 같은 시험 날짜 회차가 comcbt·cbtbank 양쪽에 있으면 **cbtbank 채택 + comcbt는 also_on** + 대표 키는 comcbt의 `YYYY-N` — 반입 시 분류 경로가 "…/YYYY년 N회"로 생성된다
4. cbtbank 단독 회차(회차 번호 미상)는 "…/YYYY년 M월 D일" 경로로 생성되고, 재방문 시 해당 회차에 "이미 반입됨" 배지가 표시된다(폴더명 파생 함수 공유 검증)
5. 수집 로그에서 요청 간격 2초·robots 확인·병렬 없음이 확인된다. cbtbank 로그인 관련 코드 0건
6. `GET /manual`이 브라우저에서 열리고(PC·폰), `docs/manual/user-manual.html` 수정 → **서버 재시작 없이 새로고침만으로 반영**. 존재하지 않으면 404. SPA 라우트(`/manual` 직접 입력)가 매뉴얼을 가리지 않는다
7. 사이드바 하단(펼침·접힘 레일 모두)과 설정 링크에서 매뉴얼이 **새 탭**으로 열린다 — 모바일은 설정 경유로 도달 가능
8. 기존 경로 회귀 없음: comcbt·qnet 회차 반입, URL 반입(F35-1), `exam_key` 미지정 `fetch/import` 호출이 기존과 완전 동일(병합 단위 테스트 + 스모크)
9. §6.2 DDL diff 0 · Alembic 마이그레이션 0건 · `docs/manual/`·`sources/` 원본 파일 변경 0건

## 이 단계에서 하지 않는 것

**어댑터 4호 이상**(실수요 확인 후 — F35 원칙), **qnet 목록 스텁 채우기**(별건 — 포털 구조 실측 확정 시 qnet.py만 수정, R14),
**cbtbank AI 해설 재가공·신뢰도 평가**(해설은 원문 그대로 LLM 정리 경로에 투입 — 기존 검수·미리보기 승인·F30 신고로 충분),
**과목 하위 분류 자동 생성**(분류 경로는 회차까지 — 기존 계약 불변. 과목 노드 자동 생성→F25 모의고사 과목 구성 연계는 실수요 확인 후 v1.x+ 후보로 계획서에 기록만),
**실기 회차 지원**(cbtbank 필기 실측 기준 — level_hint 확장은 실기 페이지 실측 후), **회차 일괄(배치) 반입**(한 번에 1회차 유지), cbtbank **로그인 기능 사용**(기출 열람에 불필요 — 우회 금지 원칙),
F39: **매뉴얼 in-app 렌더러·iframe 임베드·검색·목차 앱 통합**(자기완결 HTML — 새 탭으로 충분), **앱 수동 테마와 매뉴얼 테마 동기화**(시스템 테마 추종 한계 명문화 — §4.15), 매뉴얼 자동 생성·앱 내 편집, 모바일 하단 탭바 도움말 탭(탭 5개 유지).

## 리스크

| # | 리스크 | 대응 |
|---|---|---|
| 1 | cbtbank DOM·URL 구조 변경으로 어댑터 파손 (계획서 **R14**) | 모듈 격리(cbtbank.py 상단 상수만 수정)·`parse_failed` 구조화 오류 + URL 반입(F35-1)·대안 어댑터(comcbt) 폴백 상시 유지 |
| 2 | 날짜 자연 키 병합 오판(같은 날짜에 다른 회차) | 병합은 자격증(sources) 단위 안에서만 — 같은 종목이 같은 날 두 회차를 치르지 않음(국가기술자격 일정 관례). 오판해도 `refs`·명시적 대안 재시도로 복구 가능, 저장 구조에는 영향 없음(반입 후엔 일반 문서) |
| 3 | cbtbank 정답·해설이 비공식(오류 가능) | 기존 방어선 그대로 — LLM 정리 검수 + 미리보기 필수 승인(R7) + 반입 후 F30 신고·재생성. 정본 필요 시 큐넷 우선순위가 이미 위 |
| 4 | exam_key 이중 형식(`YYYY-N`/`YYYY-MM-DD`)이 파생 지점마다 어긋남 | 키→폴더명 파생 함수 **단일 공유 강제**(체크리스트 1-5) + DoD 3·4로 검증. `fetch/import`의 `exam_key?` 덮어쓰기로 목록·경로·imported 일치 |
| 5 | `/manual`이 SPA catch-all 폴백에 삼켜지거나, 반대로 API 경로와 충돌 | main.py 등록 순서 명시(체크리스트 2-1) + DoD 6. `/api` 밖 단일 GET 경로라 충돌면 없음 |
| 6 | FetchedExam·이미지 분기가 첫 실사용(그간 미검증 코드) | DoD 2를 실회차 스모크로 강제 — 실패 시 comcbt PDF 경로가 폴백으로 살아있음(품질 저하일 뿐 기능 상실 아님) |

---
> M12 완료 시 콘텐츠 확장·도움말 종료 — 이후 항목(어댑터 4호·과목 분류 연계 등)은 실사용 피드백으로 계획서에 먼저 확정한다.
