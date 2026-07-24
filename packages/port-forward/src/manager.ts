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
 *  its promise, not a teardown failure. `dispose` tells the two apart by this
 *  type — a flight that rejects for any OTHER reason means a teardown it
 *  ordered did not happen. */
export class DisposedMidOpenError extends Error {
  constructor() {
    super(
      "port-forward: the forward map was disposed while this forward was opening; it has been closed.",
    );
    this.name = "DisposedMidOpenError";
  }
}

function isDisposedMidOpen(reason: unknown): boolean {
  return reason instanceof DisposedMidOpenError;
}

/** A forward that went away on its own, and why. */
export interface ForwardLoss {
  readonly forward: Forward;
  readonly reason: string;
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
  | { readonly state: "opening"; readonly flight: Promise<Forward> }
  | {
      readonly state: "open";
      readonly forward: Forward;
      readonly opened: OpenedForward;
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

  function lose(key: string, reason: string): void {
    const slot = slots.get(key);
    if (slot?.state !== "open") return;
    slots.delete(key);
    opts.onLost({ forward: slot.forward, reason });
  }

  return {
    async create(target) {
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
      if (slot?.state === "opening") return await slot.flight;

      const flight = (async () => {
        const opened = await opts.mechanisms.open(target, (reason) =>
          lose(key, reason),
        );
        if (disposed) {
          // The map was torn down while this one was still opening. It exists
          // now, so it has to be closed now — otherwise `dispose` would have
          // returned while a listener it never saw was still coming up.
          await opened.close();
          throw new DisposedMidOpenError();
        }
        const forward: Forward = {
          key,
          target,
          localPort: opened.localPort,
          createdAt: Date.now(),
        };
        slots.set(key, { state: "open", forward, opened });
        return forward;
      })();
      slots.set(key, { state: "opening", flight });
      try {
        return await flight;
      } catch (err) {
        // A flight that failed leaves nothing behind: the slot is still the
        // one this call put there (a success would have replaced it), so drop
        // it and let the next create try again.
        const current = slots.get(key);
        if (current?.state === "opening" && current.flight === flight) {
          slots.delete(key);
        }
        throw err;
      }
    },

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
      // nothing left to close.
      if (slot.state === "opening") await slot.flight;
      const open = slots.get(key);
      if (open?.state !== "open") {
        throw new Error(
          `port-forward: there is no forward named "${key}" to cancel.`,
        );
      }
      // Delete only on SUCCESS. A rejecting `close` means the mechanism could
      // not take the listener down, so the listener may still be reachable —
      // forgetting it here would make `list` lie and leave nothing to retry.
      // The error surfaces either way; what differs is whether the map still
      // knows about a door that may still be open.
      await open.opened.close();
      slots.delete(key);
    },

    list() {
      const live: Forward[] = [];
      for (const slot of slots.values()) {
        if (slot.state === "open") live.push(slot.forward);
      }
      return live.sort((a, b) => a.createdAt - b.createdAt);
    },

    async dispose() {
      disposed = true;
      const failures: unknown[] = [];
      // Wait for anything still opening to settle first: those flights close
      // themselves once they see `disposed`, and until they have, "every
      // forward is down" is not yet true. Their outcomes are NOT discarded —
      // a flight that rejects because its own teardown failed is a listener
      // that may still be live, which is exactly what dispose exists to rule
      // out. The deliberate "you lost the dispose race" rejection is not a
      // failure and carries `disposedMidOpen` to say so.
      const flights: Promise<Forward>[] = [];
      for (const slot of slots.values()) {
        if (slot.state === "opening") flights.push(slot.flight);
      }
      for (const outcome of await Promise.allSettled(flights)) {
        if (
          outcome.status === "rejected" &&
          !isDisposedMidOpen(outcome.reason)
        ) {
          failures.push(outcome.reason);
        }
      }
      const open: Array<[string, OpenedForward]> = [];
      for (const [key, slot] of slots.entries()) {
        if (slot.state === "open") open.push([key, slot.opened]);
      }
      // Every forward gets its teardown attempted even if an earlier one
      // failed — a half-torn-down map is the one outcome worth avoiding. A
      // refused teardown keeps its slot, for the same reason `cancel` does.
      for (const [key, opened] of open) {
        try {
          await opened.close();
          slots.delete(key);
        } catch (err) {
          failures.push(err);
        }
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
