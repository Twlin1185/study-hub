# Stage 52 — 통합 휴지통: 문서·노트 복원 + 고아 이미지 2단계 정리 (D8-구현) (v2.0.x · 핵심)

> 상태: **구현·검토 완료 → v2.03.1 발행 대기**(2026-09-15 · Opus 검토: 1차 조건부 통과(치명 0 · 중요 1 · 경미 4) → 반영 후 재검토 통과(잔존 0 · 2026-09-15) · 잔여 = V-3 브라우저 실측(사용자 기동 서버) + DoD 6 실사용 회신 → `VERSION` bump · 편성 2026-09-14 · 사용자 확정 = D8-구현 단독 · 번호 52 · 범위 "통합 휴지통" ①②③ · FB-24 ⓒ 미동승).
> **버전 영향: 핵심**(초안 = 사용자 확정 2026-09-14 · 근거 병기 — CHANGELOG 규약 ③): **새 기능 표면**(휴지통 화면 `/trash` — 종전 0 ·
> 소프트 삭제분을 되살릴 UI가 처음 생김) + **신규 API 7개**(문서·노트 복원 2 + 휴지통 목록 2 + 고아 스캔·이동·되돌리기 3 — 저장 계약
> 추가 · "복구 엔드포인트 없음"(§4.28 ⑥) 봉인 해제) + **불변 규칙 4 명시 개정**(운영 규약 변경). 선례 = stage-51(표면 신설 = 핵심).
> → 산출 버전 **v2.03.1 예정**(규약 ② 핵심 = MM+1·PP=1 · 현재 v2.02.1 발행 · 발행 대기 사소 stage 0이라 단독 발행). **마스터 §14 로드맵
> M38 행 추가**(핵심 stage) · **F61 색인 행 부여**(D8 정본은 F 미부여 — 기능 표면이 새로 생기므로 부여).
> 생성 경위: `backlog.md` §1 `D8-구현`(별지 §10 D8 — 2026-08-23 사용자 확정 ⓑ "2단계 정리 · 삭제 주체 = 항상 사용자 · 앱 자동 삭제 0" ·
> 구현 시점 = v2.x 편성 시 배정) + 별지 §13 FB-24 ⓒ의 전제("복구 UI 선행")가 이 stage로 충족된다. 사용자 확정 2026-09-14 = **D8-구현 단독 ·
> 범위 = ① 문서·노트 소프트 삭제분 목록 + 복원(현재 복원 엔드포인트 0) ② 고아 이미지 식별 → 휴지통 폴더 이동(최종 삭제 = 사용자 수동 ·
> 앱 자동 삭제 0) ③ 불변 규칙 4 명시 개정**. FB-24 ⓒ(분류 삭제 시 문서 동반 소프트 삭제)는 동승하지 않는다(§4).
> 정본 포인터: API 계약 = api §4.2 표 `[S52]` 복원 행 + §4.28 ① `[S52]` 복원 행 + **`### 4.32 [S52]` 절**(휴지통 목록·복원·고아 스캔·이동·
> 되돌리기 · 에러 표 — 편성 추기 **Design v1.65**) · 화면 계약 = screens **§5.17 휴지통** 신설 + §5.11 설정 ⑤ 데이터 카드 1줄 + §5.2·§5.3·§5.16
> 삭제 문구 1줄 · 에러 포맷 = 설계 §3(코드 4종 불증) · 불변 규칙 1(응답에 정답 0 — 목록 아이템 재사용)·2(attempts 무접촉)·3(복원 = `is_active=1`
> UPDATE만 · 물리 삭제 0)·**4(이 stage에서 개정 — 규약 D)**·5(토큰만)·6(DDL 0)·8 · 발행 절차 = CHANGELOG 머리 규약 ⑤ · R16(파일 경로에 닿는
> 사용자 입력 = 정규식 + 루트 종속 검사).

