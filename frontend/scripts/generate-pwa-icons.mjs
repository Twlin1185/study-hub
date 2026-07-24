// PWA 아이콘 생성기 (설계 §5, F18) — 외부 이미지 라이브러리 없이 순수 Node(zlib)만으로
// 192x192 · 512x512 PNG를 만든다. 배경은 파비콘(public/favicon.svg)의 강조색(#7e14ff)을 채우고
// 중앙에 흰색 체크마크(학습 완료를 상징)를 그린다.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'icons')

const BG = [0x7e, 0x14, 0xff, 0xff] // #7e14ff — favicon.svg 강조색과 동일
const FG = [0xff, 0xff, 0xff, 0xff]

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

function buildImageData(size) {
  const data = Buffer.alloc(size * size * 4)
  const strokeWidth = size * 0.09
  // 체크마크 좌표 (0~1 비율)
  const ax = size * 0.27, ay = size * 0.52
  const bx = size * 0.42, by = size * 0.68
  const cx = size * 0.75, cy = size * 0.3

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(
        distToSegment(x, y, ax, ay, bx, by),
        distToSegment(x, y, bx, by, cx, cy),
      )
      const color = d <= strokeWidth / 2 ? FG : BG
      const idx = (y * size + x) * 4
      data[idx] = color[0]
      data[idx + 1] = color[1]
      data[idx + 2] = color[2]
      data[idx + 3] = color[3]
    }
  }
  return data
}

// ---- 최소 PNG 인코더 (IHDR/IDAT/IEND, 8bit RGBA, 필터 없음) ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0) // width
  ihdr.writeUInt32BE(size, 4) // height
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // color type: RGBA
  ihdr.writeUInt8(0, 10) // compression
  ihdr.writeUInt8(0, 11) // filter
  ihdr.writeUInt8(0, 12) // interlace

  // 각 스캔라인 앞에 필터 타입 바이트(0 = None)를 붙인다.
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const srcStart = y * size * 4
    const dstStart = y * (size * 4 + 1)
    raw[dstStart] = 0
    rgba.copy(raw, dstStart + 1, srcStart, srcStart + size * 4)
  }
  const idatData = deflateSync(raw)

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })

for (const size of [192, 512]) {
  const rgba = buildImageData(size)
  const png = encodePng(size, rgba)
  const path = join(OUT_DIR, `icon-${size}.png`)
  writeFileSync(path, png)
  console.log(`generated ${path} (${png.length} bytes)`)
}
