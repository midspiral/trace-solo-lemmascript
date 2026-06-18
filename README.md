# trace-solo

[![LemmaScript verified](https://img.shields.io/github/actions/workflow/status/midspiral/trace-solo-lemmascript/lemmascript.yml?branch=main&label=LemmaScript%20verified)](https://github.com/midspiral/trace-solo-lemmascript/actions/workflows/lemmascript.yml)


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

Two things make this more than a verification checkbox:

- **One proof, every game.** `step` and `legalActions` are *opaque parameters* in
  the proof, not 2048-specific. So a single theorem covers every game that will
  ever plug in — the recorder's guarantee is established once, for the whole
  platform, not re-proved per game.
- **The recorder and the validator provably agree.** It's proven *both*
  directions: a validated trace is necessarily faithful and legal (sound, and the
  teeth — tampering breaks the chain), *and* any genuine play necessarily
  validates (complete) — including the plays the recorder itself emits (record the
  state, then step). So `record → faithful → reproducible` is a closed loop, not a
  hope: what we collect is exactly what the validator accepts.

That makes "verified training data" a statement about the system being
internally coherent — resting on one small, explicitly named trust boundary
(`decodeState` inverts `encodeState`; see *Verification status*), not on faith.

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

This is a **work in progress**, verified with LemmaScript
(`../LemmaScript/tools/check.sh dafny`, files in `LemmaScript-files.txt`):
annotated TypeScript is the source of truth and `lsc` generates the Dafny proofs.
Every `.dfy` is additions-only over its generated `.dfy.gen` (`lsc check` enforces
this), with **0 `assume`s and 0 axioms**.

**The recorder — the platform's promise** (`src/platform/replay_core.ts`, 14 VCs,
0 errors). Proven **game-agnostically**: the game's `step` and `legalActions` are
opaque higher-order parameters, so the theorems hold for *any* `GameSpec`.

- **P1 reproducibility** — `statesFrom(step, s, actions)` reconstructs the exact
  trajectory: `\result[0] === s` and `\result[i+1] === step(\result[i], actions[i])`.
  An episode is reconstructable from (start, action-log) alone.
- **P2 validity + tamper rejection** — `validateFrom` returns true only if the
  recorded states *chain*: `befores[i+1] === step(befores[i], actions[i])`. A forged
  `before[i]` breaks the chain, so it is rejected. (This is the teeth.) It is also
  *total* — a length-mismatched episode is rejected, not assumed away.
- **P4 legality** — validation implies `legal(befores[i], actions[i])` at every ply.
- **Completeness** — `genuinePlayValidates`: a real play (states that chain, all
  actions legal) *always* validates. So the checker is sound **and** complete — it
  rejects exactly the tampered/illegal traces and never a faithful one.
- **Producer guarantee (loop closure)** — `recordedPlayValidates`: an episode the
  recorder *emits* (record the current state, then step — `recordBefores`) with
  legal actions *always* validates. So what the recorder produces is exactly what
  the validator accepts: record → genuine → validates → reproducible.
- **P3 append-only** is enforced at the database by `PRIMARY KEY (game_id, ply)`,
  not in code.

The verified core is **on the live path**: production `validateEpisode`
(`src/platform/replay.ts`) and the ingest Worker delegate the accept/reject
decision to `validateFrom`. Because JS `===` on objects is reference equality
while the proof is over structural equality, the core is instantiated over the
canonical-JSON *string* encoding of states (where `===` is structural). *Trust
boundary:* `GameSpec.decodeState` faithfully inverts `encodeState`, and
`canonicalJSON` is a stable structural encoding — everything downstream is verified.

**The 2048 engine** (`src/games/g2048/engine.ts`, 31 VCs, 0 errors). The merge core
`slideLine` carries laws **L1–L4** — length, **L2 conservation** (`sum` preserved),
**L3 no-double-merge** (`2·nonzeros(result) ≥ nonzeros(line)` and `≤`, so
`[4,4,4,4] → [8,8,0,0]` is forced), and **L4 packing** (tiles form a prefix); its
centerpiece is the quantifier-free merge invariant `2·|out| ≥ tilesConsumed`.

**Board-level conservation (L2):** `boardSum(applyMove(b,dir)) === boardSum(b)` — a
move never creates or destroys tile mass — is now **proven for all four
directions**, not just tested. The per-line `slideLine` conservation is lifted to
the board by sum-decomposition: each row (or strided column) is replaced by its
sum-preserving slide, and `applyMove` preserves the total across the flattened
board. `applyMove` also carries **L1** length preservation; `getRow`/`getCol`/`reversed`
expose their sums and `boardSum === sumTo` ties the executable sum to the spec sum.

**Next.** **L5** (`canMove ⇔ board changes`) — largely definitional. The **equality**
plug-in reuses its existing decision-procedure proofs.

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
