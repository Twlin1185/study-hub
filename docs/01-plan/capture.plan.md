# 캡처 파이프라인 계획서 — v2.x 별지 (녹음·사진·메모·필기 → LLM 정제 → 리뷰 → 노트 삽입)

> 상태: **편성 초안 v0.1(2026-09-27 · 문서만 · 코드 0 · DDL 0 — §6 후보 DDL은 이 문서에만, 마스터 §6.2 무접촉) · 사용자 확정 대기 D-C1~D-C5(§10)**. 등록부 `backlog.md` §1 "캡처" 행의 편성 조건("별도 계획서 선행")을 이 문서가 이행한다. 1단계 지시서 = `stage-54-capture-slice-1.plan.md`(**편성 보류 — §10 확정 대기 해소 후 착수**).
> 성격: `editor-v2.plan.md`와 같은 급의 별지 — 캡처 전체(녹음·사진·메모·필기)의 **정본**. 마스터 계획에는 색인만(§5 F62 · §14 M39 · §15 R44~R47 색인 행). 마스터·설계와 어긋나면 **저장 계약(DDL)은 마스터 §6.2 · API는 설계 §4.33 · 화면은 §5.18**이 이기고, 결정·리스크·피드백은 이 문서가 이긴다.
> 승계 정본: `editor-v2.plan.md` §5.5(수명주기·`IngestSource`·`meta.provenance` 예약 — **불변 골격**) · §12-5(착지 = notes) · §10 D5(리더 재론 트리거) · `stage-38-mobile-v2-closeout.plan.md` 규약 D(N-1 ⓐ/ⓑ 재론 이월) · 마스터 §6.3 4(원본 불변) · `CLAUDE.md` 불변 규칙 1~10.
> 스캔 주의: `scripts/backlog-scan.ps1`은 이 문서를 읽지 않는다(출처 5곳 = 마스터 §5·§14·§15 · 별지 editor-v2 §7.3·§9·§10·§13). 이 문서의 R44~R47은 마스터 §15 **색인 행 1줄(`R44~R47`)** + 등록부 §3 개별 행으로 등재하고, D-C·FB-C 행은 등록부에 수동으로 반영한다(스캔 확장은 stage-54 체크리스트 D-4).

---

## 1. 목적·배경

- 강의를 들으며 찍은 **사진**(칠판·교재·손글씨 메모), 강의 **녹음**, 짧은 **메모**를 폰에서 바로 앱에 넣고, LLM이 정제한 초안을 **사람이 검토한 뒤** 노트에 삽입하는 경로를 만든다. 학습 루프(학습→풀이→오답→복습)의 **입력 측**을 넓히는 기능이다.
- v2.00.0(에디터 v2)에서 설계 제약만 반영했다: 블록 공통 `meta.provenance` 예약(`frontend/src/editor2/schema/blocks.ts:31~51` — 생산 코드 0) · `IngestSource` 계약(별지 §5.5) · 착지 = notes(§12-5 — stage-43에서 노트 정식 승격 완료). 이 문서는 그 설계를 **구현 계획**으로 내린다.
- 개인용·홈 네트워크 전용(R12)이다. 외부 노출 없이 PC 서버 + 폰 브라우저만으로 동작해야 한다.

## 2. 현행 기준선 (2026-09-27 코드 실측 — v2.03.1)

