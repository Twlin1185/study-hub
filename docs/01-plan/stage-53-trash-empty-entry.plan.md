# Stage 53 — 휴지통 후속: 전체 비우기 + 진입 경로 (FB-26 · FB-27) (v2.0.x · 사소)

> 상태: **착수 전**(편성 2026-09-27 · 사용자 확정 4항(아래) · 번호 53 · 진행 중 stage-52(v2.03.1 발행 대기 — V-3 실측·DoD 6 회신)와 **별개 편성** · 착수 순서 = stage-52 발행 여부와 무관 · 사용자 확정 대기 **0**).
> **버전 영향: 사소**(사용자 확정 2026-09-27 — "stage-53(사소)"로 제시·승인 · 근거 병기 — CHANGELOG 규약 ③): 기존 표면(`/trash`) **다듬기**(새 화면 0) · 엔드포인트 **+1**(선례 stage-48 `duplicate` +1 = 사소) · 내비 항목 추가(선례 stage-49 = 사소) · **DDL 0**. → 산출 버전 = 규약 ② PP+1 — **두 갈래**(완료 시점에 판정 · §6 ①): ⓐ stage-52 **v2.03.1 발행 후** 완료 → **v2.03.2** ⓑ **발행 전** 완료 → stage-51 §6 ① ⓑ 전례(사소가 핵심에 합류 · 번호 재부여 없음)로 **v2.03.1 합류** 판정. 마스터 §14 M 행 **추가 없음**(사소 — stage-index가 담당) · §5 F 행 추가 없음(F61 색인 행에 1구 추기만).
> 생성 경위: `backlog.md` §1 **FB-26**(별지 §13 — "추후에 휴지통 전체 비우기 추가" · 착수 전 결정 = D8 재론) + **FB-27**(별지 §13 — "휴지통으로 이동하는 경로가 너무 복잡함" · 진입점 재론). **사용자 확정 2026-09-27 = 곧 D8 재론 결과**(별지 §10 D8 행 재론 추기 · 마스터 §15 R43 ③ 봉인 "삭제 엔드포인트 0"의 **사용자 확정 해제**): ① 묶음 = FB-26 + FB-27 → stage-53(같은 휴지통 표면 · 둘 다 사소 → 1 stage 동승) ② 버전 영향 사소 ③ **FB-26 형태 = ⓐ 전체 비우기 버튼만**([이미지] 탭 휴지통 폴더 목록에 `[휴지통 비우기]` 1개 → `sources/images/.trash/` 안 파일 전부 물리 삭제 · 사용자 명시 클릭 + `ConfirmDialog`(`danger`) 실수치 "파일 n개 · 총 크기" + "되돌릴 수 없습니다" · **자동·주기·용량 상한 삭제 여전히 0** · 항목별 영구 삭제 없음 · 문서·노트 완전 삭제는 불변 규칙 3으로 범위 밖) ④ **FB-27 진입점 = ⓐ + ⓑ + ⓒ 전부**(ⓐ 삭제 확인 모달 4곳 + 삭제 완료 알림에 "휴지통 열기" 링크 — stage-52 규약 G "모달 안 라우팅 0"·§4 "`ConfirmDialog` 옵션 확장 0(S50 봉인)"은 **이 사용자 확정으로 해제** · ⓑ 탐색(§5.2)·노트 목록(§5.16) 상단 "휴지통" 진입 1개 · ⓒ 사이드바·드로어 항목 추가(하단 탭바 5 불변) · 설정 › 데이터 카드는 그대로 유지).
> 정본 포인터: API 계약 = api **§4.32 `[S53]` 추기**(① 표 행 `POST /api/trash/images/empty` + ⑦ 블록 — 편성 추기 **Design v1.67**) · 화면 계약 = screens **§5.17 S53 추기**(진입점 4 · `?tab=` · `[휴지통 비우기]`) + §5.2·§5.16 상단 진입 1줄 + §5 도입부 내비 1줄 · 불변 규칙 **4(이 stage에서 재개정 — 규약 J · 편성 시 이행)** · 1·2·3(문서·노트 물리 삭제 0)·5(토큰만)·6(DDL 0)·8(에러 §3) · R16(경로 가드) · R43(감시 유지 — 완화 열 추기) · 발행 절차 = CHANGELOG 머리 규약 ⑤.

