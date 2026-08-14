# Stage 29 — 이미지 첨부: 업로드·클립보드 붙여넣기·드래그앤드롭 (F54 / M28 / S29)

> 상태: **후속 수정 완료(2026-08-14) — 자동 DoD 7/7 + 7-1 충족. DoD 8(사용자 실사용 확인)과 baseline 갱신 승인 대기.** 경위:  1차 구현분은 자동 DoD 7/7 충족·검토(opus) 조건부 통과(치명 0·중요 0·경미 4)였으나, **DoD 8 실사용 확인에서 결함 1건 발견**: 미리보기 모드에서 파일 탐색기를 클릭하면 **창 포커스 상실**(`focusout`, `relatedTarget=null`)이 활성 블록을 확정·해제해 드롭 표면이 사라진다(`EditablePreview.tsx` `handleDraftBlur` — 오케스트레이터 브라우저 실측으로 원인 특정) → 이어지는 드롭이 §4.27 ⑦ "표면 없으면 요청 0 + 안내" 경로로 빠져 **탐색기 드래그앤드롭이 성립 불가**. 후속 항목 **2-6(창 포커스 상실 시 블록 유지 — S27 blur 의미 정밀화)·2-7(툴바 이미지 삽입 버튼 — 사용자 제안 채택)** 착수. baseline 갱신 승인도 함께 대기. (작업 지시서 생성 2026-08-14. 착수 전 결정 ①~④ 전건 확정 2026-08-09 — 권고안대로. 새 결정 0 — 확정분을 계약으로 전개한 것이 이 문서다.
> 계약 정본 = 계획서 §14 F54 + **설계 §4.27 [S29]**(api) + screens §5.3(DocEditor 붙여넣기·드롭·**툴바 버튼(ⓗ)** + S27 창 포커스 상실 예외 — Design v1.34))
>
> 배경: 2026-08-09 사용자 요청 13항목 중 "사진" 항목의 분리 등재분. **실측이 비용 판단을 바꾼 기능** —
> 저장 디렉터리(`sources/images/`)·서빙 라우트(`GET /images/{filename}` — 파일명 정규식 + `resolve()`·
> `is_relative_to` 경로 탈출 차단, R16 이행분)·내용 해시 파일명(`{sha256[:16]}.{ext}` — 중복 제거 공짜,
> 메타 테이블 불요)·백업 포함(`backup_service`의 `sources/` zip)이 **이미 전부 존재한다**.
> 따라서 이 단계의 신규분은 **업로드 엔드포인트 1개 + 프론트 편집 UX**뿐이고, **DDL·Alembic·백업 개정·
> 서빙 라우트·경로 보안은 0건**이다.

## 범위 요약

- **DDL 0건 · Alembic 0건 · 백업(F27) 개정 0건 · settings 키 0 · LLM 0 · 신규 의존 0**(Pillow 등 이미지 라이브러리 도입 금지 — 재인코딩·리사이즈 없음이 확정 ③). **신규 엔드포인트 1개**(업로드). 이 전제가 깨지면 임의 확정 없이 착수 중단 후 보고.
- 변경 파일 예상 — 백엔드: `backend/routers/uploads.py`(신규) · `backend/main.py`(라우터 등록만 — `/images` 서빙 라우트는 **무변경**) · 업로드 저장 로직(신규 서비스 또는 라우터 내부 — 구현 재량) · 매직 바이트 판별 헬퍼 재사용 지점(`services/convert_service.py:354 _detect_image_magic`). 프론트: `frontend/src/api/client.ts` 사용처(신규 래퍼 — `postForm` 기존 재사용) · `frontend/src/components/MarkdownFieldEditor.tsx`(붙여넣기·드롭·진행/실패 표시) + 매뉴얼. **후속분(2-6·2-7) 추가 예상**: `frontend/src/components/EditablePreview.tsx`(`handleDraftBlur` 1곳 — 창 포커스 상실 예외. 1차 구현분의 "무변경" 전제는 여기서 해제된다) · `MarkdownFieldEditor.tsx`(툴바 버튼 + 숨긴 file input) + 매뉴얼(이미지 삽입 버튼 한 줄).
- **범위 밖 확정(계획서 §14 F54)**: 동영상 업로드 · 외부 사이트 iframe 임베드 · **고아 이미지 정리**(본문 참조가 사라진 파일 삭제 — 불변 규칙 4 우선). 아래 "이 단계에서 하지 않는 것" 참조.
- **불변 규칙 4 정합 재확인**: 규칙은 "`sources/` 원본 파일은 불변 — 수정·삭제 코드 금지"이며, 이 기능은 **새 파일 쓰기만** 한다(기존 반입 경로 `_save_fetch_images`가 이미 하는 일과 동일). 덮어쓰기·삭제 코드 0.

