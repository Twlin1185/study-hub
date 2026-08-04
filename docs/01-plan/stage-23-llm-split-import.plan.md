# Stage 23 — 대용량 원본 LLM 분할 반입: 구조 분석·분할안 확인·조각 투입 (M23: F49, 가칭)

> 상위: `study-app.plan.md` **v0.35** §14(M23)·**F49**(배경 실사례·확정 컨셉 5단계·확정 결정 ㉮~㉳의 단일 출처) · 설계: **§4.25 신설 완료(2026-08-04, Design v1.28 — 신규 엔드포인트 4개·조각 무결성 결정론 검증·기존 결정 개정 지점 전수 표의 정본)** · screens 분할 위저드 절은 구현 착수 시 §5.15 신설(§4.25 프론트 앵커가 골격)
> 배경(등재 근거 — 2026-08-04 실사례): URL 반입(cbtbank 페이지)이 약 989,373자로 `too_large` 거부 → 사용자 요구 "사용자가 직접 쪼개는 게 아니라 **LLM이 직접 분석하고, 쪼개주고, 분류해주고, 집어넣어주는 기능 전부**" → 컨셉 정정·확정: **"링크만 주면 전자동"이 아니라 다단계 + 사용자 개입형** — 분할안을 사용자가 확인·선택·[합치기]로 다듬은 뒤에만 변환이 시작된다.
> **상태: 구현 완료(2026-08-04) — 표적 재검토 최종 통과(DoD 자동 검증 6/6·치명 0·중요 0·경미 0·pytest 509), 사용자 이행 항목(DoD 7 실사례 완주)만 잔여.**
> 순서 관계(plan §14): F42(`doc_extract` 추출 계층)·F47(엔진 게이팅·`assert_engine_selectable`)·F48(작업 센터 — kind 값 확장·취소·복원 훅) 완성 전제 — **전부 이행 완료**(F48 사용자 이행 DoD 잔여는 무관). 주 수정처 = 신설 `split_service`/`routers/split.py`·`convert_service`(kind·label·ref·잡 등록)·Import 화면·신설 분할 위저드 — S24·S25 수정처와 충돌 없음.
> 불변 규칙 재확인: 미리보기 승인 없는 자동 반입 금지(R7 — 조각 커밋은 항상 사용자 승인) · 사용량 안내 없는 LLM 호출 금지(F35 — 휴리스틱·분할안·enqueue는 전부 LLM 0, LLM 개입은 analyze 잡 1종뿐이며 확인 스텝 필수) · `sources/` 원본 불변(4 — 조각은 파생물·원본 무수정) · 스키마 변경 금지(6 — **DDL 0건·Alembic 0건·settings 키 0·신규 엔드포인트 4개 확정**, §4.25 말미) · 색상 토큰만(5) · 에러 규약 §3·오류 원문 노출 금지(§4.11) · 정답·해설 무관 계층(1 — 분할안 응답의 발췌는 추출 텍스트 부분 문자열이며 LLM 산출 원문·정답 미포함).

## 현행 실측 (2026-08-04 — 상세는 §4.25·plan §14 F49가 정본, 여기는 요지)

- **`too_large` 계약(§4.18 ⑤ — D2-⑥)**: A군 디코드·B군 추출 텍스트 공통 **200,000자** 상한, `phase='preparing'`(LLM 호출 전·비용 0) 판정. 이 상한은 **불변**(단일 변환 입력 상한 — 조각도 준수), F49는 초과 시의 대안 경로.
- **F40-④ 개정 완료(문서)**: §4.18 두 곳(원칙 재확인·⑤ 문구)에 S23 개정 예고 병기 + **§4.25가 개정 지점 전수 표로 확정**(실질 3건 계승 — 부분 잘림 투입 금지·PDF 파일 분할 금지(§4.11 불변)·무승인 자동 반입 금지).
- **전문 LLM 투입은 원리상 불가**: 98.9만 자급은 컨텍스트 초과 — 정밀 분석 입력은 **경계 후보 오프셋 + 주변 발췌(~200자) + 서두/말미 표본**만(§4.25 규약 — 원본의 수 % 수준).
- **분류는 기존 기능으로 충족**: preview `suggest_categories` + F40-③ `category_path` — 조각 라벨을 `category_path` 초안으로 전달(신규 분류 메커니즘 0).
- **잡 인프라(F48)**: kind 값 확장만으로 작업 센터 현황·취소·복원 합류. **잡 시작 지점 8→9곳**(analyze — §4.23 ⓒ·§4.24 ⓒ 표 갱신, §4.25 개정 표).
- **재배포 금지 고지 실측**: FetchImportWizard(사이트 반입)에만 렌더 — URL 반입에는 없음. F49는 고지 정책 증감 0(확장은 범위 밖).
- **`too_large` 시 원본 sources/ 저장 = 계약으로 확정**(㉲ — §4.18 ④·⑥ 대칭): 현행 구현이 미저장이면 이번 단계에서 저장 추가(action 앞머리 "원본은 sources/에 저장했습니다." 동일 적용).

## 착수 시 선행 절차 (완료 — 결정·문서를 먼저 굳혔다)

