/**
 * `@kolu/terminal-workspace/surface` — the ONE `@kolu/surface` the `arivu`
 * daemon serves, `arivu-tui` reads, and (in R8) a remote kolu-server mirrors.
 * It is the consume-facing dual of the host-side workspace the library owns: a
 * keyed `AwarenessValue` collection (one entry per terminal a kaval owns), the
 * `version` handshake cell, the `activity` flow stream, and — added in R6 — the
 * Code tab's fs/git reads (procedures) plus their live change-pulses (watcher
 * streams).
 *
 * This module is the BROWSER-SAFE face of the package: it imports only
 * `@kolu/surface/define` (its own doc notes it pulls just `@orpc/contract` +
 * `zod`), the zod-only `kolu-git/schemas`, this package's zod-only `./schema`,
 * and `zod`. It does NOT import `./endpoint` / `./serveFsGit` (which run the
 * sensors / shell out to git), nor the package root, so a viewer or remote-kolu
 * consumer imports the surface without dragging in any `node:`/kaval runtime —
 * the same discipline `./schema` keeps today.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
} from "kolu-git/schemas";
import { z } from "zod";
import { AwarenessValueSchema, TerminalIdSchema } from "./schema.ts";

/** The wire-shape `major.minor` of the workspace surface this build serves and
 *  expects. Bumped only when `terminalWorkspaceSurface` itself changes shape —
 *  additive (a new optional field / a new stream / a new procedure) is a minor
 *  bump, breaking a major. The remote dial gates an incompatible host into
 *  re-provision via `isContractVersionCompatible`. `0.2 → 0.3` adds the fs/git
 *  procedures + the two watcher streams (additive): a `0.2` daemon a `0.3`
 *  viewer dials reads as `skew` because it can't serve them, which is exactly
 *  the gate's job. */
export const TERMINAL_WORKSPACE_CONTRACT_VERSION = "0.3";

/** The `version` cell payload — the daemon's self-declared contract version. */
export const VersionSchema = z.object({ contractVersion: z.string() });
export type Version = z.infer<typeof VersionSchema>;

/** The value a fresh `version` subscriber sees before the daemon overrides it
 *  (it never does today — the default IS this build's version). */
export const DEFAULT_VERSION: Version = {
  contractVersion: TERMINAL_WORKSPACE_CONTRACT_VERSION,
};

/** A repo/file change PULSE, not data. kolu-git's `subscribeRepoChange` /
 *  `subscribeFileChange` collapse a burst of fs events into a payload-free
 *  `onChange()`, so a watcher stream's frame must DIFFER each tick or the
 *  stream's `isEqual` dedup would collapse two consecutive changes into one.
 *  The monotonic `seq` (per subscription, starting at 0 for the snapshot frame)
 *  is that distinguisher. A consumer reacts to a new pulse by re-querying the
 *  `fs.*` / `git.*` procedures — the pulse carries no fs/git data itself. */
export const RepoChangePulseSchema = z.object({
  seq: z.number().int().nonnegative(),
});
export type RepoChangePulse = z.infer<typeof RepoChangePulseSchema>;

/** Input for the per-file fs procedures (`readFile`, `statFileMtimeMs`) and the
 *  `subscribeFileChange` watcher. Deliberately NOT kolu-git's
 *  `FsReadFileInputSchema` (which carries a `terminalId`) — the library reads a
 *  file in a repo; the terminal/iframe-preview orchestration that needs the id
 *  stays kolu-server's. */
export const FsFileInputSchema = z.object({
  repoPath: z.string(),
  filePath: z.string(),
});

/** Output of `fs.readFile` — the raw text read. Deliberately NOT kolu-git's
 *  `FsReadFileOutputSchema` (the text|binary discriminated union): the
 *  binary-preview/iframe-URL branch is kolu-server orchestration layered on top
 *  of this raw read, never library code. */
export const FsReadFileTextOutputSchema = z.object({
  content: z.string(),
  truncated: z.boolean(),
});

