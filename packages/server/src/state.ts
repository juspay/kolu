/**
 * Persistent storage shim — owns the `conf` instance and migration ladder.
 *
 * Stores recoverable state at ~/.config/kolu/state.json (or wherever
 * KOLU_STATE_DIR points). The on-disk shape (`PersistedStateSchema`) lives
 * here as an implementation detail; consumers go through the domain modules
 * (`preferences.ts`, `activity.ts`, `session.ts`) instead of reaching for
 * `store` directly.
 *
 * Domain modules still need `store` to read/write their own keys — see the
 * file comment in each. Splitting Conf instances per domain was considered
 * and rejected in #577: the on-disk shape is one schema, one migration ladder,
 * one source of truth.
 *
 * All data here is reconstructible (not user data), so corrupt/missing files
 * can safely reset to defaults.
 */

import Conf from "conf";
import {
  type ActivityFeed,
  ActivityFeedSchema,
  DEFAULT_PREFERENCES,
  type Preferences,
  PreferencesSchema,
  SavedSessionSchema,
} from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import { z } from "zod";
import { log } from "./log.ts";

/** Best-effort `GitInfo` from the legacy flat `repoName`/`branch` fields
 *  shipped before #702. Path fields are seeded from `cwd` — a defensible
 *  default for the common case (terminal at the repo root) that the live
 *  git provider overwrites with the real values on first restore via
 *  `subscribeGitInfo`. No empty-string sentinels: every `string` field
 *  carries an honest path, just possibly the wrong one until re-resolution.
 *
 *  Exported so `state.test.ts` can exercise the synthesis directly without
 *  spinning up a `Conf` store under `KOLU_STATE_DIR`. */
export function migrateLegacyTerminal_1_18_0(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const {
    sortOrder: _sortOrder,
    repoName,
    branch,
    git: existingGit,
    ...kept
  } = t;
  // Already-present `git` key wins — idempotent on migrated data, and a
  // populated record beats a synthesized one if a corrupt entry has both.
  if ("git" in t) {
    return {
      ...kept,
      git: (existingGit as GitInfo | null | undefined) ?? null,
    };
  }
  // Pre-#702 entry: synthesize from the flat fields, using cwd as the
  // best-guess for paths. Skip synthesis (and stamp `git: null`) if cwd
  // is missing — falling back to "" would silently reintroduce the
  // empty-string sentinel this rewrite is trying to remove. Live git
  // provider re-resolves on first restore via subscribeGitInfo, so the
  // worktree case (cwd ≠ mainRepoRoot) self-corrects.
  if (
    typeof repoName === "string" &&
    typeof branch === "string" &&
    typeof kept.cwd === "string"
  ) {
    return {
      ...kept,
      git: {
        repoName,
        branch,
        repoRoot: kept.cwd,
        worktreePath: kept.cwd,
        isWorktree: false,
        mainRepoRoot: kept.cwd,
        // A restored session carries no remote URL — the live git watcher
        // re-resolves it on the next resolve.
        remoteUrl: null,
      },
    };
  }
  return { ...kept, git: null };
}

/** What conf stores to disk — survives server restart. Internal: clients see
 *  the per-domain shapes (Preferences / ActivityFeed / SavedSession), not
 *  this aggregate. Adding a new domain key requires a migration entry below. */
const PersistedStateSchema = z.object({
  activityFeed: ActivityFeedSchema,
  session: SavedSessionSchema.nullable(),
  preferences: PreferencesSchema,
});

type PersistedState = z.infer<typeof PersistedStateSchema>;

/**
 * Schema version — bump this when adding migrations.
 * Must be valid semver. `conf` runs all migration handlers
 * whose keys are > the last-seen version and ≤ this value.
 */
const SCHEMA_VERSION = "1.24.0";

// Callers must pass an explicit directory via KOLU_STATE_DIR. A bare launch
// with no env would silently clobber whatever happens to live at conf's
// default path, so we refuse. Each entrypoint picks its own location:
//   nix-built kolu → ~/.config/kolu (production)
//   pnpm dev       → <worktree-root>/.kolu-dev (per-worktree, gitignored)
//   tests          → an ephemeral $TMPDIR path
const stateDir = process.env.KOLU_STATE_DIR;
if (!stateDir) {
  throw new Error(
    "KOLU_STATE_DIR must be set to an absolute directory. The nix-built " +
      "kolu wrapper, `pnpm dev`, and the test harness each set their own — " +
      "bare launches are rejected to avoid clobbering production state.",
  );
}

log.info({ path: stateDir }, "state directory");

