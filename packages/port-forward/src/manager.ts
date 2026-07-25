/**
 * The forward map: `(host, remotePort) → local listener`, N hosts × N ports.
 *
 * This module is *only* the map. It never spawns ssh, never binds a socket —
 * it holds one entry per target, hands each out, and takes it down again. The
 * mechanisms are injected, which is what lets the map's semantics (idempotent
 * create, races, loss, teardown) be tested without a single real connection.
 *
 * Semantics worth stating:
 *  - `create` is **idempotent by target**. One listener per (host, port) is the
 *    invariant, so a second create for a live target returns the SAME forward
 *    rather than a second listener — that is what makes the Inspector's
 *    click-a-port flow safe to click twice.
 *  - `cancel` on an unknown key **throws**. Nothing is "already fine" about
 *    cancelling a forward that was never there; it means the caller's view of
 *    the map disagrees with the map. A key that is still OPENING is not
 *    unknown, though — cancel waits for it to arrive and then takes it down.
 *  - a forward that dies on its own (its ssh master went away, its listener
 *    failed) leaves the map and is reported via `onLost` — a dead forward must
 *    never keep rendering as live.
 */

import type { ForwardMechanisms, OpenedForward } from "./mechanism.ts";
import { plainDiagnostic } from "./diagnostic.ts";
import { assertTarget, type ForwardTarget, targetKey } from "./target.ts";

/** A live forward, as callers see it. */
export interface Forward {
  /** `host:port` for a remote target, `local:port` for a loopback relay — the
   *  map key, and the handle `cancel` takes. */
  readonly key: string;
  readonly target: ForwardTarget;
  /** The port it answers on, on every interface of THIS machine. */
  readonly localPort: number;
  /** Epoch ms when the listener came up — what an "up 12m" column renders. */
  readonly createdAt: number;
}

/** Rejects a `create` that finished opening after `dispose` had already run:
 *  the listener it produced was closed immediately, so this is the map keeping
 *  its promise, not a teardown failure.
 *
 *  It carries no decision — `dispose` counts `SurvivedTeardownError` and
 *  nothing else (see there for why that direction is the safe one). This type
 *  exists so the caller's rejection SAYS what happened rather than reading like
 *  a fault. */
export class DisposedMidOpenError extends Error {
  constructor() {
    super(
      "port-forward: the forward map was disposed while this forward was opening; it has been closed.",
    );
    this.name = "DisposedMidOpenError";
  }
}

/** Thrown by a flight that opened a listener `dispose` then failed to close:
 *  the listener is still out there and still in the map.
 *
 *  `dispose` counts THESE and nothing else. The rule used to be the other way
 *  round — every rejection except the clean mid-open one was treated as a
 *  teardown failure — which made an ordinary `open()` rejection (no listener
 *  was ever created) come out as "a forward could not be torn down", over an
 *  empty map. Counting only the failure that names itself means a new rejection
 *  path cannot be miscounted into that claim by accident. */
export class SurvivedTeardownError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = "SurvivedTeardownError";
  }
}

/** Something happened to a forward that nobody asked for, and what it means.
 *
 *  `gone` — it is no longer there; the map has dropped it.
 *  `degraded` — it broke and could NOT be cleaned up, so it may still be
 *  reachable. The map KEEPS it: a listener nobody can close must stay visible
 *  and retryable rather than vanish from the list while the door stands open. */
export interface ForwardLoss {
  readonly forward: Forward;
  readonly reason: string;
  readonly kind: "gone" | "degraded";
}

export interface ForwardManager {
  /** Open a forward for `target`, or return the live one if there already is
   *  one. Rejects — with the mechanism's own error text — if it can't. */
  create(target: ForwardTarget): Promise<Forward>;
  /** Take down the forward with this key. Rejects if there is no such key. */
  cancel(key: string): Promise<void>;
  /** Every live forward, oldest first. */
  list(): readonly Forward[];
  /** Take every forward down. Rejects with an `AggregateError` if any refused
   *  to go, having still attempted all of them. */
  dispose(): Promise<void>;
}

/** One key's place in the map, in whichever of its two states it is in. ONE
 *  container, not an open map beside an opening map: "is this key in the map?"
 *  must have a single answer, or every method has to remember to ask twice and
 *  a key can be legitimately in both. */
