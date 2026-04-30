/**
 * Shared cell/collection/stream descriptors.
 *
 * Descriptors are pure data: name + Zod schemas + defaults. They live in
 * kolu-common so both server and client can import them — server wires
 * handlers and persistence; client wires Solid hooks. The descriptors
 * have no runtime behavior and add no bundle weight on the client.
 *
 * See `@kolu/cells` for the framework's primitive definitions.
 */

import { cell, collection, stream } from "@kolu/cells";
import { z } from "zod";
import { DEFAULT_PREFERENCES } from "./config";
import {
  type ActivityFeed,
  ActivityFeedSchema,
  FsListAllInputSchema,
  FsListAllOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  type Preferences,
  type PreferencesPatch,
  PreferencesSchema,
  type SavedSession,
  SavedSessionSchema,
  TerminalIdSchema,
  TerminalInfoSchema,
  TerminalMetadataSchema,
} from "./index";

// ── Cells ──────────────────────────────────────────────────────────────

/** User preferences — instant-UI flag store.
 *
 *  Intended authority: `"local"` — the client store is canonical after init.
 *  Server pushes seed the local store on first yield; subsequent server
 *  echoes are ignored to avoid stomping a just-made client write whose
 *  RPC hasn't round-tripped. See `usePreferences.ts` for the load-bearing
 *  rationale (#561 / #577). */
export const preferencesCell = cell({
  name: "preferences",
  schema: PreferencesSchema,
  default: DEFAULT_PREFERENCES,
});

/** Server-derived activity feed (recent repos + recent agents).
 *  Read-only on the client; the server is the sole writer.
 *
 *  Intended authority: `"server"` — `useCell(activityFeedCell, { authority: "local" })`
 *  would silently ignore server pushes after init, which is wrong. */
export const activityFeedCell = cell({
  name: "activityFeed",
  schema: ActivityFeedSchema,
  default: { recentRepos: [], recentAgents: [] } satisfies ActivityFeed,
});

/** Last persisted snapshot of terminals + active id, or null when no
 *  session is saved. Read-only on the client; the server's debounced
 *  autosave loop owns writes.
 *
 *  Intended authority: `"server"` — `useCell(savedSessionCell, { authority: "local" })`
 *  would isolate the client from the server's autosave updates. */
export const savedSessionCell = cell({
  name: "savedSession",
  schema: SavedSessionSchema.nullable(),
  default: null as SavedSession | null,
});

/** Live list of terminals — server-driven on create/kill.
 *
 *  Intended authority: `"server"`. The server's `terminal-list` channel
 *  drives the client; client mutations go via the dedicated `terminal.create`
 *  / `terminal.kill` procedures, not via cell.set. */
export const terminalListCell = cell({
  name: "terminalList",
  schema: z.array(TerminalInfoSchema),
  default: [] as z.infer<typeof TerminalInfoSchema>[],
});

// ── Collections ────────────────────────────────────────────────────────

/** Per-terminal metadata (cwd, git, PR, agent status). Each terminal has
 *  its own observable subscription; clients watching one terminal don't
 *  re-render when an unrelated terminal's metadata changes.
 *
 *  Mutation comes from server-side providers (cwd watcher, git watcher,
 *  agent watchers) writing to the publisher channel — clients don't
 *  call `update()` on this collection directly. */
export const terminalMetadataCollection = collection({
  name: "terminalMetadata",
  keySchema: TerminalIdSchema,
  schema: TerminalMetadataSchema,
});

// ── Streams ────────────────────────────────────────────────────────────

/** Live changed-files list for the Code-view's Local/Branch modes.
 *  Yields current state immediately, then a fresh full snapshot every time
 *  the underlying repo state changes. */
export const gitStatusStream = stream({
  name: "gitStatus",
  inputSchema: GitStatusInputSchema,
  outputSchema: GitStatusOutputSchema,
});

/** Live unified diff for one file. Yields current diff, then a fresh
 *  full snapshot whenever the repo state changes. */
export const gitDiffStream = stream({
  name: "gitDiff",
  inputSchema: GitDiffInputSchema,
  outputSchema: GitDiffOutputSchema,
});

/** Live repo-relative path list (tracked + untracked-but-not-ignored). */
export const fsListAllStream = stream({
  name: "fsListAll",
  inputSchema: FsListAllInputSchema,
  outputSchema: FsListAllOutputSchema,
});

/** Live UTF-8 content for a single file in the Code-view's All-mode body. */
export const fsReadFileStream = stream({
  name: "fsReadFile",
  inputSchema: FsReadFileInputSchema,
  outputSchema: FsReadFileOutputSchema,
});

// ── Patch helpers ──────────────────────────────────────────────────────

/** Pure merge of a `PreferencesPatch` into the current preferences.
 *  `rightPanel` is deep-merged so callers can patch a single nested field
 *  without supplying the rest of the object. Lives next to `preferencesCell`
 *  so the descriptor and its merge shape are read together; both server
 *  (cellHandlers patch) and client (mergeIntoStore via reconcile) reach
 *  the same logic. */
export function applyPreferencesPatch(
  current: Preferences,
  patch: PreferencesPatch,
): Preferences {
  const { rightPanel: rpPatch, ...rest } = patch;
  return {
    ...current,
    ...rest,
    ...(rpPatch !== undefined && {
      rightPanel: { ...current.rightPanel, ...rpPatch },
    }),
  };
}
