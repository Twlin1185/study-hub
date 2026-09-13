# Stage 50 — 분류 삭제 결함 수정 + 선택형 삭제 (FB-24 ①·②) (v2.0.x · 사소)

> 상태: **착수 전**(편성 2026-09-13 · 사용자 확정 대기 항목 0 · 다음 명령 = `/stage-implement 50`).
> **버전 영향: 사소**(사용자 확정 2026-09-13 · CHANGELOG 규약 ③ 1회 질의 완료). 근거 병기: **가산적 선택 파라미터**(`on_documents`·
> `recursive` 미지정 = 기존 409 그대로 — 후방 호환) · **신규 엔드포인트 0** · **DDL 0** · 새 화면(라우트) 0 · 사용자 체감 = 삭제
> 모달의 옵션 1묶음 · 선례 = stage-48(신규 엔드포인트 `duplicate` 1개로도 사소 판정). → 산출 버전 **v2.01.4 예정**(stage-48·49가
> v2.01.3 발행 대기 중 — 완료 시점에 48·49 미발행이면 v2.01.3 합류 여부를 §6 ①에서 기계적으로 판정 · 규약 ② 번호 재부여 없음).
> 마스터 §14 로드맵 M 행 추가 없음(사소 stage는 stage-index가 담당).
> 생성 경위: `backlog.md` §1 `FB-24`(별지 §13 FB-24 · 2026-09-13 사용자 피드백 "분류 삭제 불가 — 문서 삭제·변경·카테고리 변경을
> 자유롭게") · 사용자 2분해 확정 2026-09-13 = **① 결함 수정**(`is_active` 미고려 409 + 모달 실수치 미표시) + **② 선택형 삭제**(ⓐ 연결만
> 해제 · ⓑ 부모로 재연결 · 하위 포함 재귀) — **둘을 단독 stage 1개에**. FB-25(일괄 도구)·D8-구현(휴지통)은 동승하지 않는다(FB-25는
> "FB-24 선행" 조건이 이 stage로 충족). **ⓒ 문서 동반 소프트 삭제는 D8 이후 유예**(§4).
> 정본 포인터: API 계약 = api §4.1 18행 개정 + **`[S50]` 절**(파라미터·기본값·참조 정리·응답·에러 표 — 편성 추기 **Design v1.61**) ·
> 화면 계약 = screens §5.2 S50 불릿(탐색) · §5.4 S50 불릿(커리큘럼) · 에러 포맷 = 설계 §3(코드 4종 불증) · 불변 규칙 3(분류 빼기 =
> 연결 해제)·4(원본 불변) · 발행 절차 = CHANGELOG 머리 규약 ⑤.

## 1. 범위 (백엔드 1 엔드포인트 확장 + 프론트 모달 1 공용화 — 코드 실측 2026-09-13)