## 1. 범위 (백엔드 엔드포인트 +1 · 프론트 `/trash` 다듬기 + 진입점 4 + 문구·알림 · 규칙 개정 2곳 — 코드 실측 2026-09-27)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **FB-26 휴지통 전체 비우기**(backlog §1 17행 · 별지 §13 507행 · D8 재론 = 사용자 확정 2026-09-27) | 신규 API 1 + 버튼 1 + **파일 삭제 코드 첫 도입** | `[이미지]` 탭 휴지통 폴더 목록에 `[휴지통 비우기]` → `.trash/` 직속 정규 이미지 파일 전부 `os.remove` · 확인 모달 실수치 · 되돌릴 수 없음 | 서비스 `backend/services/trash_service.py` — 삭제 함수 **0**(모듈 docstring `:7` "파일 삭제 코드 0") · `_trash_dir():50~51` · `IMAGE_FILENAME_RE:33` · `_validate_filenames:173` · `_guarded_pairs:181`(`resolve()`+`is_relative_to` 가드) · `move_to_trash:196`(`shutil.move:221`) · `restore_from_trash:227`(`shutil.move:241`) · lazy mkdir `:220`. 라우터 `backend/routers/trash.py:26` `prefix=/api/trash` · 5 엔드포인트 `:29~72`(GET 3 · POST `/images/move:61` · `/images/restore:69` — **부작용 조작 = POST 동사 관례**) · docstring `:5~6` "최종 삭제 엔드포인트는 없다". 스키마 `backend/schemas/trash.py:41~48` `TrashMoveResult`·`TrashRestoreResult`. 테스트 `backend/tests/test_trash.py` 20건 · `dirs` 픽스처 `:75~`(`tmp_path`로 `convert_service.SOURCES_IMAGES_DIR`·`preview_store.AUTO_DIR`·`main.IMAGES_DIR` monkeypatch — 실 `sources/` 무접촉). invariant `scripts/invariant-scan.ps1:61~66` `fs-mutate` 패턴 `os\.remove\(\|\.unlink\(\|shutil\.rmtree\(\|shutil\.move\(` · 규칙 문자열 `:62` · 기준선 `scripts/invariant-baseline.json:26` `"backend/services/trash_service.py": 2`. 프론트 `frontend/src/pages/Trash.tsx` — `TrashImagesTab` 휴지통 폴더 목록 `:439~476`(`<h2>휴지통 폴더 목록</h2>:439` · 빈 상태 `:441` · 표 `:444` · `[되돌리기]:462~469`) · 안내 2줄 `:343~350`("최종 삭제는 탐색기에서 아래 폴더를 비우세요") · 이동 확인 `ConfirmDialog:480~489`(중립 색) · `formatBytes:38` · `summary`/`actionError` 상태 관례 `:361~362`. 훅 `frontend/src/api/trash.ts` 5개(`useMoveImagesToTrash:54` · `useRestoreImagesFromTrash:72` — `onSuccess` `removeQueries(trashKeys.images)` 관례 · 폴백 문구 mutationFn 1곳 `:28~29`) |
| **FB-27 ⓐ 모달·알림 링크**(backlog §1 18행 · 별지 §13 508행 · 사용자 확정 ⓐ) | 공용 컴포넌트 옵션 +1 · 문구 4곳 · 알림 2곳 | 삭제 확인 모달 4곳 끝 `[휴지통 열기]` 링크(모달 닫힘 + 라우팅 · 삭제 실행 아님) + 삭제 완료 알림 링크(가능한 화면 2곳) | `frontend/src/components/ConfirmDialog.tsx:3~12` props = `title`·`message: string`(`whitespace-pre-line:28`)·`confirmLabel`·`danger`·`onConfirm`·`onClose`·`submitting`·`errorMessage` — ReactNode 슬롯 **0** · 버튼 2개 `type="button":31,38`(폼·Enter 기본 제출 없음). 4곳 = `editor2/pages/NoteEditPage.tsx:699~709`(삭제 후 `navigate('/notes'):471` — `dirtyRef:470` 이탈 가드) · `editor2/pages/NoteListPage.tsx:207~217`(삭제 성공 = `setPendingDelete(null):85` · 성공 알림 **0** · `actionError:47,117`만) · `pages/DocumentDetail.tsx:526~544`(`message` = 문자열 `+` 연결 `:531~535` · 삭제 후 `navigate('/explore'):542`) · `pages/Explore.tsx:556~575`(일괄 삭제 → `setBulkResultSummary(summarizeBulkResult(result)):571` → `components/BulkSelectionBar.tsx:11` `resultSummary: string \| null` · 선택 0 시 요약 1줄 `:35~41` · 툴바 우측 `:74`). 알림(toast) 공용 헬퍼 **없음**(각 화면 1줄 알림 로컬 상태 관례) |
| **FB-27 ⓑ 탐색·노트 목록 상단 진입**(사용자 확정 ⓑ) | 링크 2 | 탐색 필터바·노트 목록 헤더에 "휴지통" 진입 1개씩 | `pages/Explore.tsx:249~307` 필터바 행(`flex flex-wrap` · 타입·태그 select · 체크박스 3 · `+ 새 문서` `ml-auto hidden md:block:300~306`) · 모바일 행 `:232~247`. `editor2/pages/NoteListPage.tsx:92~107` 헤더(`<h1>노트</h1>:94` + `[새 노트]:99~106` 우측) |
| **FB-27 ⓒ 내비 항목**(사용자 확정 ⓒ) | 내비 배열 +1(단일 출처) | 사이드바·드로어 **하단 그룹**에 "휴지통" 1항목 · 하단 탭바 5 불변 | `components/Layout.tsx:21~27` `NAV_ITEMS` 5(하단 탭바 = 불변 `:231~233`) · `:31~35` `DESKTOP_EXTRA_ITEMS` 3 · `:40` `NOTES_NAV_ITEM` · 사이드바 하단 그룹 `:165~184`(`mt-auto` — 설정 `NavButton:166` · `JobCenterButton:169` · 도움말 `<a>:172~183`) · 드로어 하단 그룹 `:268~287`(`JobCenterButton:270` · 도움말 `:278~286` — **설정 미포함**(헤더 ⚙️) · 주석 `:237~240` "9 + 하단 2 = 11") · `NavButton` `collapsed` 레일 = 아이콘+title `:76` |
| **`?tab=` 초기 탭**(ⓐ·ⓑ 링크가 탭을 지정하기 위한 부수 계약) | 라우트 쿼리 수용 | `/trash?tab=documents\|notes\|images` 초기 탭만 | `pages/Trash.tsx:45` `TrashTab` · `:47~51` `TABS` · `:54` `useState<TrashTab>('documents')`(URL 보존 0 — stage-52 규약 G) · `App.tsx:36` lazy · `:90~93` `<Route path="/trash">` |
| **불변 규칙 4 재개정**(D8 재론 이행 — 규약 J) | 규약 개정(문서 2곳 + 스캔 규칙 문자열 1줄 + 기준선 1) | "최종 삭제 = 사용자 수동(탐색기 **또는 앱 [휴지통 비우기]**)" | `docs/01-plan/study-app.plan.md:354`(§6.3 4 — stage-52 개정본 "자동 삭제 0 · 최종 삭제 = 사용자 수동(탐색기에서 폴더 비움) … 삭제 함수 호출 0") · `CLAUDE.md:67` · `invariant-scan.ps1:62` · `invariant-baseline.json:26` |

