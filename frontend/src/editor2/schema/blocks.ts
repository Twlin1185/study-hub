// 에디터 v2 — **앱 소유 중립 블록 스키마** (M32 / stage-32 규약 B · editor-v2.plan.md §5.2)
//
// 이 파일이 스키마 **정본**이다. BlockNote 스키마가 아니라 앱이 소유하는 중립 모델이며(R33 절연),
// 엔진을 갈아끼워도(후보 C 전환) 저장분이 인질이 되지 않는다. 이 파일은 **런타임 의존이 없다** —
// 타입 + 값 도메인 화이트리스트 재수출 + 순수 헬퍼뿐이고, `@blocknote/*`는 단 하나도 import하지
// 않는다(M32 계약: 프로덕션 코드의 BlockNote import 0건. 말미 매핑 표는 문서 주석일 뿐이다).
//
// 값 도메인(색·크기)은 기존 `components/markdown/palette.ts`의 화이트리스트를 **그대로** 쓴다 —
// 편집기 v2가 새 색 규칙을 만들지 않는다(불변 규칙 5: 색은 토큰만. 자유색도 `#rrggbb`만 통과시켜
// tokens.css의 `--u-ink`/`--u-bg` 경로로만 렌더된다).
import { isHexColor, isPaletteColor, isTextSize } from '../../components/markdown/palette'
import type { PaletteColor, TextSize } from '../../components/markdown/palette'

export type { PaletteColor, TextSize }

/**
 * 스키마 버전 — 저장분 마이그레이션의 기준(문서 루트에 함께 기록된다).
 *
 * **stage-37에서 `toc`·`webEmbed`가 늘어도 1을 유지한다**(규약 E): 추가는 **가산적**이라
 * 기존 저장분은 전건 그대로 유효하고(필드 제거·의미 변경 0) 단일 클라이언트 로컬 앱이라
 * 구버전 소비자가 없다 — 버전 승격·마이그레이션·Alembic·§4.29 얕은 검증 전부 무변.
 */
export const BLOCK_SCHEMA_VERSION = 1

// ---------------------------------------------------------------- 문서 루트·공통

/**
 * 캡처 파이프라인(v2.x 녹취·사진·필기) **예약 필드** — 계획서 §5.4 "캡처(v2.x 예약)" 이행.
 * M32에서는 **필드 정의만** 두고 소비하는 코드를 만들지 않는다(YAGNI + 예약 계약).
 */
export interface BlockProvenance {
  /** 블록이 어디서 왔는가(녹취 정제·사진 OCR·필기·LLM 반입 등) */
  kind?: string
  /** 원본 캡처 시각(ISO 8601) */
  capturedAt?: string
  /** 정제에 쓰인 모델 식별자 */
  model?: string
  /** `sources/` 원본 파일 참조(불변 규칙 4 — 원본은 절대 수정하지 않는다) */
  sourceRef?: string
}

/** 블록 공통 메타 — 지금은 provenance 하나만 예약한다. */
export interface BlockMeta {
  provenance?: BlockProvenance
}

/** 모든 블록의 공통 필드. `id`는 **동형성 비교에서 제외**된다(변환 때마다 새로 부여). */
export interface BlockBase {
  id: string
  meta?: BlockMeta
}

/** 문서 루트 — 저장 단위(`documents.content_blocks` 후보 형태). */
export interface BlockDocument {
  version: typeof BLOCK_SCHEMA_VERSION
  blocks: Block[]
}

// ---------------------------------------------------------------- 인라인 모델

/**
 * `:t[…]{c= bg= s=}`의 **원본 속성 쌍**(순서 보존).
 * 화이트리스트 밖 값(`c=rebeccapurple`)·미지 속성도 여기 살아 있어야 왕복에서 소실되지 않는다
 * (기존 `inlineModel.attrPairs` 관례 계승 — 직렬화의 단일 출처).
 */
export type AttrPair = [key: string, value: string]

/** 감싸기 서식(불리언 마크) — 기존 `inlineModel.WrapMark`와 1:1이되 이름만 편집기 v2 용어로. */
export type MarkName = 'bold' | 'italic' | 'strike' | 'underline' | 'highlight' | 'spoiler'

