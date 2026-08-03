# @kolu/surface-daemon-supervisor

The **supervisor half** of the surface-daemon spine: the mechanism a process uses
to spawn, watch, and recycle a surface daemon it does *not* run in — the mirror of
[`@kolu/surface-daemon`](../surface-daemon). It runs in the *client*, never the
daemon, so it is never a staleKey root. Beside the endpoint state machine it
carries the **convergence kit** — the policy-driven answer to "the running daemon
is not the one I shipped: detect it, decide, converge it." Depends only on
`@kolu/surface-daemon` (the daemon-half twin), `@kolu/surface` for the frozen
control-core transport, and `ts-pattern` for exhaustive policy dispatch; no app
package.

```ts
import {
  converge,
  createEndpoint,
  daemonBuild,
  probeDaemonIdentity,
  probeDaemonIdentityFrom,
  recycle,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";

const endpoint = createEndpoint({
  hostId: "local",
  home, // DaemonHomePaths — gate + socket from the same spine as the daemon
  policy: {
    capability: "not-drainable",
    baked: { contractVersion: "1.0", build: daemonBuild(staleKey) },
    onContractSkew: { kind: "recycle" },
    onBuildMismatch: { kind: "nudge-human" },
  },
  probe: probeDaemonIdentity({ capability: "not-drainable" }),
  driver: survivableSpawnDriver({ binPath, args: [], env }),
  connect: (socketPath) => connectDaemon(socketPath),
  log,
  onStatus,
});

// The only boot verb — policy is fixed on the endpoint. Every verb below is an
// Effect: `yield*` it inside an `Effect.gen`, and run that ONCE at your process
// edge. `await`ing one compiles and dispatches nothing.
yield* converge(endpoint);

// The only replace verb — all steps required (no silent snapshot skip).
yield* recycle(endpoint, { capture, drain, reattach });

// An ssh connector already owns the combined client and process oracle.
// This form never returns null: the transport has already been dialed.
const probe = yield* probeDaemonIdentityFrom({
  client: combinedClient,
  dispose: teardown,
  capability: "drainable",
  drainCeilingMs: 6000,
  awaitExit: processExitOracle, // process exit only; link loss is not exit
});
```

Part of the kolu monorepo — `"@kolu/surface-daemon-supervisor": "workspace:*"`.

## Docs

- How-to — [Recycle and upgrade a daemon](https://kolu.dev/surface/recycle-and-upgrade)
- Reference — [@kolu/surface-daemon-supervisor](https://kolu.dev/surface/ref-surface-supervisor) · [Daemon invariants](https://kolu.dev/surface/surface-daemon-invariants)
- Explanation — [The daemon spine](https://kolu.dev/surface/the-daemon-spine)
