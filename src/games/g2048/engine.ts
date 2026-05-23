// 2048 engine — the verifiable core of this plug-in.
//
// Board: flat number[] of length 16 (row-major); 0 = empty, else a tile value
// (a power of two). All functions are pure and written in LemmaScript-friendly
// style (primitive types, explicit loops, no closures, no spreads) so the merge
// laws can be added as //@ annotations and discharged to Dafny in a later pass:
//   L2 conservation:  sum(applyMove(b,d)) == sum(b)
//   L3 no-double-merge: 2*nonzeros(slideLine(line)) >= nonzeros(line)
//   L4 packing:        empties trail tiles along the move axis
//   L5 legality:       canMove(b,d) <==> applyMove(b,d) != b

export const N: number = 4
export const SIZE: number = 16 // N * N
export const EMPTY: number = 0

export const LEFT: number = 0
export const RIGHT: number = 1
export const UP: number = 2
export const DOWN: number = 3

export type Board = number[]

// ---------------------------------------------------------------------------
// The merge core: slide a line toward index 0, merging equal adjacent tiles
// exactly once each. This is where 2048 clones get subtle bugs (a tile merging
// twice in one move). The `i += 2` makes merged pairs disjoint.
// ---------------------------------------------------------------------------

export function slideLine(line: number[]): number[] {
  const tiles: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== EMPTY) tiles.push(line[i])
  }
  const out: number[] = []
  let i = 0
  while (i < tiles.length) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      out.push(tiles[i] + tiles[i + 1])
      i = i + 2
    } else {
      out.push(tiles[i])
      i = i + 1
    }
  }
  while (out.length < line.length) out.push(EMPTY)
  return out
}

// Score gained by sliding a line = total value of newly-merged tiles.
export function slideGain(line: number[]): number {
  const tiles: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== EMPTY) tiles.push(line[i])
  }
  let gain = 0
  let i = 0
  while (i < tiles.length) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      gain = gain + tiles[i] + tiles[i + 1]
      i = i + 2
    } else {
      i = i + 1
    }
  }
  return gain
}

// ---------------------------------------------------------------------------
// Lines and orientation
// ---------------------------------------------------------------------------

export function getRow(b: Board, r: number): number[] {
  const out: number[] = []
  for (let c = 0; c < N; c++) out.push(b[r * N + c])
  return out
}

export function getCol(b: Board, c: number): number[] {
  const out: number[] = []
  for (let r = 0; r < N; r++) out.push(b[r * N + c])
  return out
}

export function reversed(a: number[]): number[] {
  const out: number[] = []
  for (let i = a.length - 1; i >= 0; i--) out.push(a[i])
  return out
}

// ---------------------------------------------------------------------------
// A full move: slide every line in the direction's orientation.
// ---------------------------------------------------------------------------

export function applyMove(b: Board, dir: number): Board {
  const out: number[] = b.slice()
  if (dir === LEFT || dir === RIGHT) {
    for (let r = 0; r < N; r++) {
      let line = getRow(b, r)
      if (dir === RIGHT) line = reversed(line)
      let s = slideLine(line)
      if (dir === RIGHT) s = reversed(s)
      for (let c = 0; c < N; c++) out[r * N + c] = s[c]
    }
  } else {
    for (let c = 0; c < N; c++) {
      let line = getCol(b, c)
      if (dir === DOWN) line = reversed(line)
      let s = slideLine(line)
      if (dir === DOWN) s = reversed(s)
      for (let r = 0; r < N; r++) out[r * N + c] = s[r]
    }
  }
  return out
}

export function moveGain(b: Board, dir: number): number {
  let g = 0
  if (dir === LEFT || dir === RIGHT) {
    for (let r = 0; r < N; r++) {
      let line = getRow(b, r)
      if (dir === RIGHT) line = reversed(line)
      g = g + slideGain(line)
    }
  } else {
    for (let c = 0; c < N; c++) {
      let line = getCol(b, c)
      if (dir === DOWN) line = reversed(line)
      g = g + slideGain(line)
    }
  }
  return g
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function boardsEqual(a: Board, b: Board): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// L5: a move is legal iff it changes the board. The game spawns a tile exactly
// when this holds.
export function canMove(b: Board, dir: number): boolean {
  return !boardsEqual(b, applyMove(b, dir))
}

export function anyMove(b: Board): boolean {
  return canMove(b, LEFT) || canMove(b, RIGHT) || canMove(b, UP) || canMove(b, DOWN)
}

export function emptyBoard(): Board {
  const b: number[] = []
  for (let i = 0; i < SIZE; i++) b.push(EMPTY)
  return b
}

export function emptyCells(b: Board): number[] {
  const out: number[] = []
  for (let i = 0; i < b.length; i++) {
    if (b[i] === EMPTY) out.push(i)
  }
  return out
}

export function maxTile(b: Board): number {
  let m = 0
  for (let i = 0; i < b.length; i++) {
    if (b[i] > m) m = b[i]
  }
  return m
}

export function boardSum(b: Board): number {
  let s = 0
  for (let i = 0; i < b.length; i++) s = s + b[i]
  return s
}
