/**
 * `fleetSurface` — the CONTRACT the fleet MCP face stands on: padi's members,
 * lifted over kolu-server's host map.
 *
 * It is a real `defineSurface` spec and not a hand-written tool list for the
 * reason the adapter is a projection at all: `@kolu/surface-mcp` can only serve
 * what a SPEC declares — a resource is a primitive of the served surface, its
 * JSON Schema is the member's own, and the expose map is checked against the
 * spec at boot. A fleet face assembled out of bespoke tools alone could not
 * carry `terminals`/`urgency`/`hosts` as subscribable resources at all.
 *
 * **Every value schema is padi's, imported.** `PadiTerminalSchema`,
 * `GitStatusOutputSchema`, `PadiScreenHistoryOutputSchema` and the declared
 * error unions arrive whole from the packages that own them, so a record an
 * agent reads over this face is byte-identical to the one it reads over the
 * stdio face. The ONE thing this surface changes is the IDENTITY TYPE: where
 * padi says `TerminalIdSchema`, the fleet says {@link FleetTerminalRefSchema},
 * and where a repo-scoped verb was implicitly "this host", the fleet makes the
 * host an explicit field. That is the whole of the lift, and it is spelled by
 * SPREADING padi's own struct and overriding exactly the id-bearing key — so a
 * field added to `git.getStatus` upstream arrives here with no edit, and a field
 * RENAMED there stops this file compiling.
 *
 * **Why `hosts` instead of `identity`/`status`/`daemonStatus`.** Those three are
 * per-host health facts. Fleet-wide there is no single answer to "what commit is
 * padi?" — there are N answers, one per host — so they are COLUMNS of the one
 * `hosts` resource rather than three resources that would each have to invent a
 * fleet-wide reading of a per-host thing. A host that is not connected still has
 * a row (with null columns), because "which hosts exist and which are reachable"
 * is exactly what an agent needs before it can be told its call was refused.
 */

import {
  FsGitReadErrorSchema,
  PadiScreenHistoryInputSchema,
  PadiScreenHistoryOutputSchema,
  PadiTerminalSchema,
  type PadiUrgencySchema,
  PadiWatchNameInputSchema,
  PtyHostIdentitySchema,
  TerminalInfoSchema,
  TerminalNotFound,
  WatchSubscriptionNotFound,
} from "@kolu/padi-client/surface";
import { defineSurface } from "@kolu/surface/define";
import {
  FsFileInputSchema,
  FsReadFileTextOutputSchema,
} from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
} from "kolu-git/schemas";
import { FleetHostKeySchema, FleetTerminalRefSchema } from "./refSchema.ts";

/** An id list at fleet refs — the one re-typing this surface performs, named so
 *  the four urgency lists below are visibly the SAME change four times. */
const FleetRefs = Schema.Array(FleetTerminalRefSchema);

/** padi's urgency, with every id list host-qualified.
 *
 *  The `satisfies` is the drift gate: it demands this struct's key set be
 *  EXACTLY `PadiUrgencySchema`'s, so a fifth attention list added to padi fails
 *  the build here rather than silently never reaching the fleet — which would
 *  read, on an agent's side, as a fleet where nobody is ever asking. */
export const FleetUrgencySchema = Schema.Struct({
  awaitingIds: FleetRefs,
  finishedIds: FleetRefs,
  workingIds: FleetRefs,
  lingerIds: FleetRefs,
} satisfies Record<keyof typeof PadiUrgencySchema.fields, typeof FleetRefs>);
export type FleetUrgency = typeof FleetUrgencySchema.Type;

/** Nobody is asking, on any host. The cell's default and the empty fold's
 *  answer — one value, so "no hosts yet" and "no host needs attention" cannot
 *  be two different shapes. */
export const EMPTY_FLEET_URGENCY: FleetUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
};

/** How reachable one host is, in kolu-server's own three words. `warming` is a
 *  host whose padi is being brought up — the state a remote spends its first
 *  seconds in, and the reason a fleet roster must be able to say "not yet"
 *  instead of omitting the row. */
export const FleetHostStateSchema = Schema.Literals([
  "warming",
  "connected",
  "failed",
]);
export type FleetHostState = typeof FleetHostStateSchema.Type;

/** One row of the live roster: who the host is, whether it is answering, and —
 *  when it is — the per-host health facts the stdio face serves as `identity`
 *  and `status`.
 *
 *  The three build facts are NULLABLE rather than absent-when-unknown: a row is
 *  the same shape whatever state the host is in, so an agent reads
 *  `state === "connected"` to decide and never has to tell "this host has no
 *  commit" from "this key is missing". `expectedKaval` keeps padi's own
 *  optionality — it is optional ON a connected host too (a padi built without
 *  the kaval identity has none), which is a different fact from "not connected
 *  yet" and is kept distinguishable from it. */