## 체크리스트

### 1. 백엔드 (신규 엔드포인트 1개 — §4.27 계약)

- [x] **1-1. 업로드 라우터 신설**: `backend/routers/uploads.py` — `POST /api/uploads`(multipart `file` 1개). `main.py`에 `include_router` 등록만 추가(**`/images` 서빙 라우트·SPA 폴백·경로 검증은 손대지 않는다** — 무변경이 정상). 요청 형식이 multipart가 아니면 422(기존 `convert.py:74` 관례 문장 재사용).
- [x] **1-2. 수신·상한 조기 차단(③ 10MB)**: 본문을 **청크 단위로 읽으며 누적 바이트가 상한을 넘는 즉시 중단**한다(전체를 메모리에 적재한 뒤 재는 방식 금지 — §4.27 ③). `Content-Length`가 있으면 읽기 전 1차 차단하되 **신뢰하지 않고** 실제 누적 바이트가 정본. 초과 = `422` + `detail.reason='too_large'`, 파일 저장 0.
- [x] **1-3. 매직 바이트 판별 = 기존 헬퍼 재사용(① — 중복 구현 금지)**: `convert_service._detect_image_magic(data) -> 'png'|'jpg'|'gif'|'webp'|None`을 **그대로 호출**한다(webp 판정에 12바이트가 필요하므로 판별은 선두 최소 12바이트 확보 후). 파일명·`content-type`은 **판단에 쓰지 않는다**(R14 교훈 — `.pdf` 파일명이면 HTML 오류 페이지도 통과하던 검사의 재발 방지). None = **비지원**(svg·pdf·exe·HTML 전부 여기로 귀결) → `422` + `detail.reason='unsupported_type'`. 헬퍼 위치를 공용 모듈로 옮기는 것은 구현 재량이나 **판별 구현체는 앱 전체에 1개**여야 하며, 옮기면 기존 호출부·테스트를 함께 갱신한다.
- [x] **1-4. 저장·중복 제거(①)**: `sha256(전체 바이트).hexdigest()[:16]` + **판별 결과 확장자**(`png|jpg|gif|webp` — jpeg는 `jpg`로 정규화, 기존 `_save_fetch_images`와 동일 규칙)로 `sources/images/{digest}.{ext}`. 디렉터리 `mkdir(parents=True, exist_ok=True)`. **이미 있으면 쓰기 생략**하고 같은 URL 반환(mtime·내용 불변). 부분 기록 파일이 남지 않도록 임시 파일 → rename 권장(구현 재량). 응답 = **`{"url": "/images/{digest}.{ext}"}`**(필드 추가 금지 — YAGNI, §4.27 ②).
- [x] **1-5. 에러 계약 3종(§3 규약 준수)**: 코드 집합은 기존 4종에서 늘리지 않는다 — 전부 `VALIDATION_ERROR`(422) + `detail.reason` 구분자(`no_file` · `too_large` · `unsupported_type`). 413·415는 쓰지 않는다(§3 "코드 집합 불증" + `detail.reason` 전례). `message`는 한국어 사람 말 + 다음 행동(예: "10MB 이하 이미지만 올릴 수 있습니다").
- [x] **1-6. 기존 자산 정합 회귀 확인**: ⓐ 저장 파일명이 서빙 정규식 `^[0-9a-f]{16}\.(gif|png|jpg|jpeg|webp)$`를 충족하고 `GET /images/{filename}` 200 ⓑ 비허용 파일명·경로 탈출 시도는 여전히 404(`main.py` 무변경 확인) ⓒ **`sources` 테이블 행 생성 0 · DB 쓰기 0 · DDL 0**(업로드는 파일 시스템에만 쓴다) ⓓ 백업(F27) `sources/` zip에 업로드분이 자동 포함됨(코드 변경 0 — 실행 확인만).

### 2. 프론트 (DocEditor 붙여넣기·드롭 — screens §5.3 S29)

