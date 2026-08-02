# W6 — purge & polish (report)

Branch `effect`, five commits. Everything below was verified locally; no CI run
is part of this pass (W7 owns that).

| # | sha | subject |
|---|---|---|
| 1 | `913e6330f` | `chore:` purge zod and `@orpc/*` from every manifest, refresh the pnpm FOD hash |
| 2 | `0ede4b041` | `refactor(surface):` make the one-shot readers Stream-native, drop the dead collection face |
| 3 | `a2dacdfde` | `test(governance):` pin the `Effect.run*` edge allowlist (D10/#25) |
| 4 | `13fe432ec` | `docs:` retire the oRPC/zod vocabulary from the standing rules and skills |
| 5 | `32d71987e` | `chore:` regenerate the APM runtime dirs |

---

## 1. Dependency removals

**88 declared edges across 31 `package.json` files.** Every removal was preceded
by a repo-wide grep for the import, not by reading the manifest: `grep -rn 'from
"zod"' / 'from "@orpc/' / 'from "partysocket"' / '@hono/node-ws'` over `*.ts`,
`*.tsx`, `*.mts`, `*.js` outside `node_modules` returns **zero** hits in any
`packages/**` tree (the only survivors are prose mentions in comments and the
historical `website/src/content/blog/surface-framework.mdx`, which narrates the
pre-migration design and is correct as written).

| Package | Removed |
|---|---|
| `packages/client` | `@orpc/client`, `@orpc/contract`, `partysocket` |
| `packages/common` | `@orpc/contract`, `zod` |
| `packages/integrations/{anyagent,anyforge,claude-code,codex,git,github,grok,opencode}` | `zod` (8 packages) |
| `packages/kaval` | `@orpc/contract`, `@orpc/server`, `zod` |
| `packages/kolu-mcp` | `zod` |
| `packages/padi` | `@orpc/client`, `@orpc/contract`, `@orpc/experimental-publisher`, `@orpc/server`, `zod` |
| `packages/server` | `@hono/node-ws`, `@orpc/client`, `@orpc/contract`, `@orpc/experimental-pino`, `@orpc/experimental-publisher`, `@orpc/server`, `zod` |
| `packages/surface` | `@orpc/client`, `@orpc/contract`, `@orpc/server`, `@orpc/standard-server`, `@orpc/standard-server-peer`, `zod` |
| `packages/surface-app` | `partysocket`, `zod` |
| `packages/surface-app/example` | `@orpc/client`, `@orpc/experimental-publisher`, `@orpc/server`, `partysocket`, `zod` |
| `packages/surface-daemon` | `@orpc/server`, `zod` |
| `packages/surface-map` | `@orpc/client`, `@orpc/contract`, `@orpc/server`, `zod` |
| `packages/surface-mcp` | `zod` |
| `packages/surface-remote` | `@orpc/client`, `@orpc/contract`, `zod`, `@orpc/server` (dev) |
| `packages/surface/example` | `@hono/node-ws`, `@orpc/client`, `@orpc/contract`, `@orpc/experimental-publisher`, `@orpc/server`, `partysocket`, `zod` |
| `packages/surface/example/fleet-top/part-1` | `@orpc/{client,contract,server}`, `partysocket`, `zod` |
| `packages/surface/example/fleet-top/part-2` | `@orpc/{client,contract,server}`, `zod` |
| `packages/surface/example/fleet-top/part-3` | `@orpc/{client,contract,server}`, `partysocket`, `zod` |
| `packages/surface/example/mini-ci` | `@orpc/{client,contract,server}`, `zod` |
| `packages/surface/example/remote-process-monitor` | `@orpc/{client,contract,server}`, `partysocket`, `zod` |
| `packages/surface/example/snippets` | `@orpc/contract`, `zod` |
| `packages/terminal-vocab` | `zod` |
| `packages/transcript-core` | `zod` |
| `packages/xterm-kit` | `@orpc/client` |

**Not removed, and why:**

- **`hono` / `@hono/node-server` / `hono-pino` STAY — a decision, not a
  leftover.** Three installers in two packages are still Hono-typed
  (`installFreshStatic` + `installPwaManifest` in `@kolu/surface-app`,
  `mountArtifactSdk` in `@kolu/artifact-sdk`), plus kolu-server's own
  `iframePreviewRoute` and `routeErrors`. Porting them to
  `effect/unstable/http` is a real change with its own review surface
  (server-report §1.3b), and the repo's own convention — *prefer a maintained
  external library over hand-rolled code* — argues for keeping a maintained HTTP
  router for a bounded static/PWA/preview mount rather than reimplementing it.
  The RPC path itself is already fully Effect: the ws upgrade is hand-wired
  behind `acceptSurfaceSocket` + `serveSurfaceSocket`, so hono touches no
  RPC frame. `@hono/node-ws` went because *that* is the part that moved.
- **`effect` in `packages/xterm-kit`** stays in `dependencies` (test-only import
  today), per the brief.
- **zod survives in `pnpm-lock.yaml` transitively only** — `@modelcontextprotocol/sdk`
  and `@anthropic-ai/sdk` depend on it. Zero direct declarations remain. All
  `@orpc/*` and `partysocket` entries are gone from the lockfile entirely
  (−495 lines).

### Hash + closure discipline (standing rule 5)

- `just install` → lockfile −495 lines; `pnpm install --frozen-lockfile` passes
  ("Lockfile is up to date, resolution step is skipped").
- `nix/workspace.nix:178` refreshed per `recon/ci.md` §2 (fakeHash → read `got:`
  → paste):
  `sha256-Q+qcYIXlgEtoQ0APuQJzjSuRbj/bKs356njFBgr36y8=` →
  **`sha256-XVY0T5DKOr9CsuV1G3f5Z0KfzYD++faMvZhPqJIPsGk=`**
- Verified exactly as `ci::pnpm-hash-fresh` does: `nix build .#pnpmDeps --no-link`
  then `nix build --rebuild .#pnpmDeps --no-link` — both OK.
- **#23**: `nix eval .#padi.drvPath` and `nix eval .#kaval.drvPath` both evaluate
  (`…-padi.drv`, `…-kaval.drv`). No `stableLeaves` edit was needed, and could not
  have been: both lists (`default.nix:210`, `:284`) name only `@kolu/*` /
  `osfacts-client` workspace members, so removing an *external* edge cannot drop
  a leaf from either closure.
- `website/pnpm-lock.yaml` untouched → `website/default.nix:75` untouched.

---

## 2. Dead modules in `@kolu/surface`

### `collectionFace.ts` — DELETED

Zero importers, verified before the delete (the only hits were its own
definition, the `./collection-face` export entry, and a *retired-*tense mention
in `hostPorts.ts`). Its `Promise<AsyncIterable>` + `{signal}` shape described the
oRPC-era client; kolu-server was its last consumer and W2 already replaced it
with a local `TerminalsFace` over `Stream`. The `./collection-face` export entry
and the `ref-surface.mdx` row went with it.

### `firstFrame.ts` — CONVERTED to Stream-native (not deleted)

**Decision: convert, and the wrapper earns its keep.** Deletion was the wrong
call for three reasons:

1. `firstFrameOfCollectionItem` is not a thin wrapper — it is the #1681
   held-open-`get` guard (a bounded race of the item's first frame against a live
   `keys`-absence watch AND a deadline). Inlining that at consumers is exactly
   the hang the function exists to make unspellable.
2. The two plain readers are the one home of the snapshot-frame contract and its
   empty-stream policy, and `packages/server/src/firstFrameOneShotGuard.test.ts`
   is a committed governance test that *requires* one-shot reads to go through
   them rather than a hand-advanced `for await`.
3. Inlining `Stream.runHead` at the five consumers would have minted five new
   `Effect.run*` edges and five copies of the throw-on-empty policy — the exact
   opposite of what #25 is for.

What changed: all three exports now take a `Stream` **directly**, so the
`Stream.toAsyncIterable` bridge every consumer wrote disappears — six of them:
`padi-tui/read.ts`, `padi/dial.ts`, `padi/watch.ts` (which also loses a
hand-built feed-and-close pair), `kaval-tui/attach.ts`, `kaval-tui/history.test.ts`,
`server/padi/remotePadiSsh.test.ts` — plus `server/portForward/hostPorts.ts`'s
whole `iterateWithSignal` + `AbortController` apparatus.

Two faces, and the split is the interruption story:

- `firstFrameOrUndefined` / `firstFrameOrThrow` resolve a **Promise** and take an
  optional `signal`. Their consumers are the plain-async leaves locked decision 1
  preserves, so this is their sanctioned `Effect.runPromise` edge held once
  instead of once per CLI; the `signal` is the D10/#18 seam (padi's `runWait`
  scaffold hands its abort straight to the run).
