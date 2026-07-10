/**
 * Persistent storage shim — owns the `conf` instance and migration ladder.
 *
 * Stores recoverable state at ~/.config/kolu/state.json (or wherever
 * KOLU_STATE_DIR points). The on-disk shape (`PersistedStateSchema`) lives
 * here as an implementation detail; `preferences.ts` reads/writes its key
 * against the shared `store` rather than reaching for it directly.
 *
 * `session` and `activityFeed` USED to live here too; W2.2 moved them onto the
 * padi PROCESS's own state-root store (`@kolu/padi`'s `stateStore.ts`), so this
 * store holds only `preferences` now. The 1.31.0 migration below strips the
 * legacy `session` / `activityFeed` residue (and the older orphan
 * `sleepingTerminals` / `lastPairedDaemon` keys) off any pre-W2.2 file — backing
 * it up first so a fresh padi's one-shot legacy import stays recoverable.
 *
 * All data here is reconstructible (not user data), so corrupt/missing files
 * can safely reset to defaults.
 */

import { copyFileSync, existsSync } from "node:fs";
import Conf from "conf";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  PreferencesSchema,
} from "kolu-common/surface";
import { z } from "zod";
import { log } from "./log.ts";

/** Convert a pre-1.30 `preferences` record — where the on/off `shuffleTheme`
 *  boolean chose whether new terminals auto-picked a distinct theme — to the
 *  two fields that replaced it: `newTerminalTheme` (`inherit` | `shuffle`, the
 *  creation strategy) and `shuffleBehavior` (the pool a shuffle draws from).
 *  `true` → `{ shuffle, auto }` (keep auto-picking a distinct tint, now
 *  mode-matched — the old behaviour, minus the jarring cross-mode picks);
 *  `false` → `{ inherit, auto }` (don't auto-shuffle — new terminals inherit
 *  the active one, seeded from the server default, exactly as `false` behaved
 *  until the user themes a tile). The legacy field is dropped.
 *
 *  Keyed off the PRESENCE of `shuffleTheme` and always wins over the values the
 *  1.10.0 step spreads in (it spreads the current `DEFAULT_PREFERENCES`, which
 *  now carries both new fields), so a very old record arriving with all three
 *  still takes its real intent from `shuffleTheme`. A record with no
 *  `shuffleTheme` (a fresh ≥1.30 install) is returned untouched.
 *
 *  Exported so `state.test.ts` can exercise the conversion directly without
 *  spinning up a `Conf` store under `KOLU_STATE_DIR`. */
export function migratePreferences_1_30_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if (!("shuffleTheme" in current)) return current;
  const { shuffleTheme, ...rest } = current as { shuffleTheme?: unknown };
  const newTerminalTheme = shuffleTheme === false ? "inherit" : "shuffle";
  return {
    ...rest,
    newTerminalTheme,
    shuffleBehavior: DEFAULT_PREFERENCES.shuffleBehavior,
  };
}

/** What conf stores to disk — survives server restart. Internal: `preferences.ts`
 *  reads the per-domain `Preferences` shape, not this aggregate. `session` /
 *  `activityFeed` left this store at W2.2 (they are padi's now); the 1.31.0
 *  migration strips their legacy residue. Adding a new domain key requires a
 *  migration entry below. */
const PersistedStateSchema = z.object({
  preferences: PreferencesSchema,
});

type PersistedState = z.infer<typeof PersistedStateSchema>;

/**
 * Schema version — bump this when adding migrations.
 * Must be valid semver. `conf` runs all migration handlers
 * whose keys are > the last-seen version and ≤ this value.
 */
const SCHEMA_VERSION = "1.32.0";

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

/** Delete a key that is no longer in `PersistedStateSchema` off the raw store —
 *  the conf-ladder idiom for stripping a legacy/orphan key (Conf's typed
 *  `delete` rejects keys outside the current schema, hence the double-cast).
 *  Harmless when the key is absent. */
function deleteLegacyKey(store: Conf<PersistedState>, key: string): void {
  (store as unknown as { delete: (key: string) => void }).delete(key);
}