- [x] **2-1. 업로드 API 래퍼**: `api.postForm`(기존 — FormData면 Content-Type 미지정 처리 완료, `client.ts:70`) 재사용해 `POST /api/uploads` 호출 → `{url}` 반환. 서버 에러는 기존 `client.ts` 경로로 `message`가 그대로 올라오게 두고 **프론트에서 문구를 창작하지 않는다**(§3).
- [x] **2-2. 클립보드 붙여넣기(④)**: `MarkdownFieldEditor` **1곳**에만 핸들러를 단다(공용 편집기 — DocEditor 본문·해설 전 사용처 자동 파급, 사용처별 분기 금지). `clipboardData`에 이미지 파일이 있을 때만 `preventDefault()` 후 업로드 — **이미지가 없는 붙여넣기(텍스트·HTML)는 기존 동작 그대로**(가로채기 금지).
- [x] **2-3. 드래그앤드롭(④)**: 편집기 영역에 `dragover` 기본 동작 차단(브라우저가 파일을 열어 앱을 이탈하는 것 방지) + `drop` 처리. **비이미지 드롭 = 업로드 요청 0 + 짧은 안내**(기존 `flashWrapNotice`/`role="status"` 재사용). 드래그 중 시각 피드백은 기존 토큰(`border-accent`·`bg-accent-soft` 등)만 사용 — **신규 색 하드코딩 0**(불변 규칙 5).
- [x] **2-4. 활성 편집 표면 재사용(S27 자산 — 이 단계의 핵심 정합 지점)**: 삽입은 **반드시 `insertAtCursor(snippet)`을 통해서만** 한다. 이 함수는 `getSurface()`가 반환하는 활성 표면(편집·분할 모드 = 본문 textarea / **미리보기 모드 = 활성 블록 textarea**)에 쓰고 `applyRangeEdit`로 undo 스택까지 보존하므로, 표면 3종에 대한 분기 코드를 새로 만들지 않는다. **업로드 요청 전에 `requireSurface()`로 표면 존재를 먼저 확인**한다 — 미리보기 모드에서 활성 블록이 없으면 기존 안내("편집할 블록을 먼저 클릭하세요")만 띄우고 **업로드하지 않는다**(삽입 못 할 파일을 디스크에 쌓지 않는다).
- [x] **2-5. 진행·실패 표시와 다중 파일**: 업로드 중 `role="status"` 안내 1줄(기존 안내 영역 재사용 — 신규 컴포넌트·신규 색 0), 완료 시 해제. 여러 장은 **순차 업로드**(동시 다발 금지 — 삽입 순서 보장), 각 성공 직후 `![](/images/…)` 삽입, **한 장 실패해도 나머지는 계속**하고 실패분은 파일명 + 서버 `message`로 안내. 삽입 문자열은 `![](/images/…)`(alt 비움 — 확정 ④), 여러 장 사이의 구분(개행 등)은 구현 재량이되 **한 장 삽입 결과에 불필요한 개행을 덧붙이지 않는다**.

> 아래 2-6·2-7은 **DoD 8 실사용 확인(2026-08-14)에서 나온 후속 항목**이다(결함 1건 + 사용자 제안 1건 — 새 결정 0, 계약은 screens §5.3 S27·S29 ⓗ와 §4.27 ⑦에 반영됨).

