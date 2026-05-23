// 2048 as a platform GameSpec. The RNG counter is folded into the state, so
// `step` is pure and deterministic — that is exactly what lets replay(seed,
// actions) reconstruct an entire game. The verified board math lives in
// engine.ts; this file threads the seeded spawn through it.

import { GameSpec } from '../../platform/spec'
import { rngInt, rngStep } from '../../platform/rng'
import {
  Board,
  LEFT,
  RIGHT,
  UP,
  DOWN,
  emptyBoard,
  emptyCells,
  applyMove,
  moveGain,
  canMove,
  anyMove,
  boardsEqual,
  maxTile,
} from './engine'

export interface G2048State {
  board: Board
  score: number
  rng: number
  won: boolean
}

export type G2048Action = number // LEFT | RIGHT | UP | DOWN

export const DIRS: number[] = [LEFT, RIGHT, UP, DOWN]

const DIR_NAME: Record<number, string> = { [LEFT]: 'left', [RIGHT]: 'right', [UP]: 'up', [DOWN]: 'down' }
const NAME_DIR: Record<string, number> = { left: LEFT, right: RIGHT, up: UP, down: DOWN }

export function dirName(d: number): string {
  return DIR_NAME[d]
}

// Place a new tile (90% "2", 10% "4") on a uniformly-chosen empty cell, threading
// the RNG counter. Deterministic given (board, rng).
function spawn(board: Board, rng: number): { board: Board; rng: number } {
  const empties = emptyCells(board)
  if (empties.length === 0) return { board, rng }
  const pick = rngInt(rng, empties.length)
  const cell = empties[pick.value]
  const r2 = rngStep(pick.next)
  const value = r2.value < 0.9 ? 2 : 4
  const nb = board.slice()
  nb[cell] = value
  return { board: nb, rng: r2.next }
}

export const game2048: GameSpec<G2048State, G2048Action> = {
  kind: '2048',
  title: '2048',

  init(seed: number): G2048State {
    let board = emptyBoard()
    let rng = seed | 0
    let r = spawn(board, rng)
    board = r.board
    rng = r.rng
    r = spawn(board, rng)
    board = r.board
    rng = r.rng
    return { board, score: 0, rng, won: false }
  },

  legalActions(s: G2048State): G2048Action[] {
    const out: number[] = []
    for (let i = 0; i < DIRS.length; i++) {
      if (canMove(s.board, DIRS[i])) out.push(DIRS[i])
    }
    return out
  },

  step(s: G2048State, dir: G2048Action): G2048State {
    const moved = applyMove(s.board, dir)
    if (boardsEqual(moved, s.board)) return s // no-op guard; legal actions never hit this
    const gain = moveGain(s.board, dir)
    const sp = spawn(moved, s.rng)
    const won = s.won || maxTile(sp.board) >= 2048
    return { board: sp.board, score: s.score + gain, rng: sp.rng, won }
  },

  isTerminal(s: G2048State): boolean {
    return !anyMove(s.board)
  },

  score(s: G2048State): number {
    return s.score
  },

  encodeState(s: G2048State): unknown {
    return { board: s.board.slice(), score: s.score, rng: s.rng, won: s.won }
  },

  encodeAction(a: G2048Action): unknown {
    return dirName(a)
  },

  decodeAction(j: unknown): G2048Action {
    return NAME_DIR[String(j)]
  },

  decodeState(j: unknown): G2048State {
    const o = j as { board: number[]; score: number; rng: number; won: boolean }
    return { board: o.board.slice(), score: o.score, rng: o.rng, won: o.won }
  },
}
