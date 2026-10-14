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

ssh is not the only transport a session can run over. `unixSocketConnector`
plugs a session onto a daemon already listening on a **unix socket on this box**
— `makeSession({ connectOnce: unixSocketConnector({ socketPath: () => path,
group: surface.group, client: (d) => faceOver(d), describe: "odu daemon" }) })`.
`socketPath` is a thunk because a daemon's path comes from its environment, and
a connector that captured it once would keep dialling a stale one.

Two things about it are easy to get wrong. It dials and **owns** the socket,
handing it to `socketDuplexLink` as both halves, so the socket's own `close`
event is what resolves the connection's `closed` — `unixSocketLink` dials
internally and gives no such signal, which would leave a session unable to
notice its daemon die. And **absence is a value, not a failure**: a dial
answering `ENOENT` or `ECONNREFUSED` means nothing is serving that path, so the
connector throws `EndpointAbsentError` and the session publishes its quiet
`absent` arm (retried at the ceiling, logged at debug) instead of escalating
toward `failed`. Every other dial error stays an ordinary network `ConnectError`.

A re-serve is **demand-gated**. Every downstream call enters through one of
`reServeSurface`'s handlers, so that is where "somebody is looking" is counted —
one gate for cells, collections, streams, events and procedures alike. The
session is pinned on the crossing from nobody to somebody and released on the way
back, so an upstream nobody is subscribed to is never dialled at all. The release
waits a fixed grace (`RELEASE_GRACE_MS`, 30s — a constant rather than an option:
a consumer whose subscriptions re-key drops to zero pins and back within a tick,
and the grace is what makes that crossing free). `pumpRemoteSurface` pins
nothing, deliberately; a parent that wants its link up whether or not anyone is
reading it — kolu-server, whose fleet shows a host's link state before a browser
subscribes to anything on it — states that by pinning the session itself, and the
count never reaches zero.

Demand gating is what makes an optional upstream cheap. The `absent` frames are
what make it honest: a hold-open relay rides out a drop by saying nothing, which
is right for a link that is coming back and wrong for one that was never there or
has been stopped — the subscriber goes on painting its last live frame, and a
reader cannot tell a still board from a dead one. So `reServeSurface` takes an
absent frame per value member (`absent: { checkout: CHECKOUT_NONE }`), sent ONCE
per absence and replaced by the next live frame. It is the member's OWN frame
type: the shape of "nothing to say" belongs to the source contract, not to this
relay. Naming a member that is not a `value`-classified stream or event throws at
wiring time — a frame nobody could ever receive is worse than no frame at all.

Worked end-to-end in [`packages/surface/example/remote-process-monitor`](../surface/example/remote-process-monitor).
Part of the kolu monorepo — `"@kolu/surface-remote": "workspace:*"`.

## Docs

- Tutorial — [Across the hosts](https://kolu.dev/surface/across-the-hosts)
- How-to — [Mirror a surface over ssh](https://kolu.dev/surface/mirror-over-ssh) · [Operate a fleet safely](https://kolu.dev/surface/operate-a-fleet-safely)
- Reference — [@kolu/surface-remote](https://kolu.dev/surface/ref-surface-remote)
- Explanation — [The server half](https://kolu.dev/surface/the-server-half)
