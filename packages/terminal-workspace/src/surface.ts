/**
 * `@kolu/terminal-workspace/surface` — the ONE `@kolu/surface` the `pulam`
 * daemon serves, `pulam-tui` reads, and (in R8) a remote kolu-server mirrors.
 * It is the consume-facing dual of the host-side workspace the library owns: a
 * keyed `snapshots` collection of `TerminalSnapshot`s (one entry per terminal a
 * kaval owns), the
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
import { TerminalSnapshotSchema, TerminalIdSchema } from "./schema.ts";

/** The wire-shape `major.minor` of the workspace surface this build serves and
 *  expects. Bumped only when `terminalWorkspaceSurface` itself changes shape —
 *  additive (a new optional field / a new stream / a new procedure) is a minor
 *  bump, a shape-breaking change a major. The remote dial gates an incompatible
 *  host into re-provision via `isContractVersionCompatible`. `0.2 → 0.3` adds the
 *  fs/git procedures + the two watcher streams (additive): a `0.2` daemon a `0.3`
 *  viewer dials reads as `skew` because it can't serve them, which is exactly the
 *  gate's job. `0.3 → 1.0` RESHAPES `git.getStatus`'s output: `local` mode drops
 *  the always-null `base` and grows the branch tracking header (ahead/behind) +
 *  working-tree section counts that the fleet board reads live on each
 *  `subscribeRepoChange` pulse (R4.7). Removing `base` from the `local` arm is a
 *  BREAKING change — a `0.3` viewer's schema requires `base` in every mode, so a
 *  `1.0` daemon's `local` result would fail its parse — hence the major bump, not
 *  a minor: the gate marks `0.3` and `1.0` mutually incompatible in BOTH
 *  directions, which is honest (the local arm changed shape, not merely grew).
 *  `1.0 → 2.0` RESHAPES the collection value from the old fused awareness value
 *  (persisted ∪ live) to the producer's `TerminalSnapshot` — the awareness-derive-
 *  store cutover (PR #1621): the two memory fields (`lastActivityAt` /
 *  `lastAgentCommand`) leave the served value (they are kolu's to remember), so a
 *  `1.0` viewer's parse would reject a `2.0` value's shape — a breaking major.
 *  `2.0 → 3.0` RENAMES the collection key `awareness` → `snapshots` (the type-naming
 *  cleanup): the wire path a viewer subscribes to changes, so a `2.0` viewer can't
 *  find the renamed collection — a breaking major.
 *  `3.0 → 3.1` ADDS three host-scoped byte primitives (additive minor): the
 *  range-capable `fs.previewRead`, the `scratch.write` paste/upload sink, and the
 *  `transcript.read` arbitrary-host-path source read (PR-2 of the remote-terminals
 *  finale). A `3.0` daemon a `3.1` viewer dials reads as `skew` (it can't serve the
 *  new procedures), exactly the gate's job; a `3.1` daemon still serves a `3.0`
 *  viewer (the new procedures are simply unused), which is what an additive minor
 *  means. No existing primitive changed shape. */
export const TERMINAL_WORKSPACE_CONTRACT_VERSION = "3.1";

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

/** Input for the range-capable `fs.previewRead` — a repo-relative file plus the
 *  verbatim HTTP `Range` request header to honor (`null` for a full read). The
 *  producing host parses the range and re-enforces the realpath/traversal guard;
 *  no `terminalId`/`location` rides here (the surface is already host-scoped). */
export const PreviewReadInputSchema = z.object({
  repoPath: z.string(),
  filePath: z.string(),
  /** The verbatim HTTP `Range` header (e.g. `bytes=0-1023`), or null for the
   *  whole file. Parsed on the producing host by `@kolu/serve-dir`. */
  range: z.string().nullable(),
});