**DDL 0(계획서 §6.2 무변 · Alembic 0 · settings 키 0) · 신규 엔드포인트 1(`POST /api/trash/images/empty`) · 기존 엔드포인트 7 무변 · 새 라우트 0(`/trash` 쿼리만) · 신규 의존 0 · `sources/` 반입 원본 무접촉 · `sources/images/` 직속(휴지통 밖) 무접촉 · 파일 삭제 코드 = `trash_service.py` 1곳(`os.remove` · `.trash/` 직속 정규 이름 파일만) · 문서·노트 물리 삭제 0(불변 규칙 3) · attempts·srs 무접촉 · 응답에 정답·해설 0 · 하단 탭바 5 무변.**

## 2. 확정 규약 (착수 전 결정 — 사용자 확정 4항은 머리말 · 그 외 위임 판정 · 이 문서가 정본 · **사용자 확정 대기 0 — 편성 보류 아님**)

- **A. 엔드포인트 = `POST /api/trash/images/empty`(본문 없음) → `200 { "deleted": n, "freed_bytes": n, "skipped": n }`** (결정 ①)
  - 메서드 근거: 같은 라우터의 부작용 조작 2개(`/images/move`·`/images/restore`)가 **POST 동사 관례**(`routers/trash.py:61,69`)이고, §4.1 `DELETE /api/categories/{id}`는 **id 경로의 단건 리소스 삭제** 관례라 컬렉션 부작용에는 쓰지 않는다. `DELETE /api/trash/images`는 "이미지 삭제"로 오독 여지(휴지통 밖 `images/` 직속과 혼동) → 동사 경로 `empty`로 의도를 드러낸다. 본문 0(선택 없음 — 전체 비우기만 · 항목별 영구 삭제 없음 = 사용자 확정 ⓐ).
  - 응답 = `deleted`(실제 `os.remove` 성공 수) · `freed_bytes`(삭제 직전 `st_size` 합) · `skipped`(규약 B의 무접촉·실패 합산). 폴더 없음·비어 있음 = `{0,0,0}` 200(멱등). 에러 = §3 포맷 · 코드 신설 0 · 409 없음 · 422 없음(입력 0).
- **B. 삭제 구현 규약 — `trash_service.empty_trash()` 1함수 · `os.remove` 명시 1곳 · `.trash/` 직속 정규 이름 파일만 · best-effort** (결정 ②)
  - 대상 = `_trash_dir()` **직속** 항목 중 `IMAGE_FILENAME_RE.fullmatch(name)` **and** `is_file()`인 것만(호출 시점 폴더 실측 — 스캔 결과 stale 무관). 하위 폴더 · 비정규 이름(`.tmp` 등) · 심볼릭 링크(`is_symlink()` = skipped) = **무접촉 · `skipped` 집계**. 폴더 자체는 지우지 않는다(`rmdir`·`rmtree` 0 — 다음 이동의 lazy mkdir과 무충돌).
  - **경로 가드(R16)**: 각 대상 `p = (trash_dir / name).resolve()` → `p.is_relative_to(trash_dir.resolve())` 실패 = skipped(이론상 정규식 뒤엔 도달 불가 — 이중 방어 · `_guarded_pairs` 전례). 삭제 호출 = **`os.remove(str(p))` 명시**(`Path.unlink`도 패턴에 걸리지만 감사 가능성을 위해 한 이름으로 고정 · `shutil.rmtree` 0).
  - **best-effort**: 파일 1개 `OSError`(잠금 등)는 **그 파일만 `skipped` + `logger.warning`** 후 계속(되돌릴 수 없는 조작이라 all-or-nothing이 성립하지 않음 — 이미 지운 것은 복구 불가 · 남은 것은 다음 비우기로). 폴더 자체가 없으면 `{0,0,0}`.
  - **참조 재검사 0** — `.trash/` 파일은 서빙되지 않으므로 정의상 미참조(참조 중이면 `move` 단계 422로 막혀 휴지통에 못 들어감 · 되돌리기 후에만 재참조 가능). 삭제 전 스캔 강제 0.
  - **invariant 기준선 규약**: 구현 후 `fs-mutate` 신규 검출은 **`trash_service.py` 1곳(`os.remove`)만 정당분 → 기준선 2 → 3**(사용자 승인 후 `-UpdateBaseline` · stage-52 전례 = PR 머지로 갈음 가능 · 완료 기록에 명기). 다른 파일 신규 검출 = 결함. 규칙 문자열 `invariant-scan.ps1:62` 1줄 갱신 → "Rule 4 - filesystem removal/move calls (sources/ ingested originals immutable; sources/images/ moves and user-triggered .trash/ empty only inside trash_service)" — 패턴 무변.
  - 모듈 docstring `trash_service.py:7~8` "파일 삭제 코드 0" → "삭제 = `empty_trash` 1곳(`os.remove` · `.trash/` 직속 정규 파일만 · 사용자 명시 호출 전용)" 정정 · `routers/trash.py:5~6` docstring 동기.
