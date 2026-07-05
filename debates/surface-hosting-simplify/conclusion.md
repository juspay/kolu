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

- **The dead export**: `evictHostSession` has ZERO production callers (tests + README only), and `hostSession.ts`'s comment claiming `buildHostRegistry.remove` uses it is FALSE (remove calls `destroy()` directly). Delete it or wire it truthfully. **CORRECTION (odu inventory, post-debate): `destroyAllSessions` has ≥2 real consumers (odu's `run.ts:165` + the example) — NOT dead; the debate's count missed odu. And `getHostSession` is a genuine PUBLIC multi-consumer factory (odu + drishti call it directly), not a mere internal cache.**
- **The module memo-cache (`getHostSession`) and the registry are cache-vs-owner, not rival pools** (codex's framing, confirmed against grok's inventory).

## Post-ratification amendment (srid, 2026-07-05) — F2 RESOLVED: hello IS universal

srid ruled the parked question: **every surface server answers "who are you" — no exceptions.** The debate's counter-argument ("identity() on the base role claims daemon semantics") conflated basic identity (contract version · startedAt · build · commit — meaningful for EVERY serving process) with supervision semantics (convergence states, drain — genuinely daemon-only). The null-forever objection was only true while some servers don't answer; the ruling removes that class. Design consequence, amending S4:

- **The framework auto-serves the identity preamble** on every serve path (`implementSurface`/serve wrappers stamp it from baked identity — zero per-server code; fakes conform for free; like HTTP answering OPTIONS).
- **`identity()` moves to the base `MirrorSession`** (null only transiently before first contact, never null-forever).
- **`DaemonMirrorSession` shrinks to `convergence()`** — supervision stays the sub-role; identity does not.
- Skew becomes pre-handshake-detectable on EVERY client-server pair, not just supervised daemons.

S4's field-distinctness addendum (buildId ≠ commit) carries over unchanged.

**S7b (owner addendum, same session): renew()/preservation fold INTO DaemonMirrorSession; the BoundPadi alias is DELETED.** srid: the alias was redundant — and the deeper cut it revealed: renew() is supervision (the manual trigger of the machinery convergence() reports on), so it belongs on the daemon sub-role, not a per-app extension. After the fold, nothing padi-specific remains to name; call sites write `DaemonMirrorSession<PadiSurfaceClient>` directly. (Amends S7's alias shape; S7's timing point — framework `RenewableDaemon` waits — is subsumed: the sub-role now IS the home, and there is no separate interface to defer.)

**S3b (owner addendum): naming, applied consistently by the 'say the one thing that differs' rule** — `RemoteMirrorSession` → **`Session`** (reconnecting is UNIVERSAL here — a one-shot is a *dial*, not a session — so the qualifier distinguishes nothing; the plain noun is the name) · `DaemonMirrorSession` → **`DaemonSession`** (same fix: "Mirror" named the consumer); `HostSession` → **DELETED** (post-S9 there is no ssh session type or class — "a session over ssh" is `makeSession({ connectOnce: sshConnector(…) })`; the *connector* is the kept primitive, the composition inlined — the BoundPadi rule again); and the padi arms, once S9 collapses them, need no class names at all.

**S9 (owner addendum, the deepest cut — srid): extract the reconnect loop as the electricity; make transport a connector and supervision a hook.** `makeSession({ connectOnce, admit? })` owns the reconnect/backoff/give-up/state-merge loop ONCE (prove-then-extract satisfied: two live loop implementations exist today — ssh + the local bridge). `connectOnce` is the transport plug (returns `{ client, closed, isAlive }` — so even the drain-took difference is data the connector supplies). `admit` is ONE typed hook (closed verdict union: adopt | refuse(state) | replaced), NOT a plugin bag — its verdicts merge into `onState`, dissolving the wrapper's state-overlay. Consequences: sessions are closures the daemon members are added to by object **spread** (`{ ...base, convergence, renew, preservation }`) — the TS-idiomatic derivation, no wrapper classes, no forwarding boilerplate.

**S10 (owner addendum, the deepest — srid, on reading the code): delete `getHostSession` and its module-global session pool.** The pool (`hostSession.ts:924`) is a SECOND session registry shadowing every consumer's own (kolu's `buildHostRegistry` map, odu's lane holdings, drishti's fleet) — the "two pools" F1 finding, and the source of the destroyed-instance dance (pool vs `buildHostRegistry.remove` collide). Its dedup is unused (one call site per consumer, each keying its own map; `evictHostSession` has zero callers), and it is a shared mutable place with no single owner (violates values-not-places / one-authority). Deleted: `getHostSession`, the pool, `evictHostSession`, `destroyAllSessions`. Consumers compose `makeSession({ connectOnce: sshConnector(opts) })` directly and own + tear down their own sessions (odu: a 2-line loop over its lane set). `sshConnector` + `makeSession` become the public ssh vocabulary (three real consumers each). Net across the three PRs: LESS code. This RESOLVES the F1 two-pools fork.

## Third consumer: odu (post-debate correction)

The debate reasoned over TWO consumers (kolu, drishti). **odu (github.com/juspay/odu) is a THIRD** — it imports `getHostSession`, `HostSessionState`, and `destroyAllSessions` from `@kolu/surface-nix-host` (`src/coordinator/lane.ts`, `run.ts`). This STRENGTHENS every prove-then-extract call (three live consumers) and changes the specifics via S10: `getHostSession` + its global pool are DELETED (see S10); `destroyAllSessions`/`evictHostSession` go with it (odu owns its lane teardown); `HostSessionState`→`SessionState` moves in odu's PR. **The change lands as THREE paired PRs (kolu · drishti · odu), all CI-green before any merge.** kolu's remote-padi arm composes `makeSession({ connectOnce: sshConnector({binary:"padi"}), admit: padiAdmit })` directly; the local arm swaps to `endpointConnector`; the arms share `padiAdmit` + the daemon-member spread.

## Consequences for in-flight plans

- **W4-PR1**: the pool consumes the S1/S2-shaped registry (no PoolableSession; the widen-the-slot plan in the primer is superseded by the smaller cut).
- **W4-PR2**: the framework delta shrinks to S5's accessor pattern + subscription keying — not a new scope concept.
- **surface-hosting-101**: its "Proposed solution" section is superseded by this ledger (note updated to point here).
