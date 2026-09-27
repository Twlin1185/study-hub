# Stage 54 — 캡처 파이프라인 1단계: 최소 수직 슬라이스(획득 → 원본 보관 → LLM 정제 → 리뷰 → 노트 삽입) (v2.0.x · 핵심)

> 상태: **편성 보류 — 사용자 확정 대기 D-C1~D-C5**(`capture.plan.md` §10 · 2026-09-27 편성 · 코드 0). 확정 도착 → 착수 문서화(§2 "확정 대기" 해소 · 설계 §4.33·§5.18 "후보안" 해제 · 마스터 §6.2 DDL 등재 + §15 R47 전문) → 상태 줄 "착수 전" → `/stage-implement 54`. **확정 전 어떤 코드도 쓰지 않는다.**
> **버전 영향: 핵심**(CHANGELOG 규약 ③ — 근거: **새 기능 표면**(`/capture` 화면 + 내비 항목 · 종전 0) + **저장 계약 변경**(신규 테이블 `capture_items` 1 · Alembic 1 · 신규 API 8 · 잡 kind 1) + 로드맵 **M39** 등재. 권고안(사진 1단계) 기준 신규 의존 0 — D-C1이 녹음으로 확정되면 STT 의존 1건이 추가되나 판정은 변하지 않는다). → 산출 버전 **v2.04.1 예정**(규약 ② 핵심 = MM+1·PP=1 · 현재 v2.03.1). **F62 색인 행 부여** · 단독 편성(사소 stage 합류 없음).
> 생성 경위: `backlog.md` §1 **"캡처"** 행(별지 `editor-v2.plan.md` §7.3·§5.5 · stage-43 §5 N-1 이월) — 편성 조건 "별도 계획서 선행"을 **`capture.plan.md`(신설 · 캡처 전체 정본)** 로 이행하고, 이 지시서는 그 §8 **1단계**만 가리킨다. 등록부 `D5-리더` 행은 재론 절차만 연결(capture §12 · 착수 0). `/stage-plan` 2026-09-27 사용자 선택 = TODO 4행 중 "캡처 파이프라인 계획서(핵심 · 단독)".
> 정본 포인터: 결정·리스크·단계 분할 = **`capture.plan.md` §5(DDL 후보)·§7(전이·트랜잭션)·§8(단계)·§9(R44~R47)·§10(D-C)** · API 계약 = 설계 api **`### 4.33 [S54]`**(후보안) + §4.24 `[S54]` 추기(kind 10종째) · 화면 = screens **`### 5.18 캡처`**(후보안) + §5 도입부 1줄 · 에러·페이지네이션 = 설계 §3 · 불변 규칙 1(응답에 정답·해설 0)·2(무관)·3(물리 삭제 0 — `discarded` 상태)·4(`sources/capture/` 원본 불변 · 수정·이동·삭제 코드 0)·5(토큰만)·**6(DDL = §6.2 + Alembic 세트 — 확정 후)**·7(sm2 무접촉)·8·9·10 · R16(id 기반 서빙 + 루트 종속 검사) · R37(lazy 청크 · 기준선 1,522,408 B) · R40(신규 의존 = 라이선스 절차 — 권고안 0건) · 서버 구동 금지(검증은 사용자 기동 서버).

