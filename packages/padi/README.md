# @kolu/padi

The per-host **terminal-workspace daemon** package. One `padi` (படி, the stepped
stand a koḷu is arranged on) owns everything about one host's terminals —
registry, fold, lifecycle, fs/git, bytes, persistence, kaval supervision — and
serves it as **one complete surface**, `padiSurface`.

**The package is born at W1.1; the process at W2.2** (the padi plan of record,
[`docs/atlas/.../padi.mdx`](../../docs/atlas/src/content/atlas/padi.mdx), PR
#1649). Location is structure: code destined for the daemon must not camp in
`packages/server`, or the W1.8 seal would fight gravity and W2.2 would be a
double move. So the package exists from day one, even though no process does yet.

## Export map (the `@kolu/terminal-workspace` split)

- **`@kolu/padi/surface`** — BROWSER-SAFE. The `padiSurface` 1.0 zod contract,
  the per-member **forwarding-policy** annotations (`value` = hold-open vs
  `delta` = fail-through), and the frozen **control-core** types (hello ·
  version · drain · clock.now). Imports only `@kolu/surface/define` + zod-only
  schema modules — no `node:` runtime, so a browser consumer imports it freely.

- **`@kolu/padi/assembly`** — NODE-ONLY. `padiInProcessDeps(backings)` — the
  fail-fast-complete server deps kolu-server plugs into `implementSurfaces(...)`
  to serve `padiSurface` in-process off the existing terminal domain. W1.1
  injects the member backings from `packages/server` (the seam W1.2–W1.8
  progressively internalize); the padi-domain logic (the `terminals` compose, the
  `urgency` fold, the byte-preview guards, host-side `session.restore`/`import`)
  lives here from birth.

## Status

- **W1.1** (this): the contract + in-process assembly, served BESIDE
  `koluSurface`, ZERO client consumers. A contract test pins the member list,
  the forwarding-policy annotations, and version `1.0`.
- **W1.2–W1.8**: the client migrates onto `padiSurface` member-by-member; each
  PR physically moves its backing out of `packages/server` into here. W1.8 seals
  the boundary.
- **W2.2**: the package gets a process entry — `package = process = staleKey`.
