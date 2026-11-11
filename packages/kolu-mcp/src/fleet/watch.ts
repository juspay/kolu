/**
 * The FLEET WATCH — one standing subscription over every host's queue.
 *
 * Per host, `watch_open` + `watch_next` is already the shape with no blind
 * spot: events accumulate in padi, which outlives this process, so the time
 * between two calls is not a hole. The fleet face keeps that property and adds
 * the one thing a supervisor of several machines cannot do for itself —
 * MERGING. An agent handed one subscription per host would have to open N,
 * remember N cursors, interleave N batches, and re-open whenever the fleet
 * changed shape; the point of one conversation over every host is that it does
 * not.
 *
 * ## The cursor is the FLEET's, not any host's
 *
 * Each padi numbers its own queue from its own counter, so two hosts' `seq`
 * values collide and neither orders the other. A merged feed therefore assigns
 * its OWN monotonic `seq` as it ingests, and `watch_next`'s `after` is that
 * number. The per-host cursors still exist — they are how a leg acknowledges
 * padi — but they are this module's bookkeeping and never reach the caller.
 *
 * The two levels acknowledge at different moments, deliberately: a leg
 * acknowledges padi the instant it INGESTS (so padi can forget), and the fleet
 * buffer holds the event until the CALLER acknowledges it. So the "a reply lost
 * in flight costs a repeat, not a report" guarantee survives the merge — it is
 * now this buffer's to keep rather than padi's.
 *
 * ## Hosts come and go while the watch is open
 *
 * - **Arriving** — a host that connects gets legged on the next reconcile,
 *   which happens on every `watch_next` AND the moment kolu-server's roster
 *   moves (the park wakes on `hosts.subscribe`). An agent blocked in
 *   `watch_next` sees a new machine's terminals without re-opening anything.
 * - **Leaving** — the terminals it was carrying emit `gone`, and then the leg
 *   drops. This is the same reasoning padi's own `gone` carries one level down:
 *   a supervisor waiting on a worker that no longer exists must be TOLD, because
 *   silence reads exactly like a calm workspace. A host going away takes every
 *   one of its workers with it, so the fleet owes that sentence for each.
 * - **"Watch all" fails open** — a subscription with no `ids` legs every
 *   connected host, now and later. That is the per-host rule ("a list you forget
 *   to update goes blind to a lane nobody added") lifted one level: a fleet list
 *   you forget to update goes blind to a MACHINE nobody added.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import {
  type PadiWatchEvent,
  type PadiWatchOpenInput,
  WatchSubscriptionNotFound,
} from "@kolu/padi-client/surface";
// STATIC, unlike the per-host `watch_next` tool's dynamic reach for the same
// kit: that tool's module rides the tree-build path of every `kolu` invocation
// (the surface face mounts the table), and this one does not — the fleet face
// is reachable only through the package barrel, which already pulls the MCP
// server classes and is itself behind kolu-cli's per-face dynamic-import fence.
import { awaitWatchEvents } from "@kolu/padi-client/watch";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import type { WaitOutcome } from "@kolu/surface/wait";
import { ToolFailure } from "@kolu/surface-mcp/tools";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import { connectedHosts, type FleetHosts, requireHost } from "./hosts.ts";
import { fleetTerminalRef } from "./ref.ts";

/** padi's event with its ids re-qualified — distributive over the union, so a
 *  settle event stays tellable from a state event by the same `kind` compare a
 *  consumer already writes. */
type AtFleetIds<E> = E extends unknown
  ? Omit<E, "id" | "parentId"> & {
      readonly id: string;
      readonly parentId?: string;
    }
  : never;
export type FleetWatchEvent = AtFleetIds<PadiWatchEvent>;

/** How deep ONE host's queue is (padi's `WATCH_BUFFER_LIMIT`). The fleet buffer
 *  is this times the number of legs: a merged queue must be able to hold what
 *  the queues it merges can hand over in one drain, or a two-host fleet would
 *  report drops the hosts never had. Over that, the OLDEST go and the count is
 *  reported — the same policy padi applies, because a silent truncation reads
 *  exactly like a quiet workspace. */
const PER_LEG_BUFFER_LIMIT = 512;

/** What a subscription watches. `all` is the fail-open default; `ids` names
 *  terminals, already grouped by the host that owns them — a host with no named
 *  terminal gets no leg at all, rather than an empty one that would watch
 *  everything. */
type FleetWatchScope =
  | { readonly kind: "all" }
  | {
      readonly kind: "ids";
      readonly byHost: ReadonlyMap<string, TerminalId[]>;
    };

/** One host's leg of a fleet subscription. */
interface WatchLeg {
  /** The highest per-host seq this face has INGESTED — what the next drain
   *  acknowledges to padi. */
  after: number;
  /** That host's terminals as last read — what `gone` is emitted FOR when the
   *  host leaves, since by then there is nobody left to ask. */
  roster: readonly TerminalId[];
}

