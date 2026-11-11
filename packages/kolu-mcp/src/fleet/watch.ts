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
 * - **Leaving** — a host that leaves the host MAP takes every one of its
 *   workers with it, so the terminals it was carrying emit `gone` and then the
 *   leg drops. This is the same reasoning padi's own `gone` carries one level
 *   down: a supervisor waiting on a worker that no longer exists must be TOLD,
 *   because silence reads exactly like a calm workspace.
 * - **Disconnecting is NOT leaving** — an ssh blip, a remote padi restart, a
 *   host still warming: the host is still a member, its terminals are still
 *   there, and its leg is PARKED (the cursor and the roster kept) until it
 *   answers again, at which point the leg is re-opened and what padi buffered
 *   while the link was down is drained. Emitting `gone` for that would be a
 *   lie in the one word the standing prompt teaches as "dead" — and nothing
 *   would ever announce the return. Membership, and only membership, is what
 *   `gone` is about.
 * - **"Watch all" fails open** — a subscription with no `ids` legs every
 *   connected host, now and later. That is the per-host rule ("a list you forget
 *   to update goes blind to a lane nobody added") lifted one level: a fleet list
 *   you forget to update goes blind to a MACHINE nobody added. It also means ONE
 *   sick host may not fail the fleet's drain: a host whose `watch.open` keeps
 *   rejecting is skipped for this round, retried on the next, and reported as a
 *   GAP in the answer — because a `watch_next` that fails outright leaves the
 *   agent with nothing from the machines that were perfectly healthy. A host the
 *   caller NAMED in `ids` is the opposite case and still fails hard: it asked
 *   about that lane, so a watch that cannot cover it is not a watch it wanted.
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
import { messageOf, ToolFailure } from "@kolu/surface-mcp/tools";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import type { FleetHostState } from "./fleetSurface.ts";
import { type FleetHosts, requireHost } from "./hosts.ts";
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

/** How deep ONE host's queue is assumed to be — padi's DEFAULT depth, which
 *  this cannot read (the constant is not on padi's exports, and a registry
 *  takes a per-subscription override anyway, so no number here is ever exactly
 *  right). The fleet buffer is this times the number of legs: a merged queue
 *  must be able to hold what the queues it merges can hand over in one drain,
 *  or a two-host fleet would report drops the hosts never had. Over that, the
 *  OLDEST go and the count is reported — the same policy padi applies, because
 *  a silent truncation reads exactly like a quiet workspace. */
const PER_LEG_BUFFER_LIMIT = 512;

/** What a subscription watches. `all` is the fail-open default; `ids` names
 *  the HOSTS the caller's terminals live on and nothing more — which ids on
 *  each is `opened`'s business, and a second copy here would be one fact in
 *  two positions, free to disagree. A host with no named terminal is simply
 *  not in the set, rather than an empty entry that would watch everything. */
type FleetWatchScope =
  | { readonly kind: "all" }
  | { readonly kind: "ids"; readonly hosts: ReadonlySet<string> };

/** One host's leg of a fleet subscription. A leg OUTLIVES the link it was
 *  opened over: it is this subscription's record of a host it watches, not a
 *  handle on a connection. */
interface WatchLeg {
  /** The highest per-host seq this face has INGESTED — what the next drain
   *  acknowledges to padi. */
  after: number;
  /** That host's terminals as last read — what `gone` is emitted FOR when the
   *  host leaves, since by then there is nobody left to ask. */
  roster: readonly TerminalId[];
  /** The client this leg's cursor was opened OVER, or null while the host is
   *  not answering.
   *
   *  Identity, not a boolean, because the disconnect is often never observed:
   *  a host that dropped and came back between two `watch_next` calls hands
   *  back a DIFFERENT client, and the padi behind it may be a fresh process
   *  whose queue never heard this subscription's name — a drain against that
   *  is a `WatchSubscriptionNotFound` that fails the whole fleet's call. So a
   *  leg is re-opened whenever the link it was opened over is not the link the
   *  host map holds now, and the re-open's `acknowledged` is padi's own
   *  watermark: a surviving queue hands over exactly what was missed. */
  padi: PadiSurfaceClient | null;
}

/** One fleet subscription. `scope` and `opened` are MUTABLE because a re-open
 *  restates them on the live record rather than replacing it: a `watch_next`
 *  already parked holds this object, and handing the registry a copy would let
 *  the drain in flight and the next one disagree about what is being watched. */
interface FleetSubscription {
  readonly name: string;
  scope: FleetWatchScope;
  /** The per-host open input, ids and all — so a leg opened on a host that
   *  arrives LATE is opened with the same knobs the first legs were. */
  opened: (host: string) => PadiWatchOpenInput;
  readonly legs: Map<string, WatchLeg>;
  /** Hosts that ANSWERED and turned the subscription down, and what the
   *  refusal said — never one that is merely not connected, which is read off
   *  the host map. Only the `all` scope ever has entries (a named host fails
   *  the call instead): they are retried on every reconcile and reported as
   *  gaps, so one sick machine costs its own lane and not the fleet's. */
  readonly refusals: Map<string, string>;
  buffer: FleetWatchEvent[];
  nextSeq: number;
  dropped: number;
}

/** Every fleet subscription one served face holds. Per SERVER, not per module:
 *  two faces in one process are two fleets, and a module-global registry would
 *  let one close the other's watch by name. */
export type FleetWatchRegistry = Map<string, FleetSubscription>;

export const newFleetWatchRegistry = (): FleetWatchRegistry => new Map();

/** The current terminal ids of one host, or NULL when the host could not be
 *  asked — two different facts, so two different values. An empty list that
 *  meant both would have a link failure silently forget who was on that
 *  machine, and a later departure would then mourn nobody. */
function readRoster(
  padi: PadiSurfaceClient,
): Effect.Effect<readonly TerminalId[] | null> {
  return Effect.catchCause(
    firstFrameOrThrow(
      padi.surface.terminals.keys(undefined),
      "fleet watch: a host's terminal keys yielded no snapshot frame.",
    ),
    () => Effect.succeed(null),
  );
}

/** Open (or re-attach) one host's leg.
 *
 *  `sub.opened` is a THROWING resolver (the per-host face's refusal is a
 *  `ToolFailure`), so it is lifted with its thrown value passed through rather
 *  than called inside the generator, where a throw would be a defect and the
 *  refusal's detail would never reach the agent.
 *
 *  The cursor comes from padi's answer on EVERY open, including a re-open of a
 *  parked leg: padi keeps a re-attached subscription's watermark and starts a
 *  fresh one at its current sequence, so taking `acknowledged` is what makes a
 *  reconnect hand over what was buffered during the outage without replaying a
 *  restarted daemon's unrelated history. */
function openLeg(
  sub: FleetSubscription,
  host: string,
  padi: PadiSurfaceClient,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const input = yield* Effect.try({
      try: () => sub.opened(host),
      catch: (err: unknown) => err,
    });
    const opened = yield* padi.surface.watch.open(input);
    sub.legs.set(host, {
      after: opened.acknowledged,
      // A re-open that cannot read the roster keeps the one this leg had.
      roster: (yield* readRoster(padi)) ?? sub.legs.get(host)?.roster ?? [],
      padi,
    });
    sub.refusals.delete(host);
  });
}

