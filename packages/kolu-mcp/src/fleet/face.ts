import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type {
  PadiRoster,
  PadiTerminal,
  PadiUrgency,
} from "@kolu/padi-client/surface";
import type { SurfaceClientCallable } from "@kolu/surface/client";
import {
  resolveCellVerbs,
  resolveCollectionVerbs,
  type SurfaceSpec,
} from "@kolu/surface/define";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import type { ToolFailure } from "@kolu/surface-mcp/tools";
import type {
  FsFileInputSchema,
  TerminalId,
} from "@kolu/terminal-vocab/schema";
import { Effect, Queue, Stream } from "effect";
import type {
  FsListAllInputSchema,
  GitDiffInputSchema,
  GitStatusInputSchema,
} from "kolu-git/schemas";
import { WAITER_OF } from "kolu-work";
import {
  EMPTY_FLEET_URGENCY,
  type FleetHost,
  type FleetTerminal,
  type FleetUrgency,
  type FleetWorksView,
  fleetSurface,
} from "./fleetSurface.ts";
import { type FleetHosts, requireHost, requireTerminal } from "./hosts.ts";
import { hostRoster, overConnectedHosts } from "./overHosts.ts";
import { fleetTerminalRef, splitFleetTerminalRef } from "./ref.ts";
import {
  answerSaid,
  type FleetWorks,
  memberWithHost,
  standingWords,
} from "./works.ts";

type GitStatusInput = typeof GitStatusInputSchema.Type;
type GitDiffInput = typeof GitDiffInputSchema.Type;
type FsListAllInput = typeof FsListAllInputSchema.Type;
type FsFileInput = typeof FsFileInputSchema.Type;

function foldOnceEveryHostHasSpoken<T, F>(
  hosts: FleetHosts,
  per: (padi: PadiSurfaceClient) => Stream.Stream<T, unknown>,
  fold: (seen: ReadonlyMap<string, T>, live: readonly string[]) => F,
  empty: F,
): Stream.Stream<F, unknown> {
  return overConnectedHosts(
    hosts,
    (_host, padi) => per(padi),
    (live, frames) =>
      live.length === 0
        ? Stream.make(empty)
        : Stream.mapAccum(
            frames,
            () => new Map<string, T>(),
            (seen, [host, value]) => {
              seen.set(host, value);
              const everyHostHasSpoken = seen.size >= live.length;
              return [
                seen,
                everyHostHasSpoken ? [fold(seen, live)] : [],
              ] as const;
            },
          ),
  );
}

function fleetTerminalKeys(
  hosts: FleetHosts,
): Stream.Stream<string[], unknown> {
  return foldOnceEveryHostHasSpoken<readonly TerminalId[], string[]>(
    hosts,
    (padi) =>
      Stream.map(
        Stream.filter(
          padi.surface.roster.get(undefined),
          (standing: PadiRoster) => standing.kind === "established",
        ),
        (standing) => (standing.kind === "established" ? standing.ids : []),
      ),
    (seen, live) =>
      live.flatMap((host) =>
        (seen.get(host) ?? []).map((id) => fleetTerminalRef(host, id)),
      ),
    [],
  );
}

function fleetUrgency(hosts: FleetHosts): Stream.Stream<FleetUrgency, unknown> {
  return foldOnceEveryHostHasSpoken<PadiUrgency, FleetUrgency>(
    hosts,
    (padi) => padi.surface.urgency.get(undefined),
    (seen, live) => {
      const column = (
        pick: (one: PadiUrgency) => readonly TerminalId[],
      ): string[] =>
        live.flatMap((host) => {
          const one = seen.get(host);
          return one === undefined
            ? []
            : pick(one).map((id) => fleetTerminalRef(host, id));
        });
      return {
        awaitingIds: column((one) => one.awaitingIds),
        finishedIds: column((one) => one.finishedIds),
        workingIds: column((one) => one.workingIds),
        lingerIds: column((one) => one.lingerIds),
      };
    },
    EMPTY_FLEET_URGENCY,
  );
}

function hostRow(
  hosts: FleetHosts,
  key: string,
): Effect.Effect<FleetHost, unknown> {
  const base = {
    host: key,
    display: hosts.display(key),
    state: hosts.state(key),
  };
  const padi = hosts.padi(key);
  if (padi === null) {
    return Effect.succeed({
      ...base,
      commit: null,
      surfaceVersion: null,
      startedAt: null,
    });
  }
  return Effect.map(
    Effect.all([
      firstFrameOrThrow(
        padi.surface.identity.get(undefined),
        `host ${key}: padi identity yielded no snapshot frame — link or protocol failure.`,
      ),
      firstFrameOrThrow(
        padi.surface.status.get(undefined),
        `host ${key}: padi status yielded no snapshot frame — link or protocol failure.`,
      ),
    ]),
    ([identity, status]) => ({
      ...base,
      commit: identity.commit,
      surfaceVersion: identity.surfaceVersion,
      startedAt: identity.startedAt,
      ...(status.expectedKaval === undefined
        ? {}
        : { expectedKaval: status.expectedKaval }),
    }),
  );
}

function fleetRoster(
  hosts: FleetHosts,
): Stream.Stream<readonly FleetHost[], unknown> {
  return Stream.switchMap(hostRoster(hosts), (keys) =>
    Stream.fromEffect(
      Effect.all(
        keys.map((key) => hostRow(hosts, key)),
        { concurrency: "unbounded" },
      ),
    ),
  );
}

