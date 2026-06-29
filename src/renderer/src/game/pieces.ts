import type { Pos, PieceType } from './types'
import { allNeighbors, mk, orthNeighbors, posKey, samePos } from './board'

// ---- piece catalogue --------------------------------------------------------
// Each piece has display info plus pure move/attack rule functions. Rules are
// "raw geometry" — they don't know about occupancy beyond what's needed for
// path-blocking (Scout's BFS, Predator's hop). Occupancy filtering for the
// final destination/target is applied by the caller (engine.ts).

export interface PieceInfo {
  type: PieceType
  label: string
  description: string
  // Visual ring colour offset (each piece gets a slightly different holo tint
  // on top of the team base colour). Used by the 3D scene.
  hue: number
}

export const PIECE_INFO: Record<PieceType, PieceInfo> = {
  scout: {
    type: 'scout',
    label: 'Scout',
    description:
      'Moves up to 2 orthogonal spaces. Attacks the space directly ahead or behind. Unique: may both move AND attack on the same turn.',
    hue: 0
  },
  brute: {
    type: 'brute',
    label: 'Brute',
    description:
      'Moves 1 space in any direction (including diagonals). Attacks 1 space in any direction. Must start in the middle ring.',
    hue: 30
  },
  guardian: {
    type: 'guardian',
    label: 'Guardian',
    description:
      'Moves in an L: 1 radial then 2 tangential. Attacks 2 spaces left or right along the ring.',
    hue: 60
  },
  predator: {
    type: 'predator',
    label: 'Predator',
    description:
      'Moves 1 radial OR 2 tangential. Can hop over other pieces. Attacks in an L shape.',
    hue: 90
  }
}

// Helper: is `q` a "diagonal" neighbour of `p` (1 ring change AND 1 seg change)?
function isDiagNeighbor(p: Pos, q: Pos): boolean {
  if (Math.abs(p.ring - q.ring) !== 1) return false
  const ds = (q.seg - p.seg + 12) % 12
  return ds === 1 || ds === 11
}

// ---- move generators --------------------------------------------------------
// occ: Set<posKey> of all occupied squares (both teams).
// Returns candidate destination squares (excluding the piece's own square).
// The engine further filters by "destination must be unoccupied".

function scoutMoves(from: Pos, occ: Set<string>): Pos[] {
  // Up to 2 orthogonal steps, no diagonals, can't pass through occupied squares.
  // "Move 1 and back" => starting square is reachable in 2 steps; we keep it
  // for that flavour ("waste a turn to stay") even though final-square
  // occupancy filtering will drop the starting square only if we mark it
  // occupied. Scout's own square is NOT in `occ` (caller excludes it).
  const reach = new Map<string, Pos>()
  const frontier: Pos[] = [from]
  const seen = new Set<string>([posKey(from)])
  for (let step = 0; step < 2; step++) {
    const next: Pos[] = []
    for (const cur of frontier) {
      for (const n of orthNeighbors(cur)) {
        const k = posKey(n)
        if (seen.has(k)) continue
        // can't pass *through* an occupied square (except final destination)
        if (occ.has(k) && step < 1) {
          // record as possible destination if step === 1 (final), otherwise skip
          reach.set(k, n)
          continue
        }
        seen.add(k)
        next.push(n)
        if (!samePos(n, from)) reach.set(k, n)
      }
    }
    frontier.splice(0, frontier.length, ...next)
  }
  return Array.from(reach.values())
}

function bruteMoves(from: Pos): Pos[] {
  return allNeighbors(from)
}

function guardianMoves(from: Pos): Pos[] {
  // L shape: 1 radial then 2 tangential
  const out: Pos[] = []
  for (const dr of [-1, 1]) {
    const nr = from.ring + dr
    if (nr < 0 || nr >= 2) continue
    for (const ds of [-2, 2]) {
      out.push(mk(nr as 0 | 1, from.seg + ds))
    }
  }
  return out
}

function predatorMoves(from: Pos): Pos[] {
  // 1 radial OR 2 tangential. Can hop over (so we don't filter blockers along
  // the way — the engine just filters the final square for occupancy).
  const out: Pos[] = []
  for (const dr of [-1, 1]) {
    const nr = from.ring + dr
    if (nr >= 0 && nr < 2) out.push({ ring: nr as 0 | 1, seg: from.seg })
  }
  for (const ds of [-2, 2]) {
    out.push(mk(from.ring, from.seg + ds))
  }
  return out
}

export function rawMoves(type: PieceType, from: Pos, occ: Set<string>): Pos[] {
  switch (type) {
    case 'scout':
      return scoutMoves(from, occ)
    case 'brute':
      return bruteMoves(from)
    case 'guardian':
      return guardianMoves(from)
    case 'predator':
      return predatorMoves(from)
  }
}

// ---- attack generators ------------------------------------------------------
// Returns squares this piece can attack from `from` (i.e. squares an enemy
// would need to occupy). Engine filters by "enemy actually present".

function scoutAttacks(from: Pos): Pos[] {
  // "Directly in front or behind" — radial neighbours only.
  const out: Pos[] = []
  for (const dr of [-1, 1]) {
    const nr = from.ring + dr
    if (nr >= 0 && nr < 2) out.push({ ring: nr as 0 | 1, seg: from.seg })
  }
  return out
}

function bruteAttacks(from: Pos): Pos[] {
  return allNeighbors(from)
}

function guardianAttacks(from: Pos): Pos[] {
  // 2 spaces left or right along the ring
  return [mk(from.ring, from.seg - 2), mk(from.ring, from.seg + 2)]
}

function predatorAttacks(from: Pos): Pos[] {
  // L shape (same as guardian moves)
  return guardianMoves(from)
}

export function rawAttacks(type: PieceType, from: Pos): Pos[] {
  switch (type) {
    case 'scout':
      return scoutAttacks(from)
    case 'brute':
      return bruteAttacks(from)
    case 'guardian':
      return guardianAttacks(from)
    case 'predator':
      return predatorAttacks(from)
  }
}

// Whether this piece type, sitting at `from`, may attack a square `target`.
export function canAttackFrom(type: PieceType, from: Pos, target: Pos): boolean {
  return rawAttacks(type, from).some((p) => samePos(p, target))
}

// Exported for the AI/heuristics.
export function _isDiagNeighbor(p: Pos, q: Pos): boolean {
  return isDiagNeighbor(p, q)
}

// Used by setup: Brute must start in the middle ring (ring 1).
export function setupRingFor(type: PieceType): 0 | 1 | 'any' {
  return type === 'brute' ? 1 : 'any'
}