/** Which hosts this subscription is ABOUT — MEMBERSHIP, not reachability.
 *
 *  Deliberately `hosts.keys()` and not the connected subset: a host that is
 *  merely disconnected is still a host this watch covers, and the difference
 *  between the two lists is the difference between parking a leg and declaring
 *  every terminal on that machine dead. */
function watched(hosts: FleetHosts, sub: FleetSubscription): readonly string[] {
  const scope = sub.scope;
  const members = hosts.keys();
  return scope.kind === "all"
    ? members
    : members.filter((host) => scope.hosts.has(host));
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

/** The rule a host's refusal is weighed under — stated ONCE, because the open
 *  and the drain ask the same question one verb apart.
 *
 *  A host the caller NAMED in `ids` fails the call: it asked about that lane,
 *  and a watch silently missing exactly the lane it was opened for is the
 *  blindness this face exists to prevent. A host nobody named — "watch all" —
 *  is recorded and skipped instead, because failing there would hand the agent
 *  nothing at all from every machine that is perfectly healthy. The record is
 *  retried on the next reconcile and reported as a gap in the meantime. */
function refused(
  sub: FleetSubscription,
  host: string,
  err: unknown,
): Effect.Effect<void, unknown> {
  return sub.scope.kind === "ids"
    ? Effect.fail(err)
    : Effect.sync(() => {
        sub.refusals.set(host, messageOf(err));
      });
}

/** Attach one host's leg, under {@link refused}. */
function attachLeg(
  sub: FleetSubscription,
  host: string,
  padi: PadiSurfaceClient,
): Effect.Effect<void, unknown> {
  return Effect.catch(openLeg(sub, host, padi), (err: unknown) =>
    refused(sub, host, err),
  );
}

/** Bring the legs in line with the live fleet: leg the hosts that arrived or
 *  came back, say `gone` for the terminals of the hosts that LEFT the host map,
 *  park the leg of a host that merely stopped answering, and refresh what each
 *  attached host is carrying. */
function reconcile(
  hosts: FleetHosts,
  sub: FleetSubscription,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const members = new Set(watched(hosts, sub));
    for (const [host, leg] of [...sub.legs]) {
      if (members.has(host)) continue;
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
      sub.refusals.delete(host);
    }
    for (const host of members) {
      const padi = hosts.padi(host);
      const leg = sub.legs.get(host);
      if (padi === null) {
        // PARKED, not gone. The cursor and the roster are kept, so the return
        // re-opens from padi's own watermark and a real departure later still
        // knows which terminals to mourn.
        if (leg !== undefined) leg.padi = null;
        continue;
      }
      // A leg opened over a link the host map no longer holds is re-opened:
      // see {@link WatchLeg.padi}. This also covers the disconnect nobody saw,
      // because the two calls either side of it observe different clients.
      if (leg === undefined || leg.padi !== padi) {
        // Parked FIRST: a re-open that fails must not leave this leg draining
        // and parking over a link the host map has already replaced.
        if (leg !== undefined) leg.padi = null;
        yield* attachLeg(sub, host, padi);
        continue;
      }
      // Every attached leg's roster is refreshed here, not at ingest: a
      // terminal CREATED since the last call emits no settle event of its own,
      // so a roster refreshed only by events would forget it — and forget to
      // mourn it when its host leaves. A host that could not be ASKED keeps
      // the roster it had, which is strictly better than forgetting it.
      leg.roster = (yield* readRoster(padi)) ?? leg.roster;
    }
  });
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
 *  makes it safe for the park above to be a doorbell rather than a consumer.
 *
 *  A leg that REFUSES is weighed by {@link refused}, the same rule the open
 *  applies, because it is the same question one verb later. The reachable case
 *  is a padi that restarted under a mirror that never dropped: the link is the
 *  same object, so nothing re-opened, and the queue this cursor names is gone
 *  (`WatchSubscriptionNotFound`). Parking the leg makes the next reconcile
 *  re-open it — the recovery a reconnect already takes — where failing here
 *  would blind every other host over one machine's restart. */