/**
 * 마크 직렬화 우선순위 = 같은 구간을 여러 마크가 덮을 때의 **바깥→안쪽** 순서.
 * 결정적 출력(규약 A-2 고정점)을 위해 고정하며, 순서 자체에도 **의미가 있다**:
 * F52 마이크로 3종(`++`·`==`·`||`)은 `remarkStudy`가 표식 안쪽 내용을 **다시 파싱하지 않는다**
 * (`==**x**==`의 `**`는 평문이다). 따라서 마이크로 마크는 반드시 **가장 안쪽**이어야 하고
 * CommonMark 마크(굵게·기울임·취소선)가 바깥을 감싸야 왕복이 성립한다(`**==x==**` ○ / `==**x**==` ×).
 */
export const MARK_ORDER: readonly MarkName[] = [
  'bold',
  'italic',
  'strike',
  'underline',
  'highlight',
  'spoiler',
]

/** 마크명 ↔ 방언 Markdown 표식(정규 표기). `__`·`_`는 읽기만 하고 쓰지 않는다. */
export const MARK_MARKER: Record<MarkName, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  underline: '++',
  highlight: '==',
  spoiler: '||',
}

/**
 * 인라인 노드에 걸린 서식 집합.
 * - 불리언 마크 6종: `**굵게**` `*기울임*` `~~취소~~` `++밑줄++` `==형광==` `||스포일러||`
 * - `t`: `:t[…]{…}` 속성 쌍(중첩된 `:t`는 **안쪽 값이 이김**으로 하나로 접힌다)
 */
export interface InlineStyles {
  bold?: true
  italic?: true
  strike?: true
  underline?: true
  highlight?: true
  spoiler?: true
  t?: AttrPair[]
}

/** `:t` 속성 중 **화이트리스트를 통과한 것만** 해석한 뷰(툴바 상태 표시용 — 읽기 전용). */
export interface TextStyleView {
  /** 글자색 — 팔레트 7색 이름 또는 `#rrggbb` */
  ink?: string
  /** 바탕색(형광펜) — 팔레트 7색 이름 또는 `#rrggbb` */
  bg?: string
  size?: TextSize
}

/** `:t` 속성 쌍 → 화이트리스트 해석 뷰. 값 도메인은 `palette.ts`가 단일 출처다. */
export function interpretTextStyle(pairs: AttrPair[] | undefined): TextStyleView {
  const view: TextStyleView = {}
  for (const [key, value] of pairs ?? []) {
    if (key === 'c' && (isPaletteColor(value) || isHexColor(value))) view.ink = value
    else if (key === 'bg' && (isPaletteColor(value) || isHexColor(value))) view.bg = value
    else if (key === 's' && isTextSize(value)) view.size = value
  }
  return view
}

/**
 * 두 `:t` 속성 목록을 병합한다 — **안쪽(inner)이 이긴다**, 키 첫 등장 순서는 유지.
 * (`:t[:t[x]{c=red}]{bg=yellow}` 중첩을 하나로 접는 기존 `collapseStyleChain` 규칙과 동일.)
 */
export function mergeAttrPairs(outer: AttrPair[] | undefined, inner: AttrPair[] | undefined): AttrPair[] {
  const out: AttrPair[] = (outer ?? []).map(([k, v]): AttrPair => [k, v])
  for (const [key, value] of inner ?? []) {
    const idx = out.findIndex(([k]) => k === key)
    if (idx === -1) out.push([key, value])
    else out[idx] = [key, value]
  }
  return out
}

/** 참조 칩 대상 종류 — F43 문법 3종과 1:1. */
export type RefChipKind =
  /** `[[DOC-0012]]` — 문서 링크 칩 */
  | 'doc'
  /** `[[#절 제목]]` — 문서 안 앵커 칩 */
  | 'anchor'
  /** `![[DOC-0007]]` — 문단 **안**에 남은 임베드(문단 밖으로 승격되면 `docEmbed` 블록) */
  | 'embed'

interface InlineBase {
  /** 이 노드에 걸린 **절대** 서식 집합(부모에서 상속된 것 포함) */
  styles?: InlineStyles
}