| 대상 ID(등록부 · 출처) | 성격 | 요지 | 현행 코드 실측(Grep 근거) |
|---|---|---|---|
| **FB-24 ①**(backlog §1 · 별지 §13 505행) | 결함 | `delete_category` 문서 판정이 소프트 삭제 문서를 못 거름 + 모달이 실수치를 안 보여줌 | `backend/services/category_service.py:286~310` `delete_category` — `has_children:289~296` 409 · **`has_documents:298~302`가 `category_documents`만 보고 `documents.is_active`를 조인하지 않음**(트리 `_doc_counts:34~47`은 `is_active == 1` 조인 → "문서 0인데 삭제 불가" 가능) · `db.delete(category):309` 물리 삭제 · 라우터 `backend/routers/categories.py:73~75` `status_code=204` · 파라미터 0. 모달 = `frontend/src/pages/Curriculum.tsx:201~220` · `CurriculumDetail.tsx:322~341` · `Explore.tsx:321~343` **3곳 동일 `ConfirmDialog` 리터럴**("하위 분류나 연결된 문서가 있으면 삭제할 수 없습니다" · onError 폴백 문구도 3곳 복제) · `components/ConfirmDialog.tsx:1~53`(message 1개 · 옵션 슬롯 없음) · 트리 노드 `api/types.ts:7~18` `CategoryNode{children, doc_count}` — **`doc_count`는 직계(활성 문서 연결 행 수 · deep 아님 — `build_tree:112`)** · 하위 집계 유틸 `utils/tree.ts:47` `collectDescendantIds` 기존 |
| **FB-24 ②**(같은 행) | 제안(사용자 2026-09-13) | 삭제 모달에 문서 처리 선택(ⓐ 연결만 해제 · ⓑ 부모 분류로 재연결) + 하위 포함 재귀 삭제 → `DELETE /api/categories/{id}`에 `on_documents`·`recursive` 추가(저장 계약 변경 = 설계 §4.1 개정) | 뮤테이션 `frontend/src/api/categories.ts:73~79` `useDeleteCategory` = `api.delete<void>('/categories/${id}')` · `api/client.ts:68` **`delete`는 본문 인자 없음**(→ 쿼리 전달 · 규약 A) · 부모 이름은 `utils/tree.ts:18` `findCategory`로 트리에서 조회 가능. **FK 참조 실측(편성 중 발견 — 잠재 결함)**: `backend/database.py:23~29` `PRAGMA foreign_keys=ON` · `models.py`에서 `categories.id`를 참조하는 테이블 = `category_documents:94~96`(PK 일부) · `attempts.category_id:120`(NULL 허용) · `tag_rules.category_id:217~219`(**NOT NULL**) · `suggestions.category_id:234`(**NOT NULL** · `UniqueConstraint(document_id, category_id):243`) · `study_progress:252~254`(PK 일부) · `resume_points:267~269`(PK) — 현행은 링크·하위 409가 가려주지만 문서를 단건 해제한 뒤(`document_service` 연결 해제는 `study_progress`를 지우지 않음 — grep 0건) 삭제하면 `study_progress`·`resume_points`·`attempts` 잔존 행이 **FK 위반 → 500**이 될 수 있다. 409를 완화하는 이 stage가 참조 정리 규약(§2 E)을 함께 확정한다 |

**DDL 0(계획서 §6.2 무변 · Alembic 불필요) · 신규 엔드포인트 0(기존 DELETE에 쿼리 2개 + 응답 204→200 통계) · settings 키 0 ·
새 라우트 0 · 신규 의존 0 · `sources/` 무접촉 · 문서 행(`documents`) 무접촉(불변 규칙 3·4) · SM-2·오답노트 무접촉(`attempts` 행
생성·삭제 0 — 불변 규칙 2 밖).**

## 2. 확정 규약 (착수 전 결정 — 위임 판정 · 이 문서가 정본 · 사용자 확정 대기 0)

- **A. 파라미터 = 쿼리 문자열** — `DELETE /api/categories/{id}?on_documents=unlink|reparent&recursive=1` (결정 ①)
  - 근거: `api/client.ts:68` `delete(path)`가 본문을 받지 않음(래퍼 관례) · DELETE 본문은 fetch/프록시 호환이 불안 · 같은 라우터의
    `GET …/study-track?deep=` 불리언 쿼리 전례(`routers/categories.py:78~83`). FastAPI 쿼리 파라미터 = `on_documents: Literal["unlink","reparent"] | None = None` ·
    `recursive: bool = False`(`1`/`true` 허용). 잘못된 값 = 422 `VALIDATION_ERROR`(FastAPI 기본 → 앱 에러 포맷 §3).
- **B. 기본값 = 기존 409 그대로(후방 호환) + 결함 ① 수정** (결정 ②)
  - `recursive` 미지정 + 하위 분류 있음 → **409** `CONFLICT` "하위 분류 n개가 있어 삭제할 수 없습니다 — '하위 분류 포함'을 선택하거나 먼저 이동해주세요"(`detail={category_id, children: n}`).
  - `on_documents` 미지정 + **활성 문서**(`documents.is_active=1`) 연결 있음 → **409** "연결된 문서 n건이 있어 삭제할 수 없습니다 — 연결만 해제/부모로 재연결 중 하나를 선택해주세요"(`detail={category_id, documents: n}`). **판정 쿼리는 `_doc_counts`와 같은 `is_active == 1` 조인**(결함 ① 본체). `recursive=1`이면 판정·집계 범위 = 하위 트리 전체.
  - 소프트 삭제 문서(`is_active=0`)의 잔존 연결 행은 **판정에 세지 않고**, 실행 시 아래 C 정책을 활성 행과 똑같이 적용한다(`on_documents` 미지정인데 비활성 링크만 있으면 `unlink`로 처리 — FK 정리). 통계 `unlinked`·`reparented`는 활성·비활성 링크 행을 합산한 값(문서 행이 아니라 링크 행 수).
