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
import type { GitInfo } from "kolu-git/schemas";
import {
  type ActivityFeed,
  ActivityFeedSchema,
  DEFAULT_PREFERENCES,
  type Preferences,
  PreferencesSchema,
  SavedSessionSchema,
} from "kolu-common/surface";
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
const SCHEMA_VERSION = "1.20.0";

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
    // Coerce stale persisted values to "inspector" so zod validation at the RPC boundary holds.
    // The on-disk shape at this point is the legacy flat-string `tab` —
    // walked via Record<string, unknown> because the current schema no
    // longer carries a `tab` field (1.20.0 flattened it).
    "1.8.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const rp = current.rightPanel as Record<string, unknown>;
      const tab = rp.tab as string | undefined;
      const staleTab = tab !== "inspector" && tab !== "review";
      if (staleTab) {
        store.set("preferences", {
          ...current,
          rightPanel: { ...rp, tab: "inspector" },
        } as unknown as Preferences);
      }
    },
    // Tab renamed: "review" → "diff" (#514). The label is "Code Diff" to
    // signal forge/VCS-agnostic intent. Anything other than "inspector" or
    // "diff" coerces to "inspector". On-disk shape is still a flat string
    // here (the DU was introduced in 1.13.0 and flattened back out in 1.20.0).
    "1.9.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const rp = current.rightPanel as Record<string, unknown>;
      const tab = rp.tab as string | undefined;
      const next = tab === "review" ? "diff" : tab;
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
    // rightPanel.tab reshaped into a discriminated union so illegal
    // combinations ("inspector + codeMode") are unrepresentable. Old shape:
    //   { tab: "inspector" | "diff" }
    // New shape:
    //   { tab: { kind: "inspector" } | { kind: "code", mode: "local"|"branch"|"browse" } }
    // Any transient flat `codeMode` field from an in-flight build of #576 is
    // discarded — the mode now lives inside the `code` variant of the tab.
    // Users on such a build with `codeMode: "branch"` or `"browse"` are
    // reset to `"local"`; no release ever shipped that intermediate shape,
    // and "local" matches the pre-#555 default so it's a safe fallback.
    // The `typeof === "object"` guard is a belt-and-suspenders no-op for
    // the already-migrated case (conf won't re-run this key once seen);
    // `null` slips through and falls into the inspector default, which is
    // the right recovery for a corrupt tab value.
    "1.13.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences");
      const rp = current.rightPanel as Record<string, unknown>;
      if (rp.tab !== null && typeof rp.tab === "object") return;
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
    // preview cards is gone, replaced by a floating pill tree.
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
    // rightPanel.tab discriminated union flattened into `activeTab` +
    // `codeMode` flat fields. Storage stays mergeable by Solid's setStore
    // (no DU subtree to leak variant fields), and `codeMode` now persists
    // across Inspector↔Code toggles instead of being thrown away on each
    // switch. The DU view is reconstructed at consumption sites via
    // `rightPanelView()`.
    //
    // Idempotent: tolerates any of three on-disk shapes — pre-1.13 flat
    // string `tab`, the 1.13-introduced DU `{ kind, mode? }`, or this
    // migration's own already-flat output. The legacy `tab` field is
    // always stripped; `activeTab` and `codeMode` are recomputed from
    // whichever shape was present (`activeTab`/`codeMode` win when set,
    // since 1.13.0 stripped codeMode while writing a `tab` orphan that
    // co-exists with the new fields on a freshly-defaulted store).
    "1.20.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const rp = current.rightPanel as Record<string, unknown>;
      const tab = rp.tab as
        | { kind: "inspector" }
        | { kind: "code"; mode: "local" | "branch" | "browse" }
        | undefined;
      const activeTab =
        (rp.activeTab as "inspector" | "code" | undefined) ??
        (tab?.kind === "code" ? "code" : "inspector");
      const codeMode =
        (rp.codeMode as "local" | "branch" | "browse" | undefined) ??
        (tab?.kind === "code" ? tab.mode : "local");
      const { tab: _tab, ...rest } = rp;
      store.set("preferences", {
        ...current,
        rightPanel: { ...rest, activeTab, codeMode },
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