| 항목 | 실측 | 캡처에 주는 의미 |
|---|---|---|
| LLM 엔진 호출 | `claude-cli`(`claude -p --output-format stream-json` · 프롬프트에 파일 경로를 주고 **Read 도구로 PDF·이미지 직접 읽음** — `convert_service.py:1638~1646`) · `claude-api`(anthropic SDK 스트리밍 · **이미지 = base64 image 블록** `:716~733`) · `codex-cli`(pypdf 텍스트만 · **이미지 불가 = 422 안내** `codex_adapter.py:285~289`) | **사진 → 텍스트는 기존 엔진 경로로 가능(별도 OCR 라이브러리 0)**. codex는 사진 캡처 엔진 후보에서 제외(§4.23 게이팅 재사용) |
| 잡 큐 | 인메모리 `_JOBS` · **동시 1개** · TTL 1시간 · 취소(프로세스 트리 종료) · 요청 단위 `model?` · kind 9종 공유(`convert_service.py:69,1245~1277,1447,1558~1580` · 프론트 `api/types.ts:1591~1602` · `utils/jobRoutes.ts:10`) | 정제 잡은 **같은 큐의 새 kind 1종**(`capture_refine`)으로 얹는다 — §4.24 계약(목록·취소·일시정지·model) 자동 상속 |
| 산출 검증 | 순수 JSON 강제 · 절단·불순 감지 `_looks_truncated`/`_looks_impure`/`_parse_json_payload`(`:855~898`) · `invalid_output` 오류 계약(§4.11 F40-④) | 정제 산출도 **JSON 1객체**로 받아 같은 검증 경로를 탄다(D-C7) |
| 원본 저장 | 반입 원본 = `sources/{hash12}_{safe_name}`(`import_service.py:129~146` — 있으면 덮어쓰지 않음) · 이미지 = `sources/images/{sha16}.{ext}`(`upload_service.py:96~109` · 10MB 상한 `:19`) · URL 반입 50MB 상한(`convert_service.py:118`) | 캡처 원본 = **`sources/capture/{hash12}_{safe_name}`**(같은 규칙 · 하위 폴더 1개로 반입 원본과 구분 · 불변) |
| 파일 서빙 | `GET /images/{filename}` 정규식 fullmatch + `resolve()`/`is_relative_to`(`main.py:209~217` · R16) | 캡처 원본 서빙은 **id 기반 엔드포인트**(사용자 입력 경로 0) + 같은 루트 종속 검사 |
| 백업 | `sources/` `rglob` zip(F27 · `backup_service.py`) | `sources/capture/`도 **자동 포함**(코드 개정 0) — 단 녹음 원본은 용량 비대(R47) |
| 휴지통·고아 스캔 | 참조원 = documents 5컬럼 + notes 2컬럼 + `import/auto/*.json`(§4.32 ②) · R43 감시 "새 이미지 참조 지점 생기면 참조원 동반 갱신" | 사진 캡처가 `sources/images/` 사본을 만들면(§5 ③) **`capture_items.draft_md`가 새 참조 지점** — 참조원 ⓓ 추가 필수 |
| 블록 스키마 | `BlockProvenance { kind?, capturedAt?, model?, sourceRef? }` · `BlockBase.meta?: BlockMeta`(`blocks.ts:31~51`) · 사이드카ⓐ 보존 실측 완료(stage-34·37) · 별지 §5.5 표기는 `source/captured_at/original_ref`(snake) | **필드명 정본 = `blocks.ts`(camelCase)** · `source` 필드는 구현 시 가산 추가(D-C8) |
| 프로젝션 | `markdownToBlocks`(`editor2/transform/index.ts:55`) · `blocksToMarkdown`(`blocksToMarkdown.ts:706`) · 서버는 블록 JSON을 해석하지 않는다(§4.28 원칙) | 정제 산출 = Markdown → **클라이언트가 블록으로 변환 + provenance 스탬프**(D-C7) |
| 폰 접속 | `http://<PC-IP>:8000`(R12 · HTTPS 없음) · PWA = `sw.js` 앱 셸 캐시(`main.tsx:30~32`) | **비보안 컨텍스트** — `getUserMedia`·`MediaRecorder`·Service Worker 전부 브라우저가 거부한다(R44) → 획득은 `<input type="file" capture>`(네이티브 카메라·녹음 앱) |
| 노트 저장 계약 | `POST /api/notes` · `PATCH /api/notes/{id}`(`content_blocks` + `content` 쌍 · §4.28 ②③) · `notes.content_blocks` 소스 오브 트루스 | 삽입 = 클라이언트가 만든 블록+프로젝션을 **서버가 노트에 기록 + 캡처 상태 전이를 한 트랜잭션**(§7 ⑥) |

## 3. 기존 결정과의 관계 (번복 없음 — 승계·구체화만)

| 기존 결정 | 관계 |
|---|---|
| 별지 §5.5 수명주기 `IngestSource(획득) → 원본 보관 → LLM 정제 잡 → 블록 초안(provenance) → 삽입 리뷰 UI` · 상태 `stored → refining → drafted → inserted \| discarded` · **자동 삽입 금지** | **불변 골격 그대로**. 전사(STT)는 별도 상태가 아니라 `refining` 잡의 **진행 단계(phase)**(§4.11 `progress` 계약 재사용) |
| §5.5 "소스 종류 추가 = 인터페이스 구현 추가일 뿐 블록 스키마·저장 계약 무변" | 종류(`kind`)는 컬럼 값 확장뿐(CHECK 제약 0 — `sources.file_type` 관례) · 블록 스키마 무변 |
| §12-5 착지 = notes · stage-43 노트 정식 승격 완료 | **D-C5(유지 권고)**. documents 삽입은 후속(§8 stage 후보) |
| stage-38 규약 D N-1 ⓐ/ⓑ(notes→documents 이관) "캡처 계획서 시점 재론" | **§11에서 재론 — D-C4(이관 없음 권고)** |
| 별지 §10 D5(블록 네이티브 리더 뷰 재보류 · 트리거 = provenance 리더 수요 실측) | **§12 재론 절차** — 1단계는 트리거 계측만 · D5 착수 0 |
| 불변 규칙 4(`sources/` 반입 원본 불변 · `sources/images/`만 파생물) | 캡처 원본 = 반입 원본과 같은 급(**불변**) · 상태·초안은 DB(파일 재작성 0 · 규칙 4 재개정 불요) |
| R7(LLM 창작 통제 — 미리보기 승인이 최종 방어선) · F45 수신함 정신 | 리뷰 UI = 승인 게이트 · 원문(`raw_text`) 병기 · 자동 삽입 0(R46) |
| D10·R40(GPL 금지 · MPL·MIT·Apache-2.0·BSD만) · R19(서버 파싱 의존은 원칙으로 묶음) | STT 의존은 **D-C2 확정 + 라이선스 확인 절차 후**에만(1단계 = 신규 의존 0 권고) |
| §4.24 잡 센터(전 kind 공유 · 취소 계약 · `model?` 8곳) | kind 10종째 · `model?` 지점 9곳째(순수 추가) |
| R37(초기 청크 기준선 1,522,408 B) | 캡처 UI = lazy 청크(`App.tsx:36` Trash 전례) · 엔트리 증가는 내비 항목 1개 수준(앱 셸) |

