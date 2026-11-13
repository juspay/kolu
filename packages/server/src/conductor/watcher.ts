/**
 * THE THING THAT WAKES THE CONDUCTOR — kolu-server watching the terminals the
 * conversation asked it to watch, so the conversation itself never has to sit
 * in a wait.
 *
 * The Conductor used to find out that a planner had stopped by CALLING a wait
 * with no time limit, which is a turn that lasts as long as the work does and a
 * person's message queued behind it for all of that. This module is the other
 * half of deleting that: kolu holds the standing subscriptions, and when a
 * watched terminal's agent comes up, stops, asks, sleeps or goes away it
 * starts a Conductor turn itself ({@link ConductorHost.observe}).
 *
 * ## What it subscribes, and why those three
 *
 * Per host that holds at least one watched terminal, over that host's padi:
 *
 *  - **`urgency`** — padi's own fold over its terminals: who is awaiting a
 *    person, who just finished, who is working. It is DERIVED on the host (one
 *    computation, one arrival time, `packages/padi/src/activity/urgency.ts`), so
 *    reading the lists is reading padi's answer rather than re-deriving a
 *    second one here that can disagree with the dock.
 *  - **`terminals`** — the keys (which terminals that host still has, which is
 *    what makes `gone` decidable) and the RECORD of each watched id: its name,
 *    the agent detected in it, whether it is active or asleep, whether the
 *    FOREGROUND is the terminal's own shell, and the PARENT it hangs off. The
 *    foreground is reported, never concluded from: "the command kolu typed has
 *    ended" is two readings of it and belongs with the rest of the rules
 *    (`kolu-conductor`'s `watching.ts`).
 *  - **the record of each ANCESTOR** those parent edges lead to, discovered as
 *    the records arrive and read on the same leg. The watch list never named
 *    them and nothing about them ever rings — what they carry is WHICH PIECE
 *    OF WORK a watched terminal is part of (a planner and the implementor it
 *    split off are one thing going on) and what to call it. Read HERE because
 *    this is the one place that holds every watched terminal's host: a browser
 *    can walk the parent edges only of the host it has open, and a host that
 *    is away has none to walk — so the grouping is derived once, on the
 *    readings, and remembered on the watch list's entries.
 *
 * Nothing else: a screen is read by the Conductor when it decides to look, and
 * a wake carries how something STANDS rather than what it printed. padi has no
 * exit status to offer, so a command that fails before any non-shell
 * foreground is sampled is not something this module can see.
 *
 * ## Retry, and the two ways a subscription dies
 *
 * Every member opens with a SNAPSHOT by contract (`dev/skills/streaming/SKILL.md`),
 * so a re-subscribe is a fresh reading rather than a replay — which is what
 * makes re-opening the honest recovery here rather than a resync protocol.
 *
 *  - **The host map says so.** A padi that drops leaves `hosts.padi(key)`
 *    answering `null`, and `hosts.subscribe` fires. The leg is torn down and
 *    re-opened when the host comes back, against the NEW client — the identity
 *    comparison the fleet's own standing watch makes (`kolu-mcp`'s `watch.ts`),
 *    for the case it names: a padi that restarted under a mirror that never
 *    dropped hands back a different client object for the same key.
 *  - **The stream says so.** A leg whose fiber exits on its own — the far end
 *    went away without the host map noticing — is re-opened after
 *    {@link REOPEN_DELAY_MS}. Bounded by the delay rather than by an attempt
 *    count: a host that is down should be retried forever, quietly, because the
 *    terminal being watched is still there when it comes back.
 *
 * ## What it refuses to say
 *
 * A reading is produced ONLY for a ref on a CONNECTED host. A host that is not
 * answering says nothing about its terminals, and `gone` for one of them would
 * be a wake telling the Conductor that a machine's work died when all that
 * happened is that the machine stopped answering. Disconnected is not gone.
 */