- **C. `ConfirmDialog` 옵션 +1 = `footer?: ReactNode`(S50 봉인 해제 — 사용자 확정 ⓐ)** (결정 ③)
  - `message: string`은 **그대로**(4곳 문자열 · DocumentDetail `+` 연결 · `whitespace-pre-line` 무변 · 기존 호출처 diff 0). `footer`는 `message` 아래·`errorMessage` 위에 **자기 줄**로 렌더(버튼 열과 분리 — 취소/삭제 버튼과 시각·포커스 순서상 겹치지 않음 · 강한 의미 키 겹치기 0 · 폼 아님이라 Enter 기본 제출 0). 미지정 = 렌더 0(기존 호출처 전부 무변).
  - 4곳 사용 = `footer={<Link to="/trash?tab=…" onClick={onClose} className="text-xs text-accent underline">휴지통 열기</Link>}` — 클릭 = **`onClose()` 먼저 → `Link` 기본 내비**(삭제 실행 0 · 모달 상태 정리 후 이동). NoteEditPage는 편집 중 미저장이면 **기존 이탈 가드가 그대로 작동**(`dirtyRef` 우회 0 — 가드가 막으면 모달만 닫힌 상태로 남는 것이 맞음). 탭 = 문서 삭제 2곳 `?tab=documents` · 노트 삭제 2곳 `?tab=notes`. 링크는 **1회째부터 보이는 정적 텍스트 링크**(에디터 제스처 UX 기준 — 숨은 동작 0).
  - 문구 4곳: "휴지통(설정 › 데이터)에서 복원할 수 있습니다" → **"휴지통에서 복원할 수 있습니다"**(경로 괄호 제거 — 링크가 경로를 대신 · 나머지 문구 무변).
- **D. 삭제 완료 알림 링크 — 가능한 화면 2곳만(공용 toast 신설 0)** (결정 ④)
  - **Explore 일괄 삭제**: `BulkSelectionBar` `resultSummary` 타입 `string | null` → **`ReactNode`**(문자열 호환 · 렌더 2곳 `:39,74` 무변). Explore는 **`action === 'delete'` 성공 시만** `<>{요약} · <Link to="/trash?tab=documents">휴지통 열기</Link></>` 조합(연결·이동·해제 요약은 문자열 그대로). 소멸 규칙 = 현행(다음 조작 시).
  - **NoteListPage 삭제**: 로컬 상태 `notice: ReactNode | null` 1개 신설 → 삭제 성공 시 "노트를 휴지통으로 옮겼습니다 · [휴지통 열기](`/trash?tab=notes`)" 1줄(`actionError` 옆 · `text-muted` · 새 노트·복제·다른 삭제·검색 변경 시 `null`).
  - **DocumentDetail · NoteEditPage**: 삭제 후 라우팅(`/explore`·`/notes`)이라 **알림 0 — 모달 링크가 주 경로**(도착 화면에 알림 주입 0 · YAGNI).
- **E. `/trash?tab=` = 초기 탭만 수용(URL 동기화 0)** (결정 ⑤)
  - `Trash.tsx` `useState<TrashTab>(initialTabFromSearch)` — `useSearchParams` **마운트 1회** 읽기 · 허용 값 `documents|notes|images` · 그 외·없음 = `documents`. **탭 클릭은 URL을 바꾸지 않는다**(stage-52 규약 G "로컬 상태" 유지 · 뒤로가기 히스토리 오염 0 · `?tab=`은 진입 링크 전용). 설정 카드 `Link to="/trash"` 무변(= documents).
- **F. 내비 항목 ⓒ = `TRASH_NAV_ITEM` 상수 1개 · 사이드바·드로어 "하단 그룹 첫 항목" · 하단 탭바 5 불변** (결정 ⑥)
  - `Layout.tsx` `const TRASH_NAV_ITEM: NavItem = { to: '/trash', label: '휴지통', icon: '🗑️' }`(단일 출처 · 리터럴 복제 0). **사이드바** 하단 그룹(`mt-auto:165`) = **휴지통 → 설정 → LLM 작업 → 도움말**(라우트 2 → 패널 → 외부 링크 순 · 유지보수 계열 인접) · 접힘 레일 = 아이콘+title(`NavButton collapsed` 관례). **드로어** 하단 그룹(`:268`) = **휴지통 → LLM 작업 → 도움말**(설정 미포함 현행 유지 — 헤더 ⚙️). 상단 그룹 9항목(`NAV_ITEMS`·`DESKTOP_EXTRA_ITEMS`·`NOTES_NAV_ITEM`) **무접촉** · 하단 탭바 `NAV_ITEMS` 5 **무변**. 항목 수 = 사이드바 9+4 = 13 · 드로어 9+3 = 12(주석 `:237~240` 갱신). 드로어 탭 = 이동 + 닫힘(현행 `onClick` 관례). 근거: 휴지통은 저빈도 유지보수 표면(stage-52 G 판정 유지)이라 **상단 콘텐츠 그룹이 아닌 하단 유틸 그룹**에 둔다 — 상시 노출은 사용자 확정 ⓒ.
- **G. 상단 진입 ⓑ = 텍스트 링크 2곳** (결정 ⑦)
  - **탐색** `Explore.tsx` 필터바 행(`:249`) **끝**에 `Link to="/trash?tab=documents"` "🗑️ 휴지통"(`text-xs text-muted hover:text-primary` · 우측 정렬 · 데스크톱은 `+ 새 문서` 버튼 왼쪽 · 모바일(버튼 숨김)은 행 끝 — 정렬 클래스는 구현 재량 · 새 문서 버튼 우측 정렬 유지 · 모바일 행 `:232~247` 무접촉).
  - **노트 목록** `NoteListPage.tsx` 헤더 우측(`:99~106` `[새 노트]` 왼쪽) `Link to="/trash?tab=notes"` "휴지통"(같은 클래스 · `[새 노트]` 강조 유지).
  - 색·간격 = 토큰 클래스만 · 아이콘은 내비와 같은 `🗑️` 1종.
