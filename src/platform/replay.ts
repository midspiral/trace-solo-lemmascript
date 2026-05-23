// Replay + faithfulness checking — the heart of the platform's promise.
//
// P1 (Reproducibility): replayStates(spec, seed, actions) reconstructs the exact
//   sequence of states an episode passed through, from (seed, action-log) alone.
// P2 (Trajectory validity): validateEpisode confirms a recorded episode is a real
//   play — each record's stateBefore equals the state the engine actually reaches.
//
// The Worker runs validateEpisode on ingest, so the central corpus contains only
// provably-faithful, reproducible trajectories. Same code, client and server.

import { GameSpec, Episode, canonicalJSON } from './spec'

/** The state observed before each action, in order, given seed + decoded actions. */
export function replayStates<S, A>(spec: GameSpec<S, A>, seed: number, actions: A[]): S[] {
  const states: S[] = []
  let s = spec.init(seed)
  for (let i = 0; i < actions.length; i++) {
    states.push(s)
    s = spec.step(s, actions[i])
  }
  states.push(s) // final state after the last action
  return states
}

export interface ValidationResult {
  ok: boolean
  /** First ply where replay diverged from the record, or -1 if faithful. */
  divergedAtPly: number
  reason: string
}

/**
 * Re-derive the episode from (seed, actions) and check every recorded
 * stateBefore matches. Also checks ply contiguity (0,1,2,…). This is what makes
 * "verified training data" concrete: a trace that fails this is rejected.
 */
export function validateEpisode<S, A>(spec: GameSpec<S, A>, ep: Episode): ValidationResult {
  for (let i = 0; i < ep.records.length; i++) {
    if (ep.records[i].ply !== i) {
      return { ok: false, divergedAtPly: i, reason: `ply ${ep.records[i].ply} out of order (expected ${i})` }
    }
  }
  let s = spec.init(ep.seed)
  for (let i = 0; i < ep.records.length; i++) {
    const rec = ep.records[i]
    if (canonicalJSON(spec.encodeState(s)) !== canonicalJSON(rec.stateBefore)) {
      return { ok: false, divergedAtPly: i, reason: `stateBefore diverged at ply ${i}` }
    }
    const legal = spec.legalActions(s)
    const a = spec.decodeAction(rec.action)
    if (!legal.some((la) => canonicalJSON(spec.encodeAction(la)) === canonicalJSON(rec.action))) {
      return { ok: false, divergedAtPly: i, reason: `illegal action at ply ${i}` } // P4
    }
    s = spec.step(s, a)
  }
  return { ok: true, divergedAtPly: -1, reason: 'faithful' }
}