## 4. 아키텍처

### 4.1 계층 (별지 §5.1 모듈식 계승)

```
[폰/PC 브라우저]  <input type=file capture>  ──multipart──▶  POST /api/capture (원본 저장 · capture_items 행)
                                                                    │
                       리뷰 화면 /capture/:id  ◀── GET /api/capture/{id} · /original(서빙)
                                                                    │  POST /{id}/refine  → 잡 kind=capture_refine (동시 1개 큐)
                                                                    ▼
                                          [정제 잡] (phase: transcribing? → refining → done)
                                            photo/handwriting/memo : 원본 → LLM 비전 → JSON {raw_text, draft_md}
                                            recording               : 원본 → STT(서버) → raw_text → LLM → {draft_md}
                                                                    │
                                     capture_items.raw_text · draft_md · status=drafted
                                                                    │
       [리뷰 UI] 원본 대조 · 초안 렌더(MarkdownView) · [노트에 삽입] ──▶ 클라이언트 markdownToBlocks + provenance 스탬프
                                                                    ▼
                                POST /api/capture/{id}/insert {note_id | new_note, content_blocks, content}
                                     = 노트 기록 + status=inserted (한 트랜잭션)
```

- **서버는 블록을 만들지도 해석하지도 않는다**(§4.28 원칙 유지). 정제 산출은 Markdown 문자열이고 블록화·provenance 스탬프는 클라이언트 변환 계층(D4)이 맡는다 — provenance 값의 **원천**(kind·captured_at·model·original_ref)은 `capture_items` 행이 제공한다.
- **정제 잡은 기존 큐의 kind 1종 추가**다. 새 워커·새 큐·새 상태 저장소를 만들지 않는다.
- **원본은 절대 수정·삭제하지 않는다**(불변 규칙 4). `discarded`는 상태값일 뿐 파일 무접촉 · 물리 삭제 엔드포인트 0(불변 규칙 3 정신).

### 4.2 `IngestSource` 구현 = `capture_items` 행 (별지 §5.5 계약 → 컬럼 대응)

| §5.5 계약 필드 | 구현 | 비고 |
|---|---|---|
| `kind` | `capture_items.kind` — `photo` \| `recording` \| `memo` \| `handwriting` | 1단계 = D-C1 확정 종류만 수용(그 외 = 422) |
| `original_ref` | `capture_items.original_ref` — `sources/capture/` 상대경로 `{hash12}_{safe_name}` | 원본 불변 · 같은 해시 = 같은 파일(덮어쓰기 0) |
| `captured_at` | `capture_items.captured_at` — 클라이언트 `File.lastModified` → 없으면 서버 수신 시각 | 폰 사진의 EXIF 파싱은 하지 않는다(의존 0 · YAGNI) |
| `status` | `capture_items.status` — `stored → refining → drafted → inserted \| discarded` | 전이 규칙 = §7 ② |

### 4.3 원본 보관 경로

- `sources/capture/{hash12}_{safe_name}` — `import_service._save_source_file` 규칙 재사용(공용 헬퍼로 승격 · 폴더 인자만 추가). 하위 폴더를 두는 이유: 반입 원본(`sources/` 직속)과 섞이지 않게 · 백업 zip 자동 포함 · 고아 스캔(§4.32 ② "`sources/` 밖 파일은 스캔 대상 자체가 아니다") 무접촉.
- **사진 캡처의 `sources/images/` 사본(선택 · D-C3 확정 시 결정)**: 리뷰 썸네일과 "원본 사진을 노트에 함께 삽입" 옵션을 위해 `upload_service._store_image` 규칙(`{sha16}.{ext}`)으로 **사본 1개**를 더 만든다(앱 파생물 — 불변 규칙 4 개정 범위 안 · 고아 스캔 대상). 이 사본 경로는 `capture_items.draft_md`가 참조할 수 있으므로 **고아 스캔 참조원 ⓓ = `capture_items.draft_md`·`raw_text`** 를 추가한다(R43 감시 조항 이행). 사본을 두지 않는 대안 = 리뷰 썸네일을 `GET /api/capture/{id}/original`로 서빙하고 노트 삽입은 텍스트만 — 1단계는 **후자(사본 0)** 를 권고한다(파일 이중화·참조원 확장 0 · 원본 사진 삽입은 후속 FB로).

### 4.4 정제 엔진·프롬프트