/** 평문 run — `text`에는 **개행이 없다**(줄바꿈은 softBreak/hardBreak 노드로 분리). */
export interface TextInline extends InlineBase {
  type: 'text'
  text: string
}

/** `` `코드 스팬` `` */
export interface CodeInline extends InlineBase {
  type: 'inlineCode'
  value: string
}

/** `$a^2+b^2$` */
export interface MathInline extends InlineBase {
  type: 'inlineMath'
  value: string
}

/** `[텍스트](url "title")` · GFM 자동 링크 */
export interface LinkInline extends InlineBase {
  type: 'link'
  url: string
  title?: string
  children: InlineNode[]
}

/**
 * 참조 칩(F43) — `[[DOC-0012]]` · `[[DOC-0012|라벨]]` · `[[#절 제목]]` · `![[DOC-0007]]`.
 *
 * **규약 C(§5.4 ④ 교차 검증)**: `label`은 **사용자 지정 별칭이 있을 때만** 존재한다.
 * 라벨 추종형(대상 문서 제목을 따라가는 기본 칩)은 `label`을 **저장하지 않는다** — 제목 문자열이
 * 스키마에 굳으면 §5.4 ③(제목 변경 추종)과 모순되기 때문이다. 즉
 * `label === undefined` ⇔ 추종형(`[[DOC-0012]]`), `label !== undefined` ⇔ 지정 라벨(`[[DOC-0012|라벨]]`).
 *
 * **라벨 문자 제약(M32 실측 — §5.4 ②-(a) "선택 텍스트를 라벨로 승계"의 입력 조건)**: 라벨은
 * `[[…|라벨]]`의 `[^\]|\n]+` 안에 실리고 그 전에 **remark-parse가 먼저** 그 줄을 훑으므로,
 * `]` `|` 개행(구조적 금지) 외에 **인라인 문법을 여는 문자**(`*` `` ` `` `~` `$` · `:t[`류 directive ·
 * 강조가 되는 위치의 `_`)가 들어가면 칩이 붕괴하거나 통째로 사라진다. 가장자리 공백도 파서가 버린다.
 * 즉 **그 도메인 밖 문자를 포함하지 않는 라벨에 한해** 왕복이 성립하며, M33 칩 UX가 승계 텍스트를
 * 이 도메인으로 걸러야 한다(검증: `s32-roundtrip-blocks.mjs` 계열 ⑥이 도메인을 기계로 고정).
 */
export interface RefChipInline extends InlineBase {
  type: 'refChip'
  ref: RefChipKind
  /** doc/embed = `DOC-0012` · anchor = 헤딩 텍스트 */
  target: string
  /** `|별칭` — **있을 때만**. 없으면 라벨은 대상 제목을 추종한다(저장하지 않는다). */
  label?: string
}

/**
 * 문단 **안**의 이미지 — `앞 ![캡션](/images/x.png) 뒤`.
 * (문단이 이미지 하나로만 이뤄지면 `image` **블록**으로 승격된다.)
 * 규약 B는 이미지를 블록으로 등재했지만, 기존 코퍼스에 "이미지 혼재 문단"이 있어 인라인 표현이
 * 없으면 무손실 왕복이 불가능하다 → 게이트 규칙의 **스키마 보강 원칙**에 따라 인라인형을 추가했다.
 */
export interface ImageInline extends InlineBase {
  type: 'inlineImage'
  url: string
  alt: string
  title?: string
  /** 규약 E — `{w=400}` 부속 표기(px) */
  width?: number
  /** 규약 E — `h=`는 **예약**(비율 유지 원칙이라 1차 미사용) */
  height?: number
}

/** 경성 줄바꿈(`  \n` 또는 `\`+개행) — 정규 표기는 `\`+개행. */
export interface HardBreakInline extends InlineBase {
  type: 'hardBreak'
}

/** 문단 안의 단순 줄바꿈(개행 1개) */
export interface SoftBreakInline extends InlineBase {
  type: 'softBreak'
}

/**
 * 팔레트 밖 **인라인** mdast 노드(원시 html·각주 참조·참조식 링크 등)의 원문 슬라이스 보존
 * (규약 D의 인라인 짝) — 투영은 원문 그대로라 왕복이 자명하게 성립한다.
 */
