// The plug-in registry. Pure / DOM-free so both the browser app and the
// Cloudflare Worker (for ingest replay-validation) can look up a game by kind.

import { GameSpec } from '../platform/spec'
import { game2048 } from './g2048/spec'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const games: GameSpec<any, any>[] = [game2048]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getGame(kind: string): GameSpec<any, any> | undefined {
  return games.find((g) => g.kind === kind)
}
