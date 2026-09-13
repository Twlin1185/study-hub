# Stage 51 — 탐색 문서 다중 선택 + 일괄 도구 (FB-25) (v2.0.x · 핵심)

> 상태: **구현·검토·실측 완료(2026-09-13) — DoD 1~5 충족(V-3 브라우저 ⓐ~ⓘ 전건 통과) · 6(사용자 실사용 확인) 회신 대기 = 발행 게이트(stage-48·49·50 v2.01.3와 **v2.02.1 한 발행 단위** — §6 ① ⓑ 합류 확정)**(편성 2026-09-13 · 규약 H = ⓐ 상시 노출 — 미회신 기본안 채택).
> **버전 영향: 핵심**(사용자 확정 2026-09-13 — 등록부·별지 §13 판정 그대로). 근거 병기(CHANGELOG 규약 ③): **새 UI 표면**(탐색 그리드
> 다중 선택 + 선택 툴바 — 종전 0) + **신규 API 1개**(`POST /api/documents/bulk` — 저장 계약 추가) + 탐색에서 문서 소프트 삭제가
> 처음 열림(종전 = 문서 상세에서만). 선례 = stage-48(엔드포인트 +1이어도 기존 표면 안의 버튼 1개라 사소)와 달리 표면 자체가 새로 생긴다.
> → 산출 버전 **v2.02.1 예정**(규약 ② 핵심 = MM+1·PP=1 · 현재 v2.01.2 발행 · v2.01.3 = stage-48·49·50 발행 대기). 48·49·50 미발행
> 상태로 이 stage가 끝나면 §6 ①에서 기계적으로 판정(stage-50 §6 ① 선례). **마스터 §14 로드맵 M37 행 추가**(핵심 stage) · **F60 색인 행 부여**.
> 생성 경위: `backlog.md` §1 `FB-25`(별지 §13 FB-25 · 2026-09-13 사용자 피드백 "문서 삭제, 변경, 카테고리 변경 등을 자유롭게"의 본체)
> — FB-24(stage-50 · 2026-09-13 완료)로 "FB-24 선행" 조건 충족. 사용자 확정 2026-09-13 = **FB-25 단독 편성 · 번호 51 · 핵심**. D8-구현
> (휴지통)·태그/타입 일괄 편집은 동승하지 않는다(§4).
> 정본 포인터: API 계약 = api §4.2 표 `[S51]` 포인터 행 + **`### 4.31 [S51]` 절**(본문·검사 순서·부수 테이블·응답·에러 표 — 편성 추기
> **Design v1.63**) · 화면 계약 = screens §5.2 S51 불릿(탐색 다중 선택·툴바) · §5.3 S51 불릿(문서 상세 [이동]) · 에러 포맷 = 설계 §3(코드
> 4종 불증) · 불변 규칙 1(응답에 정답 0)·2(attempts 무접촉)·3(삭제 = `is_active=0` · 분류 빼기 = 연결 해제)·5(토큰만)·8 · 발행 절차 =
> CHANGELOG 머리 규약 ⑤.

## 1. 범위 (백엔드 1 엔드포인트 신설 + 프론트 선택 모델·툴바 + 문서 상세 [이동] 1개 — 코드 실측 2026-09-13)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **FB-25 서버**(backlog §1 17행 · 별지 §13 506행) | 신규 API | 문서 n건 × 동작 1개(연결 · 이동 · 해제 · 소프트 삭제)를 **한 트랜잭션**으로 처리하는 배치 엔드포인트 1개 | `backend/routers/documents.py` 등록 순서 = `GET ""`:32 · `GET /batch`:60(인쇄용 다건 **조회** — `document_service.get_documents_batch:643~654` · 비활성 건너뜀) · `POST /resolve-embeds`:83 · `POST ""`:93 · `GET /{document_id}`:101 · `DELETE /{document_id}`:114(→ `soft_delete_document:421~424` = `is_active=0`만 · 링크 무접촉) · `POST /{document_id}/links`:127(→ `add_link:688~722` upsert · `linked_by`는 모델 기본 `'manual'`(`models.py:105`) · 태그 규칙 스캔 0) · `DELETE /{document_id}/links/{category_id}`:136(→ `remove_link:725~736` 링크 행만 삭제 · `study_progress`·`resume_points`·`attempts` 무접촉 — grep 0건). 일괄 변경 API 0. 스키마 `schemas/document.py` `LinkCreate:193~196`. 하위 트리 수집 = `_collect_descendant_ids:175~186`(BFS · `list_documents` `deep`이 사용). 부수 테이블(`models.py`): `study_progress:247~259` PK `(category_id, document_id)` · `resume_points:262~273` PK `category_id`(`document_id` NULL 허용) · `attempts.category_id:120` NULL 허용 · `suggestions:227~243` UNIQUE(doc, category) — 분류 행이 남는 문서 단위 작업에서는 **FK 위반 경로 없음**(S50과 다름). 트리 진도 `category_service.subtree_progress:50~88`은 `category_documents` 경유 조인이라 잔존 `study_progress` 행은 진도에 영향 0 · `stats_service:247~288` heatmap은 `study_progress.completed_at` 집계(행 삭제 = 기록 소실) |
| **FB-25 프론트**(같은 행) | 새 UI 표면 | 탐색 문서 그리드 **다중 선택(체크박스 · Shift 범위 · 현재 목록 전체 선택) + 선택 툴바**(연결 추가 · 분류 이동 · 연결 해제 · 삭제) | `frontend/src/pages/Explore.tsx`(424줄) — 선택 상태 0 · 목록 = `useDocuments({… page:1, size:100}):68~77`(**페이지네이션 UI 없음 · 최대 100건 고정**) · 그리드 `:242~250` `DocCard` map · 모달 상태 `ModalState:25~31` + `modal.kind` 분기 `:254~379` · 필터 상태 `:42~47`(`selectedCategoryId`·`deep`·`typeFilter`·`tagFilter`·`orphanOnly`·`bookmarkedOnly`) · 분류 삭제 시 선택 초기화 `:332~340`. `components/DocCard.tsx:19~89` — `draggable`(단건 드래그 = 연결 추가) · 제목 클릭 = 상세 이동 `:35` · ⋯ 메뉴 "분류에 연결" `:59~68` · props `{doc, onRequestLink}`. 분류 피커 = `components/LinkDocumentModal.tsx:14~77`(`flattenCategories` select + 메모 입력 · 제목 "분류에 연결" 고정) · 확인 = `components/ConfirmDialog.tsx`(message 1개). 뮤테이션 `api/documents.ts` `useLinkDocument:148~159`·`useUnlinkDocument:161~172`·`useDeleteDocument:117~126`(전부 `documentKeys.all` + `categoryKeys.tree` invalidate) · 키 `documentKeys:14~18`(`all` 접두가 detail도 덮음) |
| **문서 상세 "분류 이동" 흡수**(별지 §13 FB-25 "해제+연결 2동작") | 소규모 | 사용처 행에 [이동] 1동작 추가 — 같은 배치 API를 ids 1건으로 호출 | `frontend/src/pages/DocumentDetail.tsx` 사용처 `:350~369` `UsageRow:606~662`(`onSaveNote`·`onUnlink` · [연결 해제] 버튼 `:653~659`) · 문서 삭제 `deleteDocument.mutate:526~528`(상세에서만 가능 — 탐색에는 삭제 경로 0) |

