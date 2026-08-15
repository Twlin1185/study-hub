// 에디터 v2 — **노트 편집 표면의 BlockNote 스키마**(M33 / stage-33 F-2)
//
// 여기서 하는 일 3가지:
//   ① **코어 팔레트로 스키마를 좁힌다** — 어댑터(`editor2/adapter`)가 앱 블록으로 무손실 왕복시킬
//      수 있는 블록·스타일만 남긴다. 스키마가 좁으면 슬래시 메뉴·툴바·붙여넣기가 **자동으로**
//      그 범위 안에서만 동작한다(메뉴 코드를 건드리지 않는다 — 슬래시 메뉴 커스터마이즈는 M35).
//   ② **표현 색을 스키마에서 제거한다** — BlockNote 기본 `textColor`/`backgroundColor`(스타일·블록
//      prop 모두)는 하드코딩 hex 팔레트(`COLORS_DEFAULT`)를 끌고 들어온다. **불변 규칙 5**(색은
//      `tokens.css` 토큰만)와 정면으로 부딪히므로 채택하지 않는다. 글자색·형광펜은 앱 방언
//      (`:t`·`==`)으로 stage-34에서 토큰 기반으로 이식한다.
//   ③ 한국어 사전(`ko`)·테마 결선(`tokens.css` 변수 경유)을 한 곳에 모은다.
//
// 제거하는 기본 블록: audio·video·file·toggleListItem·pageBreak — 앱 블록 스키마에 대응물이 없다
// (`docs/02-design/study-app.design.screens.md` §5.16 "편집 표면의 기능 범위" S33 행).
import {
  BlockNoteSchema,
  type BlockNoteEditor,
  type PartialBlock,
  createBulletListItemBlockSpec,
  createCheckListItemBlockSpec,
  createCodeBlockSpec,
  createDividerBlockSpec,
  createHeadingBlockSpec,
  createImageBlockSpec,
  createNumberedListItemBlockSpec,
  createParagraphBlockSpec,
  createQuoteBlockSpec,
  createTableBlockSpec,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import { ko } from '@blocknote/core/locales'
import type { BnBlock } from '../adapter'
import { useThemeStore } from '../../stores/theme'
import './notes.css'

/** 코드 블록 언어 목록 — **드롭다운 선택만**(규약 E: 펜스 정보 문자열 자유 입력 UI 없음). */
const CODE_LANGUAGES = {
  text: { name: '일반 텍스트' },
  javascript: { name: 'JavaScript', aliases: ['js'] },
  typescript: { name: 'TypeScript', aliases: ['ts'] },
  python: { name: 'Python', aliases: ['py'] },
  java: { name: 'Java' },
  c: { name: 'C' },
  cpp: { name: 'C++', aliases: ['c++'] },
  csharp: { name: 'C#', aliases: ['cs'] },
  sql: { name: 'SQL' },
  html: { name: 'HTML' },
  css: { name: 'CSS' },
  json: { name: 'JSON' },
  yaml: { name: 'YAML', aliases: ['yml'] },
  bash: { name: 'Shell', aliases: ['sh', 'shell'] },
  markdown: { name: 'Markdown', aliases: ['md'] },
}

/**
 * 블록 prop에서 **표현 전용 기본 prop**(정렬·글자색·바탕색)을 걷어낸다.
 * 근거: 앱 블록 스키마에 대응 필드가 없어 저장 시 사라지는 값이다 — 저장되지 않는 버튼을
 * 노출하는 것이 더 나쁘다. BlockNote 툴바는 prop 유무를 보고 버튼을 숨기므로(TextAlignButton ·
 * ColorStyleButton 실측) 스키마를 좁히는 것만으로 UI가 정합해진다.
 */
function withoutPresentationProps<T extends { config: { propSchema: Record<string, unknown> } }>(
  spec: T,
): T {
  const propSchema = { ...spec.config.propSchema }
  delete propSchema.textAlignment
  delete propSchema.textColor
  delete propSchema.backgroundColor
  return { ...spec, config: { ...spec.config, propSchema } } as T
}

// 규약 E — 펜스 정보 문자열(```js title=a 의 `title=a`)은 **보존만** 한다. 편집 UI는 만들지
// 않으며(자유 입력 금지), 어댑터가 이 prop으로 왕복시킨다.
function codeBlockSpecWithInfo() {
  const base = withoutPresentationProps(createCodeBlockSpec({ supportedLanguages: CODE_LANGUAGES }))
  return {
    ...base,
    config: {
      ...base.config,
      propSchema: { ...base.config.propSchema, info: { default: '' as string } },
    },
  }
}

export const noteSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: withoutPresentationProps(createParagraphBlockSpec()),
    // 접기 헤딩(isToggleable)은 끈다 — 앱 블록 스키마에 대응물이 없어 저장 시 사라지는 상태다.
    heading: withoutPresentationProps(createHeadingBlockSpec({ allowToggleHeadings: false })),
    bulletListItem: withoutPresentationProps(createBulletListItemBlockSpec()),
    numberedListItem: withoutPresentationProps(createNumberedListItemBlockSpec()),
    checkListItem: withoutPresentationProps(createCheckListItemBlockSpec()),
    quote: withoutPresentationProps(createQuoteBlockSpec()),
    codeBlock: codeBlockSpecWithInfo(),
    table: withoutPresentationProps(createTableBlockSpec()),
    image: withoutPresentationProps(createImageBlockSpec()),
    divider: createDividerBlockSpec(),
  },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: {
    // 코어 인라인 서식 5종만 — 색 스타일 2종은 위 ② 사유로 제외한다.
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
    underline: defaultStyleSpecs.underline,
    strike: defaultStyleSpecs.strike,
    code: defaultStyleSpecs.code,
  },
})