/** One fleet subscription. `scope` and `opened` are MUTABLE because a re-open
 *  restates them on the live record rather than replacing it: a `watch_next`
 *  already parked holds this object, and handing the registry a copy would let
 *  the drain in flight and the next one disagree about what is being watched. */
interface FleetSubscription {
  readonly name: string;
  scope: FleetWatchScope;
  /** The per-host open input, minus the ids (which the scope holds) — so a leg
   *  opened on a host that arrives LATE is opened with the same knobs the first
   *  legs were. */
  opened: (host: string) => PadiWatchOpenInput;
  readonly legs: Map<string, WatchLeg>;
  buffer: FleetWatchEvent[];
  nextSeq: number;
  dropped: number;
}

/** Every fleet subscription one served face holds. Per SERVER, not per module:
 *  two faces in one process are two fleets, and a module-global registry would
 *  let one close the other's watch by name. */
export type FleetWatchRegistry = Map<string, FleetSubscription>;

export const newFleetWatchRegistry = (): FleetWatchRegistry => new Map();

/** The current terminal ids of one host — the roster a departure is reported
 *  from. A failure to read is not fatal: the leg keeps the roster it had, which
 *  is strictly better than forgetting who was there. */
async function readRoster(
  padi: PadiSurfaceClient,
): Promise<readonly TerminalId[]> {
  return Effect.runPromise(
    Effect.catchCause(
      firstFrameOrThrow(
        padi.surface.terminals.keys(undefined),
        "fleet watch: a host's terminal keys yielded no snapshot frame.",
      ),
      () => Effect.succeed([] as readonly TerminalId[]),
    ),
  );
}

/** Open (or re-attach) one host's leg. */
async function openLeg(
  sub: FleetSubscription,
  host: string,
  padi: PadiSurfaceClient,
): Promise<void> {
  const opened = await Effect.runPromise(
    padi.surface.watch.open(sub.opened(host)),
  );
  sub.legs.set(host, {
    after: opened.acknowledged,
    roster: await readRoster(padi),
  });
}

/** Which hosts this subscription WANTS a leg on right now — connected, and
 *  (when the scope names ids) carrying at least one of them. */
function wanted(hosts: FleetHosts, sub: FleetSubscription): readonly string[] {
  const live = connectedHosts(hosts);
  const scope = sub.scope;
  return scope.kind === "all"
    ? live
    : live.filter((host) => scope.byHost.has(host));
}

/** Append events, dropping the oldest past the cap. */
function push(
  sub: FleetSubscription,
  events: readonly FleetWatchEvent[],
): void {
  for (const event of events) sub.buffer.push(event);
  const cap = PER_LEG_BUFFER_LIMIT * Math.max(1, sub.legs.size);
  if (sub.buffer.length > cap) {
    const over = sub.buffer.length - cap;
    sub.buffer.splice(0, over);
    sub.dropped += over;
  }
}

/** The next FLEET seq. Two hosts number their own queues from their own
 *  counters, so the only cursor a merged feed can hand a caller is one it
 *  assigns itself — this is where that happens, and nowhere else. */
function stamp(sub: FleetSubscription): number {
  sub.nextSeq += 1;
  return sub.nextSeq;
}

/** Bring the legs in line with the live fleet: leg the hosts that arrived, say
 *  `gone` for the terminals of the hosts that left, and refresh what each
 *  surviving host was carrying. */
async function reconcile(
  hosts: FleetHosts,
  sub: FleetSubscription,
): Promise<void> {
  const want = new Set(wanted(hosts, sub));
  for (const [host, leg] of [...sub.legs]) {
    if (want.has(host)) continue;
    const at = Date.now();
    push(
      sub,
      leg.roster.map((id) => ({
        seq: stamp(sub),
        id: fleetTerminalRef(host, id),
        kind: "gone" as const,
        at,
      })),
    );
    sub.legs.delete(host);
  }
  for (const host of want) {
    if (sub.legs.has(host)) continue;
    const padi = hosts.padi(host);
    if (padi !== null) await openLeg(sub, host, padi);
  }
  // Every surviving leg's roster is refreshed here, not at ingest: a terminal
  // CREATED since the last call emits no settle event of its own, so a roster
  // refreshed only by events would forget it — and forget to mourn it when its
  // host leaves.
  for (const [host, leg] of sub.legs) {
    const padi = hosts.padi(host);
    if (padi !== null) leg.roster = await readRoster(padi);
  }
}