- 엔진 선택·게이팅 = §4.23 그대로(`assert_engine_selectable` · 활성 토글 · 모델 소목록). **사진·필기·메모 이미지 = 비전 가능 엔진만**(claude-cli · claude-api). codex 선택 시 = 기존 문구 그대로 422(`codex_adapter.py:286` 재사용 · 코드 신설 0).
- 프롬프트 템플릿 = `prompts/capture_refine.md`(신규 · `prompts/convert.md`와 같은 자리). 규칙: ① 원문에 **없는 내용 창작 금지**(R7 계열 — 판독 불가 부분은 `[판독 불가]`로 표시) ② 산출 = 순수 JSON 1객체 `{ "raw_text": "...", "draft_md": "..." }` ③ `draft_md`는 **순수 내용 Markdown**(표현 방언 `==`·`++`·`::: ` 등 0 — R26 ⑥ "변환 프롬프트는 순수 내용만" 관례) ④ 헤딩·목록·표까지만(코드 블록은 원문이 코드일 때만) ⑤ 언어 = 원문 언어 유지.
- 산출 검증 = 기존 `_parse_json_payload` 경로 + 필드 2개 문자열 검사(빈 `draft_md` = `invalid_output`).
- **STT(녹음)는 2단계** — 엔진 = D-C2. 서버 프로세스 안 CPU 추론(faster-whisper 권고안)이면 잡 취소 = 세그먼트 경계에서 `_raise_if_cancelled` 확인(§4.24 ② "부분 과금" = 시간). 전사 텍스트는 `raw_text`에 저장해 **재정제 시 STT를 다시 돌리지 않는다**.

### 4.5 폰 획득 (R44 — 비보안 컨텍스트)

- `http://<PC-IP>:8000`은 비보안 컨텍스트라 `navigator.mediaDevices.getUserMedia`·`MediaRecorder`·`navigator.serviceWorker`가 **존재하지 않는다**(브라우저 규격 — `[SecureContext]`). 따라서 앱 안 녹음·앱 안 카메라 프리뷰는 **불가능**하고, 획득은 `<input type="file" accept="image/*" capture="environment">`(사진) · `<input type="file" accept="audio/*">`(녹음 — 네이티브 녹음 앱 파일 선택)로 한다. PC(`localhost`)는 보안 컨텍스트라 동작하지만 **표면을 둘로 만들지 않는다**(파일 입력 1종만 · D-C9).
- HTTPS(자체 서명 인증서) 도입은 이 계획서 범위 밖 — 실수요가 생기면 R12 재론과 함께 별도 등재(§13 후보).
- 오프라인 큐(전송 실패분 보관)는 하지 않는다 — 실패 = 사용자에게 즉시 표시 · 재시도 = 다시 선택(§9 R44 대응).

## 5. 데이터 모델 영향 (초안 — 확정 시 마스터 §6.2 + Alembic · 불변 규칙 6)

- **영속 방식 = DB 테이블 1개 `capture_items`(D-C6 · 기술 위임 판정)**. 파일 사이드카(`sources/capture/*.json`) 대안 기각 근거: ① 상태 전이가 파일 재작성이 되어 `sources/` "원본 불변" 원칙과 충돌(규칙 4 3차 개정 필요) ② 잡 TTL 1시간을 넘겨 며칠 뒤 리뷰하는 것이 정상 사용이라 상태는 **서버 재시작을 넘겨 남아야** 한다(인메모리 불가) ③ 목록·상태 필터·노트 연결(`target_note_id`)은 SQL이 자연스럽다 ④ 백업 = VACUUM INTO 자동 포함(코드 0 — R41 ③ 전례). `sources` 테이블 재사용도 기각: `sources`는 반입(import)→문서 연결 의미이고 캡처는 문서를 만들지 않는다(의미 혼합 회피).
- **후보 DDL(정본은 확정 시 마스터 §6.2 — 이 문서의 사본은 그때 "§6.2 참조"로 대체)**:

```sql
-- 캡처 항목 (F62 · M39 — IngestSource 영속. 원본 파일은 sources/capture/ 불변 · 상태·초안만 DB)
CREATE TABLE capture_items (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL,                  -- 'photo'|'recording'|'memo'|'handwriting' (CHECK 없음 — sources.file_type 관례)
  original_ref   TEXT NOT NULL,                  -- sources/capture/ 상대경로 `{hash12}_{safe_name}` — 원본 불변(규칙 4)
  file_hash      TEXT NOT NULL,                  -- SHA-256(재업로드 감지 — 같은 해시 = 같은 파일)
  mime           TEXT NOT NULL,                  -- 매직 바이트 판별 결과(확장자 아님 — §4.18 ②-3 관례)
  bytes          INTEGER NOT NULL,
  captured_at    DATETIME NOT NULL,              -- 클라이언트 lastModified → 없으면 수신 시각(UTC)
  status         TEXT NOT NULL DEFAULT 'stored', -- 'stored'|'refining'|'drafted'|'inserted'|'discarded' (별지 §5.5 골격 — 전이 = 설계 §4.33 ②)
  engine         TEXT,                           -- 마지막 정제 엔진 id(provenance.model의 원천과 짝)
  model          TEXT,                           -- 마지막 정제 유효 모델(§4.23 ⑤ selected_model 산출값)
  raw_text       TEXT,                           -- 전사/판독 원문(정제 전) — 리뷰 대조용 · FTS 미색인
  draft_md       TEXT,                           -- LLM 정제 초안(순수 내용 Markdown) — 블록화는 클라이언트(§4.28 원칙)
  target_note_id INTEGER REFERENCES notes(id),   -- inserted 시 착지 노트(노트 소프트 삭제와 무관 — 참조만)
  error_info     TEXT,                           -- 마지막 정제 실패 요약 JSON(§4.11 error_info 계약 · 성공 시 NULL)
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_capture_items_status_created ON capture_items(status, created_at DESC);  -- 목록(상태 필터 · 최신순)
```