## 1. 범위 (권고안 D-C1 = 사진(photo) 기준 — D-C1이 다르게 확정되면 §2 A를 갱신하고 체크리스트 B-4·F-2를 그 종류로 바꾼다 · 코드 실측 2026-09-27)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **캡처 ① 획득·원본 보관**(backlog §1 "캡처" · 별지 §5.5 `IngestSource`) | 신규 API + 저장 | 폰/PC `<input type="file" capture>` → `POST /api/capture`(multipart) → `sources/capture/{hash12}_{safe_name}` + `capture_items` 행 | 원본 저장 규칙 `backend/services/import_service.py:129~146`(`_save_source_file` — 해시 접두 · 있으면 덮어쓰기 0) · 이미지 업로드 `services/upload_service.py:96~116`(`_store_image` · 10MB 상한 `:19` · multipart 크기 제한 파서 `:41~58`) · 매직 바이트 판별 `services/convert_service.py:356`(`_detect_image_magic`) · `SOURCES_DIR` 정의 4곳(`convert_service.py:1903` · `import_service.py:54` · `backup_service.py:20` · `preview_store.py:30`) · 캡처 관련 테이블·라우터·서비스 **0** · `capture_items` 없음(`models.py` · `alembic/versions/` 6건 중 최신 `9b1e0f7c4a2d_s35_documents_blocks.py`) |
| **캡처 ② LLM 정제 잡**(별지 §5.5 "기존 잡 패턴 재사용 전제") | 잡 kind 추가 + 프롬프트 | kind `capture_refine` → 비전 엔진으로 원본 판독·정리 → JSON `{raw_text, draft_md}` → 행 UPDATE(status `drafted`) | 잡 큐 `convert_service.py:69`(TTL) · `:1245~1277`(`_ensure_worker`·`_worker_loop`·`_process_job`) · `:1447`(`cancel_job`) · kind→ref `:1558~1580`(`_job_ref`) · 목록 항목 `:1583~1602` · CLI 프롬프트(Read 도구로 이미지 직접) `:1638~1646` · API 이미지 블록 `:716~733` · codex 이미지 422 `codex_adapter.py:285~289` · JSON 검증 `:855~898` · 엔진 게이팅 `llm_engine_service.py:599`(`assert_engine_selectable`) · `model?` 적용 8곳(§4.24 ⓒ) · 프론트 kind 유니온 `frontend/src/api/types.ts:1591~1602` · 라우트 표 `utils/jobRoutes.ts:10~25` · 프롬프트 `prompts/convert.md`·`taxonomy.md`(캡처용 0) |
| **캡처 ③ 리뷰·삽입 표면**(별지 §5.5 "삽입 리뷰 UI · 자동 삽입 금지" · §12-5 착지 = notes) | 신규 화면 + 신규 API | `/capture`(목록 + [사진 추가]) · `/capture/:id`(원본 · `raw_text` · 초안 렌더 · [정제]/[다시 정제] · [노트에 삽입] · [버리기]) · 삽입 = 클라이언트 `markdownToBlocks` + provenance 스탬프 → `POST /api/capture/{id}/insert` 한 트랜잭션 | 변환기 `frontend/src/editor2/transform/index.ts:55`(`markdownToBlocks`) · `blocksToMarkdown.ts:706` · provenance 타입 `editor2/schema/blocks.ts:31~51`(`source` 필드 없음 — D-C8 가산) · 노트 API `routers/notes.py`(`POST` · `PATCH` `content_blocks`+`content` 쌍 — 설계 §4.28 ②③) · 리더 `components/MarkdownView`(초안 렌더 재사용) · lazy 라우트 전례 `App.tsx:36`(`TrashPage`) · 내비 단일 출처 `components/Layout.tsx:21`(`NAV_ITEMS`)·`:44`(`TRASH_NAV_ITEM`) · 하단 탭바 5 불변(F38) · 캡처 화면·API 훅 **0** |
| **캡처 ④ 폰 획득 제약**(capture §4.5 · R44) | 제약 명시(코드 = 파일 입력 1종) | `http://<PC-IP>:8000` 비보안 컨텍스트 → `getUserMedia`·`MediaRecorder`·SW 부재 → `<input capture>`만 | `frontend/src/main.tsx:30~32`(`'serviceWorker' in navigator` 가드 — 비보안에서 조용히 미등록) · `public/sw.js:1~4`(앱 셸만) · `getUserMedia`·`MediaRecorder` 사용 코드 **0** |

**DDL 1(테이블 `capture_items` — 후보 DDL = `capture.plan.md` §5 · 마스터 §6.2는 확정 후 등재 · Alembic 1건 예고) · 신규 엔드포인트 8(§4.33) · 잡 kind +1 · 프롬프트 파일 +1 · 신규 의존 0(권고안) · 새 라우트 2(`/capture` · `/capture/:id`) · 내비 항목 +1(하단 탭바 5 불변) · settings 키 0 · `sources/capture/` 신설(쓰기만 · move/remove 0) · 기존 엔드포인트 무변 · 응답에 정답·해설 0.**

