# vazhi

A standalone TUI for ssh port forwards. Tamil: *way, passage*.

```
nix run github:juspay/kolu#vazhi
```

```
vazhi · 1 forward · answering on pureintent

 › pu-dev:5173  →  0.0.0.0:61010  up 12m

a add · x cancel · j/k move · q quit
```

That row means: whatever listens on pu-dev's own `127.0.0.1:5173` now answers on
port `61010` of **this** machine, on every interface — so
`http://pureintent:61010` opens it from any browser on the network, which
pu-dev's loopback could never do.

| key | |
| --- | --- |
| `a` | add a forward — type `host:port` (or `:port` for a loopback server on this machine) |
| `x` | cancel the selected forward |
| `j` / `k` / arrows | move the selection |
| `q` | quit — every forward vazhi opened goes down with it |

No subcommands, no daemon, no config file. It is an app in the spirit of
opencode: you run it, you look at it, you quit it.

## What it is for

kolu answers this same question inside its Inspector. vazhi exists for the times
kolu isn't around — a bare box, an ssh session, a CI host — and to prove that
the capability underneath is genuinely standalone: **vazhi's only import is
[`@kolu/port-forward`](../port-forward)**, nothing from kolu.

The two are independent apps, not client and server. They never talk. They do
share ssh connections: both compute the same `ControlMaster` path, so a forward
opened here rides the master kolu already has to that host (and vice versa) with
zero coordination code. Each owns and lists only its own forwards.

Run vazhi *inside* a kolu terminal and kaval's PTY persistence keeps it alive
across browser reloads for free.

## Caveats worth knowing

- A forward listener is **unauthenticated raw TCP** on this machine's
  interfaces — the same exposure as running the dev server on `0.0.0.0`
  yourself. The network the machine is on is the trust boundary.
- ssh runs with `BatchMode=yes`: a host that would prompt for a password fails
  fast instead of hanging behind the TUI. `ssh <host>` must work unattended.
- Quitting (or `SIGINT`/`SIGTERM`) tears every forward down. A `SIGKILL` cannot,
  so those listeners linger until the shared ssh master reaps itself.

vazhi has its own `flake.nix` so it can move to its own repo later; today it
lives in the kolu monorepo and is also exposed from the root flake
(`nix run .#vazhi`).
