// Server sync — strictly additive. If VITE_TRACE_ENDPOINT is unset, every call
// here is a no-op and the game is unaffected (local-first). If it's set, we
// fire-and-forget the episode to the Worker, which replay-validates it before
// accepting. Errors are swallowed: a down or misconfigured backend degrades to
// local-only, it never breaks play.

import { Episode } from './spec'

const ENDPOINT: string = (import.meta.env.VITE_TRACE_ENDPOINT as string | undefined) ?? ''
const PLAYER_KEY = 'trace-solo-player'

export function syncEnabled(): boolean {
  return ENDPOINT.length > 0
}

/** Stable anonymous id for this browser. No account, no PII. */
export function getPlayerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_KEY)
    if (!id) {
      id = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem(PLAYER_KEY, id)
    }
    return id
  } catch {
    return 'p_anon'
  }
}

export type SyncState = 'off' | 'pending' | 'synced' | 'error' | 'rejected'

async function post(ep: Episode): Promise<SyncState> {
  try {
    const res = await fetch(ENDPOINT.replace(/\/$/, '') + '/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ episode: ep }),
      keepalive: true,
    })
    if (!res.ok) return 'error'
    const body = (await res.json()) as { ok?: boolean; rejected?: number }
    if (body.ok === false || (body.rejected ?? 0) > 0) return 'rejected'
    return 'synced'
  } catch {
    return 'error'
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Debounced sync during play. Server dedups by (game_id, ply). */
export function scheduleSync(ep: Episode, onState?: (s: SyncState) => void): void {
  if (!syncEnabled()) {
    onState?.('off')
    return
  }
  onState?.('pending')
  const prev = timers.get(ep.gameId)
  if (prev) clearTimeout(prev)
  timers.set(
    ep.gameId,
    setTimeout(() => {
      timers.delete(ep.gameId)
      void post(ep).then((s) => onState?.(s))
    }, 1500),
  )
}

/** Send immediately (e.g. on game over). */
export function flushSync(ep: Episode, onState?: (s: SyncState) => void): void {
  if (!syncEnabled()) {
    onState?.('off')
    return
  }
  const prev = timers.get(ep.gameId)
  if (prev) clearTimeout(prev)
  timers.delete(ep.gameId)
  onState?.('pending')
  void post(ep).then((s) => onState?.(s))
}

export async function serverStats(): Promise<{ episodes: number; plies: number } | null> {
  if (!syncEnabled()) return null
  try {
    const res = await fetch(ENDPOINT.replace(/\/$/, '') + '/stats')
    if (!res.ok) return null
    return (await res.json()) as { episodes: number; plies: number }
  } catch {
    return null
  }
}
