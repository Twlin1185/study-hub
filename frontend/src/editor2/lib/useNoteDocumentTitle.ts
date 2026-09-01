// 노트 화면의 **브라우저 탭 제목**을 앱 나머지와 구분되게 바꾼다.
//
// 왜 필요한가: `index.html`의 `<title>Study Hub</title>` 하나뿐이라 앱 전체가 어느 화면이든
// 같은 탭 제목으로 뜬다. 개발 중에는 기존 문서 화면과 노트 화면을 나란히 열어 두는데, 탭·작업
// 표시줄에서 둘이 완전히 같아 보여 **어느 창이 어느 화면인지 구별되지 않는다**(2026-08-16 사용자 지적).
// `Dev_StartServer.bat`이 두 창을 각각 띄우고, 이 훅이 그 창에 다른 이름을 준다.
//
// D9 격리: 이 파일은 `editor2/**` 안에 있고 노트 화면에서만 호출된다 — 기존 화면·컴포넌트는
// 1바이트도 바뀌지 않는다(설계 §5.16 격리 계약). stage-43 G-2 — 베타 딱지만 해제, 탭 제목
// 구분 목적은 정식 승격 후에도 유효해 유지한다.
import { useEffect } from 'react'

/** `index.html`의 기본 제목 — 노트 화면을 벗어날 때 되돌릴 값. */
const BASE_TITLE = 'Study Hub'

/**
 * 노트 화면이 떠 있는 동안 탭 제목을 `노트 …`로 바꾼다.
 *
 * `suffix`(노트 제목)를 주면 노트 창을 여러 개 열어도 서로 구분된다.
 * 언마운트 시에는 **캡처한 이전 값이 아니라 `BASE_TITLE`로** 되돌린다 — 노트 목록 → 편집처럼
 * 노트 화면끼리 이동하면 "이전 값"이 다른 노트의 제목일 수 있어서다(앱의 다른 화면은 제목을
 * 건드리지 않으므로 기본값 복원이 언제나 옳다).
 */
export function useNoteDocumentTitle(suffix?: string): void {
  useEffect(() => {
    const trimmed = suffix?.trim()
    document.title = trimmed ? `노트 · ${trimmed} — ${BASE_TITLE}` : `노트 — ${BASE_TITLE}`
    return () => {
      document.title = BASE_TITLE
    }
  }, [suffix])
}