export interface FallbackInline extends InlineBase {
  type: 'inlineFallback'
  /** 원문 Markdown 슬라이스(그대로 재출력한다 — 이스케이프 금지) */
  markdown: string
  /** 원 mdast 노드 타입(집계·M34 지연 마이그레이션용) */
  nodeType: string
}

export type InlineNode =
  | TextInline
  | CodeInline
  | MathInline
  | LinkInline
  | RefChipInline
  | ImageInline
  | HardBreakInline
  | SoftBreakInline
  | FallbackInline

// ---------------------------------------------------------------- 블록 모델

/** `평범한 문단` */
export interface ParagraphBlock extends BlockBase {
  type: 'paragraph'
  content: InlineNode[]
}

/** `## 제목` (1~6) */
export interface HeadingBlock extends BlockBase {
  type: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
  content: InlineNode[]
}

/**
 * `- 항목` / `1. 항목` / `- [x] 항목`(GFM 체크박스).
 * 목록은 mdast처럼 컨테이너(list)로 싸지 않고 **listItem 단위 + children 중첩**으로 둔다
 * (BlockNote 구조와 동형 → M33 어댑터가 얇아진다). list 컨테이너 ↔ listItem 변환은 변환기가 흡수.
 */
export interface ListItemBlock extends BlockBase {
  type: 'listItem'
  ordered: boolean
  /** GFM 체크박스 — 없으면 일반 항목 */
  checked?: boolean
  /** 순서 목록 **그룹의 첫 항목**에만 의미가 있다(시작 번호. 생략 = 1) */
  start?: number
  /**
   * **목록 그룹 경계** — 앞 형제가 같은 `ordered`의 listItem이어도 "여기서 새 목록이 시작된다"는 표시.
   * 평평한 listItem 모델에서 인접한 두 목록을 구분하는 유일한 수단이다. CommonMark는 마커·구분자
   * 변경(`- …` 다음의 `* …`, `1. …` 다음의 `1) …`)을 **목록 분리 표기**로 읽으므로, 직렬화기가
   * 이 표시를 보고 인접 그룹에 다른 마커를 방출해 원본의 분리를 복원한다.
   */
  groupBreak?: true
  /** 느슨한 목록(항목 사이 빈 줄) — 그룹 전체에 같은 값이 실린다 */
  spread?: boolean
  /** 항목의 첫 문단 인라인(첫 자식이 문단이 아니면 빈 배열) */
  content: InlineNode[]
  /** 중첩 목록·항목 안 추가 블록 */
  children?: Block[]
}

/** `> 인용` */
export interface QuoteBlock extends BlockBase {
  type: 'quote'
  children: Block[]
}

/** ```lang 펜스 코드 블록 */
export interface CodeBlock extends BlockBase {
  type: 'codeBlock'
  language?: string
  /** 펜스 정보 문자열에서 lang 뒤에 남은 나머지(예: ```js title=a → `title=a`) */
  info?: string
  code: string
}

/** GFM 표 — `rows[0]`이 헤더 행이다. */
export interface TableBlock extends BlockBase {
  type: 'table'
  /** 열 정렬(`:---` 등) — 열 수만큼, 지정 없으면 null */
  align: (('left' | 'right' | 'center') | null)[]
  rows: InlineNode[][][]
}

/** `$$ … $$` */
export interface MathBlock extends BlockBase {
  type: 'mathBlock'
  value: string
}

/**
 * `![캡션](/images/…){w=400}` — 문단이 이미지 하나로만 이뤄진 경우.
 * 규약 E: 크기 부속 표기는 image 노드 **직후** `{w=<px>}`(`h=`는 예약).
 */
export interface ImageBlock extends BlockBase {
  type: 'image'
  url: string
  /** 캡션 = alt 텍스트 */
  alt: string
  title?: string
  width?: number
  height?: number
}

/** `---` */
export interface DividerBlock extends BlockBase {
  type: 'divider'
}

/**
 * `:::note[제목] … :::` (F52 콜아웃 · §4.19 ② fold/hide도 같은 컨테이너 directive 계열).
 * `variant`는 directive 이름 그대로(note·warn·tip·fold·hide…) — 화이트리스트는 렌더러 몫이다.
 */
