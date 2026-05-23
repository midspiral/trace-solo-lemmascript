// Replay validation — the heart of the platform's promise, now backed by the
// VERIFIED core in replay_core.ts.
//
// validateEpisode re-derives a recorded episode from (seed, actions) and accepts
// it only if every recorded `stateBefore` matches and every action was legal —
// the faithfulness decision is delegated to the verified `validateFrom` (P2 + P4
// + tamper rejection). The Worker runs this on ingest, so the central corpus
// contains only provably-faithful, reproducible trajectories. Same code, client
// and server.
//
// State equality must be STRUCTURAL. JS `===` on objects is reference equality,
// while the verified core is proven over structural equality, so we run the core
// over the canonical-JSON ENCODING of states (S = string): there `===` is string
// equality, which is structural and matches the model. See LS_TODO.md #8.

import { GameSpec, Episode, canonicalJSON } from './spec'
import { validateFrom } from './replay_core'

export interface ValidationResult {
  ok: boolean
  /** First ply where replay diverged from the record, or -1 if faithful. */
  divergedAtPly: number
  reason: string
}

/**
 * Re-derive the episode from (seed, actions) and check every recorded
 * stateBefore matches and every action was legal. The accept/reject decision is
 * the verified `validateFrom`; on rejection we scan once more only to report
 * which ply diverged (a cosmetic diagnostic — the verified core already decided).
 */
export function validateEpisode<S, A>(spec: GameSpec<S, A>, ep: Episode): ValidationResult {
  // Ply contiguity (0,1,2,…). Cheap structural precheck before the core.
  for (let i = 0; i < ep.records.length; i++) {
    if (ep.records[i].ply !== i) {
      return { ok: false, divergedAtPly: i, reason: `ply ${ep.records[i].ply} out of order (expected ${i})` }
    }
  }

  // Canonical-string view of states (S = string) so structural state equality is
  // plain string `===`, matching the verified model.
  const canon = (s: S): string => canonicalJSON(spec.encodeState(s))
  const stepStr = (cur: string, a: A): string => canon(spec.step(spec.decodeState(JSON.parse(cur)), a))
  const legalStr = (cur: string, a: A): boolean => {
    const s = spec.decodeState(JSON.parse(cur))
    const enc = canonicalJSON(spec.encodeAction(a))
    return spec.legalActions(s).some((la) => canonicalJSON(spec.encodeAction(la)) === enc)
  }

  const start = canon(spec.init(ep.seed))
  const befores = ep.records.map((r) => canonicalJSON(r.stateBefore))
  const actions = ep.records.map((r) => spec.decodeAction(r.action))

  // Verified faithfulness decision (P2 chaining + P4 legality + tamper rejection).
  if (validateFrom(stepStr, legalStr, start, befores, actions)) {
    return { ok: true, divergedAtPly: -1, reason: 'faithful' }
  }

  // Rejected — locate the first divergence for the error message.
  let cur = start
  for (let i = 0; i < befores.length; i++) {
    if (befores[i] !== cur) {
      return { ok: false, divergedAtPly: i, reason: `stateBefore diverged at ply ${i}` }
    }
    if (!legalStr(cur, actions[i])) {
      return { ok: false, divergedAtPly: i, reason: `illegal action at ply ${i}` } // P4
    }
    cur = stepStr(cur, actions[i])
  }
  return { ok: false, divergedAtPly: -1, reason: 'rejected' }
}