- [x] **2-6. 창 포커스 상실 시 블록 유지(S27 blur 의미 정밀화 — screens §5.3 S27 ⓒ · 번복 아님)**: `frontend/src/components/EditablePreview.tsx`의 `handleDraftBlur`에서 **문서 전체가 포커스를 잃은 경우(`document.hasFocus() === false`)는 확정하지 않는다** — 블록 편집 상태·캐럿·초안을 그대로 유지해 사용자가 창으로 돌아오면 이어서 편집한다(파일 탐색기·다른 앱 클릭·알트탭 시 `relatedTarget=null`인 `focusout`이 블록을 닫아 드롭 표면이 사라지던 결함의 원인 지점). **기존 확정 경로는 전건 유지**: 페이지 안에서 편집기 밖 클릭(document pointerdown capture)·다른 블록 클릭·Ctrl+Enter·뷰 모드 전환·언마운트 안전망·저장 버튼 경로 — **초안이 조용히 사라지는 길은 여전히 0**이고, 달라지는 것은 "다른 앱에 갔다 돌아오면 편집이 유지된다" 하나뿐이다. 확정의 blur는 ***페이지 내* 포커스 이탈**을 뜻한다는 정밀화이며 S27 계약의 번복이 아니다(stage-27 완료 기록 후속 정밀화 줄과 짝).
- [x] **2-7. 툴바 이미지 삽입 버튼(screens §5.3 S29 ⓗ — 2026-08-14 사용자 제안 채택)**: `MarkdownFieldEditor` 툴바(F52 툴바와 같은 줄 체계·삽입 그룹)에 진입점 1개 추가 — 레이블은 기존 툴바 관례에 맞춘 짧은 한국어. 구현 = **숨긴 `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple>` 1개**를 버튼 클릭으로 여는 것뿐 — **신규 컴포넌트 0 · 신규 색 0(토큰만) · 신규 업로드 경로 0**: 선택된 파일은 2-5의 순차 업로드 루프(`uploadFilesSequentially`)를 그대로 탄다(순차·부분 실패 계속·실패는 서버 `message`·삽입은 `insertAtCursor` 경유). **업로드 전 `requireSurface()` 선확인**은 2-4와 동일(미리보기 모드에서 활성 블록이 없으면 안내만·요청 0). 툴바는 편집기 크롬이므로 버튼 조작이 활성 블록을 해제하지 않아야 한다(기존 mousedown 가드 + 2-6의 창 포커스 예외가 함께 보장 — **파일 대화상자를 여는 조작으로 초안을 잃지 않는 것이 계약**). 같은 파일 재선택을 위한 input 값 초기화는 구현 재량. **API 변경 0 · DDL 0 · 신규 의존 0**(§4.27 서버 계약 ①~⑥ 무변경 — ⑦ 프론트 요약에 진입점만 추가됨).

### 3. 문서·매뉴얼

- [x] **3-1. 매뉴얼 갱신**(`docs/manual/user-manual.html`): 문서 편집 §에 이미지 첨부(캡처 Ctrl+V·드래그앤드롭·10MB 상한·지원 형식 png/jpg/gif/webp·**svg 미지원 사유 한 줄**·같은 이미지 중복 업로드 시 파일 1개) + 백업에 이미지가 포함된다는 사실 + **삭제한 이미지 파일은 자동 정리되지 않는다**는 알려진 동작 명시(조용한 실패 금지).
- [x] **3-2. stage 문서 체크박스 갱신**(불변 규칙 10) + 완료 기록 작성(판별 헬퍼 재사용 형태·상한 차단 실측·중복 업로드 실측 결과 포함).

## DoD (Definition of Done)

자동(구현·검토 세션에서 확인):
1. `npm run build` 0 에러 · `run-tests.ps1` 기존 통과 유지 · `invariant-scan.ps1` PASS(신규 색 하드코딩 0).
2. **판별 매트릭스**: png·jpg·gif·webp 정상 업로드 200 + `{url}` / **사칭 파일 전건 422**(`.png` 확장자를 붙인 HTML·PDF·SVG·EXE — `content-type: image/png`을 함께 위조해도 거부) — 파일명·content-type이 판정에 영향 0임을 실증. 검증은 pytest 소수(기존 `test_doc_format_detect.py` 전례) 또는 실행 스모크 매트릭스로 하고 결과를 완료 기록에 남긴다.
3. **상한 조기 차단**: 10MB 초과 업로드 = 422(`reason='too_large'`) + `sources/images/` 파일 수 불변, 전체 바이트를 메모리에 적재하지 않음(구현 형태로 확인).
4. **중복 업로드 = 파일 1개**: 같은 이미지 2회 업로드 시 응답 URL 동일 + 디렉터리 파일 수 증가 0 + 기존 파일 mtime 불변(쓰기 생략 실증).
5. **기존 자산 무변경 회귀**: 업로드 결과 URL이 `GET /images/…` 200으로 서빙되고, 경로 탈출·비허용 파일명 요청은 404 그대로(`main.py` 이미지·SPA 라우트 diff 0).
6. **편집 표면 3종 동작**: 편집·분할 모드에서 붙여넣기·드롭 삽입 정상 / 미리보기 모드는 **활성 블록에 삽입** / 미리보기에서 활성 블록이 없으면 **업로드 요청 0 + 안내**. 텍스트 붙여넣기·비이미지 드롭은 업로드 요청 0이고 기존 동작 불변.
7. **DDL·백업·의존 0 재확인**: Alembic 리비전 추가 0 · `backup_service` diff 0 · `requirements`/`package.json` 신규 의존 0 · DB 스키마·`sources` 테이블 행 변화 0.
7-1. **후속 수정 2경로 실측(2-6·2-7 — 2026-08-14 추가)**: ⓐ 미리보기 모드에서 블록 편집 중 창 포커스를 잃었다 돌아와도 블록·캐럿·초안이 유지되고(그 상태로 탐색기 드래그앤드롭이 활성 블록에 삽입) 기존 확정 경로 6종은 그대로 확정됨 ⓑ 툴바 이미지 삽입 버튼으로 편집·분할·미리보기 3표면 삽입 정상 + 미리보기에 활성 블록 없으면 요청 0 + 안내 + 다중 선택 순차·부분 실패 계속 — 두 경로 모두 실브라우저로 확인하고 결과를 완료 기록에 남긴다.