- **H. `[휴지통 비우기]` 화면 계약(`TrashImagesTab`)** (결정 ⑧ — 화면 정본 = screens §5.17 S53)
  - 위치 = **휴지통 폴더 목록 제목 줄**(`<h2>:439` 우측 · `flex justify-between`) 버튼 1개 `[휴지통 비우기]` — `text-wrong` 테두리 버튼(파괴적 조작 — 이동 버튼 중립 색과 **대비**) · `trashed.length === 0` 또는 스캔 전(`report` 없음) = **비활성**(목록 자체가 `report &&` 안이라 스캔 후에만 보임 — 현행 구조 유지 · 스캔 강제 = 실수치 확보 수단).
  - 클릭 → `ConfirmDialog` **`danger`** · title "휴지통 비우기" · message = `` `파일 ${trashed.length}개 · 총 ${formatBytes(Σ bytes)}를 영구 삭제할까요?\n되돌릴 수 없습니다.` ``(실수치 = 마지막 스캔 `trashed` 기준 · 서버는 호출 시점 실측) · confirmLabel **"영구 삭제"** · `submitting` · `errorMessage`(§3 `message` 그대로).
  - 성공 → `summary` = "영구 삭제 n · 건너뜀 n · 확보 {formatBytes(freed_bytes)}" + **재스캔 자동 1회**(`query.refetch()` — 이동 관례 `:324`) · `selected` 무접촉 · 모달 닫힘. 실패 → `actionError`.
  - 상단 안내 2줄(`:344`) 갱신: "앱은 이미지를 **자동으로** 지우지 않습니다. 고아 이미지를 휴지통 폴더로 옮겨 두면, 최종 삭제는 아래 **[휴지통 비우기]**(되돌릴 수 없음)나 탐색기에서 폴더를 비우는 것으로 합니다" + `trash_dir` 경로 줄 무변.
  - 훅 `api/trash.ts` `useEmptyImageTrash()` — `api.post<TrashEmptyResult>('/trash/images/empty')`(본문 없음) · `onSuccess` `removeQueries(trashKeys.images)`(관례) · 폴백 문구 `'휴지통을 비우지 못했습니다.'` mutationFn 1곳 · 타입 `TrashEmptyResult { deleted; freed_bytes; skipped }` = `api/types.ts`.
- **I. 테스트 = `backend/tests/test_trash.py` 케이스 ⑧ 추가(편성 필수 — 파일 삭제 코드의 범위 회귀 방지)** (결정 ⑨) — 기존 `dirs` 픽스처 재사용(실 `sources/` 무접촉 — 실 폴더를 건드리면 결함). 케이스 = V-1.
- **J. 불변 규칙 4 재개정 문안(편성 시 이행 — 문서 2곳 동기 · stage-52 전례)** (결정 ⑩)
  - `study-app.plan.md` §6.3 4: "… **자동 삭제 0 · 최종 삭제 = 사용자 수동**(탐색기에서 폴더 비움 **또는 앱 [휴지통 비우기] — 사용자 명시 클릭·확인 모달 한정 · `.trash/` 직속 파일만 · 코드 = `trash_service.py` 1곳 `os.remove` — stage-53 재개정 2026-09-27 · D8 재론**). 반입 원본(`sources/images/` 밖)은 종전대로 불변 · 그 외 삭제 호출 0."
  - `CLAUDE.md` 67행: "… 앱은 고아 식별 + `.trash/` 이동·되돌리기 + **사용자 명시 [휴지통 비우기]**만(자동 삭제 0 — stage-52·53)."
  - 마스터 §15 **R43 완화 열 추기**(감시 유지 · 종결 아님) · 별지 §10 **D8 재론 추기** · 마스터 머리 **Draft v0.61**.
- **K. 매뉴얼** (결정 ⑪) — `docs/manual/user-manual.html` 462행 "원본" 불릿 "지우는 건 사용자입니다" → "지우는 건 사용자입니다(탐색기 또는 휴지통의 [휴지통 비우기])" · 463행 "설정 › 데이터 › 휴지통에서" → "휴지통(메뉴 · 삭제 확인창의 링크)에서" · 1963~1966 "휴지통" 단락 = 진입 경로 3(메뉴 항목 · 탐색/노트 상단 · 삭제 확인창 링크) + "[휴지통 비우기] = 폴더 안 파일 전부 영구 삭제 · 되돌릴 수 없음 · 자동으로는 지우지 않음" 1~2문장. 완료 시 반영(D-3).

## 3. 체크리스트

**B. 백엔드 (`backend/`)**
- [x] B-1 `services/trash_service.py` — `empty_trash() -> dict` 신설(규약 B: 직속·`IMAGE_FILENAME_RE.fullmatch`·`is_file()`·`is_symlink()` 제외 → `resolve()`+`is_relative_to(trash_dir.resolve())` → `st_size` 합산 → `os.remove(str(p))` · `OSError` = skipped + `logging` warning · 폴더 없음 `{0,0,0}` · `rmdir` 0) · `import os`·`logging` · 모듈 docstring 정정(규약 B 끝).
- [x] B-2 `schemas/trash.py` — `TrashEmptyResult(deleted: int, freed_bytes: int, skipped: int)`.
- [x] B-3 `routers/trash.py` — `@router.post("/images/empty", response_model=TrashEmptyResult)`(본문 없음 · `db` 의존 0) · docstring `:5~6` 정정. `main.py` diff 0.
- [x] B-4 기존 엔드포인트 7 diff 0 확인 · 에러 §3(코드 신설 0 · 422/409 없음 · 파일 시스템 치명 실패만 500 공통 핸들러).

