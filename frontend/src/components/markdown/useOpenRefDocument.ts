// [원문 열기] 내비게이션 — 임베드 카드·자리표시자·링크 칩이 공유한다.
//
// 해석 API(설계 §4.19 ③, 2026-08-02 보완 확정)는 `found: true`인 항목에 문서 내부 PK(`id`)를
// 항상 내려준다(삭제 문서 포함) → 기존 `/docs/{id}` 라우트로 직행한다. 해석 응답이 아직 도착하지
// 않아 id를 모르는 동안에는 호출부가 버튼을 비활성으로 두므로, 이 훅은 id가 확정된 경우만 받는다.
//
// stage-36 검토 중요-1 — **편집 표면(편집 세션이 아직 저장되지 않은 경우) 안에서는 라우팅 금지**.
// 리더(읽기 화면)는 종전대로 `navigate()`로 페이지를 옮기지만, `editor2`가 이 카드를 편집 표면
// 안(docEmbed 블록 펼침 카드)에 끼워 넣을 때는 `OpenRefDocumentOverride`로 열기 동작을 새 탭으로
// 바꿔치기한다 — 편집 중이던 본문·해설이 확인 없이 사라지는 경로를 구조로 막는다.
// **오버라이드가 없으면(기본값 null) 예전과 완전히 같은 동작** — 리더 쪽 diff는 0이다.
import { createContext, createElement, useCallback, useContext } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

type OpenRefDocumentFn = (documentId: number) => void

const OpenRefDocumentOverrideContext = createContext<OpenRefDocumentFn | null>(null)

interface OpenRefDocumentOverrideProps {
  /** 이 서브트리 안에서 문서 열기를 가로챌 함수(예: 새 탭 열기). */
  open: OpenRefDocumentFn
  children: ReactNode
}

/** 편집 표면 전용 — 이 아래에서 `useOpenRefDocument()`를 쓰는 모든 것(임베드 카드·자리표시자·
 * 링크 칩)이 `navigate()` 대신 `open`을 쓰게 된다. Provider가 없으면 기본 라우팅 그대로다.
 * (파일이 `.ts`라 JSX 대신 `createElement`를 직접 쓴다 — 확장자·번들 경로를 건드리지 않는다.) */
export function OpenRefDocumentOverride({ open, children }: OpenRefDocumentOverrideProps) {
  return createElement(OpenRefDocumentOverrideContext.Provider, { value: open }, children)
}

export function useOpenRefDocument() {
  const navigate = useNavigate()
  const override = useContext(OpenRefDocumentOverrideContext)
  return useCallback(
    (documentId: number) => {
      if (override) {
        override(documentId)
        return
      }
      navigate(`/docs/${documentId}`)
    },
    [navigate, override],
  )
}
