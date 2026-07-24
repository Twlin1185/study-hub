# Study Hub — 종합 학습 관리 시스템 기획/설계 초안

> 상태: **확정 준비 (Draft v0.9)** — v0.8 대비: v1.x 기능 명세 확장 — F34에 잡 진행 가시화, F36 ⑪ 공용 Stepper, **F37 챕터 파이프라인**(개념→문제→기출·임의 깊이·커리큘럼 내 문서 편집·3대 공용 모듈), **F38 설정 재구성·태그 관리자** 신설, §5에 v1.x 기능 목록 추가. (v0.8: v1 완성 후 로드맵 M8~M11 확정 — 시험 일정 무관 순차, 첫 착수 M8.) 스키마 변경 없음
> 작성일: 2026-07-22 · 갱신: 2026-07-24
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
| F16 | 시험 D-Day 모드 | 남은 기간 기반 **복습 강도 조절** (D-Day 등록·홈 위젯·관리 UI 자체는 S4에서 완성 — 여기 남는 것은 강도 조절뿐) |
| F17 | 통계 내보내기 | 학습 기록 CSV/이미지 내보내기 |
| F18 | PWA 설치 | 폰 홈 화면에 앱처럼 설치 |
| F23 | Claude Code 연동 변환 | 앱이 claude CLI(headless)를 호출해 파일→문서 JSON 변환 자동화 |
| F25 | 실전 모의고사 모드 | 회차/범위 선택 → 시간제한 타이머 → 일괄 제출 채점 → 과목별 점수·합격선(과락) 비교. 퀴즈 모드 화면 재사용 |
| F26 | 학습 목표·스트릭 | 일일 목표(문제 수/시간) 설정, 연속 학습일(스트릭) 표시 — 히트맵·홈 카드와 연동 |
| F27 | 백업/복원 UI | study.db+sources/ 스냅샷 생성·복원 버튼, 주기 자동 백업 옵션 (R5의 기능화) |
| F30 | 문제 오류 신고·재생성 | 문제 화면에서 오류 신고(사유 입력) → claude CLI로 해당 문서만 재생성 → 기존/신규 나란히 미리보기 → 승인 시 교체. 엔진은 R9(CLI), 잡 인프라는 F23 재사용, R7 원칙(미리보기 필수 승인 — 자동 덮어쓰기 금지) 준수 |

### v1 마무리 — 홈 커스터마이즈·레이아웃 UX (S7, 순수 프론트 — 사용자 확정)
| ID | 기능 | 설명 |
|----|------|------|
| F31 | 홈 위젯 레이아웃 커스터마이즈 | 편집 모드에서 위젯 드래그 재배치·숨김 토글·열 수 선택(자동/1/2/3, 넓은 화면 다열 배치). 저장 = `settings:home.layout` JSON — **DDL 변경 없음**, 드래그는 포인터 이벤트 직접 구현(외부 라이브러리 없음) |
| F32 | D-Day 홈 즉석 편집 | 홈 D-Day 위젯에서 팝업으로 추가·수정·삭제 — 설정 화면까지 가지 않음. 설정의 D-Day 관리(DDayManager) 로직·모달 재사용, 새 API 없음 |
| F33 | 사이드바 접힘 토글 | 태블릿·PC에서 좌측 메뉴를 아이콘 레일로 접어 콘텐츠 영역 확보. 상태는 localStorage(기기별 UI 선호 — theme 관례, 서버 settings 아님) |

