// Deterministic seeded PRNG (mulberry32). Pure: the generator state is just a
// number, so a game can fold it into its state and stay fully deterministic.
// Folding the RNG into game state is what makes (seed, action-log) sufficient
// to reconstruct an entire episode.

export interface Rng {
  readonly value: number // in [0, 1)
  readonly next: number // next state
}

export function rngStep(state: number): Rng {
  const s = (state + 0x6d2b79f5) | 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return { value, next: s }
}

/** Uniform integer in [0, n). */
export function rngInt(state: number, n: number): { value: number; next: number } {
  const r = rngStep(state)
  return { value: Math.floor(r.value * n), next: r.next }
}
