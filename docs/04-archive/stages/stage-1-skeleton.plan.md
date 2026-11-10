# Stage 1 — 뼈대 (M1: 스키마 · CRUD · 테마)

> 상위: `study-app.plan.md` v0.4 · 설계: `../02-design/study-app.design.md`
> 선행: 없음 (첫 단계) · 포함 기능: F01, F02, F03, F28 + 스키마 전체
> MVP 여부: **MVP 1/3**

## 목표

문서를 만들고, 분류 트리를 구성하고, 한 문서를 두 시험에 연결할 수 있다.
폰 브라우저로 접속되고, 다크 모드가 동작한다. 이후 모든 단계의 토대.

## 작업 체크리스트

### 1. 프로젝트 초기화
- [x] `backend/` FastAPI + SQLAlchemy 2.x + Alembic 셋업, `database.py` (SQLite WAL 모드)
- [x] `frontend/` Vite + React + TypeScript + Tailwind(darkMode:'class') + React Router + TanStack Query
- [x] `main.py`: 라우터 등록 + `frontend/dist` 정적 서빙 + `0.0.0.0:8000` 기동 스크립트
- [x] 디렉토리: `sources/`, `import/`, `prompts/` 생성. `.gitignore`(study.db, sources/, node_modules)

### 2. DB (계획서 §6.2 전체)
- [x] `models.py`: **테이블 12개 전부** 이번에 생성 — categories, documents, category_documents,
      attempts, review_notes, srs_cards, sources, tags, document_tags, tag_rules,
      study_progress, resume_points, document_relations, settings, bookmarks
      (후속 단계에서 스키마 변경 최소화가 목적. 사용은 각 단계에서 시작)
- [x] Alembic 초기 마이그레이션 + 인덱스 4개 (설계 §4 비고: attempts×2, category_documents, srs_cards)
- [x] `updated_at`은 SQLAlchemy `onupdate`로 처리

### 3. 백엔드 API (설계 §4.1, §4.2의 [S1] 항목)
- [x] categories: tree / POST / PATCH / move(자손 순환 검사→409) / DELETE(비어있을 때만)
- [x] documents: 목록(필터 category_id·deep·type·tag·orphan·페이지네이션) / POST(doc_no 채번) /
      상세(tags·usages 포함) / PATCH / DELETE(소프트)
- [x] links: POST·DELETE / tags: PUT(없는 태그 자동 생성) / `GET /api/tags`
- [x] 공통: 에러 포맷(설계 §3), Pydantic 스키마 분리

### 4. 프론트엔드
- [x] `styles/tokens.css` — 설계 §6 토큰 라이트/다크 세트, theme zustand 스토어(localStorage+system 구독)
- [x] 공통 컴포넌트: Layout(사이드바/하단 탭바 반응형), Tree, DocCard, MarkdownView, TagChip, 모달
- [x] 화면: **탐색**(설계 §5.2 — 트리 관리 메뉴, 문서 그리드, 필터바, 연결/해제),
      **문서 상세**(설계 §5.3 — 뷰/편집 모드, 사용처 목록), **설정**(테마 선택만)
- [x] 홈 `/`은 임시: 탐색으로 리다이렉트 (S3에서 대시보드로 교체)

## 완료 기준 (DoD)

1. 분류 트리 3단계(자격증>시험>과목)를 UI로 만들고 이동·이름변경 가능
2. 개념 문서 1개 생성 → 두 시험 분류에 연결 → 문서 상세에 "2곳에서 사용 중" 표시
3. 폰(같은 공유기)에서 `http://<PC-IP>:8000` 접속, 하단 탭바 레이아웃 확인
4. 다크/라이트/시스템 전환이 전 화면에서 색상 하드코딩 없이 동작
5. `alembic upgrade head`만으로 빈 DB에서 완전한 스키마 생성

## 이 단계에서 하지 않는 것

반입, 퀴즈/채점, 진도, 통계, 검색, relations·bookmark UI (테이블만 존재).