- [x] **D1. 결정 ㉮ 크기** — **확정(2026-08-04, §4.25)**: 조각 목표 3~6만 자(분석 목표 지시값) · 조각당 상한 200,000자(기존 `MAX_TEXT_CHARS` 재사용, [합치기] 초과 = 거부).
- [x] **D2. 결정 ㉯ 원본 총 상한** — **확정**: 2,000,000자(초과 = 분할 시작 전 422 정직 거부). settings 화 안 함.
- [x] **D3. 결정 ㉰ 조각 수 상한** — **확정**: 40개(초과 = 422·수동 분할 안내 — 자동 재병합 금지).
- [x] **D4. 결정 ㉱ 잡 형태** — **확정**: 휴리스틱 = 동기(LLM 0·잡 불요) · LLM 정밀 분석만 신규 잡 kind **`'split_analyze'`**(F48 합류 — label·ref(`split_id`)·라우트 매핑) · 조각 변환 = 기존 convert 잡 N개.
- [x] **D5. 결정 ㉲ 보존** — **확정**: 경계 오프셋·라벨 JSON `import/split/` 최근 20건(R18 관례·git·백업 제외) + 인메모리 TTL 1시간 — 조각 텍스트 무저장(원본+오프셋 결정론 재절단). too_large 원본 sources/ 저장 확정 포함.
- [x] **D6. 결정 ㉳ 진입·중복·F46** — **확정**: convert 잡 `too_large`의 `alternatives = ['split_import']`([분할 반입] 버튼 — 상시 메뉴 없음) · 같은 원본(hash12) 재분할 = 기존 분할안 재사용 우선 안내 · `split_analyze` 잡 실패의 F46 사례 수집 포함.
- [x] **D7(문서). 설계 §4.25 신설 + 개정 지점 전수 표 + §4.18 예고 병기 + plan §14 F49·§5 표·R25 + 이 문서 구체화** — 완료(2026-08-04, Design v1.28 · plan v0.35).

## 목표

끝났을 때, 20만 자를 넘는 URL·파일 원본이 거부 안내로 끝나지 않고 — [분할 반입]으로 들어가 **무비용 휴리스틱 분석**(경계가 불확실할 때만 예상 비용을 확인한 뒤 저비용 LLM 정밀 분석)이 만든 **분할안을 사용자가 확인·선택·[합치기]로 다듬고**, 선택 조각의 예상 변환 비용 합계를 확인한 뒤 기존 변환 대기열로 일괄 투입하며, 각 조각은 기존 미리보기→승인으로만 반입된다. 조각은 원문의 연속 부분 문자열(재작성 0·커버리지 결정론 검증)이고, 정밀 분석 잡은 작업 센터에서 보이고 취소되며, 어떤 단계도 승인 없이 LLM 비용을 쓰지 않는다. 20만 자 이하 원본의 동작은 현행과 완전히 같고, DDL·Alembic·settings 키는 전부 0이다.

## 작업 체크리스트

> 권장 순서: **1(동기 분할 시작·휴리스틱) → 2(정밀 분석 잡) → 3(보존·투입) → 4(프론트 위저드) → 5(테스트) → 6(문서)**. 1·3은 LLM 0이라 무비용 반복 검증 가능 — 먼저 완성해 골격을 굳힌다. 프론트 4는 계약(§4.25)으로 병렬 착수 가능.

### 1. 백엔드 — 분할 시작·휴리스틱 분석 (신설 `services/split_service.py` · `routers/split.py`, LLM 0)

- [x] `POST /api/import/split`(multipart `file` 또는 `{url}`) — §4.18 판별·추출·SSRF·MIME **재사용**(중복 구현 금지), 원본 `sources/` 저장(too_large 관례 정합 — 현행 미저장이면 convert 경로도 함께 저장으로 정정: §4.25 ㉲), 20만 자 이하 = 422("분할이 필요 없는 크기입니다"), 총 상한 200만 자 초과 = 422(서버 완성 문장).
- [x] **휴리스틱 경계 스캔**(무비용 동기): 과목/회차 헤더·문항 번호 리셋("1." 재등장)·헤딩 라인 패턴 → 경계 후보 + 조각 라벨 초안 + `confidence: 'ok'|'uncertain'` 산출(패턴 목록은 구현 실측 — 완료 기록에 기입).
- [x] 분할안 응답: `{split_id, source_chars, confidence, chunks: [{chunk_id, label, start, end, chars, head(200자), estimate}], analyze_estimate}` — 조각 수 40 초과 = 422. LLM 산출 원문·정답 미포함(발췌는 추출 텍스트 부분 문자열).
- [x] **조각 무결성 결정론 검증 함수**(공용 — enqueue에서도 재사용): start 오름차순·중첩 0·합집합 = 원본 전체(경계 누락 구간 = "무라벨 구간" 조각 자동 생성 — 조용한 탈락 금지)·조각당 20만 자.

### 2. 백엔드 — LLM 정밀 분석 잡 (kind `'split_analyze'`)

