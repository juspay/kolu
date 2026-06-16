/**
 * `watcherSurface` — the single typed contract a `kolu-watcher` serves over
 * one ssh `stdioLink`, and kolu-server's `RemoteTerminalEndpoint` mirrors.
 *
 * P3 (kaval-sessions) needs the remote host to expose ONE ssh endpoint that
 * gives kolu-server BOTH the PTY surface AND the fs/git + per-terminal
 * metadata surface. kaval owns only the PTY (its `ptyHostSurface`); the
 * provider DAG + native fs/git are kolu's own coupled code and run host-side
 * in kolu-watcher. So this surface is the union of three concerns:
 *
 *   1. The ENTIRE pty-host surface, ABSORBED verbatim — kolu-watcher is an
 *      ordinary CLIENT of the host-local kaval unix socket and FORWARDS these
 *      verbs/taps to it (the "serve, don't raw-relay" decision: one
 *      `serveOverStdio` server, no `frontDaemonOverStdio` raw splice, kaval
 *      stays a separate durable host-local daemon). Reused via
 *      `ptyHostSurface.spec` so the schemas can never drift from kaval's.
 *
 *   2. fs/git as one-shot procedures (`git.*` / `fs.*`) + repo/file CHANGE
 *      streams — a direct projection of the `TerminalEndpointFs` /
 *      `TerminalEndpointGit` interfaces onto the wire. kolu-server's
 *      `RemoteTerminalEndpoint` recomposes them back into those interfaces
 *      (one-shot read = forwarded RPC; `subscribeRepoChange` = the
 *      `repoChange` stream). One-shots, not mirrored collections, because
 *      they are input-parameterised by `repoPath`, not a fixed key set.
 *
 *   3. The `terminalMetadata` collection — the DAG's per-terminal output
 *      (git/PR/agent/foreground), mirrored back small-N via
 *      `mirrorRemoteCollection`. Its value schema IS kolu-common's
 *      `TerminalMetadataSchema`, so the mirror cannot drift from the local
 *      shape (asserted in the test).
 *
 * Like every `defineSurface`, the whole thing lands under a top-level
 * `surface` namespace, so the consumer reaches it at
 * `client.surface.terminal.spawn` / `client.surface.git.getStatus` /
 * `client.surface.terminalMetadata.get`.
 */

import { ptyHostSurface } from "kaval";
import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import {
  FsListAllOutputSchema,
  GitDiffModeSchema,
  GitDiffOutputSchema,
  GitStatusOutputSchema,
  WorktreeCreateOutputSchema,
} from "kolu-git/schemas";
import { TerminalIdSchema, TerminalMetadataSchema } from "kolu-common/surface";
import { z } from "zod";

/** Wire-shape version of the watcher surface. Bumped on shape changes
 *  (minor = additive field/procedure/stream, major = breaking); internal
 *  refactors of the DAG / kolu-git do NOT bump it. kolu-server checks it
 *  against `system.version` (reused from the absorbed pty-host surface)
 *  before dialing — an incompatible skew is an honest forced restart.
 *  1.1: added `git.worktreeCreate`/`git.worktreeRemove` + `fs.writeFile` (P3
 *  remote parity — worktree ops and file upload run host-side). NOTE: there is
 *  no runtime skew gate on THIS version today (the dial validates kaval's
 *  `PTY_HOST_CONTRACT_VERSION`, not this); a stale watcher pinned mid-session
 *  fails the new procedures per-call (a clear error), and a normal re-dial
 *  re-realises the watcher from the server's drv map, picking up 1.1. */
export const WATCHER_CONTRACT_VERSION = "1.1";

const RepoInputSchema = z.object({ repoPath: z.string() });
const RepoFileInputSchema = z.object({
  repoPath: z.string(),
  filePath: z.string(),
});

export const watcherSurface = defineSurface({
  streams: {
    // (1) the pty-host taps, absorbed verbatim:
    ...ptyHostSurface.spec.streams,
    // (2b) fs change subscriptions — re-served from the host's parcel
    // watchers. A tick (empty payload) per change; kolu-server's
    // `subscribeRepoChange`/`subscribeFileChange` re-read on each tick.
    repoChange: {
      inputSchema: RepoInputSchema,
      outputSchema: z.object({}),
    },
    fileChange: {
      inputSchema: RepoFileInputSchema,
      outputSchema: z.object({}),
    },
  },
  collections: {
    // (3) the DAG's per-terminal metadata, mirrored small-N. Value schema is
    // kolu-common's, so the mirror is structurally pinned to the local shape.
    terminalMetadata: {
      keySchema: TerminalIdSchema,
      schema: TerminalMetadataSchema,
      verbs: ["keys", "get"],
    },
  },
  procedures: {
    // (1) the pty-host control verbs (terminal.*) + system.* (version/info/
    // heartbeat), absorbed verbatim and forwarded to the host-local kaval:
    ...ptyHostSurface.spec.procedures,
    // (2a) fs/git one-shot reads — a 1:1 projection of TerminalEndpointGit /
    // TerminalEndpointFs onto the wire.
    git: {
      getStatus: {
        input: z.object({ repoPath: z.string(), mode: GitDiffModeSchema }),
        output: GitStatusOutputSchema,
      },
      getDiff: {
        input: z.object({
          repoPath: z.string(),
          filePath: z.string(),
          mode: GitDiffModeSchema,
          oldPath: z.string().optional(),
        }),
        output: GitDiffOutputSchema,
      },
      // (P3) worktree ops on the HOST's repo — kolu-server routes the
      // worktreeCreate/Remove RPCs through the owning endpoint, so a remote
      // tile's worktree lands on the remote host (where the repo is), not
      // kolu-server's own filesystem.
      worktreeCreate: {
        input: z.object({ repoPath: z.string(), name: z.string() }),
        output: WorktreeCreateOutputSchema,
      },
      worktreeRemove: {
        input: z.object({ worktreePath: z.string() }),
        output: z.void(),
      },
    },
    fs: {
      listAll: { input: RepoInputSchema, output: FsListAllOutputSchema },
      readFile: {
        input: RepoFileInputSchema,
        output: z.object({ content: z.string(), truncated: z.boolean() }),
      },
      // (P3) write an uploaded/pasted file to the HOST's per-terminal scratch
      // dir so the bracketed-paste path resolves on the remote, not locally.
      writeFile: {
        input: z.object({
          terminalId: TerminalIdSchema,
          name: z.string(),
          base64Data: z.string(),
        }),
        output: z.object({ path: z.string() }),
      },
      // Raw bytes (base64) for the binary preview — kolu-server proxies the
      // iframe file route through this so a remote image/PDF/doc is served from
      // the host the file lives on, not kolu-server's own filesystem.
      readFileBytes: {
        input: RepoFileInputSchema,
        output: z.object({ bytesBase64: z.string() }),
      },
      statFileMtimeMs: {
        input: RepoFileInputSchema,
        output: z.object({ mtimeMs: z.number() }),
      },
    },
  },
});

export type WatcherSurface = SurfaceTypes<typeof watcherSurface.spec>;
