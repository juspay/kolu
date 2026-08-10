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
import type { Logger } from "pino";
import { WatchSubscriptionNotFound } from "../errors.ts";
import type { SettleEvent } from "./settleEvents.ts";

/** How many events one subscription retains before dropping its oldest. Sized
 *  for a supervisor that went away for a long time, not for a firehose: settle
 *  events are one-per-episode-per-terminal, so a workspace of 20 agents would have
 *  to turn over 25 times each before a drop is even possible. */
export const WATCH_BUFFER_LIMIT = 512;

/** How many subscriptions one daemon will hold at once.
 *
 *  The per-subscription buffer was capped from the start; the COLLECTION was
 *  not, and `watch.open` is reachable from any MCP client. A supervisor that
 *  derives a fresh name per call — a bug, a retry loop, or just many short-lived
 *  agents that never close — would otherwise leak one subscription per call for
 *  the daemon's lifetime. Generous: a real campaign runs a handful of named
 *  subscriptions, so hitting this means something is minting names, which is
 *  worth being told about rather than absorbing. */
export const WATCH_SUBSCRIPTION_LIMIT = 64;

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
  acknowledged: number;
  /** Events discarded to overflow, and not yet reported on a drain. */
  dropped: number;
  /** The slice of {@link dropped} that the LAST drain actually handed over — the
   *  only part an `after` can acknowledge. `after` acknowledges events at or
   *  below a SEQ, and a drop count has no seq; zeroing the whole counter under
   *  that same `after` would erase drops that accrued AFTER the reported batch,
   *  unreported. Those survive the ack and ride the next report. */
  reportedDropped: number;
}

export interface WatchDrain {
  readonly events: readonly SettleEvent[];
  /** Events lost to overflow before this drain — nonzero means the supervisor
   *  was away long enough to miss some, and should reconcile by reading the
   *  terminals collection rather than trusting the delta. */
  readonly dropped: number;
  /** Send this back VERBATIM as the NEXT drain's `after` to acknowledge — the
   *  highest `seq` in this batch, or the standing watermark when empty. Until
   *  you do, these events stay queued and will be handed over again. */
  readonly ackAfter: number;
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
   *  different scope re-scopes it — the QUEUE included. */
  open(name: string, ids?: readonly TerminalId[]): WatchOpened;
  /** Hand over everything buffered, ACKNOWLEDGING everything at or below `after`
   *  first. Never blocks — a caller that wants to wait parks on the doorbell
   *  (`onPulse`) and drains when it rings. */
  drain(name: string, after?: number): WatchDrain;
  /** Subscribe to a NAME's doorbell — the only half of the doorbell there is.
   *  Registered by name, not by subscription object, so the pulse stream may be
   *  opened before (or across a close/re-open of) the subscription it rings for.
   *  Returns an unsubscribe.
   *
   *  Deliberately tolerant of a name nobody opened: `awaitWatchEvents` subscribes
   *  BEFORE it drains (so an event landing between the two still rings a pulse it
   *  is already listening for), and the DRAIN is the authority that raises
   *  `WatchSubscriptionNotFound`. There is no counter to read here — the pulse
   *  stream mints its own per-subscription distinguisher (`pulseSource`), so a
   *  ring is always a fresh frame and "no such subscription" can never be spelled
   *  with the same number as "no events yet". */
  onPulse(name: string, listener: () => void): () => void;
  /** Drop a subscription and its buffer. RAISES {@link WatchSubscriptionNotFound}
   *  for a name nobody opened — the same fail-fast the drain takes, and for the
   *  same reason: a boolean `false` reads to an agent as "there was nothing to
   *  report", which is precisely the confusion the error class exists to end. */
  close(name: string): void;
  /** The sink registered on the settle-event source — one observed FRAME at a
   *  time, which is also one doorbell ring at a time. */
  accept(events: readonly SettleEvent[]): void;
  dispose(): void;
}

