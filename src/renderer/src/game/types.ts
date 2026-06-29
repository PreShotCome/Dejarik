// Dejarik types. The board is two concentric playable rings (outer = ring 0,
// middle = ring 1) of twelve segments each. The inner "circle" is the 25th
// space in canon, but it's unusable per Ian's rules — pieces can't move to or
// pass through it — so the model omits it entirely.

export type Team = 'blue' | 'red'

export type PieceType = 'scout' | 'brute' | 'guardian' | 'predator'

export interface Pos {
  ring: 0 | 1 // 0 = outer, 1 = middle
  seg: number // 0..11 around the circle
}

export interface Piece {
  id: string
  team: Team
  type: PieceType
  pos: Pos
}

export type Action =
  | { kind: 'move'; from: Pos; to: Pos }
  | { kind: 'attack'; from: Pos; target: Pos }

export interface SurvivorClock {
  team: Team
  turnsLeft: number // counts down on that team's turns; must capture before reaching 0
}

export interface GameState {
  pieces: Piece[] // alive pieces only — captured pieces are removed
  turn: Team
  // After a Scout moves (or any move), `movedThisTurn` is set so the engine
  // knows the piece already moved. Only Scout is allowed to attack after.
  movedThisTurn: string | null // piece id that already moved this turn
  // After a successful attack, the same piece may chain again (any type).
  // chainPieceId holds whose chain is live; null means no chain.
  chainPieceId: string | null
  survivorClock: SurvivorClock | null
  winner: Team | null
  log: string[]
}

export const OTHER: Record<Team, Team> = { blue: 'red', red: 'blue' }