/** Output of `fs.previewRead` — the producing host's byte response, faithfully
 *  reassembled into a Fetch `Response` by the caller. Mirrors `@kolu/serve-dir`'s
 *  `ServeResult`: the HTTP status (200/206 on success, 403/404/416/400/500 on a
 *  guard/range failure), the response headers (content-type, content-range,
 *  accept-ranges, …), and the body base64-encoded so binary bytes survive the
 *  JSON wire (on an error status the body carries the plain-text reason). */
export const PreviewReadOutputSchema = z.object({
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
  bodyBase64: z.string(),
});
export type PreviewReadInput = z.infer<typeof PreviewReadInputSchema>;
export type PreviewReadOutput = z.infer<typeof PreviewReadOutputSchema>;

/** Input for `scratch.write` — a per-terminal paste/upload sink. `name` is a
 *  suggested filename (sanitized to a basename on the producing host); the bytes
 *  ride base64-encoded. Carries `terminalId` because the scratch dir is
 *  per-terminal (not `location` — host-scoping stays implicit in the surface). */
export const ScratchWriteInputSchema = z.object({
  terminalId: TerminalIdSchema,
  name: z.string(),
  dataBase64: z.string(),
});

/** Output of `scratch.write` — the absolute on-disk path on the producing host,
 *  bracketed-pasted into that host's PTY so an agent can read the dropped file. */
export const ScratchWriteOutputSchema = z.object({
  path: z.string(),
});
export type ScratchWriteInput = z.infer<typeof ScratchWriteInputSchema>;
export type ScratchWriteOutput = z.infer<typeof ScratchWriteOutputSchema>;

/** Input for `transcript.read` — a guarded read of an arbitrary host path (an
 *  agent's session-transcript source). `root` is the allowed base on the
 *  producing host (the agent's store root); `path` is relative to it. The read
 *  is fenced under `root` (lexical + realpath/symlink-escape) exactly as the repo
 *  reads are, so a `..`/symlink can't escape the store root on the host. */
export const TranscriptReadInputSchema = z.object({
  root: z.string(),
  path: z.string(),
});

/** Output of `transcript.read` — the full UTF-8 source. Unlike `fs.readFile`
 *  (size-capped for the Code-tab body) a transcript is read WHOLE; the consuming
 *  loader parses it. */
export const TranscriptReadOutputSchema = z.object({
  content: z.string(),
});
export type TranscriptReadInput = z.infer<typeof TranscriptReadInputSchema>;
export type TranscriptReadOutput = z.infer<typeof TranscriptReadOutputSchema>;

/** The terminal-workspace surface — PULAM's home today. R6 ships one fs/git
 *  IMPL (`createTerminalWorkspaceEndpoint`) with two homes, NOT one surface both
 *  serve: kolu-server (in-process) re-exposes the reads on `koluSurface`'s
 *  value-bearing streams, while pulam (remote) serves them on THIS surface. The
 *  two contract shapes are deliberately different (R8's remote kolu re-queries
 *  procedures rather than streaming full diffs over the wire); the single shared
 *  surface both homes serve is closed in R8 when kolu mirrors this surface whole
 *  (via R7's total mirror). The primitives differ only in KIND:
 *   - the `snapshots` collection (keyed current state) + `version` cell (a
 *     single current value) are the STATEFUL primitives;
 *   - `activity` is the FLOW primitive — the live "bytes moving right now" the
 *     Dock paints as a green dot, derived from kaval's raw byte tap (distinct
 *     from the slow agent staleness clock `lastActivityAt`, which is now kolu's
 *     remembered `AgentMemory`, not a served snapshot field), so it can't be a
 *     collection field;
 *   - the `fs.*` / `git.*` PROCEDURES are the Code tab's raw reads (request →
 *     response, never persisted), and `subscribeRepoChange` /
 *     `subscribeFileChange` are WATCHER STREAMS that pulse on each live change.
 *
 *  The value schema is the GENERIC `TerminalSnapshot` — no `location`, no kolu UI
 *  fields, no memory; kolu's own record is built on top of this (it folds the
 *  `TerminalEvent` stream and JOINS the result with its authored record), never the
 *  other way round. */