- **C. `on_documents` 의미 — 문서 행 무접촉, 링크 행만 이동/삭제** (결정 ③)
  - `unlink` = 삭제 대상(recursive 시 하위 트리 전체)의 `category_documents` 행 삭제. 문서는 잔존 → 탐색 "단일 문서"(`orphan=1`)로 노출(다른 분류에 연결돼 있으면 그대로).
  - `reparent` = 대상 트리의 링크 행을 **최상위 삭제 대상의 `parent_id`**로 `UPDATE category_id`(recursive 시 모든 하위의 문서도 같은 부모 1곳). **최상위 삭제 대상이 루트(`parent_id IS NULL`)면 422** `VALIDATION_ERROR` "최상위 분류는 부모가 없어 재연결할 수 없습니다 — '연결만 해제'를 선택해주세요"(`unlink` 폴백 금지 — 사용자의 명시 선택을 서버가 바꾸지 않는다 · 프론트는 루트 노드에서 ⓑ 옵션을 아예 숨긴다).
  - **중복 방지(PK `(category_id, document_id)`)**: 문서 기준으로 1행만 이관 — ⓐ 부모에 이미 같은 문서 링크가 있으면 **부모 행 유지·대상 행 삭제**(`skipped_duplicates`+1 · 부모 행의 `sort_order`·`local_note`·`linked_by` 무변) ⓑ 대상 트리 안에서 여러 노드에 걸린 문서는 **삭제 대상 자신의 행 우선, 없으면 `(category_id, sort_order, document_id)` 오름차순 첫 행**을 이관하고 나머지 삭제. 이관 행은 `sort_order`·`local_note`·`linked_at`·`linked_by`·`linked_rule_id` **그대로**(부모 문서와 `sort_order` 충돌 허용 — 학습 트랙은 `sort_order, id`로 안정 정렬).
- **D. `recursive` = 하위 트리 물리 삭제(분류 행만)** (결정 ④)
  - 하위 트리 = 재귀 CTE(`subtree_progress:61~67` 패턴 재사용). 삭제 순서 = 깊은 노드 먼저(FK `parent_id` 자기참조). 각 하위의 문서 링크·참조는 C·E 정책을 동일 적용. `recursive` 없이 하위가 있으면 B의 409.
- **E. FK 참조 테이블 정리(같은 트랜잭션) — §1 실측의 잠재 500 봉인** (결정 ⑤)
  | 테이블 | `unlink` | `reparent` | 근거 |
  |---|---|---|---|
  | `category_documents` | 행 삭제 | 부모로 이관(C 중복 규칙) | 불변 규칙 3 |
  | `study_progress`(분류 맥락 진도) | 대상 트리 행 **삭제** | 부모에 `(parent, document)` 행이 **없는 문서만** 부모로 이관 · 있으면 부모 행 유지·대상 행 삭제 | 진도는 분류 맥락 상태 — 재연결 = 연속성 기대 · 문서 자체의 SM-2(`srs`)는 무접촉 |
  | `resume_points`(이어하기) | 삭제 | 삭제 | 사라진 트랙의 위치 · 부모 트랙 순서와 다름 |
  | `attempts.category_id`(NULL 허용) | `NULL` | 부모 id | 풀이 기록은 보존(행 삭제 0 — 불변 규칙 2 밖) · 분류 통계(§4.1 stats)만 맥락 이동 |
  | `suggestions`(NOT NULL · UNIQUE(doc, category)) | 대상 트리 행 **삭제** | 삭제(부모로 재대상화 시 UNIQUE 충돌 · 규칙 파생물이라 재생성 가능 — YAGNI) | 제안 = 규칙이 만든 파생 데이터 |
  | `tag_rules.category_id`(NOT NULL · 사용자 설정) | **409 사전 차단** | 409 사전 차단 | 규칙은 사용자가 만든 명시 설정 — 묵시 삭제 금지. 메시지 "이 분류(하위 포함)를 대상으로 하는 태그 규칙 n개가 있어 삭제할 수 없습니다 — 설정 › 태그 규칙에서 먼저 정리해주세요"(`detail={tag_rule_ids:[…]}`) |
  - 검사·실행 순서: 404 → **422(reparent+루트)** → 409 태그 규칙 → 409 하위(비재귀) → 409 활성 문서(미지정) → 실행(링크 → 진도 → 이어하기 → attempts → suggestions → 분류 행 깊은 순) → `commit` 1회. 어느 단계든 예외 = 롤백(부분 삭제 0).
