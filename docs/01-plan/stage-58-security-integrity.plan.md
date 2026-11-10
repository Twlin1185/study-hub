# Stage 58 — 보안 신뢰 경계 + 데이터 무결성 긴급 묶음 (FB-37 · FB-38) (v2.0.x · 사소)

> 상태: **구현·검토 완료 — 발행 대기(DoD 6~8 사용자 회신 → VERSION 2.04.3)**(2026-11-10 · 구현 `d6b1817` + 검토 반영 `2b1202c` · Opus 조건부 통과 → 중요 1·경미 2·의심 1 반영 · 자동·메인 세션 DoD 1~5 충족 — §7 · 편성 2026-11-10 · 번호 58 · **사용자 확정 대기 0** — 규약 A~J는 포괄 감사 근거의 권고안 확정 · 이견 시 해당 규약만 교체 · 사용자 지시 = 2026-11-10 "진행시켜! 너말대로 가보자" = 감사 권고 순서 0번 승인).
> **버전 영향: 사소**(CHANGELOG 머리 규약 ③ — 버그픽스·보안 정비 · 새 화면 0 · 신규 엔드포인트 0 · DDL 0 · 응답 필드 가산 0 · 신규 의존 0) → 규약 ② PP+1 = **v2.04.3 예정**(v2.04.2는 stage-57이 CHANGELOG 항목으로 선점 · 발행 대기 중 — 합류가 아니라 별개 번호 · 발행 순서 판정 = §6 ①).
> 생성 경위: `backlog.md` §2 **FB-37**(별지 `editor-v2.plan.md` §13 538행 — 신뢰 경계 5건) + **FB-38**(539행 — 학습 기록·잡 유실 5건) 동승 · 2026-11-10 포괄 감사 등재분. **FB-39(540행)는 제외**(§4).
> 정본 포인터: 색인 §3 `[S58]` Host/Origin 가드(**Design v1.76**) · api §4.3·§4.10·§4.14·§4.21·§4.22·§4.24·§4.25 `[S58]` 1줄 · 마스터 §15 **R49**(신뢰 경계 감시) · R12·R16·R33·R37·R40(D10) · 불변 규칙 2·4·6·8·9.

## 1. 범위 (코드 실측 2026-11-10 — Grep·부분 Read)