function drainLegs(sub: FleetSubscription): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    for (const [host, leg] of sub.legs) {
      // Over the leg's OWN link, and skipped when it has none: a parked host
      // is not answering, and the client the host map holds now may be one
      // this cursor was never opened over. The reconcile re-opens; this never
      // guesses.
      const padi = leg.padi;
      if (padi === null) continue;
      const drained = yield* Effect.catch(
        padi.surface.watch.drain({ name: sub.name, after: leg.after }),
        (err: unknown) =>
          // Parked only once the rule has LET this pass: a named host fails
          // the whole call instead, and keeps the leg it was opened with.
          Effect.as(
            Effect.flatMap(refused(sub, host, err), () =>
              Effect.sync(() => {
                leg.padi = null;
              }),
            ),
            null,
          ),
      );
      if (drained === null) continue;
      if (drained.events.length === 0 && drained.dropped === 0) continue;
      ingest(sub, host, drained);
    }
  });
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

/** A host this subscription COVERS but did not hear from — the blind spot,
 *  named.
 *
 *  It exists because the two honest answers to "that machine is quiet" are not
 *  the same answer: a host whose link is down contributes no events and a host
 *  that is healthy and idle contributes no events, and an agent reading one
 *  batch cannot tell them apart. `gone` would be a lie (the terminals are
 *  still there), silence would be worse (a supervisor concludes the work
 *  finished), so the fleet says which hosts it could not reach and why. */
export interface FleetWatchGap {
  readonly host: string;
  /** `not-connected` — the link is down or still warming, the leg is parked
   *  and will drain what it missed on reconnect. `watch-refused` — the host IS
   *  answering but turned the subscription itself down (the open rejected, or
   *  the drain found no such queue); its leg is retried every round. */
  readonly kind: "not-connected" | "watch-refused";
  readonly state: FleetHostState;
  readonly why: string;
}

/** A fleet drain's whole answer: the outcome, and the blind spots it was taken
 *  over. Two fields rather than one more arm on {@link WaitOutcome}, because a
 *  gap is orthogonal to every arm — a timeout over a fleet with an unreachable
 *  host is exactly as worth reporting as a met batch is. */
export interface FleetWatchAnswer {
  readonly outcome: FleetWatchOutcome;
  readonly gaps: readonly FleetWatchGap[];
}

/** The gaps as they stand right now. Read at ANSWER time, not accumulated:
 *  "which hosts is this batch missing" is a question about the fleet as it is,
 *  and a host that came back before the answer left is no longer a gap. */
