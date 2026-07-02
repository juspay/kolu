# @kolu/padi

The per-host **terminal-workspace daemon** package. One `padi` (படி, the stepped
stand a koḷu is arranged on) owns everything about one host's terminals —
registry, fold, lifecycle, fs/git, bytes, persistence, kaval supervision — and
serves it as **one complete surface**, `padiSurface`.

**The package is born in W1; the process at W2.2** (the padi plan of record,
[`docs/atlas/.../padi.mdx`](../../docs/atlas/src/content/atlas/padi.mdx), PR
#1649). Location is structure: code destined for the daemon must not camp in
`packages/server`, or the W1.R seal would fight gravity and W2.2 would be a
double move. So the package exists from day one, even though no process does yet.

## W1 is ONE PR, in three commit stages (C → M → R)

- **W1.C — the contract** (this file's `./surface`). `padiSurface` 1.0: the
  composed `terminals` collection (`authored ⋈ snapshot`, one writer), a
  recency-free `urgency` fold, `activity`, the repo/file `{seq}` pulses, fs/git +
  worktree + byte (`scratch.write` / range-capable `preview.read`) procedures,
  `transcript.exportHtml`, lifecycle + chrome procedures, `session.restore` /
  `import`, the `terminalExit` event, and the `terminalAttach` byte stream —
  **every member annotated with a forwarding policy** (`value` = hold-open vs
  `delta` = fail-through, only `activity`/`terminalAttach`) — plus the frozen
  **control core** (hello · version · drain · clock.now). Nothing served; zero
  runtime change.
- **W1.M — the motion**. The terminal domain relocates OUT of `packages/server`
  INTO this package, verbatim (registry · lifecycle · fold + metadata · endpoint
  bindings · scratch/transcript/worktree · session persistence · MRU trackers).
  This adds a **node-only side** beside `./surface`. Pure relocation — no logic,
  wire, or UX change; git detects the moves as renames.
- **W1.R — the rewiring**. The package serves `padiSurface` COMPLETE, natively
  (`implementSurface` is fail-fast — no member may stub, because every backing
  now lives here), and the client migrates onto it one member per commit, deleting
  the root `terminal.*` namespace as it goes. Sealed by a package-boundary test.

## The export map (the `@kolu/terminal-workspace` split)

- **`@kolu/padi/surface`** — BROWSER-SAFE. The `padiSurface` 1.0 zod contract,
  the per-member **forwarding-policy** annotations (`value` = hold-open vs
  `delta` = fail-through), and the frozen **control-core** types (hello ·
  version · drain · clock.now). Imports only `@kolu/surface/define` + zod-only
  schema modules — no `node:` runtime, so a browser consumer imports it freely.

The node-only side (the daemon runtime kolu-server serves through) lands beside
it in W1.M, once the terminal domain moves in. **No backings adapter ever
exists** — the code moves into the package *before* anything serves it, so there
is never a `packages/server` shim standing in for a not-yet-moved backing.

## What padi knows nothing about

Location is structure, so the boundary is defined as much by what padi refuses to
reach for as by what it owns:

- **`packages/server`.** padi NEVER imports kolu-server — the dependency arrow
  points strictly OUT. The few facts the server knows about itself are INJECTED at
  boot (`setKoluServerProcessId` · `setSpawnServerVersion`), never imported, so no
  edge ever points back in.
- **The app logger.** padi has its OWN identity-free pino logger (`./log.ts`): it
  mirrors kolu-server's level/format but does not import the server's
  `hostname.ts` identity base, so the arrow is `@kolu/padi → pino`, never back into
  `packages/server`.
- **The conf store.** Preferences — plus the still-`koluSurface`-hosted `session`
  / MRU / `terminalList` primitives — stay kolu-server's single source of truth
  until W2.2 gives padi its own state-root. padi reads/writes `session` only
  THROUGH the framework-owned surface cell (backed by `confStore(store,
  "session")`), never the raw conf store, so it carries no dependency on the
  server's `state.ts`.

## Status

- **W1.C** (this contract): a contract test pins the member list, the
  set-equality of members ↔ forwarding-policy annotations (no unannotated member,
  no orphan), the delta set = exactly `{activity, terminalAttach}`, the
  serve-dir-shaped range-capable `preview.read`, and version `1.0`. Zero client
  consumers.
- **W1.M / W1.R**: the terminal domain relocates here, then serves natively while
  the client migrates member-by-member; W1.R seals the boundary.
- **W2.2**: the package gets a process entry — `package = process = staleKey`.
