**claude** — Swept the four remaining stale-comment residues codex flagged in F5; all other findings (F1–F4) were already resolved in round 1 and reconfirmed by codex.

- `F1` **fixed** (prior round, codex confirmed resolved) — inactive query aborts its controller before returning; late-resolution regression test pins it. No change this round.
- `F2` **fixed** (prior round, codex confirmed resolved) — daemon pending anchor co-owned with the retained host scope; switch-back / re-add coverage. No change this round.
- `F3` **fixed** (prior round, codex confirmed resolved) — `active`/`live`/`pulseHost` injected from ownership authorities, not caller knobs. No change this round.
- `F4` **fixed** (prior round, codex confirmed resolved) — remote-hosts + troubleshooting docs describe active-host-only rendering. No change this round.
- `F5` **fixed** — Agreed; swept the four remaining stale references codex held open:
  - `useDaemonStatus.ts:5-8,13-14` (header) — "A module-level singleton subscription (one local host…)" described the deleted singleton and claimed this module "owns … the live subscription." Rewrote: the `daemonStatus` collection now rides the active host's RETAINED per-host wire owner (`activeScope().wire.daemonStatus`, opened in `hostScope/createHostWire`, held across switch-away); this module reads through that window and owns only the accessors/windows over it.
  - `useDaemonStatus.ts:176` — "Module-lifetime root like `sub` above" pointed at the deleted `sub`. Re-pointed to the still-present `sharedDaemonTransportLive` module-lifetime root above (line 62).
  - `createHostWire.ts:27` — "The exported wire facades (`wire.ts`)" mislocated them; the facades live in `hostScope/activeWire.ts` (deliberate leaf that breaks the `wire → hostScopes → wire` cycle). Corrected the location.
  - `wire.ts:218` — "by the facades below" is stale: the facades are NOT defined below in wire.ts (the block at 355-362 correctly says they moved to `./hostScope/activeWire`). Changed to "by the facades in `./hostScope/activeWire`".

  Comment-only changes; no code behavior touched. `just fmt` clean, `just check` (all-package typecheck + `biome lint --error-on-warnings`) green.
