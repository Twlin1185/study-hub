// 슬래시 메뉴 **전수표**(stage-36 F-5 · 규약 E) — 이 파일이 메뉴에 뜨는 항목의 단일 출처다.
//
// 규약 E: "항목 추가/삭제가 아니라 **정합·발견성 마감**". 그래서 여기서 하는 일은 셋뿐이다.
//   ① **순서·그룹을 한 표로 고정**한다 — 기본 항목은 BlockNote가 코드 순서대로 뱉고(제목이 맨 앞),
//      방언 항목은 stage-34가 뒤에 덧붙이기만 해서 "기본 블록"이 목록 한가운데 묻혀 있었다.
//   ② **한국어 라벨·검색 별칭을 메운다** — 한국어 사전(`ko`)의 별칭은 한쪽 언어만 채워진 곳이 있다
//      (예: 표는 title `표`·aliases `['표']`뿐이라 `table`로 검색되지 않았다). 양방향으로 채운다.
//   ③ **스키마에 있는데 메뉴에 없던 항목을 잇는다** — 수식 2종(`@blocknote/math-block`의
//      `getMathSlashMenuItems`)과 콜아웃 5종은 스키마·툴바에는 있는데 슬래시 메뉴 경로가 없었다.
//      팔레트를 넓히는 것이 아니라 **이미 있는 블록으로 가는 길을 여는 것**이다.
//
// 표에 없는 기본 항목(BlockNote가 나중에 늘리는 것)은 **버리지 않고** 표 뒤에 그대로 붙인다 —
// 업그레이드가 조용히 기능을 지우지 않게 하는 안전판이다.
import type { DefaultReactSuggestionItem } from '@blocknote/react'
import { CALLOUT_VARIANTS } from '../../adapter'
import { insertCalloutBlock } from '../refPicker/insert'
import type { RefKind } from '../refPicker/RefTitleContext'
import type { NoteBlockNoteEditor } from '../schema'
import { insertTocBlock } from '../toc/insert'

/** 그룹 이름 — 사전(`ko`)이 쓰는 이름을 그대로 재사용한다(새 이름을 만들지 않는다). */
const GROUP = {
  basic: '기본 블록',
  heading: '제목',
  advanced: '고급',
  callout: '콜아웃',
  media: '미디어',
  ref: '참조',
  etc: '기타',
} as const

type SlashRow =
  | { source: 'core'; key: string; group: string; aliases?: string[] }
  | { source: 'math'; slot: 'block' | 'inline'; group: string; aliases: string[] }
  | { source: 'callout'; variant: string; group: string }
  | { source: 'ref'; mode: RefKind; group: string }
  | { source: 'toc'; group: string }
  | { source: 'webEmbed'; group: string }

/**
 * ---------------------------------------------------------------- 슬래시 메뉴 전수표
 * 위에서 아래가 곧 메뉴 순서다. `aliases`는 사전 값에 **더한다**(덮어쓰지 않는다).
 */