## 1. 범위 (백엔드 7 엔드포인트 + 서비스 1파일 신설 · 프론트 라우트 1 + 설정 카드 1 + 문구 4곳 · 규칙 개정 2곳 — 코드 실측 2026-09-14)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **D8-구현 ① 문서·노트 복원**(backlog §1 17행 · 별지 §10 D8 397행 · 마스터 §15 R41 ③④ "복구 UI 없음") | 신규 API + 표면 | 소프트 삭제분(`is_active=0`) 목록 2종 + 단건 복원 2종 | 문서: `backend/routers/documents.py:128` `DELETE /{document_id}` → `services/document_service.py:424~427` `soft_delete_document` = `is_active=0` + commit(링크·태그·북마크·attempts·srs 무접촉) · `:934~936` `_bulk_delete` 동일 · 목록 `list_documents:234~250` `include_inactive` 플래그(활성+비활성 **혼합**만 — "비활성만" 필터 0 · 라우터 `:42` 노출) · 복원 엔드포인트 **0**(`PATCH`는 `is_active`를 받지 않음). 노트: `routers/notes.py:232~240` `delete_note` = `is_active=0` 멱등 · `:193` `GET /{id}` 삭제분 200 · `:199` `PATCH` `is_active` 미수용 · `:126~136` `_list_notes` `include_inactive` 혼합만 · `:243~247` 복제는 삭제분 404(복구 우회 차단 — §4.28 ⑦) · 복원 엔드포인트 **0**. `updated_at`은 `models.py:82~85`(documents)·`:337~341`(notes) `onupdate=current_timestamp` → 소프트 삭제 시 갱신됨(= "삭제 시각" 대용 · DDL 0 근거). 프론트: 삭제 확인 문구 4곳 `pages/Explore.tsx:559`("휴지통 없이 숨겨지며") · `pages/DocumentDetail.tsx:531` · `editor2/pages/NoteListPage.tsx:210` · `editor2/pages/NoteEditPage.tsx:702`("목록에서 사라집니다") · 훅 `api/documents.ts:122` `useDeleteDocument` · `editor2/api/notes.ts:135` `useDeleteNote`(`noteKeys.all` invalidate) · 라우트 표 `App.tsx:40~85`(`/trash` 없음) |
| **D8-구현 ② 고아 이미지 2단계 정리**(같은 행 · 별지 D8 "식별·휴지통 이동까지만") | 신규 API + 표면 + **파일 이동 코드 첫 도입** | 미참조 이미지 식별(읽기 전용) → 사용자 선택분을 `sources/images/.trash/`로 이동(+되돌리기) · 최종 삭제 = 사용자 수동 | 저장: `services/convert_service.py:1903~1904` `SOURCES_DIR`·`SOURCES_IMAGES_DIR` · 업로드 `services/upload_service.py:99~109`(임시 파일 → `Path.replace` · 파일명 `{sha256[:16]}.{ext}`) · 큐넷 수집 `convert_service.py:2056~2080` `_save_fetch_images`(같은 폴더·같은 파일명 규칙 · 본문에 `/images/{fname}` 삽입 `:2078`). 서빙: `main.py:200~212` `GET /images/{filename:path}` — `_IMAGE_FILENAME_RE = ^[0-9a-f]{16}\.(gif|png|jpg|jpeg|webp)$`(`:201`) fullmatch + `resolve()`/`is_relative_to`(`:208~210`) → **`.trash/xxx`는 `/`·`.` 선두로 정규식 단계에서 404**(서빙 제외 자동 · 코드 무변). 참조 지점(텍스트 컬럼): `models.py:52~55` `documents.content`·`choices`·`explanation` · `:66,69` `content_blocks`·`explanation_blocks` · `:328` `notes.content_blocks`(+`content` 프로젝션) · 디스크 `import/auto/*.json`(`services/preview_store.py:29,87,138` — 미승인 미리보기·보존 산출물이 `/images/` 링크를 품을 수 있음). 이미지 메타 DB **0**(§4.27 ④ "DB 기록 0"). 백업 `services/backup_service.py:49~54` `sources/` `rglob("*")` zip → `.trash/`도 자동 포함 · 복원 `:124~125` `shutil.rmtree(SOURCES_DIR)`(기존 fs-mutate 기준선 정당분 — 전례). 파일 삭제·이동 코드: 서비스·라우터에 **0**(복원 rmtree 제외) |
| **D8-구현 ③ 불변 규칙 4 개정**(같은 행 "불변 규칙 4 명시 개정 동반") | 규약 개정(문서 2곳 + 스캔 규칙 문자열 1줄) | `sources/images/` 업로드·수집 이미지 = 앱 생성 파생물 재해석 · `sources/` 반입 원본 문서 파일은 종전대로 불변 · 앱 자동 삭제 0 | 정본 2곳 `CLAUDE.md:67` · `docs/01-plan/study-app.plan.md:353`(§6.3 4) — **편성 시 개정 이행(문서 · §2 D)**. 검사 `scripts/invariant-scan.ps1:60~67` `fs-mutate` = 기준선 방식 · 패턴 `os\.remove\(|\.unlink\(|shutil\.rmtree\(|shutil\.move\(` · 규칙 문자열 `:62` "sources/ originals are immutable" · 현재 기준선 정당분 = `backup_service.py` rmtree 1곳 |

**DDL 0(계획서 §6.2 무변 · Alembic 불필요 · `deleted_at` 컬럼 추가 없음 — `updated_at` 대용 · §15 R 행 = R43 1행 추가(파일 이동 코드 표면 —
스키마 아님 · 규칙 개정 기록용)) · 신규 엔드포인트 7 · 기존 엔드포인트 무변(`DELETE` 2종 · `GET /images/` 서빙 · `POST /api/uploads` ·
`POST /api/documents/bulk` 계약 그대로) · settings 키 0 · 새 라우트 1(`/trash`) · 신규 의존 0 · `sources/` 반입 원본 무접촉 · 파일 **삭제 코드
0**(이동만) · attempts·srs·오답노트 무접촉(불변 규칙 2 밖) · 응답에 정답·해설 0(불변 규칙 1 — 목록 아이템 재사용 · 복원 응답은 기존 상세
표현).**

## 2. 확정 규약 (착수 전 결정 — 위임 판정 · 이 문서가 정본 · 사용자 확정 대기 0 — 편성 보류 아님)

- **A. 고아(orphan) 정의 — "어떤 참조원에도 없는 `sources/images/` 직속 이미지 파일"** (결정 ①)
  - 대상 파일 = `sources/images/` **직속**(하위 폴더 미탐색 · `.trash/`는 별도 목록) 중 서빙 정규식 `^[0-9a-f]{16}\.(gif|png|jpg|jpeg|webp)$`을
    충족하는 파일만. 불충족 파일(`.tmp` 잔재 등) = 대상 밖 · 개수만 `other_files`로 보고(이동·삭제 0).
  - **참조원(전부 합집합 · 활성+비활성 구분 없음)**: ⓐ `documents.content`·`choices`·`explanation`·`content_blocks`·`explanation_blocks`
    (**`is_active` 무관 전 행** — 소프트 삭제분은 이 stage에서 복원 가능하므로 그 참조는 살아 있는 참조) ⓑ `notes.content`·`content_blocks`(동일)
    ⓒ `import/auto/*.json`(`preview_store.AUTO_DIR` — 미승인 미리보기·보존 산출물 · **읽기만** · 파일 없음/파싱 실패 = 건너뜀). 추출 = 원문
    문자열에 정규식 `/images/([0-9a-f]{16}\.(?:gif|png|jpg|jpeg|webp))` 전역 매치(마크다운 `![](/images/…)` · 블록 JSON `"url":"/images/…"` ·
    `{w=}` 접미 전부 같은 패턴에 걸린다 — **블록 JSON을 해석하지 않는다**(§4.28 원칙 ③ 유지 · 문자열 스캔만)). 확장자 `jpeg`도 파일명 그대로 대조.
  - **큐넷 수집 이미지(`_save_fetch_images`)도 같은 규칙** — 파생물(앱이 내려받아 생성) · 원본 URL은 문서 본문에 남지 않으므로 구분 불가·구분
    불필요. `sources/` 반입 원본(PDF·docx 등 `sources/images/` 밖)은 **스캔 대상 자체가 아니다**.
  - **유예(grace)** — 쿼리 `min_age_days`(정수 · 기본 **7** · 0 허용 · ≤365): 파일 mtime이 `now − min_age_days`보다 최근이면 고아 후보에서
    제외(`recent_skipped` 카운트만). 근거: 편집 중 붙여넣기 직후(자동저장 전) · 반입 미리보기 진행 중(ⓒ가 못 잡는 인메모리 단계) 이미지가
    고아로 오판되는 것을 막는다. UI는 기본값 고정(입력 없음 — YAGNI · 테스트만 0 사용).
  - 스캔은 **읽기 전용·수동 트리거·자동 실행 0**(기동 시·주기 스캔 없음). 결과는 저장하지 않는다(DDL 0 · settings 0).
