# Debate: simplify the hosting side of the `@kolu/surface` stack

**Mode**: open-ended exploration — strongest analyses recorded; disagreements left standing as documented forks. No forced consensus.

**Stances**: `codex` and `grok` — **radical simplifiers**: propose the SMALLEST defensible API surface; attack every concept that could be collapsed, renamed, merged, or deleted. `claude` — argues from the repo's two doctrines (/perfection-review: would the defect class become inexpressible?; /architecture-first-principles: values-not-places · one authority on its own clock · illegal states unrepresentable · guarantees at the knowing endpoint), defending only what the doctrines defend and conceding the rest.

**Ground truth** (read the code; do not trust this summary): this worktree contains current master. Read first: `docs/atlas/src/content/atlas/surface-hosting-101.mdx` (the primer + open questions). Then the code it cites: `packages/surface-nix-host/src/` (HostSession class, hostFanout.ts: buildHostRegistry + reServeSurface), `packages/server/src/padiBinding.ts` + `padiConvergence.ts` + `remotePadiBinding.ts` (BoundPadi role, local/remote arms, the shared convergence policy), `packages/surface-daemon-supervisor/src/convergence/` (the L3 kit: decide/converge, DrainableProbe vs PlainProbe), `packages/padi/src/controlCore.ts` (frozen hello · version · drain · clock.now).

**The API concepts in play**: `RemoteMirrorSession` (role) · `HostSession` (concrete ssh class) · `BoundPadi` (kolu sub-role: role + drain + identity, two arms) · a proposed `PoolableSession` widening of buildHostRegistry's class-typed slot · W4-PR2's planned `surface-app` dynamic client scope (the browser's client becomes swappable at runtime).

**Questions** (answer with concrete type signatures; say what each proposal kills and what it deliberately does NOT do):
1. Can the session vocabulary be collapsed or clarified? Should the frozen control core graduate to the shared daemon package as the universal preamble, letting a shared session role carry `identity()` honestly — and does `BoundPadi` then become a mere type alias?
2. Server-side pool (buildHostRegistry, many upstreams held warm) and client-side dynamic scope (surface-app, one active client swapped) both express "the set of live surface-clients changes at runtime." One volatility appearing twice, or genuinely two? Shared vocabulary? Shared machinery?
3. Daemon replacement: keep two verbs (padi `drain` · kaval `recycle`), or one supervisor `renew()` branching on a daemon-DECLARED state-preservation strategy (state-external → graceful exit, children survive; state-internal → snapshot-kill-restore)?
4. Fleet verbs (`reconnect`/`recheck`) on a pooled-session role: optional methods, or declared capabilities in the type? Where does optionality live?
5. Anything else the code shows that should shrink — name it, with evidence.

**Constraints**: kolu and drishti must keep compiling with minimal churn · fail-fast doctrine (no silent fallbacks; illegal states unrepresentable) · prove-then-extract (no receptacle for a population of one) · framework slots speak roles, classes are for `new`.

**Mechanics**: write ONLY your own turn file (`NN.<your-id>.md` in this directory). Round 1 is independent — do NOT read the other participants' turn files this round. Read any repo code you like; edit nothing outside your turn file. When your file is written, notify the coordinator: `kaval-tui send bb994d02 "[DEBATE] <your-id> round 1 done"` then a second command `kaval-tui send bb994d02 --key Enter`.

**Amendment (srid, mid-round-1): drishti is OURS.** srid owns srid/drishti and it can be changed at will — a coordinated kolu+drishti change is routine (the paired-PR ship-gate exists for exactly that). So do NOT treat drishti's current consumption shape as immovable: "drishti must keep compiling with minimal churn" means avoid GRATUITOUS churn, not that drishti's API expectations are frozen. Breaking changes to the framework are acceptable when the simplification earns them — both consumers just move together.
