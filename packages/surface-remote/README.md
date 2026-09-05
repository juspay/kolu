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
to be noticed and exited, turning an unbounded park on a half-open socket into a
failure the reconnect loop can retry. It does **not** let a connected link ride
out a blip — Effect RPC's own pinger ends a connected socket after 5–10s of
silence and is not tunable (see `links/wire.ts` in `@kolu/surface`). During
provisioning, the tolerance you request is bounded by the child-lifetime budget
of **the step the dial is in**, and those differ: a hard 30s deadline for the
quick probes, `PROVISION_STEP_SILENCE_BASE_MS` 120s of child silence for the
required build — *escalating* to 240s, 480s and a last budgeted 960s as
`makeStepBudget` doubles it per expiry — and a fixed `PROVISION_COPY_SILENCE_MS`
600s for the speculative closure copies. ssh keepalives are protocol traffic and
reset none of them. The reference page lists all four bounds and which of them
are knobs at all.

Worked end-to-end in [`packages/surface/example/remote-process-monitor`](../surface/example/remote-process-monitor).
Part of the kolu monorepo — `"@kolu/surface-remote": "workspace:*"`.

## Docs

- Tutorial — [Across the hosts](https://kolu.dev/surface/across-the-hosts)
- How-to — [Mirror a surface over ssh](https://kolu.dev/surface/mirror-over-ssh) · [Operate a fleet safely](https://kolu.dev/surface/operate-a-fleet-safely)
- Reference — [@kolu/surface-remote](https://kolu.dev/surface/ref-surface-remote)
- Explanation — [The server half](https://kolu.dev/surface/the-server-half)
