import { useContext, useMemo, useRef } from 'react'
import type { ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import remarkDirective from 'remark-directive'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import 'katex/dist/katex.min.css'
import type { FontScale } from '../api/types'
import { EmbedResolver } from './markdown/embedResolver'
import { EmbedRenderContext } from './markdown/embedContext'
import type { EmbedRenderCtx } from './markdown/embedContext'
import { remarkStudyDirectives, remarkStudyRefs } from './markdown/remarkStudy'
import { FOLD_DEFAULT_LABEL, HIDE_DEFAULT_LABEL } from './markdown/refSyntax'
import EmbedCard from './markdown/EmbedCard'
import { DocLinkChip, HeadingAnchorChip } from './markdown/RefChips'
import { FoldSection, HideSection } from './markdown/DirectiveBlocks'

interface MarkdownViewProps {
  content: string | null | undefined
  // 본문 글자 크기(F36-⑨) — 문서 상세·학습 모드 본문에서만 넘긴다. 그 외는 기본(default).
  scale?: FontScale
  // 이 본문이 속한 문서의 doc_no (F43) — 순환 검출 방문 집합의 시작점.
  // 넘기지 않아도 임베드는 동작하지만 "자기 자신 임베드" 같은 최소 순환은 잡히지 않는다.
  docNo?: string | null
  // 단일 개행(Enter 1회)을 <br>로 렌더할지(stage-25, F51). 기본 true — 표본 확인 후
  // 해설 등 특정 용도만 끄고 싶으면 이 prop을 false로 넘기는 1줄 변경으로 되돌릴 수 있다.
  breaks?: boolean
}

// 토큰 기반 크기 클래스만 사용(색상·크기 하드코딩 금지) — small/default/large 3단계.
const SCALE_CLASS: Record<FontScale, string> = {
  small: 'text-xs',
  default: 'text-sm',
  large: 'text-base',
}

type MarkdownOptions = ComponentProps<typeof ReactMarkdown>

// 참조·directive 처리는 **공용 렌더러 1곳**에서만 한다 — 화면별 분기 금지(설계 §4.19 구현 앵커).
// remark-math는 remark-gfm과 나란히(둘 다 파싱 단계의 구문 확장 — 서로 문법 겹침 없음, 순서 무관 실측
// 확인). remark-breaks는 맨 뒤에 둔다 — remarkStudyDirectives·remarkStudyRefs가 아직 쪼개지지 않은
// 원문 텍스트 노드를 대상으로 directive/참조(`[[…]]`)를 정규식으로 찾으므로, 개행을 <br> 노드로 미리
// 쪼개는 breaks가 그보다 먼저 돌면(텍스트 노드 분절) 참조 스캔에 불필요한 위험이 생긴다 — 항상 breaks
// 는 study 변환 이후에 실행되도록 고정한다(순서를 임시 unified 파이프라인으로 실측 확인 — 이 조합은
// 크래시·오검출 없음을 확인했고, 아래 순서가 더 안전한 방향).
const REMARK_PLUGINS_NO_BREAKS: MarkdownOptions['remarkPlugins'] = [
  remarkGfm,
  remarkMath,
  remarkDirective,
  remarkStudyDirectives,
  remarkStudyRefs,
]
const REMARK_PLUGINS_WITH_BREAKS: MarkdownOptions['remarkPlugins'] = [
  ...(REMARK_PLUGINS_NO_BREAKS ?? []),
  remarkBreaks,
]
// rehype-katex는 rehype-highlight보다 먼저 둔다 — remark-math는 수식을
// `<code class="language-math math-inline|math-display">`로 내보내므로(remark-math 명세), 블록 수식은
// `<pre><code>` 형태가 되어 rehype-highlight의 대상 조건(코드 블록)과 겹친다. highlight가 먼저 돌면
// "math" 언어를 모르는 언어로 취급해 무의미한 하이라이트 시도·진단 메시지를 남기므로, katex가 먼저 그
// 노드를 실제 수식 요소로 치환한 뒤 highlight가 남은 진짜 코드 블록만 처리하게 한다(rehype-katex
// README의 권장 사용 예와 동일한 순서 — 임시 unified 파이프라인으로 두 순서 모두 정상 동작함을
// 실측했으나, 진단 메시지 없이 더 안전한 이 순서를 채택).
// rehype-slug = 헤딩 id 부여(github-slugger) — `[[#절 제목]]` 앵커의 매칭 기준.
// rehype-katex는 파싱 실패한 수식을 `.katex-error` 배경 없는 텍스트로 렌더하며 기본 errorColor가
// 하드코딩 색(#cc0000)이다 — 규칙 #1(색상 하드코딩 금지) 위반을 피하려 토큰(--wrong)으로 지정한다.
// CSS 커스텀 프로퍼티는 inline style에서도 정상 해석되므로 문자열 그대로 넘겨도 된다.
const REHYPE_PLUGINS: MarkdownOptions['rehypePlugins'] = [
  [rehypeKatex, { errorColor: 'var(--wrong)' }],
  rehypeHighlight,
  rehypeSlug,
]

// 플러그인이 심어 둔 data-* 속성을 hast 노드에서 읽는다.
function attr(node: unknown, key: string): string {
  const properties = (node as { properties?: Record<string, unknown> } | undefined)?.properties
  const value = properties?.[key]
  return typeof value === 'string' ? value : ''
}

// 코드 하이라이트는 rehype-highlight의 클래스만 붙이고 색은 토큰(prose 스타일)으로 제어한다.
// (규칙 #1: 색상 하드코딩 금지 — hljs 테마 CSS 대신 토큰 기반 최소 스타일만 사용)
export default function MarkdownView({ content, scale = 'default', docNo, breaks = true }: MarkdownViewProps) {
  const remarkPlugins = useMemo<MarkdownOptions['remarkPlugins']>(
    () => (breaks ? REMARK_PLUGINS_WITH_BREAKS : REMARK_PLUGINS_NO_BREAKS),
    [breaks],
  )
  // 임베드 해석 캐시는 "열람 컴포넌트 수명" 동안만 산다(설계 §4.19 ③ — 전역 영속 캐시 금지).
  // 루트 MarkdownView가 인스턴스를 만들고, 임베드 카드 아래의 중첩 렌더는 그것을 공유한다.
  const parent = useContext(EmbedRenderContext)
  const ownResolver = useRef<EmbedResolver | null>(null)
  if (!parent && ownResolver.current === null) ownResolver.current = new EmbedResolver()
  const resolver = parent?.resolver ?? (ownResolver.current as EmbedResolver)

  const ctx = useMemo<EmbedRenderCtx>(() => {
    const base = parent?.ancestors ?? []
    const ancestors = docNo && !base.includes(docNo) ? [...base, docNo] : base
    return { resolver, depth: parent?.depth ?? 0, ancestors }
  }, [parent, resolver, docNo])

  const components = useMemo<Components>(
    () => ({
      div({ node, children, ...props }) {
        // 임베드 카드 — 플러그인이 문단 밖 블록으로 끌어올린 studyRef(embed).
        const refKind = attr(node, 'data-ref-kind')
        if (refKind === 'embed') {
          return (
            <EmbedCard
              docNo={attr(node, 'data-ref-target')}
              alias={attr(node, 'data-ref-alias')}
              renderContent={(childContent, childDocNo) => (
                <MarkdownView content={childContent} scale={scale} docNo={childDocNo} breaks={breaks} />
              )}
            />
          )
        }
        const directive = attr(node, 'data-directive')
        if (directive === 'fold') {
          return (
            <FoldSection label={attr(node, 'data-directive-label') || FOLD_DEFAULT_LABEL}>
              {children}
            </FoldSection>
          )
        }
        if (directive === 'hide') {
          return (
            <HideSection label={attr(node, 'data-directive-label') || HIDE_DEFAULT_LABEL}>
              {children}
            </HideSection>
          )
        }
        // 알 수 없는 directive(:::foo)는 스타일 없이 내용만 렌더한다(크래시 금지 — §4.19 ②).
        if (directive) return <div>{children}</div>
        return <div {...props}>{children}</div>
      },
      span({ node, children, ...props }) {
        const refKind = attr(node, 'data-ref-kind')
        if (refKind === 'link') {
          return <DocLinkChip docNo={attr(node, 'data-ref-target')} alias={attr(node, 'data-ref-alias')} />
        }
        if (refKind === 'anchor') {
          return (
            <HeadingAnchorChip heading={attr(node, 'data-ref-target')} alias={attr(node, 'data-ref-alias')} />
          )
        }
        if (attr(node, 'data-directive')) return <span>{children}</span>
        return <span {...props}>{children}</span>
      },
    }),
    [scale, breaks],
  )

  if (!content) {
    return <p className={`${SCALE_CLASS[scale]} text-muted`}>내용 없음</p>
  }

  return (
    <div
      data-markdown-root=""
      className={`markdown-body max-w-none ${SCALE_CLASS[scale]} leading-relaxed text-primary [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-bg [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_img]:max-w-full [&_img]:rounded [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-bg [&_pre]:p-3 [&_table]:w-full [&_ul]:list-disc [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden`}
    >
      <EmbedRenderContext.Provider value={ctx}>
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={REHYPE_PLUGINS} components={components}>
          {content}
        </ReactMarkdown>
      </EmbedRenderContext.Provider>
    </div>
  )
}
