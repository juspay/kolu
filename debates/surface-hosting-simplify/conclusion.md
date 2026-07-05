# Conclusion — the ratified ledger

Three participants (claude — doctrine judge; codex, grok — radical simplifiers), three rounds, unanimous confirmation in round 3. Mode was open-ended; convergence happened anyway. Every item below was confirmed by all three; evidence citations live in the turn files.

## Agreed simplifications (the series, in implementation order)

**S1 — Registry stores `DestroyableSession`.** `HostEntry<S extends DestroyableSession, H>`; `buildEntry` returns role-shaped entries; the `HostSession` class disappears from every registry/fanout public type. The registry's body only ever calls `destroy()` (add-rollback, remove, destroyAll) — the slot demands exactly that. Claude's `PoolableSession` proposal was withdrawn as one size too big.

**S2 — Fleet verbs are declared at registry construction.** `controls: { reconnect(s), recheck(s) }` supplied ⇒ the returned registry type carries `reconnect`/`recheckAll`; absent ⇒ those members do not exist (union-typed return). No optional methods on sessions, no silent no-ops — the illegal call fails to typecheck.

**S3 — `RemoteMirrorSession` → `MirrorSession<Client = SurfaceClientLike>`.** "Remote" is false for the local arm; the `_C` contract generic is documentary (its own docstring says so) and dies at the role boundary. `pumpRemoteSurface` and `reServeSurface` take `MirrorSession`. The `HostSession` class keeps `<C>` for direct users.

**S4 — Daemon identity graduates now, as one value, on a sub-role.** `DaemonIdentity { contractVersion, buildId, startedAt, commit }` in `@kolu/surface-daemon`; `DaemonMirrorSession extends MirrorSession { identity(): DaemonIdentity | null; convergence(): DaemonConvergence | null }`. BoundPadi's three bespoke readouts die. Identity does NOT go on the base role (null-forever for non-daemons = the silently-absent smell). `clock.now` and `drain` do NOT graduate as universal. **Codex addendum (ratified):** the identity type must keep `buildId` (convergence currency / staleKey) and `commit` (navigable) as DISTINCT fields with distinct meanings — no silent merge.

**S5 — Pool and browser scope: shared vocabulary, separate machinery.** The word is **"binding"**; the browser holds an *active binding*. Browser implementation is the accessor pattern: `SurfaceAppProvider` takes `controlPlane: Accessor<ControlPlane>`, subscriptions keyed off the accessor (static callers pass `() => surfaceApp`). This REPLACES the heavier "dynamic client scope" concept in W4-PR2's plan. No shared pool machinery until a real second consumer proves a kernel.

**S6 — `awaitGracefulExit` extracted as a private helper.** Two live implementations exist (local socket-close wait; remote hello-poll wait, which keeps its instance-keyed drain admission). Not public API.

**S7 — `renew()` on the alias now; the framework interface waits.** BoundPadi's verb renames to `renew()` carrying `readonly preservation: PreservationStrategy` (padi: `children: "survive"`); kaval's `recycleKaval` adopts the same vocabulary (`children: "die"`) without a shared runtime interface. Framework-level `RenewableDaemon` waits for a second bound daemon. UI keeps per-daemon plain words ("running programs will stop"). Net: `BoundPadi = DaemonMirrorSession<PadiSurfaceClient> & { readonly preservation; renew(): Promise<void> }` — an alias plus one typed verb. (This synthesizes the round-2 crossover where codex and claude swapped positions on timing.)

**S8 — The four doctrine defenses stand** and were upheld by both radicals after contact: per-member forwarding policy · fail-loud degraded states · the role/implementation split · prove-then-extract.

## Findings of record (not simplifications, but ratified facts)

- **The dead export**: `evictHostSession` has ZERO production callers (tests + README only), and `hostSession.ts`'s comment claiming `buildHostRegistry.remove` uses it is FALSE (remove calls `destroy()` directly). Disposition at implementation time: delete it or wire it truthfully — the lying comment does not survive either way. `destroyAllSessions` has one consumer (the example monitor).
- **The module memo-cache (`getHostSession`) and the registry are cache-vs-owner, not rival pools** (codex's framing, confirmed against grok's inventory).

## Open questions, documented (not blocking anything above)

- **F2 — universal `hello`**: making the identity preamble something every surface *server* answers (not just daemons) would dissolve S4's sub-role split. Bigger than the hosting side; revisit if/when a non-daemon far end needs identity.

## Consequences for in-flight plans

- **W4-PR1**: the pool consumes the S1/S2-shaped registry (no PoolableSession; the widen-the-slot plan in the primer is superseded by the smaller cut).
- **W4-PR2**: the framework delta shrinks to S5's accessor pattern + subscription keying — not a new scope concept.
- **surface-hosting-101**: its "Proposed solution" section is superseded by this ledger (note updated to point here).