- `is_active` 컬럼 없음 — `discarded`가 소프트 상태. 물리 삭제 엔드포인트 0. 휴지통(§5.17) 탭 추가는 후속(실수요 후).
- FTS 미색인(notes와 같은 판정 — 초안은 삽입 후 노트가 담는다).
- Alembic: `backend/alembic/versions/<rev>_s54_capture_items.py`(`630a4c2531e8_s33_notes.py` 전례) — **DDL 확정(§10 D-C1·D-C5 해소) 후 착수 문서화 시점에 §6.2 등재와 함께**. 그때 마스터 §15 **R47 전문**을 등재한다(불변 규칙 6 절차 — R41·R42 전례).

## 6. API 초안 (정본 = 설계 `study-app.design.api.md` **§4.33 `[S54]`** — 후보안(확정 대기) 표기 · 여기서는 요지만)

| 메서드/경로 | 요지 |
|---|---|
| `POST /api/capture` | multipart(`file` + `kind` + `captured_at?`) → 원본 저장 + 행 생성 · `200` CaptureItem(status `stored`) |
| `GET /api/capture?status=&page&size` | 목록(§3 페이지네이션 · 기본 `status` 미지정 = `discarded` 제외) |
| `GET /api/capture/{id}` | 상세(`raw_text`·`draft_md` 포함) |
| `GET /api/capture/{id}/original` | 원본 서빙(썸네일·오디오 재생 — id 기반 · R16 루트 종속 검사 · `Content-Type` = 저장된 `mime`) |
| `POST /api/capture/{id}/refine` | 정제 잡 등록(`engine?`·`model?` — §4.23·§4.24 ④ 규칙) → `202 {job_id}` · status `refining` |
| `GET /api/capture/jobs/{job_id}` | 잡 상태(§4.11 `status`·`progress`·`error_info` 계약 그대로 · done = `{capture_id}`) |
| `POST /api/capture/{id}/insert` | `{ note_id \| new_note:{title}, content_blocks, content }` → 노트 생성/추가 + status `inserted` **한 트랜잭션** · `200 {capture, note_id}` |
| `POST /api/capture/{id}/discard` · `/restore` | `discarded` ↔ 직전 상태(`drafted` 또는 `stored`) · 멱등 · 파일 무접촉 |

- 잡 센터(§4.24): kind `capture_refine` · `ref = {capture_id}` · label 서버 완성("캡처 정제 — 사진 09-27 14:03") · `jobRoutes.ts` → `/capture/{id}` · `model?` 지점 9곳째.
- 에러 = §3 4종 불증 · `detail.reason`: `unsupported_kind` · `unsupported_media` · `too_large` · `engine_no_vision`(codex 사진) · `bad_transition`(409).
- **응답 어디에도 정답·해설 필드 없음**(불변 규칙 1 — 캡처는 문서·퀴즈와 무관).

## 7. 상태 전이·트랜잭션 규약

- ① 생성: 업로드 성공 = 원본 파일 기록 **후** 행 INSERT(파일 없이 행 없음 · 행 없이 파일은 있을 수 있음 — 재업로드가 같은 해시로 수렴하므로 무해).
- ② 전이 표: `stored→refining`(refine) · `refining→drafted`(잡 done) · `refining→stored`(잡 error/cancelled — `error_info` 기록 · 초안 무변) · `drafted→refining`(재정제 — 종전 초안은 done 시 덮어씀) · `drafted→inserted`(insert) · `stored|drafted→discarded`(discard) · `discarded→직전`(restore) · **`inserted`는 종착**(재삽입 = 노트에서 복사 · 캡처 재사용 0). 그 외 = 409 `bad_transition`.
- ③ 정제 잡 동시성: 같은 캡처에 `refining` 중 재요청 = 409. 큐 동시 1개(§4.24) 그대로.
- ④ 잡 완료 기록: 워커가 `raw_text`·`draft_md`·`engine`·`model`·status를 **한 UPDATE**로 기록(`_process_job` 안 DB 세션 관례 — `_do_convert` 전례).
- ⑤ 취소-완료 레이스 = §4.24 ⓑ 그대로(완료 승리 · 취소 우선 시 산출 폐기 → status `stored`).
- ⑥ 삽입 = **한 트랜잭션**: (a) `new_note`면 `notes` INSERT / `note_id`면 해당 노트(활성 · 404) UPDATE — 본문은 요청의 `content_blocks`·`content` **전체 치환**(클라이언트가 기존 블록 + 초안 블록을 합쳐 보낸다 — `PATCH /api/notes/{id}` 의미론과 동일 · `blocks_version` 동기) (b) `capture_items` status `inserted` + `target_note_id`. 실패 시 둘 다 롤백. 서버는 블록 내용을 검증하지 않는다(§4.28 원칙 · provenance 스탬프 유무도 검사 0).
- ⑦ 노트 삭제·복원과 캡처는 독립(참조만 · 캡처 `inserted` 유지).