- `firstFrameOfCollectionItem` returns an **Effect**. Both consumers compose it
  inside a larger program, and a Promise edge mid-program would detach the read
  from the interruption that bounds it.

`onNullSource` disappeared with the AsyncIterable shape (a `Stream` is never
null) — one fewer failure mode.

**Bonus, in the same commit: a knowing duplicate is gone.**
`surface-mcp/src/server.ts`'s `readCollectionItemSnapshot` had re-derived the
whole bounded race, carrying a note saying it belonged back in the framework and
lived there "only because W2 forbids editing `@kolu/surface`". W6 is that
reconcile pass: ~90 lines became a mapping from `CollectionItemFrame` to MCP's
`Snapshot`/`ReadMiss`, still entirely in-fiber so `resources/read` under the
request's abort signal still interrupts every subscription the read opened.

`firstFrame.test.ts` was rewritten on `Stream` (the null-source test is gone with
the parameter; a new test pins that a *failing* item stream surfaces its failure
instead of losing the race to the deadline, and three new tests cover the two
plain readers including the abort path).

### Docs moved in the same commit (`.claude/rules/surface-reference.md`)

`ref-surface.mdx` lost the `CollectionFace` row and gained a
`@kolu/surface/first-frame` section (all four exports, signatures, and the
Promise-vs-Effect rationale). `test-a-surface.mdx` no longer calls
`firstFrameOrThrow` "the same policy for an async-iterable source".

