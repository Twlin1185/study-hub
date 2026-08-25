// 편집 세션 원본 스냅샷 — **표면 중립** 저장소(stage-39 규약 E — 2026-08-23 정정: "표면별 대상
// id 키(노트 id / 문서 id) · 표면당·대상당 1개"로 일반화). 노트 편집(`NoteEditPage`)과 문서 상세
// 편집(`DocBlockEditor`)이 이 모듈을 공유한다(이원화 금지 — 저장소 하나).
//
// 저장 내용의 **형태**는 표면마다 다르다(노트 = 제목+블록+사이드카, 문서 = 제목+보기+정답+난이도
// +본문/해설 2표면 블록+사이드카) — 그래서 이 모듈은 JSON 저장/검증/삭제만 표면 중립으로 담당하고,
// 스냅샷 형태·검증기(`isValid`)는 표면별 모듈(`noteSessionSnapshot.ts`·`docBlockSnapshot.ts`)이 정의한다.
//
// **클라이언트 영속 보관**(localStorage — 브라우저 크래시를 견디는 저장소가 계약. 백엔드 diff 0
// 계약의 귀결. 저장 수단·직렬화 세부는 구현 재량).
export function snapshotStorageKey(surface: string, id: number): string {
  return `studyhub.${surface}.snapshot.${id}`
}

/** 부재·손상(파싱 실패·검증 실패) 시 `null` — 호출부는 "생략 진입"으로 처리한다. */
export function readSnapshot<T>(
  surface: string,
  id: number,
  isValid: (value: unknown) => value is T,
): T | null {
  try {
    const raw = window.localStorage.getItem(snapshotStorageKey(surface, id))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isValid(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 기록 성공 여부를 돌려준다 — 실패(용량 상한·비공개 모드 등) 시 호출부가 [취소]를 비활성 + 안내한다(규약 E 상한 조항). */
export function writeSnapshot<T>(surface: string, id: number, value: T): boolean {
  try {
    window.localStorage.setItem(snapshotStorageKey(surface, id), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** 정상 종결([저장]/[취소]/정상 이탈) — 다음 진입에서 거짓 복구 다이얼로그가 뜨지 않게 지운다. */
export function clearSnapshot(surface: string, id: number): void {
  try {
    window.localStorage.removeItem(snapshotStorageKey(surface, id))
  } catch {
    // 지우기 실패는 조용히 무시한다 — 내용이 같으면(정상 종결 직후 그대로) 다음 진입에서도
    // 호출부의 동등 비교(`*SnapshotsEqual`)가 "생략 진입"으로 처리하므로 손실 경로는 아니다.
  }
}
