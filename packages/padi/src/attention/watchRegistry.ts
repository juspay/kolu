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

export type WatchEvent = PadiWatchEvent;

export const WATCH_BUFFER_LIMIT = 512;

export const WATCH_SUBSCRIPTION_LIMIT = 64;

export type WatchFeed =
  | {
      readonly source: "settle";
      buffer: PadiSettleEvent[];
    }
  | {
      readonly source: "state";
      readonly filter: StateWatchFilter;
      readonly counts: () =>
        | ReadonlyMap<TerminalId, StateWatchAnnounced>
        | undefined;
      readonly detach: () => void;
      buffer: PadiStateEvent[];
    };

export interface DropLedger {
  readonly pending: number;
  record(count: number): void;
  acknowledge(): void;
  handOver(): number;
}

function createDropLedger(): DropLedger {
  let pending = 0;
  let handedOver = 0;
  return {
    get pending() {
      return pending;
    },
    record: (count) => {
      pending += count;
    },
    acknowledge: () => {
      pending -= handedOver;
      handedOver = 0;
    },
    handOver: () => {
      handedOver = pending;
      return pending;
    },
  };
}

export interface WatchSubscription {
  readonly name: string;
  readonly scope: WatchScope;
  readonly feed: WatchFeed;
  acknowledged: number;
  readonly drops: DropLedger;
}

export interface WatchDrain {
  readonly events: readonly WatchEvent[];
  readonly dropped: number;
  readonly ackAfter: number;
}

export interface WatchOpened {
  readonly sub: WatchSubscription;
  readonly reattached: boolean;
}

export interface WatchRegistry {
  open(
    name: string,
    opts?: {
      scope?: WatchScope;
      filter?: StateWatchFilter;
    },
  ): WatchOpened;
  drain(name: string, after?: number): WatchDrain;
  onPulse(name: string, listener: () => void): () => void;
  close(name: string): void;
  acceptSettle(events: readonly SettleEvent[]): void;
  dispose(): void;
}

export function createWatchRegistry(opts: {
  log: Logger;
  limit?: number;
  subLimit?: number;
  daemonSeq: () => number;
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
  const pulseListeners = new Map<string, Set<() => void>>();

  const require_ = (name: string): WatchSubscription => {
    const sub = subs.get(name);
    if (sub === undefined) {
      throw new WatchSubscriptionNotFound({ name, known: [...subs.keys()] });
    }
    return sub;
  };

  const ring = (name: string): void => {
    const listeners = pulseListeners.get(name);
    if (listeners === undefined) return;
    for (const l of listeners) {
      try {
        l();
      } catch (err) {
        log.error({ err, name }, "padi: watch pulse listener threw");
      }
    }
  };

  const enqueue = <E extends WatchEvent>(
    sub: WatchSubscription,
    feed: { buffer: E[] },
    events: readonly E[],
  ): void => {
    const mine = events.filter(
      (e) => e.seq > sub.acknowledged && scopeAdmits(sub.scope, e.id),
    );
    if (mine.length === 0) return;
    feed.buffer.push(...mine);
    if (feed.buffer.length > limit) {
      const overflow = feed.buffer.length - limit;
      feed.buffer.splice(0, overflow);
      sub.drops.record(overflow);
    }
    ring(sub.name);
  };

  const makeFeed = (opened: {
    readonly filter: StateWatchFilter | undefined;
    readonly scope: WatchScope;
    readonly previous?: WatchFeed;
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

  const reattachFeed = (
    previous: WatchSubscription,
    next: {
      readonly scope: WatchScope;
      readonly filter: StateWatchFilter | undefined;
      readonly owner: () => WatchSubscription;
    },
  ): { feed: WatchFeed; start: () => void; requestioned: boolean } => {
    if (previous.feed.source === "state") previous.feed.detach();
    const had =
      previous.feed.source === "state" ? previous.feed.filter : undefined;
    const requestioned = !sameStateWatchFilter(had, next.filter);
    const carry = <E extends WatchEvent>(buffer: E[]): E[] =>
      requestioned ? [] : buffer.filter((e) => scopeAdmits(next.scope, e.id));
    const made = makeFeed({
      filter: next.filter,
      scope: next.scope,
      previous: previous.feed,
      carry,
      owner: next.owner,
    });
    return { ...made, requestioned };
  };

  return {
    open(name, { scope = WATCH_SCOPE_ALL, filter } = {}) {
      const existing = subs.get(name);
      if (existing !== undefined) {
        const { feed, start, requestioned } = reattachFeed(existing, {
          scope,
          filter,
          owner: () => next,
        });
        if (requestioned) {
          log.info(
            { name, hadFilter: existing.feed.source === "state" },
            "watch subscription re-opened with a different question — its queue is replaced by the new filter's snapshot",
          );
        }
        const next: WatchSubscription = {
          name: existing.name,
          scope,
          feed,
          acknowledged: existing.acknowledged,
          drops: existing.drops,
        };
        subs.set(name, next);
        start();
        return { sub: next, reattached: true };
      }
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
        acknowledged: daemonSeq(),
        drops: createDropLedger(),
      };
      subs.set(name, sub);
      start();
      return { sub, reattached: false };
    },

    acceptSettle(events) {
      for (const sub of subs.values()) {
        const feed = sub.feed;
        if (feed.source !== "settle") continue;
        enqueue(sub, feed, events);
      }
    },

    drain(name, after) {
      const sub = require_(name);
      const ceiling = daemonSeq();
      if (after !== undefined && after > ceiling) {
        log.warn(
          { name, after, daemonSeq: ceiling },
          "watch drain: acknowledgement is beyond anything this daemon has emitted (a cursor from a previous padi generation) — ignoring it; the queue is intact and will be re-delivered",
        );
        after = undefined;
      }
      if (after !== undefined && after > sub.acknowledged) {
        sub.acknowledged = after;
        const buffer: WatchEvent[] = sub.feed.buffer;
        const kept = buffer.filter((e) => e.seq > after);
        buffer.length = 0;
        buffer.push(...kept);
        sub.drops.acknowledge();
      }
      const events: readonly WatchEvent[] = [...sub.feed.buffer];
      const last = events.at(-1);
      return {
        events,
        dropped: sub.drops.handOver(),
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
        if (live.size === 0) pulseListeners.delete(name);
      };
    },

    close(name) {
      const sub = require_(name);
      if (sub.feed.source === "state") sub.feed.detach();
      subs.delete(name);
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
