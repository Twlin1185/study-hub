// stage-41 **2차(고정 열)** — 편집 표면의 `columns > column` **정규화 계산**(규약 A 불변식 ①~④).
//
// 이 모듈은 **순수 계산만** 한다(에디터 API·DOM 무접촉 · `@blocknote/*` import 0 — 잎 모듈).
// 실제 dispatch는 `specs/blocks.tsx`의 `ensureColumnsNormalized` 훅이, 사용자 조작(삽입·단 수
// 변경·해제)은 `refPicker/insert.ts`가 여기 헬퍼로 만든 자식 목록을 쓴다. 두 곳이 **같은 규칙**을
// 공유하게 하려고 파일을 따로 뒀다.
//
// **A와 동치**(검토 중-1·경-1·경-2 · 2026-08-30): 앱 블록 계층 `editor2/schema/columnsNormalize.ts`
// (`normalizeColumnsTree`)와 이 편집기 계층은 **같은 결과**를 내야 한다 — 두 계층이 갈라지면 저장·
// 재열람에서 구조가 흔들린다(1차 교훈). 동치는 `scripts/s41-columns-editor.mjs` 계열 ②(같은 픽스처를
// 앱 블록형·BN JSON형으로 각각 정규화해 텍스트 트리 비교)가 고정한다. 갈라지기 쉬운 지점 3개:
//   ⓐ 단 0개 + `count` 비정수/미지정 → **2단**(A의 기본값과 같음) · 생성 상한도 A의
//      `MAX_GENERATED_COLUMNS`를 **그대로 import**한다(값 표류 방지 — 단일 출처)
//   ⓑ `columns` 밖의 **빈 stray `column`** → **통째로 제거**(빈 문단을 남기지 않는다 — A의 `walk`가
//      자식 0개를 그냥 흘려보내는 것과 같다)
//   ⓒ 비-`column` 자식의 착지 = 직전 `column`의 끝(앞에 단이 없으면 첫 단의 **앞**)
//
// 불변식(BlockNote 블록 JSON 기준):
//   ① `columns`의 비-`column` 자식 → **직전 `column`의 끝**(없으면 첫 `column` 앞)으로 이동
//   ② `column`이 0개면 `count`개 생성 · `count` := `column` 수(children이 정본)
//   ③ 각 `column`의 자식 ≥ 1(빈 문단 삽입 — 빈 단도 클릭 가능해야 한다)
//   ④ 부모가 `columns`가 아닌 `column` → 자식을 제자리에 승격(해제 · 자식이 0이면 컨테이너째 삭제)
//
// **손실 0**이 최우선이다 — 어느 규칙도 내용 블록을 버리지 않는다(빈 단 생성만 더한다).
//
// 없는 단을 **새로 만들 때만** 쓰는 상한은 앱 계층에서 가져온다(A=12 · 유입 값 보존과는 무관하다 —
// 4열 데이터는 그대로 4열로 산다. 상한은 `n=99999` 같은 병적 입력이 문서를 부풀리는 것만 막는다).
import { MAX_GENERATED_COLUMNS } from '../schema/columnsNormalize'

/** 편집기 블록 JSON의 구조 타입(스키마 파생 타입에 묶이지 않는다 — 잎 모듈 계약). */
export type ColumnsJsonBlock = {
  id?: string
  type: string
  props?: Record<string, unknown>
  content?: unknown
  children?: ColumnsJsonBlock[]
}
export const emptyParagraph = (): ColumnsJsonBlock => ({ type: 'paragraph' })

/** "비어 있는 문단" — 단 병합(3→2)에서 의미 없는 빈 줄이 쌓이지 않게 걸러 내는 판정에만 쓴다. */
export function isEmptyParagraph(block: ColumnsJsonBlock): boolean {
  return (
    block.type === 'paragraph' &&
    Array.isArray(block.content) &&
    block.content.length === 0 &&
    (block.children?.length ?? 0) === 0
  )
}

/** 단 하나(`column`) — 자식이 0이면 빈 문단 1개를 넣는다(불변식 ③). id는 있으면 보존한다. */
export function makeColumn(children: ColumnsJsonBlock[], id?: string): ColumnsJsonBlock {
  return {
    ...(id ? { id } : {}),
    type: 'column',
    props: {},
    children: children.length > 0 ? children : [emptyParagraph()],
  }
}

/** 빈 단 n개(각 빈 문단 1개) — 삽입·단 수 늘리기가 쓴다. */
export function emptyColumns(count: number): ColumnsJsonBlock[] {
  const n = Number.isFinite(count) ? Math.max(1, Math.trunc(count)) : 2
  return Array.from({ length: n }, () => makeColumn([]))
}

/**
 * 불변식 ④ — 부모가 `columns`가 아닌 `column`을 제자리에서 해제한다(자식 승격). 서브트리 전체를
 * 훑되 **안쪽 `columns` 컨테이너는 건너뛴다**(그 컨테이너는 자기 몫의 정규화가 따로 담당한다 —
 * 한 트랜잭션에서 겹치는 대상에 두 번 손대지 않기 위한 경계).
 */
function liftMisplacedColumns(blocks: ColumnsJsonBlock[]): ColumnsJsonBlock[] {
  const out: ColumnsJsonBlock[] = []
  for (const block of blocks) {
    if (block.type === 'column') {
      const lifted = liftMisplacedColumns(block.children ?? [])
      out.push(...lifted)
      continue
    }
    if (block.type === 'columns') {
      out.push(block)
      continue
    }
    if (block.children && block.children.length > 0) {
      out.push({ ...block, children: liftMisplacedColumns(block.children) })
      continue
    }
    out.push(block)
  }
  return out
}