사용자 이행(서버는 사용자가 직접 구동 — Claude는 서버를 남기지 않는다):
8. 실사용 확인 — PC에서 캡처 후 Ctrl+V, 파일 탐색기에서 드래그앤드롭, **폰(터치)에서 이미지 붙여넣기** 체감 확인 + 저장된 문서가 문서 상세·학습·인쇄·임베드 카드에서 이미지가 정상 표시되는지 + 백업 실행 후 zip에 이미지가 들어 있는지 확인.

## 이 단계에서 하지 않는 것

- **동영상 업로드 없음**(범위 밖 확정 — 백업 zip 용량 폭증).
- **외부 사이트 iframe 임베드 없음**(범위 밖 확정 — 대부분 사이트가 `X-Frame-Options`/`frame-ancestors`로 거부해 빈 회색 상자가 된다. 링크 표시로 갈음. YouTube 등 화이트리스트 iframe은 실수요 확인 시 **계획서 먼저**).
- **고아 이미지 정리 없음**(본문 참조가 사라진 파일 삭제 — 불변 규칙 4 "`sources/` 원본 불변" 우선. 디스크 상한은 실사용 실측 후 재검토).
- **SVG 지원 없음**(② 확정 — 스크립트를 품을 수 있어 F52 결정 ①(raw HTML 기각)과 동형의 문제를 우회로로 되불러온다).
- **리사이즈·재인코딩·썸네일·EXIF 처리 없음**(③ 확정 — Pillow 도입은 F42/R19 "포맷당 파서 1개·계획서 등재 후 추가" 대상. 개인용 캡처는 통상 1MB 미만).
- **이미지 메타 테이블·업로드 이력 없음**(DDL 0 — 내용 해시 파일명이 중복 제거를 이미 해결. 어느 문서가 어느 이미지를 쓰는지는 본문이 단일 출처).
- **alt 텍스트 편집 UI·이미지 크기 조절 문법 없음**(삽입은 `![](/images/…)` 고정. 필요가 실측되면 F52 문법 체계에서 계획서 먼저).
- **읽기 전용 화면·반입 화면의 드롭 없음**(붙여넣기·드롭은 `MarkdownFieldEditor` 안에서만. 반입 §5.9의 파일 업로드는 별개 경로 — 무변경).
- **업로드 진행률 바 없음**(파일당 10MB 상한 + 로컬 서버 — 진행 중 표시 1줄로 충분. XHR progress 도입은 YAGNI).

## 리스크