**DDL 0(계획서 §6.2 무변 · Alembic 불필요 · §15 R 행 추가 없음) · 신규 엔드포인트 1(`POST /api/documents/bulk`) · 기존 엔드포인트
무변(단건 links/delete/batch 4개 계약 그대로) · settings 키 0 · 새 라우트 0 · 신규 의존 0 · `sources/` 무접촉 · 문서 본문·태그·북마크
무접촉 · SM-2·오답노트·`attempts` 무접촉(불변 규칙 2 밖) · 응답에 정답·해설 0(불변 규칙 1 — 카운터만).**

## 2. 확정 규약 (착수 전 결정 — 위임 판정 · 이 문서가 정본 · 사용자 확정 대기 1(기본안 있음 — 편성 보류 아님))

- **A. 엔드포인트 = `POST /api/documents/bulk` 1개 · 동작은 본문 `action`** (결정 ①)
  - 이름 근거: 등록부 권고안 `batch-links`는 `delete`(링크 작업 아님)를 담지 못하고, 기존 `GET /api/documents/batch`(조회)와 어근이 같아
    혼동된다 → **`bulk`**(변경 전용 · 조회 `batch`와 구분). 액션별 엔드포인트 4개 분할은 기각(검사·트랜잭션·응답 골격이 같아 1개가 DRY ·
    별지 FB-25 "엔드포인트 1개" 그대로).
  - 등록 위치: `routers/documents.py` `POST /resolve-embeds`(83) 뒤 · `POST ""`(93) 앞 — **`/{document_id}` 경로보다 앞**(FastAPI 매칭 순서 ·
    `GET /batch` 전례). 라우트 함수 = 얇게(파싱 → 서비스 → 응답) · 로직은 `services/document_service.py` `bulk_documents(db, payload)` 1함수
    (+ 액션별 내부 함수 4개).
  - 본문 `DocumentBulkRequest`(`schemas/document.py` 추가):
    ```
    { "action": "link" | "unlink" | "move" | "delete",
      "document_ids": [int, …],        // 1 ≤ len ≤ 200 · 중복은 서버가 제거(요청 순서 무관)
      "category_id": int | null,       // link = 연결 대상 · unlink/move = 출발(from) · delete = 무시
      "to_category_id": int | null,    // move 전용(도착)
      "deep": bool = false }           // unlink/move 전용 — from의 하위 트리 링크까지 대상(탐색 "하위 포함" 토글과 동치) · 그 외 무시
    ```
  - 상한 200 근거: `GET /api/documents` `size le=200`(라우터 `:42`)과 동일 · 탐색 목록은 100 고정이라 "현재 목록 전체 선택"이 항상 상한 안.
- **B. 검사 순서 → 실행 → `commit` 1회(전체 롤백 — 부분 성공 0)** (결정 ②)
  1. pydantic 422 `VALIDATION_ERROR`: `action` 외 값 · `document_ids` 빈 배열/200 초과 · action별 필수 필드 누락(`link`·`unlink` = `category_id` · `move` = `category_id`+`to_category_id`) — `model_validator`로 한 곳.
  2. **404** `NOT_FOUND` 문서: 존재하지 않는 id가 하나라도 있으면 전체 거부(`detail={"missing_ids": […]}`) — 조용히 건너뛰지 않는다(`GET /batch`의 "건너뜀"은 조회 관례 · 변경은 all-or-nothing).
  3. **404** 분류: `category_id`·`to_category_id` 미존재(`detail={"category_id": n}`).
  4. **422** 의미: `move`에서 `category_id == to_category_id`("출발과 도착 분류가 같습니다") · `link`/`unlink`/`move`에 **비활성 문서**(`is_active=0`) 포함(`detail={"inactive_ids": […]}` — 탐색 목록은 활성만 보이므로 정상 경로에서 발생 0 · stale 방어). `delete`는 비활성 포함 허용(멱등 — `skipped`).
  5. 실행(C~F) → `commit` 1회. 어느 단계든 예외 = 롤백(불변 규칙 2 관례 · S50 동일).
  - 409는 없다(충돌 조건 없음 — 중복 연결·무연결은 `skipped` 카운터로 흡수).
- **C. `link` = 연결 추가(문서당 1행 · 기존 행 무접촉)** (결정 ③)
  - `(category_id, doc)` 행 없으면 생성 — `sort_order=0` · `local_note=NULL` · `linked_by='manual'`(모델 기본 `models.py:105` — 단건 `add_link`와 동일 · 새 값 0) · `linked_rule_id=NULL` → `linked`+1. 이미 있으면 **무접촉** `skipped`+1(단건 upsert는 "보낸 필드만 갱신"인데 배치는 갱신 필드를 받지 않으므로 동치). `local_note`는 배치에서 받지 않는다(n건에 같은 메모는 무의미 — YAGNI · 단건 경로 그대로).
  - 태그 규칙 스캔 0 · `suggestions` 무접촉(단건 `add_link:688~722`와 동일).
