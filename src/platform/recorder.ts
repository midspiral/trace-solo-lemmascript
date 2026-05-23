// Local-first recording (browser-only). Every episode is durably stored in
// IndexedDB as it's played, so the game works offline and never loses data even
// if the server is unset or down. One-click NDJSON export gives you the corpus
// locally; server sync (sync.ts) is purely additive on top of this.

import { Episode } from './spec'

const DB_NAME = 'trace-solo'
const STORE = 'episodes'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'gameId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** Upsert the episode (called after each committed ply). */
export function saveEpisode(ep: Episode): Promise<void> {
  return tx('readwrite', (s) => s.put(ep)).then(() => undefined)
}

export function loadEpisodes(): Promise<Episode[]> {
  return tx<Episode[]>('readonly', (s) => s.getAll() as IDBRequest<Episode[]>)
}

export function clearEpisodes(): Promise<void> {
  return tx('readwrite', (s) => s.clear()).then(() => undefined)
}

export interface CorpusStats {
  episodes: number
  plies: number
}

export function corpusStats(): Promise<CorpusStats> {
  return loadEpisodes().then((eps) => ({
    episodes: eps.length,
    plies: eps.reduce((n, e) => n + e.records.length, 0),
  }))
}

/** One episode per line (NDJSON) — the natural training unit. */
export function exportNDJSON(eps: Episode[]): string {
  return eps.map((e) => JSON.stringify(e)).join('\n') + (eps.length ? '\n' : '')
}

/** Trigger a browser download of the full local corpus as NDJSON. */
export async function downloadCorpus(): Promise<number> {
  const eps = await loadEpisodes()
  const blob = new Blob([exportNDJSON(eps)], { type: 'application/x-ndjson' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `trace-solo-corpus-${Date.now()}.ndjson`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return eps.length
}