import type { Logger } from "pino";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { Effect, Fiber, Stream } from "effect";
import type { ConductorHost, WatchObservation } from "kolu-conductor";
import type { FleetHosts } from "kolu-mcp";
import { fleetTerminalRef, splitFleetTerminalRef } from "kolu-mcp/fleetRef";

/** How long a leg whose stream died on its own waits before re-opening.
 *
 *  A few seconds, because what is on the other side is a daemon restarting or
 *  an ssh link re-dialling, and a tighter loop would be this process spinning
 *  against a machine that is busy coming back. Nothing is lost by the wait: the
 *  re-open leads with a snapshot, so the first frame after it is the world as
 *  it stands rather than the edge that was missed. */
const REOPEN_DELAY_MS = 3_000;

export interface ConductorWatcher {
  /** The watch list moved — re-scope the legs to the hosts it now names.
   *  Idempotent and cheap: a host that is already legged with the same client
   *  and the same ids is left exactly as it is. */
  readonly rescope: () => void;
  /** Stop watching everything, for the shutdown. */
  readonly dispose: () => Promise<void>;
}

/** One host's standing subscription, and the last thing each part of it said. */
interface Leg {
  /** The client this leg was opened OVER. Compared by identity on every
   *  re-scope: a host that dropped and came back answers with a different
   *  object, and a leg still running over the old one is a subscription the
   *  padi behind it may never have heard of. */
  readonly padi: PadiSurfaceClient;
  /** The watched ids on this host, as the leg was opened for them — a change
   *  re-opens the leg, because the per-record subscriptions are chosen here. */
  readonly ids: ReadonlyArray<string>;
  /** The fiber running its subscriptions — assigned the moment it is forked,
   *  which is one tick after the leg exists: the stream WRITES into this leg,
   *  so the leg has to be the object the fork closes over. */
  fiber: Fiber.Fiber<void, unknown> | null;
  /** Which of its terminals need someone, as padi folds it — `null` until the
   *  first frame, which is why nothing is reported before then. */
  urgency: PadiUrgency | null;
  /** Which terminals that host still has. `null` until the first frame: `gone`
   *  is only decidable against a roster that has actually been read. */
  roster: ReadonlySet<string> | null;
  /** The record of each watched id, for its name, the agent in it and the
   *  PARENT it hangs off — and the record of each ANCESTOR those parent edges
   *  lead to, which is how a split's piece of work gets its heading. */
  readonly records: Map<string, PadiTerminal>;
  /** The ancestor records this leg also reads, id to the fiber reading it —
   *  `null` for the beat between claiming the id and forking.
   *
   *  Kept APART from {@link Leg.ids}, which is the watch list's own set and
   *  the thing a re-scope compares: an ancestor is discovered from a record
   *  that has already arrived, so folding it into `ids` would re-open the
   *  whole leg once per generation of the family tree. They are torn down
   *  with the leg, and a re-opened leg discovers them again from its own
   *  first frames. */
  readonly ancestors: Map<string, Fiber.Fiber<void, unknown> | null>;
  /** A re-open already scheduled, so a fiber that exits twice does not queue
   *  two of them. */
  reopening: boolean;
}

/** WHAT A TERMINAL IS CALLED, off its padi record: the name a person gave it,
 *  else the branch it is on, else nothing.
 *
 *  One rule, two callers — the watched terminal's own reading and the heading
 *  of the piece of work it belongs to ({@link walkRoot}) — because a group
 *  whose header named a terminal differently from the row under it would be
 *  two spellings of one fact. A dormant record has no live arm to ask, and
 *  "nothing known" is reported as EMPTY rather than invented: the conversation
 *  keeps whatever its entry already remembered. */
export const recordName = (record: PadiTerminal | undefined): string => {
  const live = record?.state === "active" ? record : undefined;
  const branch = live?.git.kind === "repo" ? live.git.info.branch : "";
  return live?.intent ?? branch;
};

/** The answer {@link walkRoot} gives: the top-level terminal, and the one
 *  ancestor id whose record would be needed to walk any further. */
