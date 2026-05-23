# trace-solo

A platform for collecting **reproducible training trajectories** from pure,
single-player browser games. Play a game; every move is recorded as
`(state_before, action, think_time)` and aggregated into a corpus you can train
on. The particular game is incidental — the product is the recorder.

Built with [LemmaScript](https://github.com/midspiral/LemmaScript): the parts
that make the corpus *trustworthy* are written in plain TypeScript with `//@`
specs and discharged to Dafny, and the **same** TypeScript runs in the browser,
in replay, and on the ingest server.

## Why verification belongs here

The platform's promise is "every trace we collect is faithful, reproducible
training data." That promise is a set of properties about the recorder — so
those are exactly what we verify. They are **game-agnostic**: the game's `step`
is treated as a black box.

- **P1 — Reproducibility.** `replay(seed, actions)` reconstructs the exact state
  sequence an episode passed through. The whole corpus is reconstructable from
  `(seed, action-log)` alone.
- **P2 — Trajectory validity.** A recorded episode is a real play: plies are
  contiguous, append-only, and `record[i+1].before == step(record[i].before,
  record[i].action)`. No fabricated steps.
- **P3 — Append-only integrity.** History is never rewritten. Enforced at the
  database by `PRIMARY KEY (game_id, ply)`.
- **P4 — Legality.** Every recorded action was legal in its state.

The ingest server runs the **same verified `step`** and re-checks P1/P2 on every
submission (`validateEpisode`), rejecting anything that doesn't replay. So the
central corpus contains only provably-faithful trajectories — the verification
is the thing that makes "verified training data" mean something, not a feature
bolted onto the side.

## How it works

```
GameSpec  (the plug-in contract: init/step/legalActions/isTerminal/encode/decode)
   │
   ├─ Session  ── builds an append-only Episode as you play
   ├─ recorder ── IndexedDB (local-first, offline, one-click NDJSON export)
   ├─ sync     ── batched, fire-and-forget POST to the Worker (additive)
   └─ replay   ── replay(seed, actions) + validateEpisode  ← P1/P2

Worker (Cloudflare)  ── same GameSpec; replay-validates on ingest
   ├─ D1   ── per-ply rows, UNIQUE(game_id, ply)              ← P3
   └─ R2   ── one immutable NDJSON object per completed game (optional)
```

A game folds all of its nondeterminism (e.g. a seeded RNG counter) into its
state, so `step` is a pure deterministic function. That purity is what makes a
whole episode reconstructable from `(seed, action-log)`.

**The server is strictly additive.** With `VITE_TRACE_ENDPOINT` unset the game
plays identically, records locally, and exports NDJSON — a down or
unconfigured backend degrades to local-only, it never breaks play.

## The games

- **2048** *(first plug-in)* — slick, fun, and the place to demonstrate
  *per-game* depth. Its slide/merge engine (`games/g2048/engine.ts`) is the
  verifiable core, with the laws clones get wrong:
  - **L2 conservation** — a move never creates or destroys tile mass:
    `sum(applyMove(b,d)) == sum(b)`.
  - **L3 no-double-merge** — `2·nonzeros(slideLine(line)) ≥ nonzeros(line)`, so
    `[4,4,4,4]` becomes `[8,8,0,0]`, never `[16,0,0,0]`. (L2 alone misses this —
    both sum to 16.)
  - **L4 packing** and **L5** `canMove(b,d) ⇔ applyMove(b,d) ≠ b`.
- **equality** *(planned)* — retailors
  [equality-game-lemmascript](https://github.com/midspiral/equality-game-lemmascript)
  into a solo `GameSpec`, reusing its sound+complete decision procedure to show
  the platform can host a *deep* per-game proof.

## Verification status

This is a **work in progress**.

**Proven in Dafny** (`../LemmaScript/tools/check.sh dafny`, files in
`LemmaScript-files.txt`): the 2048 merge core `slideLine`
(`src/games/g2048/engine.ts` → `engine.dfy`) carries laws **L1–L4** —
length preservation, **L2 conservation** (`sum` preserved), **L3 no-double-merge**
(`2·nonzeros(result) ≥ nonzeros(line)` and `≤`, so `[4,4,4,4] → [8,8,0,0]` is
forced), and **L4 packing** (tiles form a prefix). 12 verification conditions,
0 errors, **0 `assume`s, 0 axioms**; the `.dfy` is additions-only over the
generated `.dfy.gen` (`lsc check` enforces this). The proof rests on prefix-sum /
prefix-count append lemmas; L3's centerpiece is the quantifier-free merge
invariant `2·|out| ≥ tilesConsumed`.

**Runtime-checked, formal proof still to come** (`npx tsx test/smoke.ts`): board-level
conservation over `applyMove`, and the platform properties **P1/P2** (replay
reproduces 200 episodes; tampered traces rejected).

**Known gaps / next:** board-level `applyMove` is blocked on lsc support for
`number[]` type aliases and `.slice()`; **L5** (`canMove ⇔ board changes`) follows
it. The platform **P1–P4** will be a hand-written Dafny fold theorem over an
abstract `step` (a generic `GameSpec<S,A>` is closures + generics, which the
LemmaScript tech preview doesn't yet support). The **equality** plug-in reuses
its existing 753-VC proofs.

## Run it

```sh
npm install
npm run dev        # play locally, records to IndexedDB, export NDJSON
npm run build      # typecheck + production bundle
npx tsx test/smoke.ts   # runtime checks of the merge laws + P1/P2
```

Controls: arrow keys · WASD · swipe.

## Server (Cloudflare)

Local-first works with no server. To aggregate a central corpus:

```sh
npx wrangler d1 create trace-solo                       # paste the id into worker/wrangler.toml
npx wrangler d1 execute trace-solo --remote --file=worker/schema.sql
npm run worker:deploy                                   # deploys the ingest Worker
# optional public dataset:
npx wrangler r2 bucket create trace-solo-corpus         # then uncomment the R2 binding
```

Then set `VITE_TRACE_ENDPOINT` to the Worker URL (see `.env.example`) and
rebuild. Endpoints: `POST /traces` (validate + store), `GET /stats`,
`GET /corpus.ndjson?limit=N`.

Identity is an anonymous per-browser id in localStorage — no account, no PII.
