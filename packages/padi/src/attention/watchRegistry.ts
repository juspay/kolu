/**
 * STANDING SUBSCRIPTIONS — named, buffered, daemon-lived settle-event queues.
 *
 * How an agent supervising several terminals hears about them, and deliberately
 * NOT another blocking per-terminal wait.
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
 * **TWO SOURCES, ONE QUEUE — chosen by the caller, never merged.** A
 * subscription that names an agent-state filter (`states`/`heldForMs`/`nagMs`)
 * is fed by the state watch: the currently-matching set on (re)open, a
 * transition when a state has held long enough, and a nag every interval it
 * keeps holding. One that names none is fed by the settle detector exactly as
 * before. The registry itself is a QUEUE and stays one — it buffers, it
 * acknowledges, it counts overflow, and it knows nothing about how either source
 * decides an event is due.
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

import type {
  PadiSettleEvent,
  PadiStateEvent,
  PadiWatchEvent,
} from "@kolu/padi-client/surface";
import { WatchSubscriptionNotFound } from "@kolu/padi-client/surface";
import {
  scopeAdmits,
  WATCH_SCOPE_ALL,
  type WatchScope,
} from "@kolu/padi-client/watchScope";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import type { SettleEvent } from "./settleEvents.ts";
import {
  type StateWatchAnnounced,
  type StateWatchAttachment,
  type StateWatchBatch,
  type StateWatchFilter,
  sameStateWatchFilter,
} from "./stateWatch.ts";

/** What a queue holds — either source's events, one `kind` vocabulary. */
export type WatchEvent = PadiWatchEvent;

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

/** What a subscription is FED BY, and the queue that source fills.
 *
 *  ONE SOURCE PER SUBSCRIPTION, spelled as a SUM rather than as three optionals
 *  whose presence has to agree. A filter, an attachment and a buffer's
 *  vocabulary are one fact, not three: with a filter the queue is fed by the
 *  state watch (snapshot · transition · nag), without one by the settle detector
 *  (asking · finished · gone). As a union the type carries what the prose used
 *  to promise — a settle feed cannot own a `detach`, a state feed cannot exist
 *  without one, and no buffer is ever typed as both vocabularies at once, so
 *  "which question was this" is answered by the record's shape and not
 *  re-derived at each reader. */
export type WatchFeed =
  | {
      readonly source: "settle";
      /** Events retained and not yet ACKNOWLEDGED — a drain hands these over but
       *  keeps them until a later drain's `after` covers them. */
      buffer: PadiSettleEvent[];
    }
  | {
      readonly source: "state";
      /** The agent-state filter this subscription was opened with. */
      readonly filter: StateWatchFilter;
      /** The episode budget this attachment built up — the SEED its successor
       *  opens with, so a re-attach can never re-arm a spent cap. */
      readonly counts: () =>
        | ReadonlyMap<TerminalId, StateWatchAnnounced>
        | undefined;
      /** Detach from the agent-state watch. Called on close AND on a re-open, so
       *  a re-scoped subscription can never be fed by two engines at once. */
      readonly detach: () => void;
      buffer: PadiStateEvent[];
    };

export interface WatchSubscription {
  readonly name: string;
  /** WHICH terminals this subscription reports. Applied to BOTH sources, so a
   *  mute on a settle watch and on a state watch is the same rule read through
   *  the same {@link scopeAdmits}. Built by `watchScopeOf` at the entry that
   *  owns the wording — a scope that can never match cannot arrive here. */
  readonly scope: WatchScope;
  /** The source this subscription is fed by, with its queue. Replaced whole on a
   *  re-open — never mutated into a different arm. */
  readonly feed: WatchFeed;
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
  readonly events: readonly WatchEvent[];
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
   *  different scope re-scopes it — the QUEUE included.
   *
   *  A `filter` opens (or RE-opens) this subscription on the agent-state watch,
   *  which answers the (re)open with the currently-matching set — so the buffer a
   *  reattaching supervisor drains leads with the standing truth rather than only
   *  with whatever changed while it was away. */
  open(
    name: string,
    opts?: {
      /** Defaults to the whole fleet, unmuted. Only `watchScopeOf` can make
       *  one, which is what keeps the never-match refusal at the entry that
       *  owns the sentence instead of restated here. */
      scope?: WatchScope;
      filter?: StateWatchFilter;
    },
  ): WatchOpened;
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
  /** The sink registered on the SETTLE-event source — one observed FRAME at a
   *  time, which is also one doorbell ring at a time. Named for the source it
   *  serves, because it is not the only door: a subscription fed by the state
   *  watch is filled by its own attachment, and the one-source-per-subscription
   *  rule is what the two names are for. */
  acceptSettle(events: readonly SettleEvent[]): void;
  dispose(): void;
}