export interface RootWalk {
  readonly root: { readonly ref: string; readonly name: string };
  /** An ancestor this host has not been asked about yet — the next record to
   *  subscribe — or `null` when the chain is fully read. Never the walked
   *  terminal itself: that one is already on the leg. */
  readonly missing: string | null;
}

/**
 * WHICH PIECE OF WORK A TERMINAL IS IN — its `child-of` edges followed to the
 * top-level terminal they end at.
 *
 * Pure, and over the records this leg has already read, so it is the same walk
 * whether it runs on a frame or in a test. A terminal with no parent is its
 * own root; a chain that runs into a record nobody has read yet stops THERE
 * and names it, which is the furthest honest answer — a split whose parent is
 * known but whose grandparent is not is still not a piece of work of its own.
 *
 * The cycle guard is a belt: padi refuses a parent edge that would close a
 * loop when it is written (`packages/padi/src/terminals.ts`), so this can only
 * fire on a record that got onto a disk some other way — and a watcher that
 * span forever on one would take the Conductor's whole watch with it.
 */
export const walkRoot = (
  host: string,
  id: string,
  records: ReadonlyMap<string, PadiTerminal>,
): RootWalk => {
  let at = id;
  const seen = new Set<string>([id]);
  for (;;) {
    const record = records.get(at);
    if (record === undefined)
      return {
        root: { ref: fleetTerminalRef(host, at), name: "" },
        missing: at === id ? null : at,
      };
    const parent = record.parentId;
    if (parent === undefined || seen.has(parent))
      return {
        root: { ref: fleetTerminalRef(host, at), name: recordName(record) },
        missing: null,
      };
    seen.add(parent);
    at = parent;
  }
};