### `anomaly.ts` docstring

The `unspeakable-protocol` cause described ONE trigger. It has had two since the
silence trigger landed (`UnspeakableEvidence`): an explicit first-frame decode
failure, **or** a peer that accepts the connection and stays mute past the dial's
silence deadline — which is what the previous release's oRPC `ServerPeer` does
while waiting for a client hello it will never recognise. Corrected, with the
corroboration requirement (our gate file, verified pid) kept.

---

## 3. `Effect.run*` run-edge allowlist (#25)

`packages/tests/governance/runEdges.ts` + `runEdges.test.ts`, called from
`governance/check.ts` so it runs in the **e2e-governance lane**
(`pnpm test:governance`) — a claim about the whole repo belongs where the
scenario inventory and coverage ledger already live, not in one package's unit
suite. Its own scanner has a node:test gate beside the other governance tests.

**Inventory: 26 sites in 20 files. Zero non-edges found; nothing needed fixing.**

| Path | Sites | Kind of edge |
|---|---|---|
| `packages/client/src/rpc/rootProcedures.ts` | 1 | root-procedure Promise face (Solid leaf awaits it) |
| `packages/padi/src/daemonBoot/daemonMain.ts` | 1 | padi daemon process edge |
| `packages/padi/src/terminalEndpoint/local.ts` | 1 | tap layer's AbortSignal→interruption seam |
| `packages/server/src/index.ts` | 1 | reactor poll dep (`() => Promise<T>`) |
| `packages/server/src/portForward/hostPorts.ts` | 1 | reactor poll cell — one edge for the whole reading |
| `packages/surface-app/src/server.ts` | 2 | per-connection serve scope: build on open, close on `ws` close |
| `packages/surface-map/src/server.ts` | 1 | `decodeCanonicalWireKeyUnsafe`, the documented sync-decode |
| `packages/surface-mcp/src/pusher.ts` | 1 | one fiber per subscribed MCP URI |
| `packages/surface-mcp/src/server.ts` | 1 | `resources/read`, with the request's AbortSignal |
| `packages/surface/src/client.ts` | 1 | the framework's one unary-call Promise edge |
| `packages/surface/src/firstFrame.ts` | 1 | the one-shot readers' Promise edge (new, §2) |
| `packages/surface/src/links/stdio.ts` | 1 | stdio socket construction |
| `packages/surface/src/links/websocket.ts` | 1 | browser socket construction |
| `packages/surface/src/links/wire.ts` | 2 | link scope: build at open, close at `dispose()` |
| `packages/surface/src/mirrorRemoteSurface.ts` | 1 | mirror's `done` Promise + AbortSignal contract |
| `packages/surface/src/peer-server.ts` | 2 | stdio serve scope: build, then close |
| `packages/surface/src/project.ts` | 3 | projection→reactor bridge: fork + two disposers |
| `packages/surface/src/runStream.ts` | 1 | THE Solid bridge |
| `packages/surface/src/solid/liveSignal.ts` | 1 | framework-free Promise-shaped heartbeat probe |
| `packages/surface/src/unix-socket.ts` | 2 | per-peer serve scope + release on `close`/`error` |

