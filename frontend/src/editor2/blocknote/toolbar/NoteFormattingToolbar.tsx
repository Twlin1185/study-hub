// 방언 서식 툴바 (stage-34 G-2 · 규약 C·E, 규약 A ① 진입점 하나).
//
// **기본 버튼은 그대로 둔다** — `getFormattingToolbarItems()`를 먼저 깔고 방언 컨트롤을 **덧붙인다**
// (툴바 전면 재구성은 이 단계 범위가 아니다). **예외 1건 = 기본 밑줄 버튼을 우리 아이콘 버튼으로
// 치환**(아래 `DEFAULT_UNDERLINE_ITEM_KEY` 주석 참조 — 규약 C 이행이지 전면 커스터마이즈가 아니다).
// 방언 컨트롤은 다음 4묶음이다:
//   ① 마이크로 3종(밑줄·형광펜·스포일러) — **상호 배타 래퍼 1곳**(`microMarks.ts`) 경유 · active 표시.
//   ② `:t` 색·크기(글자색 `c` · 바탕색 `bg` · 크기 `s`) — 값 도메인은 `palette.ts` 단일 출처.
//   ③ [참조] — 피커를 연다(규약 A ①).
//   ④ 콜아웃 삽입 — variant 고정 목록 + 제목 실시간 검증(규약 E).
//
// 색 리터럴 0 — 스와치까지 전부 토큰 유틸(`bg-mark-*`·`text-ink-*`)이고, 팔레트 밖 hex는
// `tokens.css`가 계산하는 커스텀 프로퍼티(`--u-ink`/`--u-bg`)로만 흘린다(불변 규칙 5).
import { Suspense, lazy, useState } from 'react'
import type { CSSProperties, ReactNode, SyntheticEvent } from 'react'
import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useComponentsContext,
  useEditorSelectionChange,
} from '@blocknote/react'
import {
  HEX_INK_CLASS,
  HEX_INK_VAR,
  HEX_MARK_CLASS,
  HEX_MARK_VAR,
  INK_TEXT_CLASS,
  MARK_BG_CLASS,
  PALETTE_COLORS,
  PALETTE_LABEL,
  TEXT_SIZES,
  TEXT_SIZE_LABEL,
  isHexColor,
  isPaletteColor,
} from '../../../components/markdown/palette'
import { CALLOUT_VARIANTS } from '../../adapter'
import { isSafeRefText, normalizeRefText, refTextRejection } from '../../schema/refDomain'
import type { NotePartialBlock } from '../schema'
import { columnsInsertBlocked, insertCalloutBlock, insertColumnsBlock } from '../refPicker/insert'
import { useRefPickerCommands } from '../refPicker/RefUiProvider'
import { useActiveStyleRecord } from './activeStyles'
import { ATOM_GUARD_TOOLTIP, selectionHasAtomInline } from './atoms'
import { shouldShowTextFormattingGroup, useSelectedBlockTypes } from './blockFilter'
import { TextSizeIcon, UnderlineIcon } from './icons'
import type { CropTarget } from './imageCropEligibility'
import { computeCropTarget } from './imageCropEligibility'
import { MICRO_MARK_LABEL, applyMicroMark, clearMicroMark, toggleMicroMark } from './microMarks'
import type { MicroMark } from './microMarks'
import { readTextStyleView, setTextStyleKey } from './textStyle'
import { useNoteEditor } from './useNoteEditor'

// 크롭 UI(canvas 인코딩 로직)는 **lazy 청크로만** 들여온다(R37 — 초기 청크 증가 금지). 버튼 자체는
// 선택 판정(가벼운 함수)만 하므로 초기 청크에 있어도 무방하다.
const ImageCropDialog = lazy(() => import('./ImageCropDialog'))