## 2. 확정 규약 (착수 전 결정 — 위임 판정은 확정 · 사용자 소관은 "확정 대기")

- **A. 1단계 소스 종류 = 확정 대기(D-C1 · 권고 사진)**. 이 문서의 B-4·F-2·V·DoD는 사진 기준으로 쓰였다. 녹음으로 확정되면 capture §8 stage-55 범위(STT · 오디오 상한 · 플레이어)를 이 stage로 끌어오고 D-C2를 함께 해소해야 착수 가능(체크리스트 재절단 = 착수 문서화 시).
- **B. 정제 엔진 = 확정 대기(D-C3 · 권고 = 기존 LLM 비전 경로 재사용 · 필기 = 사진과 동일)**. 권고안이면 OCR 의존 0 · codex 선택 = 기존 422 문구(`codex_adapter.py:286`) 재사용 · 엔진·모델 선택 UI = §4.23 게이팅 컴포넌트 재사용.
- **C. N-1 이관 = 확정 대기(D-C4 · 권고 이관 없음)** · **착지 = 확정 대기(D-C5 · 권고 notes 유지)**. 둘 다 권고안이면 이 stage는 notes만 만지고 documents 무접촉.
- **D. 영속 = `capture_items` 테이블 1개(D-C6 위임 확정)** — 후보 DDL `capture.plan.md` §5. 확정 후: 마스터 §6.2에 DDL 등재 + `alembic/versions/<rev>_s54_capture_items.py` + §15 R47 전문(불변 규칙 6). `is_active` 없음(`discarded` 상태) · 물리 삭제 엔드포인트 0.
- **E. 원본 경로 규약(불변 규칙 4)** — `sources/capture/{hash12}_{safe_name}` · `_save_source_file`을 폴더 인자 있는 공용 헬퍼로 승격(중복 구현 0) · 캡처 코드의 파일 조작 = **쓰기 1곳**(없으면 쓰고 있으면 건너뜀) · `shutil.move`·`os.remove`·`unlink`·`rmtree` **0**(invariant `fs-mutate` 신규 검출 = 결함) · 서빙 = `GET /api/capture/{id}/original` id 기반 · DB `original_ref` → `resolve()` + `is_relative_to(CAPTURE_DIR.resolve())` 불충족 = 404(R16).
- **F. 정제 산출·검증(D-C7 위임 확정)** — 프롬프트 `prompts/capture_refine.md` · 산출 = 순수 JSON `{ "raw_text": str, "draft_md": str }` · 검증 = 기존 `_parse_json_payload`·`_looks_truncated`·`_looks_impure` 경로 + 빈 `draft_md` = `invalid_output` · `draft_md` = 순수 내용 Markdown(표현 방언 0 — R26 ⑥) · 창작 금지·`[판독 불가]` 규칙(R46).
- **G. 잡 계약** — kind `capture_refine` · `_label` = "캡처 정제 — {종류 한글} {captured_at 로컬 MM-DD HH:mm}"(서버 완성 · §4.24 ①) · `ref = {capture_id}` · `model?` = §4.24 ④ 규칙 4개 그대로(9곳째) · 취소 = §4.24 ② 그대로(취소·오류 시 status `refining → stored` + `error_info`) · 같은 캡처 `refining` 중 재요청 409 `bad_transition` · 완료 기록 = 한 UPDATE(capture §7 ④).
- **H. 삽입 트랜잭션(capture §7 ⑥)** — `POST /api/capture/{id}/insert { note_id | new_note:{title}, content_blocks, content }` · 서버 = 노트 INSERT/UPDATE(전체 치환 · `PATCH /api/notes/{id}` 의미론 · `blocks_version` 동기) + status `inserted` + `target_note_id` **한 트랜잭션** · 블록 내용 무검증(§4.28 원칙) · `drafted`가 아니면 409 · 노트 비활성/부재 404. 클라이언트 = 기존 노트 선택 시 `GET /api/notes/{id}` 블록 뒤에 초안 블록 append 후 전체 전송.
- **I. provenance 스탬프(D-C8 위임 확정)** — `blocks.ts` `BlockProvenance`에 `source?: 'capture' | 'import' | 'llm'` 가산 · 삽입 직전 초안 블록 **최상위 블록 전부**에 `meta.provenance = { source:'capture', kind, capturedAt, model, sourceRef:'capture/{hash12}_{name}' }` · 사이드카ⓐ 보존 경로 무변(stage-34·37 실측) · 리더 표시 0(D5 착수 금지 · capture §12).
- **J. 화면 규약(screens §5.18 후보안)** — 페이지 2개 lazy(`pages/Capture.tsx`·`pages/CaptureDetail.tsx` 또는 1파일 + 하위 라우트 — 구현 재량) · 내비 = `NAV_ITEMS` 상단 그룹에 '캡처' 1개(사이드바 + 드로어 · **하단 탭바 5 불변**) · 획득 = `<input type="file" accept="image/*" capture="environment">`(D-C9) · 색 = 기존 토큰 클래스만 · 390px 1열 · 진행 = 잡 센터 공용 복원 훅(§4.24 ⑤) · 자동 정제 0(업로드 후 [정제] 클릭 — 사용자 확정 대기 ⓕ 참조) · 자동 삽입 0.
- **K. 크기·형식 상한** — 사진 = 20MB · 매직 바이트 `png|jpg|jpeg|gif|webp`(`_detect_image_magic` 재사용 · 확장자 불신) · 초과/불일치 = 422 `too_large`/`unsupported_media`(서버 완성 문장).
- **L. 고아 이미지 스캔 참조원** — 권고안(사본 0)이면 참조원 무변. `sources/images/` 사본 방식(capture §4.3)을 택할 때만 참조원 ⓓ `capture_items.draft_md`·`raw_text` 추가(R43 감시 조항).
- **확정 대기 요약(사용자 소관)**: D-C1 · D-C2(녹음 단계 시점) · D-C3 · D-C4 · D-C5 + 화면 세부 ⓕ **업로드 직후 자동 정제 여부**(권고 = 자동 0 · 사용자가 [정제] 클릭 — 비용·엔진 선택 기회 · §5.5 "자동 삽입 금지" 정신의 연장. 사진 여러 장 연속 촬영 시 일괄 [정제] 버튼은 후속).