export const terminalWorkspaceSurface = defineSurface({
  cells: {
    version: { schema: VersionSchema, default: DEFAULT_VERSION },
    // NOTE: no `connection` cell here. Link health is NOT a property of the base
    // terminal surface (a direct/local link has no remote to be down); it's
    // composed ONLY at the nix-host re-serve seam via `mirroredSurface(...)`, so
    // a re-serve over a HostSession carries it by construction (#1564) and the
    // daemon serves a connection-free surface.
  },
  collections: {
    snapshots: {
      keySchema: TerminalIdSchema,
      schema: TerminalSnapshotSchema,
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
      /** Range-capable byte read for the iframe/image/PDF/video preview — bytes +
       *  content-type + content-range, the realpath/traversal guard re-enforced on
       *  the producing host. A remote tile's preview byte route forwards through
       *  this (R9.5 / F-REMOTE); the local byte route reads its own disk directly. */
      previewRead: {
        input: PreviewReadInputSchema,
        output: PreviewReadOutputSchema,
      },
    },
    /** Paste/upload sink — the surface fs is read-only otherwise. Writes a dropped
     *  file into the terminal's per-host scratch dir and returns its on-disk path
     *  (bracketed-pasted into the host's PTY). */
    scratch: {
      write: {
        input: ScratchWriteInputSchema,
        output: ScratchWriteOutputSchema,
      },
    },
    /** Agent session-transcript source reads, scoped to the serving host. */
    transcript: {
      /** Read a transcript's raw source from an arbitrary host path, fenced under
       *  the given store root (lexical + realpath). The host-side primitive a
       *  remote tile's transcript export reads through (F-REMOTE). */
      read: {
        input: TranscriptReadInputSchema,
        output: TranscriptReadOutputSchema,
      },
    },
    /** Git reads scoped to a repo on the serving host. */
    git: {
      /** Changed files vs the diff base for `mode`, plus (in `local` mode) the
       *  branch tracking header (ahead/behind) and working-tree section counts
       *  the fleet board paints live (R4.7). */
      getStatus: { input: GitStatusInputSchema, output: GitStatusOutputSchema },
      /** Unified diff hunks for one file vs the diff base for `mode`. */
      getDiff: { input: GitDiffInputSchema, output: GitDiffOutputSchema },
    },
  },
});

type SF = SurfaceTypes<typeof terminalWorkspaceSurface.spec>;

/** The base surface SPEC — what a re-serve's `SurfaceSink`/`ProcedureForwarders`
 *  are generic over when they fold/forward the daemon's (connection-free)
 *  primitives. Exported so a consumer types against it WITHOUT importing the
 *  surface value purely for a `typeof` query. */
export type TerminalWorkspaceSpec = (typeof terminalWorkspaceSurface)["spec"];

/** The collection's key — a terminal id (same `TerminalId` the sensors use). */
export type SnapshotKey = SF["collections"]["snapshots"]["Key"];

/** The `activity` stream frame — the set of terminal ids producing output right
 *  now (the whole current live set, snapshot-then-deltas). */
export type ActivitySet = SF["streams"]["activity"]["Output"];

// The collection's value is exactly `@kolu/terminal-workspace`'s `TerminalSnapshot`
// (both are `z.infer<typeof TerminalSnapshotSchema>`). Re-export the canonical names so
// a consumer of the surface has one import for the surface AND its value/key shapes.
export type { TerminalSnapshot, TerminalId } from "./schema.ts";

// The git-status shapes `git.getStatus` returns — re-exported so a viewer or
// remote-kolu consumer reads the surface AND the types its procedures return
// from this one module, never reaching past the surface into kolu-git directly
// (the same one-import discipline the value/key re-export above keeps).
export type {
  GitBranchStatus,
  GitChangedFile,
  GitChangeStatus,
  GitStatusOutput,
  GitWorkingTreeSummary,
  LocalGitStatus,
} from "kolu-git/schemas";
