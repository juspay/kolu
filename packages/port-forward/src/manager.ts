import type { ForwardMechanisms, OpenedForward } from "./mechanism.ts";
import { messageOf, plainDiagnostic } from "./diagnostic.ts";
import { assertTarget, type ForwardTarget, targetKey } from "./target.ts";

/** A live forward, as callers see it.
 *
 *  `M` is whatever the consumer attached at `create` — see {@link Forward.meta}.
 *  It defaults to `undefined` for a consumer that attaches nothing, so
 *  `Forward` on its own still means what it always did. */
export interface Forward<M = undefined> {
  /** `host:port` for a remote target, `local:port` for a loopback relay — the
   *  map key, and the handle `cancel` takes. */
  readonly key: string;
  readonly target: ForwardTarget;
  /** The port it answers on, on every interface of THIS machine. */
  readonly localPort: number;
  /** Epoch ms when the listener came up — what an "up 12m" column renders. */
  readonly createdAt: number;
  /** Whatever the consumer attached at `create`. The map never reads it and has
   *  no opinion about it — it keeps it for exactly as long as it keeps the
   *  forward, which is the whole point.
   *
   *  It exists because the alternative is a consumer holding a second map keyed
   *  by the same keys, with its own eviction rules that must agree with this
   *  map's at every site that moves either. kolu had exactly that (a per-key
   *  `origins` table synchronised by hand at six places, with a defaulting read
   *  to survive the times they disagreed). One entry, one lifetime. */
  readonly meta: M;
}

type MetaArg<M> = undefined extends M ? [meta?: M] : [meta: M];

export class DisposedMidOpenError extends Error {
  constructor() {
    super(
      "port-forward: the forward map was disposed while this forward was opening; it has been closed.",
    );
    this.name = "DisposedMidOpenError";
  }
}

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
export interface ForwardLoss<M = undefined> {
  readonly forward: Forward<M>;
  readonly reason: string;
  readonly kind: "gone" | "degraded";
}

export interface ForwardManager<M = undefined> {
  /** Open a forward for `target`, or return the live one if there already is
   *  one. Rejects — with the mechanism's own error text — if it can't.
   *
   *  An idempotent hit KEEPS the meta the live forward already carries: the
   *  second caller did not open this door and does not get to relabel it by
   *  accident. Relabelling on purpose is {@link ForwardManager.promote}. */
  create(target: ForwardTarget, ...meta: MetaArg<M>): Promise<Forward<M>>;
  /** Replace a live forward's meta, and hand back the updated record. Throws on
   *  a key the map does not hold OPEN, for `cancel`'s reason: it means the
   *  caller's view of the map disagrees with the map. */
  promote(key: string, meta: M): Forward<M>;
  /** Take down the forward with this key. Rejects if there is no such key. */
  cancel(key: string): Promise<void>;
  /** Every live forward, oldest first. OPEN slots only — a forward that is
   *  still opening has no record to hand out yet. */
  list(): readonly Forward<M>[];
  /** Every target the map currently HOLDS, in any state — open, opening, or
   *  closing.
   *
   *  `list` cannot answer this: it deliberately returns only what is open, so a
   *  caller taking down a whole class of forwards (a host leaving the pool)
   *  could not see a door still in flight, and the flight then landed as a live
   *  listener nothing was left to cancel. `cancel` has always handled an
   *  opening slot correctly — the gap was purely that nothing could enumerate
   *  one. */
  targets(): readonly ForwardTarget[];
  /** Take every forward down. Rejects with an `AggregateError` if any refused
   *  to go, having still attempted all of them. */
  dispose(): Promise<void>;
}

type Slot<M> =
  | {
      readonly state: "opening";
      readonly target: ForwardTarget;
      readonly flight: Promise<Forward<M>>;
      readonly token: object;
      readonly cancelling?: Promise<void>;
    }
  | {
      readonly state: "open";
      readonly forward: Forward<M>;
      readonly opened: OpenedForward;
      readonly token: object;
    }
  | {
      readonly state: "closing";
      readonly forward: Forward<M>;
      readonly opened: OpenedForward;
      readonly closing: Promise<TeardownOutcome>;
      readonly token: object;
    };

