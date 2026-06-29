import type { GameState, Piece, PieceType, Pos, Team } from './types'
import { OTHER } from './types'
import { mk, posKey, samePos } from './board'
import { rawAttacks, rawMoves } from './pieces'

// ---- helpers ---------------------------------------------------------------

let _uid = 0
function uid(): string {
  _uid += 1
  return `p${_uid}`
}

export function pieceAt(state: GameState, pos: Pos): Piece | null {
  return state.pieces.find((p) => samePos(p.pos, pos)) ?? null
}

export function pieceById(state: GameState, id: string): Piece | null {
  return state.pieces.find((p) => p.id === id) ?? null
}

function occSet(state: GameState, except?: string): Set<string> {
  const s = new Set<string>()
  for (const p of state.pieces) {
    if (except && p.id === except) continue
    s.add(posKey(p.pos))
  }
  return s
}

// ---- initial setup ---------------------------------------------------------

// Layout each side's four pieces on their half of the board. The Brute MUST
// be in the middle ring; the other three are arranged with the Predator in
// front (outer ring, centre of half), Scout & Guardian flanking.
//
// Blue's half is segments 9,10,11,0,1,2 (centre = 0). Red's half centre = 6.
function defaultSetupForTeam(team: Team): Piece[] {
  const centre = team === 'blue' ? 0 : 6
  // Pieces by intended (ring, segOffset from centre):
  //  predator  -> outer ring (ring 0), centre
  //  scout     -> outer ring (ring 0), centre - 2
  //  guardian  -> outer ring (ring 0), centre + 2
  //  brute     -> middle ring (ring 1), centre   (must be middle)
  const layout: { type: PieceType; ring: 0 | 1; off: number }[] = [
    { type: 'predator', ring: 0, off: 0 },
    { type: 'scout', ring: 0, off: -2 },
    { type: 'guardian', ring: 0, off: 2 },
    { type: 'brute', ring: 1, off: 0 }
  ]
  return layout.map((l) => ({
    id: uid(),
    team,
    type: l.type,
    pos: mk(l.ring, centre + l.off)
  }))
}

export function newGame(starts: Team = 'blue'): GameState {
  return {
    pieces: [...defaultSetupForTeam('blue'), ...defaultSetupForTeam('red')],
    turn: starts,
    movedThisTurn: null,
    chainPieceId: null,
    survivorClock: null,
    winner: null,
    log: ['New game — ' + starts + ' to move.']
  }
}

// ---- legal moves / attacks for a selected piece ---------------------------

export function legalMoves(state: GameState, piece: Piece): Pos[] {
  if (state.winner) return []
  if (state.turn !== piece.team) return []
  // Once a piece has already moved this turn, it can't move again — even Scout.
  // Scout can still ATTACK after moving (handled in legalAttacks).
  if (state.movedThisTurn) return []
  // While a chain is live, the only legal action is more attacks.
  if (state.chainPieceId) return []
  const occ = occSet(state, piece.id)
  const dests = rawMoves(piece.type, piece.pos, occ)
  return dests.filter((d) => !occ.has(posKey(d)))
}

export function legalAttacks(state: GameState, piece: Piece): Pos[] {
  if (state.winner) return []
  if (state.turn !== piece.team) return []
  // Chain: only the chaining piece may keep attacking.
  if (state.chainPieceId && state.chainPieceId !== piece.id) return []
  // If a non-Scout piece already moved this turn, it can't also attack.
  if (state.movedThisTurn && state.movedThisTurn !== piece.id) return []
  if (state.movedThisTurn === piece.id && piece.type !== 'scout' && !state.chainPieceId) {
    return []
  }
  const targets = rawAttacks(piece.type, piece.pos)
  // Only squares occupied by an ENEMY are valid attack targets.
  return targets.filter((t) => {
    const occupant = pieceAt(state, t)
    return occupant != null && occupant.team !== piece.team
  })
}

// ---- actions ---------------------------------------------------------------
// These mutate state in place — callers should pass a freshly-cloned state
// (use cloneState) when they need immutability (the React layer does).

export function cloneState(s: GameState): GameState {
  return {
    pieces: s.pieces.map((p) => ({ ...p, pos: { ...p.pos } })),
    turn: s.turn,
    movedThisTurn: s.movedThisTurn,
    chainPieceId: s.chainPieceId,
    survivorClock: s.survivorClock ? { ...s.survivorClock } : null,
    winner: s.winner,
    log: [...s.log]
  }
}

