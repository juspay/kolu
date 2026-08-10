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
 *
 * **A drain is ACKNOWLEDGED, not destructive.** `drain` retains what it hands
 * over until a LATER drain says it was received (`after` = the highest seq the
 * caller has actually processed). A destructive read looks fine until the reply
 * is lost — an MCP host's per-call timeout firing, the agent being interrupted,
 * the socket dropping between padi deleting the batch and the caller seeing it —
 * and then the events are gone from a queue whose entire purpose is that they
 * are not. At-least-once with an idempotent ack is the honest trade: a caller may
 * see a batch twice (each event carries a `seq` to dedupe on), and it can never
 * see one zero times.
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
  /** Events retained and not yet ACKNOWLEDGED — a drain hands these over but
   *  keeps them until a later drain's `after` covers them. */
  buffer: SettleEvent[];
  /** The highest `seq` the caller has acknowledged receiving. */
  cursor: number;
  /** Events discarded to overflow, and not yet reported on a drain. */
  dropped: number;
  /** Monotonic doorbell counter — bumped whenever this subscription gains an
   *  event. The `watchPulse` stream publishes it so a consumer can tell a fresh
   *  ring from a re-delivered frame. */
  pulseSeq: number;
}

export interface WatchDrain {
  readonly events: readonly SettleEvent[];
  /** Events lost to overflow before this drain — nonzero means the supervisor
   *  was away long enough to miss some, and should reconcile by reading the
   *  terminals collection rather than trusting the delta. */
  readonly dropped: number;
  /** The highest `seq` in this batch (or the standing cursor when empty). Pass it
   *  back as the NEXT drain's `after` to acknowledge — until you do, these events
   *  stay queued and will be handed over again. */
  readonly cursor: number;
}

export interface WatchOpened {
  readonly sub: WatchSubscription;
  /** True when this name already existed and its buffer was preserved. Answered
   *  by `open` itself rather than made the caller's business to ask first — the
   *  registry is the only thing that can know it without a race. */
  readonly reattached: boolean;
}

export interface WatchRegistry {
  /** Open (or re-attach to) a named subscription. IDEMPOTENT by name: re-opening
   *  after an MCP restart returns the EXISTING queue with its buffer intact,
   *  which is what makes a supervisor's restart survivable. Re-opening with a
   *  different scope re-scopes it. */
  open(name: string, ids?: readonly TerminalId[]): WatchOpened;
  /** Hand over everything buffered, ACKNOWLEDGING everything at or below `after`
   *  first. Never blocks — a caller that wants to wait parks on the doorbell
   *  (`onPulse`) and drains when it rings. */
  drain(name: string, after?: number): WatchDrain;
  /** The doorbell counter for `name` — 0 when no such subscription exists yet.
   *  The `watchPulse` stream's frame. */
  pulseOf(name: string): number;
  /** Subscribe to a name's doorbell. Registered by NAME, not by subscription
   *  object, so the pulse stream may be opened before (or across a close/re-open
   *  of) the subscription it rings for. Returns an unsubscribe. */
  onPulse(name: string, listener: () => void): () => void;
  /** Drop a subscription and its buffer. */
  close(name: string): boolean;
  /** The sink registered on the settle-event source. */
  accept(event: SettleEvent): void;
  dispose(): void;
}

export function createWatchRegistry(
  opts: {
    limit?: number;
    /** The sequence a FRESH subscription starts acknowledged at, so it reports
     *  what happens NEXT rather than replaying edges the supervisor already
     *  acted on. Injected rather than read from a module global, so the registry
     *  owns the whole of `open`'s answer and no caller has to reach past it. */
    initialCursor?: () => number;
  } = {},
): WatchRegistry {
  const limit = opts.limit ?? WATCH_BUFFER_LIMIT;
  const initialCursor = opts.initialCursor ?? (() => 0);
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

  /** Ring the doorbell for a subscription that just gained events: bump its
   *  counter and notify the pulse streams. */
  const ring = (sub: WatchSubscription): void => {
    sub.pulseSeq += 1;
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
        return { sub: next, reattached: true };
      }
      const sub: WatchSubscription = {
        name,
        ...(scope === undefined ? {} : { ids: scope }),
        buffer: [],
        // A FRESH subscription is acknowledged up to NOW, so it reports what
        // happens next rather than replaying edges the supervisor already acted
        // on. A re-attach (above) keeps the cursor it had, which is exactly what
        // preserves what it missed while away.
        cursor: initialCursor(),
        dropped: 0,
        pulseSeq: 0,
      };
      subs.set(name, sub);
      return { sub, reattached: false };
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

    drain(name, after) {
      const sub = require_(name);
      // ACKNOWLEDGE first. `after` is the highest seq the caller has actually
      // processed; everything at or below it is now safe to forget. Anything
      // above it stays — so a reply lost in flight (a host's call timeout, an
      // interrupted agent, a dropped socket) costs a repeat, never an event.
      if (after !== undefined && after > sub.cursor) {
        sub.cursor = after;
        sub.buffer = sub.buffer.filter((e) => e.seq > after);
        // The overflow report is acknowledged with the batch that carried it —
        // it describes a gap the caller has now been told about.
        sub.dropped = 0;
      }
      const events = [...sub.buffer];
      const last = events.at(-1);
      return {
        events,
        dropped: sub.dropped,
        // The high-water mark to acknowledge next time. With an empty buffer the
        // standing cursor is the honest answer — echoing it back is a no-op.
        cursor: last?.seq ?? sub.cursor,
      };
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
      // Ring first: a consumer parked on this name's doorbell re-drains, gets
      // the declared "no such subscription", and learns it was closed — rather
      // than waiting out its timeout against a queue that no longer exists.
      const sub = subs.get(name);
      if (sub === undefined) return false;
      subs.delete(name);
      ring(sub);
      return true;
    },

    dispose() {
      subs.clear();
      pulseListeners.clear();
    },
  };
}
