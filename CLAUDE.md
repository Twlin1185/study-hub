# Study Hub — 개인 학습 허브

기출문제·학습자료를 LLM으로 구조화해 쌓고, 학습→풀이→오답관리→복습 루프를 완성하는
로컬 웹앱 (FastAPI + SQLite + React). 개인용, 홈 네트워크 전용.

## 문서 지도 (코드보다 문서가 먼저다)

| 문서 | 역할 |
|---|---|
| `docs/01-plan/study-app.plan.md` | 마스터 계획 — 기능 F01~F38, **스키마 DDL 단일 출처(§6.2)**, 로드맵 M1~M11, 리스크 R1~R15 |
| `docs/02-design/study-app.design.md` | API 명세(엔드포인트에 [S1]~[S11] 태그) + 화면 상세 12개 + 토큰/상태관리 |
| `docs/01-plan/stage-{1..11}-*.plan.md` | 단계별 작업 지시서 — 체크리스트·DoD·제외 범위. MVP = stage 1~3, v1 = ~7, v1.x = 8~11 (**전 단계 완료** — 2026-07-26. 다음 로드맵은 계획서에 먼저 확정 후 착수) |
| `docs/manual/user-manual.html` | 사용자 매뉴얼 — 기능 변경 시 함께 갱신 |

구현 관련 질문의 답은 대부분 설계 문서에 이미 있다 — 추정하기 전에 먼저 읽을 것.
문서와 코드가 어긋나면 임의로 코드를 맞추지 말고 사용자에게 보고.

## 모델 운용 정책

| 작업 | 담당 | 모델 |
|---|---|---|
| 계획·설계 변경, 아키텍처 결정 | 메인 대화 또는 `plan-architect` | **Fable** (한도 소진 시 Opus — 에이전트는 모델 미지정=세션 상속) |
| 백엔드/프론트 구현 | `backend-dev` / `frontend-dev` | **Sonnet** (예외: sm2·import_service·학습모드 UX는 opus 승격) |
| 단계 검토·코드 리뷰 | `stage-reviewer` | **Opus 고정** |

워크플로 스킬: `/stage-implement <n>` (구현+검토 한 사이클) · `/stage-review <n>` (검토만) · `/stage-status` (진행 현황).

## 불변 규칙 (모든 코드 작업에 적용)

1. **채점은 서버에서만** — quiz/session 응답에 정답·해설 포함 금지.
2. **attempts 저장 + 오답노트 생성 + SM-2 갱신 = 한 트랜잭션.**
3. 문서 삭제 = 소프트 삭제(`is_active=0`). 물리 삭제 금지. 분류에서 빼기 = 연결 해제.
4. `sources/` 원본 파일은 불변 — 수정·삭제 코드 금지.
5. **색상 하드코딩 금지** — `styles/tokens.css` 토큰만. 다크 모드는 토큰으로 공짜여야 한다.
6. 스키마 변경은 plan §6.2 갱신 + Alembic 마이그레이션 세트로만.
7. 테스트는 `services/sm2.py`만 필수(pytest). 나머지는 실행 스모크로 검증하고 결과 보고.
8. 에러 포맷·페이지네이션은 설계 §3 규약 준수.
9. 각 단계 범위를 지킬 것 — stage 문서의 "이 단계에서 하지 않는 것"이 우선한다.
10. 작업 완료 시 해당 stage 문서의 체크박스를 `[x]`로 갱신 (문서가 진척의 단일 출처).

## 실행

- 백엔드: `uvicorn main:app --host 0.0.0.0 --port 8000` (backend/에서)
- 프론트 개발: `npm run dev` (frontend/에서) / 배포 빌드는 `npm run build` → FastAPI가 dist 서빙
- DB: 프로젝트 루트 `study.db` (SQLite WAL). 백업 = 파일 복사.
- 접속: PC `http://localhost:8000`, 폰 `http://<PC-IP>:8000` — **외부 포트포워딩 금지(R12)**.