**F. 프론트 (`frontend/src/`)**
- [x] F-1 `components/ConfirmDialog.tsx` — `footer?: ReactNode` 1옵션(규약 C · `message` 아래 자기 줄 · 미지정 렌더 0 · 기존 호출처 diff 0).
- [x] F-2 삭제 확인 4곳 — `NoteEditPage.tsx:699~709` · `NoteListPage.tsx:207~217`(`?tab=notes`) · `DocumentDetail.tsx:526~544` · `Explore.tsx:556~575`(`?tab=documents`) 에 `footer` 링크(`onClick={onClose}` 선행 · `Link`) + 문구 "휴지통(설정 › 데이터)에서" → "휴지통에서"(규약 C).
- [x] F-3 알림 링크 2곳(규약 D) — `BulkSelectionBar.tsx:11` `resultSummary: ReactNode` + `Explore.tsx:571` delete 성공 시만 링크 조합 · `NoteListPage.tsx` `notice` 상태 1개 + 삭제 성공 1줄(다른 조작 시 `null`).
- [x] F-4 `pages/Trash.tsx` — `useSearchParams` 초기 탭(규약 E · 허용 값 외 = documents · URL 동기화 0) · `TrashImagesTab` `[휴지통 비우기]` 버튼(제목 줄 우측 · `text-wrong` 테두리 · `trashed.length===0` 비활성) + `ConfirmDialog danger` 실수치·"되돌릴 수 없습니다"·"영구 삭제" + 성공 요약 + 재스캔 1회 + 안내 문구 갱신(규약 H) · 헤더 주석 `:1~4` 정정(진입점 4 · `?tab=`).
- [x] F-5 `api/trash.ts` `useEmptyImageTrash()` + `api/types.ts` `TrashEmptyResult`(규약 H · 폴백 1곳 · `removeQueries`).
- [x] F-6 `components/Layout.tsx` — `TRASH_NAV_ITEM` 상수 + 사이드바 하단 그룹 첫 항목(`:165` 설정 위 · collapsed 레일 아이콘) + 드로어 하단 그룹 첫 항목(`:268` LLM 작업 위) · 주석 갱신(13/12) · `NAV_ITEMS`·상단 그룹·하단 탭바 무접촉(규약 F).
- [x] F-7 상단 진입 2곳(규약 G) — `Explore.tsx:249` 필터바 행 끝 `🗑️ 휴지통`(`?tab=documents`) · `NoteListPage.tsx:99` 헤더 `[새 노트]` 왼쪽 `휴지통`(`?tab=notes`).
- [x] F-8 색·간격 = 토큰·기존 유틸만(불변 규칙 5 — 새 색 0 · `tokens.css` 무변, `invariant-scan.ps1` PASS) · 390px 버튼 wrap·겹침 0(클래스 기준 판단 — text-xs 링크·flex-wrap 행) · 엔트리 청크 실측: 커밋된 이전 빌드(`index-DOkq4k6_.js`) 1,521,788 B → 이번 빌드(`index-CW3CGBqc.js`) 1,522,408 B, Δ **+620 B**(지시서 기준선 1,583,878 B는 이 저장소의 실측과 불일치 — 실측 기준은 직전 커밋 dist로 대체 기록, 하단 보고 참고) · 빌드 산출물은 커밋 0(로컬 재빌드 후 `git checkout -- frontend/dist && git clean -fd frontend/dist`로 원복).

**V. 검증 (서버 구동 금지 — `2_StartServer.bat` 주인은 사용자 · 브라우저 실측은 사용자가 띄운 `localhost:8000`만 · 실 `sources/images/.trash/` 실측은 사용자 승인 하에 실측용 파일만)**
- [x] V-1 `backend/tests/test_trash.py` 케이스 ⑧(`dirs` 픽스처 · 실 `sources/` 무접촉) — ⓐ `.trash/` 정규 파일 3건(크기 합 S) → `POST /images/empty` 200 `deleted=3 · freed_bytes=S · skipped=0` · 폴더는 남고 비어 있음 · `images/` 직속 파일 무접촉 ⓑ 폴더 없음 → 200 `{0,0,0}` · 폴더 생성 0 ⓒ `.trash/` 안 비정규 이름 파일(`note.txt`)·하위 폴더(`sub/`)·정규 파일 1 → `deleted=1 · skipped=2` · 비정규·하위 폴더 잔존 ⓓ 비운 뒤 같은 이름 `restore` → `skipped`(멱등 · 404 아님) ⓔ `GET /images/empty` **404**(app-wide SPA catch-all 관례 — 405 아님, 실측 확정 · 지시서는 405을 언급했으나 다른 POST 전용 엔드포인트와 동일 관례라 그대로 반영) · 본문 동봉해도 200(무시) ⓕ `sources/` 밖 파일·`images/` 직속 파일은 어떤 케이스에서도 무접촉(ⓐ·ⓒ 안에서 단언). `run-tests.ps1 -Path tests/test_trash.py` 20 → 25건 통과 → `-Full` 684건 무회귀.
- [x] V-2 `invariant-scan.ps1` — `fs-mutate` 신규 검출 = **`trash_service.py` 1곳(`os.remove`)만** 확인 → `-UpdateBaseline`(2 → 3, `git diff`로 그 1줄만 변경 확인) · 규칙 문자열 1줄 갱신 · `physical-delete` 신규 0 · 재실행 PASS. 프론트 `npm run build`는 이 백엔드 작업 범위 밖(별도 프론트 작업분).
- [ ] V-3 브라우저 실측(사용자 기동 서버 · 노트 무접촉 원칙 — 실측용 문서·노트·이미지는 새로 만들어 원상 복구): ⓐ 사이드바 하단 그룹 "휴지통"(설정 위) · 접힘 레일 아이콘 · 390px 드로어 하단 그룹 "휴지통"(LLM 작업 위) · 탭 후 닫힘 · **하단 탭바 5 무변** ⓑ 탐색 필터바 끝 "🗑️ 휴지통" → `/trash?tab=documents` 문서 탭 초기 · 노트 목록 헤더 "휴지통" → 노트 탭 초기 · `?tab=xyz` = 문서 탭 · 탭 클릭 시 URL 무변 ⓒ 삭제 확인 4곳 링크 "휴지통 열기" 노출 → 클릭 = 삭제 0 · 모달 닫힘 · 해당 탭 진입(NoteEditPage 미저장 상태는 기존 이탈 가드 작동) ⓓ 탐색 일괄 삭제 → 요약 줄에 링크 · 노트 목록 삭제 → 1줄 알림 링크 ⓔ 이미지 탭: 스캔 → 실측용 고아 1건 이동 → 휴지통 목록 제목 줄 `[휴지통 비우기]` 활성 → 확인창 실수치(파일 1개 · 크기)·"되돌릴 수 없습니다"·"영구 삭제" 붉은 버튼 → 실행 → 요약 "영구 삭제 1 · 건너뜀 0 · 확보 …" · 재스캔 후 "휴지통 폴더가 비어 있습니다" · 탐색기에서 파일 부재 확인 · `.trash/` 폴더 잔존 ⓕ 휴지통 0건 = 버튼 비활성 · 설정 › 데이터 카드 그대로 ⓖ 390px 겹침 0 · 콘솔 에러 0.

