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
// 수식(규약 F) — `@blocknote/math-block` 0.54.0 채택(MPL-2.0 · 전이 의존 GPL 0건 실측).
// GPL-3.0인 `@blocknote/xl-*`는 이 패키지의 **optional peerDependencies에만** 있고 메인 엔트리의
// 정적 import 목록에 0건이라 설치·번들 어느 쪽에도 들어오지 않는다(서브패스 `./pdf-exporter` 등으로만
// 노출 — 우리는 import하지 않는다). 저장소 public = 배포 간주(D10)라 이 확인이 도입의 전제였다.
import { createReactInlineMathSpec, createReactMathBlockSpec } from '@blocknote/math-block'
import type { BnBlock } from '../adapter'
import { useThemeStore } from '../../stores/theme'
import {
  createCalloutBlockSpec,
  createDocEmbedBlockSpec,
  createSourceFallbackBlockSpec,
} from './specs/blocks'
import { createTocBlockSpec } from './specs/tocBlock'
import { createWebEmbedBlockSpec } from './specs/webEmbedBlock'
import {
  inlineFallbackSpec,
  inlineImageSpec,
  lineBreakSpec,
  refChipInlineSpec,
} from './specs/inline'
import { highlightStyleSpec, spoilerStyleSpec, textStyleSpec } from './specs/styles'
// 스타일(`notes.css`)은 **편집 표면을 그리는 화면**이 import한다(NoteEditPage) — 이 모듈은
// 스펙 구성만 담아 DOM·번들러 없이도 로드될 수 있어야 한다. 검증 스크립트
// (`scripts/s33-adapter-roundtrip.mjs` 계열 ⑤)가 **바로 이 스펙 구성 그대로** 실제 BlockNote
// 스키마를 만들어 왕복시키기 때문이다(별도 선언을 두면 캐스트 회귀를 못 잡는다).

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

// 규약 I 흡수 ③ — 내장 image 스펙에 `title`·`height` prop을 **더한다**(`codeBlockSpecWithInfo`와
// 같은 전례). 편집 UI는 만들지 않고 **왕복 보존만** 한다: `title:''` ⇔ undefined · `height:0` ⇔ undefined.
// 이것으로 `image:title`·`image:height` 미지원 보고가 사라진다.
function imageSpecWithTitleAndHeight() {
  const base = withoutPresentationProps(createImageBlockSpec())
  return {
    ...base,
    config: {
      ...base.config,
      propSchema: {
        ...base.config.propSchema,
        title: { default: '' as string },
        height: { default: 0 },
      },
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
    image: imageSpecWithTitleAndHeight(),
    divider: createDividerBlockSpec(),
    // ---- 방언(stage-34 G-3 · G-7)
    mathBlock: createReactMathBlockSpec(),
    callout: createCalloutBlockSpec(),
    docEmbed: createDocEmbedBlockSpec(),
    toc: createTocBlockSpec(),
    webEmbed: createWebEmbedBlockSpec(),
    sourceFallback: createSourceFallbackBlockSpec(),
  },
  inlineContentSpecs: {
    // 내장 2종(text·link)만 가져온다 — 기본 인라인 팔레트를 넓히지 않는다.
    ...defaultInlineContentSpecs,
    // ---- 방언(stage-34 G-4 스펙 부분 · G-6 · 규약 I 흡수 ①)
    refChip: refChipInlineSpec,
    inlineImage: inlineImageSpec,
    inlineFallback: inlineFallbackSpec,
    lineBreak: lineBreakSpec,
    math: createReactInlineMathSpec(),
  },
  styleSpecs: {
    // 코어 인라인 서식 5종 — BlockNote **기본 색 스타일 2종**은 위 ② 사유로 계속 제외한다.
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
    underline: defaultStyleSpecs.underline,
    strike: defaultStyleSpecs.strike,
    code: defaultStyleSpecs.code,
    // ---- 방언 3종(stage-34 G-1) — 색은 전부 `tokens.css` 토큰 경유(불변 규칙 5).
    highlight: highlightStyleSpec,
    spoiler: spoilerStyleSpec,
    t: textStyleSpec,
  },
})

/**
 * 수식 사전(`@blocknote/math-block`) — **한국어 이식**(stage-36 F-5 "한국어 라벨 정리").
 *
 * 이 패키지는 `editor.dictionary.math ?? en`을 읽는다(`getMathDictionary` 실측). 지금까지 우리는
 * `math` 키를 넣지 않아 수식 블록의 자리표시 문구가 영어("Add a LaTeX equation")로 떴고, 슬래시
 * 메뉴 항목도 영어 라벨이었다. 사전을 채우는 것은 **항목을 늘리는 것이 아니라 이미 있는 블록의
 * 라벨을 맞추는 일**이다(규약 E: 정합·발견성 마감).
 */
const MATH_KO = {
  block: {
    add_source_text: 'LaTeX 수식을 입력하세요',
    input_placeholder: 'E = mc^2',
    preview_error_text: '수식이 올바르지 않습니다 (눌러서 수정)',
  },
  inline: {
    add_source_text: 'LaTeX 수식을 입력하세요',
    input_placeholder: 'E = mc^2',
    preview_error_text: '수식이 올바르지 않습니다 (눌러서 수정)',
  },
  slash_menu: {
    math_block: {
      title: '수식 블록',
      subtext: '한 줄을 통째로 쓰는 수식',
      aliases: ['math', 'latex', 'formula', 'equation'],
      group: '고급',
    },
    inline_math: {
      title: '인라인 수식',
      subtext: '문장 안에 넣는 수식',
      aliases: ['math', 'latex', 'formula', 'equation'],
      group: '고급',
    },
  },
  block_type_select: { name: '수식' },
  exporter: { invalid_formula: (formula: string) => `올바르지 않은 수식 "${formula}"` },
}

/** 편집기 UI 문자열 — 한국어 사전(슬래시 메뉴 한글 필터가 성립한다. stage-31 실측). */
export const noteDictionary = { ...ko, math: MATH_KO }

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