type Slot =
  | {
      readonly state: "opening";
      readonly flight: Promise<Forward>;
      /** The identity of THIS opening, installed before the mechanism can call
       *  back, so a loss it reports before `open()` resolves is attributable. */
      readonly token: object;
      /** Set when a `cancel` is already committed to tearing this opening down
       *  as soon as it lands. Resolves when that whole cancel has finished.
       *
       *  Without it a `create` arriving mid-flight would JOIN the flight and be
       *  handed the very forward the cancel then closes — a caller holding a
       *  forward that is neither listed nor live. */
      readonly cancelling?: Promise<void>;
    }
  | {
      readonly state: "open";
      readonly forward: Forward;
      readonly opened: OpenedForward;
      /** Identity of the OPENING that produced this listener. A loss callback
       *  carries the same token, so a late loss from a forward that has since
       *  been cancelled cannot delete the REPLACEMENT that reused its key. */
      readonly token: object;
    }
  /** Teardown is under way. The forward is NOT available to a create — handing
   *  it out would resolve someone's `create` with a listener that is closing
   *  under them — but it is still represented, because until `close` resolves
   *  we do not know whether the door is shut. */
  | {
      readonly state: "closing";
      readonly forward: Forward;
      readonly opened: OpenedForward;
      /** The teardown's OUTCOME — the failure, or `undefined` for success. It
       *  never rejects, because every joiner must be able to await it, and it
       *  must not erase the failure: a `dispose` joining a `cancel` has to see
       *  that the close failed, or it would report success over a listener that
       *  may still be live. */
      readonly closing: Promise<unknown | undefined>;
      readonly token: object;
    };

/** Build a forward map over the given mechanisms. Production callers want
 *  `createForwardManager` from the package index, which supplies the real ones;
 *  this entry point exists so the map can be driven against fakes. */