## 3. 체크리스트 (착수 문서화 후 실행 — 구현자가 그대로 실행 가능한 단위)

### B. 백엔드
- [ ] B-1. **DDL·마이그레이션**: 마스터 §6.2 확정 DDL대로 `models.py` `CaptureItem` + `alembic/versions/<rev>_s54_capture_items.py`(upgrade = CREATE TABLE + INDEX · downgrade = DROP) · `alembic upgrade head` 스모크(테스트 DB) · `study.db` 실DB 적용은 사용자 기동 시(시작 스크립트 관례 확인).
- [ ] B-2. **원본 저장 헬퍼 공용화**: `import_service._save_source_file` → 폴더 인자 있는 공용 함수(기본 = `sources/` 직속 · 캡처 = `sources/capture/`) · 기존 호출 2곳 동작 무변(테스트 회귀) · `CAPTURE_DIR` 상수 1곳.
- [ ] B-3. **`routers/capture.py` + `services/capture_service.py` + `schemas/capture.py`(신규)** — §4.33 ① 8개: `POST /api/capture`(multipart · 크기 제한 파서 `_SizeLimitedMultiPartParser` 재사용 20MB · 매직 바이트 판별 · 해시 · 행 INSERT) · `GET /api/capture`(§3 페이지네이션 · `status` 필터 · 기본 `discarded` 제외) · `GET /{id}` · `GET /{id}/original`(R16 가드 · `FileResponse` · `Content-Type = mime`) · `POST /{id}/refine` · `GET /jobs/{job_id}` · `POST /{id}/insert` · `POST /{id}/discard`·`/restore` · `main.py` `include_router` 1줄. 에러 §3 4종 · `detail.reason` 5종(§4.33 ⑤).
- [ ] B-4. **정제 잡 kind `capture_refine`**(`convert_service.py`): `start_capture_refine_job(capture_id, engine, model)` → 기존 큐 등록(`_label` 서버 완성 · `_engine`·`_model`) · `_process_job` 분기 `_do_capture_refine` = 엔진별 프롬프트(CLI = 파일 경로 + Read · API = image 블록 · codex = 422 선반영) · 산출 JSON 검증(규약 F) · 행 UPDATE 한 번(`raw_text`·`draft_md`·`engine`·`model`·status `drafted`) · error/cancelled = status `stored` + `error_info` · `_job_ref` → `{capture_id}` · `model?` 적용 지점 9곳째(공통 헬퍼).
- [ ] B-5. **프롬프트 `prompts/capture_refine.md`**(규약 F ①~⑤ · 창작 금지 · `[판독 불가]` · 순수 JSON 2필드).
- [ ] B-6. **삽입 트랜잭션**(규약 H): `capture_service.insert_into_note` — 노트 INSERT/UPDATE + 캡처 UPDATE 같은 세션 · 예외 시 롤백 · `notes` 서비스 기존 함수 재사용(중복 구현 0).
- [ ] B-7. **테스트 `backend/tests/test_capture.py`**(편성 필수): 전이 표 전건(정상 8 + 409 반례) · 업로드 크기/형식 422 · 원본 서빙 가드(행의 `original_ref`를 `../study.db`로 조작 → 404) · 삽입 롤백(노트 UPDATE 실패 주입 → status 무변) · 응답 스키마에 `answer`·`explanation` 키 부재 · codex 422 · 잡 kind 목록 노출(`GET /api/llm/jobs` `ref.capture_id`) · 엔진 호출 스텁 · 실 `sources/` 무접촉(tmp 픽스처).