- **F. 응답 = 200 + 통계** (결정 ⑥) — `{ "deleted_categories": n, "unlinked": n, "reparented": n, "skipped_duplicates": n }`(현행 204 → 200 — 프론트 `api.delete<void>`는 본문을 무시하므로 회귀 0 · 새 소비자 = 없음, 통계는 테스트·로그용. 에러는 §3 포맷 · 코드 4종 안에서).
- **G. 프론트 = 공용 `DeleteCategoryModal` 1곳(3 페이지 리터럴 통합) — 수치 정의** (결정 ⑦)
  - 파일 `frontend/src/components/DeleteCategoryModal.tsx`(`Modal` 위에 직접 구성 — `ConfirmDialog`는 옵션 슬롯이 없어 무변). props = `{node, allNodes, submitting, errorMessage, onClose, onConfirm(opts: {on_documents?: 'unlink'|'reparent', recursive?: boolean})}` · 3 페이지의 `modal.kind === 'delete-category'` 블록이 이 컴포넌트로 교체(폴백 문구 리터럴도 제거 → 서버 `message` 우선 · `errMsg` 폴백 1곳).
  - **수치(트리 응답만으로 계산 · 새 API 0)**: 하위 분류 = `collectDescendantIds(node).size - 1`(`utils/tree.ts:47~53`은 자기 자신을 포함하므로 1 감산) · 연결 문서(직계) = `node.doc_count` · 하위 포함 연결 = 하위 트리 `doc_count` 합. **`doc_count`는 직계 활성 링크 행 수(§1 실측)** → 문구는 "연결 n건"(문서가 여러 하위 노드에 걸리면 중복 집계될 수 있어 "문서 n개"라 쓰지 않는다). 모달 본문: `"<이름>" 분류를 삭제할까요?` + 요약 줄 `하위 분류 {c}개 · 연결 문서 {d}건(하위 포함 {D}건)`(0인 항목은 생략).
  - **옵션 노출 규칙**: ⓐ `c>0` → 체크박스 "하위 분류 {c}개도 함께 삭제"(미체크면 [삭제] 비활성 + 힌트 "하위 분류가 있으면 함께 삭제하거나 먼저 이동하세요" — 서버 409를 굳이 받지 않는다) ⓑ 처리 대상 링크(체크 시 `D`, 아니면 `d`) `>0` → 라디오 "문서 처리": **기본 = 연결만 해제**(부제 "문서는 남고 '단일 문서'로 표시됩니다") / "부모 분류 '{부모 이름}'로 재연결"(`node.parent_id === null`이면 항목 미노출) ⓒ `c=0 && d=0` → 옵션 0 · 현행과 같은 단순 확인. 옵션이 있을 때 [삭제] 라벨은 danger 유지 · 색은 토큰만(불변 규칙 5 — 기존 `bg-wrong`·`text-primary` 클래스 재사용).
  - `useDeleteCategory` 입력 = `{id, on_documents?, recursive?}` → `URLSearchParams`로 쿼리 조립(값 없는 키는 생략 — 기본 동작 보존). `Explore.tsx:334~337` 선택 초기화는 **삭제 트리에 선택 노드가 포함되면**(`collectDescendantIds`)으로 확장. 성공 후 `categoryKeys.tree` invalidate는 기존 그대로(pipeline 변형 포함).