export function startConductorWatcher(deps: {
  readonly hosts: FleetHosts;
  /** The conversation, as a THUNK — read per call, and never called merely to
   *  find out whether anything is watched: building the host reads the
   *  remembered record, which is bookkeeping, while a wake is what may start
   *  the agent ({@link ConductorHost.observe} → the host's own flush). */
  readonly conductor: () => ConductorHost;
  readonly log: Logger;
}): ConductorWatcher {
  const { hosts, conductor, log } = deps;

  const legs = new Map<string, Leg>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;

  /** The watched refs grouped by the host they are on. A ref whose host is not
   *  a member of this fleet is simply not in the result: the watch list is
   *  saved with the conversation and a host can be removed from the pool under
   *  it, which is not a terminal going away — nothing can be said about a
   *  machine kolu no longer holds. */
  const byHost = (): Map<string, Array<{ ref: string; id: string }>> => {
    const members = new Set(hosts.keys());
    const grouped = new Map<string, Array<{ ref: string; id: string }>>();
    for (const ref of conductor().watched()) {
      const split = splitFleetTerminalRef(ref);
      if (split === null || !members.has(split.host)) continue;
      const list = grouped.get(split.host);
      if (list === undefined) grouped.set(split.host, [{ ref, id: split.id }]);
      else list.push({ ref, id: split.id });
    }
    return grouped;
  };

  /**
   * What this host's last frames say about each watched terminal, as the
   * conversation is told it.
   *
   * A terminal is left OUT when nothing honest can be said about it yet — the
   * first frames have not landed, or its agent is in none of padi's four lists
   * and the record has not arrived to say whether there is an agent at all. A
   * silence is the one answer that never misleads: the next frame says more.
   */
  const readingsOf = (
    host: string,
    leg: Leg,
    watched: ReadonlyArray<{ ref: string; id: string }>,
  ): ReadonlyArray<WatchObservation> => {
    const roster = leg.roster;
    const urgency = leg.urgency;
    if (roster === null || urgency === null) return [];
    const hostName = hosts.display(host);
    const seen: Array<WatchObservation> = [];
    for (const { ref, id } of watched) {
      const record = leg.records.get(id);
      const live = record?.state === "active" ? record : undefined;
      const base = {
        ref,
        host,
        terminalId: id,
        hostName,
        // The name a person gave it, else the branch it is on. Nothing is
        // invented: a terminal with neither keeps whatever the entry already
        // remembered ({@link WatchEntry.name}).
        name: recordName(record),
        agent: live?.agent?.kind ?? null,
        // THE PIECE OF WORK IT IS PART OF, walked here because this is the one
        // place that reads every watched terminal's record on every host — a
        // browser has the parent edges only of the host it has open, and the
        // Conductor watches terminals on machines nobody is looking at.
        root: walkRoot(host, id, leg.records).root,
        // PADI'S OWN ANSWER about what is in front of the prompt — `shell:
        // true` is an idle prompt with nothing running on it. `null` for a
        // reading with no live arm to ask (a sleeping terminal has released
        // its PTY) or a record padi has not sampled a foreground for yet.
        // The conversation's own rules read it; this end only reports it
        // (`kolu-conductor`'s `watching.ts`, where `ended` is decided).
        foregroundShell: live?.foreground?.shell ?? null,
      };
      if (!roster.has(id)) {
        seen.push({ ...base, level: "gone" });
        continue;
      }
      // ASLEEP, NOT A SHELL. padi keeps a slept (or boot-parked) terminal in
      // its roster with the PTY and the agent released — so a watched
      // terminal whose agent was working reads as a terminal with no agent in
      // it, which is the one reading that never rings. Its agent is dead and
      // whatever it was doing stopped there: that is news exactly once, and
      // the entry stays listed because waking the terminal puts it back on the
      // ordinary levels.
      if (record !== undefined && record.state !== "active") {
        seen.push({ ...base, level: "asleep" });
        continue;
      }
      if (urgency.awaitingIds.includes(id)) {
        seen.push({ ...base, level: "asking" });
        continue;
      }
      if (urgency.finishedIds.includes(id)) {
        seen.push({ ...base, level: "stopped" });
        continue;
      }
      // LINGER IS STILL WORKING. padi splits a waiting agent into "lingering"
      // and "finished" on its own quiet rule, and only the second half is the
      // end of a turn — treating the first as a stop would wake the Conductor
      // while the agent is still printing.
      if (urgency.workingIds.includes(id) || urgency.lingerIds.includes(id)) {
        seen.push({ ...base, level: "working" });
        continue;
      }
      // In none of the four lists: either there is no agent in it (a shell,
      // which never rings) or there is one in a state padi puts in no list —
      // and about that one there is nothing to say.
      if (record !== undefined && live?.agent == null) {
        seen.push({ ...base, level: "shell" });
      }
    }
    return seen;
  };

  /** Read one ANCESTOR's record on this leg — a terminal the watch list never
   *  named, subscribed because a watched terminal hangs off it.
   *
   *  Its frames move no levels and ring nothing: what they carry is the
   *  heading of a piece of work, so they land in the same records map and
   *  re-report. A `gone` is never concluded from one either — an ancestor is
   *  not on the list, and the terminals that ARE have their own roster test.
   *
   *  Claimed on the map BEFORE the fork, because the first frame can arrive
   *  inside `runFork` and walk straight back in here through {@link report}. */
  const openAncestor = (host: string, leg: Leg, id: string): void => {
    if (leg.ancestors.has(id) || leg.ids.includes(id)) return;
    leg.ancestors.set(id, null);
    const pump = Stream.runForEach(
      Stream.map(leg.padi.surface.terminals.get({ key: id }), (record) => {
        leg.records.set(id, record);
      }),
      () =>
        Effect.sync(() => {
          report(host, leg);
        }),
    );
    leg.ancestors.set(
      id,
      Effect.runFork(
        Effect.onExit(pump, (exit) =>
          Effect.sync(() => {
            if (exit._tag !== "Failure") return;
            // NOT RE-OPENED on its own clock. An ancestor read that dies
            // alone leaves the group's heading at the last name it had, which
            // is a stale word on a panel; the leg it rides re-opens for every
            // reason that matters (the host dropped, the link died) and
            // discovers the family again from its own first frames.
            log.warn(
              { err: exit.cause, host, terminal: id },
              "kolu-server: the conductor's watch over a parent terminal stopped",
            );
          }),
        ),
      ),
    );
  };

  /** Subscribe whatever this host has not been asked about yet in the parent
   *  chains of the terminals being watched on it. One generation per pass:
   *  the record that answers the question is also the record that asks the
   *  next one, and it arrives on a frame that runs this again. */
  const discover = (
    host: string,
    leg: Leg,
    watched: ReadonlyArray<{ ref: string; id: string }>,
  ): void => {
    for (const { id } of watched) {
      const missing = walkRoot(host, id, leg.records).missing;
      if (missing !== null) openAncestor(host, leg, missing);
    }
  };

  /** One host's frames, folded and handed over. Called on EVERY frame of
   *  either subscription: each one is a reading of the whole host, and the
   *  conversation's own rules decide what is news (`kolu-conductor`'s
   *  `watching.ts`). */
  const report = (host: string, leg: Leg): void => {
    if (disposed) return;
    const watched = byHost().get(host) ?? [];
    if (watched.length === 0) return;
    // Before the readings, because a reading carries the piece of work this
    // terminal is in and the parent that decides it may not have been read
    // yet. Nothing waits on it: this frame reports the furthest root it can
    // name, and the record that arrives from here re-reports with the rest.
    discover(host, leg, watched);
    const seen = readingsOf(host, leg, watched);
    if (seen.length === 0) return;
    conductor().observe(seen);
  };

  /** Everything one host says about the terminals being watched on it, as one
   *  stream: padi's urgency fold, its terminal roster, and the record of each
   *  watched id. Merged rather than zipped — each arrives on its own clock,
   *  and what is wanted is a re-read of the whole host whenever any of them
   *  moves. */
  const legStream = (
    padi: PadiSurfaceClient,
    ids: ReadonlyArray<string>,
    leg: Leg,
  ): Stream.Stream<void, unknown> =>
    Stream.mergeAll(
      [
        Stream.map(padi.surface.urgency.get(undefined), (value) => {
          leg.urgency = value;
        }),
        Stream.map(padi.surface.terminals.keys(undefined), (keys) => {
          leg.roster = new Set(keys);
        }),
        ...ids.map((id) =>
          Stream.map(padi.surface.terminals.get({ key: id }), (record) => {
            leg.records.set(id, record);
          }),
        ),
      ],
      { concurrency: "unbounded" },
    );

  const open = (
    host: string,
    padi: PadiSurfaceClient,
    watched: ReadonlyArray<{ ref: string; id: string }>,
  ): void => {
    const ids = watched.map((one) => one.id);
    const leg: Leg = {
      padi,
      ids,
      // Forked below and assigned onto THIS object: the stream writes its
      // frames into the leg it belongs to, so the leg the map holds has to be
      // the one the fork closed over rather than a copy of it.
      fiber: null,
      urgency: null,
      roster: null,
      records: new Map(),
      ancestors: new Map(),
      reopening: false,
    };
    const pump = Stream.runForEach(legStream(padi, ids, leg), () =>
      Effect.sync(() => {
        report(host, leg);
      }),
    );
    legs.set(host, leg);
    leg.fiber = Effect.runFork(
      Effect.onExit(pump, (exit) =>
        Effect.sync(() => {
          onLegExit(host, leg, exit._tag === "Failure" ? exit.cause : null);
        }),
      ),
    );
  };

  /** A leg's fiber ended. An INTERRUPTION is a teardown this module asked for
   *  (a re-scope, a dispose) and the leg is already gone from the map; anything
   *  else is the far end going away without the host map noticing, which is
   *  re-opened on a delay. */
  const onLegExit = (host: string, leg: Leg, cause: unknown): void => {
    if (disposed) return;
    const current = legs.get(host);
    // Not the leg that is current any more: a re-scope replaced it, and that
    // replacement is the subscription now.
    if (current !== leg) return;
    if (cause !== null) {
      log.warn(
        { err: cause, host },
        "kolu-server: the conductor's watch over a host stopped; re-opening",
      );
    }
    legs.delete(host);
    if (current.reopening) return;
    current.reopening = true;
    const timer = setTimeout(() => {
      timers.delete(timer);
      rescope();
    }, REOPEN_DELAY_MS);
    // A re-open must never be the reason this process stays up.
    timer.unref();
    timers.add(timer);
  };

  /** Stop one leg's subscriptions. The fiber is `null` only in the beat
   *  between a leg being put on the map and its fork being assigned, which
   *  nothing synchronous can observe — the interrupt then has nothing to reach
   *  and the leg is already off the map, so the stream's own exit arm drops it. */
  const close = (leg: Leg): void => {
    // The ancestor reads go with it: they are this leg's subscriptions over
    // this leg's client, and a re-open discovers the family again.
    for (const fiber of [leg.fiber, ...leg.ancestors.values()]) {
      if (fiber === null) continue;
      void Effect.runPromise(Fiber.interrupt(fiber)).catch((err: unknown) => {
        // An interrupt that itself fails has nothing left to tear down — the
        // fiber is finished either way, and the leg is already off the map — but
        // it is still something that went wrong inside a teardown, and a caught
        // error nobody can see is the one thing this repo does not allow. There
        // is no caller to throw at: a re-scope runs off a host-map callback.
        log.warn(
          { err },
          "kolu-server: the conductor's watch over a host did not close cleanly",
        );
      });
    }
  };

  /** Bring the legs in line with the watch list and the fleet: leg every host
   *  that holds a watched terminal and is answering, drop the rest, and
   *  re-open a leg whose client or whose set of watched ids has moved. */
  const rescope = (): void => {
    if (disposed) return;
    const grouped = byHost();
    for (const [host, leg] of [...legs]) {
      if (grouped.has(host)) continue;
      legs.delete(host);
      close(leg);
    }
    for (const [host, watched] of grouped) {
      const padi = hosts.padi(host);
      const leg = legs.get(host);
      if (padi === null) {
        // NOT GONE — not answering. The leg is dropped (its subscription is
        // over a link that is down) and the terminals on it are simply not
        // reported about until the host is back, which is the rule this whole
        // module is written around.
        if (leg !== undefined) {
          legs.delete(host);
          close(leg);
        }
        continue;
      }
      const ids = watched.map((one) => one.id);
      if (
        leg !== undefined &&
        leg.padi === padi &&
        leg.ids.length === ids.length &&
        ids.every((id) => leg.ids.includes(id))
      ) {
        continue;
      }
      if (leg !== undefined) {
        legs.delete(host);
        close(leg);
      }
      open(host, padi, watched);
    }
  };

  // MEMBERSHIP AND REACHABILITY BOTH, which is what this one callback carries
  // (`fleet/fleetHosts.ts` folds the two axes into it): a host that joins the
  // pool, one that leaves it, and one whose padi comes up or goes down.
  const offHosts = hosts.subscribe(rescope);
  rescope();

  return {
    rescope,
    dispose: async () => {
      disposed = true;
      offHosts();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      const running = [...legs.values()];
      legs.clear();
      // The interrupts are awaited so a shutdown does not race the streams it
      // is ending, and one that FAILS is said out loud: the process is on its
      // way out and there is nobody left to throw at, so the log is the only
      // place a teardown that did not go cleanly can be read afterwards.
      await Promise.all(
        running.flatMap((leg) =>
          [leg.fiber, ...leg.ancestors.values()].flatMap((fiber) =>
            fiber === null
              ? []
              : [
                  Effect.runPromise(Fiber.interrupt(fiber)).catch(
                    (err: unknown) => {
                      log.warn(
                        { err },
                        "kolu-server: the conductor's watch did not shut down cleanly",
                      );
                    },
                  ),
                ],
          ),
        ),
      );
    },
  };
}