### F. 프론트
- [ ] F-1. **타입·훅**: `api/types.ts` `CaptureItem`·`CaptureStatus`·`LlmJobKind`에 `'capture_refine'`·`LlmJobRef.capture_id?` · `api/capture.ts`(`useCaptureList`·`useCapture`·`useUploadCapture`·`useRefineCapture`·`useCaptureJob`·`useInsertCapture`·`useDiscardCapture`·`useRestoreCapture` · 쿼리 키 `captureKeys`) · `utils/jobRoutes.ts` `capture_refine: (ref) => ref.capture_id != null ? \`/capture/${ref.capture_id}\` : '/capture'`.
- [ ] F-2. **`/capture` 목록 페이지(lazy)**: 상단 `[사진 추가]` = `<input type="file" accept="image/*" capture="environment">`(숨김 + 버튼) → 업로드 → 목록 최신 행 · 상태 배지(stored/refining/drafted/inserted/discarded — 토큰 클래스) · 상태 필터 · [버린 항목 보기] 토글 · 빈 상태 문구 + R44 안내 1줄("폰의 카메라 앱으로 찍은 사진을 고릅니다") · 390px 1열.
- [ ] F-3. **`/capture/:id` 리뷰 페이지(lazy)**: 좌/상 = 원본(`<img src="/api/capture/{id}/original">` · 확대 = 새 탭) · 우/하 = 탭 [초안](`MarkdownView` 렌더) · [원문](`raw_text` pre) · 엔진·모델 선택(§4.23 게이팅 컴포넌트 재사용 · 비전 불가 엔진 비활성 사유 표시) · `[정제]`/`[다시 정제]`(`refining` 중 비활성 + 잡 진행 표시 · 재진입 복원 훅) · `[노트에 삽입]`(drafted만 · 모달: 기존 노트 검색 선택 / 새 노트 제목) · `[버리기]`/`[되살리기]` · `error_info` 표시 = 서버 `message` 그대로(§3 · 폴백 mutationFn 1곳).
- [ ] F-4. **삽입 변환(규약 H·I)**: `markdownToBlocks(draft_md)` → 최상위 블록 `meta.provenance` 스탬프 → 기존 노트면 `GET /api/notes/{id}` 블록 뒤 append → `blocksToMarkdown`으로 `content` 재생성 → `POST /api/capture/{id}/insert` → 성공 시 `noteKeys.all`·`captureKeys.all` invalidate + "노트에 삽입했습니다 — [노트 열기]" 1줄.
- [ ] F-5. **`blocks.ts`**: `BlockProvenance.source?: 'capture' | 'import' | 'llm'` 가산 + 주석 "생산 경로 = stage-54 캡처 삽입(F-4)" · 사이드카ⓐ 보존 회귀(기존 테스트 무변 확인).
- [ ] F-6. **내비·라우트**: `App.tsx` lazy 라우트 2 · `Layout.tsx` `NAV_ITEMS` '캡처'(아이콘 · 사이드바 + 드로어 · 하단 탭바 무접촉).
- [ ] F-7. **잡 센터**: `JobCenterPanel` kind 라벨 표시는 서버 `label` 그대로(분기 0) · [화면으로 이동] = F-1 라우트 표.