- **매직 바이트 검사의 실효(R14 교훈 계승)**: 이 단계의 유일한 신뢰 경계다. "확장자·content-type을 아예 판단에 쓰지 않는다"를 코드로 지키지 않으면(예: 판별 실패 시 확장자로 폴백) R14가 그대로 재발한다 — **폴백 금지**가 계약(판별 None = 거부, `_save_fetch_images`의 `.get(ctype, "png")` 기본값 폴백을 업로드 경로에 복제하지 말 것. 그쪽은 내가 요청한 URL의 응답이라 신뢰 조건이 다르다).
- **경로 탈출(R16)**: 저장 파일명은 **서버가 계산한 해시 + 판별 확장자**로만 만들고 사용자 제공 파일명은 어떤 경로 계산에도 쓰지 않는다(파일명은 로그·안내 문구에만). 서빙 라우트는 이미 정규식 + `is_relative_to`로 이중 차단 — **무변경 유지**가 방어선이다.
- **디스크 누적(수용·기록)**: 고아 정리를 하지 않으므로 업로드한 이미지는 계속 남는다(백업 zip 용량에도 반영). 개인용·10MB 상한·내용 해시 중복 제거로 증가율이 제한되며, 실사용 실측 후 재검토(정리 기능은 계획서 먼저 — 불변 규칙 4와의 충돌 때문에 임의 도입 금지).
- **편집 표면 3종과의 정합(S27 연동)**: 미리보기 모드에서 활성 블록이 없을 때 업로드부터 하면 "삽입되지 않은 파일"이 디스크에 남는다 — 2-4의 **선(先) 표면 확인**이 이 리스크의 대응이다. 또 블록 초안에 삽입한 뒤 **Esc(취소)** 를 누르면 삽입이 사라지지만 파일은 남는다(S27 초안 의미론상 정상 — 알려진 동작으로 매뉴얼에는 적지 않고 이 문서에만 기록).
- **계획서 §15 리스크 표 무변경**: 이 단계는 스키마 변경 0·신규 리스크 축 0이며, 관련 리스크는 기존 R14(매직 바이트)·R16(경로 탈출)·R19(파서 의존 원칙 — 의존 0으로 회피)가 그대로 담당한다.

## 완료 기록 (2026-08-14)

