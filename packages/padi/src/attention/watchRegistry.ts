/**
 * STANDING SUBSCRIPTIONS — named, buffered, daemon-lived settle-event queues.
 *
 * The supervision edge (`supervisionDelivery.ts`) covers a supervisor that IS a
 * kolu terminal. A supervisor that is only an MCP client — a coding agent talking
 * to `kolu mcp` over stdio — has no terminal and no mailbox, so the edge cannot
 * reach it. This is what it gets instead, and it is deliberately NOT another
 * blocking per-terminal wait.
 *
 * **Why a buffer is the whole point.** `wait_agentState` / `wait_outputSettled`
 * are EDGE-triggered on a live call: they observe only while the call is open, so
 * anything that happens between two waits is unobservable — which is exactly how a
 * worker's report reached nobody when its watcher had already returned and had not
 * been re-armed. A standing subscription is LEVEL-triggered with memory: events
 * accumulate against a cursor whether or not anyone is currently asking, so the
 * gap between drains stops being a hole. A supervisor can return an hour later and
 * still be told what it missed.
 *
 * **Why it lives in padi.** padi outlives both the `kolu mcp` process (one per
 * agent session, restarted whenever that agent restarts) and kaval (recycled by
 * supervision, or by the Restart-kaval button). A buffer in the MCP process would
 * die with the supervisor that needed it — the fourth seam of the incident this
 * came from. Named, so re-opening after ANY of those restarts reattaches to the
 * same queue by key rather than minting a fresh one that has forgotten everything.
 *
 * **Overflow is reported, never silent.** A queue that outgrows its cap drops its
 * OLDEST events and counts them; the count rides the next drain. A subscription
 * that silently truncated would read to its caller exactly like a quiet workspace,
 * which is the failure mode this whole feature exists to remove.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { WatchSubscriptionNotFound } from "../errors.ts";
import type { SettleEvent } from "./settleEvents.ts";

/** How many events one subscription retains before dropping its oldest. Sized
 *  for a supervisor that went away for a long time, not for a firehose: settle
 *  events are one-per-episode-per-terminal, so a workspace of 20 agents would have
 *  to turn over 25 times each before a drop is even possible. */
export const WATCH_BUFFER_LIMIT = 512;

export interface WatchSubscription {
  readonly name: string;
  /** The terminals this subscription cares about — `undefined` means every
   *  terminal on the host. An explicit list is refused when empty (a subscription
   *  that can never match is a caller bug, not a quiet no-op). */
  readonly ids?: ReadonlySet<TerminalId>;
  /** Events retained and not yet drained past. */
  buffer: SettleEvent[];
  /** The highest `seq` this subscription has handed out. */
  cursor: number;
  /** Events discarded to overflow since the last drain. */
  dropped: number;
  /** Monotonic doorbell counter — bumped whenever this subscription gains an
   *  event. The `watchPulse` stream publishes it so a consumer can tell a fresh
   *  ring from a re-delivered frame. */
  pulseSeq: number;
  /** Resolvers of drains currently parked on this subscription. */
  waiters: Set<() => void>;
}

export interface WatchDrain {
  readonly events: readonly SettleEvent[];
  /** Events lost to overflow before this drain — nonzero means the supervisor
   *  was away long enough to miss some, and should reconcile by reading the
   *  terminals collection rather than trusting the delta. */
  readonly dropped: number;
  /** The cursor after this drain — what a caller passes back to re-read. */
  readonly cursor: number;
}