**D. 문서**
- [ ] D-1 설계 — api §4.32 `[S53]` 행·⑦ 블록(편성 시 v1.67 선반영 · 완료 시 "구현 실측 확정" 표기 + 색인 v1.68) · screens §5.17 S53·§5.2·§5.16·§5 도입부 1줄(동일).
- [ ] D-2 별지 §13 FB-26·FB-27 행 `← 완료(stage-53 · 날짜)` · §10 D8 재론 행 `← 완료` · backlog §1 두 행 → §4 종결 이동 · `backlog-scan.ps1` PASS · 마스터 §15 R43 감시 유지 · §5 F61 행 1구는 편성 시 추기 완료.
- [ ] D-3 매뉴얼 3곳(규약 K) · CHANGELOG 항목(§6 두 갈래) · stage-index 53행 · 이 문서 §7 완료 기록 · `CLAUDE.md` 버전 줄(발행 시 — 규칙 4 줄은 편성 시 개정 완료).

## 4. 이 단계에서 하지 않는 것 (불변 규칙 9 — 이 절이 우선)

- **항목별 영구 삭제 0**(휴지통 목록 행 `[영구 삭제]` · 선택 삭제 · 본문 있는 empty) — 사용자 확정 ⓐ "전체 비우기 버튼만". 실수요 시 별도 FB.
- **자동·주기·용량 상한·보존 기간 삭제 0**(기동 시·스캔 시·이동 직후 자동 비우기 없음 · settings 키 0) — D8 원칙 "앱 자동 삭제 0" 유지 · 삭제 트리거 = 사용자 명시 클릭 + 확인 모달뿐.
- **문서·노트 물리 삭제 0 · 휴지통 "완전 삭제"·"비우기" 0**(불변 규칙 3 — 문서·노트 탭에는 비우기 버튼 없음) · 일괄 복원 0(stage-52 §4 유지) · `deleted_at` 0.
- **`sources/` 반입 원본 접촉 0 · `sources/images/` 직속(휴지통 밖) 삭제 0 · `.trash/` 하위 폴더·비정규 파일 접촉 0 · `.trash/` 폴더 자체 삭제 0**(`rmdir`·`rmtree` 0).
- **하단 탭바 변경 0**(`NAV_ITEMS` 5 불변 · F39) · 상단 내비 그룹 9 무접촉 · 설정 데이터 카드 무변(진입점 병존) · 드로어에 설정 항목 추가 0.
- **공용 toast/알림 시스템 신설 0** — 알림 링크는 기존 1줄 알림 관례 2곳만 · DocumentDetail·NoteEditPage 도착 화면 알림 0.
- **`?tab=` URL 동기화 0**(초기값만) · 휴지통 페이지네이션·정렬·검색 추가 0 · 스캔 자동화 0(`[휴지통 비우기]` 전 스캔 강제는 현행 구조의 결과일 뿐 신규 규약 아님).
- **`ConfirmDialog` 다른 옵션 확장 0**(`footer` 1개만 · `message` 타입 무변 · 버튼 추가 0) · `LinkDocumentModal`·`DeleteCategoryModal` 무접촉.
- DDL 0 · Alembic 0 · 신규 의존 0 · `GET /images/` 서빙 규약 변경 0 · `POST /api/uploads` 무변 · 백업(F27) 무변(비운 뒤 백업엔 당연히 미포함 — 코드 0) · FB-24 ⓒ 0.

## 5. DoD (완료 정의)