- **구현**: backend-dev·frontend-dev 2묶음 병렬(계약이 §4.27로 확정돼 있어 의존 없음). 신규 = `backend/routers/uploads.py`(얇은 라우터) · `backend/services/upload_service.py`(수신·상한·판별 호출·저장) · `backend/schemas/upload.py`(`UploadResult(url)` 1필드) · `backend/tests/test_uploads.py`(13건) · `frontend/src/api/uploads.ts`(`useUploadImage` — 기존 `postForm` 재사용). 수정 = `backend/main.py` **2줄뿐**(import + `include_router` — `/images` 서빙·SPA 폴백 diff 0) · `frontend/src/api/types.ts` · `frontend/src/components/MarkdownFieldEditor.tsx`(붙여넣기·드롭·순차 업로드·안내) · 매뉴얼. **`EditablePreview.tsx`·`DocEditor.tsx`·`MarkdownView.tsx` diff 0**.
- **판별 헬퍼 재사용 형태(1-3)**: `convert_service._detect_image_magic`을 **직접 import해 호출**(공용 모듈 이동은 하지 않음 — 호출부·테스트 동기 부담 회피). 판별 구현체는 앱 전체에 1개 유지, `.get(ctype,"png")` 류 폴백 **복제 0**. 신규 코드에서 `content_type`은 multipart 여부 판정과 에러 detail 기록에만 등장한다. 검토자 양방향 실증 — 위장 파일(HTML·PDF·SVG·EXE를 `.png` + `content-type: image/png`) 전건 422 / **진짜 GIF를 `whatever.txt` + `text/plain`으로 보내도 200**(확장자·ctype이 수용·거부 어느 방향으로도 개입 0).
- **상한 조기 차단 실측(1-2 / DoD 3)**: starlette 기본 `max_part_size`가 파일 파트에 적용되지 않음을 코드 실측으로 확인 → `_SizeLimitedMultiPartParser`가 `on_part_data`를 오버라이드해 파일 파트 누적 바이트에 직접 상한. 검토자 재현 — **200MB chunked 업로드가 11,337,036바이트(≈10MB+인플라이트)만 수신하고 21ms에 422**(전체 버퍼링이 아님을 바이트 수로 실증) · 12MB chunked(Content-Length 없음) 422 · 30MB + Content-Length는 본문 읽기 전 1.9ms 1차 차단. `+4096` 여유폭은 정확히 10MB 파일의 봉투 오버헤드를 흡수하기 위한 최소치이며 정본은 항상 누적 바이트(우회로 아님 — chunked 실증). starlette 1.3.1 `==` 핀 + 파서 경로를 타는 테스트가 있어 버전 업으로 무력화되면 **테스트가 실패로 드러난다**(조용히 깨지지 않음).
- **중복 업로드 실측(DoD 4)**: 같은 이미지 2회 → URL 동일 · `sources/images/` 파일 수 증가 0 · **기존 파일 mtime 완전 불변**(쓰기 생략 실증). 저장은 임시 파일(`.{digest}.{ext}.{uuid}.tmp`) → `Path.replace` 원자 교체.
- **baseline 갱신 사유(사용자 승인 대기)**: `scripts/invariant-baseline.json`의 `fs-mutate`에 `backend/services/upload_service.py: 1` 추가. 대상은 **서버가 방금 만든 미완성 스크래치 임시 파일**의 정리(`unlink(missing_ok=True)`)이며 쓰기 실패 경로 전용(`replace` 성공 시 호출조차 되지 않음), 서빙 정규식에 걸리지 않는 파일명 — `sources/` 원본을 수정·삭제하는 경로는 0이다(불변 규칙 4 정합). split/convert/improve 선례와 같은 성격. 검토자 판정도 "타당 · 되돌리기 불필요".
- **검증**: `run-tests.ps1` **528 passed**(기존 515 + 신규 13) · `invariant-scan.ps1` **PASS**(신규 위반 0 — 신규 클래스 전부 토큰) · `npm run build` 0 에러 · `requirements.txt`·`package.json` diff 0(신규 의존 0) · Alembic 리비전 0 · `backup_service` diff 0 · `sources` 테이블 행 수 불변(sqlite 조회) · 경로 탈출 6종(`../`·`..%2F`·`%2e%2e`·하위 경로·비허용 파일명·`.svg`) 전건 404 유지 · 백업 zip 실물에 `images/` 엔트리 25개 자동 포함(F27 코드 변경 0).
- **브라우저 실측(CDP — DoD 6)**: 분할 모드 붙여넣기 → 업로드·`![](/images/…)` 삽입·이미지 200 렌더 / **미리보기에 활성 블록 없음 → 안내만·업로드 요청 0** / 활성 블록 클릭 후 붙여넣기 → 그 블록 textarea에 삽입 / 편집 모드 2장 동시(정상 1 + 위장 1) → 정상만 삽입, 실패분은 `fake.png: <서버 message>` 안내(프론트 문구 창작 0) / 텍스트 붙여넣기 = `preventDefault` 안 함·요청 0 / 비이미지 **드롭** = 요청 0 + 안내. 총 업로드 요청 3건(200·200·422), 콘솔 에러 0.
- **검토(stage-reviewer opus)**: **조건부 통과** — 자동 DoD **7/7** 충족, 치명 0·중요 0·경미 4. 조건 = ⓐ 이 완료 기록 작성(이행분) ⓑ baseline 갱신 사용자 승인.
- **경미 결함(미수정·기록 — 수정 여부는 사용자 결정)**: ① `_store_image`의 TOCTOU — 동시 업로드 시 `exists()` 통과 후 `replace`가 기존 파일을 교체할 여지(내용은 해시 동일이라 같고 mtime만 변함. 프론트가 순차 업로드라 실사용 영향 사실상 0. 해소안 = `open(target,"xb")`로 바꾸면 경미-1과 baseline 항목이 동시에 사라지나 프로세스 급사 시 부분 파일 잔존 트레이드오프) ② 비이미지 **파일 붙여넣기**는 안내 없이 조용히 무시(드롭 경로에는 안내 있음 — 모든 텍스트 붙여넣기에 안내가 뜨는 부작용을 피한 정당한 해석. 보완은 `files.length > 0 && imageFiles.length === 0` 조건 1줄) ③ `isImageFile`이 `file.type`에만 의존 — MIME이 빈 이미지 파일을 클라이언트가 먼저 거부(서버였다면 200) ④ `file` 외 파일 파트의 스풀 임시파일 미종료(앱 프론트에서는 도달 불가·`sources/`와 무관).
- **미확인 의심(기록)**: 링크(URL) 드롭 시 브라우저 기본 동작 — `dragover`를 무조건 취소하므로 컨테이너가 유효 드롭 타깃이 되는데 링크 드롭 경로는 실측하지 않았다(DoD 8 실사용에서 관찰 권고). 미리보기 모드에서 업로드 대기 중 blur로 블록이 확정되면 파일은 저장되고 삽입만 안내로 끝난다(S27 초안 의미론과 동형 — 계약상 수용).
- **DoD**: 자동 1~7 전건 충족. **8(사용자 이행 — PC·폰 실사용 + 백업 zip 확인) 대기** — 서버는 사용자가 직접 구동한다(Claude는 서버를 남기지 않음).
### 후속 수정 완료 기록 (2026-08-14 — DoD 8 실사용 확인분)