### V. 검증
- [ ] V-1. `powershell -ExecutionPolicy Bypass -File scripts/run-tests.ps1 -Path backend/tests/test_capture.py` 통과 → `-Full` 전건(684 + 신규) 통과.
- [ ] V-2. `powershell -ExecutionPolicy Bypass -File scripts/invariant-scan.ps1` **PASS**(fs-mutate 신규 검출 0 · physical-delete 신규 0 · 기준선 갱신 0).
- [ ] V-3. `npm run build` 성공 + 엔트리 청크 Δ 기록(기준선 1,522,408 B · 의존 유래 0 · 앱 셸 = 내비 항목 1 수준) · 캡처 페이지 = 별도 청크 확인.
- [ ] V-4. 브라우저 실측(**사용자 기동 `http://localhost:8000`** · claude-in-chrome · 텍스트 우선): ⓐ PC 파일 선택 → 업로드 → 목록 행 ⓑ [정제] → 잡 센터 항목 + 완료 후 초안 렌더 ⓒ [노트에 삽입](새 노트) → 노트 편집 화면에서 블록 존재 + 저장 JSON에 `meta.provenance` 존재(`GET /api/notes/{id}`) ⓓ 기존 노트 append 순서 ⓔ [버리기]/[되살리기] ⓕ codex 선택 시 422 문구 ⓖ 취소 → status `stored` + 재정제 가능 ⓗ 정리: 만든 노트·캡처는 버리기/삭제로 원상복구.
- [ ] V-5. 라이선스: 신규 의존 0 확인(`package.json`·`requirements.txt` diff 0) — 의존이 생겼다면 R40 절차(라이선스 4종 + 전이 의존 실측) 기록.

### D. 문서
- [ ] D-1. 설계 api §4.33 "후보안" 해제 + 실측 확정 표기 · screens §5.18 실측 재개정 · `.design.md` 상태 줄(Design v1.70) · 마스터 §6.2 DDL(착수 문서화 시 등재분) 실측 일치 확인.
- [ ] D-2. `capture.plan.md` §10 D-C 상태 · §13 FB-C 등재 준비 · §12 D5 계측 결과 기록.
- [ ] D-3. `docs/manual/user-manual.html` — "캡처" 절 신설(폰 사진 → 정제 → 리뷰 → 노트 · R44 안내 · 엔진 요건).
- [ ] D-4. `scripts/backlog-scan.ps1` — `capture.plan.md` §9(R44~R47)·§10(D-C)·§13(FB-C) 스캔 추가(출처 6곳째 · PASS 유지) — 스크립트 정비(코드 규율은 문서 정합용).
- [ ] D-5. 완료 절차 §6 전건.

## 4. 이 단계에서 하지 않는 것 (불변 규칙 9 — 이 절이 우선)

