// 목차(TOC) 블록의 **자기 표면 헤딩 수집** (stage-37 규약 A · F-3).
//
// 저장 데이터가 없는 블록이라(`TocBlock` = prop 0) 목록은 항상 **렌더 시점 파생**이다. 이 파일은
// 두 가지만 한다: ① `editor.document`를 훑어 heading 블록 전수(id·level·text)를 뽑는다
// (`refPicker/headings.ts`의 `collectAnchorCandidates`와 같은 순회 방식이지만, 여기는 **도메인
// 필터·중복 제거가 없다** — "코어가 지원하는 헤딩 전부"가 계약이라 앵커 대상 제약을 그대로 쓸 이유가
// 없다). ② 매 트랜잭션마다 다시 훑어 React 상태로 끌어오는 구독 훅(`usePmSnapshot` 재사용 —
// stage-36 F-6·F-7과 같은 구독 지점)으로 "자동 갱신"을 공짜로 만든다.
import { useCallback } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import { usePmSnapshot } from '../usePmSnapshot'

export interface TocHeading {
  id: string
  level: number
  /** 빈 제목(글자 없는 heading 블록)은 걸러내지 않고 그대로 담는다 — "필터 없음"이 계약이다. */
  text: string
}

/** 인라인 콘텐츠 배열에서 글자만 뽑는다(원자 인라인은 글자를 갖지 않으므로 건너뛴다). */
function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const node of content) {
    if (!node || typeof node !== 'object') continue
    const record = node as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') out += record.text
    else if (record.type === 'link') out += inlineText(record.content)
  }
  return out
}

function walk(blocks: readonly unknown[], out: TocHeading[]): void {
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record.type === 'heading' && typeof record.id === 'string') {
      const props = (record.props ?? {}) as Record<string, unknown>
      const level = typeof props.level === 'number' ? props.level : 1
      out.push({ id: record.id, level, text: inlineText(record.content).trim() })
    }
    if (Array.isArray(record.children)) walk(record.children, out)
  }
}

/** 현재 표면(=이 `editor` 인스턴스) 문서 순서의 heading 전수. 본문/해설은 표면마다 별 편집기라 자동으로 격리된다. */
export function collectHeadings(editor: BlockNoteEditor<any, any, any>): TocHeading[] {
  const out: TocHeading[] = []
  walk(editor.document as readonly unknown[], out)
  return out
}

const EMPTY_HEADINGS: TocHeading[] = []

function equalHeadings(a: TocHeading[], b: TocHeading[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].level !== b[i].level || a[i].text !== b[i].text) return false
  }
  return true
}

/** TOC 블록 렌더가 구독하는 훅 — 헤딩 추가·수정·삭제 트랜잭션마다 다시 읽는다(자동 갱신). */
export function useTocHeadings(editor: BlockNoteEditor<any, any, any>): TocHeading[] {
  const read = useCallback(() => collectHeadings(editor), [editor])
  return usePmSnapshot(editor, read, equalHeadings, EMPTY_HEADINGS)
}
