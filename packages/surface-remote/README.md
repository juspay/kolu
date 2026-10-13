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

A binder that publishes its builds gets them onto a host with **no trust on
the host at all**. `provisionAgent` tries, in order: the warm check (the host
already holds it); the **closure index** — `readPublishedClosure` reads
`<rev>/<system>/<attr>.json` for the binder's own revision off the index its
baked source declares, `closureRoute` picks the form the host's Nix can take,
and `pullClosure` has the host run `nix copy --from <cache>` itself and root
it; then the sender's own steps (rewrite, prefetch, ship, build). An
unpublished revision just moves on to the next step, narrated. A
content-addressed path needs no trust setting, but only within the Nix line
that wrote it — publishers rewrite with Nix 2.34, which hosts on 2.17–2.34
verify; 2.35+ and macOS (a rewrite breaks Mach-O signatures) get the signed
path, which needs the host to trust the login or the key. Publishing is
`.github/actions/publish-closure` ([Publish your daemon content-addressed](https://kolu.dev/surface/publish-content-addressed)).

By default a dial's ssh gives up on a peer that has not answered a probe for
~30s. That is the right answer while someone is watching a host; an unattended
dial states its own tolerance instead — an `SshKeepalive`,
`sshConnector({ …, keepalive: sshKeepalive(30, 10) })`, reaching every ssh the
dial spawns including the one Nix forks for a remote store. `sshKeepalive` is the
only way to make one: both arguments must be positive whole numbers and
`intervalS × countMax` must be within `MAX_SSH_KEEPALIVE_TOLERANCE_S` (one hour),
so an invalid policy throws at the literal you wrote rather than at some later
dial — and never gets clamped to one you did not ask for.

Read it narrowly: it bounds how long a **dead or half-open ssh transport** takes
to be noticed and exited — *not* how long a lane survives an interruption. It is
the loosest of four independent bounds on link silence and moves none of the
others. The [reference page](https://kolu.dev/surface/ref-surface-remote) lists
all four, with their values, and which of them are knobs at all.

Worked end-to-end in [`packages/surface/example/remote-process-monitor`](../surface/example/remote-process-monitor).
Part of the kolu monorepo — `"@kolu/surface-remote": "workspace:*"`.

## Docs

- Tutorial — [Across the hosts](https://kolu.dev/surface/across-the-hosts)
- How-to — [Mirror a surface over ssh](https://kolu.dev/surface/mirror-over-ssh) · [Operate a fleet safely](https://kolu.dev/surface/operate-a-fleet-safely)
- Reference — [@kolu/surface-remote](https://kolu.dev/surface/ref-surface-remote)
- Explanation — [The server half](https://kolu.dev/surface/the-server-half)
