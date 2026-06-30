import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Board3D, { ClickEvent } from './scene/Board3D'
import {
  doAttack,
  doMove,
  legalAttacks,
  legalMoves,
  newGame,
  passTurn,
  pieceAt,
  pieceById
} from './game/engine'
import type { GameState, Piece, PieceType, Team } from './game/types'
import { Difficulty, applyAction, planTurn } from './game/ai'

// ---- unit catalogue (UI copy from Claude Design's databank) ----------------
// Mapping from the engine's piece types to the Star-Wars-flavoured names and
// short ability briefs that show up in the right-side DATABANK panel.

interface UnitMeta {
  label: string
  role: 'Scout' | 'Brute' | 'Guardian' | 'Predator'
  move: string
  attack: string
}

const UNITS: Record<PieceType, UnitMeta> = {
  scout: {
    label: 'Beetle',
    role: 'Scout',
    move: 'Up to 2 spaces in a straight line.',
    attack: 'The space directly fore or aft.'
  },
  brute: {
    label: 'Rancor',
    role: 'Brute',
    move: '1 space in any direction.',
    attack: '1 space in any direction.'
  },
  guardian: {
    label: 'Golem',
    role: 'Guardian',
    move: 'L-path — 1 in/out, then 2 across.',
    attack: '2 spaces along its own ring.'
  },
  predator: {
    label: 'Giganoto',
    role: 'Predator',
    move: '1 in/out OR 2 across the ring.',
    attack: 'L-shape strike.'
  }
}

const TEAM_HEX: Record<Team, string> = {
  blue: '#36c8ff',
  red: '#ff5e7a'
}

type SideChoice = Team
const ORDERED: PieceType[] = ['scout', 'brute', 'guardian', 'predator']