- **D. `unlink` = 출발 분류(+deep 하위 트리)의 링크 행만 삭제** (결정 ④)
  - 대상 집합 = `category_documents` where `document_id ∈ ids AND category_id ∈ (deep ? _collect_descendant_ids(from) : {from})`. 삭제 행 수 = `unlinked` · 대상 행이 0인 문서 = `skipped`+1(404 아님 — 멱등 · 200).
  - **부수 테이블 무접촉**(`study_progress`·`resume_points`·`attempts`·`suggestions`) — 근거: ⓐ 단건 `remove_link:725~736`와 동일 동작(파리티 · 회귀 0) ⓑ 분류 행이 존속하므로 FK 위반 경로 0(S50 E와 상황이 다름) ⓒ 잔존 `study_progress`는 트리 진도(`subtree_progress` — 링크 경유 조인)에 영향 0이고 heatmap(`stats_service` `completed_at`)의 학습 기록을 보존한다(삭제하면 기록 소실). 문서는 잔존 → 다른 연결 없으면 탐색 "단일 문서"(불변 규칙 3 · 문서 행 무접촉).
- **E. `move` = 출발(+deep)의 링크를 도착으로 이관 — 문서당 1행 · 필드 보존 · 새 연결 생성 없음** (결정 ⑤)
  - "이동"은 **기존 연결의 재배치**다(다대다 원칙 §5.2 "드래그 = 연결 추가 · 이동 아님"과 무충돌 — 연결 추가는 C · 이동은 사용자가 출발 분류를 명시한 별개 동작 · 다른 분류의 연결은 그대로). 출발 집합에 링크가 없는 문서는 **새로 연결하지 않고** `skipped`+1(예: "하위 포함" 미체크 상태에서 하위 노드에만 걸린 문서).
  - 대상 행 = D와 같은 집합 **− {도착 분류}**(**← 실측 확정 ⓐ 2026-09-13 · Opus 검토 중요-1**: `deep`이고 도착이 출발 하위 트리 안이면 종전 정의로는 도착 행 자신까지 "대상 행 전부 삭제"에 휩쓸려 문서가 고아가 됐다 — UI에서 A 선택 + 하위 포함 → 자식 B로 이동이 자연스러운 경로라 422 대신 **제외**로 확정 · 도착에만 연결된 문서 = 대상 0 → `skipped` · 프론트 `excludeCategoryId`는 출발 노드만 유지). 문서당 1행 이관(S50 C 규칙 재사용): **출발 분류 자신의 행 우선 → 없으면 `(category_id, sort_order, document_id)` 오름차순 첫 행** `UPDATE category_id = to`(`sort_order`·`local_note`·`linked_at`·`linked_by`·`linked_rule_id` **그대로**) → `moved`+1 · 나머지 대상 행 삭제. 도착에 이미 같은 문서 행이 있으면 **도착 행 유지 · 대상 행 전부 삭제** → `skipped`+1(`moved` 0). PK `(category_id, document_id)` 충돌 0 보장.
  - `study_progress`: 이관된 문서에 한해 `(출발 집합, doc)` 행 중 1행(우선순위 동일)을 `(to, doc)`로 이관 — **단, `(to, doc)` 행이 이미 있으면 무접촉**(잔존 허용 · D ⓒ와 같은 이유로 삭제 0). `resume_points`·`attempts.category_id`·`suggestions` **무접촉**(분류 행 존속 · 풀이 기록 맥락 = 당시 분류 · S50이 이들을 건드린 건 분류 행 소멸 때문). `from == to` = 422(B-4).
- **F. `delete` = `documents.is_active=0`만(단건 `DELETE /api/documents/{id}`와 동일)** (결정 ⑥)
  - 활성 → 비활성 `deleted`+1 · 이미 비활성 `skipped`+1. **링크 행·태그·북마크·관계·attempts·srs 전부 무접촉**(`soft_delete_document:421~424` 파리티 · 불변 규칙 3 — 물리 삭제 0). 잔존 링크가 분류 삭제 판정에 세이지 않는 건 S50 결함 ① 수정으로 보장됨. `sources/` 무접촉(불변 규칙 4).
- **G. 응답 = 200 `DocumentBulkResult`(고정 7필드 · 항등식)** (결정 ⑦)
  - `{ "action": "…", "requested": n, "linked": n, "unlinked": n, "moved": n, "deleted": n, "skipped": n }` — 전 필드 상시(해당 없는 카운터 = 0). `requested` = 중복 제거 후 문서 수. 문서 단위 항등: `link`/`move`/`delete` = `requested = (linked|moved|deleted) + skipped` · `unlink`는 `unlinked`가 **링크 행 수**(deep 시 문서 1건이 여러 행일 수 있음)라 항등 없음 — 대신 `skipped` = 대상 행 0인 문서 수. 에러 = §3 포맷 · 코드 4종 안(`NOT_FOUND`·`VALIDATION_ERROR`) · `message` = 한국어 + 다음 행동.
  - 응답에 문서 본문·정답 0(불변 규칙 1 무관 표면이지만 명기).