| 대상 ID | 성격 | 요지 | 현행 코드 실측(`파일:라인`) |
|---|---|---|---|
| **FB-37ⓐ** CLI 권한 | 보안 | `bypassPermissions` 제거 · 읽기 도구만 | `backend/services/convert_service.py:581`(args) · `cwd=BASE_DIR :593` · 호출부 10곳이 이 함수 1개 경유(Grep `_run_claude_cli_streaming(` 11) · CLI는 Read 도구로 원본을 읽는다(`:718`·`:1719`·`:2638`·`:2909`·`:3168`) · codex = `codex_adapter.py:358`(무접촉) |
| **FB-37ⓑ** 경로 id | 보안 | id 화이트리스트 + 루트 종속 이중 가드 | `improve_service.py:104~113`(`_case_path`·`_case_output_path`·`_proposal_path` — 가드 0) · 생성 형식 `fc_{hex6} :274` · `pr_{hex6} :600` · `backup_service.py:28~33` · 생성 `{%Y%m%d_%H%M%S}_{label} :39`(label = `manual`·`auto`(`main.py:66`)·`pre_restore :103`) · 사용자 입력 진입 = `restore_backup :92~100` · `split_service.py:113`(`_load_state_from_disk`) · 생성 `spl_{hex8} :480` · 라우트 `routers/improve.py:52·58·104·110·115` · `backups.py:24` · `split.py:88·93·113` · 전례 `preview_store.py:38`(`^[A-Za-z0-9_-]{1,64}$`) · `main.py:222~230` |
| **FB-37ⓒ** Host/Origin | 보안 | 미들웨어 신설 | `backend/main.py` — `middleware` Grep 0건 · 에러 본문 `_error_body :120~121` · `http_exception_handler :146~154`(404 외 상태 = `VALIDATION_ERROR`) · `backend/tests/conftest.py` 부재 · **dev 프록시 `frontend/vite.config.ts:11` `changeOrigin: true`**(Host가 `localhost:8000`으로 바뀌어 Origin `localhost:5173`과 불일치 — 규약 C ④) |
| **FB-37ⓓ** 업로드 상한 | 보안 | 50MB 초과 거부 | `routers/convert.py:45·56`(`request.form()` → `.read()`) · `routers/split.py:55` · `routers/imports.py:38·42·109`(FastAPI `UploadFile` 인자) · 상수 `convert_service.py:119` `MAX_DOWNLOAD_BYTES` · 전례 `upload_service.py:19·30~31·41~57·60~72·75~85` |
| **FB-37ⓔ** 의존 갱신 | 보안 | `npm audit fix` 비파괴 | `frontend/package.json:14~20·41`(`@blocknote/*` 0.54.0 · `@mantine/*` 9.5.1 정확 고정) · `:30` `react-router-dom ^7.18.1` · `prosemirror-view`·`@tiptap/*` = 직접 의존 아님(전이) · 검증 스크립트 `frontend/scripts/s30~s47` 16개 |
| **FB-38ⓐ** 잡 TTL | 무결성 | 종료 잡만 삭제 | `convert_service.py:1238~1243`(상태 무관 `created_at`) · `JOB_TTL :70` · 내부 상태 literal = `running`(대기 포함 — `:1620~1627`) · 종료 = `done :1352`·`error :1392`·`cancelled :1537` · 종료 시각 `_finished_at :1355·1393·1539` · 호출 28곳 |
| **FB-38ⓑ** 시험 중복 | 무결성 | 세션 dedupe + 제출 422 | `exam_service.py:76~112`(과목 루프 — 과목 간 중복 제거 0) · `submit_exam :133~197`(중복 검사 0 · 채점 루프 `:186~197`) · **응용 모의고사 = 별도 구현** `applied_exam_service.py:628~`(같은 구조의 복제 — 정정 ①) |
| **FB-38ⓒ** 중복 제출 | 무결성 | in-flight ref 가드 | `frontend/src/pages/QuizRun.tsx:172~180`(키 1~4 → `handleSelect`) · `:238~242`(`if (answered) return`뿐 — 제출 중 가드 0 · 버튼만 `disabled :301`) · `ExamRun.tsx:177~188`(`doSubmit` 재진입 가드 0) · `:191~198`(자동 제출 `autoSubmittedRef :76`) · 전례 `Review.tsx:136` |
| **FB-38ⓓ** 자동 새로고침 | 무결성 | 풀이·편집 라우트 보류 | `frontend/src/hooks/useAppUpdate.ts:41~45` · 기존 배너 `components/Layout.tsx:105·113~124`("새 버전이 준비되어 있습니다." + [새로고침]) · 라우트 `App.tsx:49·51·52·53·55·58·59·74` |
| **FB-38ⓔ** 복원 안전 | 무결성 | busy 확인 + 활성 잡 거부 | `backup_service.py:107~112`(결과 행 미확인 · `sqlite3.Error` 삼킴) · 덮어쓰기 `:114~120`(`ConflictError` 전례) · 라우트 `routers/backups.py:24~27`(DB 세션 의존 0) · 활성 잡 조회 헬퍼 부재(Grep `def \w*active` 0) |

**DDL 0(§6.2 무변 · Alembic 0 · `models.py` diff 0) · 신규 엔드포인트 0 · 응답 필드 가산 0 · 에러 코드 신설 0 · 신규 의존 0 · settings 키 0 · 환경변수 1(`STUDY_HUB_ALLOWED_HOSTS` — 선택).**

**편성 실측 정정(지시 대비)**: ① FB-38ⓑ "응용 모의고사 제출도 같은 코어" → **별도 함수**(`applied_exam_service.submit_applied_exam`) — 두 곳 모두 가드 ② FB-37ⓒ — dev 프록시 `changeOrigin: true`가 Origin 검사와 충돌 → 규약 C ④ 추가 ③ FB-37ⓓ — `imports.py` 3곳은 FastAPI가 핸들러 전에 본문을 파싱 → 스트리밍 파서 전례를 그대로 못 쓴다(규약 D ②) ④ 에러 코드 = 신설 0(§3 "4종에서 늘리지 않는다" 현행 규약 우선 — 규약 C ③).

## 2. 확정 규약 (착수 전 결정 — 이 문서가 정본 · 사용자 확정 대기 0)

