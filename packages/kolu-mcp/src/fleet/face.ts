/**
 * The CLIENT FACE of `fleetSurface` — one object shaped exactly like a dialled
 * surface client, whose members fold kolu-server's host map.
 *
 * ## Why a face and not a served surface
 *
 * The obvious shape is `implementSurface(fleetSurface, deps)` dialled over
 * `directDispatch`, and for a surface that OWNS state it is the right one. This
 * surface owns none. Every member here is a projection of facts that live on
 * other machines, and `implementSurface`'s collection seam is a store:
 * `readAll(): Map<K, V>`, synchronous, answered from memory. Satisfying it
 * would mean MIRRORING every host's roster into this package — a second copy of
 * the thing kolu-server already mirrors, with its own staleness, its own
 * re-subscribe logic, and its own way of being wrong about a host that left
 * between two reads.
 *
 * A projection has no such copy: `terminals.keys()` is the hosts' own key
 * streams merged, `terminals.get(ref)` is the owning host's own `get`
 * forwarded, and a value is as fresh as the host that answered. The adapter
 * never knows the difference — it reads `client.surface.<member>.<verb>()` and
 * gets the streams and effects the contract promises.
 *
 * What `implementSurface` WOULD have given for free is the proof that every
 * declared member is implemented. {@link faceGaps} is that proof, taken at boot
 * from the spec's own verb resolvers: a member added to `fleetSurface` with no
 * implementation here refuses to serve rather than failing at an agent's first
 * call.
 *
 * ## Liveness
 *
 * Each aggregate re-subscribes when the ROSTER moves (`FleetHosts.subscribe`)
 * and re-emits when any host's own stream does. That is what makes a host
 * arriving mid-conversation visible: the MCP adapter holds a subscription to
 * `surface://collections/terminals`, and a new host's terminals arrive on it as
 * a `notifications/resources/updated` — no reopened session, no new server.
 *
 * The merge emits on EVERY host's frame rather than waiting for all of them:
 * one unreachable-but-connected host must not be able to withhold the whole
 * fleet's roster from a read, which is the fail-open rule the watch states one
 * file over.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
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
import {
  EMPTY_FLEET_URGENCY,
  type FleetHost,
  type FleetTerminal,
  type FleetUrgency,
  fleetSurface,
} from "./fleetSurface.ts";
import { type FleetHosts, requireHost, requireTerminal } from "./hosts.ts";
import { fleetTerminalRef } from "./ref.ts";

// The four repo-scoped verbs take padi's own input, plus a host. Named off the
// SCHEMAS padi declares them with, so a field added upstream arrives here
// without an edit and a renamed one stops this compiling.
type GitStatusInput = typeof GitStatusInputSchema.Type;
type GitDiffInput = typeof GitDiffInputSchema.Type;
type FsListAllInput = typeof FsListAllInputSchema.Type;
type FsFileInput = typeof FsFileInputSchema.Type;

/** The roster, now and on every move. The payload is the host keys; readers
 *  that only need the CHANGE ignore it and re-read what they care about. */
function hostRoster(hosts: FleetHosts): Stream.Stream<readonly string[]> {
  return Stream.callback<readonly string[]>((queue) =>
    Effect.gen(function* () {
      const push = (): void => {
        Queue.offerUnsafe(queue, hosts.keys());
      };
      // Emit the current roster BEFORE subscribing: a resource read takes the
      // first frame, and a stream that only spoke on change would make a read
      // of a quiet fleet hang forever.
      push();
      const off = hosts.subscribe(push);
      yield* Effect.addFinalizer(() => Effect.sync(off));
    }),
  );
}

/** One per-host stream, tagged with its host and merged with its siblings,
 *  re-folded into a fleet-wide value on every frame.
 *
 *  `mapAccum`, not `scan`: `scan` emits its seed first, and a seeded empty
 *  frame on a resource read is the lie this whole face exists to prevent — an
 *  agent reading "no terminals" from a fleet that has not answered yet.
 *
 *  For the same reason the FIRST frame is withheld until EVERY connected host
 *  has spoken. A resource read takes the first frame, so emitting on the first
 *  host's snapshot would answer "the fleet is these two terminals" while a
 *  third was on a machine that had simply not replied yet — a partial roster an
 *  agent cannot tell from a complete one. Every surface member opens with a
 *  snapshot by contract, so this waits on an obligation rather than on luck,
 *  and it waits only on CONNECTED hosts — one that is not connected is not in
 *  the fold at all, and is refused by name when addressed. After that first
 *  frame every later one is emitted as it arrives.
 *
 *  Which hosts those are, and the client each is read through, are decided in
 *  ONE pass here. `per` is handed the client and asked only which member to
 *  read: a seam where the caller answered "is this host connected" as well
 *  would have both sides reaching for `hosts.padi`, and `padi() !== null` is
 *  the test — the client is what a fold actually reads, so a roster claiming
 *  `connected` over a client that is gone would make this throw instead of
 *  answering short. A fold is about RIGHT NOW, which is why an absent host is
 *  simply not in it; the standing watch parks that host's leg instead, because
 *  a subscription is about a host over TIME (`watch.ts`).
 */