/** The terminal-workspace surface — ARIVU's home today. R6 ships one fs/git
 *  IMPL (`createTerminalWorkspaceEndpoint`) with two homes, NOT one surface both
 *  serve: kolu-server (in-process) re-exposes the reads on `koluSurface`'s
 *  value-bearing streams, while arivu (remote) serves them on THIS surface. The
 *  two contract shapes are deliberately different (R8's remote kolu re-queries
 *  procedures rather than streaming full diffs over the wire); the single shared
 *  surface both homes serve is closed in R8 when kolu mirrors this surface whole
 *  (via R7's total mirror). The primitives differ only in KIND:
 *   - the `awareness` collection (keyed current state) + `version` cell (a
 *     single current value) are the STATEFUL primitives;
 *   - `activity` is the FLOW primitive — the live "bytes moving right now" the
 *     Dock paints as a green dot, derived from kaval's raw byte tap (distinct
 *     from `AwarenessValue.lastActivityAt`, the slow agent staleness clock), so
 *     it can't be a collection field;
 *   - the `fs.*` / `git.*` PROCEDURES are the Code tab's raw reads (request →
 *     response, never persisted), and `subscribeRepoChange` /
 *     `subscribeFileChange` are WATCHER STREAMS that pulse on each live change.
 *
 *  The value schema is the GENERIC `AwarenessValue` — no `location`, no kolu UI
 *  fields; kolu's own record is built on top of this, never the other way
 *  round. */
export const terminalWorkspaceSurface = defineSurface({
  cells: {
    version: { schema: VersionSchema, default: DEFAULT_VERSION },
  },
  collections: {
    awareness: {
      keySchema: TerminalIdSchema,
      schema: AwarenessValueSchema,
    },
  },
  streams: {
    /** The set of terminals producing output *right now* — snapshot-then-deltas,
     *  each frame the full current live set. The daemon taps kaval's raw output
     *  per terminal and debounces it (~1s trailing window, mirroring kolu's local
     *  `useTerminalActivity`); the viewer paints a live terminal's row with a
     *  green dot. Takes no input (it spans the whole host's terminal set), so a
     *  consumer subscribes once. A pure liveness signal: it carries no bytes. */
    activity: {
      inputSchema: z.object({}),
      outputSchema: z.array(TerminalIdSchema),
    },
    /** Live change-pulses for a repo's working tree + git dir (HEAD, index,
     *  reflog, files). Pulse-then-requery: a consumer subscribes for a `{seq:0}`
     *  snapshot, then re-queries `git.getStatus` / `fs.listAll` on each later
     *  pulse. Backed by kolu-git's refcounted `subscribeRepoChange`. */
    subscribeRepoChange: {
      inputSchema: z.object({ repoPath: z.string() }),
      outputSchema: RepoChangePulseSchema,
    },
    /** Live change-pulses narrowed to one file (its writes + a branch switch).
     *  Backed by kolu-git's refcounted `subscribeFileChange`. Pulse-then-requery
     *  `fs.readFile`. */
    subscribeFileChange: {
      inputSchema: FsFileInputSchema,
      outputSchema: RepoChangePulseSchema,
    },
  },
  procedures: {
    /** Filesystem reads scoped to a repo on the serving host. */
    fs: {
      /** Tracked + untracked (gitignore-respecting) paths under `repoPath`. */
      listAll: { input: FsListAllInputSchema, output: FsListAllOutputSchema },
      /** Raw text content of a file (truncated past a size cap). */
      readFile: {
        input: FsFileInputSchema,
        output: FsReadFileTextOutputSchema,
      },
      /** A file's mtime in ms — the cache key the binary-preview path needs. */
      statFileMtimeMs: { input: FsFileInputSchema, output: z.number() },
    },
    /** Git reads scoped to a repo on the serving host. */
    git: {
      /** Changed files vs the diff base for `mode`. */
      getStatus: { input: GitStatusInputSchema, output: GitStatusOutputSchema },
      /** Unified diff hunks for one file vs the diff base for `mode`. */
      getDiff: { input: GitDiffInputSchema, output: GitDiffOutputSchema },
    },
  },
});

type SF = SurfaceTypes<typeof terminalWorkspaceSurface.spec>;

/** The collection's key — a terminal id (same `TerminalId` the sensors use). */
export type AwarenessKey = SF["collections"]["awareness"]["Key"];

/** The `activity` stream frame — the set of terminal ids producing output right
 *  now (the whole current live set, snapshot-then-deltas). */
export type ActivitySet = SF["streams"]["activity"]["Output"];

// The collection's value is exactly `@kolu/terminal-workspace`'s `AwarenessValue`
// (both are `z.infer<typeof AwarenessValueSchema>`). Re-export the canonical
// names so a consumer of the surface has one import for the surface AND its
// value/key shapes.
export type { AwarenessValue, TerminalId } from "./schema.ts";