- **B. 휴지통 폴더 = `sources/images/.trash/`(평면 · 파일명 그대로)** (결정 ②)
  - 근거: ① 백업(F27) `sources/` zip `rglob`에 **자동 포함** → 복원 시 휴지통도 되살아난다(코드 개정 0) ② 서빙 `GET /images/{filename:path}`
    정규식이 `.trash/…`를 **이미 404**(`/`·`.` 선두 거부 — `main.py:201,206` · R16 · 코드 무변) ③ 같은 볼륨이라 원자적 rename ④ 사용자가
    탐색기에서 찾기 쉬운 위치(안내 문구에 절대 경로 표시). 앱 밖 위치(`backups/` 등)·DB 기록·삭제 예약은 두지 않는다.
  - 최종 삭제 = **사용자가 탐색기에서 `.trash/` 폴더를 비운다** — 앱은 삭제 엔드포인트·자동 비우기·용량 상한 트리거 전부 **0**(D8 원칙 "앱 자동
    삭제 0"). 화면에 안내 문구 + 경로만.
- **C. 이동 구현 규약 — `services/trash_service.py` 1파일 · `shutil.move` · 경로 가드 3중 · 삭제 함수 0** (결정 ③)
  - 파일 이동 호출은 **`trash_service.py` 안에서만**(라우터·다른 서비스에 이동 코드 0). 호출 = `shutil.move(src, dst)` **명시 사용**(패턴
    검출 의도 — `Path.replace`로 우회해 스캔을 피하지 않는다 · 감사 가능성 확보). `os.remove`·`unlink`·`rmtree` **0**.
  - **경로 가드(R16 규약)**: ⓐ 요청 파일명은 서빙 정규식 `_IMAGE_FILENAME_RE` **fullmatch**(불일치 = 422 `invalid_filename` · 전체 거부)
    ⓑ `src`·`dst` 모두 `resolve()` 후 `is_relative_to(SOURCES_IMAGES_DIR.resolve())` 검사(실패 = 422 · 이론상 ⓐ 뒤엔 도달 불가 — 이중 차단)
    ⓒ 방향 고정: `move` = `images/{f}` → `images/.trash/{f}` · `restore` = 역방향. 그 외 경로 0.
  - **이동 직전 참조 재검사**: `move`는 요청 파일 전부에 대해 규약 A 참조 집합을 **다시 계산**해 하나라도 참조 중이면 **422
    `still_referenced`**(`detail.filenames`) + **이동 0**(all-or-nothing — 스캔 결과가 stale일 수 있음 · 유예는 재검사에 적용하지 않는다 =
    사용자가 명시 선택한 파일은 mtime 무관). 미존재 파일 = `skipped`(멱등 · 404 아님). `.trash/`에 같은 이름이 이미 있으면(재이동) 대상
    유지 + 원본은 그대로 두고 `skipped`(덮어쓰기 0 — 내용 해시라 동일 내용).
  - `restore`: `.trash/{f}` → `images/{f}`. `images/{f}`가 이미 있으면(재업로드로 재생성) **휴지통 사본 그대로 두고 `skipped`**(삭제 0 ·
    사용자가 비울 때 같이 사라짐). 미존재 = `skipped`.
  - **invariant 기준선 규약**: 구현 후 `fs-mutate` 신규 검출은 **`trash_service.py` 2곳(move·restore)만 정당분** → 사용자 승인 후
    `-UpdateBaseline`(stage-50·51 전례). 다른 파일 신규 검출 = 결함. `invariant-scan.ps1:62` 규칙 문자열을 개정 규칙에 맞춰 1줄 갱신(
    "Rule 4 - filesystem removal/move calls (sources/ ingested originals immutable; sources/images/ moves only inside trash_service)") —
    패턴 무변.
- **D. 불변 규칙 4 개정 문안(편성 시 이행 — 문서 2곳 동기)** (결정 ④)
  - `study-app.plan.md` §6.3 4: **"원본 불변 — `sources/`의 반입 원본 파일은 수정·삭제하지 않는다. 정리본(문서)만 다듬는다. (stage-52 개정
    2026-09-14 · 별지 D8) `sources/images/`의 업로드·수집 이미지는 앱 생성 파생물로 재해석한다 — 앱은 미참조(고아) 식별과
    `sources/images/.trash/`로의 이동·되돌리기만 하고 자동 삭제 0 · 최종 삭제 = 사용자 수동."**
  - `CLAUDE.md` 67행 1줄: **"`sources/` 반입 원본 불변 — 수정·삭제 코드 금지. `sources/images/`(업로드·수집 이미지)는 파생물: 앱은 고아 식별 +
    `.trash/` 이동·되돌리기만(자동 삭제 0 · 최종 삭제 = 사용자 수동 — stage-52)."** — 다른 줄 무접촉.
  - 마스터 §15 **R43** 행 추가(파일 이동 코드 표면 도입 기록 · 대응 = 규약 C · 감시) + backlog §3 1행.