const SLASH_TABLE: SlashRow[] = [
  // --- 기본 블록
  { source: 'core', key: 'paragraph', group: GROUP.basic, aliases: ['text', '텍스트', '문단'] },
  { source: 'core', key: 'bullet_list', group: GROUP.basic, aliases: ['bullet', '점', '불릿'] },
  { source: 'core', key: 'numbered_list', group: GROUP.basic, aliases: ['number', '숫자'] },
  { source: 'core', key: 'check_list', group: GROUP.basic, aliases: ['todo', '할일', '체크'] },
  { source: 'core', key: 'quote', group: GROUP.basic, aliases: ['인용', '인용문'] },
  { source: 'core', key: 'code_block', group: GROUP.basic, aliases: ['코드', '코드블록'] },
  { source: 'core', key: 'divider', group: GROUP.basic, aliases: ['구분선', '수평선', '선'] },
  // --- 제목
  // 제목은 1~6단계가 모두 스키마에 있다(Markdown `#`~`######`와 1:1). 기본 사전은 4~6을 별도
  // 그룹('소제목')으로 떼어 목록 맨 끝에 흘려보내는데, 그러면 `/제목5`를 찾다가 표·이미지 아래에서
  // 만나게 된다. 한 그룹으로 모은다.
  { source: 'core', key: 'heading', group: GROUP.heading },
  { source: 'core', key: 'heading_2', group: GROUP.heading },
  { source: 'core', key: 'heading_3', group: GROUP.heading },
  { source: 'core', key: 'heading_4', group: GROUP.heading },
  { source: 'core', key: 'heading_5', group: GROUP.heading },
  { source: 'core', key: 'heading_6', group: GROUP.heading },
  // --- 고급
  { source: 'core', key: 'table', group: GROUP.advanced, aliases: ['table', '테이블', '격자'] },
  // 목차(방언 · stage-37 규약 A) — 저장 데이터 0 · 자기 표면 헤딩에서 렌더 시점 파생.
  { source: 'toc', group: GROUP.advanced },
  { source: 'math', slot: 'block', group: GROUP.advanced, aliases: ['수식', '수학', '라텍스'] },
  { source: 'math', slot: 'inline', group: GROUP.advanced, aliases: ['수식', '수학', '라텍스'] },
  // --- 콜아웃(방언 · stage-34 이식분)
  ...CALLOUT_VARIANTS.map((variant): SlashRow => ({ source: 'callout', variant, group: GROUP.callout })),
  // --- 미디어
  { source: 'core', key: 'image', group: GROUP.media, aliases: ['그림', '사진'] },
  // 웹 임베드(방언 · stage-37 규약 B) — URL 입력 패널을 연다(§4.30 조회는 패널이 담당).
  { source: 'webEmbed', group: GROUP.media },
  // --- 참조(방언 · 규약 A ①)
  { source: 'ref', mode: 'doc', group: GROUP.ref },
  { source: 'ref', mode: 'anchor', group: GROUP.ref },
  { source: 'ref', mode: 'embed', group: GROUP.ref },
  // --- 기타
  { source: 'core', key: 'emoji', group: GROUP.etc, aliases: ['이모티콘'] },
]

/** 콜아웃 5종의 라벨·설명·별칭 — 툴바(`NoteFormattingToolbar`)의 라벨과 같은 말을 쓴다. */
const CALLOUT_ITEM: Record<string, { title: string; subtext: string; aliases: string[] }> = {
  note: { title: '콜아웃 · 참고', subtext: '파란 참고 상자', aliases: ['callout', '콜아웃', 'note', '참고', '정보'] },
  warn: { title: '콜아웃 · 주의', subtext: '주의를 끄는 상자', aliases: ['callout', '콜아웃', 'warn', '주의', '경고'] },
  tip: { title: '콜아웃 · 팁', subtext: '도움말 상자', aliases: ['callout', '콜아웃', 'tip', '팁', '요령'] },
  fold: { title: '콜아웃 · 더 보기', subtext: '접어 두는 상자', aliases: ['callout', '콜아웃', 'fold', '접기', '더보기'] },
  hide: { title: '콜아웃 · 숨김', subtext: '숨겨 두는 상자', aliases: ['callout', '콜아웃', 'hide', '숨김', '가리기'] },
}

/** 참조 3종(규약 A ①) — stage-34 `refSlashItems`의 내용을 전수표로 옮겨 온 것이다. */
const REF_ITEM: Record<RefKind, { title: string; subtext: string; aliases: string[] }> = {
  doc: { title: '참조', subtext: '문서 링크 칩을 넣습니다', aliases: ['ref', 'link', 'doc', '문서', '링크', '칩'] },
  anchor: {
    title: '앵커',
    subtext: '이 문서의 제목(heading)으로 가는 칩을 넣습니다',
    aliases: ['anchor', '절', '제목', '목차', '앵커'],
  },
  embed: { title: '임베드', subtext: '문서 임베드 블록을 넣습니다', aliases: ['embed', '문서임베드', '삽입', '임베드'] },
}

/**
 * **런타임에는 있는데 타입에는 없는 `key`**를 되살린 지역 타입.
 *
 * `DefaultReactSuggestionItem = Omit<DefaultSuggestionItem, 'key'> & {icon?}`이라 타입에서만
 * `key`가 빠져 있다. 실제 값에는 그대로 있다(실측 — react의 `getDefaultReactSlashMenuItems`는
 * 코어 항목을 `{...item, icon}`으로 펼치므로 `key: 'heading' | 'table' | …`가 살아 있다).
 * 우리 전수표는 **로케일에 흔들리지 않는 식별자**가 필요하므로(제목으로 매칭하면 사전이 바뀌는
 * 순간 표가 조용히 무너진다) 이 키로 잇는다.
 */