- **H. 프론트 선택 모델 — 체크박스 상시 노출 · Shift 범위 · 현재 목록 전체 선택 · 컨텍스트 변경 시 초기화** (결정 ⑧ — **사용자 확정 대기 1 = 체크박스 노출 방식**, 아래 ⓐ 기본안)
  - **ⓐ 노출(기본안 · 미회신 시 채택)**: 카드 좌상단 `input type="checkbox"` **상시 노출**(데스크톱·모바일 공통 · 별도 "선택 모드" 토글 없음). 근거: 1회째 보이는 동작 원칙(메모 "editor-gesture-ux") · 모드 전환 1탭 절약 · 카드 제목 클릭(상세 이동)·드래그(단건 연결)는 그대로 — 체크박스만 `stopPropagation`. **대안 ⓑ**: 툴바 [선택] 토글로 진입하는 선택 모드(카드 본문 탭 = 토글) — 폰에서 오탭이 잦다고 느끼면 ⓑ. 착수 전 1회 질의(표) → 회신 없으면 ⓐ.
  - 상태(`Explore.tsx`): `selectedDocIds: Set<number>` + `anchorId: number | null`(Shift 범위 기준점). **파생 표시값 = `selectedDocIds ∩ 현재 목록 id`**(목록에서 사라진 id는 세지 않음). **초기화 트리거**: `selectedCategoryId`·`deep`·`typeFilter`·`tagFilter`·`orphanOnly`·`bookmarkedOnly` 변경(= `useDocuments` 필터 키 변경) · 배치 성공 후 · 분류 삭제 성공 후(기존 `:332~340` 블록에 합류).
  - **Shift 범위** = 그리드 순서(`documentsQuery.data.items` 배열 인덱스) 기준 `anchor..clicked` 구간 전부 **선택 추가**(해제 아님 · 앵커는 마지막 비Shift 클릭). Ctrl/Cmd 특수 처리 0(체크박스는 원래 토글).
  - **전체 선택** = 현재 목록(≤100 · `size:100` 고정 — 페이지네이션 UI 없음 §1 실측)만 · 라벨 "현재 목록 n건 전체 선택". 서버 상한 200 안.
  - `DocCard` props 확장: `selected: boolean` · `onToggleSelect(id, shiftKey)` — 선택 시 카드 테두리 `border-accent`(토큰 클래스 · 불변 규칙 5 · 새 색 0). 드래그 `dataTransfer` 무변(단건).
- **I. 선택 툴바 = `components/BulkSelectionBar.tsx`(신규 · 그리드 상단 sticky)** (결정 ⑨)
  - 선택 0이면 미렌더. 위치 = 필터바 아래·그리드 위 `sticky top-0 z-10 bg-surface border-border`(기존 토큰 클래스). 내용: `n건 선택` · [현재 목록 전체 선택] · [선택 해제] · 구분선 · 동작 4개 = **[분류에 연결]** · **[분류 이동]** · **[연결 해제]** · **[삭제]**(danger = `text-wrong` 기존 클래스).
  - **활성 조건**: [분류에 연결]·[삭제] = 항상 · [분류 이동]·[연결 해제] = **`selectedNode != null`일 때만**(출발 분류 = 좌측 선택 노드 · "전체 문서"·"단일 문서만" 상태에서는 출발이 없어 비활성 + 툴팁 "왼쪽에서 분류를 먼저 선택하세요"). 라벨에 출발을 명시: `'{node.name}'에서 연결 해제` · `'{node.name}'에서 이동` + `deep`이면 `(하위 포함)` 접미 → 서버 `deep`에 **탐색 "하위 포함" 토글 값 그대로** 전달(목록 = 대상 집합 동치 — 규약화: "화면에 보이는 이유가 된 연결"이 대상).
  - 모달: [분류에 연결]·[분류 이동] = **`LinkDocumentModal` 재사용 + 옵션 prop**(`title?` · `submitLabel?` · `withNote?` · `excludeCategoryId?` — 기본값 = 현행이라 기존 3 호출처 무변) · 이동 시 옵션 목록에서 출발 노드 제외(`from == to` 422를 UI에서 선차단) · 제목 `n건을 분류에 연결` / `n건을 '{from}'에서 이동`. [연결 해제]·[삭제] = 기존 `ConfirmDialog`(message에 **실수치 n** · 삭제 문구 "n건을 삭제할까요? 문서는 휴지통 없이 숨겨지며 분류 연결·학습 기록은 그대로 남습니다" · 해제 문구 "n건의 '{from}' 연결(하위 포함)을 해제할까요? 문서는 남습니다").
  - 뮤테이션 = `api/documents.ts` `useBulkDocuments()` → `api.post<DocumentBulkResult>('/documents/bulk', body)` · `onSuccess` = `documentKeys.all` + `categoryKeys.tree` invalidate(기존 3 훅과 동일 범위 — `all` 접두가 detail도 덮음) · 폴백 문구 = mutationFn 1곳(S50 검토 경미 ④ 관례 · ApiError는 서버 `message` 그대로). 성공 요약 = 툴바 자리에 1줄 "연결 5 · 건너뜀 1"(카운터 그대로 · 다음 조작 시 소멸) — 새 컴포넌트 0(툴바 안 텍스트).
  - 390px: 툴바 `flex-wrap` · 버튼 `text-xs` · 2줄 허용 · 가로 스크롤 0.
- **J. 문서 상세 [이동] = `UsageRow`에 버튼 1개(같은 API · ids 1건)** (결정 ⑩)
  - `DocumentDetail.tsx` `UsageRow:606~662`에 [연결 해제] 옆 [이동] → `LinkDocumentModal(title="분류 이동", submitLabel="이동", withNote=false, excludeCategoryId=현재 분류)` → `useBulkDocuments().mutate({action:'move', document_ids:[doc.id], category_id: usage.category_id, to_category_id, deep:false})`. 성공 시 `documentKeys.all` invalidate로 사용처 목록 갱신. 종전 "해제+연결 2동작" 경로는 그대로 남는다(제거 0).
