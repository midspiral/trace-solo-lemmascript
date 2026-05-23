// The platform contract. A game is a plug-in implementing GameSpec; everything
// else (recording, replay, export, sync) is supplied by the platform and is
// game-agnostic. This module is DOM-free so it can run in the browser AND on
// the Cloudflare Worker (which replays traces on ingest with the same code).
//
// The state S must fold in *all* sources of nondeterminism (e.g. a seeded RNG
// counter), so that `step` is a pure deterministic function. That is what makes
// a trace reconstructable from (seed, action-log) alone.

export interface GameSpec<S, A> {
  /** Stable identifier, e.g. "2048". Used as the corpus partition key. */
  readonly kind: string
  /** Human title for the UI. */
  readonly title: string

  /** Deterministic initial state for a given seed. */
  init(seed: number): S
  /** Actions legal in this state. step() is only ever called with one of these. */
  legalActions(s: S): A[]
  /** Pure deterministic transition. Precondition: a ∈ legalActions(s). */
  step(s: S, a: A): S
  /** Has the game ended? */
  isTerminal(s: S): boolean
  /** Display/corpus score for a state. */
  score(s: S): number

  /** JSON-serializable snapshot of a state (goes into the trace). */
  encodeState(s: S): unknown
  /** JSON-serializable form of an action (goes into the trace). */
  encodeAction(a: A): unknown
  /** Inverse of encodeAction — needed to replay a recorded trace. */
  decodeAction(j: unknown): A
  /** Inverse of encodeState — reconstruct a typed state from its encoded form.
   *  Lets validation re-derive states (step then re-encode) when checking a trace. */
  decodeState(j: unknown): S
}

/** One recorded transition: the state before, the action taken, and timing. */
export interface TraceRecord {
  gameKind: string
  gameId: string
  seed: number
  ply: number
  playerId: string
  scoreBefore: number
  stateBefore: unknown // encodeState(s) — the input the action was chosen on
  action: unknown // encodeAction(a)
  timeMs: number // think-time for this action
  ts: number // wall-clock when committed
}

/** A complete (or in-progress) episode: header + ordered records. */
export interface Episode {
  gameKind: string
  gameId: string
  seed: number
  playerId: string
  startedAt: number
  endedAt: number | null
  finalScore: number
  terminal: boolean
  records: TraceRecord[]
}

/** Canonical JSON for stable deep-equality (used by replay validation). */
export function canonicalJSON(v: unknown): string {
  return JSON.stringify(sortKeys(v))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}
