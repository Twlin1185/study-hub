// 방언 서식 툴바 (stage-34 G-2 · 규약 C·E, 규약 A ① 진입점 하나).
//
// **기본 버튼은 그대로 둔다** — `getFormattingToolbarItems()`를 먼저 깔고 방언 컨트롤을 **덧붙인다**
// (툴바 전면 재구성은 이 단계 범위가 아니다). **예외 1건 = 기본 밑줄 버튼 제거**(아래
// `DEFAULT_UNDERLINE_ITEM_KEY` 주석 참조 — 규약 C 이행이지 전면 커스터마이즈가 아니다).
// 방언 컨트롤은 다음 4묶음이다:
//   ① 마이크로 3종(밑줄·형광펜·스포일러) — **상호 배타 래퍼 1곳**(`microMarks.ts`) 경유 · active 표시.
//   ② `:t` 색·크기(글자색 `c` · 바탕색 `bg` · 크기 `s`) — 값 도메인은 `palette.ts` 단일 출처.
//   ③ [참조] — 피커를 연다(규약 A ①).
//   ④ 콜아웃 삽입 — variant 고정 목록 + 제목 실시간 검증(규약 E).
//
// 색 리터럴 0 — 스와치까지 전부 토큰 유틸(`bg-mark-*`·`text-ink-*`)이고, 팔레트 밖 hex는
// `tokens.css`가 계산하는 커스텀 프로퍼티(`--u-ink`/`--u-bg`)로만 흘린다(불변 규칙 5).
import { useState } from 'react'
import type { CSSProperties, ReactNode, SyntheticEvent } from 'react'
import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useActiveStyles,
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
import { insertCalloutBlock } from '../refPicker/insert'
import { useRefPickerCommands } from '../refPicker/RefUiProvider'
import { ATOM_GUARD_TOOLTIP, selectionHasAtomInline } from './atoms'
import { MICRO_MARK_LABEL, applyMicroMark, clearMicroMark, toggleMicroMark } from './microMarks'
import type { MicroMark } from './microMarks'
import { readTextStyleView, setTextStyleKey } from './textStyle'
import { useNoteEditor } from './useNoteEditor'

/**
 * 기본 툴바의 **밑줄 버튼 키**(`@blocknote/react`의 `getFormattingToolbarItems()`가 박아 넣는 값).
 *
 * **왜 걷어내는가 — 규약 C 이행**: 그 버튼은 `BasicTextStyleButton basicTextStyle="underline"`이고,
 * 클릭 시 `editor.toggleStyles({ underline: true })`를 **직접** 부른다. 즉 마이크로 마크 상호 배타
 * 래퍼(`microMarks.ts`)를 타지 않으므로 `==형광==` 위에서 누르면 `underline`+`highlight`가 공존하고
 * (규약 C 위반 → 방언 Markdown 왕복 붕괴), 덤으로 밑줄 버튼이 두 개 뜬다.
 * 우리가 **같은 기능의 대체 버튼**(`MicroMarkButton mark="underline"`)을 바로 옆에 제공하므로
 * 기능이 줄지 않는다 — 이것은 "슬래시/툴바 전면 커스터마이즈"(M35)가 아니라 규약 C의 이행이다.
 */
const DEFAULT_UNDERLINE_ITEM_KEY = 'underlineStyleButton'

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

/** 기본 항목 목록 — 밑줄 하나만 빼고(규약 C), 원자 선택일 때 마크 버튼에 가드를 씌운다. */
function defaultToolbarItems(blocked: boolean) {
  return getFormattingToolbarItems()
    .filter((item) => item.key !== DEFAULT_UNDERLINE_ITEM_KEY)
    .map((item) =>
      blocked && item.key !== null && ATOM_GUARDED_DEFAULT_KEYS.has(item.key) ? (
        <AtomGuardShield key={item.key}>{item}</AtomGuardShield>
      ) : (
        item
      ),
    )
}

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

function MicroMarkButton({ mark, blocked }: { mark: MicroMark; blocked: boolean }) {
  const Components = useComponentsContext()!
  const editor = useNoteEditor()
  const styles = useActiveStyles() as unknown as Record<string, unknown>
  const active = styles[mark] === true
  return (
    <Components.FormattingToolbar.Button
      label={MICRO_MARK_LABEL[mark]}
      mainTooltip={blocked ? ATOM_GUARD_TOOLTIP : MICRO_MARK_LABEL[mark]}
      isSelected={active}
      isDisabled={blocked}
      onClick={() => {
        toggleMicroMark(editor, mark)
        refocus(() => editor.focus())
      }}
    >
      {MICRO_MARK_LABEL[mark]}
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
  const styles = useActiveStyles() as unknown as Record<string, unknown>
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
  const styles = useActiveStyles() as unknown as Record<string, unknown>
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
  const styles = useActiveStyles() as unknown as Record<string, unknown>
  const current = readTextStyleView(styles).size

  const pick = (size: string | null) => {
    setTextStyleKey(editor, 's', size)
    refocus(() => editor.focus())
  }

  return (
    <Components.Generic.Menu.Root>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          label="글자 크기"
          mainTooltip={blocked ? ATOM_GUARD_TOOLTIP : '글자 크기'}
          isSelected={Boolean(current)}
          isDisabled={blocked}
        >
          크기
        </Components.FormattingToolbar.Button>
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

// ---------------------------------------------------------------- 툴바 본체

export default function NoteFormattingToolbar() {
  const editor = useNoteEditor()
  const [blocked, setBlocked] = useState(() => selectionHasAtomInline(editor))
  // 원자 인라인 가드는 **선택**에 달려 있다(스타일 변화만으로는 갱신되지 않는다).
  useEditorSelectionChange(() => setBlocked(selectionHasAtomInline(editor)))

  return (
    <FormattingToolbar>
      {defaultToolbarItems(blocked)}
      <MicroMarkButton key="microUnderline" mark="underline" blocked={blocked} />
      <HighlightMenu key="microHighlight" blocked={blocked} />
      <MicroMarkButton key="microSpoiler" mark="spoiler" blocked={blocked} />
      <ColorMenu key="textInk" target="c" blocked={blocked} />
      <ColorMenu key="textBg" target="bg" blocked={blocked} />
      <SizeMenu key="textSize" blocked={blocked} />
      <RefButton key="refChip" />
      <CalloutMenu key="callout" />
    </FormattingToolbar>
  )
}