function foldHosts<T, F>(
  hosts: FleetHosts,
  per: (padi: PadiSurfaceClient) => Stream.Stream<T, unknown>,
  fold: (seen: ReadonlyMap<string, T>, live: readonly string[]) => F,
  empty: F,
): Stream.Stream<F, unknown> {
  return Stream.switchMap(hostRoster(hosts), () => {
    const live: string[] = [];
    const legs: Stream.Stream<readonly [string, T], unknown>[] = [];
    for (const host of hosts.keys()) {
      const padi = hosts.padi(host);
      if (padi === null) continue;
      live.push(host);
      legs.push(Stream.map(per(padi), (value) => [host, value] as const));
    }
    if (legs.length === 0) return Stream.make(empty);
    return Stream.mapAccum(
      Stream.mergeAll(legs, { concurrency: "unbounded" }),
      () => new Map<string, T>(),
      (seen, [host, value]) => {
        seen.set(host, value);
        return [
          seen,
          seen.size < live.length ? [] : [fold(seen, live)],
        ] as const;
      },
    );
  });
}

/** Every terminal on every connected host, host-qualified, in roster order
 *  (local first) and each host's own order within it. */
function fleetTerminalKeys(
  hosts: FleetHosts,
): Stream.Stream<string[], unknown> {
  return foldHosts<readonly TerminalId[], string[]>(
    hosts,
    (padi) => padi.surface.terminals.keys(undefined),
    (seen, live) =>
      live.flatMap((host) =>
        (seen.get(host) ?? []).map((id) => fleetTerminalRef(host, id)),
      ),
    [],
  );
}

/** Who needs someone, fleet-wide: each host's four id lists, host-qualified
 *  and concatenated in roster order. */
function fleetUrgency(hosts: FleetHosts): Stream.Stream<FleetUrgency, unknown> {
  return foldHosts<PadiUrgency, FleetUrgency>(
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

/** One roster row. A host that is not answering still has a row — the nulls
 *  ARE the answer, and they are what lets an agent read "that machine is
 *  warming" instead of inferring it from a call that failed.
 *
 *  It takes a key the ROSTER produced, so there is no membership check here:
 *  {@link fleetRoster} walks `hosts.keys()`, and a key read out of the live
 *  pool one line earlier cannot be a stranger's. */
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

/** THE WHOLE ROSTER, re-read on every move — one answer to "which hosts can I
 *  use", rather than a key set plus a read per host.
 *
 *  Rows are gathered CONCURRENTLY: each connected host's row is two first-frame
 *  reads off that host's own mirror, and done in series the roster would wait
 *  for the sum of every host's priming instead of the slowest one. Order is
 *  the roster's either way (`Effect.all` answers in input order), so local
 *  stays first.
 *
 *  A host that is connected and CANNOT answer fails this read, by name
 *  (`firstFrameOrThrow` says which host and which member). That is the honest
 *  trade for one read: the alternative is a row of invented nulls that reads
 *  exactly like a host that is merely warming, which is the fallback this
 *  face's whole refusal vocabulary exists to avoid. */
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

/** The host a repo-scoped verb names, and that host's client. These four verbs
 *  address a repository rather than a terminal, so the host is a field of their
 *  own rather than something a reference carries. */
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

/** padi's record, as a FLEET row: the host it came from, its own reference,
 *  and its parent's.
 *
 *  The lift happens here rather than at the host because padi is answering
 *  about its own machine, where a bare id is unambiguous. It is the MERGE that
 *  makes identity ambiguous, so the merge is what owes every row its host —
 *  the same rule `terminals.keys` and the urgency fold already follow, applied
 *  to the one member that hands back a record instead of a list.
 *
 *  `as FleetTerminal`: the padi record is a three-arm union and TypeScript
 *  widens a spread of one to its own arm's shape, so the three overridden
 *  fields cannot be proven to land on the arm they came from. The schema one
 *  file over is the real check, and it is per-arm for exactly this reason. */
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

/** The whole face. */
export function fleetClientFace(hosts: FleetHosts): SurfaceClientCallable {
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
        // The WHOLE roster, not just the connected part: "which machines exist
        // and what is each doing" is the question this resource answers, and a
        // warming host omitted from it reads as a host that is not yours.
        get: () => fleetRoster(hosts),
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
              Effect.map(padi.surface.lifecycle.kill({ id }), (info) => ({
                ...info,
                id: fleetTerminalRef(host, info.id),
              })),
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
      // No `watch` member: the fleet face no longer serves a standing
      // subscription at all. The conductor is WOKEN by kolu-server (its watch
      // list, `watchList.ts`) rather than draining a queue it has to stay in a
      // call for, and `fleetSurface` dropped the member to match — a face
      // answering a verb its own spec does not declare is a tool nothing can
      // reach and a reader cannot explain.
    },
  };
}

/** Every `<member>.<verb>` the spec declares and the face does not answer.
 *
 *  The verb sets come from the FRAMEWORK's own resolvers, not a second reading
 *  of `spec.verbs`, so "which verbs does a cell with `verbs: ["get"]` have" is
 *  answered here exactly as `defineSurface` answered it when it minted them. */
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

/** Refuse to serve a face that does not answer its own contract. This is the
 *  one thing `implementSurface` would have given for free, and it is worth
 *  taking at boot: an unimplemented member is otherwise a tool that lists fine
 *  and fails at the first call, in a conversation that has already been told
 *  the terminal is there. */
export function assertFleetFaceComplete(face: SurfaceClientCallable): void {
  const gaps = faceGaps(fleetSurface.spec, face);
  if (gaps.length > 0) {
    throw new Error(
      `kolu-mcp fleet: fleetSurface declares members this face does not answer — ${gaps.join(", ")}. The spec and the projection are one statement; serving half of it would advertise tools whose first call fails.`,
    );
  }
}
