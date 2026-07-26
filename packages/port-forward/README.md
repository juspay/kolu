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

For a **remote** target the local port is **the remote port whenever that
number is free here** — `pu-dev:4123` answers on `0.0.0.0:4123`, a port you can
predict and bookmark. Only when the number is taken does the kernel pick a free
one instead; a forward is never refused merely because its number is busy, and
there is no knob either way.

A **local** target never gets that preference, and cannot: both ends are on
this machine, so a listener on `0.0.0.0:<port>` relaying to `127.0.0.1:<port>`
would be pointed at itself. The kernel always picks for a relay.

Two mechanisms, chosen by target kind:

| target | mechanism |
| --- | --- |
| `{ kind: "remote", host, port }` | one dedicated `ssh -L '*:<local>:127.0.0.1:<port>' <host> cat` process |
| `{ kind: "local", port }` | a plain TCP relay, `0.0.0.0:<local>` → `127.0.0.1:<port>` |

**A forward lives exactly as long as the process that opened it.** That is what
the mechanism is chosen for. Each remote forward gets its own ssh connection
(`ControlPath=none` — it never rides or creates a shared master) held open by a
remote `cat` reading a pipe this library never writes to, so the kernel closing
that pipe ends the session and the listener with it: on `cancel`, on `dispose`,
on a crash, on `kill -9`, with no timer in the loop.

Sharing kolu's `ControlMaster` was the original design and it was wrong.
OpenSSH gives a master's forwards a lifetime of their own: `-O forward`
listeners outlive their requester until the `ControlPersist` idle timer reaps
them, killing a mux client does not take its forward down, and there is no
`-O list` — so a restarted process can neither see nor adopt what it left
behind. The cost of the fix is one ssh handshake per forward instead of a
channel on a warm master. Authentication costs nothing extra: any host kolu can
mirror non-interactively (`BatchMode=yes`), a forward connection can reach.

**Security posture:** a forward listener is unauthenticated raw TCP on this
machine's interfaces — exactly the exposure of having started the dev server on
`0.0.0.0` yourself. The network the machine sits on is the trust boundary.

The package has **no runtime npm dependencies** (node builtins only) and **one
binary dependency**: a `remote` target spawns `ssh`, so every consumer's
packaging must put OpenSSH on `PATH` — kolu's [`packages/vazhi/default.nix`](../vazhi/default.nix)
does it with `--prefix PATH : ${pkgs.openssh}`. A `local` target needs nothing
but node. Outside the toolchain the only dev dependency is
`@kolu/daemon-test-gate`, the repo's real-process test leash, used by
`lifetime.test.ts`. It has **two** consumers, which is
what makes it a shared capability rather than one app's helper: the standalone
[`vazhi`](../vazhi) TUI, and kolu's Inspector, which embeds the same library in
its server process. They never talk to each other — each owns and lists only its
own forwards, and since every forward carries its own ssh connection they do not
even share those.

See the Atlas note `port-forwarding` for the design.