- **E. DDL 0 — "삭제 시각"은 `updated_at`** (결정 ⑤)
  - `deleted_at` 컬럼을 추가하지 않는다. 소프트 삭제가 `updated_at`을 갱신함을 실측(`onupdate` — §1) → 휴지통 목록 정렬·표시에 `updated_at`
    사용 · 라벨은 **"삭제(마지막 변경)"**(정확히는 마지막 갱신 시각 — 삭제 후 무변경이 보통이라 실용 동치). 복원 시 `updated_at`이 다시 갱신돼
    원 목록 최상단으로 온다(부작용 수용 · 기록 목적 없음). 보존 기간·자동 정리 0.
- **F. API 표(신규 7 · 라우터 = `routers/trash.py` 신설 `prefix=/api/trash` + 복원 2개는 각 리소스 라우터)** (결정 ⑥ — 계약 정본 = api §4.32)
  1. `GET /api/trash/documents?page&size` → `Page[DocumentListItem]` · **`is_active=0`만** · `updated_at DESC` · §3 페이지네이션(기본 50 ·
     ≤200). 구현 = `list_documents`에 내부 인자 `inactive_only`(공개 파라미터 추가 0 — `GET /api/documents` 계약 무변).
  2. `POST /api/documents/{id}/restore` → `200 DocumentDetail`(기존 표현) · `is_active=1` UPDATE + commit 1회 · **이미 활성 = 200 그대로
     (멱등)** · 404 `NOT_FOUND`. 링크·태그·북마크·관계·attempts·srs·`content_blocks` **전부 무접촉**(삭제가 무접촉이었으므로 그대로 되살아남).
     등록 = `DELETE /{document_id}` 뒤(경로 충돌 없음).
  3. `GET /api/trash/notes?page&size` → `Page[NoteListItem]` · `is_active=0`만 · `updated_at DESC`. 구현 = `_list_notes` 내부 인자.
  4. `POST /api/notes/{id}/restore` → `200 NoteOut` · 멱등 · 404. `PATCH`는 계속 `is_active`를 받지 않는다(복원 = 전용 엔드포인트 — §4.28 ①
     `[S52]` 개정). 복제(⑦)의 "삭제분 404"는 그대로(복원 후 복제).
  5. `GET /api/trash/images?min_age_days=7` → 스캔 보고서(읽기 전용 · **페이지네이션 없음** — 선택 후 일괄 이동이 목적이라 부분 페이지가 무의미):
     ```
     { "orphans":  [{ "filename", "bytes", "modified_at" }, …],   // 규약 A 고아 · filename 오름차순
       "trashed":  [{ "filename", "bytes", "modified_at" }, …],   // .trash/ 현재 내용
       "total_files": n, "referenced": n, "recent_skipped": n, "other_files": n,
       "trash_dir": "<절대 경로>", "min_age_days": 7 }
     ```
     응답에 본문·문서 id 0(어느 문서가 쓰는지는 보고하지 않는다 — YAGNI). 썸네일은 프론트가 `GET /images/{filename}`으로 그대로.
  6. `POST /api/trash/images/move` 본문 `{ "filenames": [str, …] }`(1 ≤ len ≤ 500 · 중복 제거) → `200 { "moved": n, "skipped": n }` ·
     규약 C 가드 · 422 `still_referenced`(`detail.filenames`) all-or-nothing · 422 `invalid_filename` · 파일 시스템 부작용은 검사 통과 후에만.
  7. `POST /api/trash/images/restore` 본문 동일 → `200 { "restored": n, "skipped": n }` · 규약 C.
  - 에러 = §3 포맷 · 코드 4종 안(`NOT_FOUND`·`VALIDATION_ERROR` + 파일 시스템 실패 = 500 `INTERNAL` 공통 핸들러) · `detail.reason`으로 구분 ·
    `message` = 한국어 + 다음 행동. 409 없음. 1·3·5는 GET(부작용 0) · 6·7은 POST(명시 조작 · 멱등).
  - **최종 삭제 엔드포인트 없음**(규약 B) · 문서·노트 일괄 복원 없음(§4 — bulk `restore` action은 실수요 후).
