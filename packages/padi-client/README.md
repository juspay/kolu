# @kolu/padi-client

Everything you need to **talk to** a padi, and nothing padi needs to **be** one.

[`@kolu/padi`](../padi) is the per-host workspace daemon: PTYs, sessions, the
attention engine, kaval. This package is the half of it a *client* holds — the
`padiSurface` contract, the vocabulary that contract speaks, the dial that
reaches a running padi over its unix socket, and the terminal watch kit — carved
out so a consumer can hydrate it **without installing the daemon**.

```ts
import { connectPadi } from "@kolu/padi-client/dial";
import { padiSocketPath, productionPadiStateRoot } from "@kolu/padi-client/rendezvous";
import { Effect, Stream } from "effect";

const connection = await Effect.runPromise(
  connectPadi(padiSocketPath(productionPadiStateRoot())),
);
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
| workspace packages | 34 | 22 |
| npm packages | 39 | 13 |
| native modules | `node-pty`, `@parcel/watcher` | `@parcel/watcher` |

The twelve workspace packages it drops are the daemon and TUI tier: `kaval`,
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

## The export map

| entry | what it is | browser-safe |
| --- | --- | --- |
| `./surface` | `padiSurface` — the Effect Schema contract, the per-member forwarding policy (`value` = hold-open vs `delta` = fail-through), the frozen control-core sibling, and the whole terminal vocabulary it speaks (records, errors, chrome and policy schemas), re-exported from this one entry | ✅ |
| `./dial` | `connectPadi` + `dialPadiHello` — dial a socket, handshake the frozen control core, gate the surface version, and hand back both typed faces over one dispatch (`padiClientOver`, `scopePadiSurface`) | ❌ `node:net` |
| `./rendezvous` | the pure path algebra — state-root → digest → `$XDG_RUNTIME_DIR/padi-<digest>/padi.sock`. No probing, no kaval; the half that reads the live fleet is `@kolu/padi/stateRoot` | ❌ `node:` paths |
| `./watch` | the terminal watch kit — `watchTerminals`, the one `awaitTerminalCondition` engine and its two named waits (`awaitAgentState`, `awaitOutputSettled`), and `awaitWatchEvents` | ❌ mirror |
| `./watchScope` | which terminals a subscription reports: `watchScopeOf` (the only constructor, where every never-match refusal lives), `scopeAdmits` (the only reader) | ✅ |
| `./terminalVocab` | the pure folds over a terminal record — `activeAgent`, the wait-state vocabulary | ✅ |
| `./transcript` | the transcript-export wire schemas | ✅ |
| `./errText` | what an unknown thrown thing says, guarded — a zero-import leaf | ✅ |

## What stayed in `@kolu/padi`

Not everything a client *can* do is contract-shaped. These need the daemon tier,
so they live with the daemon:

- **`@kolu/padi/remote-dial`** — reaching a padi on another host over ssh.
  `PADI_REMOTE_DIAL` names a nix package and a binary, and `dialAgentOnce` ships
  that closure to the host: this is the daemon, not the contract.
- **`@kolu/padi/stateRoot`** — discovery of the padis actually running on this
  box, and the kaval placement beside each. Reads the filesystem, asks kaval.
- **`@kolu/padi/containingTerminal`** — "am I running inside a kolu terminal",
  which is a question only something inside one asks.
- **`@kolu/padi/watchSpec`** — the argv grammar for `kolu watch`'s knobs.

## Docs

- The daemon, whole — [`packages/padi/README.md`](../padi/README.md)
- Plan of record — [Atlas: padi](https://kolu.dev/atlas/padi)
