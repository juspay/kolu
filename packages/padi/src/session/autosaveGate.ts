/**
 * The AutosaveGate — the ONE owner of "is it safe to persist the session now, and
 * with what value?"
 *
 * Before this module that question was assembled from five scattered places, each
 * holding a fragment of the invariant and each documented in prose:
 *   1. a module-level debounce timer in `session.ts` (arm/fire),
 *   2. a `restartInFlight` flag in `session.ts`, PUSHED by `ptyHost/restartLocal.ts`,
 *   3. a live `hasParkedTerminals()` registry query read inside the fire callback,
 *   4. the padi `session` cell's `onWrite` hook cancelling a pending save
 *      (`servePadi.ts`), and
 *   5. four "must NOT arm autosave here" call-site conventions in
 *      `terminalEndpoint/metadata.ts`.
 * They all collapse here. The invariant is now explicit state + named transitions,
 * so a writer that should not arm the gate simply does not call `notifyDirty`,
 * and one that should does — there is no prose left to get wrong.
 *
 * Explicit state:
 *   - **idle** — no save pending; the quiescent state.
 *   - **armed** — a dirty pulse scheduled a save (leading-edge throttle). Arming is
 *     idempotent within the 500 ms window: the first pulse schedules, the rest are
 *     absorbed into the one upcoming snapshot.
 *   - **frozen(reason)** — a critical section (a restart's capture → drain → park, or
 *     a `session.restore` spawn window) holds a freeze LEASE; the fire is blocked until
 *     the LAST lease lifts via {@link unfreezeAutosave}, regardless of arming. A PUSHED
 *     fact — `restartLocal.ts` / `sessionRestore.ts` call {@link freezeAutosave} /
 *     {@link unfreezeAutosave} — because each critical section is its own sole authority
 *     and there is no other source of truth for "is one in flight". Leases are
 *     independent (a Map of tokens), so two overlapping owners can hold the gate at once
 *     and neither thaws the other's section early. It is orthogonal to the timer: the
 *     drain arms a save WHILE frozen (a `terminals:dirty` the exiting PTYs fire), and
 *     the freeze is what keeps that fire from nulling the just-captured session in the
 *     drain→park gap.
 *   - **suppressed(parked)** — a restore is pending (parked entries stand in for the
 *     on-disk blob). NOT stored here: it is read LIVE at fire via the injected
 *     `isRestorePending` query, because the terminal-registry is its sole source of
 *     truth AND the value can change between arm and fire — mirroring it in the gate
 *     would duplicate that truth and could stale the PATH-B guard.
 *
 * The gate is a pure state machine over injected effects (`snapshot`, `persist`,
 * `isRestorePending`): it imports no runtime VALUE from the session/registry layers it
 * drives (only the `SessionSnapshot` type, erased at compile), so those layers PUSH
 * their facts and effects into it rather than the gate reaching back out. It consumes
 * the shared `terminals:dirty` pulse (also read by the activity
 * taps in `liveActivity.ts`); the single writer-facing entry that emits it,
 * `notifyDirty`, lives beside the channel in `./publisher.ts` — the gate is a pure
 * subscriber here.
 */

import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import type { SessionSnapshot } from "./session.ts";

/** The effects the gate drives, PUSHED in at boot so the gate imports nothing from
 *  the session/registry layers it acts on. */
interface AutosaveGateDeps {
  /** The live terminal set to persist — computed fresh at each fire. */
  snapshot: () => SessionSnapshot;
  /** Is a restore still pending (parked entries present)? Read LIVE at fire — the
   *  registry is its source of truth and the value can change between arm and fire. */
  isRestorePending: () => boolean;
  /** Persist a snapshot (clears the blob on an empty snapshot). */
  persist: (snapshot: SessionSnapshot) => void;
}

/** The gate's answer at fire time — computed fresh each fire from the pushed freeze
 *  flag and the live restore-pending query. Every arm is one of these three outcomes,
 *  so "must not save here" is a typed branch, not a prose convention. */
type SaveDecision =
  | { kind: "persist" }
  | { kind: "frozen"; reason: string }
  | { kind: "suppressed-parked" };

/** Pending autosave timer. `undefined` ⇒ **idle**; set ⇒ **armed**. Declared at
 *  module top so {@link cancelPendingAutosave} (and thus `session.ts`'s direct
 *  writers) can disarm it. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** The set of ACTIVE freeze leases → their reason (for logging). The gate is
 *  **frozen** while this is non-empty. A Map of independent leases — NOT a single
 *  scalar — because TWO async owners can hold the critical section at once (a
 *  `session.restore` spawn window overlapping a `restartLocalDaemon` capture→park,
 *  or two concurrent restores): a scalar reason would let whichever finishes first
 *  thaw the OTHER's still-live section, reopening the drain→park clobber window it
 *  was pinning. Each `freezeAutosave` mints its OWN token and each `unfreezeAutosave`
 *  releases only that token, so the gate stays frozen until the LAST lease lifts. */