/** The keys the 1.31.0 BURIAL strips off this store — `session`/`activityFeed`
 *  (moved to padi's state-root at W2.2) plus the older orphan
 *  `sleepingTerminals`/`lastPairedDaemon` present on real disks from earlier
 *  eras. */
const LEGACY_KEYS_STRIPPED_1_31_0 = [
  "session",
  "activityFeed",
  "sleepingTerminals",
  "lastPairedDaemon",
] as const;

/** The 1.31.0 BURIAL migration body — BACKUP-FIRST, then strip.
 *
 *  A direct pre-W2.2 → W2.3 upgrade runs this ladder BEFORE a fresh padi's
 *  one-shot legacy import reads `$KOLU_STATE_DIR`, so an UNCONDITIONAL strip
 *  would destroy the legacy `session` before padi ever reads it. When ANY legacy
 *  key is present, byte-copy the whole config aside to a sibling
 *  `config.json.pre-1.31-strip.bak` FIRST (a wrong strip stays recoverable),
 *  THEN delete the keys. The copy is skipped when no legacy key is present, so a
 *  clean ≥W2.2 file grows no stray `.bak`.
 *
 *  The backup is WRITE-ONCE. `conf` persists each `delete` synchronously but only
 *  records the migration as done AFTER this handler returns, so a crash mid-strip
 *  (backup taken, some keys already deleted) leaves the migration to RERUN on the
 *  next boot — where the now-partially-stripped live file still trips `hasLegacy`.
 *  Re-copying there would clobber the full first backup with a lossy one, breaking
 *  the zero-loss import. So we keep the existing `.bak`: the first copy — taken
 *  before ANY delete — is always the complete pre-strip file, and every later copy
 *  could only be lossier.
 *
 *  Exported so a test can drive it against a real `Conf` under an ephemeral
 *  `KOLU_STATE_DIR` without walking the whole ladder. */
export function stripLegacyStateKeys_1_31_0(store: Conf<PersistedState>): void {
  const raw = store.store as unknown as Record<string, unknown>;
  const hasLegacy = LEGACY_KEYS_STRIPPED_1_31_0.some((key) => key in raw);
  const bakPath = `${store.path}.pre-1.31-strip.bak`;
  if (hasLegacy && !existsSync(bakPath)) {
    // Back up the whole config file BEFORE any delete, so a fresh padi's legacy
    // import (or a human) can still recover the pre-strip session. Write-once (see
    // the doc comment): a rerun after a partial strip must NOT overwrite the full
    // first backup with a lossy one.
    copyFileSync(store.path, bakPath);
  }
  for (const key of LEGACY_KEYS_STRIPPED_1_31_0) deleteLegacyKey(store, key);
}

