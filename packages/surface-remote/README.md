# @kolu/surface-remote

Run a typed [`@kolu/surface`](../surface) agent on a **remote machine over ssh**,
and mirror its state inward as if it were local. The package handles provisioning
(ship the agent closure out of your own store, or realise it on the target), the
long-lived ssh subprocess (ref-counting, reconnect, backoff, and
`session.nudge()` to fast-forward an already-scheduled retry when a laptop
wakes), and the pump that folds the remote agent's frames into a local re-serve
— so a parent server, or a browser behind it, reads the surface through the
exact `useCell` / `useCollection` shape it always uses.

```ts
import { makeSession, sshConnector, pumpRemoteSurface } from "@kolu/surface-remote";

const session = makeSession({
  connectOnce: sshConnector({ surface, host, binary, resolveDrvPath, localEnv }),
});
pumpRemoteSurface({ source: surface, session, makeSink: ({ seq }) => sink });
```

Worked end-to-end in [`packages/surface/example/remote-process-monitor`](../surface/example/remote-process-monitor).
Part of the kolu monorepo — `"@kolu/surface-remote": "workspace:*"`.

## Docs

- Tutorial — [Across the hosts](https://kolu.dev/surface/across-the-hosts)
- How-to — [Mirror a surface over ssh](https://kolu.dev/surface/mirror-over-ssh) · [Operate a fleet safely](https://kolu.dev/surface/operate-a-fleet-safely)
- Reference — [@kolu/surface-remote](https://kolu.dev/surface/ref-surface-remote)
- Explanation — [The server half](https://kolu.dev/surface/the-server-half)