/**
 * `columns` 컨테이너 하나의 **정규 자식 목록**(불변식 ①②③ + 단 안 `column` 해제)을 만든다.
 * 원래 블록 객체(id 포함)를 그대로 옮겨 담으므로 앵커 칩·본문이 그대로 살아 있다.
 */
export function normalizedColumnsChildren(container: ColumnsJsonBlock): {
  children: ColumnsJsonBlock[]
  count: number
} {
  const cells: { id?: string; children: ColumnsJsonBlock[] }[] = []
  const leading: ColumnsJsonBlock[] = []

  for (const child of container.children ?? []) {
    if (child.type === 'column') {
      cells.push({ id: child.id, children: liftMisplacedColumns(child.children ?? []) })
      continue
    }
    // 불변식 ① — 직전 단의 끝으로. 앞에 단이 하나도 없으면 첫 단 앞(아래 `leading`)으로 모은다.
    if (cells.length > 0) cells[cells.length - 1].children.push(child)
    else leading.push(child)
  }

  if (cells.length === 0) {
    // 불변식 ② — 단이 하나도 없다. `count`만큼 빈 단을 세운다(비정수·미지정이면 **2** · 상한은
    // A와 공유하는 `MAX_GENERATED_COLUMNS` — 위 머리말 ⓐ).
    const raw = Number(container.props?.count)
    const want = Number.isFinite(raw) ? Math.trunc(raw) : 2
    const n = Math.min(Math.max(want, 1), MAX_GENERATED_COLUMNS)
    for (let i = 0; i < n; i += 1) cells.push({ children: [] })
  }
  if (leading.length > 0) cells[0].children.unshift(...leading)

  return {
    children: cells.map((cell) => makeColumn(cell.children, cell.id)),
    count: cells.length,
  }
}

/**
 * 자식 배열의 **구조 지문**(2단계) — 정규화가 실제로 무언가를 바꾸는지 판정한다. 이 판정이
 * 거짓이면 훅은 **아무 dispatch도 하지 않는다**(무한 루프 방지 — 1차 프리즈 교훈). 정규화는
 * 블록을 옮기거나 새로 만들기만 하므로 (type, id, 자식 id 나열)로 충분하다 — 새로 만든 블록은
 * id가 없어(`+`) 항상 "달라진 것"으로 잡힌다.
 */
export function columnsChildrenSignature(children: ColumnsJsonBlock[]): string {
  return children
    .map(
      (child) =>
        `${child.type}#${child.id ?? '+'}(${(child.children ?? [])
          .map((grand) => grand.id ?? '+')
          .join(',')})`,
    )
    .join('|')
}

function collectIds(blocks: ColumnsJsonBlock[], into: Set<string>): Set<string> {
  for (const block of blocks) {
    if (block.id) into.add(block.id)
    if (block.children && block.children.length > 0) collectIds(block.children, into)
  }
  return into
}

/** 정규화 한 건 — 컨테이너 자식 교체(`container`) 또는 잘못 놓인 단 해제(`lift`). */
export type ColumnsNormalizeOp = {
  /** 대상 블록 id — `container`면 `columns`, `lift`면 잘못 놓인 `column`. */
  id: string
  kind: 'container' | 'lift'
  /** 교체·승격해 넣을 블록 목록. */
  children: ColumnsJsonBlock[]
  /** 새 `count`(container 전용 · 불변식 ②). */
  count: number
  /** 이 조작으로 다시 만들어지는 블록 id 전체 — 커서 복원 여부 판정에 쓴다. */
  scope: Set<string>
}

/**
 * 문서 전체를 훑어 **필요한 정규화만** 뽑는다. 아무것도 필요 없으면 빈 배열(= dispatch 0).
 * 한 컨테이너에 조작이 잡히면 그 **안쪽은 더 내려가지 않는다**(같은 트랜잭션에서 겹치는 범위를
 * 두 번 건드리지 않기 위해 — 안쪽 문제는 이 조작이 만든 다음 변경에서 잡힌다).
 */
export function planColumnsNormalization(document: ColumnsJsonBlock[]): ColumnsNormalizeOp[] {
  const ops: ColumnsNormalizeOp[] = []
  const walk = (blocks: ColumnsJsonBlock[], parentType: string | null) => {
    for (const block of blocks) {
      if (block.type === 'columns') {
        const normalized = normalizedColumnsChildren(block)
        const changed =
          columnsChildrenSignature(block.children ?? []) !==
            columnsChildrenSignature(normalized.children) ||
          Number(block.props?.count) !== normalized.count
        if (changed && block.id) {
          ops.push({
            id: block.id,
            kind: 'container',
            children: normalized.children,
            count: normalized.count,
            scope: collectIds(block.children ?? [], new Set<string>()),
          })
          continue
        }
        // 정규 상태면 각 단 **안쪽**을 계속 살핀다(깊은 곳의 잘못 놓인 `column`·중첩 columns).
        for (const cell of block.children ?? []) walk(cell.children ?? [], cell.type)
        continue
      }
      if (block.type === 'column' && parentType !== 'columns') {
        // 불변식 ④ — 부모가 `columns`가 아닌 단. 자식을 제자리에 승격한다.
        const lifted = liftMisplacedColumns(block.children ?? [])
        if (block.id) {
          ops.push({
            id: block.id,
            kind: 'lift',
            // 자식이 0인 stray 단은 **통째로 사라진다**(빈 문단을 남기지 않는다 — 머리말 ⓑ,
            // A의 `walk`와 같은 결과). 실행부는 빈 배열을 보면 `removeBlocks`를 부른다.
            children: lifted,
            count: 0,
            scope: collectIds(block.children ?? [], new Set<string>()),
          })
        }
        continue
      }
      if (block.children && block.children.length > 0) walk(block.children, block.type)
    }
  }
  walk(document, null)
  return ops
}