function pieceLabel(p: Piece): string {
  return p.team[0].toUpperCase() + ' ' + p.type
}

export function doMove(state: GameState, pieceId: string, to: Pos): GameState {
  const piece = pieceById(state, pieceId)
  if (!piece) return state
  if (!legalMoves(state, piece).some((m) => samePos(m, to))) return state
  const next = cloneState(state)
  const np = pieceById(next, pieceId)!
  np.pos = { ...to }
  next.movedThisTurn = pieceId
  next.log.push(`${pieceLabel(piece)} moves.`)
  // A non-Scout piece that has moved cannot also attack — that ends the turn.
  if (piece.type !== 'scout') endTurn(next)
  return next
}

export function doAttack(state: GameState, pieceId: string, target: Pos): GameState {
  const piece = pieceById(state, pieceId)
  if (!piece) return state
  if (!legalAttacks(state, piece).some((m) => samePos(m, target))) return state
  const next = cloneState(state)
  const np = pieceById(next, pieceId)!
  const victim = pieceAt(next, target)
  if (!victim) return state
  next.pieces = next.pieces.filter((p) => p.id !== victim.id)
  next.log.push(`${pieceLabel(np)} captures ${pieceLabel(victim)}.`)

  // Check win immediately.
  const enemy = OTHER[np.team]
  if (!next.pieces.some((p) => p.team === enemy)) {
    next.winner = np.team
    next.log.push(`${np.team.toUpperCase()} wins!`)
    return next
  }

  // Capturing resets the survivor clock for the capturing side (if they had
  // been on it). For the opposing side, drop into clock state if they now
  // have only 1 piece.
  if (next.survivorClock?.team === np.team) next.survivorClock = null
  maybeStartSurvivorClock(next, enemy)

  // Chain: if another enemy is still in attack range, the same piece may
  // keep attacking.
  const moreTargets = rawAttacks(np.type, np.pos).filter((t) => {
    const occ = pieceAt(next, t)
    return occ != null && occ.team !== np.team
  })
  if (moreTargets.length > 0) {
    next.chainPieceId = np.id
  } else {
    endTurn(next)
  }
  return next
}

// Voluntarily end turn without action (or after a Scout chose only to move
// and skip the attack option, or after declining a chain).
export function passTurn(state: GameState): GameState {
  if (state.winner) return state
  const next = cloneState(state)
  next.log.push(`${next.turn.toUpperCase()} ends turn.`)
  endTurn(next)
  return next
}

function endTurn(state: GameState): void {
  state.movedThisTurn = null
  state.chainPieceId = null
  // Tick down survivor clock for the side about to play.
  const next = OTHER[state.turn]
  state.turn = next
  if (state.survivorClock?.team === next) {
    state.survivorClock.turnsLeft -= 1
    if (state.survivorClock.turnsLeft <= 0) {
      state.winner = OTHER[next]
      state.log.push(
        `${next.toUpperCase()} failed to capture in time — ${OTHER[next].toUpperCase()} wins.`
      )
    }
  }
}

function maybeStartSurvivorClock(state: GameState, team: Team): void {
  const count = state.pieces.filter((p) => p.team === team).length
  if (count === 1 && !state.survivorClock) {
    state.survivorClock = { team, turnsLeft: 3 }
    state.log.push(`${team.toUpperCase()} down to 1 — must capture within 3 turns.`)
  }
}

// Utility for AI: enumerate every possible action for a team (every piece's
// every legal move + every legal attack).
export type AiAction =
  | { kind: 'move'; pieceId: string; to: Pos }
  | { kind: 'attack'; pieceId: string; target: Pos }
  | { kind: 'pass' }

export function enumerateActions(state: GameState, team: Team): AiAction[] {
  if (state.winner || state.turn !== team) return []
  const out: AiAction[] = []
  for (const p of state.pieces) {
    if (p.team !== team) continue
    for (const m of legalMoves(state, p)) out.push({ kind: 'move', pieceId: p.id, to: m })
    for (const a of legalAttacks(state, p))
      out.push({ kind: 'attack', pieceId: p.id, target: a })
  }
  // Pass is always available if a chain is live and the AI wants to decline.
  if (state.chainPieceId || state.movedThisTurn) out.push({ kind: 'pass' })
  return out
}