## 8. 단계 분할 (stage-54 = 1단계 최소 수직 슬라이스 · 후속은 **후보** — 편성은 각각 `/stage-plan`)

| 단계 | 범위 | 신규 의존 | DDL | 조건 |
|---|---|---|---|---|
| **stage-54 (1단계 · 이 편성)** | D-C1 확정 소스 1종(권고 = **사진 photo** — 손글씨 사진 포함)의 **전 수명주기**: 업로드 → 원본 보관 → LLM 비전 정제 잡 → 리뷰 화면 → 노트 삽입/버리기 · `capture_items` 신설 · 잡 센터 kind 추가 · 내비 항목 1 · 폰 `<input capture>` | **0**(권고안 기준) | `capture_items` 1 | §10 D-C1~D-C5 확정 |
| stage-55 후보 | **녹음 recording**: 오디오 업로드(별도 상한 · 스트리밍 저장) → STT(D-C2) → `raw_text` → LLM 정제 → 동일 리뷰·삽입 · 리뷰 화면 오디오 플레이어 | STT 1건(D-C2 · 라이선스 절차 R40) | 0(컬럼 재사용) | stage-54 완료 + D-C2 확정 + R45 실측(모델 크기·CPU 시간) |
| stage-56 후보 | **메모 memo**(텍스트 입력 → 정제) · **원본 사진 노트 동반 삽입**(§4.3 사본 방식) · 노트 편집 화면 안 [캡처에서 삽입] 진입 | 0 | 0 | 1단계 실사용 피드백(§13) |
| stage-57 후보 | **documents 삽입 리뷰**(§5.5 "문서 삽입은 리뷰 UI 경유") · 노트 → 문제/개념 승격 플로우(§12-5) | 0 | 0(§4.29 전환 규약 동반 검토 · R42) | 실수요 · D7-잔여와 교차 |
| 후보(미배정) | 스타일러스 캔버스 필기(앱 안 그리기) · HTTPS 자체 서명(앱 안 녹음·카메라) · 휴지통 캡처 탭 · D5 리더 재론(§12) | 미정 | — | 실수요 실측 후 §13 등재 → 등록부 |

## 9. 신규 리스크 (정본 — 마스터 §15에는 색인 행 `R44~R47` 1줄 · 등록부 §3 개별 행)

| # | 리스크 | 대응 |
|---|---|---|
| R44 | **폰 비보안 컨텍스트(`http://<PC-IP>:8000`)** — `getUserMedia`·`MediaRecorder`·Service Worker가 부재해 앱 안 녹음·카메라 프리뷰·PWA 설치가 안 된다(별지 §5.5 "PWA로 커버" 전제의 부분 무효). 사용자가 "앱에서 바로 녹음"을 기대하면 체감 결함 | 획득 = `<input type="file" capture>` 1종(네이티브 카메라·녹음 앱 경유 — 비보안 컨텍스트에서도 동작)으로 **표면 고정(D-C9)** · 화면 문구로 "폰의 카메라/녹음 앱으로 찍고 고르는 방식"을 1회째부터 명시 · HTTPS 도입은 R12 재론과 함께 별도 등재(이 계획서 범위 밖) · PC `localhost`도 같은 파일 입력(표면 이원화 0) · **stage-54 DoD에 폰 실기기 확인 포함** |
| R45 | **STT 의존(2단계)** — 모델 크기(수백 MB~GB) · 임베디드 파이썬 wheel 가용성(ctranslate2 등 바이너리) · CPU 처리 시간(강의 1시간 = 수십 분) · 한국어 품질 · 라이선스(D10) · 외부 API면 녹음 유출·비용(R12 정신) | **D-C2 사용자 확정 없이는 착수 0** · 권고 = 로컬 faster-whisper(MIT · CTranslate2 MIT · 모델 MIT — 확정 시 R40 절차로 전이 의존까지 실측) · 처리 시간은 잡 `progress`(세그먼트 진행률 · ETA 표본 `_record_eta_sample` 재사용)로 정직 표기 · 취소 = 세그먼트 경계 · **전사 결과 `raw_text` 보존으로 재정제 시 STT 재실행 0** · 모델 다운로드는 사용자 명시 조작(설정 카드 · 자동 다운로드 0 — `install_engine` 전례) |
| R46 | **정제 창작·왜곡(R7 계열)** — 판독 불가 사진·오전사 위에 LLM이 그럴듯한 내용을 지어내면 잘못된 노트가 학습 루프에 들어간다. 사진은 원문 대조 게이트(§4.17 ⑥)가 없다(원문이 텍스트가 아님) | **자동 삽입 0 · 리뷰 필수**(§5.5 불변) · 리뷰 화면에 **원본(사진/오디오)과 `raw_text`를 초안 옆에 병기** · 프롬프트에 창작 금지 + `[판독 불가]` 표기 규칙 · provenance `model` 기록으로 사후 추적 · 삽입된 블록은 노트 편집기에서 provenance 배지(후속 · D5 트리거 계측 §12) |
| R47 | **`capture_items` 테이블 신설 + `sources/capture/` 폴더 + 대용량 원본** — Stage 1 이후 스키마 변경(불변 규칙 6 절차) · 백업 zip이 녹음 원본으로 비대(F27) · 사진 사본을 두면 새 이미지 참조 지점(R43) | 확정 시 §6.2 등재 + Alembic 1건 + 이 행 전문을 마스터 §15에 등재(R41·R42 전례) · 1단계 사진은 원본 20MB 상한 · 녹음 상한·백업 제외 여부는 stage-55에서 결정(백업 제외 = `sources/capture/` 예외 규칙 = 별도 결정 · 기본 = 포함) · 사진 사본 방식 채택 시 고아 스캔 참조원 ⓓ 동반(§4.3) · 물리 삭제 0 |

