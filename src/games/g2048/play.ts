// Runtime-only animation planner (not part of the verified core). Given a board
// and direction, it reports where each tile slides and which ones merge, so the
// UI can animate true 2048-style sliding. The authoritative post-move board
// always comes from engine.applyMove via the GameSpec; this only positions DOM
// nodes, so a cosmetic mismatch could never corrupt a recorded trace.

import { N, LEFT, RIGHT, UP, DOWN } from './engine'

export interface TileMove {
  fromCell: number
  toCell: number
  merged: boolean
}

interface LineMove {
  from: number // position along the line (slide orientation)
  to: number
  merged: boolean
}

function planLine(line: number[]): LineMove[] {
  const idxs: number[] = []
  for (let i = 0; i < line.length; i++) if (line[i] !== 0) idxs.push(i)
  const moves: LineMove[] = []
  let i = 0
  let out = 0
  while (i < idxs.length) {
    if (i + 1 < idxs.length && line[idxs[i]] === line[idxs[i + 1]]) {
      moves.push({ from: idxs[i], to: out, merged: true })
      moves.push({ from: idxs[i + 1], to: out, merged: true })
      i += 2
      out++
    } else {
      moves.push({ from: idxs[i], to: out, merged: false })
      i++
      out++
    }
  }
  return moves
}

// Board cell for line `k`, position `p` along the line in the slide orientation.
function cellFor(dir: number, k: number, p: number): number {
  if (dir === LEFT) return k * N + p
  if (dir === RIGHT) return k * N + (N - 1 - p)
  if (dir === UP) return p * N + k
  return (N - 1 - p) * N + k // DOWN
}

export function planMove(board: number[], dir: number): TileMove[] {
  const moves: TileMove[] = []
  for (let k = 0; k < N; k++) {
    const line: number[] = []
    for (let p = 0; p < N; p++) line.push(board[cellFor(dir, k, p)])
    const lm = planLine(line)
    for (let j = 0; j < lm.length; j++) {
      moves.push({
        fromCell: cellFor(dir, k, lm[j].from),
        toCell: cellFor(dir, k, lm[j].to),
        merged: lm[j].merged,
      })
    }
  }
  return moves
}
