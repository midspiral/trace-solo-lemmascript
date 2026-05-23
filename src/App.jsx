import { useEffect, useRef, useState, useCallback } from 'react'
import { Session } from './platform/session'
import { corpusStats, downloadCorpus, clearEpisodes } from './platform/recorder'
import { syncEnabled } from './platform/sync'
import { game2048 } from './games/g2048/spec'
import { canMove, LEFT, RIGHT, UP, DOWN, N } from './games/g2048/engine'
import { planMove } from './games/g2048/play'

let TILE_ID = 0
const nextId = () => ++TILE_ID

const BEST_KEY = 'trace-solo-best-2048'

// Build renderable tiles from a board. `moves` (from the slide just played) tells
// us which destination cells are merges (pulse) and which cell is the fresh
// spawn (pop). Empty `moves` => a brand-new game, every tile pops in.
function boardToTiles(board, moves) {
  const occupied = new Set(moves.map((m) => m.toCell))
  const merged = new Set(moves.filter((m) => m.merged).map((m) => m.toCell))
  const out = []
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 0) continue
    out.push({ id: nextId(), value: board[i], cell: i, merged: merged.has(i), isNew: !occupied.has(i) })
  }
  return out
}

// Slide existing tiles to their destination cells (animates the transform).
function slideTiles(tiles, moves) {
  const to = new Map()
  for (const m of moves) to.set(m.fromCell, m.toCell)
  return tiles.map((t) => ({ ...t, cell: to.has(t.cell) ? to.get(t.cell) : t.cell, merged: false, isNew: false }))
}

const KEY_DIR = {
  ArrowLeft: LEFT, a: LEFT, A: LEFT,
  ArrowRight: RIGHT, d: RIGHT, D: RIGHT,
  ArrowUp: UP, w: UP, W: UP,
  ArrowDown: DOWN, s: DOWN, S: DOWN,
}

export default function App() {
  const [tiles, setTiles] = useState([])
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY)) || 0)
  const [seed, setSeed] = useState(0)
  const [overlay, setOverlay] = useState(null) // 'over' | 'won' | null
  const [stats, setStats] = useState({ episodes: 0, plies: 0 })
  const [sync, setSync] = useState(syncEnabled() ? 'pending' : 'off')

  const sessionRef = useRef(null)
  const tilesRef = useRef([])
  const animRef = useRef(false)
  const wonRef = useRef(false)

  const applyTiles = (t) => {
    tilesRef.current = t
    setTiles(t)
  }

  const refreshStats = useCallback(() => {
    corpusStats().then(setStats).catch(() => {})
  }, [])

  const newGame = useCallback(
    (fixedSeed) => {
      const s = new Session(game2048, fixedSeed)
      sessionRef.current = s
      wonRef.current = false
      animRef.current = false
      setSeed(s.seed)
      setScore(0)
      setOverlay(null)
      applyTiles(boardToTiles(s.state.board, []))
      refreshStats()
    },
    [refreshStats],
  )

  const move = useCallback(
    (dir) => {
      const s = sessionRef.current
      if (!s || animRef.current || s.isTerminal()) return
      if (!canMove(s.state.board, dir)) return // illegal: ignore, no spawn, no record

      const moves = planMove(s.state.board, dir)
      animRef.current = true
      applyTiles(slideTiles(tilesRef.current, moves))
      s.commit(dir, setSync) // advances state + records the trace
      const newBoard = s.state.board

      setTimeout(() => {
        applyTiles(boardToTiles(newBoard, moves))
        animRef.current = false
        setScore(s.score())
        setBest((b) => {
          const nb = Math.max(b, s.score())
          if (nb !== b) localStorage.setItem(BEST_KEY, String(nb))
          return nb
        })
        refreshStats()
        if (s.isTerminal()) setOverlay('over')
        else if (s.state.won && !wonRef.current) {
          wonRef.current = true
          setOverlay('won')
        }
      }, 110)
    },
    [refreshStats],
  )

  // input
  useEffect(() => {
    newGame()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      const dir = KEY_DIR[e.key]
      if (dir === undefined) return
      e.preventDefault()
      move(dir)
    }
    window.addEventListener('keydown', onKey, { passive: false })
    return () => window.removeEventListener('keydown', onKey)
  }, [move])

  const touch = useRef(null)
  const onTouchStart = (e) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e) => {
    if (!touch.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touch.current.x
    const dy = t.clientY - touch.current.y
    touch.current = null
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? RIGHT : LEFT)
    else move(dy > 0 ? DOWN : UP)
  }

  const onExport = () => downloadCorpus().catch(() => {})
  const onClear = () => {
    if (!confirm('Clear all locally recorded traces?')) return
    clearEpisodes().then(refreshStats)
  }

  const syncLabel = {
    off: 'local only', pending: 'syncing…', synced: 'synced',
    error: 'offline', rejected: 'rejected',
  }[sync]

  return (
    <div className="app">
      <header className="head">
        <div className="brand">
          <h1>trace&nbsp;solo</h1>
          <p>2048 · every move recorded as verified, replayable training data</p>
        </div>
        <div className="scores">
          <div className="scorebox">
            <span className="lbl">score</span>
            <span className="val">{score}</span>
          </div>
          <div className="scorebox">
            <span className="lbl">best</span>
            <span className="val">{best}</span>
          </div>
        </div>
      </header>

      <div className="toolbar">
        <button className="btn primary" onClick={() => newGame()}>New game</button>
        <span className="seed" title="Replay seed — this whole game is reconstructable from (seed, moves)">
          seed {seed}
        </span>
        <div className="spacer" />
        <span className={`syncdot ${sync}`} title={`server sync: ${syncLabel}`} />
        <span className="synctxt">{syncLabel}</span>
      </div>

      <div
        className="board"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="cells">
          {Array.from({ length: N * N }).map((_, i) => (
            <div className="cell" key={i} />
          ))}
        </div>
        {tiles.map((t) => {
          const row = Math.floor(t.cell / N)
          const col = t.cell % N
          const face = `tile-face v${t.value <= 2048 ? t.value : 'big'}${t.isNew ? ' new' : ''}${t.merged ? ' merged' : ''}`
          return (
            <div
              key={t.id}
              className="tile"
              style={{
                transform: `translate(calc(${col} * (var(--cell) + var(--gap))), calc(${row} * (var(--cell) + var(--gap))))`,
              }}
            >
              <div className={face}><span>{t.value}</span></div>
            </div>
          )
        })}

        {overlay && (
          <div className={`overlay ${overlay}`}>
            <div className="overlay-card">
              <h2>{overlay === 'won' ? 'You hit 2048!' : 'Game over'}</h2>
              <p>score {score}</p>
              <div className="overlay-actions">
                {overlay === 'won' && (
                  <button className="btn ghost" onClick={() => setOverlay(null)}>Keep going</button>
                )}
                <button className="btn primary" onClick={() => newGame()}>New game</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <section className="corpus">
        <div className="corpus-stat">
          <strong>{stats.episodes}</strong> episodes · <strong>{stats.plies}</strong> moves recorded locally
        </div>
        <div className="corpus-actions">
          <button className="btn" onClick={onExport} disabled={stats.episodes === 0}>Export NDJSON</button>
          <button className="btn subtle" onClick={onClear} disabled={stats.episodes === 0}>Clear</button>
        </div>
      </section>

      <footer className="foot">
        <span>Arrow keys · WASD · swipe</span>
        <span>
          The recorder, replay &amp; export are the verified core — every trace is reconstructable from{' '}
          <code>(seed, moves)</code> through a verified engine.
        </span>
      </footer>
    </div>
  )
}
