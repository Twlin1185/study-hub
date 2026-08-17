// 문서 편집 표면 퇴로 토글 — "문서 편집에 새 편집기 사용"(**기본 ON** · screens §5.3 S35 ·
// stage-35 규약 F).
//
// 왜 localStorage인가: 이 단계는 **서버 settings 키 0**이 계약이고(지시서 범위 요약), 로컬
// 상태 저장소는 지정된 zustand 스토어 3개(quizSession·flashcardSession·theme)뿐이라 새 스토어를
// 만들 수 없다. 기기별 퇴로 스위치라 서버에 둘 이유도 없다.
//
// **OFF = 구 편집기 완전 복귀** — 이 모듈은 값만 들고 있고, 분기는 문서 상세(DocumentDetail)가 한다.
// BlockNote·어댑터를 **import하지 않는다**(설정 화면이 이 모듈을 읽어도 편집기 청크가 딸려오지
// 않아야 한다 — R37 초기 청크 한도).
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'editor2.documentsSurface'
/** 같은 탭 안에서 설정 화면 ↔ 문서 상세가 서로의 변경을 즉시 본다(`storage` 이벤트는 다른 탭에만 온다). */
const CHANGE_EVENT = 'editor2:documents-surface-changed'

/** 기본 ON — 저장된 값이 없거나 'off'가 아니면 켜진 것으로 본다(기본 OFF면 실사용이 안 나온다). */
export function isDocBlockEditorEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    // 사생활 보호 모드 등으로 접근 불가 — 기본값(ON)으로 동작한다.
    return true
  }
}

export function setDocBlockEditorEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // 저장에 실패해도 이번 세션 동안은 이벤트로 화면이 따라온다.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useDocBlockEditorEnabled(): boolean {
  return useSyncExternalStore(subscribe, isDocBlockEditorEnabled, () => true)
}