- **H. 테스트 = `backend/tests/test_category_delete.py`(pytest)** (결정 ⑧) — 불변 규칙 7의 "필수"는 아니지만 **FK 정리 회귀 방지 목적으로 편성 필수 항목**. 픽스처는 `test_notes_duplicate.py:23~37` 전례 + **`PRAGMA foreign_keys=ON` 이벤트 등록**(앱 `database.py:23~29`와 동일 조건이어야 E가 검증됨). 케이스 = V-1 참조.
- **I. 매뉴얼** (결정 ⑨) — `docs/manual/user-manual.html` 435~441행 "분류 — 문서를 담는 트리" 절 끝에 분류 삭제 단락 1개(하위 포함·연결만 해제/부모로 재연결·문서는 지워지지 않음·태그 규칙 선정리). 완료 시 반영(D-3).

## 3. 체크리스트

**B. 백엔드 (`backend/`)**
- [x] B-1 `routers/categories.py:73~75` — `delete_category(category_id, on_documents: Literal['unlink','reparent'] | None = None, recursive: bool = False)` · `status_code=200` · 응답 스키마 `CategoryDeleteResult`(`schemas/category.py`에 추가 — F 4필드).
- [x] B-2 `services/category_service.py` `delete_category` 재작성(규약 B~F 순서 그대로): 하위 트리 id 수집(재귀 CTE — `recursive=False`면 자기 1개 + 하위 존재 시 409) → 태그 규칙 409 → 활성 문서 판정(`is_active == 1` 조인 · 미지정 시 409) → 루트+reparent 422 → 링크 이관/삭제(C 중복 규칙 — 부모 기존 행 우선 · 문서당 1행) → `study_progress`(E) → `resume_points` 삭제 → `attempts.category_id` NULL/부모 → `suggestions` 삭제 → 분류 행 깊은 순 삭제 → `commit` 1회 · 통계 반환.
- [x] B-3 에러 메시지 = 한국어 + 다음 행동(§3 규약) · `detail`에 수치(`children`·`documents`·`tag_rule_ids`) 동봉 · 코드는 `CONFLICT`/`VALIDATION_ERROR`만(신설 0).
- [x] B-4 `_doc_counts`·`build_tree` 무변 확인(모달 수치 정의 G가 직계 활성 링크 수에 의존).

**F. 프론트 (`frontend/src/`)**
- [x] F-1 `api/categories.ts` `useDeleteCategory` 입력 `{id, on_documents?, recursive?}` + 쿼리 조립(미지정 키 생략) · 응답 타입 `CategoryDeleteResult`(`api/types.ts`).
- [x] F-2 `components/DeleteCategoryModal.tsx` 신규(규약 G — 수치 요약 · 하위 포함 체크 · 문서 처리 라디오 · 루트면 재연결 미노출 · 옵션 0이면 단순 확인 · `submitting`/`errorMessage` 기존 관례).
- [x] F-3 `pages/Curriculum.tsx:201~220` · `CurriculumDetail.tsx:322~341` · `Explore.tsx:321~343` 3곳을 F-2로 교체(리터럴 3벌 삭제 · 폴백 문구 1곳) · Explore 선택 초기화를 삭제 트리 포함 판정으로 확장.
- [x] F-4 색·간격은 토큰·기존 유틸 클래스만(불변 규칙 5) · 390px에서 라디오·체크박스 줄바꿈 정상.