- **A. CLI 권한(FB-37ⓐ)** — `convert_service.py:581`에서 `--permission-mode bypassPermissions` 2토큰 제거 + **Read 도구만 허용**(쓰기·실행·네트워크·하위 에이전트 도구 차단). 정확한 플래그(`--allowedTools`/`--tools`/`--disallowedTools` 등)는 구현자가 이 PC의 `claude --help`로 **실측 확정**(추정 금지 · 확정 플래그를 §7에 기록). 원본이 `BASE_DIR` 밖(임시 폴더)에 놓이는 경로가 있으면 그 폴더만 읽기 허용 인자로 추가(Grep으로 원본 경로 조립부 확인). 인자 조립은 순수 함수 1개(`_claude_cli_args(exe, model)`)로 뽑아 테스트(B-10 ⓕ). codex 경로·API 엔진 무접촉. **메인 세션 실측(2026-11-10 · `C:\Users\TwT\.local\bin\claude.exe` 2.1.322 `--help`)**: `--tools` · `--allowedTools` · `--disallowedTools` · `--strict-mcp-config` · `--permission-mode` 실재 → **확정 인자 = `--tools Read` + `--allowedTools Read` + `--strict-mcp-config`**(`--mcp-config` 없이 = MCP 서버 로드 0) · `--permission-mode` 인자 자체를 넘기지 않는다. 근거: 자식 CLI는 사용자 전역 설정을 읽는데 그 설정이 `Bash` 전체 허용 + MCP 커넥터(메일·드라이브) 연결 상태 → 우회 플래그 제거만으로는 부족하고 **가용 도구 집합 자체**를 Read로 좁혀야 한다. 검증 = 실 CLI 최소 호출 1회는 **메인 세션**(V-3 — 구현 에이전트 LLM 실호출 0).
- **B. 경로 id(FB-37ⓑ)** — 공용 정규식 `^[A-Za-z0-9_-]{1,64}$`(전례 `preview_store._PREVIEW_ID_RE`와 동일 문자 집합 — 실측 생성 형식 `fc_`·`pr_`·`spl_`·`{날짜}_{시각}_{label}` 전부 포함 · `\`·`/`·`.`·`:`·`%` 배제) `fullmatch` + `(DIR / name).resolve().is_relative_to(DIR.resolve())` **이중 가드**. 적용 지점: ⓐ improve = 경로 헬퍼 3개(`:104~113`) 안(전 호출부 일괄) ⓑ backup = `restore_backup` 진입(확인 문구 검사 다음 · `:98` 앞 — 목록 경로는 glob 유래라 무접촉) ⓒ split = `_load_state_from_disk` 머리(불일치 → `None` → 기존 404). 불일치 = **404 `NOT_FOUND`**(기존 "찾을 수 없습니다" 문구 재사용 · 코드 신설 0). 접두·길이를 더 좁히지 않는다(기존 파일·테스트 픽스처 호환).
- **C. Host/Origin 가드(FB-37ⓒ)** — `backend/main.py`에 순수 ASGI 미들웨어 1개(신규 의존 0 · `scope["type"] == "http"`만).
  - ① **Host**(전 경로): 포트를 뗀 호스트가 `localhost` · IP 리터럴(`ipaddress.ip_address` 파싱 성공 — v4·`[v6]` 전부) · `socket.gethostname()`(대소문자 무시 · `.local` 접미 허용) · `STUDY_HUB_ALLOWED_HOSTS`(쉼표 구분 · 기동 시 1회 읽기) 중 하나가 아니면 거부. Host 부재·빈 값 = 거부.
  - ② **Origin**(`/api` 하위 `POST·PUT·PATCH·DELETE`만): `Origin` 헤더가 **있고** 그 `host[:port]`(소문자)가 Host 헤더 값(소문자)과 다르면 거부 — `null` 포함. Origin 부재 = 통과(비브라우저·구형 동일 출처).
  - ③ **거부 응답 = HTTP `403` + `code:"VALIDATION_ERROR"`** · `detail.reason` = `host_not_allowed` | `origin_mismatch` · 본문은 `_error_body` 형식 그대로(미들웨어가 직접 응답 — 예외 핸들러 밖). 근거: 색인 §3 "코드 집합은 4종에서 늘리지 않는다"(S14 확정) + `main.py:150` 기존 매핑(404 외 = `VALIDATION_ERROR`) → **코드 신설 0**, 상태 코드로만 구분(§3에 `[S58]` 등재).
  - ④ dev 프록시: `frontend/vite.config.ts:11` `changeOrigin: true` → 제거(Host = `localhost:5173` 유지 → Origin과 일치 · 빌드 산출물 무관).
  - ⑤ 테스트: `backend/tests/conftest.py` 신설 — 모듈 머리에서 `os.environ.setdefault("STUDY_HUB_ALLOWED_HOSTS", "testserver")`(앱 import 전). 폰 `http://<PC-IP>:8000` = IP 리터럴이라 무영향(DoD 사용자 항목).
- **D. 업로드 상한(FB-37ⓓ)** — 상한 = `convert_service.MAX_DOWNLOAD_BYTES`(50MB · 상수 신설 0). 초과 = **422 `VALIDATION_ERROR`** · `detail.reason = "upload_too_large"`(이미지 업로드 전례와 상태·코드 동일 · reason만 구분 — `too_large`는 변환 잡 `error_kind`·[분할 반입] 분기와 겹침) · 문구 "파일이 너무 큽니다(50MB 이하만 올릴 수 있습니다)".
  - ① `convert.py`·`split.py`(수동 `request.form()`): `upload_service`의 `_SizeLimitedMultiPartParser`를 공용 함수(`parse_form_limited(request, file_size_limit)`)로 노출해 교체 — 스트리밍 조기 차단 + Content-Length 1차 차단. 이미지 업로드 동작 diff 0.
  - ② `imports.py` 3곳(FastAPI `UploadFile`): `.read()` **전에** `UploadFile.size` 검사(값이 없으면 상한+1 바이트까지만 청크 읽기). 수용 잔여 = 스풀 임시 파일은 파싱 중 디스크에 쌓인다(메모리 아님 · 교차 사이트 경로는 C가 차단) — 시그니처를 `Request` 기반으로 바꾸지 않는다.
- **E. 의존 갱신(FB-37ⓔ)** — `frontend/`에서 `npm audit fix`(`--force` 금지). `@blocknote/*` 0.54.0 · `@mantine/*` 9.5.1 **버전 문자열 diff 0**(R33) — 변하는 것은 lockfile의 전이 의존(`prosemirror-view`·`@tiptap/*`·`react-router` 계열)과 캐럿 범위 내 직접 의존뿐. 메이저가 필요한 잔여(katex 계열 low)는 **잔류 명기**. 라이선스 변동 0 확인(D10 · R40 — 갱신된 패키지의 `license` 필드 대조). 엔트리 청크 Δ 기록(R37).
- **F. 잡 TTL(FB-38ⓐ)** — `_purge_expired_jobs`: 삭제 대상 = `status in ("done", "error", "cancelled")` **이고** `now - (job.get("_finished_at") or job["created_at"]) > JOB_TTL`. 내부 `running`(대기·실행)은 TTL 무관 보존. `JOB_TTL` 값·호출 28곳 무변(R18 상수 무변).
- **G. 시험 중복 문항(FB-38ⓑ)** — ⓐ `build_exam_session`: 과목 루프에 `seen: set[int]` — 순서 결정 뒤·`cap` 절단 **앞**에서 이미 출제된 `document_id` 제외(첫 과목 귀속 · 뒤 과목은 남은 문항으로 `cap` 채움) ⓑ 제출: `payload.answers`에 같은 `document_id` 2회 이상 = **422 `VALIDATION_ERROR`**(`detail.document_id` · 채점 전 · DB 쓰기 0) — `exam_service.submit_exam` + `applied_exam_service.submit_applied_exam` **두 곳**(공용 검사 함수 1개를 `exam_service`에 두고 재사용).
- **H. 중복 제출(FB-38ⓒ)** — `QuizRun.tsx`: `submittingRef`(useRef) — `handleSelect` 머리 `if (answered || submittingRef.current) return` → mutate 직전 `true` → `onSettled`에서 `false`(키보드·클릭 공통 경로). `ExamRun.tsx`: `doSubmit` 머리 재진입 차단 ref(`true`면 return) → `onError`에서만 해제(성공 = 화면 전환). 자동 제출도 같은 `doSubmit` 경유라 겹침 0.
- **I. 자동 새로고침(FB-38ⓓ)** — `useAppUpdate`: 새 빌드 감지 시 현재 경로가 **보호 라우트**면 `reload()` 대신 `updateAvailable = true`(기존 `Layout.tsx:113` 배너 재사용 — 새 UI·문구 0 · 사용자가 [새로고침]을 직접 누르는 것은 허용) + 감지 자산을 ref에 보관 → 경로가 보호 라우트를 벗어나는 순간 기존 가드 키 기록 후 `reload()`. 보호 라우트(정확 일치 — `/review-notes`가 `/review`에 걸리지 않게 접두 비교 금지): `/quiz/run` · `/exam/run` · `/review` · `/flashcards` · `/study/<id>` · `/notes/<id>` · `/docs/new` · `/docs/<id>/edit`. 판정 = 순수 함수 `isReloadDeferredPath(pathname)`(스토어·dirty 플래그 결합 0).
- **J. 복원 안전(FB-38ⓔ)** — `restore_backup` 순서: 확인 문구 → id 가드(B) → 백업 존재 → **활성 잡 검사**(`convert_service.has_active_jobs()` 신설 — `_JOBS_LOCK` 안에서 종료 3상태가 아닌 잡 존재 여부) → `pre_restore` 스냅숏 → 체크포인트 → 덮어쓰기. 활성 잡 있음 = **409 `CONFLICT`**("진행 중인 작업이 있어 복원할 수 없습니다 — 작업 센터에서 끝나기를 기다리거나 취소하세요"). 체크포인트: `fetchone()` 결과 `(busy, log, checkpointed)`의 `busy != 0` **또는** `sqlite3.Error` = **409 `CONFLICT`** · `shutil.copyfile` 미실행(`pre_restore` 스냅숏은 남는다 — 무해).

## 3. 체크리스트

**B. 백엔드 (`backend/`)**
- [x] B-1 (A) `services/convert_service.py` — `_claude_cli_args(exe, model)` 추출 · `bypassPermissions` 제거 · Read 전용 플래그(`claude --help` 실측 — 플래그·CLI 버전을 §7에 기록) · 원본이 `BASE_DIR` 밖에 놓이는 경로 유무 Grep 확인(있으면 읽기 허용 인자). **CLI 실호출 금지**(V-3은 메인).
- [x] B-2 (B) `services/improve_service.py` 경로 헬퍼 3개에 이중 가드(불일치 `NotFoundError`) · `services/backup_service.py` `restore_backup` 진입 가드 · `services/split_service.py` `_load_state_from_disk` 머리 가드(`None` 반환). 정규식은 모듈별 상수 또는 공용 1곳(구현 재량 · 문자 집합은 규약 B 고정).
- [x] B-3 (C) `main.py` — ASGI 미들웨어(Host ① · Origin ② · 403 응답 ③) · 허용 호스트 집합은 기동 시 1회 계산 · `scope["type"] != "http"` 통과.
- [x] B-4 (C ⑤) `tests/conftest.py` 신설(환경변수 1줄 — 다른 픽스처 추가 0).
- [x] B-5 (D ①) `services/upload_service.py` — 공용 `parse_form_limited` 노출(기존 이미지 경로는 그것을 호출 · 동작 diff 0) · `routers/convert.py:45` · `routers/split.py`의 `request.form()` 교체 · 초과 = 422 `upload_too_large`.
- [x] B-6 (D ②) `routers/imports.py:38·42·109` — `.read()` 전 크기 검사(공용 헬퍼 1개).
- [x] B-7 (F) `convert_service._purge_expired_jobs` — 종료 3상태 한정 + `_finished_at` 기준(폴백 `created_at`).
- [x] B-8 (G) `services/exam_service.py` — 세션 dedupe(`seen`) + 중복 검사 함수 · `submit_exam`·`applied_exam_service.submit_applied_exam` 양쪽 호출(채점 루프 앞).
- [x] B-9 (J) `convert_service.has_active_jobs()` 신설 · `backup_service.restore_backup` — 활성 잡 409 · 체크포인트 결과 행 검사 · `sqlite3.Error` 409 · `except: pass` 제거.
- [x] B-10 테스트(LLM 0 · 신규 파일 2):
  - `tests/test_security_guards.py` — ⓐ 경로 탈출: improve case·proposal · backup restore · split 각각에 `..%5C..%5Cx` · `%2E%2E%2Fx` · 절대경로(`C:%5CWindows%5Cwin`) · `..` → **404** + 대상 디렉터리 밖 파일 무접촉(임시 디렉터리 monkeypatch) ⓑ Host 허용 4종(`localhost:8000` · `192.168.0.5:8000` · `[::1]:8000` · `socket.gethostname()`(+`.local`)) → 200 · 환경변수 추가분(`testserver`) → 200 ⓒ Host 거부(`evil.example`) → 403 `host_not_allowed` ⓓ Origin 거부 2(다른 호스트 · `null`) → 403 `origin_mismatch` · 같은 host:port Origin·Origin 부재·GET은 통과 ⓔ 업로드 상한: `MAX_DOWNLOAD_BYTES`를 작은 값으로 monkeypatch → convert·split·imports 3경로 422 `upload_too_large` · 상한 이하 통과 ⓕ `_claude_cli_args` — `bypassPermissions` 미포함 · Read 전용 플래그 포함 · `model` 유무 분기.
  - `tests/test_integrity_guards.py` — ⓖ 잡 TTL: `created_at` 2시간 전 대기 잡(내부 `running`) 보존 · `_finished_at` 2시간 전 종료 잡 삭제 · `_finished_at` 10분 전(생성 2시간 전) 종료 잡 보존 ⓗ 시험: 한 문서가 두 과목에 연결 → 세션 응답에 그 `document_id` 1회 · 제출 중복 → 422(attempts 0행) · 응용 모의고사 제출 중복 → 422 ⓘ 복원: 활성 잡 있음 → 409(`study.db` 대상 파일 mtime 무변 — 임시 경로 monkeypatch) · 체크포인트 busy 모의 → 409 · 정상 경로 통과.
- [x] B-11 DDL 0 확인 — `git diff --stat -- backend/models.py backend/alembic` 빈 출력 · 신규 라우트 0.

**F. 프론트 (`frontend/`)**
- [x] F-1 (H) `src/pages/QuizRun.tsx` — `submittingRef` 가드(`handleSelect` 1곳 · `onSettled` 해제).
- [x] F-2 (H) `src/pages/ExamRun.tsx` — `doSubmit` 재진입 차단 ref(`onError` 해제).
- [x] F-3 (I) `src/hooks/useAppUpdate.ts` — `isReloadDeferredPath` + 보류·이탈 시 새로고침(`useLocation`) · `Layout.tsx` 배너 마크업 diff 0.
- [x] F-4 (C ④) `vite.config.ts` `changeOrigin` 제거.
- [x] F-5 (E) `npm audit fix`(비파괴) → `package.json` 고정 7줄(`@blocknote/*` 5+1 · `@mantine/*` 2) diff 0 확인 · 갱신 패키지 목록·라이선스·`npm audit --omit=dev` 잔여를 §7에 기록.
- [x] F-6 `npx tsc --noEmit` 통과 · 새 색 리터럴 0(불변 규칙 5 — UI 추가 0).

**V. 검증 (서버 구동 금지 — 임시 포트 8765만 · 종료 + 리스너 부재 확인 · 빈 DB · 실 데이터 무접촉)**
- [x] V-1 자동: `scripts/run-tests.ps1 -Path tests/test_security_guards.py`·`-Path tests/test_integrity_guards.py` + `-Full`(회귀 0 — conftest 도입 후 기존 710건 Host 403 없음 확인) · `scripts/invariant-scan.ps1` PASS(기준선 갱신 0) · `npm run build` 성공 · 엔트리 청크 Δ 기록(R37 — 기준선 1,534,106 B).
- [x] V-2 편집기 회귀(E): `frontend/scripts/` `s30`·`s32-*`·`s33`·`s34-*`·`s35-*`·`s36`·`s37`·`s40`·`s41-*`·`s47` 중 실행 가능한 것 전부 실행 — 통과/실행 불가(사유)를 §7에 1줄씩.
- [x] V-3 **메인 세션**: 실 Claude CLI 최소 호출 1회(작은 텍스트 원본 1개 → Read 성공 + 결과 반환 · 권한 거부·대기 멈춤 0) — 실패 시 플래그 재확정 후 재시도 1회까지.
- [x] V-4 **메인 세션** 임시 포트 스모크: ⓐ `127.0.0.1:8765`·`localhost:8765` 정상 ⓑ `curl -H "Host: evil.example"` → 403 ⓒ `-H "Origin: http://evil.example"` POST → 403 ⓓ 빈 DB에서 백업 생성 → 복원 1회 **성공**(체크포인트 가드 오탐 0) ⓔ 큐 일시정지 + 대기 잡 1개 상태에서 복원 → 409 → 잡 취소·재개.

**D. 문서**
- [x] D-1 매뉴얼 `docs/manual/user-manual.html` — 접속 주소 절에 "주소는 `localhost`·PC IP·PC 이름만 — 다른 이름으로 접속하려면 환경변수 `STUDY_HUB_ALLOWED_HOSTS`" 1구 · 백업 복원 절에 "진행 중인 작업이 있으면 복원 불가" 1구 · 반입 절에 "파일 50MB 이하" 1구(행 번호는 Grep 재확인).
- [x] D-2 설계 — 색인 §3 `[S58]` · api `[S58]` 7곳 "편성" → "구현 실측 확정"(편차 있으면 1구) · 색인 상태 줄 다음 판번.
- [x] D-3 CHANGELOG 항목 · `stage-index.md` 58행 · 이 문서 §7 · 체크박스 `[x]`.
- [x] D-4 `backlog.md` FB-37·FB-38 §2 → §4 종결 이동 · R49 행 실측 추기 · `scripts/backlog-scan.ps1` PASS.
- [x] D-5 출처 추기 — 별지 §13 FB-37·FB-38 `← 완료(stage-58 · 날짜)` · 마스터 §15 R49 `← 실측`.

## 4. 이 단계에서 하지 않는 것 (불변 규칙 9 — 이 절이 우선)

- **FB-39 0** — `QuizRun.tsx:136~137` `useDocument` 선조회(정답·해설 브라우저 도달)는 설계 판단 대기 — 무접촉.
- **세션 persist 0** — 퀴즈·시험·플래시카드 스토어의 저장·복원 없음(I는 새로고침 보류만).
- **PIN 잠금·인증·HTTPS 0**(R12 — 실수요 시 후보) · CORS 설정 추가 0 · 외부 접속 허용 0.
- **잡 영속화·재발견 0** — 인메모리 잡 그대로(F는 삭제 조건만) · `JOB_TTL` 값 변경 0 · 분할·미리보기 TTL 무접촉.
- **katex 메이저 갱신 0** · `npm audit fix --force` 0 · `@blocknote/*`·`@mantine/*` 버전 변경 0 · 신규 의존 0.
- **codex·API 엔진 권한 모델 0** · CLI `cwd`·프롬프트·타임아웃·모델 인자 무변 · CLI가 프로젝트 `CLAUDE.md`·설정을 읽는 문제는 R49 관찰만.
- **GET 요청 Origin 검사 0** · 레이트 리밋 0 · 전역 본문 크기 미들웨어 0(상한은 D의 5지점만) · 이미지 업로드 10MB 규약 무변.
- **에러 코드 신설 0** · 응답 필드 가산 0 · DDL 0 · 신규 엔드포인트 0 · 새 화면·문구(배너 포함) 0.
- 포괄 감사의 나머지(구조 개편 · UX · 테스트 하네스 확장 · conftest 픽스처 정비)는 **V3 계획서 몫** — 이 stage는 conftest 1줄만.

## 5. DoD

**자동(에이전트):**
1. V-1 전건(`-Full` 회귀 0 · invariant PASS · build 성공) + V-2 기록.
2. `models.py`·`alembic/`·`prompts/` diff 0 · `routers/` 신규 라우트 0 · `package.json` 고정 7줄 diff 0 · 라이선스 변동 0.
3. 문서 묶음 D-1~D-5.

**메인 세션:**
4. V-3 CLI 실호출 1회 성공(Read 전용 플래그로 변환 결과 반환).
5. V-4 임시 포트 스모크 ⓐ~ⓔ(종료 + 리스너 부재 확인).

**사용자 확인(발행 게이트):**
6. **폰 실기기** `http://<PC-IP>:8000` 접속·풀이 1문항 제출·반입 화면 열림(403 0).
7. **편집기** — 노트·문서 편집에서 붙여넣기(서식 있는 텍스트)·한글 입력 정상(R33·R35).
8. 실사용 치명 결함 0 회신(PC 이름 주소로 접속하는 습관이 있으면 그 주소 포함).

**게이트**: 1~5 전건 + 6~8 치명 0 → 발행. **착수 게이트: 없음.**

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `CHANGELOG.md` — **v2.04.3 항목 1개**(사소). **발행 순서**: stage-58 게이트 통과 시점에 ⓐ stage-57(v2.04.2)이 발행 완료 → v2.04.3 단독 발행 ⓑ stage-57이 아직 발행 대기 → `VERSION`은 2.04.3 **한 번만**·v2.04.2는 "v2.04.3과 동시 발행 — 단독 발행 생략"(v2.03.2·v2.01.3 전례 · 코드는 이미 main에 병합) — 이때 stage-57 DoD 6(해설 표본)을 발행 후 회신으로 돌릴지 **사용자에게 1회 확인**.
2. 루트 `VERSION` 2.04.3 — DoD 6~8 회신 후.
3. `stage-index.md` 58행 갱신.
4. `backlog.md` — FB-37·FB-38 §2 → §4 종결 이동 · §3 R49 실측 추기 · `backlog-scan.ps1` PASS.
5. 출처 추기 — 별지 §13 FB-37·FB-38 `← 완료` · 마스터 §15 R49 `← 실측`.
6. 설계 — `[S58]` 확정 표기 · 색인 상태 줄 다음 판번(밀리는 판 archive 이동만).
7. 매뉴얼(D-1) · `CLAUDE.md` 머리 버전 줄 1곳(발행 시) · git tag(release PR 별도).

## 7. 완료 기록 (착수 후 추기)

- **편성**(2026-11-10): 지시서 확정 — FB-37 + FB-38 동승 · 사소(v2.04.3 예정) · 규약 A~J · 사용자 확정 대기 0 · 실측 정정 4(§1 말미) · 색인 §3 `[S58]` + api `[S58]` 7곳(Design v1.76 · v1.72 archive 이동) · stage-index 58행 · backlog FB-37·38 상태 + §3 R49 · 별지 §13 편성 추기 · 마스터 §15 R49(Draft v0.65) · 로드맵 M 행 추가 없음(사소).
- **구현**(2026-11-10 · `d6b1817`): B-1~B-11 · F-1~F-6 전건. 지시서 대비 편차 — ① 경로 id HTTP 테스트에서 `%2F`·`..`은 라우팅 단계에서 걸러져(405) 서비스 직접 호출로 검증 ② `npm audit fix`가 tiptap을 부분 갱신(메뉴 확장만 3.33.0 · peer 불일치) → lock의 `@tiptap/*` 재해결로 **12개 3.33.0 일관**(`@blocknote/*` 허용 범위 `^3.29.2` 안 · `package.json` diff 0) ③ B-1 `BASE_DIR` 밖 원본 경로 없음(`--add-dir` 불요).
- **확정 CLI 인자**(claude 2.1.322): `-p --output-format stream-json --verbose --tools Read --allowedTools Read --strict-mcp-config`(+`--model`).
- **V-1**: pytest 755(신규 45 = security 36 · integrity 9) · invariant PASS · tsc 0 · build 성공 · 엔트리 1,528,915 B(Δ −5,191 — vite/rolldown 갱신 유래 추정). **V-2**: s30(365) · s32-normalize · s32-roundtrip-blocks(751) · s33(999) · s34-parity · s34-paste-check(99) · s36(40) · s37(191) · s40(37) · s41-columns-editor(81) · s47(78) 통과 — 갱신 전후 동일 · 실행 불가 5(s32-realdoc-check · s35-doc-roundtrip · s35-realdoc-adapter · s41-columns-roundtrip = 실 DB 필요 / s35-batch-convert = 서버 필요). **V-3**: 실 CLI 1회 — `init.tools = [Read]` · `mcp_servers = []` · Read 성공 · 거부 0 · 5초. **V-4**(격리 워크트리 · 빈 DB · 8765 · 종료 + 8765·8000 리스너 부재 확인): ⓐ 200 ⓑ 403 `host_not_allowed` ⓒ 403 `origin_mismatch`(타 출처·`null`) · 동일 출처 201 ⓓ 복원 200 ⓔ 대기 잡 중 409 → 취소 후 200 · 추가: `..%5C` 복원·improve 삭제 404 · 52.5MB 업로드 422.
- **Opus 검토**(2026-11-10 · 조건부 통과 → `2b1202c`): 중요 1(경로 가드 테스트 `sandbox`가 `DB_PATH`·`SOURCES_DIR`·`engine` 미격리 — 가드 회귀 시 실 `study.db` 덮어쓰기) 반영 · 경미 2(복원 활성 잡 검사 TOCTOU → 스냅샷 뒤 재확인) 반영 · 경미 3(improve 본문 `case_ids` 형식 불일치 404 → 422 유지) 반영 · 미확인 의심(이탈 새로고침과 이탈 flush 경합 → 1.5초 지연) 반영 · **기록만**: 경미 4(반입 multipart 파싱 오류 400 → 422 + 이미지 문구) · 경미 5(urlencoded 본문은 상한 밖). 범위 밖 발견 → **FB-40**.
- **잔여 사용자 DoD 6~8** → 회신 후 release PR(`VERSION` 2.04.3 · CLAUDE.md 버전 줄 · tag).
