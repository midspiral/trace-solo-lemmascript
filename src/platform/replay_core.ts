// Verified, game-AGNOSTIC core of the recorder (platform properties P1–P4).
//
// The game's transition is a higher-order parameter `step`, so every property
// below holds for ANY game that plugs in via GameSpec — nothing is assumed about
// `step` beyond its signature. This is the lsc-native form of "the recorder is
// the verified product": the proofs are generated from this TypeScript, and the
// production replay.ts is a thin (unverified) adapter that decodes the JSON wire
// form and delegates here.

// P1 — Reproducibility. The exact state trajectory replayed from a start state:
// result[0] is the start, and each result[i+1] is step(result[i], actions[i]).
// So the whole episode is reconstructable from (start, action-log) alone.
export function statesFrom<S, A>(step: (s: S, a: A) => S, s: S, actions: A[]): S[] {
  //@ verify
  //@ type S (==)
  //@ type A (==)
  //@ decreases actions.length
  //@ ensures \result.length === actions.length + 1
  //@ ensures \result[0] === s
  //@ ensures forall(i, 0 <= i && i < actions.length ==> \result[i + 1] === step(\result[i], actions[i]))
  if (actions.length === 0) return [s]
  const rest = statesFrom(step, step(s, actions[0]), actions.slice(1))
  return [s, ...rest]
}

// P2 (trajectory validity) + tamper rejection + P4 (legality). Checks a recorded
// episode against the replay from `s`: each recorded `before` must equal the
// state the engine actually reaches, and each action must have been legal there.
// When it returns true, befores[i] === statesFrom(...)[i] for every i — so any
// tampered trace (some before[i] differs from the faithful replay) is rejected;
// and legal(befores[i], actions[i]) holds for every i.
export function validateFrom<S, A>(
  step: (s: S, a: A) => S,
  legal: (s: S, a: A) => boolean,
  s: S,
  befores: S[],
  actions: A[],
): boolean {
  //@ verify
  //@ type S (==)
  //@ type A (==)
  //@ requires befores.length === actions.length
  //@ decreases actions.length
  //@ ensures \result === true && actions.length > 0 ==> befores[0] === s
  //@ ensures \result === true ==> forall(i, 0 <= i && i + 1 < actions.length ==> befores[i + 1] === step(befores[i], actions[i]))
  //@ ensures \result === true ==> forall(i, 0 <= i && i < actions.length ==> legal(befores[i], actions[i]))
  if (actions.length === 0) return true
  if (befores[0] !== s) return false
  if (!legal(s, actions[0])) return false
  return validateFrom(step, legal, step(s, actions[0]), befores.slice(1), actions.slice(1))
}

// Completeness: a genuine play — recorded states that actually chain from s, with
// every action legal in its state — always validates. Together with validateFrom's
// soundness this means the checker rejects exactly the tampered/illegal traces and
// never a faithful one, so it is not vacuously strict.
export function genuinePlayValidates<S, A>(
  step: (s: S, a: A) => S,
  legal: (s: S, a: A) => boolean,
  s: S,
  befores: S[],
  actions: A[],
): boolean {
  //@ verify
  //@ type S (==)
  //@ type A (==)
  //@ requires befores.length === actions.length
  //@ requires actions.length > 0 ==> befores[0] === s
  //@ requires forall(i, 0 <= i && i + 1 < actions.length ==> befores[i + 1] === step(befores[i], actions[i]))
  //@ requires forall(i, 0 <= i && i < actions.length ==> legal(befores[i], actions[i]))
  //@ decreases actions.length
  //@ ensures \result === true
  return validateFrom(step, legal, s, befores, actions)
}
