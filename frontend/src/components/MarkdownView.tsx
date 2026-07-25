import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { FontScale } from '../api/types'

interface MarkdownViewProps {
  content: string | null | undefined
  // 본문 글자 크기(F36-⑨) — 문서 상세·학습 모드 본문에서만 넘긴다. 그 외는 기본(default).
  scale?: FontScale
}

// 토큰 기반 크기 클래스만 사용(색상·크기 하드코딩 금지) — small/default/large 3단계.
const SCALE_CLASS: Record<FontScale, string> = {
  small: 'text-xs',
  default: 'text-sm',
  large: 'text-base',
}

// 코드 하이라이트는 rehype-highlight의 클래스만 붙이고 색은 토큰(prose 스타일)으로 제어한다.
// (규칙 #1: 색상 하드코딩 금지 — hljs 테마 CSS 대신 토큰 기반 최소 스타일만 사용)
export default function MarkdownView({ content, scale = 'default' }: MarkdownViewProps) {
  if (!content) {
    return <p className={`${SCALE_CLASS[scale]} text-muted`}>내용 없음</p>
  }
  return (
    <div className={`markdown-body max-w-none ${SCALE_CLASS[scale]} leading-relaxed text-primary [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-bg [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_img]:max-w-full [&_img]:rounded [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-bg [&_pre]:p-3 [&_table]:w-full [&_ul]:list-disc`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
