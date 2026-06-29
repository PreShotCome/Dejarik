import type { GameState, Team } from './types'
import { OTHER } from './types'
import { AiAction, doAttack, doMove, enumerateActions, passTurn } from './engine'

// Simple heuristic AI. The user wants to play, not be crushed — so this is
// a one-ply greedy evaluator with a couple of tactical biases:
//   + capturing an enemy is worth a lot (material is decisive in Dejarik)
//   + losing material on the reply is bad (we look one ply ahead at the
//     opponent's best reply to score positions defensively)
//   + Brutes are slightly more valuable than the others (they're flexible)
//   + when nothing to attack, prefer moves that put us in attack range
//
// Difficulty:
//   easy   — picks a random legal action 60% of the time
//   normal — picks the highest-evaluated action
//   hard   — same as normal but adds a 2-ply look-ahead for capture chains

export type Difficulty = 'easy' | 'normal' | 'hard'

const PIECE_VALUE = { scout: 3, brute: 4, guardian: 3, predator: 4 } as const

function material(state: GameState, team: Team): number {
  let v = 0
  for (const p of state.pieces) {
    if (p.team === team) v += PIECE_VALUE[p.type]
  }
  return v
}

function attackPotential(state: GameState, team: Team): number {
  // Count enemy pieces currently within attack range of any of our pieces.
  // Encourages positioning even without an immediate capture.
  let n = 0
  for (const p of state.pieces) {
    if (p.team !== team) continue
    // legalAttacks won't work here because state.turn might not be us;
    // we want a position-only check.
    // Reuse rawAttacks via a temp state would be heavy; cheap fallback:
    // count enemy pieces within Chebyshev=2 of p as a rough proxy.
    for (const q of state.pieces) {
      if (q.team === team) continue
      const dRing = Math.abs(p.pos.ring - q.pos.ring)
      const dSeg = Math.min(
        Math.abs(p.pos.seg - q.pos.seg),
        12 - Math.abs(p.pos.seg - q.pos.seg)
      )
      if (dRing + dSeg <= 2) n += 1
    }
  }
  return n
}

function evaluate(state: GameState, me: Team): number {
  if (state.winner === me) return 10_000
  if (state.winner && state.winner !== me) return -10_000
  const them = OTHER[me]
  const mat = (material(state, me) - material(state, them)) * 100
  const tact = (attackPotential(state, me) - attackPotential(state, them)) * 3
  // Survivor clock: if WE're on the clock, that's a big negative.
  let clock = 0
  if (state.survivorClock?.team === me) clock = -50 * (4 - state.survivorClock.turnsLeft)
  if (state.survivorClock?.team === them) clock = 50 * (4 - state.survivorClock.turnsLeft)
  return mat + tact + clock
}

function applyAction(
  state: GameState,
  a: AiAction
): GameState {
  if (a.kind === 'move') return doMove(state, a.pieceId, a.to)
  if (a.kind === 'attack') return doAttack(state, a.pieceId, a.target)
  return passTurn(state)
}

// Pick the AI's best COMPLETE TURN (a sequence of actions ending when the
// turn passes to the other team). Returns the chosen action sequence so the
// UI can animate them one at a time.
export function planTurn(
  state: GameState,
  me: Team,
  difficulty: Difficulty
): Array<AiAction> {
  type Plan = {
    actions: AiAction[]
    state: GameState
  }
  const startPlans: Plan[] = [{ actions: [], state }]
  const completedPlans: Plan[] = []
  let frontier = startPlans
  // Up to 4 actions per turn — comfortably covers a Scout's move+attack+chain.
  for (let step = 0; step < 4 && frontier.length; step++) {
    const next: Plan[] = []
    for (const plan of frontier) {
      if (plan.state.turn !== me || plan.state.winner) {
        completedPlans.push(plan)
        continue
      }
      const actions = enumerateActions(plan.state, me)
      if (actions.length === 0) {
        completedPlans.push(plan)
        continue
      }
      // For exploration, expand each candidate; keep top-K per layer to bound
      // branching.
      const scored = actions.map((a) => {
        const ns = applyAction(plan.state, a)
        return { a, ns, score: evaluate(ns, me) }
      })
      scored.sort((x, y) => y.score - x.score)
      const k = difficulty === 'hard' ? 6 : 3
      for (const s of scored.slice(0, k)) {
        next.push({
          actions: [...plan.actions, s.a],
          state: s.ns
        })
      }
    }
    frontier = next
  }
  // Any frontier plans that didn't naturally end count as completed too.
  for (const f of frontier) completedPlans.push(f)

  // Evaluate each completed plan from `me`'s perspective. For hard difficulty,
  // also subtract the opponent's best reply (1-ply look-ahead).
  let best: Plan | null = null
  let bestScore = -Infinity
  for (const plan of completedPlans) {
    if (plan.actions.length === 0) continue
    let s = evaluate(plan.state, me)
    if (difficulty === 'hard' && !plan.state.winner) {
      const oppActions = enumerateActions(plan.state, OTHER[me])
      let worst = Infinity
      for (const oa of oppActions.slice(0, 12)) {
        const ns = applyAction(plan.state, oa)
        const sc = evaluate(ns, me)
        if (sc < worst) worst = sc
      }
      if (oppActions.length > 0) s = (s + worst) / 2
    }
    if (s > bestScore) {
      bestScore = s
      best = plan
    }
  }

  let chosen = best?.actions ?? []
  if (difficulty === 'easy' && Math.random() < 0.6) {
    // Easy: pick a random non-empty plan some of the time.
    const candidates = completedPlans.filter((p) => p.actions.length > 0)
    if (candidates.length > 0) {
      chosen = candidates[Math.floor(Math.random() * candidates.length)].actions
    }
  }
  // Safety: never return zero actions if any action exists.
  if (chosen.length === 0) {
    const first = enumerateActions(state, me)[0]
    if (first) chosen = [first]
  }
  // Trim trailing 'pass' (no point animating it).
  while (chosen.length > 1 && chosen[chosen.length - 1].kind === 'pass') chosen.pop()
  return chosen
}

// Convenience: apply a whole planned sequence and return the final state.
// Used by the UI for sanity / debug; the UI normally applies actions one at a
// time so they animate.
export function applyPlan(
  state: GameState,
  plan: Array<AiAction>
): GameState {
  let s = state
  for (const a of plan) s = applyAction(s, a)
  return s
}

export { applyAction }
