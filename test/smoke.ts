// Runtime smoke test of the verified-core candidates and the platform's
// faithfulness guarantees. Pure modules only (no DOM), runnable with:
//   npx tsx test/smoke.ts
// This complements the formal proofs: it exercises the same engine the Worker
// uses to replay-validate traces on ingest.

import { slideLine, applyMove, boardSum, LEFT, RIGHT, UP, DOWN } from '../src/games/g2048/engine'
import { game2048 } from '../src/games/g2048/spec'
import { replayStates, validateEpisode } from '../src/platform/replay'
import { canonicalJSON, Episode, TraceRecord } from '../src/platform/spec'

let failures = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name} ${extra}`)
  }
}
function eq(a: number[], b: number[]): boolean {
  return canonicalJSON(a) === canonicalJSON(b)
}
function nonzeros(a: number[]): number {
  return a.filter((x) => x !== 0).length
}

console.log('slideLine — merge laws')
check('[2,2,2,2] -> [4,4,0,0]', eq(slideLine([2, 2, 2, 2]), [4, 4, 0, 0]))
check('[4,4,4,4] -> [8,8,0,0] (no double-merge)', eq(slideLine([4, 4, 4, 4]), [8, 8, 0, 0]))
check('[2,0,2,0] -> [4,0,0,0] (packing)', eq(slideLine([2, 0, 2, 0]), [4, 0, 0, 0]))
check('[4,2,2,0] -> [4,4,0,0]', eq(slideLine([4, 2, 2, 0]), [4, 4, 0, 0]))
check('[2,2,4,0] -> [4,4,0,0]', eq(slideLine([2, 2, 4, 0]), [4, 4, 0, 0]))
check('[0,0,0,0] -> [0,0,0,0]', eq(slideLine([0, 0, 0, 0]), [0, 0, 0, 0]))

// L2 conservation + L3 no-double-merge over many random lines
let l2 = true
let l3 = true
let rngState = 12345
const rnd = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
  return rngState / 0x7fffffff
}
for (let t = 0; t < 20000; t++) {
  const line = [0, 0, 0, 0].map(() => {
    const r = rnd()
    return r < 0.4 ? 0 : 2 ** (1 + Math.floor(rnd() * 5))
  })
  const out = slideLine(line)
  if (out.reduce((a, b) => a + b, 0) !== line.reduce((a, b) => a + b, 0)) l2 = false
  if (out.length !== line.length) l3 = false
  if (2 * nonzeros(out) < nonzeros(line)) l3 = false // L3 lower bound
  if (nonzeros(out) > nonzeros(line)) l3 = false // upper bound
}
check('L2 conservation: sum(slideLine) == sum(line) [20k random]', l2)
check('L3 no-double-merge: ceil(k/2) <= nonzeros(out) <= k [20k random]', l3)

console.log('applyMove — board-level conservation')
let boardL2 = true
let bState = game2048.init(7)
for (let t = 0; t < 5000; t++) {
  for (const d of [LEFT, RIGHT, UP, DOWN]) {
    if (boardSum(applyMove(bState.board, d)) !== boardSum(bState.board)) boardL2 = false
  }
  const legal = game2048.legalActions(bState)
  if (legal.length === 0) bState = game2048.init((t * 31 + 1) | 0)
  else bState = game2048.step(bState, legal[t % legal.length])
}
check('L2 board: sum(applyMove(b,d)) == sum(b) [5k boards × 4 dirs]', boardL2)

console.log('platform P1/P2 — replay reproduces a recorded episode')
// Drive a deterministic game and build an Episode exactly like Session does.
function playEpisode(seed: number, maxPlies: number): Episode {
  let s = game2048.init(seed)
  const records: TraceRecord[] = []
  for (let ply = 0; ply < maxPlies; ply++) {
    const legal = game2048.legalActions(s)
    if (legal.length === 0) break
    const a = legal[(ply * 7 + seed) % legal.length] // arbitrary deterministic policy
    records.push({
      gameKind: game2048.kind, gameId: 'g_test', seed, ply, playerId: 'p_test',
      scoreBefore: game2048.score(s), stateBefore: game2048.encodeState(s),
      action: game2048.encodeAction(a), timeMs: 1, ts: ply,
    })
    s = game2048.step(s, a)
  }
  return {
    gameKind: game2048.kind, gameId: 'g_test', seed, playerId: 'p_test',
    startedAt: 0, endedAt: 1, finalScore: game2048.score(s),
    terminal: game2048.isTerminal(s), records,
  }
}

let allValid = true
let replayExact = true
for (let seed = 1; seed <= 200; seed++) {
  const ep = playEpisode(seed, 400)
  const v = validateEpisode(game2048, ep)
  if (!v.ok) {
    allValid = false
    console.log(`    seed ${seed}: ${v.reason}`)
  }
  // P1: replay from (seed, actions) reproduces every recorded stateBefore
  const actions = ep.records.map((r) => game2048.decodeAction(r.action))
  const states = replayStates(game2048, seed, actions)
  for (let i = 0; i < ep.records.length; i++) {
    if (canonicalJSON(game2048.encodeState(states[i])) !== canonicalJSON(ep.records[i].stateBefore)) {
      replayExact = false
    }
  }
}
check('P2 trajectory validity: validateEpisode ok [200 episodes]', allValid)
check('P1 reproducibility: replay(seed,actions) == recorded states [200 episodes]', replayExact)

// A tampered trace must be rejected (the property has teeth).
const tampered = playEpisode(1, 50)
if (tampered.records.length > 3) {
  const enc = tampered.records[3].stateBefore as { score: number }
  tampered.records[3] = { ...tampered.records[3], stateBefore: { ...enc, score: enc.score + 999 } }
}
check('tampered trace is rejected', validateEpisode(game2048, tampered).ok === false)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
