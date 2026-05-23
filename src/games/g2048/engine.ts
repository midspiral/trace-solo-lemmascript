// 2048 engine — the verifiable core of this plug-in.
//
// Board: flat number[] of length 16 (row-major); 0 = empty, else a tile value
// (a power of two). All functions are pure and written in LemmaScript-friendly
// style (primitive types, explicit loops, no closures, no spreads).
//
// slideLine carries the merge laws, VERIFIED in Dafny (see engine.dfy,
// `lsc check --backend=dafny`, 12 VCs, 0 errors, 0 assumes):
//   L1 length:         |slideLine(line)| == |line|
//   L2 conservation:   sum(slideLine(line)) == sum(line)
//   L3 no-double-merge: 2*nonzeros(slideLine(line)) >= nonzeros(line)  (and <=)
//   L4 packing:        empties trail tiles (tiles form a prefix)
// Board-level applyMove conservation and L5 (canMove <=> board changes) are
// future work (blocked on lsc support for `number[]` type aliases + .slice()).

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
  //@ verify
  //@ ensures \result.length === line.length
  //@ ensures sumTo(\result, \result.length) === sumTo(line, line.length)
  //@ ensures 2 * nzTo(\result, \result.length) >= nzTo(line, line.length)
  //@ ensures nzTo(\result, \result.length) <= nzTo(line, line.length)
  //@ ensures forall(p, forall(q, (0 <= p && p < q && q < \result.length && \result[p] === EMPTY) ==> \result[q] === EMPTY))
  const tiles: number[] = []
  for (let i = 0; i < line.length; i++) {
    //@ invariant 0 <= i && i <= line.length
    //@ invariant tiles.length <= i
    //@ invariant sumTo(tiles, tiles.length) === sumTo(line, i)
    //@ invariant nzTo(line, i) === tiles.length
    //@ invariant forall(k, 0 <= k && k < tiles.length ==> tiles[k] !== EMPTY)
    if (line[i] !== EMPTY) tiles.push(line[i])
  }
  const out: number[] = []
  let j = 0
  while (j < tiles.length) {
    //@ invariant 0 <= j && j <= tiles.length
    //@ invariant out.length <= j
    //@ invariant 2 * out.length >= j
    //@ invariant sumTo(out, out.length) === sumTo(tiles, j)
    //@ invariant nzTo(out, out.length) === out.length
    //@ invariant forall(k, 0 <= k && k < out.length ==> out[k] !== EMPTY)
    //@ invariant forall(k, 0 <= k && k < tiles.length ==> tiles[k] !== EMPTY)
    //@ decreases tiles.length - j
    if (j + 1 < tiles.length && tiles[j] === tiles[j + 1]) {
      out.push(tiles[j] + tiles[j + 1])
      j = j + 2
    } else {
      out.push(tiles[j])
      j = j + 1
    }
  }
  while (out.length < line.length) {
    //@ invariant out.length <= line.length
    //@ invariant sumTo(out, out.length) === sumTo(line, line.length)
    //@ invariant 2 * nzTo(out, out.length) >= nzTo(line, line.length)
    //@ invariant nzTo(out, out.length) <= nzTo(line, line.length)
    //@ decreases line.length - out.length
    out.push(EMPTY)
  }
  return out
}

// Score gained by sliding a line = total value of newly-merged tiles.
export function slideGain(line: number[]): number {
  const tiles: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== EMPTY) tiles.push(line[i])
  }
  let gain = 0
  let j = 0
  while (j < tiles.length) {
    if (j + 1 < tiles.length && tiles[j] === tiles[j + 1]) {
      gain = gain + tiles[j] + tiles[j + 1]
      j = j + 2
    } else {
      j = j + 1
    }
  }
  return gain
}

// ---------------------------------------------------------------------------
// Lines and orientation
// ---------------------------------------------------------------------------

export function getRow(b: Board, r: number): number[] {
  //@ verify
  //@ requires b.length === SIZE
  //@ requires 0 <= r && r < N
  //@ ensures \result.length === N
  const out: number[] = []
  for (let c = 0; c < N; c++) {
    //@ invariant 0 <= c && c <= N
    //@ invariant out.length === c
    out.push(b[r * N + c])
  }
  return out
}

export function getCol(b: Board, c: number): number[] {
  //@ verify
  //@ requires b.length === SIZE
  //@ requires 0 <= c && c < N
  //@ ensures \result.length === N
  const out: number[] = []
  for (let r = 0; r < N; r++) {
    //@ invariant 0 <= r && r <= N
    //@ invariant out.length === r
    out.push(b[r * N + c])
  }
  return out
}

export function reversed(a: number[]): number[] {
  //@ verify
  //@ ensures \result.length === a.length
  const out: number[] = []
  for (let i = a.length - 1; i >= 0; i--) {
    //@ invariant -1 <= i && i < a.length
    //@ invariant out.length === a.length - 1 - i
    out.push(a[i])
  }
  return out
}

// ---------------------------------------------------------------------------
// A full move: slide every line in the direction's orientation.
// ---------------------------------------------------------------------------

export function applyMove(b: Board, dir: number): Board {
  //@ verify
  //@ requires b.length === SIZE
  //@ ensures \result.length === b.length
  const out: number[] = b.slice()
  if (dir === LEFT || dir === RIGHT) {
    for (let r = 0; r < N; r++) {
      //@ invariant 0 <= r && r <= N
      //@ invariant out.length === b.length
      let line = getRow(b, r)
      if (dir === RIGHT) line = reversed(line)
      let s = slideLine(line)
      if (dir === RIGHT) s = reversed(s)
      for (let c = 0; c < N; c++) {
        //@ invariant 0 <= c && c <= N
        //@ invariant out.length === b.length
        out[r * N + c] = s[c]
      }
    }
  } else {
    for (let c = 0; c < N; c++) {
      //@ invariant 0 <= c && c <= N
      //@ invariant out.length === b.length
      let line = getCol(b, c)
      if (dir === DOWN) line = reversed(line)
      let s = slideLine(line)
      if (dir === DOWN) s = reversed(s)
      for (let r = 0; r < N; r++) {
        //@ invariant 0 <= r && r <= N
        //@ invariant out.length === b.length
        out[r * N + c] = s[r]
      }
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
  //@ verify
  let s = 0
  for (let i = 0; i < b.length; i++) s = s + b[i]
  return s
}
