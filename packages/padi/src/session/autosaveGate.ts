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
 * Three EDGES drive it, and all three ask the same question: the continuous
 * `terminals:dirty` pulse (leading-edge throttled), the continuous FOCUS report —
 * {@link reportActiveTerminalId}, trailing-debounced an order of magnitude slower
 * and writing ONLY the `activeTerminalId` field, because a tab switch changes
 * nothing about any terminal and must not rewrite the trace (#2286) — and the
 * SHUTDOWN edge — {@link captureFinalSession}, run when padi is signalled or
 * drained, so the durable session does not trail the live one by the throttle
 * window at the one moment that is avoidable. Both non-trace edges reuse
 * {@link decideSave} verbatim: neither a stop nor a focus move gets to overrule a
 * freeze or a pending restore.
 *
 * The gate is a pure state machine over injected effects (`snapshot`, `persist`,
 * `persistFinal`, `persistActiveId`, `isRestorePending`): it imports no runtime
 * VALUE from the session/registry layers it
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
  /**
   * Persist a snapshot at a SHUTDOWN edge — the EMPTY-PRESERVE receptacle
   * (`setSavedSessionFromSnapshot`), deliberately not {@link persist}.
   *
   * The two differ on exactly one case and it matters: an ordinary autosave that
   * finds no terminals means the user closed them, so clearing the blob is
   * correct; a SHUTDOWN that finds no terminals may simply be observing a
   * teardown in progress, and nulling a non-empty saved session there is the W1
   * zest-loss class. Preserving cannot resurrect anything — a genuinely empty
   * session was already cleared by the autosave that saw it empty.
   */
  persistFinal: (snapshot: SessionSnapshot) => void;
  /**
   * Persist ONLY the active-terminal marker onto the session ALREADY on disk —
   * never the terminal trace. Focus moves at human cadence (a measured 2.5 s on
   * the 16-terminal padi of #2286) and used to pulse `terminals:dirty`, so every
   * tab switch rewrote all N terminals: 120 whole-session persists per 5 min,
   * `write_bytes` 0 → 253 KB/s, because conf's write-temp-then-rename + backup
   * ring amplifies an 11 KB `config.json` ~57x for a change of ONE field. The
   * field already rides `SavedSession.activeTerminalId`, so patching it in place
   * needs no shape change and therefore no state-store migration.
   */
  persistActiveId: (id: string) => void;
}

/** The gate's answer at fire time — computed fresh each fire from the pushed freeze
 *  flag and the live restore-pending query. Every arm is one of these three outcomes,
 *  so "must not save here" is a typed branch, not a prose convention. */
export type SaveDecision =
  | { kind: "persist" }
  | { kind: "frozen"; reason: string }
  | { kind: "suppressed-parked" };

/** The active-id trailing debounce window. Deliberately an order of magnitude
 *  above the 500 ms session-trace throttle: focus is the CHEAPEST fact in the
 *  blob and the only consumer is the next boot's restore, so the right trade is
 *  "coalesce an entire burst of tab switching into one write", not "track the
 *  live value closely". A shutdown does not pay the window — the final capture
 *  reads the live marker (see {@link captureFinalSession}). Do not lower it
 *  without re-reading #2286: the whole fix is that focus stops touching disk at
 *  interaction cadence. */
const ACTIVE_ID_DEBOUNCE_MS = 5_000;

/** Pending autosave timer. `undefined` ⇒ **idle**; set ⇒ **armed**. Declared at
 *  module top so {@link cancelPendingAutosave} (and thus `session.ts`'s direct
 *  writers) can disarm it. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** The active-id debounce's timer, the value it will write, and the value it last
 *  wrote — three fields of ONE state: `undefined` everywhere ⇒ nothing in flight
 *  and nothing this module knows about the marker on disk.
 *
 *  `lastWrittenActiveId` is the equality guard the pre-#2286 setter had none of:
 *  the client re-reports the SAME id on reconnect, on every workspace-switcher
 *  re-render and after each restore convergence, and each of those used to arm a
 *  full persist. It is cleared by {@link cancelPendingAutosave} because every
 *  caller of that function is about to REPLACE the blob (a `session.restore`, a
 *  restart capture, a `test__set`): what is on disk afterwards is no longer this
 *  module's belief, so the next report must be free to re-arm even if it names
 *  the same terminal. */