export function createWatchRegistry(opts: {
  log: Logger;
  limit?: number;
  /** How many subscriptions may be open at once. */
  subLimit?: number;
  /** The daemon's CURRENT watch sequence. Two jobs, both needing the same
   *  fact: it is where a FRESH subscription starts acknowledged (so it reports
   *  what happens NEXT rather than replaying edges the supervisor already acted
   *  on), and it is the CEILING an acknowledgement is checked against. Injected
   *  rather than read from a module global, so the registry owns the whole of
   *  `open`'s answer and no caller has to reach past it.
   *
   *  REQUIRED. A registry built without it would read a ceiling of 0, warn that
   *  every honest acknowledgement is "a cursor from a previous padi generation",
   *  and discard it — silently, for the life of that registry. A construction
   *  defect is refused at construction rather than deferred to use. */
  daemonSeq: () => number;
  /** Attach a filtered subscription to the agent-state watch. Injected rather
   *  than reached for, so this module stays a QUEUE — it owns buffering,
   *  acknowledgement and overflow, and knows nothing about how a state is
   *  detected or debounced.
   *
   *  REQUIRED, for the reason above: a registry that can be built without a
   *  state watch is a registry whose first filtered `open` fails an hour into a
   *  daemon's life. A queue-only test passes a stub that throws — loudly, and at
   *  the moment the test asks for something it did not build. */
  subscribeStates: (
    filter: StateWatchFilter,
    scope: WatchScope,
    emit: (batch: StateWatchBatch) => void,
    seed?: ReadonlyMap<TerminalId, StateWatchAnnounced>,
  ) => StateWatchAttachment;
}): WatchRegistry {
  const { log } = opts;
  const limit = opts.limit ?? WATCH_BUFFER_LIMIT;
  const daemonSeq = opts.daemonSeq;
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

  /** Buffer one frame into ONE subscription's feed, and ring its doorbell. The
   *  whole of what a queue does with an event, spelled once: both sources reach
   *  it, so overflow accounting and the acknowledged-watermark gate cannot differ
   *  by which engine produced the batch.
   *
   *  Generic in the feed's OWN event type, so a settle batch can only ever be
   *  buffered into a settle feed — the invariant the union declares, checked
   *  here rather than promised in prose. */
  const enqueue = <E extends WatchEvent>(
    sub: WatchSubscription,
    feed: { buffer: E[] },
    events: readonly E[],
  ): void => {
    const mine = events.filter(
      (e) =>
        // Scope, and then the ACKNOWLEDGED WATERMARK. A fresh subscription
        // starts acknowledged at the daemon's current sequence and promises
        // to report "what happens NEXT" — so an event whose seq is at or
        // below that watermark is history it already declined, and letting
        // one into the buffer would make the promise false on its very first
        // drain. The window is real: `open` reads the watermark while a
        // settle frame may already be mid-flight to the sinks.
        e.seq > sub.acknowledged && scopeAdmits(sub.scope, e.id),
    );
    if (mine.length === 0) return;
    feed.buffer.push(...mine);
    if (feed.buffer.length > limit) {
      // Drop the OLDEST — a supervisor that fell behind wants the most recent
      // truth, and the count below is how it learns the tail is incomplete.
      const overflow = feed.buffer.length - limit;
      feed.buffer.splice(0, overflow);
      sub.dropped += overflow;
    }
    // ONE ring per frame, not one per event: the doorbell says "there is
    // something new", and the drain behind it is the authority on what.
    ring(sub.name);
  };

  /** A filtered subscription's FEED, plus the thunk that starts it.
   *
   *  Two steps, because the attachment's first act is the SNAPSHOT and the state
   *  watch delivers it SYNCHRONOUSLY: the feed (with its buffer) has to exist and
   *  the record has to be installed before the first batch arrives, or a
   *  supervisor that (re)opens would not find the standing truth in the queue it
   *  was just handed. What it does NOT do is hand a half-made record out — the
   *  feed is complete the moment it exists, `detach` included. */
  const makeFeed = (opened: {
    readonly filter: StateWatchFilter | undefined;
    readonly scope: WatchScope;
    /** The feed this one replaces, on a re-open. */
    readonly previous?: WatchFeed;
    /** What survives from `previous` — the caller's re-question and re-scope
     *  rule, applied to whichever arm's buffer this feed can actually inherit.
     *  A SOURCE change is by definition a re-question, so the arm tests below
     *  are what keep a settle buffer out of a state feed. */
    readonly carry?: <E extends WatchEvent>(buffer: E[]) => E[];
    readonly owner: () => WatchSubscription;
  }): { feed: WatchFeed; start: () => void } => {
    const { filter, scope, previous, carry, owner } = opened;
    if (filter === undefined) {
      const buffer =
        previous?.source === "settle" && carry !== undefined
          ? carry(previous.buffer)
          : [];
      return { feed: { source: "settle", buffer }, start: () => {} };
    }
    let attachment: StateWatchAttachment | undefined;
    const feed = {
      source: "state" as const,
      filter,
      // The budget lives until its successor reads it — `detach` frees the
      // stream, not the counts.
      counts: () => attachment?.counts,
      buffer:
        previous?.source === "state" && carry !== undefined
          ? carry(previous.buffer)
          : [],
      detach: () => attachment?.stop(),
    };
    return {
      feed,
      start: () => {
        // The scope goes to the state watch as the SUBSCRIPTION's, joined into a
        // spec by the composition root that owns both halves — not by this
        // module, which is a queue and has no business knowing what a spec is.
        //
        // The budget rides a RESTATEMENT of the question, never a NEW one — the
        // same gate the buffer above is carried through: the budget is the
        // accounting OF those answers, and a spent cap inherited into a
        // re-specified filter would silence the very reminders that filter
        // asked for.
        const budget =
          previous?.source === "state" &&
          sameStateWatchFilter(previous.filter, filter)
            ? previous.counts()
            : undefined;
        attachment = opts.subscribeStates(
          filter,
          scope,
          (batch) => enqueue(owner(), feed, batch),
          budget,
        );
      },
    };
  };

  return {
    open(name, { scope = WATCH_SCOPE_ALL, filter } = {}) {
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
        //
        // The FILTER is rebuilt from the incoming claim on the same terms, and
        // the old state-watch attachment is dropped before the new one is made —
        // a subscription fed by two engines would double-count every nag.
        //
        // A CHANGED filter EMPTIES the queue — the scope rule above, applied to
        // the other half of the question. A buffer holds ANSWERS: events the old
        // filter selected, in the old filter's vocabulary. Carrying them across
        // would hand a caller that has just declared itself an agent-state watch
        // a queue of `asking`/`finished`/`gone` — two vocabularies in one queue,
        // which this module promises never to do — or nags for a state it no
        // longer asks about. Nothing goes quiet: the new attachment's first act
        // is a SNAPSHOT of everything currently matching, which is the standing
        // truth those discarded answers were an aging approximation of.
        if (existing.feed.source === "state") existing.feed.detach();
        const had =
          existing.feed.source === "state" ? existing.feed.filter : undefined;
        const requestioned = !sameStateWatchFilter(had, filter);
        if (requestioned) {
          log.info(
            { name, hadFilter: had !== undefined },
            "watch subscription re-opened with a different question — its queue is replaced by the new filter's snapshot",
          );
        }
        /** What the new feed inherits: nothing when the question changed, and
         *  otherwise the answers still inside the new scope. */
        const carry = <E extends WatchEvent>(buffer: E[]): E[] =>
          requestioned ? [] : buffer.filter((e) => scopeAdmits(scope, e.id));
        const { feed, start } = makeFeed({
          filter,
          scope,
          previous: existing.feed,
          carry,
          owner: () => next,
        });
        const next: WatchSubscription = {
          name: existing.name,
          scope,
          feed,
          acknowledged: existing.acknowledged,
          dropped: existing.dropped,
          reportedDropped: existing.reportedDropped,
        };
        subs.set(name, next);
        // AFTER the record is installed: the attachment's snapshot lands in
        // `next.feed.buffer` through `enqueue`, so the queue a reattaching
        // supervisor drains leads with what is standing right now.
        start();
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
      const { feed, start } = makeFeed({
        filter,
        scope,
        owner: () => sub,
      });
      const sub: WatchSubscription = {
        name,
        scope,
        feed,
        // A FRESH subscription is acknowledged up to NOW, so it reports what
        // happens next rather than replaying edges the supervisor already acted
        // on. A re-attach (above) keeps the watermark it had, which is exactly
        // what preserves what it missed while away.
        acknowledged: daemonSeq(),
        dropped: 0,
        reportedDropped: 0,
      };
      subs.set(name, sub);
      // Strictly after the watermark above is seeded: the snapshot this mints
      // carries sequences ABOVE it, so a fresh subscription's very first drain
      // is the standing set rather than nothing.
      start();
      return { sub, reattached: false };
    },

    acceptSettle(events) {
      for (const sub of subs.values()) {
        // A subscription fed by the STATE watch asked a different question and is
        // answered by its own attachment. Letting the settle detector into its
        // queue as well would put two vocabularies in one buffer for a caller
        // that named only one of them — which is why the feed is a sum and this
        // is a narrowing rather than a re-derivation from a filter's presence.
        const feed = sub.feed;
        if (feed.source !== "settle") continue;
        enqueue(sub, feed, events);
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
        // In place, so the buffer keeps the identity its feed was opened with.
        const buffer: WatchEvent[] = sub.feed.buffer;
        const kept = buffer.filter((e) => e.seq > after);
        buffer.length = 0;
        buffer.push(...kept);
        // Only the drops the acknowledged batch actually REPORTED are covered by
        // it. Drops that accrued afterwards have never been told to anyone, and
        // zeroing the counter would erase them exactly as silently as the
        // truncation this module refuses to do.
        sub.dropped -= sub.reportedDropped;
        sub.reportedDropped = 0;
      }
      const events: readonly WatchEvent[] = [...sub.feed.buffer];
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
      const sub = require_(name);
      if (sub.feed.source === "state") sub.feed.detach();
      subs.delete(name);
      // Ring AFTER the delete: a consumer parked on this name's doorbell
      // re-drains, gets the declared "no such subscription", and learns it was
      // closed — rather than waiting out its timeout against a queue that no
      // longer exists.
      ring(name);
    },

    dispose() {
      for (const sub of subs.values()) {
        if (sub.feed.source === "state") sub.feed.detach();
      }
      subs.clear();
      pulseListeners.clear();
    },
  };
}