## 10. 착수 전 결정 (D-C — 사용자 확정 대기 = D-C1~D-C5 · 기술 위임 판정 = D-C6~D-C9)

| # | 결정 | 권고안 · 근거 | 상태 |
|---|---|---|---|
| **D-C1** | **1단계 소스 종류** — ⓐ 사진(photo · 손글씨 사진 포함) / ⓑ 녹음(recording) / ⓒ 둘 다 | **ⓐ 사진 권고**: 신규 의존 0(기존 엔진 비전 경로) · 원본 작음(백업·상한 단순) · 잡 수 초 단위(리뷰 UX 검증에 적합) · 폰 `<input capture=environment>`가 가장 자연스러움 · 파이프라인 골격(DDL·잡 kind·리뷰·삽입)을 먼저 세우면 녹음은 STT 1단만 얹는다(§8 stage-55). ⓑ는 STT 결정(D-C2)·처리 시간·용량 리스크(R45·R47)를 1단계에 다 끌어들인다 | **사용자 확정 대기** |
| **D-C2** | **STT 엔진**(녹음 단계) — ⓐ 로컬 faster-whisper(MIT · CPU) / ⓑ 로컬 whisper.cpp 바이너리(MIT) / ⓒ Vosk(Apache-2.0 · 경량 · 한국어 품질 낮음) / ⓓ 외부 API(OpenAI Whisper API 등 — 유료 · 녹음이 외부로 나감) | **ⓐ 권고**: 라이선스 D10 적합 · pip 설치 가능(바이너리 wheel — 임베디드 파이썬 실측 필요) · 한국어 품질 = whisper 계열 최상 · 오프라인(R12 정신 · 녹음 유출 0). ⓓ 기각 근거 = 개인 녹음 외부 전송 + 종량 비용 + 키 관리. **1단계(D-C1=ⓐ)면 이 결정은 stage-55 편성 시로 미룬다** | **사용자 확정 대기(시점 = 녹음 단계 편성)** |
| **D-C3** | **OCR·정제 엔진** — ⓐ 기존 LLM 엔진 비전(claude-cli Read · claude-api image 블록) 재사용 / ⓑ 별도 OCR(tesseract·easyocr 등) + LLM 정제 2단 · **필기 = 손글씨 사진 → ⓐ와 동일 경로인가** | **ⓐ 권고 + 필기 = 사진과 동일 경로**: 코드 실측상 이미지 → LLM은 이미 있는 경로(§2) · 별도 OCR은 의존(tesseract 바이너리 · easyocr = torch) + 한글 손글씨 품질 저하 · LLM 비전이 판독+정리를 한 번에 함. codex는 제외(422 기존 문구). 스타일러스 캔버스 필기(앱 안 그리기)는 별개 표면 — 후보(§8) | **사용자 확정 대기** |
| **D-C4** | **N-1 ⓐ/ⓑ 재론 — notes→documents 이관 여부**(§11) | **이관 없음(ⓒ 유지) 권고** — §11 근거 4건 | **사용자 확정 대기** |
| **D-C5** | **착지 표면 = notes 우선 유지 여부**(documents 직접 삽입을 1단계에 넣는가) | **notes 우선 유지 권고**: §12-5 기조 · 노트는 stage-43으로 정식 표면 · documents 삽입은 §4.29 전환 규약(R42)·문서 타입(문제/개념)·분류 연결까지 얽혀 1단계 슬라이스를 두 배로 만든다 → stage-57 후보 | **사용자 확정 대기** |
| D-C6 | 영속 = DB 테이블 `capture_items` 1개(파일 사이드카·`sources` 재사용 기각) | §5 근거 4건 · DDL 문안 확정은 D-C1·D-C5 해소 후 §6.2 등재 | 위임 판정 확정(2026-09-27) — DDL 문안만 대기 |
| D-C7 | 정제 산출 = JSON `{raw_text, draft_md}`(Markdown) · 블록화·provenance 스탬프 = 클라이언트 `markdownToBlocks` | 서버 블록 무해석 원칙(§4.28) 유지 · 기존 JSON 검증 경로 재사용 · 손실 규칙은 §14(R34) 범위 안(순수 내용 Markdown이라 블록 손실 0) | 위임 판정 확정(2026-09-27) |
| D-C8 | provenance 필드명 정본 = `blocks.ts`(camelCase: `kind`·`capturedAt`·`model`·`sourceRef`) + **`source?: 'capture'\|'import'\|'llm'` 가산 추가**(별지 §5.5의 snake 표기는 개념 수준 — 코드가 정본) · 값: `source='capture'` · `kind`=캡처 종류 · `sourceRef`=`capture/{hash12}_{name}` · `model`=유효 모델 · 미지 필드 보존 유지 | 마스터 §6.2 주석 "스키마 정본 = blocks.ts" · 사이드카ⓐ 보존 실측(stage-34·37) · 프로젝션 손실 = `block:meta`(별지 §14 7번 기재 완료 — 추가 기재 0) | 위임 판정 확정(2026-09-27) |
| D-C9 | 폰·PC 획득 = `<input type="file" capture>` 1종(앱 안 녹음·카메라 프리뷰 0) | R44 · 표면 이원화 0 | 위임 판정 확정(2026-09-27) |

