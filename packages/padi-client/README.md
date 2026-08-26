# @kolu/padi-client

Everything you need to **talk to** a padi, and nothing padi needs to **be** one.

[`@kolu/padi`](../padi) is the per-host workspace daemon: PTYs, sessions, the
attention engine, kaval. This package is the half of it a *client* holds — the
`padiSurface` contract, the vocabulary that contract speaks, the dial that
reaches a running padi over its unix socket, and the terminal watch kit — carved
out so a consumer can hydrate it **without installing the daemon**.

```ts
import { connectPadi } from "@kolu/padi-client/dial";
import { Effect, Stream } from "effect";

// The socket is GIVEN, not guessed — see "Finding the socket" below.
const connection = await Effect.runPromise(connectPadi(process.env.PADI_SOCKET!));
const ids = await Effect.runPromise(
  Stream.runHead(connection.client.padi.surface.terminals.keys(undefined)),
);
```

Part of the kolu monorepo — `"@kolu/padi-client": "workspace:*"`.

## Why it is its own package

Hydration is **per-package**. A repo that consumes kolu from a content-addressed
pin copies a package *directory* and installs that directory's declared
dependencies from its own manifest — so what a consumer pays is the transitive
closure of the **manifests**, not the set of modules its own code happens to
reach.

That is what made `@kolu/padi` unusable for a server that only wanted to speak
the surface. padi's manifest names `kaval`, which names `node-pty` (a native
binding) and `@xterm/headless`; so "give me a spec object and a dial function"
arrived as a PTY host with a compile step.

|  | `@kolu/padi` | `@kolu/padi-client` |
| --- | --- | --- |
| workspace packages | 34 | 21 |
| npm packages | 38 | 12 |
| native modules | `node-pty`, `@parcel/watcher` | `@parcel/watcher` |

The thirteen workspace packages it drops are the daemon and TUI tier: `kaval`,
`terminal-snapshot`, `terminal-themes`, `@kolu/xterm-kit`, `@kolu/serve-dir`,
`@kolu/surface-remote`, `@kolu/surface-map` and the rest — and with them
`node-pty`, the whole `@xterm/*` suite, `@resvg/resvg-wasm`, `pino`, `conf`,
`marked`. The exact set is **pinned by a test**, not asserted here:
[`src/hydrate.closure.test.ts`](src/hydrate.closure.test.ts) walks the runtime
import closure *and* the declared manifest closure, and fails if either grows.
That test also records the one residual — `@parcel/watcher` and the Claude Agent
SDK ride in through two integration packages whose `/schemas` entry is a pure
leaf but shares a manifest with its machinery — and what fixing it would take.

`@kolu/padi` **depends on this package**; the arrow never points back. There is
one spec, in one place, and the daemon serves the same object its clients dial.

## Finding the socket

**Be told it; don't derive it.** `$PADI_SOCKET` is stamped into every PTY a padi
spawns, so a program running in a kolu terminal already has the answer, and an
explicit path is always accepted.