/** 편집기 UI 문자열 — 한국어 사전(슬래시 메뉴 한글 필터가 성립한다. stage-31 실측). */
export const noteDictionary = ko

export type NotePartialBlock = PartialBlock<
  typeof noteSchema.blockSchema,
  typeof noteSchema.inlineContentSchema,
  typeof noteSchema.styleSchema
>

export type NoteBlockNoteEditor = BlockNoteEditor<
  typeof noteSchema.blockSchema,
  typeof noteSchema.inlineContentSchema,
  typeof noteSchema.styleSchema
>

// ---------------------------------------------------------------- 어댑터 ↔ 편집기 경계(캐스트 2곳)
//
// 어댑터는 규약 B에 따라 `@blocknote/*`를 타입으로도 import하지 않는다(편집기 청크 유출 방지 —
// R37). 그래서 어댑터의 **구조 타입**(BnBlock)과 편집기의 **스키마 파생 타입**을 잇는 캐스트가
// 필요하며, 그 지점을 여기 두 함수로 **한 곳에 모아 둔다**(화면 코드에는 캐스트가 없다).
// 두 표현이 실제로 일치하는지는 `scripts/s33-adapter-roundtrip.mjs`(계열 ④ BN 출발 왕복)와
// 편집 표면 스모크가 지킨다.

/** 어댑터 산출 블록 → 편집기 초기 콘텐츠. */
export function asEditorBlocks(blocks: BnBlock[]): NotePartialBlock[] {
  return blocks as unknown as NotePartialBlock[]
}

/** 편집기 문서 → 어댑터 입력. */
export function asAdapterBlocks(blocks: unknown): BnBlock[] {
  return blocks as BnBlock[]
}

/**
 * BlockNoteView에 넘길 테마. 색 자체는 `notes.css`가 전부 `tokens.css` 변수로 결선하므로
 * 이 값은 편집기 내부의 명암 계열 선택만 담당한다(라이트/다크 전환이 편집 표면에도 즉시 반영).
 */
export function useEditorTheme(): 'light' | 'dark' {
  const mode = useThemeStore((s) => s.mode)
  if (mode === 'dark') return 'dark'
  if (mode === 'light') return 'light'
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}