/**
 * 기본 툴바의 **밑줄 버튼 키**(`@blocknote/react`의 `getFormattingToolbarItems()`가 박아 넣는 값).
 *
 * **왜 걷어내는가 — 규약 C 이행**: 그 버튼은 `BasicTextStyleButton basicTextStyle="underline"`이고,
 * 클릭 시 `editor.toggleStyles({ underline: true })`를 **직접** 부른다. 즉 마이크로 마크 상호 배타
 * 래퍼(`microMarks.ts`)를 타지 않으므로 `==형광==` 위에서 누르면 `underline`+`highlight`가 공존하고
 * (규약 C 위반 → 방언 Markdown 왕복 붕괴), 덤으로 밑줄 버튼이 두 개 뜬다.
 * 우리가 **같은 기능의 대체 버튼**(`MicroMarkButton mark="underline"`)을 바로 옆에 제공하므로
 * 기능이 줄지 않는다 — 이것은 "슬래시/툴바 전면 커스터마이즈"(M35)가 아니라 규약 C의 이행이다.
 *
 * **stage-46 F-4(FB-18)**: 걷어내고 방언군 끝에 다시 붙이던 것을 **그 자리에 그대로 치환**한다.
 * 기본 순서가 `bold → italic → underline → strike`라(0.54 `getFormattingToolbarItems` 실측),
 * 치환하면 밑줄이 사용자가 기대하는 자리(굵게·기울임 옆)로 돌아온다. 기본 항목의 상대 순서는
 * 여전히 바꾸지 않는다 — 자리 하나를 **같은 자리에서** 갈아 끼울 뿐이다.
 */
const DEFAULT_UNDERLINE_ITEM_KEY = 'underlineStyleButton'

/** 기본 밑줄 자리에 들어가는 우리 버튼의 항목 키(텍스트 서식군 소속 판정에 쓴다). */
const MICRO_UNDERLINE_ITEM_KEY = 'microUnderline'

/**
 * **원자 서식 가드를 씌울 코어 버튼**(stage-36 F-8 — stage-34가 남긴 알려진 한계의 해소).
 *
 * 이 넷은 선택 구간에 **마크/링크를 얹는** 기본 버튼이다. 참조 칩·인라인 이미지·수식처럼
 * 마크를 실어 나를 수 없는 원자가 선택에 섞여 있으면, 화면에는 먹히는 것처럼 보이지만
 * 저장·재로드에서 그 원자의 서식만 사라진다(`atoms.ts` 참조). 방언 버튼처럼 **눈에 보이게**
 * 막는다 — 우리가 만든 버튼이 아니라 기본 버튼이므로 `isDisabled`를 넘길 자리가 없어,
 * 활성화 이벤트를 캡처 단계에서 삼키는 **덮개**(`AtomGuardShield`)를 씌운다.
 * (링크도 포함한다: 링크 적용은 선택 구간을 링크 인라인으로 감싸므로 원자가 더 크게 다친다.)
 */
const ATOM_GUARDED_DEFAULT_KEYS: ReadonlySet<string> = new Set([
  'boldStyleButton',
  'italicStyleButton',
  'strikeStyleButton',
  'createLinkButton',
])

/**
 * **텍스트 서식군의 코어 항목 키**(stage-40 규약 B ②) — "코어 bold/italic/strike/link"는
 * 원자 가드 대상 4종과 정확히 일치한다(교집합 재사용 — 별도 목록을 만들지 않는다). 이 키를 가진
 * 기본 항목만 `hideTextGroup`일 때 걸러진다. 나머지 기본 항목(블록 타입 선택·표 셀 병합·파일
 * 버튼·정렬·중첩·댓글 등)은 규약 B ②의 "블록 기능군"이라 항상 남는다.
 */
const TEXT_GROUP_DEFAULT_KEYS: ReadonlySet<string> = new Set([
  ...ATOM_GUARDED_DEFAULT_KEYS,
  // 기본 밑줄 자리를 대신 차지한 우리 버튼(stage-46 F-4) — 원래 그 자리가 텍스트 서식군이었다.
  MICRO_UNDERLINE_ITEM_KEY,
])

