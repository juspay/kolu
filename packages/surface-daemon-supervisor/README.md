# @kolu/surface-daemon-supervisor

The **supervisor half** of the surface-daemon spine: the mechanism a process uses
to spawn, watch, and recycle a surface daemon it does *not* run in — the mirror of
[`@kolu/surface-daemon`](../surface-daemon). It runs in the *client*, never the
daemon, so it is never a staleKey root. Beside the endpoint state machine it
carries the **convergence kit** — the policy-driven answer to "the running daemon
is not the one I shipped: detect it, decide, converge it." Zero `kolu-*`
dependencies.

```ts
import { createEndpoint, survivableSpawnDriver, restart } from "@kolu/surface-daemon-supervisor";

const endpoint = createEndpoint({ hostId, gatePath, socketPath, driver, connect, log, onStatus });
await restart(endpoint, { capture, drain, reattach }); // boot = live recycle
```

Part of the kolu monorepo — `"@kolu/surface-daemon-supervisor": "workspace:*"`.

## Docs

- How-to — [Recycle and upgrade a daemon](https://kolu.dev/surface/recycle-and-upgrade)
- Reference — [@kolu/surface-daemon-supervisor](https://kolu.dev/surface/ref-surface-supervisor) · [Daemon invariants](https://kolu.dev/surface/surface-daemon-invariants)
- Explanation — [The daemon spine](https://kolu.dev/surface/the-daemon-spine)