- **녹음(recording)·STT**(capture §8 stage-55 · D-C2) — D-C1이 사진이면 오디오 업로드 경로·플레이어·STT 의존 0. **메모(memo)·캔버스 필기** — stage-56·후보.
- **documents 삽입 · 노트→문제/개념 승격 플로우**(stage-57 후보 · D-C5).
- **N-1 ⓐ/ⓑ 이관 도구**(D-C4 = 이관 없음 권고 · 확정 시 재론 종결 기록만).
- **D5 블록 네이티브 리더 뷰 · 리더 provenance 표시 · 편집기 provenance 배지**(capture §12 — 계측 질문만).
- **자동 정제·자동 삽입·일괄 정제**(§5.5 불변 · ⓕ 확정 대기) · **오프라인 큐·재시도 큐** · **HTTPS/자체 서명**(R44 — R12 재론 별도) · **앱 안 카메라 프리뷰·녹음**(비보안 컨텍스트 불가).
- **원본 사진의 노트 동반 삽입·`sources/images/` 사본**(capture §4.3 후자 권고 · stage-56 후보) · **EXIF 파싱·이미지 재인코딩·썸네일 생성**(의존 0).
- **캡처 물리 삭제·휴지통 탭·`is_active`** — `discarded` 상태만 · **FTS 색인** · **캡처 검색**.
- **`sources/capture/` 백업 제외 규칙** — 기본 포함(F27 자동) · 용량 판단은 녹음 단계.
- 기존 반입(convert)·노트 편집기·휴지통·잡 큐 동시성(1개)·엔진 레지스트리 계약 변경 0 · `MarkdownView` 변경 0 · 하단 탭바 항목 추가 0.

## 5. DoD

**실행 검증(구현자·검토자)**
1. V-1~V-3 전건 통과(테스트 신규 ≥ 12 · invariant PASS · build 성공 · 청크 Δ 기록).
2. V-4 ⓐ~ⓗ 브라우저 실측 통과(사용자 기동 서버) · 콘솔 에러 0(`pattern` 필터).
3. 전이 표 전건 · 삽입 롤백 · 서빙 가드 · 응답 무정답 테스트가 코드에 존재(`test_capture.py`).
4. Opus `stage-reviewer` 검토 통과(치명·중요 0 · 경미 전건 처분).
5. 문서 D-1~D-4 반영 · `backlog-scan.ps1` PASS.

**사용자 확인(발행 게이트)**
6. **폰 실기기**(`http://<PC-IP>:8000`): 카메라 앱으로 사진 → [사진 추가] 선택 → 업로드 → [정제] → 초안 검토 → [노트에 삽입] 1회 완주 · R44 체감(앱 안 프리뷰 없음이 정상) 회신 · 치명 0.
7. capture §12 계측 질문 회신("읽기 화면에서 출처를 보고 싶은가") · 실사용 피드백 → `capture.plan.md` §13 FB-C 등재(코드 0).
8. 발행 확정 → §6.

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` **v2.04.1 항목 1개**(핵심 · stage-54 · 실측 수치: 테스트 수 · 청크 Δ · 검토 결과 · DDL 1 · API 8 · 의존 0) · 루트 `VERSION` = `2.04.1`(발행 시).
2. `stage-index.md` 54행: 상태 완료 · 완료일 · 산출 버전.
3. `backlog.md`: "캡처" 행 → §4 종결(`종결(stage-54 · 날짜)` · 후속 단계는 §1에 새 행 "캡처-2단계(녹음)" 등으로 **capture §8 후보를 등재**) · `D5-리더` 행 비고에 계측 결과 · 머리 기준일 줄 갱신.
4. 출처 추기: 별지 `editor-v2.plan.md` §7.3 캡처 불릿 `← 완료(stage-54 · 날짜 · 1단계)` · §10 D5 계측 결과 1구 · `capture.plan.md` 상태 줄·§10·§13 · 마스터 §14 M39 ✅ · §5 F62 실측 1구 · §15 R47 실측 추기 · Design v1.70(api §4.33·screens §5.18 실측 확정) · 마스터 Draft 판번.
5. 매뉴얼 `docs/manual/user-manual.html` 캡처 절(D-3) 확인.
6. `CLAUDE.md` 머리 버전 줄 1곳만(v2.04.1 · 다음 = 미편성 또는 stage-55).
7. §7 완료 기록 작성 · 체크박스 `[x]`(불변 규칙 10).

## 7. 완료 기록

_(착수 후 추기 — 착수 문서화 시점에 D-C 확정 내역·실측 편차·검토 결과·발행 경위를 여기에 남긴다.)_