export interface CalloutBlock extends BlockBase {
  type: 'callout'
  variant: string
  /** `[제목]` 라벨 — 없으면 빈 문자열 */
  title: string
  /** `{…}` 속성 쌍(있을 때만) */
  attrs?: AttrPair[]
  children: Block[]
}

/** `![[DOC-0007]]` — 문단 **밖** 블록으로 승격된 문서 임베드(remarkStudy의 기존 동작 수용). */
export interface DocEmbedBlock extends BlockBase {
  type: 'docEmbed'
  target: string
  /** `|별칭`(있을 때만) — refChip과 같은 규약 C 계약 */
  label?: string
}

/**
 * `::toc` — 목차 블록(M35 / stage-37 규약 A).
 *
 * **저장 데이터가 0이다**(prop 없음). 목차 내용을 저장하지 않는 것이 "자동 갱신" 요구의 답이다 —
 * 렌더 시점에 같은 표면의 heading 블록을 훑어 파생하므로 갱신 동기화 문제가 애초에 없다
 * (저장하면 헤딩을 고칠 때마다 stale). 정규형 = `::toc`(속성 없음 — leaf directive).
 * **속성 동반(`::toc{…}`)은 스키마에 흡수하지 않는다** — 기존 미지 directive 폴백 관례
 * (`sourceFallback`)로 원문을 보존한다(손실 0 · 새 속성 예약도 하지 않는다, YAGNI).
 */
export interface TocBlock extends BlockBase {
  type: 'toc'
}

/**
 * 웹 임베드 메타 캐시 — **api §4.30 응답 필드와 1:1**(스네이크 → 카멜 표기만 다르다).
 * `url`·`title`은 블록 자신의 필드라 여기 없다. 값은 전부 **문자열|null**(추출 실패 필드 = null ·
 * 부분 성공 허용)이며, 응답을 **그대로** 담는 캐시다(서버는 DB에 쓰지 않는다 — 블록 JSON이 소스).
 */
export interface WebEmbedMeta {
  description?: string | null
  siteName?: string | null
  image?: string | null
  favicon?: string | null
  fetchedAt?: string | null
}

/**
 * `::web{url="…" title="…"}` — 웹 임베드 블록(M35 / stage-37 규약 B · api §4.30).
 *
 * 정규형 직렬화는 **`url`·`title` 두 속성만**이고 값은 항상 큰따옴표로 감싼다(결정적 출력·고정점).
 * `url` 부재·미지 속성 동반은 스키마에 흡수하지 않고 `sourceFallback`으로 원문을 보존한다.
 * **메타 캐시는 프로젝션 비대상**(directive에는 url·title만 실린다) — 명문화된 강등 손실이며,
 * 전환 문서는 블록 JSON이 소스라 실손실은 0이다(md→블록 재전환 시 meta 없음 = 텍스트 카드로
 * 시작 → [메타 새로고침]으로 복원).
 *
 * **`meta` 필드가 공통 `BlockBase.meta`(provenance 예약)와 같은 이름인 것에 대하여**: 스키마
 * 정본은 블록마다 메타 주머니를 **하나만** 둔다 — 이 블록에서는 그 주머니가 공통 예약 필드(
 * `provenance`)와 §4.30 캐시를 **함께** 담는 교집합 타입으로 넓어진다(가산 확장 · 기존 타입 무변).
 * 어댑터는 이 주머니를 통째로 BlockNote **prop**(JSON 문자열)으로 실어 왕복시킨다 —
 * 다른 블록의 `meta`가 타는 사이드카 경로를 쓰지 않는다(stage-37 F-2 "사이드카 불요").
 */
export interface WebEmbedBlock extends BlockBase {
  type: 'webEmbed'
  url: string
  /** `title="…"` — **있을 때만**(§4.30 응답의 null 제목은 키를 넣지 않는 것으로 수렴). */
  title?: string
  meta?: BlockMeta & WebEmbedMeta
}

/**
 * 팔레트 밖 mdast 노드(원시 html·각주 정의·leaf directive 등)의 **원문 Markdown 슬라이스** 보존
 * (규약 D). 투영 = 원문 그대로이므로 왕복이 자명하게 성립하고, M34 지연 마이그레이션의 안전망이다.
 * 발생 건수는 검증 스크립트가 집계·보고한다(팔레트 표본에서는 0이 계약).
 */