export const store = new Conf<PersistedState>({
  cwd: stateDir,
  projectVersion: SCHEMA_VERSION,
  defaults: {
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
      // `shuffleTheme` was itself later removed (→ `newTerminalTheme` in
      // 1.30.0), so its historical default is pinned as a literal here rather
      // than read off the current DEFAULT_PREFERENCES (which no longer carries
      // it). The 1.30.0 step converts whatever this writes.
      const shuffleTheme =
        typeof randomTheme === "boolean" ? randomTheme : true;
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
    // 1.18.0 transformed the saved SESSION's terminals (flat
    // `repoName`/`branch` → synthesized `GitInfo`). `session` left this store
    // at W2.2 (it is padi's now), so this is a no-op — the 1.31.0 strip removes
    // any legacy `session` residue rather than reshaping it here.
    "1.18.0": () => {},
    // 1.19.0 collapsed the top-level `recentRepos` + `recentAgents` keys into a
    // single `activityFeed` cell. `activityFeed` itself left this store at W2.2
    // (it is padi's now, stripped by 1.31.0 below), so the WRITE is gone — but
    // keep deleting the two pre-1.19 orphan keys, which 1.31.0's strip list does
    // not cover, so a jump from pre-1.19 straight to W2.3 still cleans them.
    "1.19.0": (store: Conf<PersistedState>) => {
      deleteLegacyKey(store, "recentRepos");
      deleteLegacyKey(store, "recentAgents");
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
    // 1.21.0 seeded `SavedTerminal.lastActivityAt: 0` on legacy session
    // terminals (#830). `session` left this store at W2.2 (padi's now), so this
    // is a no-op — the 1.31.0 strip removes any legacy `session` residue.
    "1.21.0": () => {},
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
    // 1.25.0 backfilled `git.remoteUrl: null` (#1244), 1.26.0 backfilled
    // `location: local` (#1288), 1.27.0 backfilled the `state: active` arm
    // (sleeping-terminals Phase 1) — all on legacy SESSION terminals. `session`
    // left this store at W2.2 (padi's now), so these are no-ops; the 1.31.0
    // strip removes any legacy `session` residue rather than reshaping it here.
    "1.25.0": () => {},
    "1.26.0": () => {},
    "1.27.0": () => {},
    // `SavedTerminal.agentSession` added (the exact agent conversation ref —
    // `{ kind, id }` — captured for resume-by-id on wake/restore, juspay/kolu#1495).
    // The field is OPTIONAL, so a pre-1.28 record that lacks it parses cleanly and
    // simply falls back to the most-recent-conversation resume — no data to
    // backfill, no validation failure. The bump + this entry exist only to honor
    // the "persisted-shape change ⇒ migration ladder step" rule (.claude/rules/state.md).
    "1.28.0": () => {},
    // 1.29.0 ran the awareness-derive-store cutover (#1621) on legacy SESSION
    // terminals (backfilling `pr` + synthesizing `restoreTarget`). `session`
    // left this store at W2.2 (padi's now), so this is a no-op — the 1.31.0
    // strip removes any legacy `session` residue rather than reshaping it here.
    "1.29.0": () => {},
    // `shuffleTheme` (boolean) split into `newTerminalTheme` (inherit|shuffle)
    // + `shuffleBehavior` (random|dark|light|auto) — see
    // `migratePreferences_1_30_0` for the conversion (on→{shuffle,auto},
    // off→{inherit,auto}, legacy-field-wins ladder handling).
    "1.30.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      // `migratePreferences_1_30_0` self-guards (returns `current` untouched
      // when there's no legacy `shuffleTheme`), so no inline presence check.
      store.set(
        "preferences",
        migratePreferences_1_30_0(current) as unknown as Preferences,
      );
    },
    // The BURIAL (W2.3): strip the legacy `session` / `activityFeed` keys — and
    // the older orphan `sleepingTerminals` / `lastPairedDaemon` keys present on
    // real disks from earlier eras — off this store. `session`/`activityFeed`
    // moved to the padi PROCESS's own state-root at W2.2; this store keeps only
    // `preferences` now. BACKUP-FIRST (see `stripLegacyStateKeys_1_31_0`).
    "1.31.0": (store: Conf<PersistedState>) =>
      stripLegacyStateKeys_1_31_0(store),
    // The new-terminal collapsed DEFAULT moved off `rightPanel.collapsed` (a
    // write-dead seed jammed next to live geometry) to a top-level
    // `newTerminalCollapsed` preference beside `newTerminalTheme`. Seed the new
    // top-level field from DEFAULT_PREFERENCES and strip the stale
    // `rightPanel.collapsed` key so the blob matches the schema exactly — same
    // spread-defaults shape as the 1.6.0/1.7.0 rightPanel steps.
    "1.32.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as Record<string, unknown>;
      const rp = current.rightPanel as Record<string, unknown> | undefined;
      const { collapsed: _collapsed, ...restRp } = rp ?? {};
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...current,
        ...(rp !== undefined && {
          rightPanel: restRp as typeof current.rightPanel,
        }),
      } as Preferences);
    },
  },
});

// Early validation so corrupt state shows up in journalctl immediately at
// startup, not only when the first client connects. Validates the on-disk
// shape — `preferences.ts` trusts the validated store thereafter.
const result = PersistedStateSchema.safeParse({
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
