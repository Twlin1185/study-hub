// 참조 칩·임베드 카드가 구독하는 **편집 세션 컨텍스트** (stage-34 규약 A ③).
//
// 담는 것 2가지:
//   ① **제목 추종 조회** — `label`이 비어 있는(추종형) 칩이 대상 문서 제목을 표시하기 위한 조회.
//      칩마다 fetch를 내보내면 N+1이 된다(§4.19 계약 위반). 그래서 칩은 `requestTitle()`로 **등록만**
//      하고, 공급자(`RefUiProvider`)가 한 프레임 모아 `resolve-embeds` **배치 1회**로 해석한다.
//   ② **칩 팝오버 열기** — 편집 표면에서 칩 클릭은 라우팅이 아니라 팝오버다(규약 A ③).
//      칩만이 자기 위치(`getPos`)와 갱신 함수(`updateInlineContent`)를 알기에, 그 둘을 콜백으로 실어
//      공급자에게 넘긴다.
//
// **이 파일은 런타임 의존이 React 하나뿐이다.** `specs/inline.tsx`가 import하고, 그 파일은 다시
// `blocknote/schema.ts`가 import한다 — 그 스키마 모듈은 검증 스크립트(`scripts/s33-adapter-roundtrip.mjs`)가
// **Node에서 jiti로** 불러 실제 왕복에 쓴다. 그래서 여기서 `api/*`(fetch·import.meta.env)를 **값으로**
// import하면 검증이 깨진다 — 타입만 `import type`으로 가져온다(컴파일 시 소거).
import { createContext, useContext } from 'react'
import type { EmbedResolveItem } from '../../../api/embeds'

/** 참조 대상 종류 — `refChipInlineSpec.propSchema.refType`과 같은 값 집합. */
export type RefKind = 'doc' | 'anchor' | 'embed'

export interface RefTitleEntry {
  /** `pending` = 배치 대기·비행 중(대상 식별자를 그대로 보여 준다 — 깜빡임 방지). */
  state: 'unresolved' | 'pending' | 'resolved'
  item?: EmbedResolveItem
}

const UNRESOLVED: RefTitleEntry = { state: 'unresolved' }

/** 칩·카드가 팝오버를 열 때 넘기는 자기 자신에 대한 손잡이. */
export interface RefChipMenuRequest {
  /** 팝오버를 붙일 화면 좌표(칩 DOM의 사각형). */
  rect: DOMRect
  refType: RefKind
  target: string
  label: string
  /** 대상·라벨 갱신(칩 = `updateInlineContent` / 임베드 블록 = `updateBlock`). */
  update: (next: { target?: string; label?: string }) => void
  /** 칩·블록 삭제. */
  remove: () => void
}

export interface RefUiContextValue {
  /** 제목 조회 예약(중복 요청은 공급자가 접는다). */
  requestTitle: (docNo: string) => void
  getTitle: (docNo: string) => RefTitleEntry
  openChipMenu: (request: RefChipMenuRequest) => void
  /** 공급자가 실제로 붙어 있는가 — 붙지 않았으면 칩은 조용히 기본 표시로 내려간다. */
  enabled: boolean
}

/**
 * 기본값 = **아무것도 하지 않는 구현**. 편집기 밖에서 스펙이 렌더될 때
 * (`renderToDOMSpec` — 복사/외부 HTML 직렬화 경로)도 반드시 이 값이 쓰이므로 깨지면 안 된다.
 */
const NO_PROVIDER: RefUiContextValue = {
  requestTitle: () => {},
  getTitle: () => UNRESOLVED,
  openChipMenu: () => {},
  enabled: false,
}

export const RefUiContext = createContext<RefUiContextValue>(NO_PROVIDER)

export function useRefUi(): RefUiContextValue {
  return useContext(RefUiContext)
}

// ---------------------------------------------------------------- 표시 규칙(F43 자리표시자 계승)
//
// 칩과 임베드 카드가 **같은 문구**를 쓰도록 여기 한 곳에 둔다. 문구는 F43 리더
// (`components/markdown`)의 자리표시자를 계승한다 — 편집 표면과 읽기 화면이 다른 말을 하면 안 된다.

export interface RefDisplay {
  /** 칩·카드에 실제로 그릴 글자 */
  text: string
  /** 마우스 올렸을 때의 전체 설명(자리표시자는 사유가 길어 여기 담는다) */
  title: string
  /** 자리표시자(미해결·삭제됨)인가 — 중립 토큰 색으로 그린다. */
  placeholder: boolean
}

/**
 * 칩 표시 문자열 결정. 우선순위:
 *   지정 라벨 > (앵커는 target 그대로) > 해석된 제목 > 자리표시자 > 미조회면 target
 */
export function describeRef(
  refType: RefKind,
  target: string,
  label: string,
  entry: RefTitleEntry,
): RefDisplay {
  if (label) return { text: label, title: `참조 — ${target}`, placeholder: false }
  if (refType === 'anchor') {
    return { text: target, title: `문서 안 앵커 — ${target}`, placeholder: false }
  }
  if (entry.state !== 'resolved' || !entry.item) {
    // 조회 전 — 대상 식별자를 그대로 보여 준다(빈 칩이 번쩍이지 않게).
    return { text: target, title: `참조 — ${target}`, placeholder: false }
  }
  const item = entry.item
  if (!item.found) {
    return {
      text: `존재하지 않는 참조 (${target})`,
      title: `존재하지 않는 참조 (${target})`,
      placeholder: true,
    }
  }
  if (item.is_active === false) {
    const withTitle = item.title ? `${target} · ${item.title}` : target
    return {
      text: `삭제된 문서 (${withTitle})`,
      title: `삭제된 문서 (${withTitle}) — 내용은 표시되지 않습니다. 복원하면 다시 보입니다`,
      placeholder: true,
    }
  }
  return { text: item.title || target, title: `참조 — ${target}`, placeholder: false }
}
