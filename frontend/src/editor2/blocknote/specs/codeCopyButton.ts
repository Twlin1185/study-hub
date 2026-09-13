// 코드 블록 **[복사] 버튼**(stage-49 F-4 · 규약 C) — 엔진 코드 블록 스펙의 `implementation.render`를
// **감싸서**(엔진 스펙 복제 0 — R33) 결과 DOM에 버튼 1개를 덧붙인다.
//
// 엔진 0.54 `createCodeBlock` 실측(`@blocknote/core/src/blocks/Code/helpers/render/createCodeBlock.ts`):
// `render`는 `{ dom: DocumentFragment, contentDOM: <code>, destroy }`를 돌려주고, 조각(dom) 안에는
// `div[contenteditable="false"] > select`(언어 선택 래퍼 — 지원 언어가 2개 이상이고 편집 가능할 때만)
// 와 `pre > code`가 순서대로 들어 있다. 버튼은 **그 래퍼의 첫 자식**으로 넣는다 — `notes.css`가
// 래퍼를 `display:flex`로 바꿔 select 폭이 언어명마다 달라도 절대좌표 계산이 필요 없고, 기존
// `::after` 셰브런·`> select` 선택자는 무변이다. 래퍼가 없으면(엔진이 비편집 모드에서 select 생략)
// 버튼도 생략한다 — 이 앱의 읽기 표면은 `MarkdownView`라 실사용 영향 0.
//
// **DOM API는 render 안에서만 쓴다** — `schema.ts`는 헤드리스(`scripts/s33-adapter-roundtrip.mjs`
// 계열)에서 DOM 없이 import되므로 모듈 최상위에서는 `document`를 만지지 않는다.
//
// 버튼 라벨 갱신(“복사됨”/“복사 실패”)은 contentDOM 밖의 DOM 변이라 엔진이 이미 무시한다
// (`schema/nodeViewMutations.ts` `ignoreNonContentMutations` — 블록 노드뷰 전부에 적용 실측). 별도
// `ignoreMutation`을 얹지 않는다.
//
// 복사 자체는 공용 유틸 `utils/clipboardWrite.ts`(규약 C·D 공유 — 폰 비보안 컨텍스트 폴백 포함).
// 구문 강조(F-3)와는 **독립** — 강조 청크 로드 전에도 동작한다.
import { writeClipboardText } from '../../../utils/clipboardWrite'

const LABEL_IDLE = '복사'
const LABEL_DONE = '복사됨'
const LABEL_FAIL = '복사 실패'
const LABEL_RESTORE_MS = 1500

interface RenderResult {
  dom: HTMLElement | DocumentFragment
  contentDOM?: HTMLElement
  destroy?: () => void
}

// 엔진 `render`는 `this`(렌더 컨텍스트)·`(block, editor)`를 받는다 — 여기서는 그대로 통과시킬 뿐
// 인자 타입을 해석하지 않으므로 구조 타입만 `any`로 둔다(스펙의 정확한 타입 `S`는 그대로 돌려준다).
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRender = (this: any, ...args: any[]) => RenderResult

interface SpecWithRender {
  implementation: { render: AnyRender }
}

/** 엔진 코드 블록 스펙의 `render`를 감싸 언어 select 래퍼 안에 [복사] 버튼을 덧붙인다. */
export function withCodeCopyButton<S extends SpecWithRender>(spec: S): S {
  const baseRender: AnyRender = spec.implementation.render
  const render = function (this: any, ...args: any[]): RenderResult {
    const out = baseRender.apply(this, args)
    // `DocumentFragment`·`HTMLElement` 둘 다 `children`을 가진다(ParentNode). 직계 자식만 본다 —
    // `pre > code` 안쪽(사용자 콘텐츠)은 겨누지 않는다.
    const wrapper = Array.from(out.dom.children).find(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && el.tagName === 'DIV' && el.contentEditable === 'false',
    )
    const contentDOM = out.contentDOM
    if (!wrapper || !contentDOM) return out

    const button = document.createElement('button')
    button.type = 'button'
    button.contentEditable = 'false'
    button.setAttribute('data-code-copy', '')
    button.setAttribute('aria-label', '코드 복사')
    button.textContent = LABEL_IDLE

    let restoreTimer: ReturnType<typeof setTimeout> | undefined
    const setLabel = (label: string) => {
      button.textContent = label
      if (restoreTimer !== undefined) clearTimeout(restoreTimer)
      restoreTimer = setTimeout(() => {
        button.textContent = LABEL_IDLE
        restoreTimer = undefined
      }, LABEL_RESTORE_MS)
    }
    // mousedown 기본 동작을 막아 편집기 선택(커서)을 유지한다 — 버튼이 포커스를 뺏으면 붙여넣기
    // 직후 리듬이 끊긴다(툴바 버튼과 같은 관례).
    const onMouseDown = (event: MouseEvent) => event.preventDefault()
    const onClick = () => {
      // 코드 텍스트 = contentDOM(`<code>`)의 textContent — PM이 줄바꿈을 `\n` 텍스트로 보존하고,
      // 강조 span(shiki)으로 감싸여도 textContent는 그대로 이어 붙는다.
      const text = contentDOM.textContent ?? ''
      void writeClipboardText(text).then(
        (ok) => setLabel(ok ? LABEL_DONE : LABEL_FAIL),
        () => setLabel(LABEL_FAIL),
      )
    }
    button.addEventListener('mousedown', onMouseDown)
    button.addEventListener('click', onClick)
    wrapper.insertBefore(button, wrapper.firstChild)

    const baseDestroy = out.destroy
    return {
      ...out,
      destroy: () => {
        if (restoreTimer !== undefined) clearTimeout(restoreTimer)
        button.removeEventListener('mousedown', onMouseDown)
        button.removeEventListener('click', onClick)
        baseDestroy?.()
      },
    }
  }
  return {
    ...spec,
    implementation: { ...spec.implementation, render },
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