/** Ingest one leg's drained batch. */
function ingest(
  sub: FleetSubscription,
  host: string,
  met: {
    readonly events: readonly PadiWatchEvent[];
    readonly dropped: number;
    readonly ackAfter: number;
  },
): void {
  push(
    sub,
    met.events.map(
      (event) =>
        ({
          ...event,
          seq: stamp(sub),
          id: fleetTerminalRef(host, event.id),
          ...(event.parentId === undefined
            ? {}
            : { parentId: fleetTerminalRef(host, event.parentId) }),
        }) as FleetWatchEvent,
    ),
  );
  sub.dropped += met.dropped;
  const leg = sub.legs.get(host);
  if (leg !== undefined) leg.after = met.ackAfter;
}

/** Drain EVERY leg, in roster order, into the fleet buffer.
 *
 *  A drain acknowledges only what this face has already ingested
 *  (`leg.after`), so a leg with nothing new answers an empty batch and a leg
 *  whose events a parked wait already saw hands them over again — which is what
 *  makes it safe for the park above to be a doorbell rather than a consumer. */
async function drainLegs(
  hosts: FleetHosts,
  sub: FleetSubscription,
): Promise<void> {
  for (const [host, leg] of sub.legs) {
    const padi = hosts.padi(host);
    if (padi === null) continue;
    const drained = await Effect.runPromise(
      padi.surface.watch.drain({ name: sub.name, after: leg.after }),
    );
    if (drained.events.length === 0 && drained.dropped === 0) continue;
    ingest(sub, host, drained);
  }
}

/** What a fleet drain hands back on a `met` — the same payload the per-host
 *  tool's outcome carries, so `waitOutcomeJson` frames both identically and an
 *  agent reads one shape whichever face it is on. */
export interface FleetWatchMet {
  readonly events: readonly FleetWatchEvent[];
  readonly dropped: number;
  readonly ackAfter: number;
  readonly elapsedMs: number;
}

export type FleetWatchOutcome = WaitOutcome<FleetWatchMet>;

/** THE merged drain: acknowledge, reconcile, answer what is buffered, else park
 *  until any host rings — or the fleet changes shape, or the clock runs out. */
export async function fleetWatchNext(
  hosts: FleetHosts,
  registry: FleetWatchRegistry,
  opts: {
    readonly name: string;
    readonly after?: number | undefined;
    readonly timeoutMs?: number | undefined;
    readonly signal: AbortSignal;
  },
): Promise<FleetWatchOutcome> {
  const started = Date.now();
  const sub = registry.get(opts.name);
  if (sub === undefined) {
    throw new ToolFailure(
      `no fleet watch named ${JSON.stringify(opts.name)} is open — open one with watch_open (the same name reattaches to its queue). A fleet watch lives in this kolu-server process, so a restart of it clears every subscription.`,
      { kind: "no-such-watch", name: opts.name },
    );
  }
  // The acknowledgement, before anything else: everything at or below `after`
  // is forgotten, everything above comes again. Until the caller says a number,
  // nothing leaves this buffer.
  if (opts.after !== undefined) {
    const after = opts.after;
    sub.buffer = sub.buffer.filter((event) => event.seq > after);
  }
  const elapsed = (): number => Date.now() - started;
  const answer = (): FleetWatchOutcome => {
    const events = [...sub.buffer];
    const dropped = sub.dropped;
    sub.dropped = 0;
    return {
      kind: "met",
      events,
      dropped,
      // The watermark of what is HELD, so echoing it back acknowledges exactly
      // this batch. An empty batch echoes the standing watermark (a no-op).
      ackAfter:
        events.length === 0 ? sub.nextSeq : events[events.length - 1]!.seq,
      elapsedMs: elapsed(),
    };
  };

  for (;;) {
    await reconcile(hosts, sub);
    if (sub.buffer.length > 0) return answer();
    if (opts.signal.aborted) return { kind: "interrupted" };
    const left =
      opts.timeoutMs === undefined ? undefined : opts.timeoutMs - elapsed();
    if (left !== undefined && left <= 0) {
      return { kind: "timeout", elapsedMs: elapsed() };
    }

    // ONE park, and it is only a DOORBELL: every leg's wait, the roster's own
    // move, and the clock. Whichever rings, the INGEST below drains every leg
    // itself.
    //
    // Draining in the park would make the batch depend on which host answered
    // first: `Promise.race` settles on one, the losers are aborted, and an
    // aborted wait acknowledges nothing — so a second host whose events were
    // already queued would be left out of a batch it belonged in and only
    // appear on the NEXT call. An agent reading that batch sees one machine
    // asking and concludes the other is quiet. A drain acknowledges only what
    // the CALLER acknowledged, so re-draining the winner costs a round trip and
    // loses nothing.
    const park = new AbortController();
    const stop = (): void => {
      park.abort();
    };
    const offRoster = hosts.subscribe(stop);
    opts.signal.addEventListener("abort", stop, { once: true });
    const timer = left === undefined ? undefined : setTimeout(stop, left);
    try {
      const bells = [...sub.legs].flatMap(([host, leg]) => {
        const padi = hosts.padi(host);
        return padi === null
          ? []
          : [
              awaitWatchEvents(padi, {
                name: sub.name,
                after: leg.after,
                signal: park.signal,
              }),
            ];
      });
      if (bells.length === 0) {
        // A fleet with no legs still waits — on the roster moving or the clock,
        // which is exactly what a fleet whose last host is warming should do
        // rather than answering "nothing is happening" instantly, forever.
        const parked = Promise.withResolvers<void>();
        park.signal.addEventListener("abort", () => {
          parked.resolve();
        });
        await parked.promise;
      } else {
        await Promise.race(bells);
        park.abort();
        await Promise.allSettled(bells);
      }
    } finally {
      offRoster();
      opts.signal.removeEventListener("abort", stop);
      clearTimeout(timer);
    }
    // In LEG order — the roster's order, local first — so the fleet seq a
    // caller acknowledges is assigned by a rule, not by which machine's packet
    // arrived first.
    await drainLegs(hosts, sub);
  }
}

