// trace-solo ingest Worker.
//
// The key move: it imports the SAME verified TypeScript engine the browser runs
// (no adapter layer) and re-runs validateEpisode — replaying every trace from
// (seed, actions) — before accepting it. The central corpus therefore holds
// only provably-faithful, reproducible trajectories. D1 enforces append-only
// integrity via PRIMARY KEY (game_id, ply); R2 (optional) stores one immutable
// NDJSON object per completed episode for zero-egress public download.

import { getGame } from '../../src/games/registry'
import { validateEpisode } from '../../src/platform/replay'
import { Episode } from '../../src/platform/spec'

// Minimal structural types so the Worker is self-contained (no extra deps).
interface D1Result<T = unknown> {
  results: T[]
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run(): Promise<unknown>
  all<T = unknown>(): Promise<D1Result<T>>
  first<T = unknown>(): Promise<T | null>
}
interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown>
}
interface R2Bucket {
  put(key: string, value: string): Promise<unknown>
}
interface Env {
  DB: D1Database
  CORPUS?: R2Bucket
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    try {
      if (req.method === 'POST' && url.pathname === '/traces') return await ingest(req, env)
      if (req.method === 'GET' && url.pathname === '/stats') return await stats(env)
      if (req.method === 'GET' && url.pathname === '/corpus.ndjson') return await corpus(env, url)
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500)
    }
    return json({ ok: false, error: 'not found' }, 404)
  },
}

async function ingest(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { episode?: Episode }
  const ep = body.episode
  if (!ep || !ep.gameId || !Array.isArray(ep.records)) return json({ ok: false, rejected: 1, reason: 'malformed' }, 400)

  const spec = getGame(ep.gameKind)
  if (!spec) return json({ ok: false, rejected: 1, reason: `unknown game ${ep.gameKind}` }, 400)

  // The trust boundary: only provably-faithful traces are stored.
  const v = validateEpisode(spec, ep)
  if (!v.ok) return json({ ok: false, rejected: 1, reason: v.reason, ply: v.divergedAtPly }, 422)

  // Append-only insert; PRIMARY KEY (game_id, ply) dedups re-syncs.
  const stmts: D1PreparedStatement[] = ep.records.map((r) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO moves
       (game_id, ply, game_kind, seed, player_id, score_before, state_before, action, time_ms, ts)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      r.gameId, r.ply, r.gameKind, r.seed, r.playerId, r.scoreBefore,
      JSON.stringify(r.stateBefore), JSON.stringify(r.action), r.timeMs, r.ts,
    ),
  )
  stmts.push(
    env.DB.prepare(
      `INSERT OR REPLACE INTO episodes
       (game_id, game_kind, seed, player_id, started_at, ended_at, final_score, terminal, plies)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(
      ep.gameId, ep.gameKind, ep.seed, ep.playerId, ep.startedAt, ep.endedAt,
      ep.finalScore, ep.terminal ? 1 : 0, ep.records.length,
    ),
  )
  if (stmts.length) await env.DB.batch(stmts)

  // Completed episodes become immutable training objects in R2 (if bound).
  if (ep.terminal && env.CORPUS) {
    await env.CORPUS.put(`${ep.gameKind}/${ep.gameId}.ndjson`, JSON.stringify(ep) + '\n')
  }

  return json({ ok: true, accepted: ep.records.length, rejected: 0 })
}

async function stats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM episodes) AS episodes, (SELECT COUNT(*) FROM moves) AS plies`,
  ).first<{ episodes: number; plies: number }>()
  return json({ episodes: row?.episodes ?? 0, plies: row?.plies ?? 0 })
}

// Reconstruct recent full episodes from D1 as NDJSON (one episode per line).
async function corpus(env: Env, url: URL): Promise<Response> {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500)
  const eps = await env.DB.prepare(
    `SELECT game_id, game_kind, seed, player_id, started_at, ended_at, final_score, terminal
     FROM episodes ORDER BY COALESCE(ended_at, started_at) DESC LIMIT ?`,
  ).bind(limit).all<{
    game_id: string; game_kind: string; seed: number; player_id: string
    started_at: number; ended_at: number; final_score: number; terminal: number
  }>()

  const lines: string[] = []
  for (const e of eps.results) {
    const moves = await env.DB.prepare(
      `SELECT ply, score_before, state_before, action, time_ms, ts FROM moves WHERE game_id = ? ORDER BY ply`,
    ).bind(e.game_id).all<{
      ply: number; score_before: number; state_before: string; action: string; time_ms: number; ts: number
    }>()
    const ep: Episode = {
      gameKind: e.game_kind, gameId: e.game_id, seed: e.seed, playerId: e.player_id,
      startedAt: e.started_at, endedAt: e.ended_at, finalScore: e.final_score, terminal: !!e.terminal,
      records: moves.results.map((m) => ({
        gameKind: e.game_kind, gameId: e.game_id, seed: e.seed, ply: m.ply, playerId: e.player_id,
        scoreBefore: m.score_before, stateBefore: JSON.parse(m.state_before),
        action: JSON.parse(m.action), timeMs: m.time_ms, ts: m.ts,
      })),
    }
    lines.push(JSON.stringify(ep))
  }
  return new Response(lines.join('\n') + (lines.length ? '\n' : ''), {
    headers: { 'content-type': 'application/x-ndjson', ...CORS },
  })
}