export const store = new Conf<PersistedState>({
  cwd: stateDir,
  projectVersion: SCHEMA_VERSION,
  defaults: {
    activityFeed: { recentRepos: [], recentAgents: [] } satisfies ActivityFeed,
    session: null,
    preferences: DEFAULT_PREFERENCES,
  },
  migrations: {
    // 1.1.0 legacy: sortOrder added to SavedTerminal. The field was
    // removed entirely in 1.18.0 (replaced by Map insertion order);
    // this migration stays as a no-op so users who walked through
    // earlier versions keep their ladder position intact.
    "1.1.0": () => {},
    // Preferences added — old state files don't have them.
    // conf auto-merges defaults, but explicit migration ensures clean shape.
    "1.2.0": (store: Conf<PersistedState>) => {
      if (!store.has("preferences")) {
        store.set("preferences", DEFAULT_PREFERENCES);
      }
    },
    // sidebarAgentPreviews added — old preference blobs lack this field.
    "1.3.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as
        | Partial<Preferences>
        | undefined;
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...current,
      });
    },
    // sidebarAgentPreviews: boolean → enum. Field removed entirely in
    // 1.15.0 (#622); migrations preserved as historical record. The 1.15.0
    // pass strips the key from disk for any user that walked through these
    // earlier migrations.
    "1.4.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as unknown as
        | Record<string, unknown>
        | undefined;
      const old = current?.sidebarAgentPreviews;
      const migrated =
        old === true
          ? "agents"
          : old === false
            ? "none"
            : typeof old === "string"
              ? old
              : "attention";
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...(current as Partial<Preferences>),
        sidebarAgentPreviews: migrated,
      } as unknown as Preferences);
    },
    // recentAgents added — seed as empty array for existing state files.
    // The `recentAgents` key was a top-level slot until 1.19.0 collapsed
    // it into `activityFeed.recentAgents`; the cast keeps this historical
    // migration valid against the post-1.19 schema.
    "1.5.0": (store: Conf<PersistedState>) => {
      const untyped = store as unknown as {
        has: (key: string) => boolean;
        set: (key: string, value: unknown) => void;
      };
      if (!untyped.has("recentAgents")) {
        untyped.set("recentAgents", []);
      }
    },
    // rightPanelCollapsed + rightPanelSize added — old preference blobs lack these fields.
    "1.6.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as
        | Partial<Preferences>
        | undefined;
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...current,
      });
    },
    // rightPanel nested object replaces flat rightPanelCollapsed/rightPanelSize — discard old flat fields, use default rightPanel.
    "1.7.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as
        | Record<string, unknown>
        | undefined;
      const { rightPanelCollapsed, rightPanelSize, ...rest } = current ?? {};
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...rest,
        rightPanel: DEFAULT_PREFERENCES.rightPanel,
      });
    },
    // RightPanelTab enum changed: "files" + "git" stubs collapsed into one "review" tab (#514).
    // Only acts on the legacy flat-string `tab` shape. The 1.13.0
    // migration converted that to a DU, and 1.20.0 flattened it again
    // into `activeTab` + `codeMode` — neither of those shapes has a
    // string `tab`, so the early-return skips them cleanly.
    "1.8.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const rp = current.rightPanel as Record<string, unknown>;
      if (typeof rp.tab !== "string") return;
      const staleTab = rp.tab !== "inspector" && rp.tab !== "review";
      if (staleTab) {
        store.set("preferences", {
          ...current,
          rightPanel: { ...rp, tab: "inspector" },
        } as unknown as Preferences);
      }
    },
    // Tab renamed: "review" → "diff" (#514). Same string-tab guard as
    // 1.8.0 — only acts on the legacy flat-string shape.
    "1.9.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const rp = current.rightPanel as Record<string, unknown>;
      if (typeof rp.tab !== "string") return;
      const next = rp.tab === "review" ? "diff" : rp.tab;
      const valid = next === "inspector" || next === "diff";
      store.set("preferences", {
        ...current,
        rightPanel: { ...rp, tab: valid ? next : "inspector" },
      } as unknown as Preferences);
    },
    // `randomTheme` (boolean) replaced by `shuffleTheme` (boolean). The
    // semantics changed under the hood — "shuffle" now uses a perceptual
    // distance picker instead of pure random, so collisions vanish — but
    // the user-facing on/off bit carries over verbatim.
    "1.10.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as unknown as
        | (Record<string, unknown> & { randomTheme?: unknown })
        | undefined;
      const { randomTheme, ...rest } = current ?? {};
      const shuffleTheme =
        typeof randomTheme === "boolean"
          ? randomTheme
          : DEFAULT_PREFERENCES.shuffleTheme;
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...(rest as Partial<Preferences>),
        shuffleTheme,
      });
    },
    // rightPanel.pinned added — default to true (docked) for existing users.
    "1.11.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences");
      if (
        (current.rightPanel as Record<string, unknown>).pinned === undefined
      ) {
        store.set("preferences", {
          ...current,
          rightPanel: { ...current.rightPanel, pinned: true },
        });
      }
    },
    // canvasMode preference added — default to false (focus mode).
    // Field removed in 1.15.0 (#622). Historical migration preserved so
    // users walking the ladder don't lose any other preference fields.
    "1.12.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      if (current.canvasMode === undefined) {
        store.set("preferences", {
          ...current,
          canvasMode: false,
        } as unknown as Preferences);
      }
    },
    // rightPanel.tab string ("inspector" | "diff") → discriminated union.
    //   { tab: "inspector" | "diff" }
    //   →
    //   { tab: { kind: "inspector" } | { kind: "code", mode: "local"|"branch"|"browse" } }
    // Only acts on the string shape. Skips already-migrated DU stores
    // and the post-1.20.0 flat shape (no `tab` field at all). The
    // `_codeMode` strip drops any transient flat field from an
    // in-flight build of #576 — released versions never had it.
    "1.13.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences");
      const rp = current.rightPanel as Record<string, unknown>;
      if (typeof rp.tab !== "string") return;
      const tab =
        rp.tab === "diff"
          ? { kind: "code" as const, mode: "local" as const }
          : { kind: "inspector" as const };
      const { codeMode: _codeMode, tab: _tab, ...rest } = rp;
      store.set("preferences", {
        ...current,
        rightPanel: { ...rest, tab },
      } as unknown as Preferences);
    },
    // terminalRenderer preference added — default to "auto" (existing behavior:
    // WebGL on focused+visible tile, DOM elsewhere).
    "1.14.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences");
      if ((current as Record<string, unknown>).terminalRenderer === undefined) {
        store.set("preferences", { ...current, terminalRenderer: "auto" });
      }
    },
    // canvasMode + sidebarAgentPreviews removed (#622) — the workspace is
    // now mode-less (canvas always on desktop) and the sidebar with its
    // preview cards is gone, replaced by the floating workspace switcher.
    "1.15.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const { canvasMode: _cm, sidebarAgentPreviews: _sap, ...rest } = current;
      store.set("preferences", rest as Preferences);
    },
    // terminalRenderer enum widened from ["auto","dom"] to ["auto","webgl","dom"].
    // Existing on-disk values ("auto" and "dom") are valid literals of the
    // widened enum, so no value transformation is required. The bump is
    // recorded here for the ladder's sake (see .claude/rules/state.md).
    "1.16.0": () => {},
    // rightPanel.pinned removed — the panel now always docks, so the
    // pin/overlay toggle (1.11.0) is gone. Strip the field from disk so
    // the 1.17.0 preferences shape matches the schema exactly.
    "1.17.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences");
      const rp = current.rightPanel as Record<string, unknown>;
      if (rp.pinned !== undefined) {
        const { pinned: _pinned, ...rest } = rp;
        store.set("preferences", {
          ...current,
          rightPanel: rest as typeof current.rightPanel,
        });
      }
    },
    // SavedTerminal unified with TerminalMetadata — the flattened
    // `repoName`/`branch` (now read from `git`) and the `sortOrder`
    // index (replaced by Map insertion order) are gone. The legacy
    // `repoName`/`branch` are converted into a synthesized `GitInfo`
    // (see `migrateLegacyTerminal_1_18_0`) so the restore card keeps
    // showing repo names instead of full cwd paths — the original
    // 1.18.0 release stamped `git: null` and lost that context (#714).
    "1.18.0": (store: Conf<PersistedState>) => {
      const session = store.get("session");
      if (!session) return;
      const terminals = (
        session.terminals as unknown as Record<string, unknown>[]
      ).map(migrateLegacyTerminal_1_18_0);
      store.set("session", {
        ...session,
        terminals: terminals as typeof session.terminals,
      });
    },
    // recentRepos + recentAgents — two top-level keys carrying one logical
    // ActivityFeed cell — collapse into a single `activityFeed` key. The
    // framework's `cellHandlers` treats activityFeed as one atomic value;
    // the legacy two-key split was a leak of disk-shape into the cell
    // adapter. Strip the old keys after writing the new one so the
    // PersistedStateSchema's `.strict()` (or future-stricter) reads don't
    // see the orphans.
    "1.19.0": (store: Conf<PersistedState>) => {
      const raw = store.store as unknown as Record<string, unknown>;
      const recentRepos = (raw.recentRepos ??
        []) as ActivityFeed["recentRepos"];
      const recentAgents = (raw.recentAgents ??
        []) as ActivityFeed["recentAgents"];
      store.set("activityFeed", { recentRepos, recentAgents });
      // Strip the legacy keys (no longer in PersistedStateSchema) — the
      // double-cast is needed because Conf's typed `delete` rejects keys
      // outside the current schema.
      const untyped = store as unknown as {
        delete: (key: string) => void;
      };
      untyped.delete("recentRepos");
      untyped.delete("recentAgents");
    },
    // rightPanel.tab DU → flat `activeTab` + `codeMode`. Storage stays
    // mergeable by Solid's setStore (no DU subtree to leak variant
    // fields); `codeMode` now persists across Inspector↔Code toggles.
    // The DU view is reconstructed at consumption sites via
    // `rightPanelView()`. Corrupt/missing tab degrades to inspector/local.
    "1.20.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const rp = current.rightPanel as Record<string, unknown>;
      const tab = rp.tab as
        | { kind: "inspector" }
        | { kind: "code"; mode: "local" | "branch" | "browse" }
        | undefined;
      const activeTab = tab?.kind === "code" ? "code" : "inspector";
      const codeMode = tab?.kind === "code" ? tab.mode : "local";
      const { tab: _tab, ...rest } = rp;
      // Cast through `unknown` — the transitional shape carries `activeTab`
      // and `codeMode` on `rightPanel` that 1.23.0 later strips, so the
      // value here is intentionally wider than `Preferences`.
      store.set("preferences", {
        ...current,
        rightPanel: { ...rest, activeTab, codeMode },
      } as unknown as Preferences);
    },
    // SavedTerminal.lastActivityAt added (#830). Seed legacy terminals to 0
    // so they fall back to canvas-position ordering until an agent
    // semantic-key transition stamps a real timestamp.
    "1.21.0": (store: Conf<PersistedState>) => {
      const session = store.get("session");
      if (!session) return;
      const legacy = session.terminals as unknown as Record<string, unknown>[];
      const terminals = legacy.map((t) => ({
        lastActivityAt: 0,
        ...t,
      })) as typeof session.terminals;
      store.set("session", { ...session, terminals });
    },
    // SavedTerminal.intent added — optional multiline-markdown annotation.
    // No backfill: the field is optional, so absent values continue to
    // read as "unset" through the tightened Zod schema (`.min(1).optional()`).
    // themeName was also tightened from `.optional()` to `.min(1).optional()`
    // in the same schema bump; legacy sessions that had `themeName: ""`
    // would now fail validation, but no path produced that shape — the
    // theme setter always wrote a non-empty value or omitted the key.
    "1.22.0": () => {},
    // Right-panel `activeTab` and `codeMode` move from the global
    // `preferences.rightPanel` to per-terminal `TerminalMetadata.rightPanel`
    // — the two fields are *about* what each terminal is doing, so they
    // should travel with the terminal. Strip them from the preferences
    // blob; new per-terminal records seed lazily from
    // `DEFAULT_RIGHT_PANEL_PER_TERMINAL` at first read. The CodeTab's
    // legacy `kolu-codetab-selected-files` localStorage key is dropped
    // client-side (no on-disk state to migrate).
    "1.23.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const rp = current.rightPanel as Record<string, unknown> | undefined;
      if (!rp) return;
      const { activeTab: _activeTab, codeMode: _codeMode, ...rest } = rp;
      store.set("preferences", {
        ...current,
        rightPanel: rest as typeof current.rightPanel,
      } as Preferences);
    },
    // `rightPanel.codeTabTreeSize` (the Code tab's vertical split fraction)
    // was added to RightPanelPrefsSchema in #918 without a migration. Files
    // written before then carry a `rightPanel` with only `collapsed`/`size`,
    // so `preferences.get` failed Zod validation on the wire
    // (EVENT_ITERATOR_VALIDATION_FAILED) until the field was backfilled (#1237).
    "1.24.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const rp = current.rightPanel as Record<string, unknown> | undefined;
      if (!rp || rp.codeTabTreeSize !== undefined) return;
      store.set("preferences", {
        ...current,
        rightPanel: {
          ...rp,
          codeTabTreeSize: DEFAULT_PREFERENCES.rightPanel.codeTabTreeSize,
        },
      } as Preferences);
    },
  },
});

// Early validation so corrupt state shows up in journalctl immediately at
// startup, not only when the first client connects. Validates the aggregate
// on-disk shape — the per-domain getters in activity.ts / session.ts trust
// the validated store thereafter.
const result = PersistedStateSchema.safeParse({
  activityFeed: store.get("activityFeed"),
  session: store.get("session"),
  preferences: store.get("preferences"),
});
if (!result.success) {
  const summary = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  log.error(
    { issues: result.error.issues, path: store.path },
    `Persisted state does not match schema (${summary}). Delete ${store.path} to reset to defaults.`,
  );
}