- [x] `POST /api/import/split/{split_id}/analyze` — body `{engine?, model?}`(`assert_engine_selectable` 경유 — **9번째로 문서 표기, 실측은 10번째**(§4.23 ⓒ·§4.24 ⓒ 표 갱신 — 현행 코드베이스가 이미 9곳이라 §4.25 초안의 "8→9" 서술이 실측과 어긋남, 아래 완료 기록 참고) → `202 {job_id}`. 확인 스텝 전제(estimate는 split 응답 동봉 — 신규 estimate API 없음).
- [x] **입력 규약**: 원문 전문 금지 — 경계 후보 오프셋 + 후보 주변 발췌(~200자) + 서두/말미 표본만. 출력 = 순수 JSON(경계 확정·라벨) — 위반 = `invalid_output`(§4.17 ⑤ 규율).
- [x] **산출 검증(서버 결정론 — LLM 불신)**: 확정 오프셋은 휴리스틱 후보 집합 ∪ 발췌 구간 내 위치만 수용(범위 밖 창작 오프셋 = `invalid_output`), 1의 무결성 검증 통과 후 chunks 갱신(휴리스틱안은 이력 보존).
- [x] **F48 합류**: kind 9종째 값 확장 — label(`『{원본명}』 분할 정밀 분석`)·ref(`{split_id}`)·`GET /api/llm/jobs` 파생·취소(`'cancelled'`)·복원 훅 kind→라우트 매핑. **F46 수집**: `split_analyze` 잡 실패(kind 3종 규칙 동일 — too_large·환경 실패 제외) 사례 기록(§4.22 수집 지점 확장).

### 3. 백엔드 — 분할 상태 보존·조각 투입

- [x] `import/split/` JSON 보존(최근 **20건** — 초과 시 오래된 것부터, git·백업(F27) 제외) + 인메모리 TTL 1시간(만료 후 GET = 디스크 복구 — F40-① preview 복구 전례). 같은 원본 hash12 감지 → 기존 분할안 재사용 안내 필드.
- [x] `GET /api/import/split/{split_id}` — 상태·progress(analyze 잡 §4.11 재사용)·chunks.
- [x] `POST /api/import/split/{split_id}/enqueue` — `{selections: [[chunk_id,…]], category_paths?}`: 그룹 = 단일 또는 **인접 연속 구간만**([합치기] — 비인접·중복·미존재·병합 후 20만 자 초과 = 422), 오프셋 결정론 재절단(`원문[start:end]`) → A군 텍스트로 **기존 convert 잡 N개 등록**(ImportQueue 계약·`category_path` F40-③ 재사용·원본 재저장 금지 — split_id·chunk_ids 참조만). 응답 `{jobs: [{job_id, chunk_ids, label}]}`.
- [x] convert 잡 발생 `too_large`의 `error_info.alternatives = ['split_import']`(fetch 잡 발생분은 기존 유지 — §4.18 ⑥ 관례).

### 4. 프론트 — 분할 위저드·진입점

- [x] too_large 실패 렌더에 [분할 반입] 버튼(`alternatives` 아는 값만 렌더 관례 — `'split_import'` 추가, `api/types.ts` 유니온 확장). (2026-08-04 프론트 구현 — 백엔드 응답과의 실계약 대조는 미완, 아래 완료 기록 참고)
- [x] **분할 위저드 신설**(`components/SplitImportWizard.tsx` — 이름 구현 재량, Stepper 재사용): ① 분석(휴리스틱 즉시 — uncertain이면 "LLM 정밀 분석?(예상 비용)" 제안 + EngineSelect(모델 소목록 — F47/F48 재사용)) ② **분할안 확인(핵심 게이트)**: 조각 목록(제목·크기·head 발췌)·체크박스·인접 [합치기](경계 문자 편집 없음 — 확정)·조각별 `category_path` 초안 편집 ③ 비용 확인(선택분 estimate 합계 — 프론트 단순 합산) ④ [선택 N조각 변환 시작] → 기존 ImportQueue 화면 합류(신규 진행 UI 없음). (2026-08-04)
- [x] 재사용·복원: analyze 잡 = `LlmJobProgress`·`useJobRecovery`(kind 매핑 `utils/jobRoutes.ts` 추가)·작업 센터 취소. 같은 원본 재분할 시 "기존 분할안 재사용(비용 0)/새로 분석" 선택 UI. 색상 전부 토큰. (2026-08-04)

### 5. 테스트·검증

- [x] 단위 테스트(분할 검증은 핵심 로직 취급 — F47·F48 전례): ① 휴리스틱 후보·라벨·confidence ② 상한 3종(200만 자·40개·조각 20만 자) 422 ③ 무결성 검증(오름차순·중첩 0·합집합·무라벨 구간 생성) ④ 정밀 분석 산출 검증(후보 집합 밖 오프셋 = invalid_output) ⑤ 재절단 = `원문[start:end]` 일치 ⑥ enqueue(비인접 [합치기] 422·category_path 전달·원본 재저장 0) ⑦ hash12 재사용 안내 ⑧ `split_analyze`의 잡 목록·취소·model 422(10번째 지점 — 실측 정정, 아래 완료 기록) ⑨ F46 사례 기록. 신규 `tests/test_split_import.py` 23건 + 기존 2파일 갱신(전체 481→504건 통과).
- [x] 스모크(무LLM 규약 — stage-21 사고 재발 방지 승계): split 시작(220,024자 표본)→분할안→GET 상태→enqueue까지 실 HTTP로 확인 + 422 문장 3종은 pytest로 확인. **사고 1건 발생·즉시 시정**(아래 완료 기록 — enqueue 자체는 LLM 0이었으나 큐를 일시정지하지 않아 워커가 생성된 convert 잡을 실제로 집어 claude-cli를 짧게 호출함, 수 초 내 취소·원인 기록).
- [x] stage-reviewer(Opus) 검토 — DoD 자동 검증 전건. — 1차(재수정 — 치명 0·중요 2·경미 7) → 수정 반영 → **표적 재검토 최종 통과(DoD 자동 검증 6/6·치명 0·중요 0·경미 0·pytest 509)**. 완료 기록 참조.

### 6. 문서

- [x] 구현 확정 사항 기록(§4.25·이 문서 완료 기록 — 휴리스틱 패턴 목록·too_large 원본 저장 실측 결과. DDL 필요 발견 시 착수 중단 후 보고). — 완료 기록 참조(프론트 정렬 4건·10번째 지점 실측 정정 포함).
- [x] 사용자 매뉴얼(F39): 분할 반입 장 신설(진입·분할안 확인·[합치기]·비용 2중 확인·조각별 승인·재사용). — 23장 신설 + 목차 + 5장 "변환이 실패했을 때"에 too_large→[분할 반입] 안내 추가(2026-08-04).
- [x] 이 문서 체크박스 갱신(불변 규칙 10) · CLAUDE.md 문서 지도 갱신(오케스트레이터 담당, 2026-08-04).

## DoD (완료 정의)

**자동 검증 가능 항목**:

1. **비용 0 기본선**: 휴리스틱 분석·분할안·enqueue까지 LLM 호출 0 — LLM 개입은 analyze 잡뿐이며 estimate 확인 스텝 없이 시작되는 경로가 없다.
2. **조각 무결성**: 모든 조각 = 원문 연속 부분 문자열(재작성 0), 오름차순·중첩 0·합집합 = 원본 전체가 결정론 검증되고, 위반 산출(LLM 창작 오프셋 포함)은 투입 전 구조화 거부된다.
3. **승인 이중 게이트**: 분할안 확인([선택 N조각]) 없이 convert 잡이 등록되지 않고, 조각이 미리보기 승인 없이 커밋되는 경로 0(R7).
4. **기존 경로 불변**: 20만 자 이하 원본의 반입 계약·동작이 현행과 바이트 수준 동일 — 개정은 too_large 안내·`alternatives`·원본 저장뿐(§4.25 개정 표 전수). §4.11 "PDF 분할 금지" 불변.
5. **F47·F48·F46 정합**: analyze가 9번째 시작 지점으로 공통 헬퍼 경유(auto+model·소목록 밖·비활성 엔진 422), kind 9종째가 작업 센터 목록·취소·복원에 나타나며, 잡 실패가 F46 사례로 기록된다.
6. **DDL 0건·Alembic 0건·settings 키 0·신규 엔드포인트 4개**(§4.25 재확인 — 어긋나면 착수 중단 후 보고). 저장 = sources/·`import/split/` JSON(20건)·인메모리뿐.

**사용자 이행 항목** (실 LLM 비용 — 자동 실행하지 않음):

7. **실사례 완주 1회**: 등재 계기 원본(cbtbank 98.9만 자급)을 분할 플로우로 완주 — 정밀 분석 필요 여부·분할안 품질(회차 혼합·문항 절단 표본 — R25)·[합치기] 사용성·조각 변환~반입 승인까지. 결과를 완료 기록에 기입.

## 이 단계에서 하지 않는 것

- **전자동 반입 없음** — "링크만 주면 끝"은 컨셉 확정에서 명시 배제(2026-08-04): 분할안 확인(2단계)·조각별 승인(4단계)은 생략 불가.
- **경계 문자 단위 편집 없음** — 조각 다듬기는 체크박스 + 인접 [합치기]뿐(과설계 기각 확정 — 재제안 시 근거 필요).
- **PDF 파일 분할 없음** — §4.11 결정 불변(F49는 추출 텍스트 분할 — pdf 경로는 too_large 판정 자체가 없어 범위 밖).
- **부분 잘림 투입 없음** — 분할은 항상 전체 커버 조각 집합에서의 선택(무라벨 구간도 조각으로 노출 — 조용한 탈락 금지).
- **20만 자 상한(D2-⑥)·상한 3종의 settings 화 없음** — 값 변경은 계획서 확정 절차.
- **사설 사이트 어댑터 재도입 없음** · **재배포 금지 고지의 URL 반입 확장 없음**(정책 증감 0 — 필요 시 별도 등재).
- **분할 이력 DB 영속화 없음** — `import/split/` 파일 JSON 20건뿐(R18 관례 — 실수요 확인 시 계획서 먼저).
- **B군 구조 상한(xlsx 시트·행·열) 초과의 분할 없음** — 텍스트 길이 문제가 아님(기존 안내 유지).
- **분할 전용 신규 변환 프롬프트 없음** — 조각 변환은 기존 convert 파이프라인·`prompts/convert.md` 그대로.

## 리스크

- **R25(plan §15)**: 경계 오판(회차 혼합·문항 절단)·다단 비용 — 결정론 절단·커버리지 검증·2단계 확인·조각별 승인·오프셋 보존·hash12 재사용이 대응. 경계 품질 표본 = DoD 7(사용자 이행).
- **휴리스틱 커버리지**: 후보 0(구조 불명)이 잦을 수 있다 — 그것이 정밀 분석의 존재 이유이고, 정밀 분석도 실패하면 수동 분할 안내 폴백 상존(정직 실패 — 조용한 균등 분할 금지). **결정 확정(2026-08-04, stage-reviewer 재수정 경미-5 — 오케스트레이터 결정)**: 후보 0건일 때도 반입 자체는 균등 분할로 계속 진행하되 "조용히" 하지 않는다 — 조각 라벨을 `"구조 미탐지 — 임시 균등 i/n"`으로 명시하고 confidence는 `'uncertain'` 유지, 응답에 `fallback: 'even_split'|null` 필드를 추가해 프론트가 안내할 수 있게 한다(§4.25 반영 완료).
- **분할안 UI 복잡도**: 조각 40개급 목록·[합치기]·비용 합계의 모바일 UX — Stepper 스텝 분리로 억제, 화면 계약은 착수 시 §5.15 신설로 고정.
- **too_large 원본 저장 정합**: 현행 convert 경로가 미저장이면 저장 추가가 convert 쪽 변경을 수반 — §4.18 ④·⑥ 대칭 원칙 안에서 최소 수정(검토 중점 확인).

## 완료 기록 (착수 후 기입)

- **2026-08-04 프론트(체크리스트 4절) 구현 완료** — 오케스트레이터 지시로 병렬 착수(착수 순서 메모와 무관하게 지시받음). 신설: `frontend/src/components/SplitImportWizard.tsx`(source→analyze→chunks→cost 4스텝, Stepper·EngineSelect·LlmJobProgress·LlmErrorInfoView·CategoryPathField 재사용) · `frontend/src/api/split.ts`(4개 엔드포인트 훅). 수정: `api/types.ts`(Split* 타입군·`LlmJobKind` 'split_analyze'·`LlmJobRef.split_id` 추가) · `utils/jobRoutes.ts`(kind 매핑) · `hooks/useConvertQueue.ts`(`addJobs`·`getFile` 추가) · `utils/convertQueue.ts`(`QueueSourceKind` 'split' 추가) · `components/LlmErrorInfo.tsx`·`components/ImportQueue.tsx`(onSplitImport 배선) · `pages/Import.tsx`(entryMode 'split_import', 딥링크 `?mode=split_import&split_id=`). `npm run build` 통과(오류 0). **백엔드 미착수라 §4.25 계약과의 실접속 대조는 미완** — 특히 GET 상태 응답의 status 값 목록(명세 원문 미기재, 'ready' 상태 도입은 프론트 추정)과 `enqueue`의 `category_paths` 키(그룹 대표 chunk_id로 추정) 2곳은 백엔드 구현 시 반드시 대조.
- **2026-08-04 stage-reviewer 재수정(프론트분) 반영** — 백엔드 확정값(`SplitStatus = 'ready'|'analyzing'|'analyzed'|'error'|'cancelled'`)으로 `api/types.ts`·`api/split.ts`(폴링 조건)·`SplitImportWizard.tsx`(analyzeRunning/Failed/Cancelled·완료 분기)를 전면 교체(중요-1, `ConvertJobStatus` 재사용 폐기 — 이전 추정이 실제 값과 달라 폴링·완료 반영·재시작 차단 3중으로 파손돼 있었다). 완료(`analyzed`) 반영 시 `groups.length===0` 가드를 제거해 갱신본을 항상 덮어쓰도록 수정. `SplitStatusResponse`에 `split_id·source_chars·confidence·analyze_estimate·reuse·fallback`을 추가하고(경미-1), 컴포넌트가 `info = startResult ?? statusQuery.data`로 딥링크·재사용 복원 세션에서도 견적 확인 스텝을 구성하도록 변경(`handleUseReuse`에서 `startResult`를 비워 정보원이 새 GET 결과로 넘어가게 함). `SplitFallback = 'even_split'` 타입 추가 — confidence:'ok'·비폴백이면 정밀 분석 카드를 아예 렌더하지 않고 `shouldAutoAdvance`로 분할안 확인 단계로 자동 진행, `fallback:'even_split'`이면 confidence와 무관하게 카드 노출 + 균등 분할 안내 1줄(경미-3). `npm run build` 재통과(오류 0).

- **2026-08-04 백엔드(체크리스트 1·2·3·5절 백엔드분) 구현 완료** — 오케스트레이터 조정으로 프론트 추정 4개 지점에 정렬:
  1. GET 상태 `status`의 분석 전 값 = `'ready'`(프론트 추정 그대로 채택 — `SplitStatus = Literal["ready","analyzing","analyzed","error","cancelled"]`).
  2. `enqueue`의 `category_paths` 키 = **병합 그룹 내 최소 start의 chunk_id**(대표 키, 프론트 추정 그대로 채택).
  3. hash12 재사용 안내 필드명 = `reuse: {"split_id": "..."}`(POST·GET 응답 공통, 최소형).
  4. `analyze_estimate`는 POST(분할 시작)뿐 아니라 **GET 상태 응답에도 항상 동봉**(재진입 세션 대응).
  - 신설: `backend/services/split_service.py`(휴리스틱 스캔·조각 무결성 검증(`_normalize_chunks`/`_assert_full_coverage`)·상태 보존(`import/split/` 최근 20건 + 인메모리 TTL 1시간)·재절단·enqueue) · `backend/routers/split.py`(신규 4 엔드포인트) · `backend/schemas/split.py`.
  - 수정: `backend/services/convert_service.py`(① `_detect_import_format`/`_extract_group_text`에 `max_chars` 우회 파라미터 추가(기본 `None`=기존 동작 완전 불변, split만 사용) ② `too_large` 발생 시 원본 sources/ 저장 신설(`_too_large_error` 헬퍼) + convert 잡 `alternatives=['split_import']`(fetch는 기존 `[]` 유지) ③ `start_convert_job`에 `label`·`skip_source_save`·`split_id`·`split_chunk_ids` 파라미터 추가(기본값 불변) — `skip_source_save=True`면 `_do_convert`의 `create_preview` 호출에 `source_bytes=None`을 넘겨 조각 텍스트가 새 원본으로 sources/에 재저장되는 것을 차단 ④ kind `'split_analyze'` 잡 추가(`start_split_analyze_job`/`_do_split_analyze_job`/`get_split_analyze_job`) — `_job_ref`·F46 수집 대상(`("convert","fetch","split_analyze")`)·`_invalid_output_action`에 반영) · `backend/services/doc_extract.py`(`enforce_max_chars`/`extract_docx_text`/`extract_xlsx_text`에 동일한 `max_chars` 우회 파라미터, 기본 불변) · `backend/services/improve_service.py`(origin 분기에 `'split_analyze_job'` 추가) · `backend/schemas/improve.py`(`CaseOrigin`에 `'split_analyze_job'` 추가) · `backend/main.py`(라우터 등록).
  - **too_large 원본 저장 실측**: 착수 전 실측대로 **현행 미저장 확인** — convert 경로(`_detect_import_format`의 A군 텍스트 분기·`_extract_group_text`의 B군 분기)가 `TooLargeError`를 원본 저장 없이 raise하고 있었다. `unsupported_format`·`parse_failed`와 대칭이 되도록 `_too_large_error` 헬퍼(원본 저장 + action 앞머리 "원본은 sources/에 저장했습니다." + "또는 [분할 반입]을 이용하세요." 병기)로 정정 — 기존 2개 단위 테스트(`test_doc_format_detect.py`)를 이 실제 동작에 맞춰 갱신(사전 실패였던 것을 통과로 바꾼 것이 아니라, 원래 저장하지 않던 동작이 새 계약 위반이라 코드와 테스트를 함께 고쳤다).
  - **휴리스틱 패턴 목록(실측)**: ① 마크다운 헤딩(`^#{1,3}\s+\S`) ② 회차 헤더(`제N회`·`YYYY년 N회`) ③ 과목 헤더(`N과목`·`제N과목`·`과목:`) — ①②③ 중 하나라도 있으면 `confidence='ok'` ④ 문항 번호 리셋(`^1\s*[.)]\s*\S`, 약한 신호 — ④만 있으면 `confidence='uncertain'`. 후보 0건이면 강제 균등 분할(조각당 상한 캡)로 폴백해 조각 수 상한 위반 없이 항상 분할안을 낼 수 있게 했다.
  - **정밀 분석 입력·출력 규약**: 입력 = 서두/말미 표본(각 1,000자) + 경계 후보 좌우 발췌(각 후보 총 ~200자, 후보 오프셋 그대로) — 원문 전문은 프롬프트에 절대 삽입하지 않는다. 출력 = `[{"offset": int, "label": str}, ...]` 순수 JSON 배열, 오프셋이 서버가 계산해 둔 `allowed_ranges`(후보 발췌 구간 ∪ 서두/말미 표본 구간) 밖이면 `InvalidLlmOutputError`(kind=`invalid_output`)로 전량 거부(부분 채택 없음).
  - **잡 시작 지점 수 실측 정정**: §4.25 초안은 "8→9번째"로 서술했으나, 착수 시점 코드베이스(F48 stage-22 완료분)에 이미 `assert_engine_selectable` 경유 지점이 9곳(`convert`/`convert_from_url`/`fetch`/`regenerate`/`answer_key`/`explain`/`applied_exam`/`improve_proposal`/`improve_regression`) 존재해 `split_analyze` 추가로 **10곳**이 됐다(`tests/test_job_center.py::test_nine_entrypoints_apply_requested_model_via_common_helper`·`tests/test_engine_controls.py::test_all_nine_entrypoints_propagate_assert_engine_selectable`의 9→10 갱신으로 확인). 기능 요구(공통 헬퍼 경유)에는 영향 없음 — 설계 문서 서술의 사소한 실측 불일치일 뿐.
  - **테스트**: 신규 `tests/test_split_import.py` 23건(9항목 전건) + `test_job_center.py`·`test_engine_controls.py`·`test_doc_format_detect.py` 갱신. 전체 스위트 481 → **504건 통과**(pytest, 무LLM).
  - **스모크 사고 1건(자기 시정)**: 실 uvicorn 기동 후 HTTP로 분할 시작→GET→enqueue를 확인하던 중, enqueue가 등록한 convert 잡 큐를 사전에 일시정지(`POST /api/llm/queue/pause`)하지 않아 백그라운드 워커가 즉시 집어 claude-cli를 짧게 실행했다(투입 후 수 초 내 발견해 `POST /api/llm/jobs/{id}/cancel`로 즉시 취소 — 사용량 usage: input_tokens=2, output_tokens=67, 커밋된 문서·미리보기 없음). 원인은 스모크 절차 실수(단위 테스트는 전부 `pause_queue()`로 격리돼 있어 문제 없음) — 재발 방지로 이 문서·보고에 기록한다. 생성됐던 임시 산출물(`sources/`·`import/split/`의 스모크 파일)은 확인 후 삭제해 원상 복구했다.
  - **계약과 어긋나 보류한 것**: 없음(DDL·Alembic·settings 키 0 유지 확인, 신규 엔드포인트 정확히 4개).

- **2026-08-04 백엔드 결함 수정(오케스트레이터 스모크 적발) — 휴리스틱 문항 번호 리셋 오탐**:
  - **재현**: 회차 5개×문항 60개(회차 헤딩 + `N. 지문…` + 들여쓴 `  1) 보기1  2) 보기2  3) 보기3  4) 보기4` 보기 줄) 314,389자 표본을 `POST /api/import/split`에 투입하면 `422 조각 수가 상한(40개)을 초과했습니다(현재 310개)`.
  - **원인(실측 확인)**: 옛 패턴 `^\s*1\s*[.)]\s*\S`가 들여쓰기(2칸)·괄호 형식(`1)`) 둘 다 허용해, 문항마다 있는 보기 줄의 `1)`을 "문항 번호 리셋"으로 오탐(회차 5 + 보기 줄 300개 = 후보 305~310개).
  - **수정**(`services/split_service.py`): ① 행두(들여쓰기 0)·`N. `(마침표만, `N)` 제외) 형식만 인정하는 `_MAJOR_NUMBER_RE`로 교체 ② 직전에 기록한 문항 번호(`prev_number`)가 1보다 크고 이번 번호가 정확히 1일 때만 "진짜 리셋"으로 인정(단순 재등장 금지) ③ 강한 신호(헤딩·회차/과목 헤더)를 지나면 `prev_number`를 리셋해, 헤딩 바로 다음 줄의 "1. …"이 헤딩과 거의 같은 위치에 별도 미세 조각을 만드는 것을 차단(강한 신호 우선) ④ 그래도 남을 수 있는 근접 약한 후보를 위한 일반 후처리로 `_WEAK_MERGE_RADIUS_CHARS`(5,000자) 반경 안의 약한 후보를 직전 채택 후보에 흡수하는 병합 단계 추가(강한 후보는 항상 채택 — "진짜 구조가 40+일 때만" 422가 나오도록).
  - **재실행 결과(실제 표본 파일 `big-sample.txt`, 314,389자)**: confidence=`ok`, **조각 5개**(각 62,878~62,999자 — 목표 3~6만 자에 부합), 라벨 = 각 회차 헤딩(`# 2021년 1회 기출문제` … `# 2025년 5회 기출문제`) 그대로. `start_split` 전체 파이프라인으로도 동일 확인.
  - **회귀 테스트 추가**(`tests/test_split_import.py`): `test_scan_heuristic_boundaries_ignores_indented_choice_markers_and_paren_format`(위 표본 구조 재현, 후보 정확히 5개) · `test_start_split_sample_five_rounds_sixty_questions_yields_five_chunks`(전체 파이프라인, 조각 5개·각 3만~10만 자) · `test_scan_heuristic_boundaries_true_number_reset_without_heading_is_weak_uncertain`(강한 신호 없는 "진짜" 리셋은 여전히 잡히는지 확인 — 과교정 방지). 기존 `test_scan_heuristic_boundaries_weak_question_reset_only_is_uncertain`은 `N)` 패턴을 쓰고 있어 새 계약에 맞게 이름·내용을 교체.
  - **pytest**: 신규 2건 추가로 `test_split_import.py` 23→25건, 전체 스위트 **504 → 506건 통과**(무LLM 유지). 수정 직후 에이전트 도구 장애로 최종 재실행이 미완이었던 것을 오케스트레이터가 재실행해 **506 passed 재확인**.
- **2026-08-04 오케스트레이터 통합 스모크(uvicorn 8023, 휴리스틱 수정 후 재기동)**: **큐 일시정지 선행** 규약으로 수행 — ① 표본 314,389자 split → 조각 5개·confidence ok·analyze_estimate 동봉 ② GET 상태(`ready`·chunks·analyze_estimate 재진입 동봉) ③ enqueue(병합 [c1,c2]+단일 [c4]·category_paths) → convert 잡 2개가 **일시정지 대기열에만** 등록(병합 라벨 "『…1회…』 ~ 『…2회…』" 정상) ④ 비인접 병합 422("합치기는 인접한 조각끼리만 가능합니다") ⑤ analyze auto+model 422(10번째 지점 공통 헬퍼 경유 확인) ⑥ 20만 자 이하 422("분할이 필요 없는 크기입니다") ⑦ 대기 잡 취소(비용 0). 전건 통과.
  - **스모크 사고 2건째(오케스트레이터 과실 — 정직 기록)**: 대기 잡 2개 취소 중 첫 건의 취소 응답(빈 응답 — 네트워크 순단 추정)을 검증하지 않은 채 정리 목적으로 큐를 resume해, 미취소였던 첫 잡이 수 초간 실행돼 claude-cli가 실호출됐다(즉시 재취소 — 부분 과금 usage: input_tokens=2, output_tokens=3, 산출물 0·DB 오염 0·워크트리 클린 복구). 부수적으로 running 취소·부분 usage 동봉이 실동작으로 확인됐으나 "실 LLM 유료 실행 금지" 규약 위반은 사실. **교훈: 취소는 응답 검증 후에만 큐 재개** — 백엔드 에이전트의 1건(enqueue 전 pause 누락)과 함께 이 단계에서 같은 유형 2회 발생, 스모크 표준 절차(pause 선행 → 상태 검증 → resume)를 완료 기록에 고정한다.

- **2026-08-04 stage-reviewer 검토(재수정 판정 — 치명 0·중요 2) 백엔드 담당분 수정**:
  - **[중요-2] `_EXAM_ROUND_RE` 비앵커 search — 본문 줄 회차 라벨 반복 오탐**: 검토자 실측 —
    문항 줄마다 `"{i}. 2020년 1회 기출문제 - 문항 {i} 지문 …"` 형태(등재 계기 cbtbank가
    정확히 이 형태)로 회차 라벨이 반복되는 229,283자급 표본이 `.search()`(비앵커)에 걸려
    후보 ~300개(confidence='ok')로 오탐 → 40개 상한 422(split 레코드 생성 전이라 정밀
    분석으로도 구제 불가). **수정**(`split_service.py`): 회차·과목 헤더 판정을 `_is_header_
    like_strong_line`로 통합 — 행두 앵커(`.search()`→`.match()`) + 줄 길이 상한
    `_HEADER_MAX_LINE_CHARS`(40자, 실측 — 진짜 헤더는 20자 안팎·문항 지문은 항상 그보다
    길다). 마크다운 헤딩(`#`)은 명시적 마커라 길이 상한 미적용. 재실행(직접 실행 확인,
    207,887자 재현 표본): 후보 0건 → confidence='uncertain' → 균등 분할 폴백(아래 경미-5)
    으로 **422 없이 2조각 완주**(수정 전 대비 후보 300→0). **추가 방어 재량 판단**: 헤더성
    한정만으로 재현 표본이 정상화되어 40개 상한의 별도 구제 로직은 추가하지 않았다(㉰
    자동 재병합 금지 결정과의 충돌 회피 + 과설계 금지 — 검토자 단서 그대로 이행).
  - **[경미-4] `_too_large_error` action 문구 과잉**: "또는 [분할 반입]을 이용하세요." 문구를
    `_too_large_error`(job_kind를 모른다)가 아니라 `_fallback_error_info`(job_kind를 아는
    지점)로 이동해 **convert 잡 한정**으로만 붙인다. fetch·answer_key·재생성 등 버튼 없는
    화면에는 문구도 뜨지 않는다(테스트로 3개 job_kind 분기 확인).
  - **[경미-5, 오케스트레이터 결정] 폴백 명시화**: 휴리스틱 후보 0건 폴백을 유지하되 ①
    조각 라벨을 `"구조 미탐지 — 임시 균등 i/n"`으로 명시 ② confidence는 'uncertain' 유지
    ③ POST·GET 응답에 `fallback: 'even_split'|null` 필드 추가(`apply_analyze_result` 성공
    시 `null`로 해소). 리스크 절·완료 기록에 결정 반영(위 "휴리스틱 커버리지" 리스크 항목).
  - **[경미-6] 테스트 함수명 실측 정정**: `test_nine_entrypoints_…`→`test_ten_entrypoints_…`
    (`test_job_center.py`), `test_all_nine_entrypoints_…`→`test_all_ten_entrypoints_…`
    (`test_engine_controls.py`).
  - **[경미-2] 설계 §4.25 계약 정본 갱신**(`docs/02-design/study-app.design.api.md`): status
    값 목록(`ready|analyzing|analyzed|error|cancelled`)·`reuse:{split_id}`·`category_paths`
    대표 키 규칙(그룹 최소 start chunk_id)·GET `analyze_estimate` 동봉·`fallback` 필드를
    ⓐ 엔드포인트 표에 반영 + "8곳→10곳" 실측 정정 각주(†) 신설 + too_large action 문구가
    convert 한정임을 개정 지점 표에 명시. 본문 구조·기존 결정 보존, 최소 편집.
  - **수정 파일**: `services/split_service.py`(헤더 판정 통합·명시적 폴백)·`services/
    convert_service.py`(`_too_large_error` action 축소·`_fallback_error_info` 조건부
    부착)·`schemas/split.py`(`fallback` 필드)·`tests/test_split_import.py`(신규 3건: 회차
    라벨 본문 오탐 회귀 2건(스캔 단위·전체 파이프라인)·명시적 폴백 라벨 확인 1건 + 기존
    `_base_state`에 `fallback` 키 보강)·`tests/test_doc_format_detect.py`(action 문구
    스코프 테스트 갱신)·`tests/test_job_center.py`·`tests/test_engine_controls.py`(함수명
    개명)·`docs/02-design/study-app.design.api.md`.
  - **pytest**: `test_split_import.py` 25→28건, 전체 스위트 **506 → 509건 통과**(무LLM).
- **2026-08-04 표적 재검토 최종 통과(stage-reviewer, Opus)**: 중요 1(3중 파손 전수)·중요 2(재현 표본 후보 300→0 + 진짜 헤더 표본 정상 분할·헤딩 표본 회귀 없음 — 양방향 직접 실행 확인)·경미 1~6 전건 해소 — **DoD 자동 검증 6/6 · 치명 0·중요 0·경미 0 · pytest 509 · dist 바이트 일치**. 잔여 관찰 3건(결함 아님·차기 판단용): (A) 장식 접두 헤더(`■ …`·`【…】`)는 강한 신호에서 제외 — 실패 모드가 graceful(uncertain→정밀 분석 제안/명시 폴백)이라 현상 유지 타당, DoD 7 실사례에서 회차 헤더 미탐 시 첫 개선 후보(행두 앵커 앞 기호 1~2자 허용) (B) analyze 실패·취소 후 위저드에 "정밀 분석 없이 분할안 확인" 버튼이 사라짐(서버 안내 문구와 불일치 — 분할안은 서버 보존이라 재진입으로 복구 가능, 데이터 손실 0) (C) 조각 convert 잡의 커밋 문서가 sources/ 원본과 미연결(§4.25는 재저장 금지만 규정 — 링크 유지 필요 시 별도 등재).
- **2026-08-04 DoD 7 사용자 피드백 반영 3건(프론트 전용, 신규 API 0, backend/dist 무변경)**:
  피드백 원문 —
  (1) "분할작업중에 다른창을 갔다오면 분할작업에 대해 접근하기 어려워"
  (2) "텍스트가 너무길어 분할 작업하기로 했지만, 기존것이 남아있어 혼란스러워"
  (3) "LLM 작업중 토큰 입력과 출력이라고 표시된거를 봤을때 총 토큰 사용량(또는 예상 사용량)을 알기 어려워"
  - **(1)+(2) 재진입 앵커**: `utils/convertQueue.ts`(`StoredQueueEntry.splitId` 필드 추가) ·
    `hooks/useConvertQueue.ts`(`QueueItemStatus`에 `'split_in_progress'` 추가·우선순위는 `ready`
    다음·`error`보다 앞 · `setEntrySplitId(id, splitId)` 신설 · `addJobs(jobs, anchorEntryId?)`로
    enqueue 성공 시 앵커 항목 제거) · `components/ImportQueue.tsx`("분할 진행 중" 중립 배지 +
    [분할안 열기] 버튼, error 렌더와 분리) · `pages/Import.tsx`(`splitAnchorEntryId`/`splitResumeId`
    상태로 [분할 반입]↔[분할안 열기] 분기, `SplitImportWizard`의 `onSplitStarted`(split_id 확보 시
    앵커에 반영)·`onSplitExpired`(GET 404 시 앵커를 원래 실패 상태로 복귀 + 안내 배너) 콜백 배선,
    작업 센터 딥링크(`?split_id=`)로 들어온 경우도 큐에서 같은 split_id 항목을 찾아 앵커로 편입) ·
    `components/SplitImportWizard.tsx`(`onSplitStarted`/`onSplitExpired` prop 신설·`analyzeUnavailable`
    게이팅 정리 — 만료 배너와 "정밀 분석 없이 분할안 확인" 카드가 동시에 뜨지 않게, 만료·연결 실패
    상태에도 [닫기] 버튼 추가). localStorage 지속이라 새로고침 후에도 동작(기존 큐 지속 관례 그대로).
  - **(3) 토큰 합계**: `components/LlmJobProgress.tsx`의 "토큰 입력 N · 출력 M" 표기에 "· 합계
    N+M"을 추가(콤마 표기 관례 유지). **전수 실측**: 입력/출력 토큰을 보여주는 지점은 이 1곳뿐 —
    `POST /api/llm/jobs/{id}/cancel` 응답의 `usage`(입력·출력 토큰 실림)는 현재 프론트 어디서도
    렌더하지 않음(취소 후 목록 무효화만 수행, §5.14) — 렌더 지점이 없어 수정 대상 아님. `JobProgress`
    에는 예상치(estimate/approx) 필드가 없어(실측치 `usage`만 존재) "예상 ~K" 병기는 추가하지
    않음(백엔드 변경 금지 — 지시대로 없으면 추가하지 않음).
  - **상태 전이(재진입 앵커)**: `[error: too_large]` --[분할 반입] 클릭·`POST /import/split` 성공--> `[split_in_progress: splitId=X]`(위저드 닫아도 유지) --[분할안 열기]·GET 성공--> 위저드 재개(analyze/chunks/cost 이어서) · --[분할안 열기]·GET 404(만료)--> 안내 배너 + `splitId=null`로 복귀 → `[error: too_large]`(재시도 가능) · --enqueue 성공--> 앵커 항목 제거(조각들이 새 `'split'` sourceKind 항목으로 큐 합류, 독립적인 queued→running→ready→committed 수명주기).
  - **검증**: `npm run build` 통과(타입 에러 0) — 신규 API 0건·backend/·frontend/dist 무변경(빌드 산출물은 검증 후 원복).