/** Open (or re-attach to) a fleet subscription. The per-host inputs are the
 *  caller's own, already resolved by the per-host face's pure half — this only
 *  decides WHICH hosts get a leg.
 *
 *  A subscription that NAMES terminals is checked host by host first: an id on
 *  a host that is not connected is refused BY NAME, rather than quietly
 *  producing a watch that is blind to exactly the lane the caller asked about.
 *  A subscription that names none ("watch all") legs whatever is connected and
 *  picks up the rest as they arrive — there is nothing to refuse, because the
 *  caller named no host. */
export function fleetWatchOpen(
  hosts: FleetHosts,
  registry: FleetWatchRegistry,
  spec: {
    readonly name: string;
    readonly scope: FleetWatchScope;
    readonly opened: (host: string) => PadiWatchOpenInput;
  },
): Effect.Effect<
  { name: string; hosts: string[]; reattached: boolean },
  unknown
> {
  return Effect.gen(function* () {
    if (spec.scope.kind === "ids") {
      for (const host of spec.scope.byHost.keys()) {
        yield* requireHost(hosts, host);
      }
    }
    const existing = registry.get(spec.name);
    // A re-open REPLACES the scope and the knobs (the subscription is this
    // process's, and the newest statement of what to watch is the true one)
    // but KEEPS the buffer and the fleet cursor — which is the whole value of
    // re-opening a name rather than minting a second one.
    let live: FleetSubscription;
    if (existing === undefined) {
      live = {
        name: spec.name,
        scope: spec.scope,
        opened: spec.opened,
        legs: new Map(),
        buffer: [],
        nextSeq: 0,
        dropped: 0,
      };
    } else {
      existing.scope = spec.scope;
      existing.opened = spec.opened;
      live = existing;
    }
    registry.set(spec.name, live);
    for (const host of wanted(hosts, live)) {
      if (live.legs.has(host)) continue;
      const padi = yield* requireHost(hosts, host);
      // `catch` passes the thrown value THROUGH: `spec.opened` refuses a
      // malformed scope with the per-host face's own `ToolFailure`, and the
      // default would bury that refusal's detail inside an UnknownException an
      // agent reads as a server bug.
      yield* Effect.tryPromise({
        try: () => openLeg(live, host, padi),
        catch: (err: unknown) => err,
      });
    }
    return {
      name: spec.name,
      hosts: [...live.legs.keys()],
      reattached: existing !== undefined,
    };
  });
}

/** Close every leg of a fleet subscription, and forget it. Refuses an unknown
 *  name with padi's OWN declared error — "there was no such subscription" is
 *  exactly the answer that class exists to keep distinguishable from "there was
 *  nothing to report". */
export function fleetWatchClose(
  hosts: FleetHosts,
  registry: FleetWatchRegistry,
  name: string,
): Effect.Effect<Record<string, never>, WatchSubscriptionNotFound> {
  return Effect.suspend(() => {
    const sub = registry.get(name);
    if (sub === undefined) {
      return Effect.fail(
        new WatchSubscriptionNotFound({ name, known: [...registry.keys()] }),
      );
    }
    // Forget it HERE, before the legs are closed: a close that fails partway
    // must still leave this process without a subscription it would keep
    // draining, and a leg on a host that has gone away is nobody's to close.
    registry.delete(name);
    return Effect.as(
      Effect.forEach(
        [...sub.legs.keys()],
        (host) => {
          const padi = hosts.padi(host);
          // A host that has already left has nothing to close, and saying so
          // would make a clean close fail for a reason the caller cannot act
          // on. Its leg is simply dropped with the subscription.
          return padi === null
            ? Effect.void
            : Effect.ignore(padi.surface.watch.close({ name }));
        },
        { discard: true },
      ),
      {} as Record<string, never>,
    );
  });
}
