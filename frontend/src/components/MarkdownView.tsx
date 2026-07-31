import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkDirective from 'remark-directive'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import { useResolveEmbeds } from '../api/embeds'
import { extractDocRefs, remarkDocDirectives, remarkDocRefs } from '../utils/docRefs'
import { DocRefContext, MARKDOWN_REF_COMPONENTS } from './docRefRuntime'
import type { DocRefChainEntry } from './docRefRuntime'
import type { FontScale } from '../api/types'

// 문서 3대 공용 모듈 중 렌더러(설계 §5 도입부, F37) — 문서 상세·학습·커리큘럼·탐색·퀴즈·
// 플래시카드·복습·인쇄 전 화면이 이 한 곳을 통해서만 Markdown을 그린다. S17(설계 §4.19)에서
// 참조 문법(임베드·링크·헤딩 앵커)·가리기/접기(remark-directive)를 이 공용 모듈 1곳에 추가했다
// — 화면별 렌더 분기는 만들지 않는다(stage-17 DoD).
interface MarkdownViewProps {
  content: string | null | undefined
  // 본문 글자 크기(F36-⑨) — 문서 상세·학습 모드 본문에서만 넘긴다. 그 외는 기본(default).
  scale?: FontScale
  // 인쇄 뷰(F22) 전용 — true면 임베드는 펼침 그대로, fold는 항상 펼침, hide는 항상 공개로
  // 렌더한다(설계 §4.19 ⑥). 인쇄가 아닌 화면에서는 항상 기본값 false.
  printMode?: boolean
  // 이 content가 속한 문서 자신의 식별자(설계 §4.19 ④ 순환·자기 참조 방어에 사용) — 알 수
  // 있는 호출부(문서 상세·퀴즈·복습 등, 이미 조회한 DocumentDetail/QuizQuestion 등에서)는
  // 반드시 넘긴다. 모르면 생략 가능(자기 참조만 순환 검출에서 못 잡을 뿐 그 외 동작은 동일).
  docNo?: string
  docId?: number
  // ---- 아래 2개는 내부 재귀 전용(EmbedCard가 채워 넘긴다) — 외부 호출부는 지정하지 않는다.
  depth?: number
  visited?: DocRefChainEntry[]
}

// 토큰 기반 크기 클래스만 사용(색상·크기 하드코딩 금지) — small/default/large 3단계.
const SCALE_CLASS: Record<FontScale, string> = {
  small: 'text-xs',
  default: 'text-sm',
  large: 'text-base',
}

const REMARK_PLUGINS = [remarkGfm, remarkDirective, remarkDocDirectives, remarkDocRefs]
const REHYPE_PLUGINS = [rehypeSlug, rehypeHighlight]

// 코드 하이라이트는 rehype-highlight의 클래스만 붙이고 색은 토큰(prose 스타일)으로 제어한다.
// (규칙 #1: 색상 하드코딩 금지 — hljs 테마 CSS 대신 토큰 기반 최소 스타일만 사용)
export default function MarkdownView({
  content,
  scale = 'default',
  printMode = false,
  docNo,
  docId,
  depth = 0,
  visited = [],
}: MarkdownViewProps) {
  // 방문 집합(설계 §4.19 ④) — 이 content를 렌더하는 문서 자신을 조상 경로에 포함시킨다.
  // (docNo를 모르면 자기 참조만 못 잡을 뿐 나머지 조상 순환 검출은 그대로 동작한다.)
  const chain: DocRefChainEntry[] = docNo ? [...visited, { docNo, id: docId ?? -1 }] : visited

  const { embeds, links } = useMemo(() => extractDocRefs(content), [content])
  const cycleDocNos = useMemo(() => new Set(chain.map((c) => c.docNo)), [chain])
  // 깊이 상한 2 초과분은 카드 대신 링크로 강등하므로(설계 §4.19 ④) 그 doc_no도 같은 배치에
  // 합쳐 "깊이당 1회" 해석 호출 원칙을 지킨다. 순환에 걸린 임베드는 애초에 다시 조회할 필요가
  // 없다(조상에서 이미 아는 문서) — 배치에서 제외해 무의미한 fetch를 만들지 않는다.
  const cardEmbeds = depth < 2 ? embeds.filter((d) => !cycleDocNos.has(d)) : []
  const demotedEmbeds = depth >= 2 ? embeds : []
  const batchDocNos = [...new Set([...cardEmbeds, ...links, ...demotedEmbeds])]

  const resolveQuery = useResolveEmbeds(batchDocNos)
  const resolveMap = useMemo(() => {
    const map = new Map(resolveQuery.data?.items.map((i) => [i.doc_no, i]))
    return map
  }, [resolveQuery.data])
  const missingSet = useMemo(() => new Set(resolveQuery.data?.missing ?? []), [resolveQuery.data])

  if (!content) {
    return <p className={`${SCALE_CLASS[scale]} text-muted`}>내용 없음</p>
  }

  return (
    <div
      className={`markdown-body max-w-none ${SCALE_CLASS[scale]} leading-relaxed text-primary [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-bg [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_img]:max-w-full [&_img]:rounded [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-bg [&_pre]:p-3 [&_table]:w-full [&_ul]:list-disc`}
    >
      <DocRefContext.Provider
        value={{
          resolveMap,
          missingSet,
          loading: resolveQuery.isLoading,
          chain,
          depth,
          printMode,
          scale,
        }}
      >
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_REF_COMPONENTS as unknown as Components}
        >
          {content}
        </ReactMarkdown>
      </DocRefContext.Provider>
    </div>
  )
}