export function makeForwardManager(opts: {
  mechanisms: ForwardMechanisms;
  onLost: (loss: ForwardLoss) => void;
}): ForwardManager {
  const slots = new Map<string, Slot>();
  /** Set by `dispose`. A forward that was still opening when the map was
   *  disposed must not quietly become a live listener nobody is tracking —
   *  the whole point of dispose is that nothing survives it. */
  let disposed = false;

  /** Keys whose listener the mechanism has DEFINITIVELY reported dead while we
   *  were closing them. A close that then fails must not resurrect such a
   *  forward: the loss is the stronger fact. */
  const lostWhileClosing = new Set<string>();

  /** What a mechanism reported about a forward that had not finished opening
   *  yet, by token — the DISPOSITION as well as the reason, because the two
   *  demand opposite things of the flight: a `gone` listener must not be
   *  published, while a `degraded` one may still be reachable and therefore
   *  must not be forgotten. Collapsing them to a string stranded exactly the
   *  listener the fault channel exists to keep hold of. */
  const reportedWhileOpening = new Map<
    object,
    { reason: string; kind: "gone" | "degraded" }
  >();

  /** Openings genuinely in flight. A mechanism can call back from INSIDE
   *  `open()`, before this key has a slot at all, so "no slot" alone cannot
   *  tell a pre-slot loss from a stale callback belonging to a forward that
   *  came and went — and recording the latter would leave a token entry nothing
   *  ever reads or deletes. */
  const opening = new Set<object>();

  function lose(
    key: string,
    reason: string,
    token: object,
    kind: "gone" | "degraded",
  ): void {
    const slot = slots.get(key);
    // No slot yet, or still opening: the mechanism can report a loss from
    // INSIDE `open()`, before its own promise resolves and therefore before
    // this key has a slot at all. Keyed by token, so only the flight it
    // belongs to will read it.
    if (slot === undefined || slot.state === "opening") {
      // Only an opening that is genuinely still in flight can be told about a
      // loss; a callback from a forward that has come and gone is ignored.
      if (opening.has(token)) reportedWhileOpening.set(token, { reason, kind });
      return;
    }
    // Not ours: this loss belongs to a forward that has already gone, and the
    // key now holds someone else's listener.
    if (slot.token !== token) return;
    if (slot.state === "closing") {
      // Already on its way out — remember the loss so a failed close cannot
      // put it back, and say nothing: whoever asked for the teardown is the
      // one being answered.
      if (kind === "gone") lostWhileClosing.add(key);
      return;
    }
    // A fault KEEPS the slot: the listener may still be reachable and must
    // stay visible and retryable. Only a loss removes it.
    if (kind === "gone") slots.delete(key);
    opts.onLost({ forward: slot.forward, reason, kind });
  }

  /** Take ONE slot down, whoever asked. The single place a forward moves
   *  open → closing → gone, so `cancel` and `dispose` cannot each invent
   *  their own rules and race each other:
   *
   *   - a slot already `closing` is JOINED, never closed a second time;
   *   - the slot stays `closing` (invisible to `create` and `list`) until the
   *     mechanism answers;
   *   - success deletes it, identity-checked so a replacement is never erased;
   *   - failure restores it as `open` — the listener may still be out there,
   *     so it must stay visible and retryable — UNLESS a loss arrived meanwhile.
   *
   *  Returns the failure rather than throwing, because `dispose` needs every
   *  teardown attempted and `cancel` wants exactly one of them rethrown. */
  async function closeSlot(key: string): Promise<unknown | undefined> {
    const slot = slots.get(key);
    if (slot === undefined || slot.state === "opening") return undefined;
    // Someone is already taking it down; their outcome is the outcome — and it
    // is the REAL one, failure included.
    if (slot.state === "closing") return await slot.closing;

    // Install the transition BEFORE asking the mechanism to close, so a loss
    // that arrives synchronously from inside `close()` lands on a slot that is
    // already `closing` — otherwise it would delete the open slot and this
    // function would then overwrite the deletion.
    let settle: (outcome: unknown | undefined) => void = () => {};
    const closing = new Promise<unknown | undefined>((resolve) => {
      settle = resolve;
    });
    const mine: Slot = {
      state: "closing",
      forward: slot.forward,
      opened: slot.opened,
      token: slot.token,
      closing,
    };
    slots.set(key, mine);

    let failure: unknown | undefined;
    try {
      await slot.opened.close();
    } catch (err) {
      failure = err;
    }
    if (slots.get(key) === mine) {
      if (failure === undefined || lostWhileClosing.has(key)) {
        // Gone: either it closed, or the mechanism told us it was dead anyway —
        // a failed close must not resurrect a listener already reported lost.
        slots.delete(key);
      } else {
        // It may still be out there: visible and retryable.
        slots.set(key, {
          state: "open",
          forward: slot.forward,
          opened: slot.opened,
          token: slot.token,
        });
      }
    }
    lostWhileClosing.delete(key);

    // The outcome is the TEARDOWN FACT, not the close call's result: a failure
    // is reported if and ONLY if this key still holds the listener we failed to
    // close. Returning the raw rejection let `dispose` claim a forward could
    // not be torn down while its own map was empty — which happens whenever the
    // mechanism definitively reported the listener gone AND its close then
    // rejected, because the loss is the stronger fact and the slot is deleted.
    const now = slots.get(key);
    const survived =
      now !== undefined && now.state === "open" && now.token === slot.token;
    const outcome = survived ? failure : undefined;
    settle(outcome);
    return outcome;
  }

  /** Named, so the closing-slot branch can recurse WITHOUT `this`: these
   *  methods are handed around as plain functions (vazhi passes `create` into a
   *  component), and a receiver-dependent call would throw on that one rare
   *  branch and nowhere else. */
  async function create(target: ForwardTarget): Promise<Forward> {
    if (disposed) {
      throw new Error(
        "port-forward: this forward map has been disposed; it opens nothing further.",
      );
    }
    assertTarget(target);
    const key = targetKey(target);
    const slot = slots.get(key);
    // Two creates for the same target that overlap in time must produce ONE
    // listener, so the second joins the first's flight rather than opening
    // its own.
    if (slot?.state === "open") return slot.forward;
    if (slot?.state === "opening") {
      if (slot.cancelling !== undefined) {
        // This opening is already promised to a cancel. Joining its flight
        // would hand back the very forward that cancel is about to close — a
        // caller holding something neither listed nor live. Wait for the whole
        // teardown, then decide again: the key is either free (open a fresh
        // one) or still holds a forward whose close failed (return that).
        await slot.cancelling;
        return await create(target);
      }
      return await slot.flight;
    }
    if (slot?.state === "closing") {
      // Wait for the door to shut, then open a NEW one. Returning the closing
      // forward would resolve this create with a listener about to vanish.
      await slot.closing.catch(() => {});
      return await create(target);
    }

    // One identity per opening, minted BEFORE the mechanism can call back —
    // and before the slot exists, so the slot can carry it and a loss reported
    // during the open is attributable to exactly this attempt.
    const token = {};
    opening.add(token);
    const flight = (async () => {
      const opened = await opts.mechanisms.open(target, {
        // Sanitised HERE, at the seam, not in whichever mechanism happened to
        // remember: every reason is rendered verbatim by a consumer, and a
        // mechanism that reads a subprocess's stderr is carrying text the far
        // end chose. One mechanism's discipline is not a library guarantee.
        lost: (reason) => lose(key, plainDiagnostic(reason), token, "gone"),
        fault: (reason) =>
          lose(key, plainDiagnostic(reason), token, "degraded"),
      });

      // The mechanism may have called this listener DEAD before its own
      // `open()` resolved. Consult that first — before the disposed branch —
      // and clear the record on every path out, so a failed post-dispose close
      // cannot restore a listener already reported dead and no token record is
      // left behind.
      const early = reportedWhileOpening.get(token);
      reportedWhileOpening.delete(token);
      opening.delete(token);
      if (early !== undefined) {
        if (early.kind === "gone") {
          // The mechanism called it dead before it ever reached us. Publishing
          // it would put a corpse in the map; close it (best effort — it is
          // already gone) and fail loudly. Under a dispose there is nothing
          // left to report as un-torn-down, so it ends with the clean
          // mid-open signal: a dispose must not reject over an empty map.
          await opened.close().catch(() => {});
          throw disposed
            ? new DisposedMidOpenError()
            : new Error(
                `port-forward: the forward to ${key} was lost as it came up — ${early.reason}`,
              );
        }
        // Degraded: it broke, and the mechanism could not clean it up, so it
        // may still be reachable. Try once more here — if THAT close works it
        // really is gone and this create has nothing to hand back; if it fails
        // the listener is still out there and must be OWNED (visible in the
        // list, retryable by cancel) rather than dropped on the floor.
        // NB the outcome is recorded, not thrown from inside the `try` — a
        // throw there would be caught by this function's own `catch` and the
        // clean case would take the stranded-listener path (it did).
        let reallyGone = false;
        try {
          await opened.close();
          reallyGone = true;
        } catch {
          reallyGone = false;
        }
        if (reallyGone) {
          // Nothing to hand back. WHY says who is listening: a dispose is
          // owed its own clean signal (it asked for everything to go, and
          // everything went), while an ordinary create is owed the reason.
          throw disposed
            ? new DisposedMidOpenError()
            : new Error(
                `port-forward: the forward to ${key} broke as it came up — ${early.reason}`,
              );
        }
        // Still out there. It must be OWNED either way, but a dispose must
        // also LEARN that its teardown did not happen — a fulfilled flight
        // would let it report success over a listener it never closed.
        const forward: Forward = {
          key,
          target,
          localPort: opened.localPort,
          createdAt: Date.now(),
        };
        slots.set(key, { state: "open", forward, opened, token });
        if (disposed) {
          throw new SurvivedTeardownError(
            `port-forward: the forward to ${key} broke as it came up and could not be closed — ${early.reason}`,
            early.reason,
          );
        }
        opts.onLost({ forward, reason: early.reason, kind: "degraded" });
        return forward;
      }
      if (disposed) {
        // The map was torn down while this one was still opening. It exists
        // now, so it has to be closed now — otherwise `dispose` would have
        // returned while a listener it never saw was still coming up.
        const forward: Forward = {
          key,
          target,
          localPort: opened.localPort,
          createdAt: Date.now(),
        };
        try {
          await opened.close();
        } catch (err) {
          // It came up and refused to go down: exactly the listener dispose
          // exists to rule out, so it must be REPRESENTED — visible to
          // `list` and retryable by `cancel` — and named as the one failure
          // dispose counts.
          slots.set(key, { state: "open", forward, opened, token });
          throw new SurvivedTeardownError(
            `port-forward: the forward to ${key} could not be torn down — ${
              err instanceof Error ? err.message : String(err)
            }`,
            err,
          );
        }
        throw new DisposedMidOpenError();
      }
      const forward: Forward = {
        key,
        target,
        localPort: opened.localPort,
        createdAt: Date.now(),
      };
      slots.set(key, { state: "open", forward, opened, token });
      return forward;
    })();
    slots.set(key, { state: "opening", flight, token });
    try {
      return await flight;
    } catch (err) {
      // A failed flight normally leaves nothing behind — drop the slot THIS
      // call put there (identity-checked, so a replacement is never erased)
      // and let the next create try again. The exception is a flight that
      // opened a listener and then failed to CLOSE it during dispose: that
      // listener may still be live, so its slot stays (the SurvivedTeardownError
      // branch above).
      reportedWhileOpening.delete(token);
      opening.delete(token);
      const current = slots.get(key);
      if (current?.state === "opening" && current.flight === flight) {
        slots.delete(key);
      }
      throw err;
    }
  }

  return {
    create,

    async cancel(key) {
      const slot = slots.get(key);
      if (slot === undefined) {
        throw new Error(
          `port-forward: there is no forward named "${key}" to cancel.`,
        );
      }
      // Still opening is NOT "not there": the caller asked for a key the map
      // is demonstrably creating, so wait for it to arrive and then take it
      // down. A flight that fails on its own rejects here too — there is then
      // nothing left to close. The INTENT is recorded on the slot first, so a
      // create arriving in the meantime waits for this teardown instead of
      // joining a flight whose result is already committed to being closed.
      if (slot.state === "opening") {
        let finished: () => void = () => {};
        const cancelling = new Promise<void>((resolve) => {
          finished = resolve;
        });
        slots.set(key, { ...slot, cancelling });
        try {
          await slot.flight;
          const failure = await closeSlot(key);
          if (failure !== undefined) throw failure;
        } finally {
          finished();
        }
        return;
      }
      const failure = await closeSlot(key);
      if (failure !== undefined) throw failure;
    },

    list() {
      // `closing` is deliberately absent: it is on its way out and acting on
      // it (cancel, or a UI row) would be acting on something already going.
      // A teardown that FAILS puts its slot back to `open`, so a listener that
      // is still out there reappears here rather than being lost.
      const live: Forward[] = [];
      for (const slot of slots.values()) {
        if (slot.state === "open") live.push(slot.forward);
      }
      return live.sort((a, b) => a.createdAt - b.createdAt);
    },

    async dispose() {
      disposed = true;
      const failures: unknown[] = [];
      // WHICH slots this pass owns is decided BEFORE anything is awaited.
      // A flight that lands during the await can restore a slot whose teardown
      // it already attempted and already reported; closing that slot again
      // here would count one forward twice, or delete a forward this very call
      // is about to say could not be torn down.
      const mine: string[] = [];
      const flights: Promise<Forward>[] = [];
      for (const [key, slot] of slots.entries()) {
        if (slot.state === "opening") flights.push(slot.flight);
        else mine.push(key);
      }
      // The opening flights close themselves once they see `disposed`, and
      // until they have, "every forward is down" is not yet true. Their
      // outcomes are NOT discarded — a flight that rejects because its own
      // teardown failed is a listener that may still be live, which is exactly
      // what dispose exists to rule out. The deliberate "you lost the dispose
      // race" rejection is not a failure and says so by its type.
      for (const outcome of await Promise.allSettled(flights)) {
        // ONLY a listener that survived its teardown counts. A flight that
        // rejected because the mechanism could not open anything at all left
        // nothing behind, and reporting it here would have dispose claim a
        // forward remains when the map is empty.
        if (
          outcome.status === "rejected" &&
          outcome.reason instanceof SurvivedTeardownError
        ) {
          failures.push(outcome.reason);
        }
      }
      // Then the slots this pass owns, each through the ONE transition — so a
      // slot a concurrent `cancel` is closing is JOINED (and its real failure
      // observed) rather than closed twice.
      for (const key of mine) {
        const failure = await closeSlot(key);
        if (failure !== undefined) failures.push(failure);
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `port-forward: ${failures.length} forward(s) could not be torn down; they are still in the map.`,
        );
      }
    },
  };
}