/** 활성화(클릭·Enter·Space)를 캡처 단계에서 삼키는 덮개 — 시각적으로도 흐리게 보인다. */
function AtomGuardShield({ children }: { children: ReactNode }) {
  const swallow = (event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <span
      title={ATOM_GUARD_TOOLTIP}
      aria-disabled
      className="editor2-atom-guarded inline-flex"
      onMouseDownCapture={swallow}
      onClickCapture={swallow}
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' || event.key === ' ') swallow(event)
      }}
    >
      {children}
    </span>
  )
}

/**
 * 기본 항목 목록 — 밑줄 자리만 **우리 아이콘 버튼으로 치환**하고(규약 C·stage-46 F-4),
 * 원자 선택일 때 마크 버튼에 가드를 씌운다. 치환 버튼은 `isDisabled`를 직접 받으므로
 * `AtomGuardShield` 덮개가 필요 없다(우리 버튼이라 비활성 자리가 있다).
 */
function defaultToolbarItems(blocked: boolean) {
  let replaced = false
  const items = getFormattingToolbarItems().map((item) => {
    if (item.key === DEFAULT_UNDERLINE_ITEM_KEY) {
      replaced = true
      return (
        <MicroMarkButton
          key={MICRO_UNDERLINE_ITEM_KEY}
          mark="underline"
          blocked={blocked}
          icon={<UnderlineIcon />}
        />
      )
    }
    return blocked && item.key !== null && ATOM_GUARDED_DEFAULT_KEYS.has(item.key) ? (
      <AtomGuardShield key={item.key}>{item}</AtomGuardShield>
    ) : (
      item
    )
  })
  // 방어(stage-46 검토 경미 ③): BlockNote 업그레이드로 기본 밑줄 키가 사라지면 치환이 무산되어
  // 밑줄 버튼 자체가 소실된다(래퍼 경유 경로 소실 = 규약 C 위반). 그때는 기본군 끝에 폴백 삽입한다.
  if (!replaced) {
    items.push(
      <MicroMarkButton key={MICRO_UNDERLINE_ITEM_KEY} mark="underline" blocked={blocked} icon={<UnderlineIcon />} />,
    )
  }
  return items
}

/** 다단 중첩 차단 사유(착수 전 결정 ③) — 원자 가드와 같은 "비활성 + 사유" 관례. */
const COLUMNS_GUARD_TOOLTIP = '다단 안·콜아웃 안에는 다단을 넣을 수 없습니다'

const CALLOUT_LABEL: Record<string, string> = {
  note: '참고',
  warn: '주의',
  tip: '팁',
  fold: '더 보기',
  hide: '숨김',
}

/** Mantine Toolbar의 focus trap 때문에 즉시 focus를 되돌리면 삼켜진다(BlockNote 기본 버튼과 같은 관례). */
function refocus(focus: () => void): void {
  setTimeout(focus)
}

/** 팔레트 색·hex 견본 — 색은 전부 토큰 유틸/커스텀 프로퍼티 경유. */
function Swatch({ color, kind }: { color: string; kind: 'ink' | 'bg' }) {
  if (kind === 'ink') {
    const className = isPaletteColor(color) ? INK_TEXT_CLASS[color] : HEX_INK_CLASS
    const style = isHexColor(color) ? ({ [HEX_INK_VAR]: color } as CSSProperties) : undefined
    return (
      <span aria-hidden className={`font-bold ${className}`} style={style}>
        가
      </span>
    )
  }
  const className = isPaletteColor(color) ? MARK_BG_CLASS[color] : HEX_MARK_CLASS
  const style = isHexColor(color) ? ({ [HEX_MARK_VAR]: color } as CSSProperties) : undefined
  return <span aria-hidden className={`inline-block h-3 w-3 rounded border border-border ${className}`} style={style} />
}

