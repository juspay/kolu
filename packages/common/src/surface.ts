/**
 * Kolu's typed reactive surface — every Cell, Collection, Stream, and Event
 * the app exposes, declared in one `defineSurface(...)` call.
 *
 * The surface produces the `surface.*` portion of the contract. Raw oRPC
 * (`terminal.create/kill/attach/...`, `git.worktreeCreate/...`,
 * `server.info`) lives in `contract.ts` alongside, composed via spread.
 *
 * Cell names align with persisted `Conf` keys so `confStore("preferences")`
 * / `confStore("activityFeed")` / `confStore("session")` continue working
 * without a migration ladder.
 */

import { defineSurface } from "@kolu/surface/define";
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
  PreferencesPatchSchema,
  PreferencesSchema,
  type SavedSession,
  SavedSessionSchema,
  TerminalAttachInputSchema,
  TerminalIdSchema,
  TerminalInfoSchema,
  TerminalMetadataSchema,
  TerminalOnExitOutputSchema,
} from "./index";

/** Pure merge of a `PreferencesPatch` into the current preferences.
 *  `rightPanel` is deep-merged so callers can patch a single nested field
 *  without supplying the rest of the object. Lives on the surface spec
 *  (`cells.preferences.patch`) so server (`implementSurface`) and client
 *  (`surfaceClient`'s default `applyPatch`) reach the same logic without
 *  a duplicate import. */
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

export const surface = defineSurface({
  cells: {
    /** User preferences — local-authority on the client; server-canonical
     *  on disk. The client's `mergeIntoStore` for the `rightPanel.tab`
     *  discriminated-union case is supplied at the `.use()` call site
     *  (see `client/wire.ts`); the spec's `patch` covers server-side. */
    preferences: {
      schema: PreferencesSchema,
      default: DEFAULT_PREFERENCES,
      patchSchema: PreferencesPatchSchema,
      patch: applyPreferencesPatch,
      // `test__set` exposed for e2e fixtures.
      verbs: ["get", "patch", "test__set"],
    },

    /** Server-derived activity feed (recent repos + recent agents).
     *  Read-only on the client; the server is the sole writer via
     *  `trackRecentRepo` / `trackRecentAgent`. */
    activityFeed: {
      schema: ActivityFeedSchema,
      default: { recentRepos: [], recentAgents: [] } satisfies ActivityFeed,
      verbs: ["get", "test__set"],
    },

    /** Last persisted snapshot of terminals + active id, or null when no
     *  session is saved. Read-only on the client; the server's debounced
     *  autosave loop owns writes. */
    session: {
      schema: SavedSessionSchema.nullable(),
      default: null as SavedSession | null,
      verbs: ["get", "test__set"],
    },

    /** Live list of terminals — server-driven on create/kill. Mutations
     *  go through dedicated procedures (`terminal.create`/`kill`/`killAll`)
     *  in the raw oRPC namespace, not via cell.set. */
    terminalList: {
      schema: z.array(TerminalInfoSchema),
      default: [] as z.infer<typeof TerminalInfoSchema>[],
      verbs: ["get"],
    },
  },
  collections: {
    /** Per-terminal metadata (cwd, git, PR, agent status). Each terminal
     *  is independently observable; mutations come from server-side
     *  providers writing through the publisher channel — clients don't
     *  call `upsert` on this collection directly. */
    terminalMetadata: {
      keySchema: TerminalIdSchema,
      schema: TerminalMetadataSchema,
      // Only the streaming reads are exposed; writes are server-internal.
      verbs: ["keys", "get"],
    },
  },
  streams: {
    /** Live changed-files list for the Code-view's Local/Branch modes. */
    gitStatus: {
      inputSchema: GitStatusInputSchema,
      outputSchema: GitStatusOutputSchema,
    },
    /** Live unified diff for one file. */
    gitDiff: {
      inputSchema: GitDiffInputSchema,
      outputSchema: GitDiffOutputSchema,
    },
    /** Live repo-relative path list (tracked + untracked-but-not-ignored). */
    fsListAll: {
      inputSchema: FsListAllInputSchema,
      outputSchema: FsListAllOutputSchema,
    },
    /** Live UTF-8 content for a single file in the Code-view's All-mode body. */
    fsReadFile: {
      inputSchema: FsReadFileInputSchema,
      outputSchema: FsReadFileOutputSchema,
    },
  },
  events: {
    /** Terminal process exited — fires once per terminal lifetime with the
     *  exit code. Drives the exit toast and the active-terminal auto-switch
     *  in `useTerminals`. */
    terminalExit: {
      inputSchema: TerminalAttachInputSchema,
      outputSchema: TerminalOnExitOutputSchema,
    },
  },
});

// ── Back-compat re-exports ─────────────────────────────────────────────
//
// Until every consumer is migrated to `app.cells.X.use(...)` etc. via the
// surface client bundle, the manual descriptors stay accessible by name.
// New code should reach for the bound primitives in `client/wire.ts`.

export const preferencesCell = surface.descriptors.cells.preferences;
export const activityFeedCell = surface.descriptors.cells.activityFeed;
export const savedSessionCell = surface.descriptors.cells.session;
export const terminalListCell = surface.descriptors.cells.terminalList;
export const terminalMetadataCollection =
  surface.descriptors.collections.terminalMetadata;
export const gitStatusStream = surface.descriptors.streams.gitStatus;
export const gitDiffStream = surface.descriptors.streams.gitDiff;
export const fsListAllStream = surface.descriptors.streams.fsListAll;
export const fsReadFileStream = surface.descriptors.streams.fsReadFile;
export const terminalExitEvent = surface.descriptors.events.terminalExit;