### v1.x — 실사용 개선 (M8~M11, 상세 명세는 §14 로드맵 아래)
| ID | 기능 | 단계 |
|----|------|------|
| F34 | LLM 엔진 관리 — 이중 엔진(CLI+API)·우선순위·폴백·429 구조화·한도 기억·잡 진행 가시화 | M8 |
| F35 | 기출 소스 커넥터 — 1단계 URL 반입, 2단계 사이트 어댑터 | M8(1단계)·M10(2단계) |
| F36 | 학습 UX 다듬기 11건 — 데일리 세션·복습 탭·퀴즈 단축키·틀린이유 원탭·공용 Stepper 등 | M9 |
| F37 | 챕터 학습 파이프라인 — 개념→문제→기출 연결, 임의 깊이 트리, 커리큘럼 내 문서 작성·수정, 문서 3대 공용 모듈 | M9 |
| F38 | 설정 재구성(6그룹) · 태그 관리자(오타 감지·일괄 병합) | M9(골격은 M8 선반영) |

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
  content     TEXT,                        -- 본문/문제 지문 (Markdown)
  choices     TEXT,                        -- 객관식 보기 (JSON 배열, 선택)
  answer      TEXT,                        -- 정답
  explanation TEXT,                        -- 해설 (Markdown)
  difficulty  INTEGER,                     -- 1~5 (선택)
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
  linked_by   TEXT DEFAULT 'manual',       -- 'manual'|'import'|'rule' — 연결 출처 (M6, §11 원칙)
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
  mode        TEXT,                        -- 'quiz'|'review'|'flashcard'
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
  file_type   TEXT,                        -- 'pdf'|'md'|'xlsx'|'image'
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
  relation    TEXT DEFAULT 'explains',     -- 'explains'(개념이 문제를 설명) | 'related' | 'prerequisite'
  created_by  TEXT DEFAULT 'manual',       -- 'manual' | 'import'(반입 제안 승인) | 'llm'
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
```

> 추가 구현 노트
> - **FTS5**: 검색(F12)은 `documents(title, content, explanation)` 대상 FTS5 가상 테이블 + 동기화 트리거로 구현 (M6). 별도 검색엔진 불필요.
> - **updated_at 갱신**: SQLite는 자동 갱신이 없으므로 앱 레이어(SQLAlchemy `onupdate`)에서 처리.
> - **인덱스**: `attempts(document_id)`, `attempts(answered_at)`, `category_documents(document_id)`, `srs_cards(due_date)` — 대시보드·복습 큐 조회 경로.

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

### 8.2 반입 JSON 규격 (v1)
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

### 8.3 반입 시 검증 규칙
- 필수 필드 검사 (type/title, 문제면 answer 필수)
- 중복 감지: 제목+내용 해시 비교 → 중복 의심 시 나란히 보여주고 선택 (건너뛰기/새로 추가/기존에 병합)
- `suggest_categories`: 없는 분류면 생성 제안, 있으면 연결 제안 — **자동 실행이 아니라 승인 후 반영**
- `suggest_relations`: 기존 문서 번호(DOC-xxxx)로 문제↔개념 연결 제안 — 승인 시 `document_relations`에 `created_by='import'`로 기록. 존재하지 않는 번호는 경고 후 무시

## 9. 화면 구성 (주요 11개)

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

모바일: 하단 탭바(홈/커리큘럼/퀴즈/오답노트), 트리는 드로어로 전환.
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

앱이 LLM을 쓰는 방법 3가지를 비교:

| | A. 수동 (Claude Code 대화) | B. **claude CLI headless 연동** | C. Claude API 직접 호출 |
|---|---|---|---|
| 동작 | 사용자가 Claude Code에 "이 PDF 변환해줘" → JSON 반입 | 앱 서버가 `claude -p "변환 프롬프트" --output-format json` 실행 | 앱이 API 키로 Anthropic API 호출 |
| 비용 | 기존 구독에 포함 | **기존 구독에 포함** | API 별도 과금 |
| 구현 난이도 | 0 (규격만 있으면 됨) | 중 (서브프로세스 관리, 타임아웃) | 중 (키 관리, 스트리밍) |
| 자동화 수준 | 낮음 — 손이 감 | **높음 — 앱 안 버튼으로 완결** | 높음 |
| 제약 | — | PC에 Claude Code 설치 필수 (서버가 로컬이라 가능) | 인터넷 + 키 필요 |

**잠정 결론: A → B 단계적 진행.**
- M2(반입)에서는 A로 시작: 변환 프롬프트 템플릿을 `prompts/convert.md`로 만들어두고 Claude Code에 파일과 함께 전달 → 규격 JSON 생성.
- M6에서 B 구현: 앱 서버가 로컬에서 실행되므로 `claude -p` 서브프로세스 호출이 가능. "파일 업로드 → 변환 → 미리보기 → 반입"이 앱 안에서 완결. API 키 관리 불필요.
- C는 B가 제약에 걸릴 때(예: 다른 PC에서 서버 운영)의 대안으로 보류.

## 14. 개발 로드맵

| 단계 | 내용 | 완료 기준 |
|------|------|----------|
| **M1. 뼈대** | DB 스키마, FastAPI 기본 API, 트리+문서 CRUD 화면, 디자인 토큰+다크 모드(F28) | 문서를 만들고 두 시험에 연결 가능 |
| **M2. 반입** | JSON 반입 규격+검증+미리보기, 실제 기출 1세트 반입 | 실데이터 100문제 이상 적재 |
| **M3. 학습 루프** | 커리큘럼 뷰+학습 모드+진도/이어하기, 퀴즈, 오답노트 | 폰으로 "이어하기"→학습→오답노트까지 끊김 없이 |
| **M4. 시각화·인쇄** | 대시보드(차트·히트맵), 문서 사용처·문제↔개념 연결 표시(F24), 북마크(F29), A4 인쇄 뷰 3종, D-Day 관리(시험 분류+임의), 오답노트 분류 계층 그룹 | 약점이 한눈에 보이고, 문제집 PDF 출력 가능 |
| **M5. 복습** | SM-2, 오늘의 복습 큐, 플래시카드 | 매일 복습 루틴 동작 |
| **M6. 자동화·다듬기** | 태그 자동분류, claude CLI 연동 변환, 문제 오류 신고·재생성(F30), 검색(FTS5), PWA, 백업/복원 UI(F27) | 반입~분류가 앱 안에서 완결 |
| **M7. 홈 커스터마이즈·레이아웃 UX** | 홈 위젯 편집 모드(드래그 재배치·숨김·열 수), D-Day 홈 팝업 편집, 사이드바 접힘(F31~F33) — **순수 프론트, 새 API·DDL 없음**(settings 재사용) | 내 위젯 배치가 저장돼 어느 기기에서든 재현 — **v1 완성** ✅ 2026-07-24 |
| **M8. LLM 인프라** (v1.x 착수) | F34 LLM 엔진 관리(이중 엔진·우선순위·폴백·429 구조화·한도 기억) + F35 1단계(URL 반입) | 한도·오류가 사람 말로 보이고, API 폴백·URL 반입으로 변환이 끊기지 않음 |
| **M9. 일상 다듬기** | F36 학습 UX 10건 + **F37 챕터 파이프라인(개념→문제→기출)** + **F38 설정 재구성·태그 관리자** + 검색 한국어 recall(trigram) + 복원 후 재시작 UX | 앱 열기→공부 시작이 원탭, 챕터가 한 흐름으로 완주, 태그가 통제됨 |
| **M10. 콘텐츠·동기** | F35 2단계(사이트 어댑터) + F26 학습 목표·스트릭(F36-③ 연계) | 자격증 선택→회차 자동 반입, 스트릭이 히트맵·홈과 연동 |
| **M11. 시험 직전 도구** | F25 실전 모의고사 + F16 D-Day 복습 강도 조절 | 실제 시험 형식 모의 응시·리포트 |

> v1.x는 위 로드맵 M8~M11로 확정 (2026-07-24, 시험 일정 무관 순차 진행 — 사용자 확정). 아래는 각 기능의 상세 명세. F15(문서 분기)는 실수요 확인 전 보류.
> M6 검토에서 기록된 v1.x 개선 후보 2건: ① 한국어 부분어 검색 recall 개선(FTS5 trigram/토크나이저 검토 — "제3정규형"에서 "정규형" 미매칭), ② 백업 복원 후 서버 재시작 강제 UX(구동 중 커넥션 stale 방지).
>
> **F34 LLM 엔진 관리** (v1.x 확정 후보 — 2026-07-24 실사용 429 경험으로 범위 확정. **이중 엔진 + 우선순위 + 폴백** 구조, 사용자 확정):
> 1. **엔진 2종 등록**(설정 화면, 카드 2개):
>    - **CLI 카드**: 설치·로그인·호출 가능 진단 + 마지막 성공/실패 시각 + 한도 상태. 로그인은 앱이 대행 불가(대화형 브라우저 절차) — "터미널에서 `claude` 실행해 로그인" 단계 안내 + [다시 확인] 재검사 버튼의 안내형 마법사.
>    - **API 카드**: 키 등록 UI(입력 시 즉석 연결 테스트, 이후 마지막 4자리만 마스킹 표시, write-only). **키 저장은 settings/DB 금지** — 루트 별도 로컬 파일(예: `secrets.json`, .gitignore + 백업(F27) 제외 대상)에 저장해 백업·git으로 키가 복제되는 것을 원천 차단. 환경변수/`ant auth login` 프로필이 있으면 그것을 우선 인식(키 파일 불필요).
> 2. **우선 엔진 선택**(CLI↔API) + **폴백 정책**: 우선 엔진이 한도 초과·타임아웃이면 보조 엔진 시도 — 방식은 **자동**(API 과금 발생 안내에 명시 동의한 경우만) / **물어보기**(기본값 — "API로 계속할까요?" 확인창) / **끔**(A방식 수동 반입 안내). API는 건별 과금이므로 조용한 자동 폴백 금지.
> 3. **오류 구조화** — convert/regenerate 잡 실패 시 CLI/API 응답(`api_error_status`·`result` 등)을 백엔드가 파싱해 **사람이 읽는 메시지로 분류 표출** (원문 JSON 노출 금지): ① **사용량 한도(429)** — 한도 종류(세션/일일/주간/특정 모델/전체)와 **리셋 시각** (예: "Claude 구독 세션 한도 초과 — 오늘 21:40 리셋 후 재시도"), ② 인증 만료/재로그인, ③ CLI 미설치/키 미등록, ④ 타임아웃, ⑤ 기타. 유형별 다음 행동 안내.
> 4. **한도 상태 기억**: 최근 429의 한도 종류·리셋 시각을 서버가 기억해 카드에 표시하고, 리셋 전 변환 시도 시 실행 전에 미리 경고 + 폴백 정책 적용(불필요한 실패 호출 방지).
>
> **F35 기출 소스 커넥터** (v1.x 후보 — 2026-07-24 사용자 제안: 문제은행 사이트에서 긁어와 LLM 후처리로 자격증 대분류·회차까지 자동 반입):
> - 기존 파이프라인 재사용이 원칙 — 신규는 **수집기(fetcher)** 뿐: 수집 → convert 잡 큐(LLM 정리) → 미리보기·중복 감지 → 분류 제안(회차 트리 자동 생성) → 승인 반입. F30(오류 신고)·F34(엔진 한도)와 연동.
> - **1단계 (URL 반입)**: 공개 기출 PDF/페이지 URL 입력 → 서버가 다운로드 → convert 투입. 어댑터 불요, 공단 공개 자료(큐넷 등) 우선 경로.
> - **2단계 (사이트 어댑터)**: 문제은행 사이트 1곳부터 — 자격증·회차 선택 UI → 스크랩 → 문제/보기/정답/해설 구조 추출 → "정보처리기사/필기/2023-2회" 형태 분류 자동 생성. 그림 문제는 이미지를 sources/에 저장해 본문 삽입. 어댑터는 사이트별 모듈로 분리(DOM 변경 시 해당 모듈만 수정).
> - **원칙**: 개인 학습 전용·재배포 금지·요청 간격 제한(예의 있는 크롤링, robots 존중). 로그인/CAPTCHA 필요 사이트는 범위 외. 실행 전 예상 LLM 사용량(문항 수 기준) 안내.
>
> **F36 학습 UX 다듬기** (v1.x 후보 — 2026-07-24 전체 채택. "기능 완비 후, 매일 공부하게 만드는 마찰 제거" 관점 10건):
> - **A. 시작 마찰 제거**: ① 원탭 데일리 세션 — 홈 [오늘 공부 시작] CTA: 복습 큐 소화 → 이어하기 지점 자동 연결, 분량 예고("복습 12 + 3-2장, 예상 25분") ② 폰 하단 탭바에 "복습" 탭 추가(현재 홈 경유 필수) ③ 복습 완료 화면에 내일 예정 개수 예고(F26 스트릭과 연계)
> - **B. 풀이·학습 속도**: ④ 퀴즈 키보드 단축키(1~4 보기·Enter 다음·B 북마크) ⑤ 오답 직후 해설 화면에서 틀린이유 원탭 기록(개념부족/실수/함정/시간부족 — 기억이 생생할 때) ⑥ 정답 시 1.5초 자동 다음 진행(설정 토글, 오답은 항상 정지) ⑦ 학습 모드 집중 모드(사이드바·헤더 숨김 전체화면 토글)
> - **C. 폰 완성도**: ⑧ 플래시카드 판정 undo 1회(오조작으로 인한 SM-2 오염 방지) ⑨ 본문 글자 크기 설정 3단계 ⑩ 문서 상세 SRS 표기를 사람 말로("3일 후 복습 예정" — EF/interval 용어 숨김)
> - **D. 어포던스**: ⑪ **공용 Stepper 컴포넌트** (2026-07-24 사용자 지적: 반입 ①②③이 눌릴 것처럼 생겼는데 안 눌림) — 지나온 단계(✓)는 **실제 클릭으로 되돌아가기**(파괴적이면 확인 후), 현재(●)는 강조 상태 표시, 미래(○)는 흐림+비클릭이 명확한 스타일·점선 연결. 반입 위저드에 우선 적용, F37 챕터 파이프라인(개념→문제→기출) 3단 표시에도 재사용.
> - 우선순위: ①②⑤가 체질 개선, ④⑥⑧⑩⑪은 quick win 묶음.
>
> **F37 챕터 학습 파이프라인 — 개념→문제→기출 연결** (M9 — 2026-07-24 사용자 확정: "커리큘럼을 통해 개념학습–문제풀이–기출풀이가 자연스럽게 연결"):
> - 데이터는 기존 문서 타입(concept/question/past_question/flashcard) 그대로 — **DDL 없음, 동선·표시만**.
> - **챕터 3단계 여정**: ① 개념 학습(기존 순차 흐름 — 개념+확인문제 인터리브 유지) → 개념 트랙 완료 화면에 **[문제 풀이로 이어가기]** → ② 챕터 연습문제 퀴즈 → 결과 요약에 **[기출로 마무리]** → ③ 챕터 기출 퀴즈 → **챕터 최종 완료 화면**(단계별 정답률 요약 + 틀린 문제 재도전 + [다음 챕터 ▶]). 각 단계 건너뛰기 가능, 이어하기(resume)는 단계 위치까지 기억.
> - **임의 깊이 트리 대응(사용자 확정)**: "챕터"는 고정 계층이 아니다 — 품질경영기사/필기/실험계획법/요인배치법/… 처럼 하위가 계속 나뉠 수 있으므로, **어느 깊이의 노드든 파이프라인 단위가 될 수 있다**. 모든 집계(개수 칩·3단 진도)와 [학습]·[문제]·[기출] 범위는 **해당 노드 + 하위 트리 전체**(§4.6 deep 원칙) — 상위 노드에서 누르면 하위 전부 포함, 하위 노드에서 누르면 그 범위만. 아코디언도 임의 깊이 중첩 렌더.
> - 커리큘럼 상세(설계 §5.4): 노드 행에 **3단 진도 표시**(개념 ✓ · 문제 ✓ · 기출 —)와 타입별 개수 칩(개념 N·문제 N·기출 N), 단계별 직접 진입 버튼([학습]·[문제]·[기출] — 순서 강제 아님, 여정은 권장 동선). 노드 펼침 시 타입별 탭 목록(학습내용/문제/기출).
> - **커리큘럼 내 문서 작성·수정(사용자 확정)**: 타입별 탭에 **[+ 문서 추가]**(현재 탭 타입이 기본값, 해당 분류 자동 연결 — 탐색 §5.2의 문서 생성 모달 재사용) + 각 문서 행에서 **편집 진입**(문서 상세 §5.3 편집 모드 재사용). Stage 4의 "분류 편집도 커리큘럼에서" 원칙을 문서까지 확장. **새 API 없음**(documents POST/PATCH + 링크 재사용).
> - 백엔드: `quiz/session`에 `types` 필터 파라미터(채점 규칙·트랜잭션 불변), study-track/진도 API에 **하위 포함 타입별 집계·단계 완료 상태** 추가(기존 study_progress로 산출 — DDL 없음).
> - **구현 원칙 — 문서 3대 공용 모듈(사용자 확정)**: **DocViewer**(Markdown+문제 정답 가림)·**DocEditor**(작성/수정 폼)·**QuizCard**(풀이+채점+해설)를 화면 독립 공용 모듈로 유지·완성한다. 퀴즈카드·뷰어는 이미 공용(퀴즈/학습/복습/재도전에서 재사용 중), **DocEditor가 남은 조각** — 현재 문서 상세 페이지 전용인 편집을 모달/패널 모듈로 분리해 커리큘럼·탐색·검색 결과·오답노트·홈(북마크) 어디서든 "그 자리에서 보고·풀고·수정"이 되게 한다.
>
> **F38 설정 재구성 · 태그 관리자** (M9 — 2026-07-24 사용자 제안: "설정에 기능이 혼재, 태그 관리가 너무 어려움"):
> - **설정 카테고리화**: 6개 그룹 — 학습(복습 상한·기본 문항 수·F36 글자 크기·자동 다음) / 일정(D-Day) / 태그·분류(태그 관리자·태그 규칙) / LLM 엔진(S8) / 데이터(백업·복원·CSV) / 화면(테마). 좌측 목차(카테고리 점프), 모바일은 아코디언. **골격(카테고리 내비)은 M8에서 LLM 섹션 신설과 함께 선반영**(두 번 작업 방지), 그룹 재배치 완성은 M9.
> - **태그 관리자** (병합 "도구"→관리 "화면"으로 승격): ① 태그 목록 테이블(이름·사용 문서 수·규칙 사용 배지, 검색·정렬) ② **오타 후보 자동 감지** — 공백/대소문자/편집거리 1 이내 유사 태그 쌍을 계산해 "『정규화』↔『정규 화』 병합?" 제안 목록 ③ 행 액션: 이름 변경(전 문서 일괄 반영)·병합(기존 merge 재사용)·삭제(미사용만)·클릭 시 사용 문서 보기(탐색 필터 링크) ④ 백엔드: `PATCH /api/tags/{id}`(rename) + 유사 후보 산출 — **DDL 없음**.

## 15. 리스크 & 미결 논점 (같이 고민할 것)

| # | 논점 | 초안의 잠정 입장 |
|---|------|----------------|
| R1 | 문서 고유번호 체계 — 단순 연번(DOC-0001) vs 의미 포함(DB-NORM-001) | **단순 연번** + 태그로 의미 부여 (번호에 의미 넣으면 재분류 때 꼬임) |
| R2 | 이미지 포함 문제(그림 문제) 처리 | content에 Markdown 이미지 링크, 파일은 sources/images/에 저장 |
| R3 | 플래시카드를 별도 타입으로 둘까, 개념 문서에서 자동 생성할까 | v1은 별도 타입, 추후 "개념→카드 자동 생성" 검토 |
| R4 | 문서 버전 관리(수정 이력) 필요? | v1은 updated_at만. 이력 테이블은 필요성 확인 후 |
| R5 | 백업 전략 | study.db 파일 복사 = 백업 끝. 주기적 자동 복사 옵션 |
| R6 | 여러 기기 동시 접속 충돌 | SQLite WAL 모드로 개인용 수준 충분 |
| R7 | LLM 변환 품질 관리 | 반입 전 미리보기 필수 승인 + source_detail로 원본 대조 가능하게 |
| R8 | 태그 자동분류의 완전 자동 vs 제안-승인 | **기본 제안-승인**, 규칙별로 auto 옵트인 (오분류 조용히 쌓이는 것 방지) |
| R9 | LLM 엔진: claude CLI vs API | **CLI(headless) 우선** — 구독 활용, 키 관리 불필요. 원격 운영 시 API 재검토 |
| R10 | 개념 문서 "완료" 판정 기준 | v1은 "다음" 버튼=완료. 체류시간 기반 자동판정은 과설계로 보류 |
| R11 | 필기/실기의 성격 차이 (실기는 서술·작업형) | v1 문서 타입에 '서술형' 추가 검토 — 자가채점(내 답안 vs 모범답안 비교) 방식 |
| R12 | 홈 네트워크 보안 (0.0.0.0 바인딩) | 내부망 전용 원칙 — **공유기 포트포워딩으로 외부 노출 금지** 명시. 최소 PIN 잠금은 M6에서 검토 |
| R13 | tag_query 문법 범위 | v1은 **단일 태그 + OR만** 지원. AND/괄호 조합은 필요 확인 후 확장 (파서 과설계 방지) |

---
> 다음 단계: 상세 설계는 `docs/02-design/study-app.design.md` (API 명세·화면 상세),
> 구현 순서는 `docs/01-plan/stage-1-skeleton.plan.md` ~ `stage-7-home-layout.plan.md` 참조. MVP = Stage 1~3, v1 완성 = Stage 7.
