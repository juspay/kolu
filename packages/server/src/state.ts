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
import { z } from "zod";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import {
  PreferencesSchema,
  RecentRepoSchema,
  RecentAgentSchema,
  SavedSessionSchema,
  SavedAgentResumeSchema,
  type Preferences,
} from "kolu-common";
import { log } from "./log.ts";

/** What conf stores to disk — survives server restart. Internal: clients see
 *  the per-domain shapes (Preferences / ActivityFeed / SavedSession), not
 *  this aggregate. Adding a new domain key requires a migration entry below. */
const PersistedStateSchema = z.object({
  recentRepos: z.array(RecentRepoSchema),
  recentAgents: z.array(RecentAgentSchema),
  session: SavedSessionSchema.nullable(),
  agentResume: SavedAgentResumeSchema,
  preferences: PreferencesSchema,
});

type PersistedState = z.infer<typeof PersistedStateSchema>;

/**
 * Schema version — bump this when adding migrations.
 * Must be valid semver. `conf` runs all migration handlers
 * whose keys are > the last-seen version and ≤ this value.
 */
const SCHEMA_VERSION = "1.18.0";

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
    recentRepos: [],
    recentAgents: [],
    session: null,
    agentResume: {},
    preferences: DEFAULT_PREFERENCES,
  },
  migrations: {
    // sortOrder added to SavedTerminal — old sessions don't have it.
    // No-op: sortOrder is optional on SavedTerminalSchema, assigned sequentially on restore.
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
    "1.5.0": (store: Conf<PersistedState>) => {
      if (!store.has("recentAgents")) {
        store.set("recentAgents", []);
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
    // Cast through `unknown` because on-disk tab predates both the current
    // union and the older enum shape.
    "1.8.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences");
      const tab = current.rightPanel.tab as unknown as string;
      const staleTab = tab !== "inspector" && tab !== "review";
      if (staleTab) {
        store.set("preferences", {
          ...current,
          rightPanel: {
            ...current.rightPanel,
            tab: "inspector" as unknown as typeof current.rightPanel.tab,
          },
        });
      }
    },
    // Tab renamed: "review" → "diff" (#514). The label is "Code Diff" to
    // signal forge/VCS-agnostic intent. Anything other than "inspector" or
    // "diff" coerces to "inspector". Cast through `unknown` because the
    // on-disk value at this migration point is still a flat string, not
    // the discriminated union introduced in 1.13.0.
    "1.9.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences");
      const tab = current.rightPanel.tab as unknown as string;
      const next = tab === "review" ? "diff" : tab;
      const valid = next === "inspector" || next === "diff";
      store.set("preferences", {
        ...current,
        rightPanel: {
          ...current.rightPanel,
          tab: (valid
            ? next
            : "inspector") as unknown as typeof current.rightPanel.tab,
        },
      });
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
        rightPanel: { ...rest, tab } as typeof current.rightPanel,
      });
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
    // agentResume added — per-terminal captured agent CLI invocations,
    // used by session restore to auto-resume claude/codex/opencode on
    // kolu restart. Seed as empty for existing state files; will populate
    // naturally as users run agents after upgrade.
    "1.18.0": (store: Conf<PersistedState>) => {
      if (!store.has("agentResume")) {
        store.set("agentResume", {});
      }
    },
  },
});

// Early validation so corrupt state shows up in journalctl immediately at
// startup, not only when the first client connects. Validates the aggregate
// on-disk shape — the per-domain getters in preferences.ts / activity.ts /
// session.ts trust the validated store thereafter.
const result = PersistedStateSchema.safeParse({
  recentRepos: store.get("recentRepos"),
  recentAgents: store.get("recentAgents"),
  session: store.get("session"),
  agentResume: store.get("agentResume"),
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