**자동 검증(에이전트 수행):**
1. `run-tests.ps1 -Path tests/test_trash.py` 통과(V-1 ⓐ~ⓕ) + `-Full` 무회귀 · `invariant-scan.ps1` PASS(fs-mutate 기준선 갱신은 `trash_service.py` 2 → 3만 · 승인 기록 · 규칙 문자열 갱신).
2. `npm run build` 성공 · 백엔드 diff = `services/trash_service.py`·`routers/trash.py`·`schemas/trash.py`·`tests/test_trash.py` **4파일 안** · `main.py` 0 · Alembic 0 · 신규 의존 0 · 기존 엔드포인트 7 응답 diff 0.
3. 프론트 diff = `pages/Trash.tsx`·`api/trash.ts`·`api/types.ts`·`components/ConfirmDialog.tsx`·`components/BulkSelectionBar.tsx`·`components/Layout.tsx`·`pages/Explore.tsx`·`pages/DocumentDetail.tsx`·`editor2/pages/NoteListPage.tsx`·`editor2/pages/NoteEditPage.tsx` **10파일 안** · `App.tsx`·`Settings.tsx` 무접촉 · 새 색 리터럴 0 · 엔트리 청크 Δ 기록.
4. 브라우저 V-3 ⓐ~ⓖ 전건 통과(실측 데이터 원상 · 실 `.trash/` 실측은 실측용 파일만).
5. 문서 묶음 D 전건(Design v1.68 · 별지 FB-26·FB-27·D8 `← 완료` · backlog 종결 이동 · 매뉴얼 3곳 · CHANGELOG · stage-index · 규칙 4 줄은 편성 시 개정 완료).

**사용자 확인(게이트 본체):**
6. **실사용** — ⓐ 휴지통 진입이 "복잡하다"는 체감 해소(메뉴 항목 · 탐색/노트 상단 · 삭제 확인창 링크 중 실제로 쓰게 되는 경로 회신 — 남는 경로 정리는 후속 FB) ⓑ `[휴지통 비우기]` 확인창의 실수치·경고가 충분히 "되돌릴 수 없음"을 알림(오조작 0) · 비운 뒤 앱 이상 0 ⓒ 폰 실기기 드로어 "휴지통" 탭·390px 겹침 0 · **치명 결함 0 회신** = 발행 게이트.

**게이트**: 1~5 전건 + 6 치명 0 → 발행(§6 ① 두 갈래). 치명 발견 시 발행 보류·수정 선행. **착수 게이트**: 없음(사용자 확정 대기 0).

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` — **두 갈래(완료 시점 판정)**: ⓐ stage-52 v2.03.1 **발행 후** 완료 → **v2.03.2 항목 1개**(사소 · 규약 ② PP+1) ⓑ **발행 전** 완료 → v2.03.1 항목에 **stage-53 불릿 합류**(stage-51 §6 ① ⓑ 전례 · "사소 stage가 핵심에 합류 · 번호 재부여 없음" · 발행 게이트 줄에 stage-53 DoD 6 병기). 불릿 = `[휴지통 비우기]`(사용자 명시 · 확인 모달 · 되돌릴 수 없음 · 자동 삭제 0 유지) · 신규 API 1 · 진입점 4(메뉴 · 탐색/노트 상단 · 삭제 확인창 링크 · 설정 카드) · 불변 규칙 4 재개정 · DDL 0.
2. 루트 `VERSION` — ⓐ면 2.03.2 · ⓑ면 2.03.1(한 번) — 사용자 회신(DoD 6) 후.
3. `stage-index.md` 53행 갱신(완료·일자·산출 버전).
4. `backlog.md` — §1 `FB-26`·`FB-27` 행을 §4로 **종결 이동**(`종결(stage-53 · 날짜)`) · §3 R43 행 비고 갱신(기준선 3곳) · 기준일 줄 갱신 · `scripts/backlog-scan.ps1` PASS 확인.
5. 출처 추기 — 별지 §13 FB-26·FB-27 행 끝 `← 완료(stage-53 · 날짜)` · §10 D8 행 재론 구 뒤 `← 완료(stage-53)` · 마스터 §15 R43 완화 열(편성 시 추기분에 실측 결과 1구) · §5 F61 행(편성 시 1구 추기 완료 — 무변).
6. 설계 — api §4.32 `[S53]` 행·⑦ 블록 "구현 실측 확정" 표기 · screens §5.17 S53·§5.2·§5.16·§5 도입부 · 색인 상태 줄 **v1.68**(최근 3건 규칙으로 밀리는 v1.64는 `docs/04-archive/design-changelog.md` 맨 위로 이동만).
7. 매뉴얼 3곳(규약 K) · `CLAUDE.md` 머리 버전 줄 1곳(발행 시 · 규칙 4 줄은 편성 시 개정 완료) · git tag(발행 버전 · release PR 별도 — stage-47 전례 · ⓑ 합류면 tag는 v2.03.1 1개).

## 7. 완료 기록 (구현·검증·문서 경위 정본 — 착수 후 추기)

- **편성**(2026-09-27): 지시서 확정 — 사용자 확정 4항(묶음 · 사소 · FB-26 ⓐ · FB-27 ⓐ+ⓑ+ⓒ) + 위임 판정 규약 A~K(`POST /api/trash/images/empty` · `os.remove` 1곳 best-effort · `ConfirmDialog footer` · `?tab=` 초기값만 · `TRASH_NAV_ITEM` 하단 그룹 첫 항목 · 알림 링크 2곳 · 기준선 2→3) · **사용자 확정 대기 0** · api §4.32 `[S53]` 행 + ⑦ 블록 · screens §5.17 S53 + §5.2·§5.16·§5 도입부 1줄(Design v1.67) · stage-index 53행 · backlog `편성 = stage-53` 2행 + 기준일 · 별지 §10 D8 재론 추기 + §13 FB-26·FB-27 편성 추기 · 마스터 §15 R43 완화 열 추기 + §5 F61 1구 + **§6.3 불변 규칙 4 재개정** + `CLAUDE.md:67` 동기(Draft v0.61) · stage-52 §4 해제 추기 3구.
