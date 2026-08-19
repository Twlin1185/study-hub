// 찾기/바꾸기 — **ProseMirror 플러그인 계층**(stage-36 F-7 · 규약 E).
//
// 플러그인이 들고 있는 것: 검색어·대소문자 구분·일치 목록·현재 일치 번호·열림 여부.
// 화면(`FindReplacePanel`)은 이 상태를 **읽기만** 하고, 바꾸는 것은 전부 트랜잭션 meta로 보낸다
// (React 상태와 PM 상태를 이중으로 두지 않는다 — 문서가 바뀌면 일치 목록도 같은 트랜잭션에서
//  다시 계산돼야 하므로 진짜 단일 출처는 PM 쪽이다).
//
// **왜 `prosemirror-*`를 직접 import하는가**: `@blocknote/core`는 `Plugin`·`DecorationSet`을
// 재수출하지 않는다(실측 — `types/src/index.d.ts`에 없다). 이 패키지들은 `@blocknote/core`의
// **직접 의존**이라 이미 트리에 있고(단일 사본 실측: prosemirror-state 1.4.4 · view 1.42.2 ·
// model 1.25.11), 설치가 늘지 않으므로 "신규 npm 의존 0"(규약 F)을 지킨다. 라이선스도 MIT로
// 이미 M31 전수 검사(§3)에 포함돼 있다 — D10 무관.
import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorState, Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { collectMatches, firstMatchAtOrAfter, isSearchableQuery, type FindMatch } from './matches'

export const FIND_PLUGIN_KEY = new PluginKey<FindState>('editor2-find')

export interface FindState {
  /** 패널이 열려 있는가. 닫혀 있으면 하이라이트도 없다(장식 계산 자체를 건너뛴다). */
  open: boolean
  query: string
  caseSensitive: boolean
  matches: FindMatch[]
  /** 현재 일치 번호(0-base). 일치가 없으면 -1. */
  activeIndex: number
}

const EMPTY: FindState = { open: false, query: '', caseSensitive: false, matches: [], activeIndex: -1 }

type FindAction =
  | { type: 'open'; query?: string }
  | { type: 'close' }
  | { type: 'query'; query: string; caseSensitive: boolean }
  | { type: 'step'; delta: 1 | -1 }

/** 트랜잭션에 찾기 동작을 실어 보낸다(문서를 바꾸지 않는 순수 UI 트랜잭션에도 쓴다). */
export function withFindAction(tr: Transaction, action: FindAction): Transaction {
  return tr.setMeta(FIND_PLUGIN_KEY, action)
}

export function getFindState(state: EditorState): FindState {
  return FIND_PLUGIN_KEY.getState(state) ?? EMPTY
}

function recompute(state: FindState, doc: Parameters<typeof collectMatches>[0], anchor: number): FindState {
  const matches = collectMatches(doc, state.query, state.caseSensitive)
  if (matches.length === 0) return { ...state, matches, activeIndex: -1 }
  return { ...state, matches, activeIndex: firstMatchAtOrAfter(matches, anchor) }
}

/**
 * 하이라이트 장식. 현재 일치만 다른 class를 받아 "지금 어디를 보고 있는지"가 보인다.
 * 색은 `notes.css`가 전부 `tokens.css` 변수로 결선한다(불변 규칙 5 — 여기에는 색이 없다).
 */
function decorationsFor(state: FindState, doc: Parameters<typeof collectMatches>[0]): DecorationSet {
  if (!state.open || state.matches.length === 0) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    state.matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === state.activeIndex ? 'editor2-find-hit editor2-find-hit-active' : 'editor2-find-hit',
      }),
    ),
  )
}

export function createFindPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: FIND_PLUGIN_KEY,
    state: {
      init: () => EMPTY,
      apply(tr, prev, _oldState, newState) {
        const action = tr.getMeta(FIND_PLUGIN_KEY) as FindAction | undefined

        if (action?.type === 'close') return EMPTY
        if (action?.type === 'open') {
          const query = action.query ?? prev.query
          const opened: FindState = { ...prev, open: true, query }
          if (!isSearchableQuery(query)) return { ...opened, matches: [], activeIndex: -1 }
          return recompute(opened, newState.doc, tr.selection.from)
        }
        if (action?.type === 'query') {
          const next: FindState = {
            ...prev,
            open: true,
            query: action.query,
            caseSensitive: action.caseSensitive,
          }
          if (!isSearchableQuery(action.query)) return { ...next, matches: [], activeIndex: -1 }
          // 검색어를 고칠 때는 **커서 위치 기준**으로 다시 잡는다(타이핑할 때마다 문서 처음으로
          // 튀지 않게 — 커서는 보통 사용자가 보고 있던 자리에 있다).
          return recompute(next, newState.doc, tr.selection.from)
        }
        if (action?.type === 'step') {
          if (prev.matches.length === 0) return prev
          const size = prev.matches.length
          const next = (prev.activeIndex + action.delta + size) % size
          return { ...prev, activeIndex: next }
        }

        if (!tr.docChanged) return prev
        if (!prev.open || !isSearchableQuery(prev.query)) return prev
        // 문서가 바뀌면 일치 목록은 **무조건** 다시 계산한다. 위치만 매핑하면 새로 생기거나
        // 사라진 일치를 놓친다(바꾸기 직후가 정확히 그 경우다).
        const anchorBefore = prev.activeIndex >= 0 ? prev.matches[prev.activeIndex].from : tr.selection.from
        return recompute(prev, newState.doc, tr.mapping.map(anchorBefore, -1))
      },
    },
    props: {
      decorations(state) {
        return decorationsFor(getFindState(state), state.doc)
      },
    },
  })
}