const activeFreezes = new Map<symbol, string>();

/** An opaque freeze lease — {@link freezeAutosave} returns one, {@link unfreezeAutosave}
 *  releases it. Idempotent: releasing an already-released (or unknown) token is a no-op. */
export type AutosaveFreeze = symbol;

/** Cancel any pending (armed) autosave, returning the gate to **idle** without
 *  firing. Called by the gate's own fire callback (a no-op there — the timer already
 *  cleared itself), by the padi `session` cell's `onWrite` hook, and by the named
 *  session writers (`setSavedSession*`) so a stale `terminals:dirty` armed before a
 *  manual write cannot fire after it and clobber the value with an empty-snapshot
 *  null (the e2e `test__set` race, #320 / cycle 6). */
export function cancelPendingAutosave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

/** Enter **frozen(reason)** for a restart's critical section — set at `capture`
 *  (before the drain can arm anything), lifted after `park`. While frozen the fire
 *  bails, so a `terminals:dirty` the drain fires (the PTYs exiting as the daemon is
 *  killed) cannot arm a save that runs in the drain→park GAP — the window where the
 *  registry is empty AND no parked entries exist yet, so the parked query is inert
 *  and an unfrozen fire would null the just-captured session before park runs (the
 *  zest restart-path clobber). Park then seeds the parked entries and the parked
 *  query takes over. */
export function freezeAutosave(reason: string): AutosaveFreeze {
  const token: AutosaveFreeze = Symbol(reason);
  activeFreezes.set(token, reason);
  return token;
}

/** Release a freeze lease — the gate returns to **idle** / **armed** per the timer
 *  ONLY once EVERY lease is released. Safe on a restart's success OR failure path; a
 *  failed restart pairs it with {@link cancelPendingAutosave} so a drain-armed timer
 *  cannot clobber the captured session after the last freeze lifts. Idempotent.
 *
 *  A token-LESS call thaws ALL leases — the defensive reset the test teardown uses to
 *  return the module-global gate to a clean slate between cases; production callers
 *  always release their OWN token so they never thaw a concurrent owner's section. */
export function unfreezeAutosave(token?: AutosaveFreeze): void {
  if (token === undefined) activeFreezes.clear();
  else activeFreezes.delete(token);
}

/** Decide, at fire, whether to persist — freeze first (the drain→park window a plain
 *  parked query misses), then the live parked query, else persist. Takes `deps` as a
 *  parameter (the fire callback threads its own closure), so the restore-pending query
 *  is a plain call — not an optional on a value that cannot be absent once the gate has
 *  fired. */
function decideSave(deps: AutosaveGateDeps): SaveDecision {
  if (activeFreezes.size > 0)
    return { kind: "frozen", reason: [...activeFreezes.values()].join("; ") };
  if (deps.isRestorePending()) return { kind: "suppressed-parked" };
  return { kind: "persist" };
}

/** Wire the gate to the terminal-lifecycle pulse and the injected effects. Called
 *  once at startup.
 *
 *  Leading-edge throttle: the first dirty pulse in a quiet period schedules a save
 *  500 ms later; pulses during that window are absorbed into the same upcoming
 *  snapshot (because `snapshot()` runs inside the callback, not at schedule time). A
 *  trailing-edge debounce — the obvious alternative — starves under bursty inputs:
 *  the Claude transcript watcher fires every 150 ms while an agent is streaming,
 *  which would reset the timer indefinitely and the save would never fire.
 *
 *  Assumes `persist` is synchronous (it is — a sync `store.set` + sync publish). If
 *  anyone makes it async, add an in-flight guard so a new schedule can't race an
 *  unfinished write. */
export function initAutosaveGate(gateDeps: AutosaveGateDeps): void {
  void (async () => {
    try {
      for await (const _ of terminalsDirtyChannel.subscribe(undefined)) {
        if (saveTimer) continue; // already armed — absorb into the pending snapshot
        saveTimer = setTimeout(() => {
          saveTimer = undefined; // armed → idle before the decision
          // Take the candidate snapshot on EVERY fire, before the guards — the
          // ordering guard in `restartLocal.test.ts` observes the fire through this
          // call, so it must run even when the decision below skips the persist.
          const snap = gateDeps.snapshot();
          const decision = decideSave(gateDeps);
          log.info(
            {
              decision: decision.kind,
              reason: decision.kind === "frozen" ? decision.reason : undefined,
              snapshot: snap.terminals.length,
            },
            `session-trace autosave: ${decision.kind} (snapshot=${snap.terminals.length})`,
          );
          if (decision.kind === "persist") gateDeps.persist(snap);
        }, 500);
      }
    } catch (err) {
      log.error({ err }, "session auto-save subscription failed");
    }
  })();
}
