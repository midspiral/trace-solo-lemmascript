-- D1 schema. PRIMARY KEY (game_id, ply) is the append-only integrity primitive:
-- INSERT OR IGNORE makes re-syncing the growing episode idempotent and makes it
-- impossible to rewrite history at a ply that already exists.

CREATE TABLE IF NOT EXISTS moves (
  game_id      TEXT    NOT NULL,
  ply          INTEGER NOT NULL,
  game_kind    TEXT    NOT NULL,
  seed         INTEGER NOT NULL,
  player_id    TEXT    NOT NULL,
  score_before INTEGER NOT NULL,
  state_before TEXT    NOT NULL,
  action       TEXT    NOT NULL,
  time_ms      INTEGER NOT NULL,
  ts           INTEGER NOT NULL,
  PRIMARY KEY (game_id, ply)
);

CREATE TABLE IF NOT EXISTS episodes (
  game_id     TEXT PRIMARY KEY,
  game_kind   TEXT    NOT NULL,
  seed        INTEGER NOT NULL,
  player_id   TEXT    NOT NULL,
  started_at  INTEGER,
  ended_at    INTEGER,
  final_score INTEGER,
  terminal    INTEGER,
  plies       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_moves_kind ON moves(game_kind);
CREATE INDEX IF NOT EXISTS idx_episodes_kind ON episodes(game_kind);