**V. 검증 (서버 구동 금지 — `2_StartServer.bat` 주인은 사용자 · 브라우저 실측은 사용자가 띄운 `localhost:8000`만)**
- [x] V-1 `backend/tests/test_category_delete.py` — ① 기본(파라미터 0) + 활성 문서 → 409 ② **비활성 문서 링크만 → 200 삭제(결함 ① 회귀)** ③ 하위 있음 + 비재귀 → 409 / `recursive=1` → 하위 전부 삭제·통계 ④ `unlink` → 링크 0·문서 `is_active` 무변·`study_progress` 삭제·`attempts.category_id` NULL ⑤ `reparent` → 부모 링크 존재·`sort_order`·`local_note` 보존·부모 기존 링크와 중복 시 `skipped_duplicates`·`study_progress` 이관·`attempts` 부모 ⑥ 루트 + `reparent` → 422 ⑦ 태그 규칙 존재 → 409(`tag_rule_ids`) · 부분 삭제 0 ⑧ `suggestions`·`resume_points` 행 정리(FK ON 픽스처에서 IntegrityError 0) ⑨ 잘못된 `on_documents` → 422. `run-tests.ps1 -Path backend/tests/test_category_delete.py` 통과(12 passed) → `-Full` 무회귀(636 passed).
- [ ] V-2 `invariant-scan.ps1` PASS · `npm run build` 성공(성공/실패만 · 엔트리 청크 수치 기록 — 신규 의존 0이라 R37 게이트 무관).
- [ ] V-3 브라우저 실측(사용자 기동 서버 · 노트 무접촉 · 실측용 분류는 새로 만들어 삭제 — 기존 데이터 무손실): ⓐ 하위 0·문서 0 분류 → 옵션 없는 단순 확인 → 삭제 ⓑ 문서 n건 분류 → 요약 수치 = 트리 `doc_count`와 일치 · 기본 라디오 "연결만 해제" → 삭제 후 탐색 "단일 문서" 필터에 노출 ⓒ 같은 조건에서 "부모로 재연결" → 부모 노드 `doc_count` 증가 · 문서 상세 `usages`에 부모 경로 ⓓ 하위 2단 + 문서 → 체크 없이 [삭제] 비활성 · 체크 후 삭제 → 트리에서 하위 전부 소멸 · Explore 선택 노드가 하위였으면 선택 해제 ⓔ 루트 분류 → 재연결 항목 미노출 ⓕ 태그 규칙 대상 분류 → 서버 409 메시지가 모달 안에 그대로 표시.

**D. 문서**
- [ ] D-1 설계 — api §4.1 18행 개정 + `[S50]` 절(편성 시 v1.61로 선반영 완료 · 완료 시 "구현 실측 확정" 표기 + 색인 v1.62) · screens §5.2·§5.4 S50 불릿(동일).
- [ ] D-2 별지 §13 FB-24 행 `← 완료(stage-50 · 날짜)` · backlog §1 FB-24 행 → §4 종결 이동 · FB-25 행 비고 "FB-24 선행" → "FB-24 완료(stage-50)"로 갱신 · `backlog-scan.ps1` PASS.
- [ ] D-3 매뉴얼 분류 삭제 단락(규약 I) · CHANGELOG 항목 · stage-index 50행 · 이 문서 §7 완료 기록.

## 4. 이 단계에서 하지 않는 것 (불변 규칙 9 — 이 절이 우선)

- **ⓒ 문서 동반 소프트 삭제**(`on_documents=delete` 류) — **D8-구현(휴지통·복구 UI) 이후**. 복구 경로 없는 연쇄 삭제 위험(별지 §13 FB-24 행 · backlog §1 `D8-구현` 행 비고). 이 stage의 `on_documents` 값은 `unlink`·`reparent` 2종으로 봉인 — 값 추가는 D8 뒤 별도 편성.
- **FB-25 탐색 다중 선택·일괄 도구**(배치 엔드포인트) — 별도 핵심 stage. 이 stage로 "FB-24 선행" 조건만 충족.
- **문서 물리 삭제·`is_active` 변경 0** — 분류 행만 물리 삭제(불변 규칙 3·4). 문서 상세의 [연결 해제] 단건 경로 무변.
- **태그 규칙 자동 삭제·재대상화 없음**(규약 E — 409 유지) · 규칙 관리 화면 무변.
- **`ConfirmDialog` 확장 없음**(옵션 슬롯 추가 금지 — 다른 8개 사용처 무변) · 새 라우트·설정 키·트리 API 필드(`deep_count` 류) 추가 없음(모달 수치는 클라이언트 합산).
- **`DELETE` 본문(JSON) 지원 없음**(쿼리만 — 규약 A) · 삭제 되돌리기(undo) 없음.
- 마스터 §14 M 행 · §15 R 행 추가 없음(DDL 0 · FK 참조 정리는 이 stage 안에서 종결 — 규약 E).