export interface SourceFallbackBlock extends BlockBase {
  type: 'sourceFallback'
  markdown: string
  nodeType: string
}

/**
 * `::::columns{n=2} … ::::` — **고정 열 다단**(Notion 컬럼) 컨테이너 블록(stage-41 2차 규약 A).
 *
 * 1차의 흐름형(CSS `column-count` — 텍스트가 단을 넘어 흐르는 Word식 "단")을 **대체**한다:
 * 정규 상태에서 `children`은 전부 `ColumnBlock`이고 각 단은 **독립 내용**이다(어느 블록이
 * 몇째 단에 있는지가 곧 데이터다 — 1차와 달리 저장된다).
 *
 * `count`는 `n=` **표기**이고 **정본은 `column` 자식 수**다(`normalizeColumnsBlock` 불변식 ②가
 * 둘을 맞춘다). 유입 값은 그대로 보존한다: 범위 밖(`n=4`)도 자르지 않고 **그 수만큼 열**로
 * 그린다(결정 ② — 1차의 "3단 상한 표시 강등"은 폐기).
 * `n`이 **정수 표기가 아니거나 결손**이면 `count`는 기본 2로 두고 원문 쌍을 `attrs`에 남겨
 * 재직렬화에서 원문(`{n=abc}`)이 되살아나게 한다(값 보존 원칙 — 콜아웃 `attrs` 전례).
 *
 * `attrs` = `n` 이외의 미지 속성 쌍 통짜 보존(콜아웃 전례 · 순서 유지).
 * **중첩 금지는 입력 UI의 계약**이고 스키마는 막지 않는다 — 유입 데이터의 중첩(columns 안
 * columns · 콜아웃 안 columns)은 그대로 보존하고 렌더도 그대로 grid로 그린다(결정 ③).
 */
export interface ColumnsBlock extends BlockBase {
  type: 'columns'
  /** 단 수 표기 — **정본은 `column` 자식 수**다(정규화가 맞춘다). 유입 값 보존(정규 도메인 2·3). */
  count: number
  /** `n` 이외의 미지 속성 쌍(있을 때만) */
  attrs?: AttrPair[]
  children: Block[]
}

/**
 * `:::column … :::` — 고정 열 다단의 **단 하나**(stage-41 2차 규약 A).
 *
 * **prop·attrs가 없다** — 단은 "몇째 자리인가 + 무엇을 담는가"가 전부다.
 * 정규 상태의 불변식은 `schema/columnsNormalize.ts`가 세운다:
 * 부모는 항상 `columns`이고(아니면 자식을 제자리에 승격 — 불변식 ④) 자식은 **1개 이상**이다
 * (빈 단 = 빈 문단 1개 — 편집 표면에서 클릭으로 들어갈 자리가 있어야 한다. 불변식 ③).
 */
export interface ColumnBlock extends BlockBase {
  type: 'column'
  children: Block[]
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListItemBlock
  | QuoteBlock
  | CodeBlock
  | TableBlock
  | MathBlock
  | ImageBlock
  | DividerBlock
  | CalloutBlock
  | DocEmbedBlock
  // ---- 신규 커스텀(M35 / stage-37 — 가산 확장이라 `BLOCK_SCHEMA_VERSION`은 1 그대로다)
  | TocBlock
  | WebEmbedBlock
  | SourceFallbackBlock
  // ---- 고정 열 다단(stage-41 — 가산 확장이라 `BLOCK_SCHEMA_VERSION`은 1 그대로다)
  | ColumnsBlock
  | ColumnBlock

export type BlockType = Block['type']

// ---------------------------------------------------------------- 헬퍼

/** 자식 블록을 갖는 블록인가(중첩 순회용). */
export function blockChildren(block: Block): Block[] {
  if (
    block.type === 'quote' ||
    block.type === 'callout' ||
    block.type === 'columns' ||
    block.type === 'column'
  )
    return block.children
  if (block.type === 'listItem') return block.children ?? []
  return []
}

/** 인라인 내용을 갖는 블록인가. */
export function blockContent(block: Block): InlineNode[] | null {
  if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'listItem') return block.content
  return null
}