`@kolu/padi-client/rendezvous` also ships the path *formula* —
`padiSocketPath(stateRoot)` → `$XDG_RUNTIME_DIR/padi-<digest>/padi.sock` — and it
is the right answer on the **construction** side, where the daemon decides where
to bind. From a client it is a guess about someone else's environment, and padi's
own discovery is explicit that the guess loses: `residentPadiSocket` takes the
resident's `state-root` manifest over "any caller's own-env guess (never a bare
digest-path recompute, which is exactly what reproduced the bug)". The bug was
[#1713](https://github.com/juspay/kolu/issues/1713) — a `nix run` outside a login
session computed a different runtime drawer than the live daemon and hung for
thirty seconds against a padi that was up the whole time.

The read-back that corrects a guess — manifest discovery, gated on a live pid
holder — needs kaval's owner-only-dir and socket-inode checks, so it lives in
`@kolu/padi/stateRoot` and is out of reach here. Recompute only when the client
and the daemon share a launch context.

## The second pin — `osfacts-client` — is no longer yours to graft

**It used to be.** `@kolu/surface-daemon-supervisor` states its
`ReadSocketHolders` seam in the vocabulary of
[`juspay/osfacts`](https://github.com/juspay/osfacts)'s TypeScript client — that
is deliberate and argued at the seam (the success half and the three failure
tags have one provenance, so a local copy would be *"a second name for facts it
does not produce"*). `osfacts-client` is grafted into this tree from an npins pin
and gitignored, so it is **absent from the archive you vendor**; and `./dial`
reached the supervisor's BARREL, which compiles `endpoint.ts`, which names that
vocabulary. Every consumer of `connectPadi` therefore had to graft a second pin,
guard its revision, and carry shims for a daemon runtime none of its own source
called.

**The leaf entries closed it.** Each daemon package now publishes the narrow door
the follow-up note here used to describe:

| leaf | what it carries | what it no longer compiles |
| --- | --- | --- |
| `@kolu/surface-daemon-supervisor/dial` | `dialSocket`, `DaemonContractSkewError`, `isContractSkewError`, `DaemonConnection` | `endpoint.ts` — the drivers, the convergence probe, and `osfacts-client` |
| `@kolu/surface-daemon/home` | `resolveDaemonHome` + the home path algebra | `daemonMain`, `daemonProcessMain`, the process-signal tier |
| `@kolu/surface-daemon/lifetime` | `DaemonLifetime`, `DaemonLifetimeInfo`, `lifetimeInfo` | the same |

`connectPadi` reaches all three, and `hydrate.closure.test.ts` now asserts that
**no bare daemon barrel** is in this package's import closure — the list that
used to record those two barrels as a KNOWN cost is empty, and empty is the
assertion. `osfacts-client` left `IMPORTED_ALLOWED` with them.

It remains in `DECLARED_ALLOWED`: hydration is per-MANIFEST, so a consumer that
copies `@kolu/surface-daemon-supervisor`'s directory still copies a manifest that
names it. What changed is the part that cost real work — nothing a consumer's
`tsc` compiles resolves it any more, so there is no pin to add, no revision to
keep in step with a binary, and no `TS2307` to chase.

## The export map

| entry | what it is | browser-safe |
| --- | --- | --- |
| `./surface` | `padiSurface` — the Effect Schema contract, the per-member forwarding policy (`value` = hold-open vs `delta` = fail-through), the frozen control-core sibling, and the whole terminal vocabulary it speaks (records, errors, chrome, policy and transcript-export schemas), re-exported from this one entry | ✅ |
| `./attention` | the ATTENTION FOLD over two of that contract's members — the `urgency` cell's class lists and the `activity` stream's live set, folded into `TerminalAttention { klass, live }` and its per-host / per-scope siblings (`frameByClass`, `frameClassOf`, `hostActiveIds`, `scopeAttention`). Pure: what padi's partition MEANS, shipped with the feeds so a consumer reads them rather than reinventing the reading | ✅ |
| `./attach` | the `terminalAttach` CONSUMER CONTRACT — `snapshotAnswersGrid` (a snapshot is only valid at the grid it was asked for) and `isSnapshotFrame`, plus the four rules the schemas do not state: what stales a grid (including another client attaching at its own size, last-attach-wins on a shared pty), that a clean end is not an exit, and that silence needs a deadline. The frames themselves are `TerminalAttachFrame`, on `./surface` | ✅ |
| `./dial` | `connectPadi` — dial a socket, handshake the frozen control core, gate the surface version (`assertPadiSurfaceCompatible`), and hand back both typed faces over one dispatch (`padiClientOver`, `scopePadiSurface`). `dialPadiHello` is the ungated half, for a caller that wants to read `hello` and judge for itself | ❌ `node:net` |
| `./rendezvous` | the path *formula* — state-root → digest → `$XDG_RUNTIME_DIR/padi-<digest>/padi.sock`, plus `productionPadiStateRoot` / `resolvePadiStateRoot` / `padiDigest` / `padiGatePath`. Pure: no probing, no kaval. Construction-side; see **Finding the socket** before dialing with it | ❌ `node:` paths |
| `./watch` | the terminal watch kit — `watchTerminals`, the one `awaitTerminalCondition` engine and its two named waits (`awaitAgentState`, `awaitOutputSettled`), and `awaitWatchEvents` | ❌ mirror |
| `./watchScope` | which terminals a subscription reports: `watchScopeOf` (the only constructor, where every never-match refusal lives), `scopeAdmits` (the only reader) | ✅ |
| `./terminalVocab` | the pure folds over a terminal record — `activeAgent`, `isWaitState`, `WAIT_STATES` | ✅ |
| `./upload` | what may be dropped onto a terminal and how big it may be — `MAX_UPLOAD_BYTES`, the extension allowlist, `rejectionFor`. The gate a sender applies before encoding is the gate padi applies before writing, so the two cannot drift | ✅ |

## What stayed in `@kolu/padi`

**The line is HYDRATION COST, not client-vs-daemon.** Plenty of client-side code
stayed behind, and saying "it wasn't contract-shaped" would not classify it: a
module stays with `@kolu/padi` when moving it would put a new npm package in
every consumer's manifest, or when it genuinely needs the daemon tier. That is
the criterion the closure test above enforces, so it is the one to apply to the
next module that wants to move.

Needs the daemon tier:

- **`@kolu/padi/remote-dial`** — reaching a padi on another host over ssh.
  `PADI_REMOTE_DIAL` names a nix package and a binary, and `dialAgentOnce` ships
  that closure to the host: this is the daemon, not the contract.
- **`@kolu/padi/stateRoot`** — discovery of the padis actually running on this
  box, and the kaval placement beside each. Reads the filesystem, asks kaval.
- **`@kolu/padi/endpoint`** — needs `terminal-snapshot`.

Would cost every consumer a new npm package, for code no consumer has asked for
yet:

- **`@kolu/padi/read`** and **`@kolu/padi/render`** — the CLI's client-side read
  and text formatting. Pure client code by every other measure (they import this
  package and nothing daemon-tier), but `render` pulls `columnify`, and a
  formatter is not what the out-of-repo consumer came for. Move them the day one
  asks — the closure test will say exactly what that costs.
- **`@kolu/padi/containingTerminal`** — "am I running inside a kolu terminal",
  which is a question only something inside one asks. Free to move (it reads one
  env name from `kolu-pty`, already in the closure); it has simply never been
  wanted from outside, and an entry nobody asked for is an entry to un-publish
  later.
- **`@kolu/padi/watchSpec`** — the argv grammar for `kolu watch`'s knobs: a CLI
  concern, not a wire one.

## Docs

- The daemon, whole — [`packages/padi/README.md`](../padi/README.md)
- Plan of record — [Atlas: padi](https://kolu.dev/atlas/padi)