export interface WatchRegistry {
  /** Open (or re-attach to) a named subscription. IDEMPOTENT by name: re-opening
   *  after an MCP restart returns the EXISTING queue with its buffer intact,
   *  which is what makes a supervisor's restart survivable. Re-opening with a
   *  different scope re-scopes it and says so. */
  open(name: string, ids?: readonly TerminalId[]): WatchSubscription;
  /** Take everything buffered past the cursor. Returns immediately when events
   *  are waiting; otherwise the caller parks (see `waitFor`). */
  drain(name: string): WatchDrain;
  /** Whether a named subscription has anything to hand over right now. */
  hasPending(name: string): boolean;
  /** Park until this subscription has an event, `signal` aborts, or `timeoutMs`
   *  elapses. Resolves `true` if events arrived. */
  waitFor(
    name: string,
    opts: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<boolean>;
  /** The doorbell counter for `name` — 0 when no such subscription exists yet.
   *  The `watchPulse` stream's frame. */
  pulseOf(name: string): number;
  /** Subscribe to a name's doorbell. Registered by NAME, not by subscription
   *  object, so the pulse stream may be opened before (or across a close/re-open
   *  of) the subscription it rings for. Returns an unsubscribe. */
  onPulse(name: string, listener: () => void): () => void;
  /** Drop a subscription and release anyone parked on it. */
  close(name: string): boolean;
  /** The sink registered on the settle-event source. */
  accept(event: SettleEvent): void;
  names(): string[];
  dispose(): void;
}

export function createWatchRegistry(
  opts: { limit?: number } = {},
): WatchRegistry {
  const limit = opts.limit ?? WATCH_BUFFER_LIMIT;
  const subs = new Map<string, WatchSubscription>();
  // Doorbell listeners, keyed by NAME rather than held on the subscription, so a
  // pulse stream opened first — or one that outlives a close/re-open — keeps
  // ringing for the name it was asked about.
  const pulseListeners = new Map<string, Set<() => void>>();

  const require_ = (name: string): WatchSubscription => {
    const sub = subs.get(name);
    if (sub === undefined) {
      // FAIL FAST. A drain against a name nobody opened is a caller bug — most
      // likely a typo, or a supervisor that assumed a subscription it never made.
      // Answering "no events" would look exactly like a quiet workspace and send
      // it back to sleep believing it was listening.
      throw new WatchSubscriptionNotFound({ name, known: [...subs.keys()] });
    }
    return sub;
  };

  const wake = (sub: WatchSubscription): void => {
    for (const w of sub.waiters) w();
    sub.waiters.clear();
  };

  /** Ring the doorbell for a subscription that just gained events: bump its
   *  counter, release parked drains, notify the pulse streams. */
  const ring = (sub: WatchSubscription): void => {
    sub.pulseSeq += 1;
    wake(sub);
    const listeners = pulseListeners.get(sub.name);
    if (listeners === undefined) return;
    for (const l of listeners) {
      // Contain a throwing pulse consumer — one broken stream must not stop the
      // others from being rung, nor escape into the settle-event fan-out.
      try {
        l();
      } catch (err) {
        console.error("padi: watch pulse listener threw", err);
      }
    }
  };

  return {
    open(name, ids) {
      if (ids !== undefined && ids.length === 0) {
        throw new Error(
          `standing subscription "${name}" was opened with an empty id list — it could never match anything. Omit the list to watch every terminal.`,
        );
      }
      const scope = ids === undefined ? undefined : new Set(ids);
      const existing = subs.get(name);
      if (existing !== undefined) {
        // Re-attach. The buffer and cursor SURVIVE — that is the whole reason
        // this is keyed by a caller-chosen name rather than by connection.
        const next: WatchSubscription = {
          ...existing,
          ...(scope === undefined ? {} : { ids: scope }),
        };
        // Re-opening with no scope WIDENS back to every terminal, which a spread
        // alone would not express (it would keep the old set).
        if (scope === undefined) delete (next as { ids?: unknown }).ids;
        subs.set(name, next);
        return next;
      }
      const sub: WatchSubscription = {
        name,
        ...(scope === undefined ? {} : { ids: scope }),
        buffer: [],
        cursor: 0,
        dropped: 0,
        pulseSeq: 0,
        waiters: new Set(),
      };
      subs.set(name, sub);
      return sub;
    },

    accept(event) {
      for (const sub of subs.values()) {
        if (sub.ids !== undefined && !sub.ids.has(event.id)) continue;
        sub.buffer.push(event);
        if (sub.buffer.length > limit) {
          // Drop the OLDEST — a supervisor that fell behind wants the most recent
          // truth, and the count below is how it learns the tail is incomplete.
          const overflow = sub.buffer.length - limit;
          sub.buffer.splice(0, overflow);
          sub.dropped += overflow;
        }
        ring(sub);
      }
    },

    drain(name) {
      const sub = require_(name);
      const events = sub.buffer;
      const dropped = sub.dropped;
      sub.buffer = [];
      sub.dropped = 0;
      const last = events.at(-1);
      if (last !== undefined) sub.cursor = last.seq;
      return { events, dropped, cursor: sub.cursor };
    },

    hasPending(name) {
      const sub = require_(name);
      return sub.buffer.length > 0 || sub.dropped > 0;
    },

    async waitFor(name, { timeoutMs, signal }) {
      const sub = require_(name);
      if (sub.buffer.length > 0 || sub.dropped > 0) return true;
      if (signal?.aborted === true) return false;
      return new Promise<boolean>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (had: boolean): void => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          sub.waiters.delete(waiter);
          signal?.removeEventListener("abort", onAbort);
          resolve(had);
        };
        const waiter = (): void => finish(true);
        const onAbort = (): void => finish(false);
        sub.waiters.add(waiter);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => finish(false), timeoutMs);
          // A parked drain must never hold the daemon open — the serve link does.
          timer.unref?.();
        }
      });
    },

    pulseOf(name) {
      return subs.get(name)?.pulseSeq ?? 0;
    },

    onPulse(name, listener) {
      let set = pulseListeners.get(name);
      if (set === undefined) {
        set = new Set();
        pulseListeners.set(name, set);
      }
      set.add(listener);
      return () => {
        const live = pulseListeners.get(name);
        if (live === undefined) return;
        live.delete(listener);
        // Drop the empty bucket so a daemon that has seen many short-lived
        // subscription names doesn't accumulate one entry per name forever.
        if (live.size === 0) pulseListeners.delete(name);
      };
    },

    close(name) {
      const sub = subs.get(name);
      if (sub === undefined) return false;
      // Release anyone parked so their call returns rather than hanging on a
      // subscription that no longer exists.
      wake(sub);
      subs.delete(name);
      return true;
    },

    names() {
      return [...subs.keys()].sort();
    },

    dispose() {
      for (const sub of subs.values()) wake(sub);
      subs.clear();
      pulseListeners.clear();
    },
  };
}