- **K. 테스트 = `backend/tests/test_documents_bulk.py`(pytest)** (결정 ⑪) — 불변 규칙 7의 "필수"는 아니지만 **한 트랜잭션·부수 테이블 무접촉·dedup 규칙의 회귀 방지 목적으로 편성 필수**. 픽스처 = `test_category_delete.py` 전례(`PRAGMA foreign_keys=ON` 이벤트 포함 — E의 `study_progress` 이관이 FK 아래서 검증되도록). 케이스 = V-1.
- **L. invariant 기준선** (결정 ⑫) — D·E의 링크 행 삭제(`__table__.delete()`)는 `physical-delete` 규칙(`invariant-scan.ps1:53~58` baseline 모드)에 잡힌다 → **정당분**(`category_documents` 링크 행 · 문서 행 무접촉)이므로 구현 후 `-UpdateBaseline`(사용자 승인 후 · S50 전례 1→9). `documents` 물리 삭제·`is_active` 외 컬럼 변경 0.
- **M. 매뉴얼** (결정 ⑬) — `docs/manual/user-manual.html` 435~ "분류 — 문서를 담는 트리" 절 끝(stage-50 분류 삭제 단락 뒤)에 "여러 문서 한 번에 정리" 단락 1개(체크박스·Shift·툴바 4동작·이동은 기존 연결의 재배치·삭제는 숨김) + 401행 탐색 표 셀에 "일괄 정리" 어절 추가. 완료 시 반영(D-3).

## 3. 체크리스트

**B. 백엔드 (`backend/`)**
- [x] B-1 `schemas/document.py` — `DocumentBulkRequest`(규약 A 필드 · `Literal` action · `model_validator`로 action별 필수 필드·`document_ids` 1~200·중복 제거) · `DocumentBulkResult`(규약 G 7필드).
- [x] B-2 `routers/documents.py` — `POST /bulk` 등록(`POST /resolve-embeds` 뒤 · `POST ""` 앞 · **`/{document_id}` 앞 주석 명기**) · `response_model=DocumentBulkResult` · 200 · 얇은 라우트.
- [x] B-3 `services/document_service.py` `bulk_documents(db, payload)` — 검사 순서 B(404 문서 `missing_ids` → 404 분류 → 422 `from==to` → 422 `inactive_ids`) → 액션 분기 `_bulk_link`/`_bulk_unlink`/`_bulk_move`/`_bulk_delete`(C~F) → `commit` 1회 · 예외 = 롤백. deep 집합 = `_collect_descendant_ids` 재사용. move dedup = S50 C 규칙(출발 자신 행 우선 → `(category_id, sort_order, document_id)`) + `study_progress` 1행 이관(도착에 있으면 무접촉).
- [x] B-4 에러 메시지 = 한국어 + 다음 행동(§3) · `detail` 수치 동봉(`missing_ids`·`inactive_ids`·`category_id`) · 코드 신설 0. 기존 단건 4 엔드포인트·`GET /batch` diff 0 확인.

**F. 프론트 (`frontend/src/`)**
- [x] F-1 `api/types.ts` `DocumentBulkAction`·`DocumentBulkRequest`·`DocumentBulkResult` · `api/documents.ts` `useBulkDocuments()`(규약 I 뮤테이션 · invalidate 2범위 · 폴백 문구 1곳).
- [x] F-2 `components/DocCard.tsx` — `selected`·`onToggleSelect(id, shiftKey)` props · 좌상단 체크박스(기본안 ⓐ — H 확정 결과 반영 · `stopPropagation` · 드래그·제목 클릭·⋯ 메뉴 무변) · 선택 테두리 `border-accent`.
- [x] F-3 `pages/Explore.tsx` — `selectedDocIds`·`anchorId` 상태 · 파생 교집합 · Shift 범위(배열 인덱스) · 초기화 트리거(필터 6개·배치 성공·분류 삭제 성공) · `ModalState`에 `bulk-link`·`bulk-move`·`bulk-unlink`·`bulk-delete` 4종 추가 · 그리드 위 `BulkSelectionBar` 결선.
- [x] F-4 `components/BulkSelectionBar.tsx` 신규(규약 I — 카운트 · 전체 선택 · 해제 · 동작 4 · 활성 조건 · 출발 라벨 + `(하위 포함)` · 결과 1줄 요약 · sticky · 390px wrap).
- [x] F-5 `components/LinkDocumentModal.tsx` — `title?`·`submitLabel?`·`withNote?`·`excludeCategoryId?` 옵션 prop(기본 = 현행 · 기존 호출 3곳 무변) · `ConfirmDialog` 2용도(해제·삭제 · 실수치 n).
- [x] F-6 `pages/DocumentDetail.tsx` `UsageRow` [이동] 버튼 + 모달(규약 J · ids 1건 move).
- [x] F-7 색·간격 = 토큰·기존 유틸 클래스만(불변 규칙 5 — 새 색 0) · 390px에서 체크박스가 북마크·⋯ 버튼과 겹치지 않음.

