// A play session: drives one GameSpec instance, advances state, and builds the
// append-only Episode as actions are committed. Each commit records the state
// the player actually saw (stateBefore) + the chosen action + think-time, then
// persists locally and syncs (additively). The recorded stateBefore sequence is
// exactly what replay() must reproduce — that link is the platform's guarantee.

import { GameSpec, Episode, TraceRecord } from './spec'
import { saveEpisode } from './recorder'
import { getPlayerId, scheduleSync, flushSync, SyncState } from './sync'

function newId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export class Session<S, A> {
  readonly spec: GameSpec<S, A>
  readonly seed: number
  readonly gameId: string
  readonly playerId: string
  state: S
  episode: Episode
  private lastAt: number

  constructor(spec: GameSpec<S, A>, seed?: number) {
    this.spec = spec
    this.seed = seed ?? (Math.floor(Math.random() * 0x7fffffff) | 0)
    this.gameId = newId('g_')
    this.playerId = getPlayerId()
    this.state = spec.init(this.seed)
    this.lastAt = Date.now()
    this.episode = {
      gameKind: spec.kind,
      gameId: this.gameId,
      seed: this.seed,
      playerId: this.playerId,
      startedAt: Date.now(),
      endedAt: null,
      finalScore: spec.score(this.state),
      terminal: spec.isTerminal(this.state),
      records: [],
    }
  }

  legalActions(): A[] {
    return this.spec.legalActions(this.state)
  }
  isTerminal(): boolean {
    return this.spec.isTerminal(this.state)
  }
  score(): number {
    return this.spec.score(this.state)
  }

  /** Record + apply an action. Returns false if the game is already over. */
  commit(action: A, onSync?: (s: SyncState) => void): boolean {
    if (this.isTerminal()) return false
    const now = Date.now()
    const rec: TraceRecord = {
      gameKind: this.spec.kind,
      gameId: this.gameId,
      seed: this.seed,
      ply: this.episode.records.length,
      playerId: this.playerId,
      scoreBefore: this.spec.score(this.state),
      stateBefore: this.spec.encodeState(this.state),
      action: this.spec.encodeAction(action),
      timeMs: now - this.lastAt,
      ts: now,
    }
    this.episode.records.push(rec)
    this.state = this.spec.step(this.state, action)
    this.lastAt = now
    this.episode.finalScore = this.spec.score(this.state)
    this.episode.terminal = this.isTerminal()
    if (this.episode.terminal) this.episode.endedAt = Date.now()

    const snapshot: Episode = { ...this.episode, records: this.episode.records.slice() }
    void saveEpisode(snapshot)
    if (snapshot.terminal) flushSync(snapshot, onSync)
    else scheduleSync(snapshot, onSync)
    return true
  }
}
