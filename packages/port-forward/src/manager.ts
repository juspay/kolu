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
 *    the map disagrees with the map.
 *  - a forward that dies on its own (its ssh master went away, its listener
 *    failed) leaves the map and is reported via `onLost` — a dead forward must
 *    never keep rendering as live.
 */

import type { ForwardMechanisms, OpenedForward } from "./opened.ts";
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

interface Entry {
  readonly forward: Forward;
  readonly opened: OpenedForward;
}

/** Build a forward map over the given mechanisms. Production callers want
 *  `createForwardManager` from the package index, which supplies the real ones;
 *  this entry point exists so the map can be driven against fakes. */
export function makeForwardManager(opts: {
  mechanisms: ForwardMechanisms;
  onLost: (loss: ForwardLoss) => void;
}): ForwardManager {
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Forward>>();
  /** Set by `dispose`. A forward that was still opening when the map was
   *  disposed must not quietly become a live listener nobody is tracking —
   *  the whole point of dispose is that nothing survives it. */
  let disposed = false;

  function lose(key: string, reason: string): void {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entries.delete(key);
    opts.onLost({ forward: entry.forward, reason });
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
      const live = entries.get(key);
      if (live !== undefined) return live.forward;
      // Two creates for the same target that overlap in time must produce ONE
      // listener, so the second joins the first's flight rather than opening
      // its own.
      const inflight = pending.get(key);
      if (inflight !== undefined) return await inflight;

      const flight = (async () => {
        const opened = await opts.mechanisms.open(target, (reason) =>
          lose(key, reason),
        );
        if (disposed) {
          // The map was torn down while this one was still opening. It exists
          // now, so it has to be closed now — otherwise `dispose` would have
          // returned while a listener it never saw was still coming up.
          await opened.close();
          throw new Error(
            "port-forward: the forward map was disposed while this forward was opening; it has been closed.",
          );
        }
        const forward: Forward = {
          key,
          target,
          localPort: opened.localPort,
          createdAt: Date.now(),
        };
        entries.set(key, { forward, opened });
        return forward;
      })();
      pending.set(key, flight);
      try {
        return await flight;
      } finally {
        pending.delete(key);
      }
    },

    async cancel(key) {
      const entry = entries.get(key);
      if (entry === undefined) {
        throw new Error(
          `port-forward: there is no forward named "${key}" to cancel.`,
        );
      }
      // Drop it from the map first: the caller asked for it to be gone, so it
      // must not linger in the list if the teardown itself reports trouble —
      // that trouble surfaces as this rejection instead.
      entries.delete(key);
      await entry.opened.close();
    },

    list() {
      return [...entries.values()]
        .map((entry) => entry.forward)
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    async dispose() {
      disposed = true;
      // Wait for anything still opening to settle first: those flights close
      // themselves once they see `disposed`, and until they have, "every
      // forward is down" is not yet true.
      await Promise.allSettled([...pending.values()]);
      const open = [...entries.values()];
      entries.clear();
      const failures: unknown[] = [];
      // Every forward gets its teardown attempted even if an earlier one
      // failed — a half-torn-down map is the one outcome worth avoiding.
      for (const entry of open) {
        try {
          await entry.opened.close();
        } catch (err) {
          failures.push(err);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `port-forward: ${failures.length} of ${open.length} forwards could not be torn down.`,
        );
      }
    },
  };
}