function gapsOf(
  hosts: FleetHosts,
  sub: FleetSubscription,
): readonly FleetWatchGap[] {
  const gaps: FleetWatchGap[] = [];
  for (const host of watched(hosts, sub)) {
    const refusal = sub.refusals.get(host);
    const state = hosts.state(host);
    if (refusal !== undefined) {
      gaps.push({
        host,
        kind: "watch-refused",
        state,
        why: `${host} refused the watch: ${refusal}. It is retried on every watch_next; nothing from it is in this batch.`,
      });
    } else if (hosts.padi(host) === null) {
      gaps.push({
        host,
        kind: "not-connected",
        state,
        why: `${host} is ${state} — its terminals are PARKED, not gone. This watch re-opens its leg and drains what it missed the moment it answers again.`,
      });
    }
  }
  return gaps;
}

/** The PARK — the one genuinely Promise-shaped thing in this file, and the
 *  reason it is lifted rather than composed: `awaitWatchEvents` is padi's
 *  Promise-and-AbortSignal waiter, and the roster's doorbell is a plain
 *  callback. It resolves when ANY leg rings, when the fleet changes shape, or
 *  when `leftMs` elapses.
 *
 *  It is only a DOORBELL: the drain that follows reads every leg itself.
 *  Draining in here would make a batch depend on which host answered first —
 *  `Promise.race` settles on one, the losers are aborted, and an aborted wait
 *  acknowledges nothing, so a second host whose events were already queued
 *  would be left out of a batch it belonged in and appear only on the NEXT
 *  call. An agent reading that batch sees one machine asking and concludes the
 *  other is quiet. A drain acknowledges only what the CALLER acknowledged, so
 *  re-draining the winner costs a round trip and loses nothing. */