- 확정 절차: 사용자 회신 → 이 표 상태 갱신(`✅ 확정 날짜`) → **착수 문서화**(설계 §4.33·§5.18 "후보안" 표기 해제 · 마스터 §6.2 DDL 등재 + Alembic 예고 + §15 R47 전문 · stage-54 상태 줄 "착수 전") → `/stage-implement 54`. 확정 전 코드 0.

## 11. N-1 ⓐ/ⓑ 재론 (stage-38 규약 D 이월분 — D-C4)

- 재론 대상: ⓐ 정식 승격(= **stage-43으로 완료** — 사이드바·드로어 노출 · 잔여 = FTS·인쇄 통합 = 등록부 "노트-FTS·인쇄" 행 별도) / ⓑ documents 이관 후 notes 퇴역 / ⓒ 존치(현행).
- **권고 = ⓑ 이관 없음 · ⓒ 유지** — 근거: ① §12-5 "노트 = 캡처의 착지 표면"이 이 계획서의 전제라 ⓑ는 착지 표면 소멸(정면 충돌) ② ⓐ의 본체(승격)는 이미 완료 — 남은 것은 검색·인쇄 통합이지 이관이 아니다 ③ 이관은 `documents` 타입(문제/개념/플래시카드) 강제 분류·분류 연결·§4.29 블록 전환 규약을 노트 데이터에 소급 적용하는 데이터 거취 작업 — 실수요 0 ④ notes→documents **승격 플로우**(노트에서 문제/개념 문서 만들기 — §12-5 후반)는 이관이 아니라 **복사 생성**이며 stage-57 후보로 다룬다.
- 확정 시 처리: `backlog.md` 캡처 행 비고 "N-1 ⓐ/ⓑ 재론 동반" → "재론 종결(이관 없음 · capture.plan.md §11)" · stage-38 규약 D·screens §5.16 line 327의 "v2.x 캡처 계획서 시점 재론" 문구에 `← 재론 종결(날짜)` 1구 추기(이력 무수정).

## 12. D5(블록 네이티브 리더 뷰) 재론 절차 — 착수 0 · 계측만

- D5 재론 트리거(별지 §10 D5 ④) = "블록 전용 표현(provenance)의 **리더 수요 실측**". 1단계는 provenance를 **저장만** 하고 리더(`MarkdownView`)에는 표시하지 않는다(프로젝션은 메타를 버림 — 별지 §14 7번 · 손실 수용).
- 계측 = stage-54 DoD 사용자 확인 항목에 질문 1개("삽입된 블록의 출처(사진·시각)를 노트 **읽기 화면**에서도 보고 싶은가")를 넣고, 회신이 "예"면 §13에 FB-C 등재 → 등록부 `D5-리더` 행 상태를 "재론 착수 가능(트리거 충족)"으로 갱신 → 별도 착수 전 결정(리더 교체 vs 편집기 안 배지만) — **R37 정면 충돌**(BlockNote 렌더 초기 청크)이라 임의 착수 금지 유지.
- 편집기 안 provenance 배지(편집 표면 한정 · 리더 무접촉)는 D5와 무관한 소규모 후속 — 실수요 시 §13 등재.

## 13. 실사용 피드백 로그 (FB-C-n — 이 별지 등재 정본 · 등록부 1행 동반)

_(빈 절 — stage-54 실사용부터 추기. 형식 = `editor-v2.plan.md` §13과 동일: `| FB-C-1 | 성격 | 내용(원문·실측) | 배정 |`)_

## 14. 검증 전략

- 백엔드: `backend/tests/test_capture.py`(편성 필수 — 상태 전이 표 전건 · 경로 가드(R16: `original_ref`가 `sources/capture/` 밖이면 404) · 삽입 한 트랜잭션(노트 UPDATE 실패 시 status 롤백) · 응답에 정답·해설 필드 부재 · codex 422 · 크기 상한 422) · 잡 워커는 엔진 호출을 스텁(기존 convert 테스트 관례).
- 프론트: `npm run build` 성공/실패 · 엔트리 청크 Δ(R37 기준선 1,522,408 B · 캡처 페이지 = lazy) · 브라우저 실측은 **사용자 기동 서버**에서(구동 금지).
- 실기기: 폰(`http://<PC-IP>:8000`)에서 사진 선택 → 업로드 → 정제 → 삽입 1회 완주 + R44 확인(`<input capture>` 동작 · 앱 안 프리뷰 없음이 정상).
- 불변: `invariant-scan.ps1` PASS(fs-mutate 신규 검출 0 — 캡처는 파일 쓰기만 · move/remove 0) · `run-tests.ps1`.