/** 빈 문서(새 문서 생성 시 기본값). */
export function emptyDocument(): BlockDocument {
  return { version: BLOCK_SCHEMA_VERSION, blocks: [] }
}

// ---------------------------------------------------------------- BlockNote 표현 가능성 매핑 (1-5)
//
// 근거: `docs/01-plan/editor-v2.m31-analysis.md` §2.1(코어 실측)·§2.3(부재 목록)·§5.1(커스텀 스펙
// 스파이크 3종 성립). **어댑터 코드는 M33에서 만든다 — 이 표는 문서일 뿐이고 이 파일은
// `@blocknote/*`를 import하지 않는다.**
//
// | 앱 블록/인라인      | BlockNote 대응                                   | 비고 |
// |---------------------|--------------------------------------------------|------|
// | paragraph           | 내장 `paragraph`                                  | 1:1 |
// | heading(1~6)        | 내장 `heading`(h1~h6)                             | 1:1 (§2.1) |
// | listItem(bullet)    | 내장 `bulletListItem` + children 중첩             | 1:1 — 스키마를 listItem 단위로 둔 이유 |
// | listItem(ordered)   | 내장 `numberedListItem`(start 지원)               | 1:1 |
// | listItem(checked)   | 내장 `checkListItem`                              | 1:1 |
// | quote               | 내장 `quote`                                      | 1:1 |
// | codeBlock           | 내장 `codeBlock`(하이라이트 = 무료 `@blocknote/code-block`) | lang 속성 1:1 |
// | table               | 내장 `table`(헤더·정렬 옵션 활성)                  | 정렬 = 셀 옵션으로 매핑 |
// | mathBlock           | `@blocknote/math-block`(0.54.0 신규, MPL) 또는 커스텀 블록 | 성숙도 검증은 M33(§2.2) |
// | image               | 내장 `image`(캡션 + `previewWidth` 크기)          | width ↔ previewWidth (규약 E) |
// | divider             | 커스텀 블록(코어 미내장 — §5.4 "가로 구분선" 행)   | createReactBlockSpec 1개 |
// | callout             | 커스텀 블록(공식 Alert Block 예제 경로 — §2.3)     | variant/title = props |
// | docEmbed            | 커스텀 블록(원자) — 참조 칩 스파이크(§5.1)의 블록판 | content:"none" |
// | toc                 | 커스텀 블록(원자·prop 0) — 렌더 시점 파생          | stage-37 F-1 |
// | webEmbed            | 커스텀 블록(원자) — url/title/meta prop           | stage-37 F-1 · meta = §4.30 캐시 |
// | sourceFallback      | 커스텀 블록(원문 보존·읽기 전용)                   | M34 지연 마이그레이션 안전망 |
// | bold/italic/strike  | 내장 스타일                                        | 1:1 |
// | underline           | 내장 `underline`                                   | 1:1 |
// | highlight           | `createReactStyleSpec` propSchema:"string"(§5.1)   | 값 보유 스타일 성립 확인됨 |
// | spoiler             | `createReactStyleSpec` propSchema:"boolean"(§5.1)  | 클릭 공개 동작 확인됨 |
// | t(ink/bg/size)      | `createReactStyleSpec` propSchema:"string" × 3     | 색 값은 팔레트 ∪ #rrggbb 그대로 |
// | inlineCode          | 내장 `code` 스타일                                  | 1:1 |
// | inlineMath          | `@blocknote/math-block` 인라인 또는 커스텀 인라인 콘텐츠 | M33 |
// | link                | 내장 링크                                          | title은 어댑터에서 props로 |
// | refChip(3종)        | `createReactInlineContentSpec` content:"none"(§5.1) | 원자 칩 — 스파이크에서 성립 |
// | inlineImage         | **미대응**(BlockNote 이미지는 블록 전용)            | M33 결정 필요: 블록 승격 vs 원자 인라인 커스텀 |
// | hardBreak/softBreak | ProseMirror 텍스트 개행(에디터 표면에서 자연 처리)  | 어댑터에서 분해·재조립 |
