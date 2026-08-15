// rehype 플러그인 — hast 트리를 순회하며 소스 오프셋을 data-sp-start/data-sp-end 속성으로
// element에 주입한다(설계 §5.3 S30 ⓙ · stage-30 §1-2 선행 조사).
//
// 배경: react-markdown 10.1.0은 sourcePos/rawSourcePos/includeElementIndex를 "제거된 prop"으로
// 명시하고 에러 처리하므로 쓸 수 없다(실측 확인). 대안이 이 자체 rehype 플러그인이다.
//
// 의존 0 — unist-util-visit이 이미 전이 의존성에 있더라도 여기서 직접 import하지 않는다
// (remarkStudy.ts가 세운 "재귀 방문 직접 구현" 관례를 그대로 따른다). 외부 hast 타입에도
// 의존하지 않는다(remarkStudy.ts의 MdNode 최소 타입 관례와 동일).
//
// 주의: 이 파일은 아직 어디에도 연결(wiring)하지 않는다 — MarkdownView.tsx에 기본 off 옵션으로
// 배선하는 것은 후속 작업(F43 앵커: 읽기 전용 렌더 diff 0을 위해 기본값은 항상 off여야 한다).

// hast 노드 최소 형태 — 외부 @types/hast 의존을 만들지 않는다.
interface HastNode {
  type: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
}

// element 노드에 한해 position.start/end.offset이 둘 다 숫자로 실려 있을 때만 주입한다
// (텍스트 노드·comment 노드·position 부재 노드는 건드리지 않는다).
function injectPositions(node: HastNode): void {
  if (node.type === 'element') {
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    if (typeof start === 'number' && typeof end === 'number') {
      node.properties = node.properties ?? {}
      // camelCase "data*" 속성은 hast/property-information 관례상 자동으로
      // kebab-case data-* HTML 속성으로 변환된다(dataSpStart -> data-sp-start).
      node.properties.dataSpStart = start
      node.properties.dataSpEnd = end
    }
  }
  const children = node.children
  if (!children) return
  for (const child of children) {
    injectPositions(child)
  }
}

/**
 * rehype 플러그인 — `.use(rehypeSourcePos)`로 unified 파이프라인에 연결하면 hast 트리의
 * 각 element에 data-sp-start/data-sp-end 속성을 주입한다. 옵션 없음(항상 동작) — 켜고 끄는
 * 판단은 호출부(MarkdownView의 sourcePos?: boolean 기본 off)가 플러그인 배열 구성으로 담당한다.
 */
export default function rehypeSourcePos() {
  return (tree: HastNode) => {
    injectPositions(tree)
  }
}