type TeardownOutcome =
  | { readonly survived: true; readonly failure: unknown }
  | { readonly survived: false };

const RECENT_PORT_CAP = 512;

function recentPortMemory(cap: number): {
  recall: (key: string) => number | undefined;
  remember: (key: string, port: number) => void;
} {
  const ports = new Map<string, number>();
  return {
    recall: (key) => ports.get(key),
    remember: (key, port) => {
      ports.set(key, port);
      if (ports.size > cap) {
        const oldest = ports.keys().next().value;
        if (oldest !== undefined) ports.delete(oldest);
      }
    },
  };
}

/** Build a forward map over the given mechanisms. Production callers want
 *  `createForwardManager` from the package index, which supplies the real ones;
 *  this entry point exists so the map can be driven against fakes. */
export function makeForwardManager<M = undefined>(opts: {
  mechanisms: ForwardMechanisms;
  onLost: (loss: ForwardLoss<M>) => void;
}): ForwardManager<M> {
  const slots = new Map<string, Slot<M>>();

  function announce(loss: ForwardLoss<M>): void {
    try {
      opts.onLost(loss);
    } catch (err) {
      queueMicrotask(() => {
        throw err;
      });
    }
  }
  let disposed = false;

  const lostWhileClosing = new Set<string>();

  const reportedWhileOpening = new Map<
    object,
    { reason: string; kind: "gone" | "degraded" }
  >();

  const opening = new Set<object>();

  const recentPorts = recentPortMemory(RECENT_PORT_CAP);

  function lose(
    key: string,
    reason: string,
    token: object,
    kind: "gone" | "degraded",
  ): void {
    const slot = slots.get(key);
    if (slot === undefined || slot.state === "opening") {
      if (opening.has(token)) reportedWhileOpening.set(token, { reason, kind });
      return;
    }
    if (slot.token !== token) return;
    if (slot.state === "closing") {
      if (kind === "gone") lostWhileClosing.add(key);
      return;
    }
    if (kind === "gone") slots.delete(key);
    announce({ forward: slot.forward, reason, kind });
  }

  async function closeSlot(key: string): Promise<TeardownOutcome> {
    const slot = slots.get(key);
    if (slot === undefined || slot.state === "opening") {
      return { survived: false };
    }
    if (slot.state === "closing") return await slot.closing;

    let settle: (outcome: TeardownOutcome) => void = () => {};
    const closing = new Promise<TeardownOutcome>((resolve) => {
      settle = resolve;
    });
    const mine: Slot<M> = {
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
        slots.delete(key);
      } else {
        slots.set(key, {
          state: "open",
          forward: slot.forward,
          opened: slot.opened,
          token: slot.token,
        });
      }
    }
    lostWhileClosing.delete(key);

    const now = slots.get(key);
    const survived =
      now !== undefined && now.state === "open" && now.token === slot.token;
    const outcome: TeardownOutcome =
      survived && failure !== undefined
        ? { survived: true, failure }
        : { survived: false };
    settle(outcome);
    return outcome;
  }

  async function create(
    target: ForwardTarget,
    ...meta: MetaArg<M>
  ): Promise<Forward<M>> {
    if (disposed) {
      throw new Error(
        "port-forward: this forward map has been disposed; it opens nothing further.",
      );
    }
    assertTarget(target);
    const key = targetKey(target);
    const slot = slots.get(key);
    if (slot?.state === "open") return slot.forward;
    if (slot?.state === "opening") {
      if (slot.cancelling !== undefined) {
        await slot.cancelling;
        return await create(target, ...meta);
      }
      return await slot.flight;
    }
    if (slot?.state === "closing") {
      await slot.closing;
      return await create(target, ...meta);
    }

    const token = {};
    opening.add(token);
    const flight = (async () => {
      const opened = await opts.mechanisms.open({
        target,
        report: {
          lost: (reason) => lose(key, plainDiagnostic(reason), token, "gone"),
          fault: (reason) =>
            lose(key, plainDiagnostic(reason), token, "degraded"),
        },
        lastLocalPort: recentPorts.recall(key),
      });
      recentPorts.remember(key, opened.localPort);

      const record = (): Forward<M> => ({
        key,
        target,
        localPort: opened.localPort,
        createdAt: Date.now(),
        meta: meta[0] as M,
      });

      const early = reportedWhileOpening.get(token);
      reportedWhileOpening.delete(token);
      opening.delete(token);
      if (early !== undefined) {
        if (early.kind === "gone") {
          await opened.close().catch(() => {});
          throw disposed
            ? new DisposedMidOpenError()
            : new Error(
                `port-forward: the forward to ${key} was lost as it came up — ${early.reason}`,
              );
        }
        let reallyGone = false;
        try {
          await opened.close();
          reallyGone = true;
        } catch {
          reallyGone = false;
        }
        if (reallyGone) {
          throw disposed
            ? new DisposedMidOpenError()
            : new Error(
                `port-forward: the forward to ${key} broke as it came up — ${early.reason}`,
              );
        }
        const forward = record();
        slots.set(key, { state: "open", forward, opened, token });
        if (disposed) {
          throw new SurvivedTeardownError(
            `port-forward: the forward to ${key} broke as it came up and could not be closed — ${early.reason}`,
            early.reason,
          );
        }
        announce({ forward, reason: early.reason, kind: "degraded" });
        return forward;
      }
      if (disposed) {
        const forward = record();
        try {
          await opened.close();
        } catch (err) {
          slots.set(key, { state: "open", forward, opened, token });
          throw new SurvivedTeardownError(
            `port-forward: the forward to ${key} could not be torn down — ${messageOf(
              err,
            )}`,
            err,
          );
        }
        throw new DisposedMidOpenError();
      }
      const forward = record();
      slots.set(key, { state: "open", forward, opened, token });
      return forward;
    })();
    slots.set(key, { state: "opening", target, flight, token });
    try {
      return await flight;
    } catch (err) {
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

    promote(key, meta) {
      const slot = slots.get(key);
      if (slot === undefined || slot.state !== "open") {
        throw new Error(
          `port-forward: there is no live forward named "${key}" to relabel.`,
        );
      }
      const forward: Forward<M> = { ...slot.forward, meta };
      slots.set(key, { ...slot, forward });
      return forward;
    },

    async cancel(key) {
      const slot = slots.get(key);
      if (slot === undefined) {
        throw new Error(
          `port-forward: there is no forward named "${key}" to cancel.`,
        );
      }
      if (slot.state === "opening") {
        let finished: () => void = () => {};
        const cancelling = new Promise<void>((resolve) => {
          finished = resolve;
        });
        slots.set(key, { ...slot, cancelling });
        try {
          await slot.flight;
          const outcome = await closeSlot(key);
          if (outcome.survived) throw outcome.failure;
        } finally {
          finished();
        }
        return;
      }
      const outcome = await closeSlot(key);
      if (outcome.survived) throw outcome.failure;
    },

    list() {
      const live: Forward<M>[] = [];
      for (const slot of slots.values()) {
        if (slot.state === "open") live.push(slot.forward);
      }
      return live.sort((a, b) => a.createdAt - b.createdAt);
    },

    targets() {
      const held: ForwardTarget[] = [];
      for (const slot of slots.values()) {
        held.push(slot.state === "opening" ? slot.target : slot.forward.target);
      }
      return held;
    },

    async dispose() {
      disposed = true;
      const failures: unknown[] = [];
      const mine: string[] = [];
      const flights: Promise<Forward<M>>[] = [];
      for (const [key, slot] of slots.entries()) {
        if (slot.state === "opening") flights.push(slot.flight);
        else mine.push(key);
      }
      for (const outcome of await Promise.allSettled(flights)) {
        if (
          outcome.status === "rejected" &&
          outcome.reason instanceof SurvivedTeardownError
        ) {
          failures.push(outcome.reason);
        }
      }
      for (const outcome of await Promise.all(
        mine.map((key) => closeSlot(key)),
      )) {
        if (outcome.survived) failures.push(outcome.failure);
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