**V. 검증 (서버 구동 금지 — `2_StartServer.bat` 주인은 사용자 · 브라우저 실측은 사용자가 띄운 `localhost:8000`만)**
- [x] V-1 `backend/tests/test_documents_bulk.py` — ① `link` 신규 n건 `linked=n` · 기존 연결 `skipped` · `linked_by='manual'`·`local_note` NULL ② `unlink` 얕은 = from 행만 삭제·다른 분류 연결 잔존·`study_progress` 행 잔존(무접촉) · deep = 하위 노드 행까지 · 대상 0 문서 `skipped` ③ `move` = 필드(`sort_order`·`local_note`·`linked_by`) 보존 · 도착 기존 행 시 도착 유지+`skipped` · deep 다중 연결 dedup(출발 자신 우선) · `study_progress` 이관/도착 존재 시 무접촉 · `attempts.category_id`·`resume_points` 무변 · 출발 링크 0 문서 = 새 연결 생성 0 · `from==to` 422 ④ `delete` = `is_active=0`·링크·북마크·태그 행 수 무변 · 이미 비활성 `skipped` ⑤ 없는 id 1건 포함 → 404 `missing_ids` + **부분 변경 0**(롤백) ⑥ 비활성 문서 + `link` → 422 `inactive_ids` ⑦ 빈 배열·201건·필수 필드 누락 → 422 ⑧ 분류 미존재 404 ⑨ 항등식 G(문서 단위 카운터). `run-tests.ps1 -Path tests/test_documents_bulk.py`(래퍼가 `backend/`로 이동 — 경로는 `tests/…` · 편성 표기 정정) 통과 → `-Full` 무회귀.
- [x] V-2 `invariant-scan.ps1` — physical-delete 신규분은 정당(규약 L) → 사용자 승인 후 `-UpdateBaseline` · 그 외 PASS · `npm run build` 성공(성공/실패만 · 신규 의존 0이라 R37 게이트 무관).
- [x] V-3 브라우저 실측(사용자 기동 서버 · 노트 무접촉 · 실측용 분류·문서는 새로 만들어 원상 복구): ⓐ 체크 1건 → 툴바 등장·카운트 1 · Shift로 3건 범위 → 3 · 전체 선택 → 목록 수 · 해제 → 툴바 소멸 ⓑ "전체 문서"에서 [이동]·[해제] 비활성 + 툴팁 · 분류 선택 후 활성 · 라벨에 분류명·(하위 포함) ⓒ [분류에 연결] n건 → 트리 `doc_count` +n · 카드 "n곳에서 사용 중" 갱신 · 이미 연결분 요약 "건너뜀" ⓓ [분류 이동](하위 포함 켬) → 출발 트리 `doc_count` 감소·도착 증가 · 문서 상세 usages 경로 교체 · `local_note` 보존 ⓔ [연결 해제] → "단일 문서만" 필터에 노출 ⓕ [삭제] n건 → 목록에서 소멸 · 확인 문구 실수치 ⓖ 필터·분류 변경 시 선택 초기화 ⓗ 문서 상세 [이동] 1동작 ⓘ 390px(iframe 에뮬 가능) 툴바 2줄·체크박스 겹침 0 · 콘솔 에러 0.

**D. 문서**
- [x] D-1 설계 — api §4.2 `[S51]` 포인터 행 + `### 4.31 [S51]` 절(편성 시 v1.63 선반영 · 완료 시 "구현 실측 확정" 표기 + 색인 v1.64) · screens §5.2·§5.3 S51 불릿(동일).
- [x] D-2 별지 §13 FB-25 행 `← 완료(stage-51 · 날짜)` · backlog §1 FB-25 행 → §4 종결 이동 · `backlog-scan.ps1` PASS · 마스터 §14 M37 행 ✅ + §5 F60 색인 행 무변(정본 포인터 그대로).
- [x] D-3 매뉴얼 단락(규약 M) · CHANGELOG 항목 · stage-index 51행 · 이 문서 §7 완료 기록.

## 4. 이 단계에서 하지 않는 것 (불변 규칙 9 — 이 절이 우선)

- **휴지통·복구·물리 삭제 0**(D8-구현 — backlog §1) · 일괄 삭제 undo 0 · 비활성 문서 목록(`include_inactive`) UI 0. 삭제 = `is_active=0`만(불변 규칙 3).
- **일괄 편집의 다른 축 0** — 태그 일괄 부여/제거 · 타입 변경 · 북마크 일괄 · 난이도 — 실수요 도착 시 별지 §13 FB 등재 후 별도(`action` 값 추가는 그때).
- **탐색 밖 표면 0** — 커리큘럼(§5.4) 표 · 커리큘럼 상세 · 검색 결과 · 인쇄 선택 화면에 다중 선택 없음. 문서 상세는 [이동] 1버튼만(J).
- **드래그 다중 드롭 0** — 카드 드래그는 단건 연결 추가 그대로(`DocCard` `dataTransfer` 무변) · 선택 n건을 트리로 끌어다 놓기 없음.
- **페이지네이션 UI·목록 상한 변경 0**(`size:100` 고정) · 키보드 단축키(Ctrl+A · Esc 해제) 0 · 선택 상태의 URL/세션 보존 0.
- **기존 단건 API 4개(`POST /links` · `DELETE /links/{cid}` · `DELETE /{id}` · `GET /batch`) 계약 무변** · `linked_by` 새 값 0 · 태그 규칙 스캔·제안(`suggestions`) 연동 0 · `local_note` 배치 입력 0.
- **`unlink`/`move`에서 `study_progress` 삭제 · `attempts.category_id` 변경 · `resume_points` 정리 0**(규약 D·E — 분류 행 존속 · 학습 기록 보존). 분류 삭제(S50)의 정리 규약을 여기로 확장하지 않는다.
- DDL 0 · Alembic 0 · §15 R 행 0 · settings 키 0 · 새 라우트 0 · 신규 의존 0 · `ConfirmDialog` 옵션 슬롯 확장 0(S50 봉인 유지 — 실수치는 message 문자열).

## 5. DoD (완료 정의)

**자동 검증(에이전트 수행):**
1. `run-tests.ps1 -Path tests/test_documents_bulk.py`(래퍼가 `backend/`로 이동 — 경로는 `tests/…` · 편성 표기 정정) 통과(V-1 ①~⑨) + `-Full` 무회귀 · `invariant-scan.ps1` PASS(기준선 갱신은 정당분만 · 사용자 승인 기록).
2. `npm run build` 성공 · 백엔드 diff = `routers/documents.py`·`services/document_service.py`·`schemas/document.py`·테스트 1파일 안 · Alembic diff 0 · 신규 의존 0 · 기존 단건 엔드포인트 4개 응답 diff 0.
3. 프론트 diff = `Explore.tsx`·`DocCard.tsx`·`LinkDocumentModal.tsx`·`DocumentDetail.tsx`·`api/documents.ts`·`api/types.ts`·신규 `BulkSelectionBar.tsx` 안 · 새 색 리터럴 0(`tokens.css` 무변) · `LinkDocumentModal` 기존 호출 3곳 동작 무변.
4. 브라우저 V-3 ⓐ~ⓘ 전건 통과(실측 데이터 원상).
5. 문서 묶음 D 전건(Design v1.64 · 별지 FB-25 `← 완료` · backlog 종결 이동 · M37 ✅ · 매뉴얼 단락 · CHANGELOG · stage-index).