Design notes worth keeping:

- The assertion is **path AND count**, so a second run added to an already-listed
  file fails, and a row whose call site went away fails too (the list cannot rot).
- Scope is production source under a package `src` tree. Tests
  (`*.test.ts` / `*.testlib.ts` / `*.test-d.ts`) are out — a test IS a process
  edge — and so is every `example` tree, each of which has its own `main()`.
  `packages/integrations/*/src` IS scanned (grouping directories are walked one
  level down); it currently has zero sites.
- The scanner blanks comments and string literals with a character scan rather
  than a regex, because both `//` inside a string and a quote inside a comment
  occur in this repo and each defeats the regex version. Every one of those ways
  to lie is a test.
- A bare named import (`import { runPromise } from "effect/Effect"`) is the one
  dodge a namespaced regex cannot see, so it is refused outright with a message
  pointing at the namespaced form.
- Negative-tested end to end: adding one `Effect.runSync(...)` to
  `packages/surface/src/clockNow.ts` made `pnpm test:governance` exit 1 naming
  the file; reverted.

---

## 4. Stale rule / skill / doc text

Everything under `.claude/`, `.agents/`, `.codex/`, `.opencode/` is generated
(`.claude/rules/apm-sources.md`), so the edits landed in the `.apm/` and
`agents/.apm/` sources and were regenerated with `just ai::apm`.

| Source | Was | Now |
|---|---|---|
| `.apm/instructions/surface.instructions.md` | "the oRPC contract shape" | the Effect RPC contract — the `defineSurface` spec, the tags an `RpcGroup` mints, a member's payload/success/error `Schema` |
| `.apm/instructions/surface-reference.instructions.md` | same phrase | same replacement |
| `.apm/instructions/streaming.instructions.md` | **fully rewritten** — it taught `ClientRetryPlugin`, `STREAM_RETRY` as an oRPC client *context*, `RPCLink<Context>`, `ContractRouterClient<…>` | the per-subscription retry fence (`fenceStream` + `Stream.retry`) and *why* it is per subscription; the positive `shouldRetryStreamError` test; no `signal`. Rule 3 (parameterize a plugin context) described a thing that no longer exists — replaced by the hazard the fence really carries: a member's input is CAPTURED and replayed |
| `.apm/instructions/solidjs.instructions.md` | "builds the oRPC link", `system.live` | "the wire link", `system/live` (slash-joined tag) |
| `.apm/instructions/architecture.instructions.md` | "single websocket + oRPC" | "single websocket + Effect RPC over ndjson" |
| `agents/.apm/skills/surface/SKILL.md` | "derives the oRPC contract"; "oRPC `RPCHandler` (`@orpc/server/ws`, `.upgrade(ws)`) for browsers" | "derives the Effect RPC group"; `acceptSurfaceSocket` + `serveSurfaceSocket` |
| `agents/.apm/skills/be/SKILL.md` | FOD hash in `nix/modules/typescript.nix` | `nix/workspace.nix` (that path never existed) |
| `.agency/hickey.md` | "SolidJS + oRPC architecture" | "SolidJS + Effect architecture" |
| `.agency/lowy.md` | live state = "oRPC async iterables today"; seam at `packages/client/src/rpc/createSubscription.ts` | Effect `Stream`s over Effect RPC; seam at `packages/surface/src/solid/createSubscription.ts` (the graduation moved it) |
| `website/src/content/docs/architecture.mdx` | oRPC + Zod on the wire; "same oRPC framing" over the unix socket; gate "before oRPC"; `common` = "the oRPC contract" | Effect RPC over ndjson with Effect Schema; "same ndjson framing"; gate "before RPC dispatch"; `common` = "the shared surface contract" |

