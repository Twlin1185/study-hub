# Study Hub — 종합 학습 관리 시스템 기획/설계 초안

> 상태: **확정 준비 (Draft v0.5)** — v0.4 대비: 문제 오류 신고·재생성(F30, S6) 추가, D-Day 관리(임의 D-Day 포함)·오답노트 분류 계층 그룹을 S4로 편입. **스키마(§6.2) 변경 없음**
> 작성일: 2026-07-22 · 갱신: 2026-07-23
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
| 1 | **홈 대시보드** | **"이어하기" 카드(최우선)**, 오늘의 복습 N개, 학습 히트맵, D-Day 배지(시험 분류 + 임의 D-Day 병합) |
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
  - 퀴즈 정답(빠름) q=5, 정답(느림) q=4, 정답(오답노트 재도전) q=3, 오답 q=1
  - 플래시카드 "안다" q=4, "모른다" q=1
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

> v1.x 후보 (M6 이후, 실사용 피드백 확인 후): F25 실전 모의고사 모드, F26 학습 목표·스트릭. 특히 F25는 시험 4주 전 시점에 가치가 커지므로 실제 시험 일정에 맞춰 착수.

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
> 구현 순서는 `docs/01-plan/stage-1-skeleton.plan.md` ~ `stage-6-automation.plan.md` 참조. MVP = Stage 1~3.
