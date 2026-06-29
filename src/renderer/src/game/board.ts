import type { Pos } from './types'

export const SEGMENTS = 12
export const RINGS = 2 // 0 = outer, 1 = middle (inner circle is unusable, omitted)

export function samePos(a: Pos, b: Pos): boolean {
  return a.ring === b.ring && a.seg === b.seg
}

export function posKey(p: Pos): string {
  return `${p.ring}:${p.seg}`
}

// Tangential indexing wraps naturally — the rings are circles. (mod 12)
export function wrapSeg(s: number): number {
  return ((s % SEGMENTS) + SEGMENTS) % SEGMENTS
}

// Radial only goes between rings 0 and 1; outer of 0 and inner of 1 are off-board.
export function isValid(r: number, s: number): boolean {
  return r >= 0 && r < RINGS && Number.isInteger(s)
}

export function mk(r: 0 | 1, s: number): Pos {
  return { ring: r, seg: wrapSeg(s) }
}

// All four orthogonal neighbours (radial + tangential). Out-of-board entries
// are filtered out. Tangential wraps; radial does not.
export function orthNeighbors(p: Pos): Pos[] {
  const out: Pos[] = [
    { ring: p.ring, seg: wrapSeg(p.seg - 1) },
    { ring: p.ring, seg: wrapSeg(p.seg + 1) }
  ]
  if (p.ring - 1 >= 0) out.push({ ring: (p.ring - 1) as 0 | 1, seg: p.seg })
  if (p.ring + 1 < RINGS) out.push({ ring: (p.ring + 1) as 0 | 1, seg: p.seg })
  return out
}

// 8-neighbour (orth + diag). Only the Brute uses diagonals.
export function allNeighbors(p: Pos): Pos[] {
  const out: Pos[] = orthNeighbors(p)
  for (const dr of [-1, 1]) {
    const nr = p.ring + dr
    if (nr < 0 || nr >= RINGS) continue
    out.push({ ring: nr as 0 | 1, seg: wrapSeg(p.seg - 1) })
    out.push({ ring: nr as 0 | 1, seg: wrapSeg(p.seg + 1) })
  }
  return out
}

// Which player's "half" a segment belongs to at setup. Blue owns 9..2 (the
// six segments centred on seg 0), Red owns 3..8 (centred on seg 6). Each side
// gets six segments × two rings = 12 spaces, plenty for the four starting
// pieces.
export function startingHalf(seg: number): 'blue' | 'red' {
  const s = wrapSeg(seg)
  // Blue: 9, 10, 11, 0, 1, 2. Red: 3, 4, 5, 6, 7, 8.
  return s >= 3 && s <= 8 ? 'red' : 'blue'
}
