// 편집 표면 **공용 BlockNote 확장 묶음**(stage-36 F-6·F-7).
//
// 표면(노트 `NoteEditPage` · 문서 `BlockSurface`)은 이 한 줄만 `useCreateBlockNote({ extensions })`에
// 넘긴다 — 두 표면이 서로 다른 확장을 갖게 되는 표류를 원천 차단한다.
//
// `createExtension`은 BlockNote 0.54의 **공식 확장 API**다(`editor/BlockNoteExtension.d.ts`:
// `prosemirrorPlugins`·`keyboardShortcuts`·`store`). 내부 tiptap 옵션(`_tiptapOptions`, @internal)을
// 건드리지 않는 경로라 업그레이드 내성이 낫다.
import { createExtension } from '@blocknote/core'
// 코드 블록 구문 강조(stage-49 F-3 · 규약 B) — `@blocknote/code-block@0.54.0`(MPL-2.0 · 전이 의존
// `@shikijs/*`·oniguruma-to-es·hast-util-to-html 전부 MIT 실측 · GPL 0건).
//
// **결선 지점이 스펙이 아니라 여기인 이유**(**stage-49 규약 B 실측 개정(2026-09-13)** — 편성 시 규약 B는
// "스펙 옵션 `createHighlighter`에 `import('@blocknote/code-block').then(m => m.codeBlock.createHighlighter())`
// 지연 팩토리"를 적었으나 0.54 실제 API 형태가 달라 plan-architect 판정 ⓐ로 **정적 import `syntaxHighlighter`
// 전역 확장 등록**으로 개정 — 근거는 아래 두 단락): 0.54의
// `createCodeBlockSpec` 옵션에는 `createHighlighter`가 **없다**(`blocks/Code/CodeBlockOptions.d.ts`).
// 강조는 편집기 전역 확장 `SyntaxHighlightingExtension({ createHighlighter })`(`@blocknote/core`
// `extensions/SyntaxHighlighting`)이 맡고, 스펙은 `meta.highlight: (block) => block.props.language`로
// 언어만 선언한다. 이 패키지가 내보내는 것도 `createHighlighter`가 아니라 그 확장을 미리 만든
// `syntaxHighlighter` 1개(+ 우리가 쓰지 않는 `codeBlockOptions`)뿐이라 계획의 "`m.codeBlock.createHighlighter()`
// 지연 팩토리" 형태는 성립하지 않는다(`@shikijs/core`를 직접 import하는 대안은 §4 "shiki 직접 의존 0").
//
// **무엇이 지연되고 무엇이 아닌가**(R37 실측 — stage 문서 §7): 확장 객체는 편집기 생성 시 등록되지만
// 하이라이터 생성(`createHighlighter`)은 코어 `lazyShikiPlugin`이 **강조 대상 노드를 처음 파싱할 때**
// 1회 호출한다(코드 블록이 없는 문서는 호출 0). 언어 문법(`@shikijs/langs-precompiled/*`)·테마
// (`github-light`/`github-dark`)는 패키지 안에서 `import()`라 언어별 별도 청크로 그때 로드된다.
// 다만 shiki 엔진 본체(`@shikijs/core`·engine-javascript·oniguruma-to-es)는 패키지 진입점의 정적 import라
// 이 파일이 속한 편집 lazy 청크(`ui-*.js`)에 동승한다(스키마·확장 모두 노트 lazy 청크 안 — 편집기를 열지
// 않는 화면은 무접촉). 엔트리 청크(`index-*.js`)는 편집기 코드 0 B이나 **의존 유래 +3,836 B**가 남는다 —
// 엔트리에 이미 있던 `stringify-entities`/`character-entities-html4`(remark 경로)의 추가 export를
// `hast-util-to-html`(`@shikijs/core`가 `codeToHtml`용으로 정적 참조)이 요구해 Rollup이 보존한 분량이며,
// shiki가 번들에 들어오는 어떤 결선 방식이라도 동일하다(수치·귀책 = stage-49 문서 §7 V-1).
//
// 언어 세트는 `schema.ts`의 `CODE_LANGUAGES` 15종이 정본(패키지 `codeBlockOptions`는 쓰지 않는다).
// 패키지 번들에 없는 언어 키는 코어가 `loadLanguage` 실패를 잡아 `unsupportedLanguages`에 넣고 평문으로
// 둔다(콘솔 오류 0 — `shiki.ts` 실측). `text`는 코어 `PLAIN_TEXT_LANGUAGES`라 강조 대상이 아니다.
//
// 이 확장은 두 표면(노트·문서 블록 표면) 공용이고, 수식 블록(`meta.highlight: () => 'latex'`)의 소스
// 편집 팝업도 같은 하이라이터로 강조된다(패키지 번들에 `latex` 포함).
import { syntaxHighlighter } from '@blocknote/code-block'
import type { AdapterSidecar } from '../adapter'
import { createColumnsEdgeKeymapExtension } from './columnsKeymap'
import { createFindPlugin } from './find/findPlugin'
import { createMarkEscapeKeymapExtension } from './toolbar/markEscape'
import { createTableAlignPlugin, type ColumnAlign, type InitialTableAlign } from './tableAlign/tableAlignPlugin'

/** 사이드카(로드 시 어댑터가 흡수해 둔 값) → 표 열 정렬 플러그인의 초기 상태. */
export function tableAlignFromSidecar(sidecar: AdapterSidecar): InitialTableAlign {
  const initial: Record<string, ColumnAlign[]> = {}
  for (const [blockId, entry] of Object.entries(sidecar)) {
    const align = entry?.tableAlign
    if (align) initial[blockId] = align.map((value) => value ?? null)
  }
  return initial
}

export function createEditor2Extensions(initialTableAlign: InitialTableAlign) {
  return [
    createExtension({
      key: 'editor2Find',
      prosemirrorPlugins: [createFindPlugin()],
    }),
    createExtension({
      key: 'editor2TableAlign',
      prosemirrorPlugins: [createTableAlignPlugin(initialTableAlign)],
    }),
    // 단 경계 키 가드(stage-41 2차 규약 E 강등) — 두 표면 모두 이 함수로 확장을 받으므로
    // 노트 편집기(`NoteEditPage`)·문서 블록 표면(`BlockSurface`) 양쪽에 같이 걸린다.
    createColumnsEdgeKeymapExtension(),
    // 마크 탈출 제스처(stage-47 FB-20 규약 A) — **columns 확장 뒤**에 둔다. 같은 우선순위 계층에서
    // tiptap은 확장 배열을 뒤집어 플러그인을 쌓으므로(배열 뒤쪽이 먼저) 단 마지막 블록 끝 + 대기
    // 마크 상태의 `ArrowRight`는 탈출이 먼저, 다음 →가 단 이동이 된다(`s47-mark-escape.mjs` ⓒ 실측).
    createMarkEscapeKeymapExtension(),
    // 구문 강조(stage-49 F-3) — 위 머리 주석. 키 `syntaxHighlighting`(코어 고정).
    syntaxHighlighter,
  ]
}