async function ringOnce(
  hosts: FleetHosts,
  sub: FleetSubscription,
  opts: {
    readonly leftMs: number | undefined;
    readonly signals: readonly (AbortSignal | undefined)[];
  },
): Promise<void> {
  const park = new AbortController();
  const stop = (): void => {
    park.abort();
  };
  const offRoster = hosts.subscribe(stop);
  const outer = opts.signals.filter((one) => one !== undefined);
  for (const one of outer) one.addEventListener("abort", stop, { once: true });
  const timer =
    opts.leftMs === undefined ? undefined : setTimeout(stop, opts.leftMs);
  try {
    if (outer.some((one) => one.aborted)) return;
    const bells = [...sub.legs.values()].flatMap((leg) => {
      // A parked leg has no doorbell to listen at. The roster subscription
      // above is what wakes this park when its host comes back.
      const padi = leg.padi;
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
      return;
    }
    await Promise.race(bells);
    park.abort();
    await Promise.allSettled(bells);
  } finally {
    offRoster();
    for (const one of outer) one.removeEventListener("abort", stop);
    clearTimeout(timer);
  }
}

/** THE merged drain: acknowledge, reconcile, answer what is buffered, else park
 *  until any host rings — or the fleet changes shape, or the clock runs out.
 *
 *  An EFFECT, not a Promise: every step but the park above is a surface member
 *  call, so composing them leaves exactly one crossing — the lift inside — and
 *  the MCP request edge stays the one place this face runs anything (PLAN
 *  D10/#25). Interruption is the fiber's: a cancelled `tools/call` interrupts
 *  the park, which aborts every leg's wait, and an aborted wait acknowledges
 *  nothing. */
export function fleetWatchNext(
  hosts: FleetHosts,
  registry: FleetWatchRegistry,
  opts: {
    readonly name: string;
    readonly after?: number | undefined;
    readonly timeoutMs?: number | undefined;
    /** The FACE's own request signal, when it has one. Fiber interruption
     *  covers the rest. */
    readonly signal?: AbortSignal | undefined;
  },
): Effect.Effect<FleetWatchAnswer, unknown> {
  return Effect.gen(function* () {
    const started = Date.now();
    const sub = registry.get(opts.name);
    if (sub === undefined) {
      return yield* Effect.fail(
        new ToolFailure(
          `no fleet watch named ${JSON.stringify(opts.name)} is open — open one with watch_open (the same name reattaches to its queue). A fleet watch lives in this kolu-server process, so a restart of it clears every subscription.`,
          { kind: "no-such-watch", name: opts.name },
        ),
      );
    }
    // The acknowledgement, before anything else: everything at or below `after`
    // is forgotten, everything above comes again. Until the caller says a
    // number, nothing leaves this buffer.
    if (opts.after !== undefined) {
      const after = opts.after;
      sub.buffer = sub.buffer.filter((event) => event.seq > after);
    }
    const elapsed = (): number => Date.now() - started;
    // Every arm answers through here, so no outcome can forget to say which
    // hosts it did not hear from.
    const done = (outcome: FleetWatchOutcome): FleetWatchAnswer => ({
      outcome,
      gaps: gapsOf(hosts, sub),
    });
    const answer = (): FleetWatchOutcome => {
      const events = [...sub.buffer];
      const dropped = sub.dropped;
      sub.dropped = 0;
      return {
        kind: "met",
        events,
        dropped,
        // The watermark of what is HELD, so echoing it back acknowledges
        // exactly this batch. An empty batch echoes the standing watermark (a
        // no-op).
        ackAfter:
          events.length === 0 ? sub.nextSeq : events[events.length - 1]!.seq,
        elapsedMs: elapsed(),
      };
    };

    for (;;) {
      yield* reconcile(hosts, sub);
      if (sub.buffer.length > 0) return done(answer());
      if (opts.signal?.aborted === true) {
        return done({ kind: "interrupted" });
      }
      const left =
        opts.timeoutMs === undefined ? undefined : opts.timeoutMs - elapsed();
      if (left !== undefined && left <= 0) {
        return done({ kind: "timeout", elapsedMs: elapsed() });
      }
      yield* Effect.tryPromise({
        try: (fiberSignal) =>
          ringOnce(hosts, sub, {
            leftMs: left,
            signals: [opts.signal, fiberSignal],
          }),
        catch: (err: unknown) => err,
      });
      // In LEG order — the roster's order, local first — so the fleet seq a
      // caller acknowledges is assigned by a rule, not by which machine's
      // packet arrived first.
      yield* drainLegs(sub);
    }
  });
}

/** Open (or re-attach to) a fleet subscription. The per-host inputs are the
 *  caller's own, already resolved by the per-host face's pure half — this only
 *  decides WHICH hosts get a leg.
 *
 *  A subscription that NAMES terminals is checked host by host first: an id on
 *  a host that is not connected is refused BY NAME, rather than quietly
 *  producing a watch that is blind to exactly the lane the caller asked about,
 *  and a named host that then refuses the subscription fails the call for the
 *  same reason. A subscription that names none ("watch all") legs whatever is
 *  connected and picks up the rest as they arrive — there is nothing to refuse,
 *  because the caller named no host, so a machine that is down or refusing is
 *  reported as a GAP and retried on every drain. */
export function fleetWatchOpen(
  hosts: FleetHosts,
  registry: FleetWatchRegistry,
  spec: {
    readonly name: string;
    readonly scope: FleetWatchScope;
    readonly opened: (host: string) => PadiWatchOpenInput;
  },
): Effect.Effect<
  {
    name: string;
    hosts: string[];
    reattached: boolean;
    gaps: readonly FleetWatchGap[];
  },
  unknown
> {
  return Effect.gen(function* () {
    if (spec.scope.kind === "ids") {
      for (const host of spec.scope.hosts) {
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
        refusals: new Map(),
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
    // THE reconcile, not a second spelling of it: "make the legs match the
    // scope and the roster" is one rule, and an open is the first time it
    // runs. A disconnected host is parked rather than refused — under `ids`
    // the check above already refused it, so reaching here means nobody named
    // it — and a re-open that NARROWS the scope mourns what it dropped here
    // rather than one drain later, which is the same answer sooner.
    yield* reconcile(hosts, live);
    return {
      name: spec.name,
      hosts: [...live.legs.keys()],
      reattached: existing !== undefined,
      gaps: gapsOf(hosts, live),
    };
  });
}

/** Close every leg of a fleet subscription, and forget it. Refuses an unknown
 *  name with padi's OWN declared error — "there was no such subscription" is
 *  exactly the answer that class exists to keep distinguishable from "there was
 *  nothing to report".
 *
 *  It needs no host map: a leg carries the link it was opened over, which is
 *  the only one that can close what this subscription opened. */
export function fleetWatchClose(
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
        [...sub.legs.values()],
        (leg) => {
          // A host that has already left, or is not answering, has nothing to
          // close — and saying so would make a clean close fail for a reason
          // the caller cannot act on. Its leg is simply dropped with the
          // subscription. The close goes over the link the leg was opened on,
          // never a newer one that never heard the name.
          return leg.padi === null
            ? Effect.void
            : Effect.ignore(leg.padi.surface.watch.close({ name }));
        },
        { discard: true },
      ),
      {} as Record<string, never>,
    );
  });
}