function App(): JSX.Element {
  const [state, setState] = useState<GameState>(() => newGame('blue'))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playerSide, setPlayerSide] = useState<SideChoice>('blue')
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [version, setVersion] = useState('')
  const [aiThinking, setAiThinking] = useState(false)
  const [briefType, setBriefType] = useState<PieceType>('scout')
  const [unitsReady, setUnitsReady] = useState(false)
  const [autoOrbit, setAutoOrbit] = useState(false)
  const [scanlines] = useState(true)
  const [flicker] = useState(true)

  useEffect(() => {
    void window.dejarik?.getVersion?.().then(setVersion).catch(() => undefined)
  }, [])

  // ---- AI turn loop --------------------------------------------------------
  const aiBusy = useRef(false)
  useEffect(() => {
    if (state.winner) return
    if (state.turn === playerSide) return
    if (aiBusy.current) return
    aiBusy.current = true
    setAiThinking(true)
    setSelectedId(null)
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
        setTimeout(step, 700)
      }
      step()
    }, 500)
    return () => clearTimeout(startDelay)
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

      const clickedPiece =
        e.kind === 'piece'
          ? pieceById(state, e.pieceId)
          : e.kind === 'cell'
            ? pieceAt(state, e.pos)
            : null
      const clickedPos = e.kind === 'cell' ? e.pos : e.kind === 'piece' ? clickedPiece?.pos ?? null : null

      const sel: Piece | null = selectedId ? pieceById(state, selectedId) : null

      if (sel && sel.team === playerSide) {
        if (clickedPos) {
          // Attack?
          if (
            clickedPiece &&
            clickedPiece.team !== playerSide &&
            legalAttacks(state, sel).some(
              (p) => p.ring === clickedPos.ring && p.seg === clickedPos.seg
            )
          ) {
            const next = doAttack(state, sel.id, clickedPos)
            setState(next)
            const stillChain = next.chainPieceId === sel.id
            setSelectedId(stillChain ? sel.id : null)
            return
          }
          // Move?
          if (
            !clickedPiece &&
            legalMoves(state, sel).some(
              (p) => p.ring === clickedPos.ring && p.seg === clickedPos.seg
            )
          ) {
            const next = doMove(state, sel.id, clickedPos)
            setState(next)
            setSelectedId(sel.type === 'scout' && next.turn === playerSide ? sel.id : null)
            return
          }
        }
        if (clickedPiece && clickedPiece.team === playerSide) {
          setSelectedId(clickedPiece.id)
          setBriefType(clickedPiece.type)
          return
        }
        setSelectedId(null)
        return
      }

      if (clickedPiece && clickedPiece.team === playerSide) {
        setSelectedId(clickedPiece.id)
        setBriefType(clickedPiece.type)
      }
    },
    [state, playerSide, selectedId]
  )

  // ---- derived UI bits -----------------------------------------------------
  const sel = selectedId ? pieceById(state, selectedId) : null
  const activeTeam = state.winner ?? state.turn
  const turnHex = TEAM_HEX[activeTeam]
  const turnLabel = useMemo(() => {
    if (state.winner) return `${state.winner.toUpperCase()} WINS`
    if (aiThinking) return 'AI THINKING…'
    return `${state.turn.toUpperCase()} TO MOVE`
  }, [state.winner, state.turn, aiThinking])

  const counts = useMemo(() => {
    const blue = state.pieces.filter((p) => p.team === 'blue').length
    const red = state.pieces.filter((p) => p.team === 'red').length
    return { blue, red }
  }, [state.pieces])

  const activeBrief: PieceType = sel ? sel.type : briefType
  const briefTeam: Team | null = sel ? sel.team : null

  function startNewGame(): void {
    aiBusy.current = false
    setAiThinking(false)
    setSelectedId(null)
    setBriefType('scout')
    setState(newGame('blue'))
  }

  function endTurn(): void {
    if (state.turn !== playerSide || state.winner) return
    setState(passTurn(state))
    setSelectedId(null)
  }

  const winnerIsWin = state.winner != null && state.winner === playerSide
  const winnerWord = winnerIsWin ? 'VICTORY' : 'DEFEAT'
  const winnerColor = winnerIsWin ? TEAM_HEX[playerSide] : TEAM_HEX[playerSide === 'blue' ? 'red' : 'blue']
  const winnerGlow = winnerIsWin ? 'rgba(54,200,255,0.5)' : 'rgba(255,94,122,0.5)'
  const winnerSub = winnerIsWin
    ? 'Enemy units eliminated. The bay is yours.'
    : 'Your units have been wiped from the board.'

  return (
    <div className="app">
      <Board3D
        state={state}
        selectedId={selectedId}
        autoOrbit={autoOrbit}
        flicker={flicker}
        onClick={handleClick}
        onModelsReady={() => setUnitsReady(true)}
      />

      <div className="vignette" />
      {scanlines && <div className="scanlines" />}

      {/* ---- top status bar ------------------------------------------------ */}
      <div className="topbar">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 100 100" className="brand-glyph">
            <polygon
              points="50,5 89,27 89,73 50,95 11,73 11,27"
              fill="none"
              stroke="#e01124"
              strokeWidth="6"
              strokeLinejoin="round"
            />
            <circle cx="50" cy="50" r="9" fill="#e01124" />
          </svg>
          <div>
            <div className="brand-aurebesh">DEJARIK</div>
            <div className="brand-name">DEJARIK</div>
            <div className="brand-sub">HOLO-TABLE · 3D PROJECTION</div>
          </div>
        </div>
        <div className="topbar-readouts">
          <span className="count">
            <span className="count-dot blue" />
            {counts.blue}
          </span>
          <span className="count">
            <span className="count-dot red" />
            {counts.red}
          </span>
          <span className="rec">
            <span className="rec-dot" />
            REC
          </span>
        </div>
      </div>

      {/* ---- turn pill (top centre) --------------------------------------- */}
      <div
        className="turn-pill"
        style={{
          background: `${turnHex}18`,
          border: `1px solid ${turnHex}55`
        }}
      >
        <span
          className={`turn-dot${aiThinking ? ' thinking' : ''}`}
          style={{
            background: turnHex,
            boxShadow: `0 0 11px ${turnHex}`
          }}
        />
        <span className="turn-label" style={{ color: turnHex }}>
          {turnLabel}
        </span>
      </div>

      {/* ---- left rail: COMMAND + ALLEGIANCE ----------------------------- */}
      <div className="left-rail">
        <div className="panel">
          <div className="panel-head">
            <span className="lozenge" />
            <span className="title">COMMAND</span>
            <span className="rule" />
          </div>
          <button type="button" className="btn danger" onClick={startNewGame}>
            New game
          </button>
          <button
            type="button"
            className="btn"
            onClick={endTurn}
            disabled={state.winner != null || state.turn !== playerSide}
          >
            End turn
          </button>
          <button
            type="button"
            className={`btn ${autoOrbit ? 'orbit-on' : ''}`}
            onClick={() => setAutoOrbit((v) => !v)}
          >
            Auto-orbit · {autoOrbit ? 'ON' : 'OFF'}
          </button>
          {state.survivorClock && (
            <div className="clock">
              {state.survivorClock.team.toUpperCase()} must capture in{' '}
              {state.survivorClock.turnsLeft} turn(s)
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="lozenge" />
            <span className="title">ALLEGIANCE</span>
            <span className="rule" />
          </div>
          <div className="seg" style={{ marginBottom: 11 }}>
            <button
              type="button"
              className={`seg-btn ${playerSide === 'blue' ? 'active blue' : ''}`}
              onClick={() => setPlayerSide('blue')}
            >
              BLUE
            </button>
            <button
              type="button"
              className={`seg-btn ${playerSide === 'red' ? 'active red' : ''}`}
              onClick={() => setPlayerSide('red')}
            >
              RED
            </button>
          </div>
          <div className="subtitle">AI THREAT</div>
          <div className="seg">
            {(['easy', 'normal', 'hard'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`seg-btn ${difficulty === d ? 'active amber' : ''}`}
                onClick={() => setDifficulty(d)}
              >
                {d === 'normal' ? 'NORM' : d.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- right rail: DATABANK + LOG ----------------------------------- */}
      <div className="right-rail">
        <div className="panel">
          <div className="panel-head">
            <span className="lozenge" />
            <span className="title">DATABANK</span>
            <span className="rule" />
            <span className="meta">UNIT BRIEF</span>
          </div>
          <div className="unit-list">
            {ORDERED.map((t) => {
              const u = UNITS[t]
              const active = t === activeBrief
              const isSelectedSel = sel && sel.type === t
              const nameClass = active
                ? isSelectedSel && briefTeam
                  ? briefTeam // 'blue' | 'red'
                  : 'amber'
                : ''
              return (
                <div key={t} className={`unit-row${active ? ' active' : ''}`}>
                  <div className="unit-head" onClick={() => setBriefType(t)}>
                    <div className="unit-head-text">
                      <div className={`unit-name ${nameClass}`}>{u.label}</div>
                      <div className="unit-role">{u.role.toUpperCase()}</div>
                    </div>
                    <span className={`unit-chev${active ? ' active' : ''}`}>
                      {active ? '–' : '+'}
                    </span>
                  </div>
                  {active && (
                    <div className="unit-body">
                      <div className="unit-stat">
                        <span className="key move">MOVE</span>
                        <span className="val">{u.move}</span>
                      </div>
                      <div className="unit-stat">
                        <span className="key strike">STRIKE</span>
                        <span className="val">{u.attack}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="panel grow">
          <div className="panel-head">
            <span className="lozenge" />
            <span className="title">LOG</span>
            <span className="rule" />
            <span className="meta">EVENT FEED</span>
          </div>
          <div className="log-feed">
            {state.log.slice(-30).map((line, i, arr) => (
              <div
                key={`${i}-${line}`}
                className={`log-line${i === arr.length - 1 ? ' latest' : ''}`}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- loading (models still streaming) ---------------------------- */}
      {!unitsReady && (
        <div className="loading">
          <div className="loading-title">DEJARIK</div>
          <div className="loading-sub">PROJECTING UNITS…</div>
        </div>
      )}

      {/* ---- bottom hint --------------------------------------------------- */}
      <div className="hint">
        <span>
          <b>DRAG</b> ORBIT
        </span>
        <span className="sep">·</span>
        <span>
          <b>SCROLL</b> ZOOM
        </span>
        <span className="sep">·</span>
        <span>
          <b>CLICK</b> A UNIT, THEN A GLOWING CELL
        </span>
      </div>

      {/* ---- winner overlay ----------------------------------------------- */}
      {state.winner && (
        <div className="winner-overlay">
          <div className="winner-scan" />
          <div className="winner-tag">// MATCH RESOLVED</div>
          <div className="winner-aurebesh" style={{ color: winnerColor }}>
            {winnerWord}
          </div>
          <div
            className="winner-word"
            style={{
              color: winnerColor,
              textShadow: `0 0 36px ${winnerGlow}`
            }}
          >
            {winnerWord}
          </div>
          <div className="winner-sub">{winnerSub}</div>
          <button type="button" className="btn danger" onClick={startNewGame}>
            New game
          </button>
        </div>
      )}

      {version && (
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 12,
            zIndex: 50,
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: 9,
            color: 'rgba(124,134,148,0.5)',
            letterSpacing: 1
          }}
        >
          v{version}
        </div>
      )}
    </div>
  )
}

export default App