export const FleetHostSchema = Schema.Struct({
  /** The encoded host key — the same string that keys this collection, carried
   *  IN the row so a reader holding one record alone still knows whose it is. */
  host: FleetHostKeySchema,
  /** What a person calls this host (kolu-server's label for it). */
  display: Schema.String,
  state: FleetHostStateSchema,
  /** That padi's build commit, or null while it is not answering. */
  commit: Schema.NullOr(Schema.String),
  /** The padi surface contract version it reports, or null. */
  surfaceVersion: Schema.NullOr(Schema.String),
  /** ms epoch of that padi's boot, or null — the generation an agent compares
   *  to see "the daemon restarted under me". */
  startedAt: Schema.NullOr(Schema.Number),
  /** The kaval that padi would spawn, when it declares one. */
  expectedKaval: Schema.optionalKey(PtyHostIdentitySchema),
});
export type FleetHost = typeof FleetHostSchema.Type;

/** `screen.history` over the fleet: padi's own input, addressed by reference. */
export const FleetScreenHistoryInputSchema = Schema.Struct({
  ...PadiScreenHistoryInputSchema.fields,
  id: FleetTerminalRefSchema,
});

/** `lifecycle.kill` over the fleet: padi's own `{id}` in, padi's own
 *  `TerminalInfo` out — with the answered id re-qualified, so the id a caller
 *  reads back is one it can call again. */
export const FleetTerminalIdInputSchema = Schema.Struct({
  id: FleetTerminalRefSchema,
});
export const FleetTerminalInfoSchema = Schema.Struct({
  ...TerminalInfoSchema.fields,
  id: FleetTerminalRefSchema,
});

/** A repo-scoped read, on a named host. These four verbs address a REPOSITORY,
 *  not a terminal, so there is no reference to carry the host for them — the
 *  host is its own required field, and a missing one is refused by the decoder
 *  rather than defaulting to `local`, which would read a stranger's tree and
 *  answer confidently. */
const onHost = <F extends Schema.Struct.Fields>(
  fields: F,
): Schema.Struct<F & { host: typeof FleetHostKeySchema }> =>
  Schema.Struct({ ...fields, host: FleetHostKeySchema });

export const fleetSurface = defineSurface({
  cells: {
    /** Who needs someone, across every host. */
    urgency: {
      schema: FleetUrgencySchema,
      default: EMPTY_FLEET_URGENCY,
      verbs: ["get"],
    },
  },
  collections: {
    /** Every terminal on every connected host, keyed by fleet reference. */
    terminals: {
      keySchema: FleetTerminalRefSchema,
      schema: PadiTerminalSchema,
      verbs: ["keys", "get"],
    },
    /** The live roster — and it CHANGES under a reader: hosts arrive and leave
     *  while a conversation is open, which is the whole reason the fleet face
     *  exists rather than one MCP server per host. */
    hosts: {
      keySchema: FleetHostKeySchema,
      schema: FleetHostSchema,
      verbs: ["keys", "get"],
    },
  },
  procedures: {
    screen: {
      history: {
        input: FleetScreenHistoryInputSchema,
        output: PadiScreenHistoryOutputSchema,
        error: TerminalNotFound,
      },
    },
    lifecycle: {
      kill: {
        input: FleetTerminalIdInputSchema,
        output: FleetTerminalInfoSchema,
        error: TerminalNotFound,
      },
    },
    git: {
      getStatus: {
        input: onHost(GitStatusInputSchema.fields),
        output: GitStatusOutputSchema,
        error: FsGitReadErrorSchema,
      },
      getDiff: {
        input: onHost(GitDiffInputSchema.fields),
        output: GitDiffOutputSchema,
        error: FsGitReadErrorSchema,
      },
    },
    fs: {
      listAll: {
        input: onHost(FsListAllInputSchema.fields),
        output: FsListAllOutputSchema,
        error: FsGitReadErrorSchema,
      },
      readFile: {
        input: onHost(FsFileInputSchema.fields),
        output: FsReadFileTextOutputSchema,
        error: FsGitReadErrorSchema,
      },
    },
    watch: {
      /** A fleet watch has ONE name across every host it is legged onto, so
       *  closing it takes the name and nothing else — the per-host legs are the
       *  face's bookkeeping, never the caller's. */
      close: {
        input: PadiWatchNameInputSchema,
        output: Schema.Struct({}),
        error: WatchSubscriptionNotFound,
      },
    },
  },
});

export type FleetSurfaceSpec = (typeof fleetSurface)["spec"];
