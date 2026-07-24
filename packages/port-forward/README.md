# @kolu/port-forward

Make a port answer where your browser can reach it.

An agent starts a dev server on `127.0.0.1:5173` — on a remote box, or on the
machine kolu's server runs on. Either way it is invisible from the laptop you
are looking at, because loopback never leaves a machine. This library opens a
door for it on the network side of the machine it runs on, and keeps a map of
those doors: `(host, remotePort) → local listener`, N hosts × N ports.

```ts
import { createForwardManager } from "@kolu/port-forward";

const forwards = createForwardManager({
  onLost: ({ forward, reason }) => console.error(`${forward.key} died: ${reason}`),
});

const f = await forwards.create({ kind: "remote", host: "pu-dev", port: 5173 });
// http://<this machine>:<f.localPort> now serves pu-dev's 127.0.0.1:5173
await forwards.cancel(f.key);
await forwards.dispose(); // every forward, gone
```

Two mechanisms, chosen by target kind:

| target | mechanism |
| --- | --- |
| `{ kind: "remote", host, port }` | `ssh -O forward -L '*:<local>:127.0.0.1:<port>'` on a **shared** ControlMaster |
| `{ kind: "local", port }` | a plain TCP relay, `0.0.0.0:<local>` → `127.0.0.1:<port>` |

The ssh side manages no connections of its own. `ControlMaster=auto` plus a
`ControlPath` computed deterministically from the same convention kolu uses
(`packages/surface-remote/src/controlMaster.ts`) means the first process to
reach a host becomes the master and everyone else rides it — so a forward next
to a running kolu opens **no second ssh connection**. Each host with a forward
also gets an *anchor* (one ssh child running `cat` on a pipe we never write to)
because a forward listener alone does not keep a `ControlPersist` master out of
its idle timer; the anchor is our child, so the forwards cannot outlive us by
more than that timer, and `cancel`/`dispose` drop them at once.

**Security posture:** a forward listener is unauthenticated raw TCP on this
machine's interfaces — exactly the exposure of having started the dev server on
`0.0.0.0` yourself. The network the machine sits on is the trust boundary.

The package has **no dependencies** (node builtins only). Its two consumers —
kolu's Inspector and the standalone [`vazhi`](../vazhi) TUI — are independent
apps that never talk to each other.

See the Atlas note `port-forwarding` for the design.