export function createWatchRegistry(opts: {
  log: Logger;
  limit?: number;
  /** How many subscriptions may be open at once. */
  subLimit?: number;
  /** The daemon's CURRENT settle sequence. Two jobs, both needing the same
   *  fact: it is where a FRESH subscription starts acknowledged (so it reports
   *  what happens NEXT rather than replaying edges the supervisor already acted
   *  on), and it is the CEILING an acknowledgement is checked against. Injected
   *  rather than read from a module global, so the registry owns the whole of
   *  `open`'s answer and no caller has to reach past it. */
  daemonSeq?: () => number;
}): WatchRegistry {
  const { log } = opts;
  const limit = opts.limit ?? WATCH_BUFFER_LIMIT;
  const daemonSeq = opts.daemonSeq ?? (() => 0);
  const subLimit = opts.subLimit ?? WATCH_SUBSCRIPTION_LIMIT;
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

  /** Ring a NAME's doorbell — once per observed frame, which is what a doorbell
   *  means. Keyed by name and never by record, so a CLOSE (whose record is
   *  already detached) rings exactly as loudly as an arrival. */
  const ring = (name: string): void => {
    const listeners = pulseListeners.get(name);
    if (listeners === undefined) return;
    for (const l of listeners) {
      // Contain a throwing pulse consumer — one broken stream must not stop the
      // others from being rung, nor escape into the settle-event fan-out.
      try {
        l();
      } catch (err) {
        log.error({ err, name }, "padi: watch pulse listener threw");
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
        // A re-attach REBUILDS the record from the incoming scope. What survives
        // is the QUEUE (buffer, watermark, drop accounting), which is the whole
        // reason this is keyed by a caller-chosen name rather than by connection.
        // Omitting `ids` when no scope is given is not a deletion but the ABSENCE
        // of a claim — re-opening with no scope widens back to every terminal
        // because nothing narrows it.
        //
        // A scope is a statement about the QUEUE, not only about future events:
        // narrowing filters what it just stopped caring about, or `ids` and
        // `buffer` describe two different subscriptions and the next drain hands
        // over events this caller has said it does not want.
        const next: WatchSubscription = {
          name: existing.name,
          ...(scope === undefined ? {} : { ids: scope }),
          buffer:
            scope === undefined
              ? existing.buffer
              : existing.buffer.filter((e) => scope.has(e.id)),
          acknowledged: existing.acknowledged,
          dropped: existing.dropped,
          reportedDropped: existing.reportedDropped,
        };
        subs.set(name, next);
        return { sub: next, reattached: true };
      }
      // A NEW name, so this is where the collection itself can grow. Refuse
      // rather than evict: evicting somebody else's queue to make room would
      // silently blind a supervisor that did nothing wrong, which is the one
      // outcome this module never trades for. Hitting the cap means something is
      // minting names instead of reusing one, and the error says so with the
      // names already open — the same "tell them what IS subscribed" answer the
      // not-found error gives.
      if (subs.size >= subLimit) {
        throw new Error(
          `cannot open standing subscription "${name}": ${subs.size} are already open (limit ${subLimit}). Subscriptions are meant to be REUSED by name across restarts, not minted per call — close the ones you are done with (open: ${[...subs.keys()].join(", ")}).`,
        );
      }
      const sub: WatchSubscription = {
        name,
        ...(scope === undefined ? {} : { ids: scope }),
        buffer: [],
        // A FRESH subscription is acknowledged up to NOW, so it reports what
        // happens next rather than replaying edges the supervisor already acted
        // on. A re-attach (above) keeps the watermark it had, which is exactly
        // what preserves what it missed while away.
        acknowledged: daemonSeq(),
        dropped: 0,
        reportedDropped: 0,
      };
      subs.set(name, sub);
      return { sub, reattached: false };
    },

    accept(events) {
      for (const sub of subs.values()) {
        const mine = events.filter(
          (e) =>
            // Scope, and then the ACKNOWLEDGED WATERMARK. A fresh subscription
            // starts acknowledged at the daemon's current sequence and promises
            // to report "what happens NEXT" — so an event whose seq is at or
            // below that watermark is history it already declined, and letting
            // one into the buffer would make the promise false on its very first
            // drain. The window is real: `open` reads the watermark while a
            // settle frame may already be mid-flight to the sinks.
            e.seq > sub.acknowledged &&
            (sub.ids === undefined || sub.ids.has(e.id)),
        );
        if (mine.length === 0) continue;
        sub.buffer.push(...mine);
        if (sub.buffer.length > limit) {
          // Drop the OLDEST — a supervisor that fell behind wants the most recent
          // truth, and the count below is how it learns the tail is incomplete.
          const overflow = sub.buffer.length - limit;
          sub.buffer.splice(0, overflow);
          sub.dropped += overflow;
        }
        // ONE ring per frame, not one per event: the doorbell says "there is
        // something new", and the drain behind it is the authority on what.
        ring(sub.name);
      }
    },

    drain(name, after) {
      const sub = require_(name);
      // A CURSOR FROM ANOTHER DAEMON GENERATION IS NOT AN ACKNOWLEDGEMENT.
      // `seq` restarts at 0 on every padi boot, while a supervisor is told to
      // keep passing back the `ackAfter` it last saw and is given no way to spot
      // a restart. So the ordinary recovery path — padi restarts, the drain
      // raises `WatchSubscriptionNotFound`, the agent re-opens and retries with
      // the cursor it remembers — hands us a number far above anything this
      // daemon has emitted. Taken as truth it would set a watermark no future
      // event can climb past, and `accept` would discard every settle for the
      // rest of the daemon's life: silent, permanent blindness, which is the
      // exact failure this module exists to remove.
      //
      // IGNORE it rather than clamp it. Clamping to the current sequence would
      // acknowledge events this caller has never seen; ignoring re-delivers at
      // worst, and re-delivery is already the contract (at-least-once, dedupe on
      // `seq`). Loud, because the caller's bookkeeping is genuinely desynced.
      const ceiling = daemonSeq();
      if (after !== undefined && after > ceiling) {
        log.warn(
          { name, after, daemonSeq: ceiling },
          "watch drain: acknowledgement is beyond anything this daemon has emitted (a cursor from a previous padi generation) — ignoring it; the queue is intact and will be re-delivered",
        );
        after = undefined;
      }
      // ACKNOWLEDGE. `after` is the highest seq the caller has actually
      // processed; everything at or below it is now safe to forget. Anything
      // above it stays — so a reply lost in flight (a host's call timeout, an
      // interrupted agent, a dropped socket) costs a repeat, never an event.
      if (after !== undefined && after > sub.acknowledged) {
        sub.acknowledged = after;
        sub.buffer = sub.buffer.filter((e) => e.seq > after);
        // Only the drops the acknowledged batch actually REPORTED are covered by
        // it. Drops that accrued afterwards have never been told to anyone, and
        // zeroing the counter would erase them exactly as silently as the
        // truncation this module refuses to do.
        sub.dropped -= sub.reportedDropped;
        sub.reportedDropped = 0;
      }
      const events = [...sub.buffer];
      const last = events.at(-1);
      // What THIS batch carries, so the next `after` acknowledges this much and
      // no more.
      sub.reportedDropped = sub.dropped;
      return {
        events,
        dropped: sub.dropped,
        // The high-water mark to acknowledge next time. With an empty buffer the
        // standing watermark is the honest answer — echoing it back is a no-op.
        ackAfter: last?.seq ?? sub.acknowledged,
      };
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
      require_(name);
      subs.delete(name);
      // Ring AFTER the delete: a consumer parked on this name's doorbell
      // re-drains, gets the declared "no such subscription", and learns it was
      // closed — rather than waiting out its timeout against a queue that no
      // longer exists.
      ring(name);
    },

    dispose() {
      subs.clear();
      pulseListeners.clear();
    },
  };
}
