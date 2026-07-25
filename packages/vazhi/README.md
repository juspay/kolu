# vazhi

A standalone TUI for ssh port forwards. Tamil: *way, passage*.

```
nix run github:juspay/kolu#vazhi
```

A full-screen terminal app — it takes the window, redraws on resize, and gives
your scrollback back untouched when you quit:

```
vazhi · 1 forward · answering on pureintent

 › pu-dev:5173  →  http://pureintent:5173  up 12m


a add · x cancel · ↑/↓ move · q quit
```

That row means: whatever listens on pu-dev's own `127.0.0.1:5173` now answers at
`http://pureintent:5173` — a port on **this** machine, bound on every interface
— so any browser on the network can open it, which pu-dev's loopback could
never do. The URL is a real terminal hyperlink (OSC 8): **click it**.

The local port is the remote port whenever that number is free here, so the
URL is predictable. When it isn't free, the kernel picks one and the row shows
which — a forward is never refused just because its number is busy.

| key | |
| --- | --- |
| `a` | add a forward — type `host:port` (or `:port` for a loopback server on this machine) |
| `x` | cancel the selected forward |
| `↑` / `↓` (or `j` / `k`) | move the selection |
| `q` | quit — every forward vazhi opened goes down with it |

No subcommands, no daemon, no config file. It is an app in the spirit of
opencode: you run it, you look at it, you quit it. The screen is
[Ink](https://github.com/vadimdemedes/ink) — see `App.tsx` for why not OpenTUI,
which would otherwise have been the SolidJS-shaped choice.

## What it is for

kolu's Inspector now *lists* what a terminal is serving (the Atlas note's PRT1),
but it cannot yet make a loopback or remote-host port reachable — that is PRT2,
not shipped. Until it lands, those ports say "needs a forward" in the Inspector
and vazhi is how you open one. vazhi also exists for the times kolu isn't around — a bare
box, an ssh session, a CI host — and to prove that the capability underneath is
genuinely standalone: **vazhi's only import is
[`@kolu/port-forward`](../port-forward)**, nothing from kolu.

The two are independent apps, not client and server. They never talk, and they
share nothing — not state, and not ssh connections: every forward owns its own,
which is what makes a forward die exactly when the process that opened it does.
Each app owns and lists only its own forwards.

Run vazhi *inside* a kolu terminal and kaval's PTY persistence keeps it alive
across browser reloads for free.

## Caveats worth knowing

- A forward listener is **unauthenticated raw TCP** on this machine's
  interfaces — the same exposure as running the dev server on `0.0.0.0`
  yourself. The network the machine is on is the trust boundary.
- ssh runs with `BatchMode=yes`: a host that would prompt for a password fails
  fast instead of hanging behind the TUI. `ssh <host>` must work unattended.
- Quitting (or `SIGINT`/`SIGTERM`) tears every forward down — and so does a
  `SIGKILL`, or a crash, or losing power to the machine you ran it from: each
  forward's ssh connection dies with vazhi, and the port stops answering at
  once. Nothing waits on a timer, and nothing is left mapped.

vazhi has its own `flake.nix` so it can move to its own repo later; today it
lives in the kolu monorepo and is also exposed from the root flake
(`nix run .#vazhi`).