let activeIdTimer: ReturnType<typeof setTimeout> | undefined;
let pendingActiveId: string | undefined;
let lastWrittenActiveId: string | undefined;

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

/** Cancel any pending (armed) autosave AND any pending active-id write, returning
 *  the gate to **idle** without firing either. Called by the gate's own fire
 *  callback (a no-op there — the timer already cleared itself), by the padi
 *  `session` cell's `onWrite` hook, and by the named session writers
 *  (`setSavedSession*`) so a stale `terminals:dirty` armed before a manual write
 *  cannot fire after it and clobber the value with an empty-snapshot null (the e2e
 *  `test__set` race, #320 / cycle 6).
 *
 *  The active-id timer is disarmed by the SAME call and for the same reason: its
 *  write patches the `activeTerminalId` of whatever blob is on disk at fire time,
 *  so a timer armed against the PRE-write blob would stamp a marker from the old
 *  session onto the new one. Dropping the pending write loses nothing durable — a
 *  shutdown capture carries the live marker in its snapshot, and any later focus
 *  change re-arms. */
export function cancelPendingAutosave(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  clearTimeout(activeIdTimer);
  activeIdTimer = undefined;
  pendingActiveId = undefined;
  lastWrittenActiveId = undefined;
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
/** The effects {@link initAutosaveGate} was wired with, held so the SHUTDOWN edge
 *  can reach them. Not a second source of truth: it is the SAME value the fire
 *  callback closes over, and the shutdown capture runs the SAME `decideSave`. */
let wiredDeps: AutosaveGateDeps | undefined;

/**
 * Capture the live session at a SHUTDOWN EDGE — a SIGTERM the supervisor sent, a
 * control-core drain — and persist it through the gate's own decision.
 *
 * Why this exists at all: continuous autosave is a leading-edge throttle, so the
 * durable session trails the live one by up to its 500 ms window. That window is
 * a bounded loss for a crash and an UNNECESSARY one for an orderly stop, which is
 * exactly what a supervisor's SIGTERM is — the cross-epoch takeover load-bears on
 * this being the daemon's last act before it exits.
 *
 * It routes through the gate rather than calling the writer directly because the
 * question "is it safe to persist right now, and with what value?" has exactly
 * one owner, and a shutdown does not get to answer it differently:
 *
 *  - **frozen** — a restart's capture→drain→park, or a `session.restore` spawn
 *    window, is mid-flight. The blob on disk is the pre-critical-section one,
 *    which is precisely what a restore should read; writing the half-built live
 *    set over it would lose whatever has not been spawned back yet.
 *  - **suppressed-parked** — a restore is still pending, so the parked entries
 *    stand in for the blob; the live set is not the session.
 *
 * FOCUS IS NOT LOST HERE, even though this call drops a pending active-id write
 * (via `cancelPendingAutosave`): `deps.snapshot()` reads the LIVE active marker
 * off the terminal registry, so the final blob carries the focus as of this
 * instant — fresher than the debounced write it cancels. The ≥5 s window
 * therefore costs a shutdown nothing. (On the frozen / suppressed-parked
 * branches nothing is written at all, which is the point of those branches: the
 * live focus names the half-built set, not the session on disk.)
 *
 * Returns the decision so the caller can narrate it. Throws if the gate was never
 * wired: that is a boot-order defect, not a state to degrade around.
 */
export function captureFinalSession(why: string): SaveDecision {
  const deps = wiredDeps;
  if (deps === undefined) {
    throw new Error(
      `autosave gate is not wired — captureFinalSession(${why}) ran before initAutosaveGate`,
    );
  }
  // Disarm first, unconditionally: a `terminals:dirty` armed before this call
  // would otherwise fire ~500 ms later, during teardown, with a draining
  // registry — the clobber `setSavedSession*` cancels for the same reason.
  cancelPendingAutosave();
  const snap = deps.snapshot();
  const decision = decideSave(deps);
  log.info(
    {
      why,
      decision: decision.kind,
      reason: decision.kind === "frozen" ? decision.reason : undefined,
      snapshot: snap.terminals.length,
    },
    `session-trace final capture (${why}): ${decision.kind} (snapshot=${snap.terminals.length})`,
  );
  if (decision.kind === "persist") deps.persistFinal(snap);
  return decision;
}

/**
 * The CONTINUOUS FOCUS EDGE — the client reported which terminal is active.
 *
 * Separate from `terminals:dirty` on purpose (#2286). Focus is not a session-trace
 * dirty source: it changes nothing about any terminal, only which ONE of them the
 * marker names. Routing it through the trace throttle meant a tab switch rewrote
 * every terminal's record — the measured 253 KB/s of disk writes this split exists
 * to delete. So it gets its OWN trailing debounce and its OWN effect, which patches
 * the single `activeTerminalId` field of the blob already on disk.
 *
 * TRAILING, not the trace's leading-edge throttle, and the difference is the point:
 * a leading edge would write on the FIRST switch of a burst and then again 5 s into
 * it, whereas only the LAST id of a burst is worth a write — nobody restores to a
 * terminal the user already switched away from. The starvation that makes a trailing
 * edge wrong for the trace (the transcript watcher re-arming every 150 ms, so a save
 * never fires) does not apply: focus moves at human cadence, a human eventually
 * stops, and the one moment the value MUST be durable — shutdown — reads the live
 * marker directly rather than waiting for this timer.
 *
 * Reporting the SAME id again is a full no-op, arming nothing: the client re-reports
 * on reconnect and after every restore convergence, and before #2286 there was no
 * equality guard at all.
 *
 * Silently inert until the gate is wired — unlike {@link captureFinalSession}, which
 * throws, because a focus report during boot (before `initAutosaveGate`) is ordinary
 * and the value it would persist is seeded from the blob being restored anyway.
 */
export function reportActiveTerminalId(id: string): void {
  // What the gate already believes about this id: the value the armed timer will
  // write if one is pending, else the value it last PUT on disk. Reporting that
  // same value again is inert — critically, it does not re-arm, so a client that
  // re-asserts focus on a cadence of its own cannot hold the debounce open.
  const believed =
    activeIdTimer === undefined ? lastWrittenActiveId : pendingActiveId;
  if (id === believed) return;
  pendingActiveId = id;
  clearTimeout(activeIdTimer);
  activeIdTimer = setTimeout(() => {
    activeIdTimer = undefined;
    const next = pendingActiveId;
    pendingActiveId = undefined;
    const deps = wiredDeps;
    if (next === undefined || deps === undefined) return;
    // The SAME decision the trace edge takes — a freeze (restart capture, restore
    // spawn window) or a pending restore means the blob on disk is deliberately
    // not the live set, and stamping the live marker onto it would name a terminal
    // that set does not contain. The id is NOT recorded as written on those
    // branches, so a later report of it re-arms rather than being swallowed by the
    // equality guard.
    const decision = decideSave(deps);
    if (decision.kind !== "persist") {
      log.info(
        { decision: decision.kind, activeTerminalId: next },
        `session-trace active-id write: ${decision.kind}`,
      );
      return;
    }
    lastWrittenActiveId = next;
    deps.persistActiveId(next);
  }, ACTIVE_ID_DEBOUNCE_MS);
  // A focus change must never be the reason the process stays up — the serve link
  // owns the daemon's lifetime, and a shutdown carries the live marker regardless.
  activeIdTimer.unref?.();
}

export function initAutosaveGate(gateDeps: AutosaveGateDeps): void {
  wiredDeps = gateDeps;
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