**Checked and deliberately left alone:** the `.agency/effect-migration/recon/*`
and `w2/*` dossiers (historical records of the pre-migration state — correct as
written); `website/src/content/blog/surface-framework.mdx` (a narrative of the
oRPC-era design); the past-tense "the oRPC-era …" / "replaces the oRPC …" notes
throughout the surface Reference pages, which are the migration record readers
need. `.apm/skills/pierre/SKILL.md` no longer names the stale nix path (recon's
note about it is itself out of date).

**Open, and NOT fixable from this repo:** `.claude/skills/nix-typescript/SKILL.md`
and `.agents/skills/nix-typescript/SKILL.md` still say the `fetchPnpmDeps` hash
lives in `nix/modules/typescript.nix`. That skill is vendored from
**`juspay/skills`** (`apm.yml` → `juspay/skills/skills/nix-typescript`); patching
the generated copy would be silently reverted by the next `just ai::apm`. **It
needs an upstream PR to `juspay/skills`** changing the path to "wherever the
repo's `fetchPnpmDeps` call lives (kolu: `nix/workspace.nix`)". The `/be` skill's
copy of the same claim — which is in-repo — is fixed, so the most-loaded path no
longer misdirects.

One regeneration caveat: `just ai::apm` ran on a newer apm (0.27.0 vs the locked
0.26.0) and wanted unrelated changes in the same pass — a re-added Stop hook in
`.claude/settings.json`, deletion of the `.agents/skills/odu*` trees, a rewritten
`apm.lock.yaml`. All reverted; only rule/skill/`AGENTS.md` text is in commit 5.
That drift belongs to whoever bumps apm.

---

## 5. Gate battery — all green

| Gate | Command | Result |
|---|---|---|
| Format | `just fmt` | clean (no reformats left uncommitted) |
| Lint | `biome lint --error-on-warnings .` | 1785 files checked, 0 warnings |
| Typecheck | `nix develop -c pnpm typecheck` | exit 0, all 40+ projects |
| Unit | `nix develop -c just --no-deps test-unit` | exit 0 |
| Daemon | `nix develop -c just --no-deps test-daemon` | exit 0 |
| Governance | `just --no-deps test-e2e-governance` | exit 0 — "58 features, 500 declarations, 514 executions, 606 immutable revisions, **26 allowlisted Effect.run\* edges in 20 files**" |
| Nix FOD | `nix build .#pnpmDeps` + `--rebuild` | both OK |
| Nix closures (#23) | `nix eval .#padi.drvPath`, `.#kaval.drvPath` | both evaluate |

---

## 6. Hand-off to W7

1. **The drishti pair PR is due** (`.claude/rules/surface.md`): this pass changed
   `@kolu/surface`'s public API twice — `./collection-face` removed from
   `exports`, and all three `first-frame` signatures changed (Stream-in;
   `firstFrameOfCollectionItem` now Effect-out with one fewer parameter). Add
   both to the API-break list the PR body carries.
2. **ODU-IMPACT verdict** still to be graded against odu's pinned tree for the
   same two changes.
3. **Upstream**: the `nix-typescript` skill's stale `nix/modules/typescript.nix`
   path needs a `juspay/skills` PR (§4).
4. **Deferred, deliberately**: the hono → `effect/unstable/http` port of the
   three static/PWA/artifact installers (§1). Not a leftover — a scoped decision
   with a stated reason.
