import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import {
  type PadiRoster,
  type PadiTerminal,
  type PadiUrgency,
  rosterIsEstablished,
} from "@kolu/padi-client/surface";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Cause, Effect, Fiber, Queue, Schedule, Stream } from "effect";
import {
  type ConductorHost,
  type HostView,
  type PrWatch,
  readingsOf,
} from "kolu-conductor";
import type { WorkId } from "kolu-work";
import { type FleetHosts, overConnectedHosts } from "kolu-mcp";
import { splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import type { Logger } from "pino";

const REOPEN_DELAY_MS = 3_000;

export interface ConductorWatcher {
  readonly scopeMoved: () => void;
  readonly dispose: () => Promise<void>;
}

type Frame =
  | { readonly kind: "urgency"; readonly urgency: PadiUrgency }
  | { readonly kind: "roster"; readonly roster: PadiRoster }
  | {
      readonly kind: "record";
      readonly id: string;
      readonly record: PadiTerminal;
    };

type WatchFrame =
  | { readonly kind: "view"; readonly view: HostView }
  | {
      readonly kind: "pr";
      readonly work: WorkId;
      readonly pr: PrResult;
    };

interface Accumulated {
  urgency: PadiUrgency | null;
  roster: PadiRoster | null;
  readonly records: Map<string, PadiTerminal>;
}

type Readiness =
  | { readonly kind: "silent" }
  | { readonly kind: "settling" }
  | {
      readonly kind: "ready";
      readonly ids: readonly string[];
      readonly urgency: PadiUrgency;
    };

const readinessOf = (at: Accumulated): Readiness => {
  const { urgency, roster } = at;
  if (urgency === null || roster === null) return { kind: "silent" };
  if (!rosterIsEstablished(roster) || !urgency.settled)
    return { kind: "settling" };
  return { kind: "ready", ids: roster.ids, urgency };
};

const hostViews = (
  host: string,
  hostName: string,
  padi: PadiSurfaceClient,
  watched: readonly string[],
): Stream.Stream<HostView, unknown> => {
  const members: Stream.Stream<Frame, unknown>[] = [
    Stream.map(
      padi.surface.urgency.get(undefined),
      (urgency): Frame => ({ kind: "urgency", urgency }),
    ),
    Stream.map(
      padi.surface.roster.get(undefined),
      (roster): Frame => ({ kind: "roster", roster }),
    ),
    ...watched.map((id) =>
      Stream.map(
        padi.surface.terminals.get({ key: id }),
        (record): Frame => ({ kind: "record", id, record }),
      ),
    ),
  ];
  return Stream.mapAccum(
    Stream.mergeAll(members, { concurrency: "unbounded" }),
    (): Accumulated => ({
      urgency: null,
      roster: null,
      records: new Map(),
    }),
    (at, frame) => {
      if (frame.kind === "urgency") at.urgency = frame.urgency;
      else if (frame.kind === "roster") at.roster = frame.roster;
      else at.records.set(frame.id, frame.record);
      const ready = readinessOf(at);
      if (ready.kind === "silent") return [at, []] as const;
      const view: HostView =
        ready.kind === "ready"
          ? {
              kind: "ready",
              host,
              hostName,
              watched,
              roster: new Set(ready.ids),
              urgency: ready.urgency,
              records: at.records,
            }
          : { kind: "settling", host, hostName, watched };
      return [at, [view]] as const;
    },
  );
};

interface WatchScope {
  readonly members: readonly string[];
  readonly branches: ReadonlyArray<PrWatch>;
}

const sameScope = (a: WatchScope, b: WatchScope): boolean =>
  a.members.length === b.members.length &&
  a.branches.length === b.branches.length &&
  a.members.every((one, i) => one === b.members[i]) &&
  a.branches.every((one, i) => {
    const other = b.branches[i];
    return (
      other !== undefined &&
      one.host === other.host &&
      one.repo === other.repo &&
      one.branch === other.branch
    );
  });

export function startConductorWatcher(deps: {
  readonly hosts: FleetHosts;
  readonly conductor: () => ConductorHost;
  readonly log: Logger;
}): ConductorWatcher {
  const { hosts, conductor, log } = deps;

  let moved: (() => void) | null = null;
  const moves = Stream.callback<void>((queue) =>
    Effect.gen(function* () {
      Queue.offerUnsafe(queue, undefined);
      moved = () => {
        Queue.offerUnsafe(queue, undefined);
      };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          moved = null;
        }),
      );
    }),
  );

  const orStandBy = <T>(
    read: () => readonly T[],
    saved: string,
  ): readonly T[] => {
    try {
      return read();
    } catch (err) {
      log.warn(
        { err },
        `kolu-server: ${saved} cannot be read — the watch is standing by and will conclude nothing about any terminal until they can`,
      );
      return [];
    }
  };

  const memberRefs = (): readonly string[] =>
    orStandBy(() => conductor().memberRefs(), "the Conductor's saved works");

  const prWatches = (): ReadonlyArray<PrWatch> =>
    orStandBy(
      () => conductor().prWatches(),
      "the Conductor's saved pull-request watches",
    );

  let openedScope: WatchScope | null = null;
  const scopeMoves = Stream.filter(moves, () => {
    const now: WatchScope = {
      members: memberRefs(),
      branches: prWatches(),
    };
    if (openedScope !== null && sameScope(openedScope, now)) return false;
    openedScope = now;
    return true;
  });

  const membersOn = (host: string): readonly string[] => {
    const ids: string[] = [];
    for (const ref of memberRefs()) {
      const split = splitFleetTerminalRef(ref);
      if (split !== null && split.host === host) ids.push(split.id);
    }
    return ids;
  };

  const unreachableFrames = (
    live: readonly string[],
  ): ReadonlyArray<readonly [string, WatchFrame]> => {
    const out: Array<readonly [string, WatchFrame]> = [];
    for (const ref of memberRefs()) {
      const split = splitFleetTerminalRef(ref);
      if (split === null || live.includes(split.host)) continue;
      if (out.some(([host]) => host === split.host)) continue;
      out.push([
        split.host,
        {
          kind: "view",
          view: {
            kind: "unreachable",
            host: split.host,
            hostName: hosts.display(split.host),
            watched: membersOn(split.host),
          },
        },
      ]);
    }
    return out;
  };

  const legs = Stream.switchMap(scopeMoves, () =>
    overConnectedHosts(
      hosts,
      (host, padi) => {
        const watched = membersOn(host);
        const branches = prWatches().filter((one) => one.host === host);
        if (watched.length === 0 && branches.length === 0) return null;
        const views = Stream.map(
          hostViews(host, hosts.display(host), padi, watched),
          (view): WatchFrame => ({ kind: "view", view }),
        );
        const branchPrs = branches.map((one) =>
          Stream.map(
            padi.surface.pullRequest.get({
              repoPath: one.repo,
              branch: one.branch,
            }),
            (pr): WatchFrame => ({ kind: "pr", work: one.work, pr }),
          ),
        );
        const leg = Stream.tapError(
          Stream.mergeAll([views, ...branchPrs], {
            concurrency: "unbounded",
          }),
          (err) =>
            Effect.sync(() => {
              log.warn(
                { err, host },
                "kolu-server: the conductor's watch over a host stopped; re-opening",
              );
            }),
        );
        return Stream.retry(
          Stream.repeat(leg, Schedule.spaced(REOPEN_DELAY_MS)),
          Schedule.spaced(REOPEN_DELAY_MS),
        );
      },
      (live, frames) =>
        Stream.concat(Stream.fromIterable(unreachableFrames(live)), frames),
    ),
  );

  const fiber = Effect.runFork(
    Effect.onExit(
      Stream.runForEach(legs, ([, frame]) =>
        Effect.sync(() => {
          if (frame.kind === "pr") {
            conductor().observedPr(frame.work, frame.pr);
            return;
          }
          const seen = readingsOf(frame.view);
          if (seen.length > 0) conductor().observe(seen);
        }),
      ),
      (exit) =>
        Effect.sync(() => {
          if (exit._tag === "Success" || Cause.hasInterruptsOnly(exit.cause))
            return;
          log.error(
            { err: Cause.squash(exit.cause) },
            "kolu-server: the conductor's watch died — nothing will wake the Conductor until kolu-server restarts",
          );
        }),
    ),
  );

  return {
    scopeMoved: () => moved?.(),
    dispose: async () => {
      await Effect.runPromise(Fiber.interrupt(fiber)).catch((err: unknown) => {
        log.warn(
          { err },
          "kolu-server: the conductor's watch did not shut down cleanly",
        );
      });
    },
  };
}