type KeyedSlashItem = DefaultReactSuggestionItem & { key?: string }

function withAliases(item: DefaultReactSuggestionItem, extra?: string[]): string[] | undefined {
  if (!extra || extra.length === 0) return item.aliases
  return [...new Set([...(item.aliases ?? []), ...extra])]
}

/**
 * 메뉴에 실을 항목 전체를 **전수표 순서대로** 조립한다.
 *
 * 기본 항목(`@blocknote/react`)과 수식 항목(`@blocknote/math-block`)은 **인자로 받는다** —
 * 이 모듈이 편집기 패키지를 런타임에 import하지 않게 하려는 것이고(검증 스크립트가 Node에서
 * 그대로 불러 표를 검사할 수 있다), 조립 규칙과 조달 경로를 분리해 두면 표만 따로 시험된다.
 *
 * 필터는 호출자(`SuggestionMenuController`)의 `filterSuggestionItems`가 한다
 * (title·aliases 부분 일치 — BlockNote 기본 동작).
 */
export function composeSlashItems(
  defaults: DefaultReactSuggestionItem[],
  mathItems: DefaultReactSuggestionItem[],
  editor: NoteBlockNoteEditor,
  openPicker: (mode: RefKind) => void,
  openWebEmbedPanel: () => void,
): DefaultReactSuggestionItem[] {
  const core = new Map<string, KeyedSlashItem>()
  for (const item of defaults as KeyedSlashItem[]) {
    if (item.key !== undefined) core.set(item.key, item)
  }

  // `@blocknote/math-block`은 [수식 블록, 인라인 수식] 순으로 돌려준다(스키마에 있는 것만).
  const mathBySlot: Record<'block' | 'inline', DefaultReactSuggestionItem | undefined> = {
    block: mathItems[0],
    inline: mathItems[1],
  }

  const out: KeyedSlashItem[] = []
  for (const row of SLASH_TABLE) {
    if (row.source === 'core') {
      const item = core.get(row.key)
      if (!item) continue
      core.delete(row.key)
      out.push({ ...item, group: row.group, aliases: withAliases(item, row.aliases) })
      continue
    }
    if (row.source === 'math') {
      const item = mathBySlot[row.slot]
      if (!item) continue
      out.push({
        ...item,
        key: row.slot === 'block' ? 'math_block' : 'inline_math',
        group: row.group,
        aliases: [...new Set([...(item.aliases ?? []), ...row.aliases])],
      })
      continue
    }
    if (row.source === 'callout') {
      const meta = CALLOUT_ITEM[row.variant]
      if (!meta) continue
      out.push({
        key: `callout_${row.variant}`,
        title: meta.title,
        subtext: meta.subtext,
        aliases: meta.aliases,
        group: row.group,
        onItemClick: () => insertCalloutBlock(editor, row.variant, ''),
      })
      continue
    }
    if (row.source === 'toc') {
      out.push({
        key: 'toc',
        title: '목차',
        subtext: '이 표면의 제목(heading)으로 만든 목차',
        aliases: ['toc', '목차', '차례', 'contents'],
        group: row.group,
        onItemClick: () => insertTocBlock(editor),
      })
      continue
    }
    if (row.source === 'webEmbed') {
      out.push({
        key: 'web_embed',
        title: '웹 임베드',
        subtext: 'URL을 입력해 북마크 카드를 넣습니다',
        aliases: ['web', '웹', '웹임베드', '링크카드', 'embed', 'url'],
        group: row.group,
        onItemClick: () => openWebEmbedPanel(),
      })
      continue
    }
    const meta = REF_ITEM[row.mode]
    out.push({
      key: `ref_${row.mode}`,
      title: meta.title,
      subtext: meta.subtext,
      aliases: meta.aliases,
      group: row.group,
      onItemClick: () => openPicker(row.mode),
    })
  }

  // 전수표에 없는 기본 항목은 뒤에 그대로 붙인다(업그레이드로 늘어난 항목을 잃지 않는다).
  for (const item of core.values()) out.push(item)
  return out
}
