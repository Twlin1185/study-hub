// 에디터 v2 변환 계층 — **공개 API** (M32 / stage-32 묶음 2-1)
//
//   markdownToBlocks(md)  : 방언 Markdown → 앱 블록 문서
//   blocksToMarkdown(doc) : 앱 블록 문서 → 방언 Markdown 프로젝션
//
// **Markdown 파서는 여전히 remark 1개다**(F42/R19 · D4) — 파이프라인 플러그인 세트는
// `MarkdownView`/`inlineModel`과 **같은 모듈·같은 순서**를 쓴다(해석이 갈리는 경로 0).
// `remarkStudy.ts`는 **import만** 하고 1바이트도 고치지 않는다(D9 코드 격리).
//
// remark-breaks는 **켜지 않는다** — 파싱 확장이 아니라 파싱 뒤 mdast를 손보는 변환이라
// 해석은 같지만 그것이 만드는 노드에는 position이 없다(규약 D의 원문 슬라이스 보존이 무력화된다).
// 단일 개행은 softBreak 인라인 노드로 스키마에 그대로 담긴다.
import type { PluggableList } from 'unified'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import { remarkStudyDirectives, remarkStudyRefs } from '../../components/markdown/remarkStudy'
import { BLOCK_SCHEMA_VERSION } from '../schema/blocks'
import type { BlockDocument } from '../schema/blocks'
import { mdastToBlocks } from './mdastToBlocks'
import type { MdNode } from './mdastToBlocks'

export { mdastToBlocks } from './mdastToBlocks'
export { blocksToMarkdown, serializeInline, escapeText } from './blocksToMarkdown'
export type { MdNode } from './mdastToBlocks'

function buildProcessor() {
  const plugins: PluggableList = [
    remarkGfm,
    remarkMath,
    remarkDirective,
    [remarkStudyDirectives, { inlineFormat: true }],
    [remarkStudyRefs, { inlineFormat: true }],
  ]
  return unified().use(remarkParse).use(plugins)
}

let processor: ReturnType<typeof buildProcessor> | null = null

/** 변환기가 쓰는 mdast — 렌더러와 같은 플러그인 세트로 파싱한 결과. */
export function parseToMdast(markdown: string): MdNode | null {
  try {
    if (!processor) processor = buildProcessor()
    const tree = processor.parse(markdown)
    // 파일 값을 함께 넘겨야 remarkStudy가 원문 슬라이스(이스케이프·퇴로 복원)를 볼 수 있다.
    return processor.runSync(tree, markdown) as unknown as MdNode
  } catch {
    return null
  }
}

/** 방언 Markdown → 앱 블록 문서. 파싱이 실패하면 원문을 통째로 보존한다(규약 D 안전망). */
export function markdownToBlocks(markdown: string): BlockDocument {
  const root = parseToMdast(markdown)
  if (!root) {
    return {
      version: BLOCK_SCHEMA_VERSION,
      blocks: [{ id: 'b1', type: 'sourceFallback', markdown, nodeType: 'parseError' }],
    }
  }
  return { version: BLOCK_SCHEMA_VERSION, blocks: mdastToBlocks(root, markdown) }
}