**사용자 확인(게이트 본체):**
6. **실사용** — FB-25 원문 케이스(반입 단위로 쌓인 문항 수십 건을 골라 다른 분류로 이동 · 잘못 들어온 것 일괄 삭제 · 두 시험에 공용인 개념 문서 일괄 연결)를 폰·PC에서 해 봄 → 결과가 트리 수치·문서 상세 사용처와 일치 · 학습 진도·풀이 기록 이상 0 · **치명 결함 0 회신** = 발행 게이트.

**게이트**: 1~5 전건 + 6 치명 0 → 발행(§6 ① 판정). 치명 발견 시 발행 보류·수정 선행. **착수 게이트**: 규약 H 사용자 확정(ⓐ/ⓑ) — 미회신 시 ⓐ로 착수.

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` — **발행 단위 판단(핵심 stage · 규약 ②)**: ⓐ stage-48·49·50(v2.01.3)이 이미 발행됐으면 **v2.02.1 항목 1개**(단독) ⓑ 아직 발행 대기면 **v2.01.3 항목은 CHANGELOG에 그대로 두고(번호 재부여 없음) v2.02.1 항목을 위에 추가 · `VERSION`은 2.02.1 한 번만 발행**(48·49·50·51 한 발행 단위 — v2.01.3 항목 머리에 "v2.02.1과 동시 발행(단독 발행 생략)" 1줄 · stage-index 48·49·50 행의 산출 버전을 "v2.01.3 (v2.02.1 동시 발행)"으로 맞춤). 사소 stage가 핵심에 합류하는 방향이라 규약 ②와 무충돌(핵심이 사소로 강등되지 않는다 — 역방향 합류 금지). 완료 시점 상태로 기계적으로 정한다. 불릿 = 탐색 다중 선택(체크박스·Shift·전체 선택) · 선택 툴바 4동작 · `POST /api/documents/bulk`(한 트랜잭션 · 카운터) · 문서 상세 [이동] · 삭제 = 숨김(휴지통 없음 명기).
2. 루트 `VERSION` = 발행 버전 — 사용자 회신(DoD 6) 후.
3. `stage-index.md` 51행 갱신(완료·일자·산출 버전).
4. `backlog.md` — §1 `FB-25` 행을 §4로 **종결 이동**(`종결(stage-51 · 날짜)`) · 기준일 줄 갱신 · `scripts/backlog-scan.ps1` PASS 확인.
5. 출처 추기 — 별지 §13 FB-25 행 끝 `← 완료(stage-51 · 날짜)`(D-2) · 마스터 §14 M37 행 완료 열 ✅ + 날짜 + 발행 버전.
6. 설계 — api §4.31 `[S51]` 절 "구현 실측 확정" 표기 + §4.2 포인터 행 · screens §5.2·§5.3 2곳 · 색인 상태 줄 v1.64(최근 3건 규칙으로 밀리는 v1.60은 `docs/04-archive/design-changelog.md` 맨 위로 이동만).
7. 매뉴얼 단락(D-3) · `CLAUDE.md` 머리 버전 줄 1곳(발행 시 · 경위 전재 금지) · git tag(발행 버전 · release PR 별도 — stage-47 전례).

## 7. 완료 기록 (구현·검증·문서 경위 정본 — 착수 후 추기)

- **편성**(2026-09-13): 지시서 확정 — 규약 A~M(사용자 확정 3건 = FB-25 단독 · 번호 51 · 핵심 · 그 외 위임 판정 · **H 체크박스 노출 방식만 사용자 확정 대기(기본안 ⓐ)**) · api §4.2 `[S51]` 포인터 행 + `### 4.31` 절 · screens §5.2·§5.3 S51 추기(Design v1.63) · stage-index 51행 · backlog `편성 = stage-51` · 별지 §13 FB-25 편성 추기 · 마스터 §14 M37 행 + §5 F60 색인 행.
- **착수**(2026-09-13 · `/stage-implement 51` · 브랜치 `stage-51-explore-bulk-select` · 워크트리): 규약 H 사용자 질의는 회신 없이 진행돼 **기본안 ⓐ(체크박스 상시 노출)** 채택. 백엔드(sonnet)·프론트(sonnet) 병렬 구현 → 구현 커밋 `07c6d13`.
- **구현 실측**: 백엔드 = `schemas/document.py` `DocumentBulkRequest`(`field_validator` 순서 보존 dedup + `model_validator` action별 필수 필드)·`DocumentBulkResult` · `routers/documents.py:95` `POST /bulk`(`POST /resolve-embeds` 뒤 · `POST ""` 앞) · `services/document_service.py` `bulk_documents` + `_bulk_link/_bulk_unlink/_bulk_move/_bulk_move_study_progress/_bulk_delete`(검사 전 변경 0 → `commit` 1회 — S50 패턴) · `tests/test_documents_bulk.py`. 프론트 = `api/types.ts`·`api/documents.ts` `useBulkDocuments`(폴백 `BULK_DOCUMENTS_FALLBACK_MESSAGE` 1곳) · `DocCard` `selected`/`onToggleSelect`(체크박스는 `onToggleSelect` 전달 시만 렌더 · `onChange` `nativeEvent.shiftKey`) · `BulkSelectionBar.tsx` 신규 · `Explore.tsx` 선택 상태·Shift 범위·전체 선택·초기화 `useEffect`(필터 6종) + 모달 4종 · `LinkDocumentModal` 옵션 prop 4개(기본 = 현행) · `DocumentDetail.tsx` `UsageRow` [이동] + 모달(`useCategoryTree` 상시 호출). 툴바 [연결]·[이동] 모달은 `withNote={false}`(API가 `local_note`를 받지 않음 — 규약 C·§4 정합).
- **자동 검증**: `run-tests.ps1 -Path tests/test_documents_bulk.py` 18 → 검토 반영 후 **22 통과** · `-Full` **659 통과** · `invariant-scan.ps1` — physical-delete `document_service.py` 4→7(`_bulk_unlink`·`_bulk_move`의 `CategoryDocument` `db.delete(row)` 3곳 = 규약 L 정당분 · `documents` 무접촉 확인 후 `-UpdateBaseline` → **PASS**. **V-2 기준선 갱신 승인 기록**: 사용자 부재 중 CLAUDE.md 규칙("정당하면 `-UpdateBaseline`")에 따라 메인이 수행 — 사용자 사후 확인 항목으로 보고) · `npm run build` 성공.
- **Opus 검토 1차(재작업)**: **중요-1** `_bulk_move` deep에서 도착이 출발 하위 트리 안이면 `_collect_descendant_ids(from)`에 도착이 포함돼 "도착 존재 → 대상 행 전부 삭제" 분기가 도착 행 자신까지 지움 → 문서 링크 0(고아) · 응답 `skipped`(실측 A⊃B · d1 A·B 연결 → move A→B deep → 링크 0행). **확정(구현 실측 확정 ⓐ)**: 대상 집합 = 출발 하위 트리 **− {도착}**(UI에서 A 선택 + 하위 포함 → 자식 B로 이동이 자연스러워 422 대신 제외 · 프론트 `excludeCategoryId`는 출발 노드만 유지). **경미-1** 폴백 문구가 호출처 5곳 리터럴로 중복(mutationFn 폴백 사문) → 5곳 `e.message`. **경미-2** 분류 존재 검사가 action 무관(`delete + category_id` → 404) → action별 관련 필드만(delete = 검사 0). **경미-3** V-1 빈약(dedup 폴백 규칙 · unlink deep 항등 예외 · 중요-1 케이스) → 테스트 +4. 계약 정정 = api §4.31 `move` 행 실측 확정 ⓐ · 규약 E 추기 · K/DoD 1 경로 표기 `tests/…`(래퍼가 `backend/`로 이동). 반영 커밋 `7aabd4d`.
- **Opus 재검토**: ①~④ 전건 확인(수정 기대값 일치 · `study_progress` 이관도 필터된 집합 · link/unlink 404 유지 · 새 테스트 4건 실질 검증) · 회귀 0 → **통과(치명·중요·경미 0)**. **등재 권고 2건(기록 — 처분은 사용자)**: ⓐ bulk-move 모달이 deep 시 하위 노드를 도착으로 허용(서버 정상 처리 · `collectDescendantIds`로 선차단하면 "대상 0 → 건너뜀" 헛조작 방지 — UX 후보) ⓑ `DocumentDetail`의 `useCategoryTree()` 상시 fetch(훅 시그니처 변경 필요라 미적용). V-3 관찰 후보: Shift+클릭 시 카드 사이 텍스트 선택 하이라이트(브라우저 기본 · 기능 영향 0).
- **문서**: api §4.31 절 머리·§4.2 행 "구현 실측 확정" + `move` 행 ⓐ · screens §5.2·§5.3 S51 실측 재개정 · Design **v1.64**(v1.60 아카이브 이관) · CHANGELOG **v2.02.1 항목**(발행 대기 · v2.01.3 항목 머리에 "동시 발행 · VERSION은 2.02.1" 1줄 · §6 ① ⓑ) · stage-index 51행 + 48·49·50 산출 버전 "v2.02.1과 동시 발행" · backlog FB-25 §4 종결 + 기준일 줄 · 별지 §13 FB-25 `← 완료` · 마스터 §14 M37 ✅(발행 대기) · 매뉴얼 분류 절 "여러 문서 한 번에 정리" 단락 + 탐색 표 셀.
- **V-3 브라우저 실측**(2026-09-13 · PR #102 머지·pull → 사용자 서버 재시작 확인(`POST /bulk` 422 응답 = 새 코드) → `/browser-debug` 위임 · 픽스처 = API로 생성한 분류 A(20)⊃B(21)·C(22) + 문서 233~237, 종료 후 소프트 삭제·분류 삭제로 정리): **ⓐ~ⓘ 전건 통과** — ⓐ Shift 범위 "3건 선택"(체크박스 native click `shiftKey:true` → `nativeEvent.shiftKey` 유효) · 전체 선택 4 · 해제 시 툴바 소멸 ⓑ "전체 문서"에서 [이동]·[해제] disabled + 툴팁 문구 일치 · A 선택 시 `'S51실측A'에서 이동` · 하위 포함 `(하위 포함)` 접미 ⓒ 연결 2 → 트리 C 0→2 · 배지 갱신 · 재연결 "연결 0 · 건너뜀 1" ⓓ 이동(하위 포함) 5건 → **"이동 3 · 건너뜀 2"**(ⓒ에서 C에 이미 있던 d1·d2 = 도착 유지 규칙 그대로) · 트리 A 0·B 0·C 5 · d2 사용처 = C만(B메모는 B 행 삭제와 함께 소실 — 규칙대로) · d5 = C만 ⓔ 확인 문구 실수치 "1건의 'S51실측C' 연결(하위 포함)…" · "단일 문서만" 필터에 노출 ⓕ "2건을 삭제할까요? … 휴지통 없이 숨겨지며 …" · 트리 C 4→2 ⓖ 필터 변경 시 툴바 소멸 ⓗ 문서 상세 [이동] 모달(제목 "분류 이동" · 메모 없음 · 출발 제외) → 사용처 A만 ⓘ 390px 체크박스가 별·⋯과 겹침 0 · 가로 스크롤 0(툴바는 **3줄 wrap** — 편성 "2줄 허용"보다 1줄 많으나 넘침 없음 · 결함 아님) · 콘솔 `error|Error|Warning: |uncaught` 0건. 실측 부산물: 픽스처 이름 깨짐(`?ㅼ륫`)은 PowerShell 5.1이 BOM 없는 스크립트를 ANSI로 읽은 것 — 앱 무관(제목 원본 자체가 깨져 저장됨 확인).
- **잔여 게이트**: **DoD 6** 사용자 실사용 회신(치명 0) → `VERSION` 2.02.1 발행(48·49·50·51 한 발행 단위) + CLAUDE.md 버전 줄 + git tag.