## 5. DoD (완료 정의)

**자동 검증(에이전트 수행):**
1. `run-tests.ps1 -Path backend/tests/test_category_delete.py` 통과(V-1 ①~⑨) + `-Full` 무회귀 · `invariant-scan.ps1` PASS.
2. `npm run build` 성공 · 백엔드 diff = `routers/categories.py`·`services/category_service.py`·`schemas/category.py`·테스트 1파일 안 · Alembic diff 0 · 신규 의존 0.
3. 프론트 3 페이지의 삭제 모달 리터럴 0(grep "하위 분류나 연결된 문서가 있으면" = 0건) · 공용 모달 1곳.
4. 브라우저 V-3 ⓐ~ⓕ 전건 통과(실측 데이터 원상 — 실측용 분류만 생성·삭제).
5. 문서 묶음 D 전건(Design v1.62 · 별지 FB-24 `← 완료` · backlog 종결 이동 + FB-25 비고 갱신 · 매뉴얼 단락 · CHANGELOG · stage-index).

**사용자 확인(게이트 본체):**
6. **실사용** — FB-24 원문 케이스(반입 단위 분류 · 문항 수십 건)를 "연결만 해제" 또는 "부모로 재연결"로 삭제해 봄 → 삭제됨 · 문서는 탐색에서 그대로 보임(단일 문서 또는 부모 분류) · 학습 진도·풀이 기록 이상 0 · **치명 결함 0 회신** = 발행 게이트.

**게이트**: 1~5 전건 + 6 치명 0 → 발행(§6 ① 판정). 치명 발견 시 발행 보류·수정 선행.

## 6. 완료 시 절차 (CHANGELOG 머리 규약 ⑤)

1. `docs/03-release/CHANGELOG.md` — **발행 단위 판단**: ⓐ stage-48·49(v2.01.3)가 이미 발행됐으면 **v2.01.4 항목 1개**(단독) ⓑ 아직 발행 대기면 **v2.01.3 항목에 stage-50 불릿 합류**("stage-48·49·50 한 발행 단위" · stage-49 §6 ① 전례 · 규약 ② 번호 재부여 없음) — 완료 시점의 stage-48·49 상태로 기계적으로 정하고 stage-index 세 행의 "산출 버전" 표기를 맞춘다. 불릿 = 결함 ①(소프트 삭제 문서 잔존 연결 409 · 모달 실수치) · 선택형 삭제(연결만 해제/부모로 재연결 · 하위 포함) · FK 참조 정리(진도·이어하기·풀이 기록 맥락·제안 · 태그 규칙 409) · 응답 200 통계.
2. 루트 `VERSION` = 발행 버전 — 사용자 회신(DoD 6) 후.
3. `stage-index.md` 50행 갱신(완료·일자·산출 버전).
4. `backlog.md` — §1 `FB-24` 행을 §4로 **종결 이동**(`종결(stage-50 · 날짜)`) · §1 `FB-25` 행 비고 "FB-24 선행" → "FB-24 완료(stage-50)" · 기준일 줄 갱신 · `scripts/backlog-scan.ps1` PASS 확인.
5. 출처 추기 — 별지 §13 FB-24 행 끝 `← 완료(stage-50 · 날짜)`(D-2).
6. 설계 — api §4.1 `[S50]` 절 "구현 실측 확정" 표기 + screens 2곳 · 색인 상태 줄 v1.62(최근 3건 규칙으로 밀리는 v1.58은 `docs/04-archive/design-changelog.md` 맨 위로 이동만).
7. 매뉴얼 단락(D-3) · `CLAUDE.md` 머리 버전 줄 1곳(발행 시 · 경위 전재 금지) · git tag(발행 버전 · release PR 별도 — stage-47 전례).

## 7. 완료 기록 (구현·검증·문서 경위 정본 — 착수 후 추기)

