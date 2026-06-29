import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Board3D, { ClickEvent } from './scene/Board3D'
import { newGame, doMove, doAttack, passTurn, legalAttacks, legalMoves, pieceById, pieceAt } from './game/engine'
import { PIECE_INFO } from './game/pieces'
import type { GameState, Piece, Team } from './game/types'
import { applyAction, Difficulty, planTurn } from './game/ai'

type SideChoice = 'blue' | 'red'

function App(): JSX.Element {
  const [state, setState] = useState<GameState>(() => newGame('blue'))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playerSide, setPlayerSide] = useState<SideChoice>('blue')
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [version, setVersion] = useState('')
  const [aiThinking, setAiThinking] = useState(false)

  // Load app version from Electron main (for the footer).
  useEffect(() => {
    void window.dejarik?.getVersion?.().then(setVersion).catch(() => undefined)
  }, [])

  // ---- AI turn loop --------------------------------------------------------
  // When it's the AI's side and the game isn't over, plan a turn and apply
  // its actions one at a time with short delays so the animations read.
  const aiBusy = useRef(false)
  useEffect(() => {
    if (state.winner) return
    if (state.turn === playerSide) return
    if (aiBusy.current) return
    aiBusy.current = true
    setAiThinking(true)
    setSelectedId(null)
    // Slight initial delay so the human can read what just happened.
    const startDelay = setTimeout(() => {
      const plan = planTurn(state, state.turn, difficulty)
      let cursor = state
      const steps = [...plan]
      const step = (): void => {
        const a = steps.shift()
        if (!a) {
          aiBusy.current = false
          setAiThinking(false)
          setState(cursor)
          return
        }
        cursor = applyAction(cursor, a)
        setState(cursor)
        // pace
        setTimeout(step, 700)
      }
      step()
    }, 500)
    return () => clearTimeout(startDelay)
    // We deliberately only re-run when turn or winner changes so a stale plan
    // doesn't get re-issued every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.turn, state.winner, playerSide, difficulty])

  // ---- click handling ------------------------------------------------------
  const handleClick = useCallback(
    (e: ClickEvent) => {
      if (state.winner) return
      if (state.turn !== playerSide) return
      if (aiBusy.current) return

      if (e.kind === 'empty') {
        setSelectedId(null)
        return
      }

      // Resolve what was clicked into either a piece or a target cell.
      const clickedPiece =
        e.kind === 'piece' ? pieceById(state, e.pieceId) : e.kind === 'cell' ? pieceAt(state, e.pos) : null
      const clickedPos = e.kind === 'cell' ? e.pos : e.kind === 'piece' ? clickedPiece?.pos ?? null : null

      const sel: Piece | null = selectedId ? pieceById(state, selectedId) : null

      // Case A: we have a selected piece; the click is interpreted as an
      // action (move / attack) if legal — otherwise it re-selects or clears.
      if (sel && sel.team === playerSide) {
        if (clickedPos) {
          // Attack?
          if (
            clickedPiece &&
            clickedPiece.team !== playerSide &&
            legalAttacks(state, sel).some((p) => p.ring === clickedPos.ring && p.seg === clickedPos.seg)
          ) {
            const next = doAttack(state, sel.id, clickedPos)
            setState(next)
            // If a chain is live keep selection so the player sees it; otherwise clear.
            const stillChain = next.chainPieceId === sel.id
            setSelectedId(stillChain ? sel.id : null)
            return
          }
          // Move?
          if (
            !clickedPiece &&
            legalMoves(state, sel).some((p) => p.ring === clickedPos.ring && p.seg === clickedPos.seg)
          ) {
            const next = doMove(state, sel.id, clickedPos)
            setState(next)
            // Scout can attack after moving — keep selection so the player can see options.
            setSelectedId(sel.type === 'scout' && next.turn === playerSide ? sel.id : null)
            return
          }
        }
        // Not an action — maybe the user re-selected a different friendly piece.
        if (clickedPiece && clickedPiece.team === playerSide) {
          setSelectedId(clickedPiece.id)
          return
        }
        setSelectedId(null)
        return
      }

      // Case B: nothing selected. A friendly click selects it; anything else is ignored.
      if (clickedPiece && clickedPiece.team === playerSide) {
        setSelectedId(clickedPiece.id)
      }
    },
    [state, playerSide, selectedId]
  )

  // ---- derived UI bits -----------------------------------------------------
  const sel = selectedId ? pieceById(state, selectedId) : null

  const turnLabel = useMemo(() => {
    if (state.winner) return `${state.winner.toUpperCase()} wins`
    if (aiThinking) return 'AI thinking…'
    return `${state.turn.toUpperCase()} to move`
  }, [state.winner, state.turn, aiThinking])

  const playerCounts = useMemo(() => {
    const blue = state.pieces.filter((p) => p.team === 'blue').length
    const red = state.pieces.filter((p) => p.team === 'red').length
    return { blue, red }
  }, [state.pieces])

  function startNewGame(): void {
    aiBusy.current = false
    setAiThinking(false)
    setSelectedId(null)
    setState(newGame('blue'))
  }

  function endTurn(): void {
    if (state.turn !== playerSide || state.winner) return
    setState(passTurn(state))
    setSelectedId(null)
  }

  // ---- render --------------------------------------------------------------
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">DEJARIK</div>
          <div className="brand-sub">Holochess</div>
        </div>

        <div className="panel">
          <div className="panel-title">Match</div>
          <div className="turn-row">
            <span className={`turn-dot ${state.turn}`} />
            <span className="turn-label">{turnLabel}</span>
          </div>
          {state.survivorClock && (
            <div className="clock">
              {state.survivorClock.team.toUpperCase()} must capture in{' '}
              {state.survivorClock.turnsLeft} turn(s)
            </div>
          )}
          <div className="score">
            <div className="score-row blue">
              <span className="score-dot" /> Blue · {playerCounts.blue}
            </div>
            <div className="score-row red">
              <span className="score-dot" /> Red · {playerCounts.red}
            </div>
          </div>

          <button className="btn primary" onClick={startNewGame}>
            New game
          </button>
          <button
            className="btn ghost"
            onClick={endTurn}
            disabled={state.winner != null || state.turn !== playerSide}
          >
            End turn
          </button>
        </div>

        <div className="panel">
          <div className="panel-title">You play</div>
          <div className="seg">
            {(['blue', 'red'] as const).map((t) => (
              <button
                key={t}
                className={`seg-btn ${t} ${playerSide === t ? 'active' : ''}`}
                onClick={() => setPlayerSide(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">AI difficulty</div>
          <div className="seg">
            {(['easy', 'normal', 'hard'] as const).map((d) => (
              <button
                key={d}
                className={`seg-btn ${difficulty === d ? 'active' : ''}`}
                onClick={() => setDifficulty(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {sel && (
          <div className="panel">
            <div className="panel-title">Selected</div>
            <div className="piece-card">
              <div className={`piece-card-name ${sel.team}`}>
                {PIECE_INFO[sel.type].label}
              </div>
              <div className="piece-card-desc">{PIECE_INFO[sel.type].description}</div>
            </div>
          </div>
        )}

        <div className="panel grow">
          <div className="panel-title">Log</div>
          <ul className="log">
            {state.log.slice(-12).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>

        <div className="sidebar-foot">v{version || '0.1.0'} · auto-update on launch</div>
      </aside>

      <div className="stage">
        <Board3D state={state} selectedId={selectedId} onClick={handleClick} />
        <div className="stage-hint">
          drag to rotate · scroll to zoom · click your piece, then a glowing square
        </div>
        {state.winner && (
          <div className="winner-overlay">
            <div className={`winner-text ${state.winner}`}>
              {state.winner === playerSide ? 'You win!' : 'Defeat.'}
            </div>
            <button className="btn primary" onClick={startNewGame}>
              Play again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