- **G. 프론트 — 독립 라우트 `/trash` + 진입점 = 설정 ⑤ 데이터 그룹 카드** (결정 ⑦)
  - **진입점 판정**: 사이드바·모바일 드로어 항목 **추가 0**(stage-49 배열 단일 출처 `Layout.tsx:21~40` 9항목 + 하단 2 = 11 그대로 · 하단 탭바
    5 불변 — 휴지통은 저빈도 유지보수 표면이라 상시 내비 자리를 쓰지 않는다). 진입 = **설정 `SettingsSection id="settings-data"`
    (`Settings.tsx:355~375`) 안 카드 1개** "휴지통"(설명 1줄 "삭제한 문서·노트 복원 · 안 쓰는 이미지 정리" + `[휴지통 열기]` `Link to="/trash"`) —
    백업/복원 카드 옆(데이터 보존 계열 · F38 6그룹 수 불변 · 매뉴얼 링크·큐넷 카드 전례 = 그룹 안 카드 추가만). 보조 진입 = 삭제 확인 문구
    4곳(§1)에 "휴지통(설정 › 데이터)에서 복원할 수 있습니다" — 링크가 아닌 문구(모달 안 라우팅 0).
  - 페이지 `pages/Trash.tsx`(lazy 청크 — 엔트리 청크 +0 B 목표 · R37) · 탭 3개 **[문서] [노트] [이미지]**(URL 쿼리 `?tab=` 보존 0 — 로컬 상태).
  - **[문서] 탭**: 표(제목 · 타입 배지 · 삭제(마지막 변경) 시각 · `[복원]`) · §3 페이지네이션(size 50 · 이전/다음) · 빈 상태 "휴지통이 비어
    있습니다" · `[복원]` = `useRestoreDocument()` → 성공 시 `documentKeys.all` + `categoryKeys.tree` invalidate + 행 소멸 + 1줄 알림 "복원했습니다
    — 탐색에서 확인" · 제목 클릭 = `/docs/:id`(상세는 비활성도 열린다 — 현행). 다중 선택·일괄 복원 0(§4).
  - **[노트] 탭**: 표(제목 · 시각 · `[복원]`) · `useRestoreNote()` → `noteKeys.all` invalidate · 제목 클릭 = `/notes/:id`.
  - **[이미지] 탭**: 상단 안내 2줄("앱은 이미지를 지우지 않습니다. 고아 이미지를 휴지통 폴더로 옮겨 두면, 최종 삭제는 탐색기에서 아래 폴더를
    비우세요" + `trash_dir` 절대 경로 `<code>`). `[고아 이미지 스캔]` 버튼(**수동** · 페이지 진입 시 자동 호출 0 — 스캔은 DB 전 행 텍스트를 읽는다)
    → 결과 요약 1줄("전체 n · 참조 중 n · 고아 n · 최근 7일 제외 n") + 고아 표(체크박스 · 썸네일 `<img src="/images/…" loading="lazy">` 64px ·
    파일명 · 크기 · 수정일) · `[전체 선택]` · `[휴지통으로 이동]`(선택 0 = 비활성 · `ConfirmDialog` 실수치 "n개를 휴지통 폴더로 옮길까요? 파일은
    지워지지 않습니다") → `useMoveImagesToTrash()` → 성공 요약 "이동 n · 건너뜀 n" + 재스캔 자동 1회. 아래 **휴지통 폴더 목록** 표(파일명 ·
    크기 · 수정일 · `[되돌리기]` 단건) — 썸네일 없음(서빙 안 됨 · 규약 B). 서버 422 `still_referenced` = `message` 그대로 렌더(§3).
  - 색·간격 = 기존 토큰 클래스만(`text-wrong`·`border-border`·`bg-surface` — 새 색 0) · 390px = 표 가로 스크롤 허용(`overflow-x-auto`) ·
    썸네일 48px.
  - 뮤테이션·쿼리 = `api/trash.ts` 신규(`useTrashDocuments`·`useTrashNotes`·`useTrashImages(enabled=false · refetch 수동)`·
    `useMoveImagesToTrash`·`useRestoreImagesFromTrash`) + `api/documents.ts` `useRestoreDocument` + `editor2/api/notes.ts` `useRestoreNote` ·
    폴백 문구 = mutationFn 1곳(S50·S51 관례 · ApiError는 서버 `message` 그대로).
- **H. 테스트 = `backend/tests/test_trash.py`(pytest)** (결정 ⑧) — 불변 규칙 7 "필수"는 아니지만 **파일 이동 가드·참조 재검사·복원
  무접촉의 회귀 방지 목적으로 편성 필수**. 픽스처 = `tmp_path`로 `SOURCES_IMAGES_DIR`·`AUTO_DIR` monkeypatch(실제 `sources/` 무접촉 —
  테스트가 실 폴더를 건드리면 결함) · `PRAGMA foreign_keys=ON` 전례. 케이스 = V-1.
- **I. 매뉴얼** (결정 ⑨) — `docs/manual/user-manual.html` 463행 "삭제는 보관" 불릿에 "설정 › 데이터 › 휴지통에서 복원" 1구 + 462행 "원본"
  불릿에 "업로드·수집 이미지는 예외 — 휴지통 폴더로 옮길 수 있고 지우는 건 사용자" 1구 + `1960` "데이터는 어디에 있나요?" 절에 **"휴지통"
  단락 1개**(문서·노트 복원 · 이미지 스캔→이동→탐색기에서 비우기 · 앱은 지우지 않음 · 백업에 휴지통 포함). 완료 시 반영(D-3).

## 3. 체크리스트

**B. 백엔드 (`backend/`)**
- [x] B-1 `services/trash_service.py` 신설 — `collect_referenced_filenames(db)`(규약 A ⓐⓑⓒ 합집합 · 정규식 1개 상수) ·
      `scan_images(db, min_age_days)`(보고서 dict · 읽기 전용) · `move_to_trash(db, filenames)`(가드 3중 → 참조 재검사 → `shutil.move`) ·
      `restore_from_trash(filenames)` · `_IMAGE_FILENAME_RE`는 `main.py`와 **공용 상수 1곳**으로(중복 정의 금지 — 이동 시 `main.py` 서빙 코드 diff는
      import 1줄만). 삭제 함수 호출 0.
- [x] B-2 `schemas/trash.py` — `TrashImageEntry`·`TrashImagesReport`·`TrashImagesRequest`(`filenames` 1~500 · dedup `field_validator`) ·
      `TrashMoveResult`·`TrashRestoreResult`. 문서·노트 목록은 기존 `DocumentListItem`·`NoteListItem`·`Page` 재사용.
- [x] B-3 `routers/trash.py` 신설(`prefix=/api/trash`) — `GET /documents` · `GET /notes` · `GET /images` · `POST /images/move` ·
      `POST /images/restore` · `main.py` 라우터 등록 1줄(서빙 구간 diff 0 — 상수 import 제외).
- [x] B-4 `services/document_service.py` — `list_documents` 내부 `inactive_only` 인자(공개 파라미터 0) + `restore_document(db, id)`(멱등 · commit
      1회) · `routers/documents.py` `POST /{document_id}/restore`(`DELETE /{document_id}` 뒤 · `response_model=DocumentDetail`).
- [x] B-5 `routers/notes.py` — `_list_notes` `inactive_only` 인자 + `POST /{note_id}/restore`(멱등 · `NoteOut`). `PATCH` `is_active` 미수용 그대로 ·
      복제 삭제분 404 그대로.
- [x] B-6 에러 = §3 포맷 · `detail.reason` = `invalid_filename`·`still_referenced` · `detail.filenames` 동봉 · 코드 신설 0 · 기존 엔드포인트
      (`DELETE` 2종 · `GET /api/documents`·`GET /api/notes` · `GET /images/` · `POST /api/uploads` · `POST /api/documents/bulk`) diff 0 확인.

**F. 프론트 (`frontend/src/`)**
- [x] F-1 `api/types.ts` 타입(`TrashImageEntry`·`TrashImagesReport`·`TrashMoveResult`·`TrashRestoreResult`) · `api/trash.ts` 신규 훅 5개(규약 G ·
      이미지 스캔은 `enabled:false` + `refetch` 수동) · `api/documents.ts` `useRestoreDocument`(invalidate `documentKeys.all`+`categoryKeys.tree`) ·
      `editor2/api/notes.ts` `useRestoreNote`(`noteKeys.all`).
- [x] F-2 `pages/Trash.tsx` 신규(lazy) + `App.tsx` `<Route path="/trash">` — 탭 3개 · 문서/노트 표 + 페이지네이션 + `[복원]` · 이미지 탭 스캔 버튼 ·
      요약 1줄 · 고아 표(체크박스·전체 선택·썸네일 lazy) · `[휴지통으로 이동]` `ConfirmDialog` 실수치 · 휴지통 목록 + `[되돌리기]` · 안내 2줄 +
      `trash_dir`. 자동 스캔 0.
- [x] F-3 `pages/Settings.tsx` 데이터 그룹(`:355~375`) 카드 "휴지통" 1개 + `[휴지통 열기]` `Link`(F38 6그룹 불변 · `Layout.tsx` 내비 배열 무접촉).
- [x] F-4 삭제 확인 문구 4곳 갱신 — `Explore.tsx:559` "휴지통 없이 숨겨지며" → "휴지통(설정 › 데이터)에서 복원할 수 있으며 분류 연결·학습 기록은
      그대로 남습니다" · `DocumentDetail.tsx:531` · `NoteListPage.tsx:210` · `NoteEditPage.tsx:702` 동일 취지 1구(문구만 · 동작 무변).
- [x] F-5 색·간격 = 토큰·기존 유틸 클래스만(불변 규칙 5 — 새 색 0) · 390px 표 가로 스크롤·버튼 wrap · 엔트리 청크 Δ 실측(lazy라 +0 B 목표 ·
      기준선 1,583,878 B · R37).

**V. 검증 (서버 구동 금지 — `2_StartServer.bat` 주인은 사용자 · 브라우저 실측은 사용자가 띄운 `localhost:8000`만 · 실 `sources/images/` 무접촉 —
실측용 이미지는 새로 업로드해 원상 복구)**
- [x] V-1 `backend/tests/test_trash.py`(tmp 폴더 픽스처 · 실 `sources/` 무접촉) — ① 문서 복원: 삭제 → `GET /trash/documents`에 노출 · 활성 목록에
      미노출 → 복원 → 반대 · 링크·태그·북마크·attempts 행 수 무변 · 재복원 200 멱등 · 없는 id 404 ② 노트 복원 동일 + 복원 후 복제 200 ③ 스캔:
      활성 문서 참조·**비활성 문서 참조**·노트 블록 JSON `"url"` 참조·`import/auto` JSON 참조 → 전부 `referenced` · 미참조 = `orphans` · 정규식
      불충족 파일 = `other_files` · mtime 최근 = `recent_skipped`(`min_age_days=0`이면 후보) · `.trash/` 내용 = `trashed` ④ move: 고아 n건 →
      `.trash/`로 이동 `moved=n` · 원 위치 부재 · 미존재 파일 `skipped` · **참조 중 파일 1건 포함 → 422 `still_referenced` + 이동 0**(all-or-nothing) ·
      `../x`·`.trash/x`·`abc.png` 등 정규식 불충족 → 422 `invalid_filename` + 부작용 0 · 501건·빈 배열 422 ⑤ restore: 되돌리기 · 대상 존재 시
      `skipped` + 휴지통 사본 잔존(삭제 0) ⑥ 서빙: `.trash/` 이동 후 `GET /images/{f}` 404 · 되돌린 뒤 200 ⑦ 반입 원본(`sources/` 밖 파일)은
      스캔·이동 대상에 없음. `run-tests.ps1 -Path tests/test_trash.py` 통과 → `-Full` 무회귀.
- [x] V-2 `invariant-scan.ps1` — `fs-mutate` 신규 검출 = `trash_service.py` 2곳만(규약 C 정당분) → 사용자 승인 후 `-UpdateBaseline` · 규칙
      문자열 1줄 갱신 · `physical-delete` 신규 0 · 그 외 PASS · `npm run build` 성공(성공/실패만 · 신규 의존 0 · 엔트리 청크 Δ 기록).
- [ ] V-3 브라우저 실측(사용자 기동 서버 · 노트 무접촉 원칙 — 실측용 문서·노트·이미지는 새로 만들어 원상 복구): ⓐ 설정 › 데이터 "휴지통" 카드 →
      `/trash` 진입 · 사이드바·드로어 항목 수 무변(11) ⓑ 문서 탭: 탐색에서 삭제한 문서가 표에 뜸(시각 표시) → `[복원]` → 탐색 목록 복귀 · 트리
      `doc_count` 복귀 · 사용처·태그 그대로 ⓒ 노트 탭: 삭제 노트 `[복원]` → `/notes` 목록 복귀 · 편집 열림 ⓓ 이미지 탭: 진입 시 요청 0 → `[스캔]`
      → 요약·표 · 방금 업로드한 이미지는 "최근 7일 제외"로 미노출(유예 확인) ⓔ 테스트 픽스처로 mtime 오래된 고아 1건 준비(사용자 폴더 조작 또는
      `min_age_days=0` 수동 호출) → 체크 → `[휴지통으로 이동]` 확인 실수치 → 이동 · 휴지통 목록에 등장 · `GET /images/{f}` 404 ⓕ `[되돌리기]` → 원복 ·
      200 ⓖ 삭제 확인 문구 4곳 갱신 확인 ⓗ 390px(iframe 에뮬 가능) 표 가로 스크롤·겹침 0 · 콘솔 에러 0.

**D. 문서**
- [x] D-1 설계 — api §4.2 `[S52]` 복원 행 + §4.28 ① `[S52]` 복원 행 + `### 4.32 [S52]` 절(편성 시 v1.65 선반영 · 완료 시 "구현 실측 확정" 표기 + 색인
      v1.66) · screens §5.17 + §5.11·§5.2·§5.3·§5.16 S52 1줄(동일).
- [x] D-2 별지 §10 D8 행 `← 완료(stage-52 · 날짜)` · §13 FB-24 행 "ⓒ 전제 충족" 추기 · backlog §1 `D8-구현` → §4 종결 이동 · `backlog-scan.ps1` PASS ·
      마스터 §14 M38 행 ✅ + §5 F61 색인 행 무변 · §15 R43 상태 유지(감시).
- [x] D-3 매뉴얼 3곳(규약 I) · CHANGELOG 항목 · stage-index 52행 · 이 문서 §7 완료 기록 · `CLAUDE.md` 버전 줄(발행 시).

## 4. 이 단계에서 하지 않는 것 (불변 규칙 9 — 이 절이 우선)

- **FB-24 ⓒ(분류 삭제 시 문서 동반 소프트 삭제 `on_documents=delete`) 0** — 전제(복구 UI)만 이 stage로 충족 · 별지 §13 FB-24 ⓒ·api §4.1 34행
  봉인 그대로 · 후속 별도 편성(사용자 확정 2026-09-14).
- **앱의 파일 삭제 0** — 최종 삭제 엔드포인트·휴지통 비우기 버튼·자동 정리(기동·주기·용량 상한)·보존 기간 만료 삭제 전부 없음. `os.remove`·
  `unlink`·`rmtree` 호출 0(백업 복원의 기존 rmtree 제외 — 무접촉).
- **`sources/` 반입 원본(PDF·docx·xlsx·txt 등 `sources/images/` 밖) 접촉 0** — 스캔·이동·목록 대상 아님(불변 규칙 4 개정 범위 = `sources/images/`만).
- **문서·노트 물리 삭제 0 · 휴지통 "완전 삭제" 0**(불변 규칙 3) · 소프트 삭제분 보존 기간·자동 정리 0 · `deleted_at` 컬럼 0(규약 E).
- **일괄 복원 0**(bulk `restore` action · 휴지통 다중 선택) — 실수요 시 §4.31 `action` 추가로 별도 · 태그·분류(카테고리)·태그 규칙·백업의 휴지통 0
  (분류는 S50 물리 삭제 그대로 · 되돌리기 없음).
- **이미지 참조 이관·재작성 0** — 본문의 `/images/…` 링크를 고치지 않는다(이동한 파일을 참조하는 본문은 규약상 존재하지 않음 — 재검사 422) ·
  이미지 메타 DB·썸네일 생성·용량 통계 화면·"어느 문서가 쓰는지" 역참조 표시 0.
- **`GET /images/` 서빙 규약 변경 0**(`.trash/` 서빙 없음 = 기존 정규식) · `POST /api/uploads` 계약 무변(휴지통에 같은 해시가 있어도 되살리지
  않고 새로 쓴다 — 중복 사본 허용) · `import/auto/` 산출물 정리 0(R18 그대로).
- **내비 항목 추가 0**(사이드바·드로어·하단 탭바 — stage-49 배열 무접촉) · 설정 그룹 수 6 불변 · 자동 스캔 0 · 스캔 결과 저장 0 · settings 키 0.
- DDL 0 · Alembic 0 · 신규 의존 0 · `ConfirmDialog` 옵션 확장 0(S50 봉인) · `LinkDocumentModal` 무접촉.

## 5. DoD (완료 정의)

**자동 검증(에이전트 수행):**
1. `run-tests.ps1 -Path tests/test_trash.py`(래퍼가 `backend/`로 이동) 통과(V-1 ①~⑦) + `-Full` 무회귀 · `invariant-scan.ps1` PASS(fs-mutate
   기준선 갱신은 `trash_service.py` 2곳만 · 사용자 승인 기록 · 규칙 문자열 갱신).
2. `npm run build` 성공 · 백엔드 diff = `routers/trash.py`(신규)·`routers/documents.py`·`routers/notes.py`·`services/trash_service.py`(신규)·
   `services/document_service.py`·`schemas/trash.py`(신규)·`main.py`(등록 1줄 + 상수 import)·테스트 1파일 안 · Alembic diff 0 · 신규 의존 0 ·
   기존 엔드포인트 응답 diff 0.
3. 프론트 diff = `pages/Trash.tsx`(신규)·`api/trash.ts`(신규)·`api/types.ts`·`api/documents.ts`·`editor2/api/notes.ts`·`App.tsx`·`Settings.tsx`·
   문구 4파일 안 · `Layout.tsx` 무접촉 · 새 색 리터럴 0(`tokens.css` 무변) · 엔트리 청크 Δ 기록(R37 기준선 대비).
4. 브라우저 V-3 ⓐ~ⓗ 전건 통과(실측 데이터 원상 · 실 `sources/images/` 잔여 0).
5. 문서 묶음 D 전건(Design v1.66 · 별지 D8 `← 완료` · backlog 종결 이동 · M38 ✅ · 매뉴얼 3곳 · CHANGELOG · stage-index · CLAUDE.md 규칙 4 줄은
   편성 시 이미 개정).

**사용자 확인(게이트 본체):**
6. **실사용** — ⓐ 실수로 지운 문서·노트를 휴지통에서 되살려 학습·편집이 그대로 이어짐(진도·풀이 기록·사용처 이상 0) ⓑ 이미지 스캔 결과가
   납득됨(쓰고 있는 이미지가 고아로 잡히지 않음 — 특히 비활성 문서·반입 미리보기의 이미지) ⓒ 휴지통 폴더로 옮긴 뒤 탐색기에서 직접 비움 →
   앱 이상 0 · **치명 결함 0 회신** = 발행 게이트.

**게이트**: 1~5 전건 + 6 치명 0 → 발행(v2.03.1). 치명 발견 시 발행 보류·수정 선행. **착수 게이트**: 없음(사용자 확정 대기 0 — 위임 판정 전건 근거
병기 · 재론 시 §2 해당 항목만).

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` — **v2.03.1 항목 1개**(핵심 stage · 규약 ② MM+1 · 발행 대기 사소 stage 없음 → 단독 발행. 완료 시점에
   미발행 사소 stage가 생겨 있으면 stage-51 §6 ① ⓑ 전례로 합류 판정). 불릿 = 휴지통 화면(문서·노트 복원 · 고아 이미지 스캔→휴지통 폴더 이동→
   되돌리기) · 신규 API 7 · **앱은 파일을 지우지 않음 · 최종 삭제 = 사용자 수동** · 불변 규칙 4 개정 · DDL 0 · 삭제 확인 문구 갱신.
2. 루트 `VERSION` = 2.03.1 — 사용자 회신(DoD 6) 후.
3. `stage-index.md` 52행 갱신(완료·일자·산출 버전).
4. `backlog.md` — §1 `D8-구현` 행을 §4로 **종결 이동**(`종결(stage-52 · 날짜)`) · §3 R43 행 유지(감시) · 기준일 줄 갱신 · `scripts/backlog-scan.ps1`
   PASS 확인.
5. 출처 추기 — 별지 §10 D8 행 끝 `← 완료(stage-52 · 날짜)` · §13 FB-24 행 "ⓒ 전제 충족" 갱신 · 마스터 §14 M38 행 완료 열 ✅ + 날짜 + 발행 버전 ·
   §15 R41 ③④("복구 UI 없음")에 `← stage-52로 해소` 1구.
6. 설계 — api §4.32 `[S52]` 절 "구현 실측 확정" 표기 + §4.2·§4.28 포인터 행 · screens §5.17 등 5곳 · 색인 상태 줄 v1.66(최근 3건 규칙으로 밀리는
   v1.62는 `docs/04-archive/design-changelog.md` 맨 위로 이동만).
7. 매뉴얼 3곳(D-3) · `CLAUDE.md` 머리 버전 줄 1곳(발행 시 · 경위 전재 금지 — 규칙 4 줄은 편성 시 개정 완료) · git tag(발행 버전 · release PR
   별도 — stage-47 전례).

## 7. 완료 기록 (구현·검증·문서 경위 정본 — 착수 후 추기)

- **편성**(2026-09-14): 지시서 확정 — 규약 A~I(사용자 확정 4건 = D8-구현 단독 · 번호 52 · 범위 ①②③ · FB-24 ⓒ 미동승 · 핵심 초안 → 그 외 위임
  판정 · **사용자 확정 대기 0**) · api §4.2·§4.28 `[S52]` 행 + `### 4.32` 절 · screens §5.17 신설 + 4곳 1줄(Design v1.65) · stage-index 52행 ·
  backlog `편성 = stage-52` + §3 R43 행 · 별지 §10 D8·§13 FB-24 편성 추기 · 마스터 §14 M38 행 + §5 F61 행 + §15 R43 행 + **§6.3 불변 규칙 4 개정**
  + `CLAUDE.md:67` 동기(Draft v0.60).

- **구현·검토**(2026-09-15): 브랜치 `stage-52-trash` · 구현 커밋 32ae447 + 검토 반영 1a7d319. 분배 = backend-dev(B-1~B-6 + V-1 · sonnet) ∥ frontend-dev(F-1~F-5 · sonnet) 병렬. 통합 확인 = `test_trash.py` 20건 · pytest `-Full` 679 · `invariant-scan.ps1` PASS(fs-mutate 신규 검출 = `trash_service.py` 2곳 정확히 규약 C 정당분 → `-UpdateBaseline` · 규칙 4 문자열 개정 — **기준선 갱신은 배경 잡 자율 진행 · 사용자 승인 = PR 머지로 갈음(이 항목 확인 요망)**) · `npm run build` 성공(엔트리 청크 1,521,746 B = 기준선 −62,132 B · Trash lazy 청크 13,430 B). Opus 검토: 1차 조건부 통과(치명 0 · 중요 1 · 경미 4) → 반영 후 재검토 통과(잔존 0 · 2026-09-15): 중요-1 복원 후 휴지통 행 잔존(`['trash']` 키 무효화 0) → 복원 훅 2개에 `invalidateQueries(['trash'])` · 경미-1 이미지 `modified_at` 로컬 naive → UTC 오프셋 · 경미-2 표 헤더 "삭제(마지막 변경)" · 경미-3 move 동명 skip 테스트 +1 · 경미-4 `main.py` 상수 import 상단 이동 · 검토자 의견 채택 = 이동 버튼·확인창 중립 색 · `onScan` 시 이전 이동 요약 초기화 · `.trash/` lazy mkdir. **범위 밖 발견(등재 후보 — 사용자 판단)**: 스캔 요약 1줄에 `other_files`(정규식 불충족 잔재 수) 미표시 — 실수요 시 요약 항목 추가. **잔여** = V-3 ⓐ~ⓗ 브라우저 실측(사용자 기동 `localhost:8000`) + DoD 6 실사용 회신 → 치명 0이면 `VERSION` 2.03.1 + `CLAUDE.md` 버전 줄 + git tag(release PR 별도 — stage-47 전례).
