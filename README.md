# Study Hub — 개인 학습 허브

기출문제·학습자료를 LLM으로 구조화해 쌓고, **학습 → 풀이 → 오답관리 → 복습** 루프를 완성하는
로컬 웹앱입니다. FastAPI + SQLite + React로 만들어졌고, 집 안(홈 네트워크)에서 PC·휴대폰으로 사용합니다.

> **이 저장소에는 도구만 있습니다.** 기출문제 등 학습 데이터는 포함되지 않으며,
> 각자 확보한 자료를 앱의 반입 기능으로 넣어 사용합니다. 자동 수집은 공공데이터포털의
> **큐넷 공식 오픈API**(국가자격 실기 공개문제)만 지원합니다 — 사설 사이트 크롤링은 하지 않습니다.

## 주요 기능

- **자료 반입 파이프라인** — PDF·이미지·docx·xlsx·md·txt·html 등에서 LLM이 문제·개념을
  구조화(JSON 규격)해 반입. 미리보기·검증을 거쳐야 저장되고, 원본에 없는 지문·정답이
  경고 없이 들어오는 경로를 차단하는 **변환 신뢰 게이트**(원문 대조)가 있습니다.
- **분류 트리 + 문서 관리** — 시험/과목/챕터 계층 분류, 문서 상호 연결, 검색(FTS5), 태그 자동 분류.
- **학습 루프** — 커리큘럼 뷰, 학습 모드(진도·이어하기), 퀴즈(채점은 항상 서버에서),
  오답노트 자동 생성, 챕터 파이프라인(개념→문제→기출).
- **간격반복 복습(SM-2)** — 오늘의 복습 큐, 플래시카드, D-Day 연동 복습 강도 조절.
- **시험 준비 도구** — 실전 모의고사(일괄 채점·과목별 리포트), A4 인쇄/PDF 내보내기 3종, D-Day 관리.
- **대시보드** — 학습 통계 차트·히트맵, 학습 목표·스트릭, 약점 시각화.
- **LLM 엔진 선택** — Claude(CLI 또는 API 키)와 Codex CLI(ChatGPT 구독) 중 선택,
  우선순위·폴백·사용량 한도(429) 안내 지원. **LLM 없이도 학습·퀴즈·복습 기능은 전부 동작합니다.**
- 다크 모드, 모바일(PWA), 백업/복원 UI.

## 빠른 시작

### 아무것도 설치돼 있지 않은 Windows PC (비개발자)

[`0_README.txt`](0_README.txt)를 참고하세요 — **`2_StartServer.bat` 더블클릭 하나로**
포터블 Python 다운로드부터 서버 실행·브라우저 열기까지 자동으로 진행됩니다.

### 개발 환경에서 직접 실행

요구사항: Python 3.12+, Node.js(프론트 개발·빌드 시)

```bash
# 1) 백엔드
cd backend
python -m venv .venv && .venv/Scripts/activate   # (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python -m alembic upgrade head                    # DB 생성/마이그레이션 (프로젝트 루트에 study.db)
uvicorn main:app --host 0.0.0.0 --port 8000

# 2) 프론트엔드 — 빌드 산출물(frontend/dist)이 저장소에 포함돼 있어 그대로도 화면이 뜹니다.
#    프론트를 수정할 때만:
cd frontend
npm install
npm run dev        # 개발 서버 (프록시로 백엔드 연결)
npm run build      # 배포 빌드 → FastAPI가 dist를 서빙
```

- 접속: PC `http://localhost:8000`, 휴대폰(같은 Wi-Fi) `http://<PC-IP>:8000`
- 사용 설명서: 서버 실행 후 `http://localhost:8000/manual`
- 데이터는 프로젝트 루트의 `study.db` 파일 하나에 저장됩니다. **백업 = 이 파일 복사**
  (앱 내 백업/복원 UI도 있습니다).

## LLM 엔진 설정 (선택)

자료 자동 구조화에만 필요합니다. 앱의 **설정 화면**에서 등록·진단합니다.

| 엔진 | 필요한 것 | 비고 |
|---|---|---|
| Claude CLI | Claude 구독 + `claude` CLI 로그인 | 별도 과금 없음(구독 한도 사용) |
| Claude API | Anthropic API 키 | 키는 로컬 `secrets.json`에만 저장(git·백업 제외), 건별 과금 |
| Codex CLI | ChatGPT 구독 | 앱 내 온보딩(자동 설치·로그인 진단) 제공 |

## 보안·데이터 원칙

- **홈 네트워크 전용입니다. 외부 인터넷에 포트를 열지 마세요**(포트포워딩·터널링 금지).
  인증 체계가 없는 개인용 앱입니다.
- 반입한 원본 파일(`sources/`)·학습 DB(`study.db`)·API 키(`secrets.json`)는 모두
  `.gitignore` 대상 — 저장소에 올라가지 않습니다.
- 반입 원본은 불변으로 보존되고, 문서 삭제는 소프트 삭제입니다.

## 프로젝트 문서

| 문서 | 내용 |
|---|---|
| `docs/01-plan/study-app.plan.md` | 마스터 계획 — 기능 목록, 스키마 DDL 단일 출처, 로드맵, 리스크 |
| `docs/02-design/study-app.design.md` | 상세 설계 색인(공통 규약) — §4 API 명세·§5~7 화면은 분할 파일 참조 |
| `docs/01-plan/stage-*.plan.md` | 단계별 작업 지시서(체크리스트·DoD) — 개발 이력의 단일 출처 |
| `docs/04-archive/` | 완료 이력 원문 보존 |
| `docs/manual/user-manual.html` | 사용자 매뉴얼(앱 내 `/manual`로 서빙) |

## 기술 스택

FastAPI · SQLAlchemy · SQLite(WAL, FTS5) · Alembic / React · TypeScript · Vite · Tailwind CSS / pytest(SM-2 필수 테스트)

## 라이선스

미지정 (추후 결정 예정). 이 저장소의 코드는 개인 학습 목적으로 공개되었으며,
기출문제 등 학습 콘텐츠의 저작권은 각 출제·발행 기관에 있습니다 —
데이터는 저장소에 포함되지 않고, 사용자가 각자 적법하게 확보해 사용합니다.