/** 팔레트 밖 자유 색 입력 — `isHexColor` 통과분만 적용된다(미통과는 거절, 치환하지 않는다). */
function HexInputRow({ kind, onApply }: { kind: 'ink' | 'bg'; onApply: (hex: string) => void }) {
  const [value, setValue] = useState('#')
  const ok = isHexColor(value)
  return (
    <div className="flex flex-col gap-1 px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="#rrggbb"
          aria-label="직접 색 입력"
          className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-primary placeholder:text-muted"
        />
        {ok && <Swatch color={value} kind={kind} />}
        <button
          type="button"
          disabled={!ok}
          onClick={() => onApply(value)}
          className="rounded border border-border px-1.5 py-0.5 text-xs text-primary hover:bg-bg disabled:cursor-not-allowed disabled:text-muted"
        >
          적용
        </button>
      </div>
      {!ok && value !== '#' && <span className="text-[11px] text-wrong">#rrggbb 6자리 형식만 쓸 수 있습니다</span>}
    </div>
  )
}

// ---------------------------------------------------------------- 마이크로 3종

/**
 * `icon`을 주면 **아이콘 버튼**(children 없음 → Mantine `ActionIcon` 경로 — 코어 굵게·기울임과
 * 같은 모양), 안 주면 지금까지처럼 한글 텍스트 라벨 버튼이다(stage-46 규약 B — 아이콘은 밑줄·크기
 * 2개뿐). `label`·`mainTooltip`은 두 경우 모두 한글 그대로다(접근성·발견성).
 */
function MicroMarkButton({
  mark,
  blocked,
  icon,
}: {
  mark: MicroMark
  blocked: boolean
  icon?: ReactNode
}) {
  const Components = useComponentsContext()!
  const editor = useNoteEditor()
  const styles = useActiveStyleRecord(editor)
  const active = styles[mark] === true
  const common = {
    label: MICRO_MARK_LABEL[mark],
    mainTooltip: blocked ? ATOM_GUARD_TOOLTIP : MICRO_MARK_LABEL[mark],
    isSelected: active,
    isDisabled: blocked,
    onClick: () => {
      toggleMicroMark(editor, mark)
      refocus(() => editor.focus())
    },
  }
  if (icon) return <Components.FormattingToolbar.Button {...common} icon={icon} />
  return <Components.FormattingToolbar.Button {...common}>{MICRO_MARK_LABEL[mark]}</Components.FormattingToolbar.Button>
}

/**
 * 인라인 코드 버튼(stage-40 FB-11 ⓒ, 규약 C) — `MicroMarkButton` 전례를 따르되 토글 대상은
 * **코어 `code` 스타일**이다(`editor.toggleStyles({ code: true })` — 마이크로 마크 상호 배타
 * 대상이 아니므로 `microMarks.ts`를 거치지 않는다). 신규 스타일 스펙 0 — `code`는 이미
 * `schema.ts`의 코어 5종에 등재돼 있고 어댑터 `inlineCode` 왕복도 기존재라, 이 버튼은 발견성만
 * 더한다(백틱 입력 규칙·`Ctrl+E` 단축키는 이미 동작한다).
 */
function InlineCodeButton({ blocked }: { blocked: boolean }) {
  const Components = useComponentsContext()!
  const editor = useNoteEditor()
  const styles = useActiveStyleRecord(editor)
  const active = styles.code === true
  return (
    <Components.FormattingToolbar.Button
      label="코드"
      mainTooltip={blocked ? ATOM_GUARD_TOOLTIP : '인라인 코드'}
      isSelected={active}
      isDisabled={blocked}
      onClick={() => {
        editor.toggleStyles({ code: true })
        refocus(() => editor.focus())
      }}
    >
      코드
    </Components.FormattingToolbar.Button>
  )
}

/**
 * 형광펜은 **boolean 스타일**이고 색은 `:t{bg=}`가 담는다(앱 스키마가 그렇게 갈린다).
 * 그래서 이 메뉴 하나가 두 값을 함께 움직인다 — 색을 고르면 `highlight` 켜기 + `bg` 갱신,
 * "기본 노랑"이면 `bg` 제거, **"형광펜 끄기"면 `highlight`와 `bg`를 함께 걷는다.**
 *
 * **왜 끄기가 `bg`까지 지우는가**(2026-08-16 확정): F52에서 **형광펜과 바탕색은 같은 시각 채널의 두
 * 표기**다. `components/markdown/inlineSerialize.ts:32`가 `highlight: '=='`를 "기본 노랑(색 지정은 `:t{bg=…}`)"으로
 * 명시하고, 리더(`MarkdownView`)는 `==`를 `bg-mark-yellow`로 · `:t{bg=색}`을 `MARK_BG_CLASS[색]`으로
 * 렌더한다 — 둘 다 같은 `--mark-*` 토큰 경로다. 사용자에게 "형광"과 "바탕색"이 서로 다른 것이라고
 * 가르칠 이유가 없으므로, 형광을 끄면 그 색도 함께 걷히는 것이 기대에 맞다.
 * (`bg`는 아래 **바탕색** 메뉴와 같은 키다 — 하나의 `:t` 속성을 두 입구가 공유한다.)
 */
function HighlightMenu({ blocked }: { blocked: boolean }) {
  const Components = useComponentsContext()!
  const editor = useNoteEditor()
  const styles = useActiveStyleRecord(editor)
  const active = styles.highlight === true
  const view = readTextStyleView(styles)

  const pick = (color: string | null) => {
    applyMicroMark(editor, 'highlight')
    setTextStyleKey(editor, 'bg', color)
    refocus(() => editor.focus())
  }

  return (
    <Components.Generic.Menu.Root>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          label="형광펜"
          mainTooltip={blocked ? ATOM_GUARD_TOOLTIP : '형광펜 (색 선택)'}
          isSelected={active}
          isDisabled={blocked}
        >
          형광펜
        </Components.FormattingToolbar.Button>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown">
        <Components.Generic.Menu.Label>형광펜</Components.Generic.Menu.Label>
        {/*
          "끄기"는 **상태가 아니라 동작**이다 — 형광이 켜져 있을 때만 노출한다.
          꺼진 상태에서 `checked`로 보이면 ⓐ 현재 상태를 잘못 알리고, ⓑ 그걸 누르면 **바탕색 메뉴로
          넣은 `:t{bg=}`만** 파괴된다(형광과 무관한 색인데 형광 메뉴가 지운다). 항목 자체를 감추면
          그 경로가 닫힌다.
          남는 엣지(의도된 것): 형광이 켜진 채 바탕색 메뉴로 색을 넣었다면 "끄기"가 그 색도 함께
          걷는다 — 위 주석대로 `==`와 `:t{bg=}`는 **같은 시각 채널의 두 표기**라서 그게 기대에 맞다.
        */}
        {active && (
          <Components.Generic.Menu.Item
            checked={false}
            onClick={() => {
              clearMicroMark(editor, 'highlight')
              setTextStyleKey(editor, 'bg', null)
              refocus(() => editor.focus())
            }}
          >
            형광펜 끄기
          </Components.Generic.Menu.Item>
        )}
        <Components.Generic.Menu.Item checked={active && !view.bg} onClick={() => pick(null)}>
          기본 노랑
        </Components.Generic.Menu.Item>
        {PALETTE_COLORS.map((color) => (
          <Components.Generic.Menu.Item
            key={color}
            icon={<Swatch color={color} kind="bg" />}
            checked={active && view.bg === color}
            onClick={() => pick(color)}
          >
            {PALETTE_LABEL[color]}
          </Components.Generic.Menu.Item>
        ))}
        <HexInputRow kind="bg" onApply={(hex) => pick(hex)} />
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}

// ---------------------------------------------------------------- `:t` 색·크기

function ColorMenu({ target, blocked }: { target: 'c' | 'bg'; blocked: boolean }) {
  const Components = useComponentsContext()!
  const editor = useNoteEditor()
  const styles = useActiveStyleRecord(editor)
  const view = readTextStyleView(styles)
  const current = target === 'c' ? view.ink : view.bg
  const kind = target === 'c' ? 'ink' : 'bg'
  const name = target === 'c' ? '글자색' : '바탕색'

  const pick = (color: string | null) => {
    setTextStyleKey(editor, target, color)
    refocus(() => editor.focus())
  }

  return (
    <Components.Generic.Menu.Root>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          label={name}
          mainTooltip={blocked ? ATOM_GUARD_TOOLTIP : name}
          isSelected={Boolean(current)}
          isDisabled={blocked}
        >
          {name}
        </Components.FormattingToolbar.Button>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown">
        <Components.Generic.Menu.Label>{name}</Components.Generic.Menu.Label>
        <Components.Generic.Menu.Item checked={!current} onClick={() => pick(null)}>
          기본
        </Components.Generic.Menu.Item>
        {PALETTE_COLORS.map((color) => (
          <Components.Generic.Menu.Item
            key={color}
            icon={<Swatch color={color} kind={kind} />}
            checked={current === color}
            onClick={() => pick(color)}
          >
            {PALETTE_LABEL[color]}
          </Components.Generic.Menu.Item>
        ))}
        <HexInputRow kind={kind} onApply={(hex) => pick(hex)} />
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}

function SizeMenu({ blocked }: { blocked: boolean }) {
  const Components = useComponentsContext()!
  const editor = useNoteEditor()
  const styles = useActiveStyleRecord(editor)
  const current = readTextStyleView(styles).size

  const pick = (size: string | null) => {
    setTextStyleKey(editor, 's', size)
    refocus(() => editor.focus())
  }

  return (
    <Components.Generic.Menu.Root>
      <Components.Generic.Menu.Trigger>
        {/* 아이콘 버튼(stage-46 F-4 · 규약 B) — children 없이 `icon`만 넘긴다. 라벨·툴팁은 한글. */}
        <Components.FormattingToolbar.Button
          label="글자 크기"
          mainTooltip={blocked ? ATOM_GUARD_TOOLTIP : '글자 크기'}
          isSelected={Boolean(current)}
          isDisabled={blocked}
          icon={<TextSizeIcon />}
        />
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown">
        <Components.Generic.Menu.Label>글자 크기</Components.Generic.Menu.Label>
        <Components.Generic.Menu.Item checked={!current} onClick={() => pick(null)}>
          기본
        </Components.Generic.Menu.Item>
        {TEXT_SIZES.map((size) => (
          <Components.Generic.Menu.Item key={size} checked={current === size} onClick={() => pick(size)}>
            {TEXT_SIZE_LABEL[size]}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}

// ---------------------------------------------------------------- 참조 · 콜아웃

function RefButton() {
  const Components = useComponentsContext()!
  const { openPicker } = useRefPickerCommands()
  return (
    <Components.FormattingToolbar.Button
      label="참조"
      mainTooltip="참조 넣기 (문서 링크 · 앵커 · 문서 임베드)"
      onClick={() => openPicker('doc')}
    >
      참조
    </Components.FormattingToolbar.Button>
  )
}

function CalloutMenu() {
  const Components = useComponentsContext()!
  const editor = useNoteEditor()
  const [title, setTitle] = useState('')
  const normalized = normalizeRefText(title)
  // 제목은 **비워도 된다**(종류 기본 라벨을 쓴다). 값이 있을 때만 도메인을 검사한다(규약 E).
  const error = normalized === '' ? null : isSafeRefText(normalized) ? null : refTextRejection(normalized)

  return (
    <Components.Generic.Menu.Root>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button label="콜아웃" mainTooltip="콜아웃 넣기">
          콜아웃
        </Components.FormattingToolbar.Button>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown">
        <Components.Generic.Menu.Label>콜아웃 제목 (선택)</Components.Generic.Menu.Label>
        <div className="flex flex-col gap-1 px-2 pb-1" onKeyDown={(e) => e.stopPropagation()}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="비우면 종류 이름을 씁니다"
            aria-label="콜아웃 제목"
            className="w-44 rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-primary placeholder:text-muted"
          />
          {error && <span className="text-[11px] text-wrong">{error}</span>}
        </div>
        {CALLOUT_VARIANTS.map((variant) => (
          <Components.Generic.Menu.Item
            key={variant}
            onClick={() => {
              if (error) return
              insertCalloutBlock(editor, variant, normalized)
              setTitle('')
            }}
          >
            {CALLOUT_LABEL[variant] ?? variant}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}

/**
 * [다단] — 선택 블록이 있으면 **1단에 넣어** 감싸고(`wrapInColumns` · 나머지 단은 빈 문단), 없으면
 * 빈 단 n개짜리 컨테이너를 커서 자리에 넣는다(stage-41 규약 B 2차 — 고정 열). 커서/선택이
 * columns·column·콜아웃 **안**이거나 선택에 columns 블록 자신이 포함돼
 * 있으면 중첩이 되므로 메뉴를 비활성 + 사유 툴팁으로 막는다(원자 가드와 같은 결 — `isDisabled`를
 * 받을 자리가 있는 **우리 버튼**이라 `AtomGuardShield` 덮개 없이 바로 지원된다).
 */
function ColumnsMenu() {
  const Components = useComponentsContext()!
  const editor = useNoteEditor()
  const [blocked, setBlocked] = useState(() => columnsInsertBlocked(editor))
  useEditorSelectionChange(() => setBlocked(columnsInsertBlocked(editor)))

  const insert = (count: 2 | 3) => {
    if (blocked) return
    insertColumnsBlock(editor, count)
    refocus(() => editor.focus())
  }

  return (
    <Components.Generic.Menu.Root>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          label="다단"
          mainTooltip={blocked ? COLUMNS_GUARD_TOOLTIP : '다단(단 나누기) 넣기'}
          isDisabled={blocked}
        >
          다단
        </Components.FormattingToolbar.Button>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown">
        <Components.Generic.Menu.Label>다단</Components.Generic.Menu.Label>
        <Components.Generic.Menu.Item onClick={() => insert(2)}>2단</Components.Generic.Menu.Item>
        <Components.Generic.Menu.Item onClick={() => insert(3)}>3단</Components.Generic.Menu.Item>
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}

// ---------------------------------------------------------------- 이미지 자르기(stage-37 F-6, 규약 C)

/**
 * [자르기] — 선택이 크롭 제공 조건(자체 호스팅 `/images/` 경로만 · GIF 제외)을 만족하는 image 블록
 * 1개일 때만 나타난다(그 밖에는 **버튼 자체가 없다** — `FileReplaceButton` 등 기본 파일 버튼과 같은
 * "조건 미달 = null" 관례). 판정은 선택 변경 시에만 다시 계산한다(다른 방언 버튼의 `blocked`와 같은
 * 패턴 — `useEditorSelectionChange`).
 */
function CropButton() {
  const Components = useComponentsContext()!
  const editor = useNoteEditor()
  const [target, setTarget] = useState<CropTarget | null>(() => computeCropTarget(editor))
  useEditorSelectionChange(() => setTarget(computeCropTarget(editor)))
  const [open, setOpen] = useState(false)

  if (!target) return null

  return (
    <>
      <Components.FormattingToolbar.Button label="자르기" mainTooltip="이미지 자르기" onClick={() => setOpen(true)}>
        자르기
      </Components.FormattingToolbar.Button>
      {open && (
        <Suspense fallback={null}>
          <ImageCropDialog
            url={target.url}
            onCancel={() => setOpen(false)}
            onApply={(newUrl) => {
              // 단일 updateBlock 호출 = undo 1단위(되돌리면 구 url로 복귀). caption·title·height·
              // previewWidth 등 나머지 prop은 partial 갱신이라 그대로 보존된다(uploads.ts의 업로드
              // 완료 갱신과 같은 관례 — `props: { url }`만 넘긴다).
              editor.updateBlock(target.id, { type: 'image', props: { url: newUrl } } as NotePartialBlock)
              setOpen(false)
              refocus(() => editor.focus())
            }}
          />
        </Suspense>
      )}
    </>
  )
}

// ---------------------------------------------------------------- 항목 빌더(규약 A ③ 단일 출처)

/**
 * **부유·도킹 공용 항목 빌더**(stage-40 F-1, 규약 A ③) — 부유(`NoteFormattingToolbar`)와 도킹
 * (`DockedFormattingToolbar`)이 이 함수 하나만 호출한다. 도킹 전용·부유 전용 항목은 0개다.
 *
 * `showTextGroup=false`(규약 B — 원자·미디어만 또는 코드 블록만 선택)면 **텍스트 서식군**(코어
 * bold/italic/strike/link + 방언 밑줄/형광/스포일러/색·크기 + 인라인 코드 + 참조 삽입)을 렌더
 * 자체를 생략한다(비활성이 아니라 DOM 없음 — 규약 B ⑤). **블록 기능군**(블록 타입 선택·표 셀
 * 병합·파일 버튼·정렬·중첩·댓글 + 콜아웃·이미지 자르기)은 항상 남는다.
 *
 * 기본 항목의 **상대 순서는 바꾸지 않는다** — `getFormattingToolbarItems()`가 정한 순서 그대로
 * 두고 텍스트 서식군에 속하는 키만 걸러낸다(부유 툴바의 기존 버튼 배치를 그대로 지키기 위함).
 * 밑줄만 **같은 자리에서** 우리 버튼으로 갈아 끼운다(stage-46 F-4 — 순서 변경이 아니라 치환).
 */
export function buildFormattingToolbarItems({
  blocked,
  showTextGroup,
}: {
  blocked: boolean
  showTextGroup: boolean
}): ReactNode[] {
  type GroupedItem = { key: string; group: 'text' | 'block'; node: ReactNode }

  const defaultItems: GroupedItem[] = defaultToolbarItems(blocked).map((node) => {
    const key = typeof (node as { key?: unknown }).key === 'string' ? ((node as { key: string }).key) : ''
    return { key, group: TEXT_GROUP_DEFAULT_KEYS.has(key) ? 'text' : 'block', node }
  })

  // 방언군 순서(stage-46 F-4): **글자 크기 아이콘이 선두**로 전진했고, 밑줄은 여기서 빠져
  // 기본 밑줄 자리(bold·italic 옆 — `defaultToolbarItems`)로 옮겨 갔다.
  const dialectItems: GroupedItem[] = [
    { key: 'textSize', group: 'text', node: <SizeMenu key="textSize" blocked={blocked} /> },
    { key: 'inlineCode', group: 'text', node: <InlineCodeButton key="inlineCode" blocked={blocked} /> },
    { key: 'microHighlight', group: 'text', node: <HighlightMenu key="microHighlight" blocked={blocked} /> },
    {
      key: 'microSpoiler',
      group: 'text',
      node: <MicroMarkButton key="microSpoiler" mark="spoiler" blocked={blocked} />,
    },
    { key: 'textInk', group: 'text', node: <ColorMenu key="textInk" target="c" blocked={blocked} /> },
    { key: 'textBg', group: 'text', node: <ColorMenu key="textBg" target="bg" blocked={blocked} /> },
    { key: 'refChip', group: 'text', node: <RefButton key="refChip" /> },
    { key: 'callout', group: 'block', node: <CalloutMenu key="callout" /> },
    { key: 'columns', group: 'block', node: <ColumnsMenu key="columns" /> },
    { key: 'imageCrop', group: 'block', node: <CropButton key="imageCrop" /> },
  ]

  return [...defaultItems, ...dialectItems]
    .filter((item) => showTextGroup || item.group === 'block')
    .map((item) => item.node)
}

// ---------------------------------------------------------------- 툴바 본체

export default function NoteFormattingToolbar() {
  const editor = useNoteEditor()
  const [blocked, setBlocked] = useState(() => selectionHasAtomInline(editor))
  // 원자 인라인 가드는 **선택**에 달려 있다(스타일 변화만으로는 갱신되지 않는다).
  useEditorSelectionChange(() => setBlocked(selectionHasAtomInline(editor)))
  // 블록별 필터(규약 B) — 부유 툴바도 도킹과 같은 규칙을 쓴다.
  const blockTypes = useSelectedBlockTypes(editor)
  const showTextGroup = shouldShowTextFormattingGroup(blockTypes)

  return <FormattingToolbar>{buildFormattingToolbarItems({ blocked, showTextGroup })}</FormattingToolbar>
}