function worksRows(hosts: FleetHosts, works: FleetWorks): FleetWorksView {
  const fleet = new Set(hosts.keys());
  const rows = works.rows();
  return {
    works: rows.works.map((work) => ({
      ...work,
      mode: answerSaid(work.mode),
      onGreen: answerSaid(work.onGreen),
      standing: {
        who: WAITER_OF[work.standing.why],
        what: standingWords(work.standing),
        since: work.standing.since,
      },
      openQuestions: work.openQuestions,
      members: work.members.map((member) =>
        memberWithHost(hosts, fleet, member, splitFleetTerminalRef),
      ),
    })),
    finished: rows.finished,
  };
}

function fleetWorks(
  hosts: FleetHosts,
  works: FleetWorks,
): Stream.Stream<FleetWorksView> {
  return Stream.callback<FleetWorksView>((queue) =>
    Effect.gen(function* () {
      const push = (): void => {
        Queue.offerUnsafe(queue, worksRows(hosts, works));
      };
      push();
      const offWorks = works.subscribe(push);
      const offHosts = hosts.subscribe(push);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          offWorks();
          offHosts();
        }),
      );
    }),
  );
}

function onNamedHost<I extends { readonly host: string }>(
  hosts: FleetHosts,
  input: I,
): Effect.Effect<
  { readonly padi: PadiSurfaceClient; readonly rest: Omit<I, "host"> },
  ToolFailure
> {
  const { host, ...rest } = input;
  return Effect.map(requireHost(hosts, host), (padi) => ({
    padi,
    rest: rest as Omit<I, "host">,
  }));
}

function fleetTerminalRow(
  host: string,
  id: string,
  record: PadiTerminal,
): FleetTerminal {
  return {
    ...record,
    host,
    id: fleetTerminalRef(host, id),
    ...(record.parentId === undefined
      ? {}
      : { parentId: fleetTerminalRef(host, record.parentId) }),
  } as FleetTerminal;
}

export function fleetClientFace(
  hosts: FleetHosts,
  works: FleetWorks,
): SurfaceClientCallable {
  return {
    surface: {
      terminals: {
        keys: () => fleetTerminalKeys(hosts),
        get: (input: { key: string }) =>
          Stream.unwrap(
            Effect.map(
              requireTerminal(hosts, input.key),
              ({ host, id, padi }): Stream.Stream<FleetTerminal, unknown> =>
                Stream.map(padi.surface.terminals.get({ key: id }), (record) =>
                  fleetTerminalRow(host, id, record),
                ),
            ),
          ),
      },
      hosts: {
        get: () => fleetRoster(hosts),
      },
      works: {
        get: () => fleetWorks(hosts, works),
      },
      urgency: { get: () => fleetUrgency(hosts) },
      screen: {
        history: (input: { id: string; before?: number; max: number }) =>
          Effect.flatMap(requireTerminal(hosts, input.id), ({ id, padi }) =>
            padi.surface.screen.history({ ...input, id }),
          ),
      },
      lifecycle: {
        kill: (input: { id: string }) =>
          Effect.flatMap(
            requireTerminal(hosts, input.id),
            ({ host, id, padi }) =>
              Effect.map(padi.surface.lifecycle.kill({ id }), (info) => {
                const ref = fleetTerminalRef(host, info.id);
                works.closed(ref);
                return { ...info, id: ref };
              }),
          ),
      },
      git: {
        getStatus: (input: GitStatusInput & { host: string }) =>
          Effect.flatMap(onNamedHost(hosts, input), ({ padi, rest }) =>
            padi.surface.git.getStatus(rest),
          ),
        getDiff: (input: GitDiffInput & { host: string }) =>
          Effect.flatMap(onNamedHost(hosts, input), ({ padi, rest }) =>
            padi.surface.git.getDiff(rest),
          ),
      },
      fs: {
        listAll: (input: FsListAllInput & { host: string }) =>
          Effect.flatMap(onNamedHost(hosts, input), ({ padi, rest }) =>
            padi.surface.fs.listAll(rest),
          ),
        readFile: (input: FsFileInput & { host: string }) =>
          Effect.flatMap(onNamedHost(hosts, input), ({ padi, rest }) =>
            padi.surface.fs.readFile(rest),
          ),
      },
    },
  };
}

function faceGaps(spec: SurfaceSpec, face: SurfaceClientCallable): string[] {
  const gaps: string[] = [];
  const need = (member: string, verb: string): void => {
    if (typeof face.surface[member]?.[verb] !== "function") {
      gaps.push(`${member}.${verb}`);
    }
  };
  for (const [key, cell] of Object.entries(spec.cells ?? {})) {
    for (const verb of resolveCellVerbs(cell)) need(key, verb);
  }
  for (const [key, collection] of Object.entries(spec.collections ?? {})) {
    for (const verb of resolveCollectionVerbs(collection)) need(key, verb);
  }
  for (const [ns, verbs] of Object.entries(spec.procedures ?? {})) {
    for (const verb of Object.keys(verbs)) need(ns, verb);
  }
  return gaps;
}

export function assertFleetFaceComplete(face: SurfaceClientCallable): void {
  const gaps = faceGaps(fleetSurface.spec, face);
  if (gaps.length > 0) {
    throw new Error(
      `kolu-mcp fleet: fleetSurface declares members this face does not answer — ${gaps.join(", ")}. The spec and the projection are one statement; serving half of it would advertise tools whose first call fails.`,
    );
  }
}