- **계기(사용자 보고 원문)**: "블록을 선택한 상태에서 파일을 드래그앤 드롭해야 되는데, 파일탐색기를 누르면 블록 선택이 해제되고있어. 확인해줘. 이미지 삽입 버튼을 별도로 추가하는건 어때?" → 결함 1건 확인 + 제안 1건 채택.
- **원인 특정(오케스트레이터 브라우저 실측)**: `EditablePreview.tsx handleDraftBlur`가 `relatedTarget`이 크롬 밖이면 무조건 `commit()` → 다른 앱 클릭 시 발생하는 `focusout(relatedTarget=null)`이 블록을 확정·해제 → `registerSurface(null)` → 이어지는 드롭이 "표면 없음 = 요청 0 + 안내"로 빠짐. 활성 블록 상태에서 `focusout(bubbles:true, relatedTarget:null)`을 디스패치해 **블록 활성 true → false** 재현.
- **2-6 구현**: `handleDraftBlur`에 가드 1줄 — `if (!document.hasFocus()) return`. 변경은 그 한 곳뿐. 기존 확정 경로 6종은 전부 `handleDraftBlur`를 거치지 않고 `commit()`을 **직접** 호출하므로(편집기 밖 클릭 = document pointerdown capture · 다른 블록 클릭 = `handleContainerClick`→`activate()` · Ctrl+Enter = `handleDraftKeyDown` · 뷰 모드 전환 = `MarkdownFieldEditor.setViewMode` · 언마운트 안전망 = cleanup effect · 저장 버튼 = 밖 클릭 경로) 새 가드에 걸리지 않는다.
- **2-7 구현**: 툴바 "삽입" 그룹 첫 항목에 **`이미지`** 버튼(title="이미지 삽입") + 숨긴 `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple class="hidden">`. 기존 툴바 관례대로 `onMouseDown={keepFocus}`(preventDefault)로 포커스를 뺏지 않고, 선택된 파일은 2-5의 `uploadFilesSequentially`를 그대로 탄다(신규 업로드 경로 0). 같은 파일 재선택을 위해 `onChange` 첫 줄에서 `e.target.value = ''`.
- **브라우저 실측(DoD 7-1)**: ⓐ **창 포커스 상실 → 블록·초안 유지**(`document.hasFocus()`를 false로 만든 뒤 `focusout(null)` → 블록 활성 유지·초안 텍스트 보존) / **회귀**: 창 포커스가 있는 상태의 같은 이벤트는 **여전히 확정**(블록 닫히고 본문에 반영) ⓑ **사용자 시나리오 통과** — 블록 활성 → 창 포커스 상실 → 복귀 → 파일 드롭 → **그 블록에 삽입**(1차 구현에서 불가능했던 경로) ⓒ 툴바 버튼: 존재·`accept` 4종·`multiple` 확인, **mousedown이 defaultPrevented = 블록 유지**, 2장 선택 시 **순차 업로드 200×2·순서대로 삽입**(2장째만 개행 prefix)·input 값 초기화 ⓓ **미리보기에 활성 블록 없을 때 파일 선택 = 안내만·업로드 요청 0** ⓔ 콘솔 에러 0.
- **검증**: `npm run build` 0 에러 · `invariant-scan.ps1` **PASS** · `run-tests.ps1` **528 passed**(백엔드 diff 0) · `package.json` diff 0 · `backend/`·`DocEditor.tsx`·`MarkdownView.tsx` diff 0.
- **환경 한계(기록)**: CDP 환경에서는 실제 OS 창 포커스 이동(다른 창·Notepad 실행)이 `document.hasFocus()`에 반영되지 않아, 창 포커스 상실은 `document.hasFocus()` 오버라이드 + `focusout(relatedTarget=null)` 조합으로 재현했다(브라우저가 앱 전환 시 실제로 내보내는 이벤트·상태 조합과 동일). **실제 파일 탐색기로의 왕복 체감 확인은 DoD 8(사용자 이행)에 남는다.**

- **스모크 잔여물(삭제하지 않음 — 불변 규칙 4)**: `sources/images/`에 검증용 파일 — `d4186e5259b65444.png`(21B) · `67756061fff26a72.jpg`(16B) · `837c388dea4fe620.gif`(19B) · `6db978239f7e9d87.webp`(26B) · `8d7f4ef1583d1913.png`(**10MB — 경계 테스트용**) + 브라우저 실측분 3건(1×1 PNG). 백업 zip 용량이 신경 쓰이면 10MB 파일만 사용자가 직접 지우면 된다.
