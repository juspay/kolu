/** Terminal-theme policy for new terminals — the one place padi decides what a
 *  fresh terminal looks like when the caller doesn't pin a theme.
 *
 *  The preference values are read from the existing kolu-server conf store
 *  (`$KOLU_STATE_DIR/config.json`) so the browser and every out-of-band caller
 *  (MCP, a TUI, a script) converge on the same user setting without duplicating
 *  the decision in each frontend. The on-disk shape is the single source of
 *  truth; padi only reads the three fields it needs.
 *
 *  The three preference literals and the shuffle→mode mapping mirror
 *  `kolu-common/surface.ts`'s zod schemas and `shuffleMode` helper, but
 *  padi's package seal (see `assembly.ts` / `clientPolicy.ts`) forbids
 *  importing `kolu-common` — the dependency arrow runs the other way. So
 *  the literals are re-declared here; a schema change in kolu-common must
 *  be reflected here. The zod narrowing in `readTerminalThemePolicy`
 *  validates at the boundary so a drift surfaces loudly.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  availableThemes,
  DEFAULT_THEME_NAME,
  pickTheme,
  resolveThemeBgs,
  type ThemePickMode,
} from "terminal-themes";
import { z } from "zod";

// Literal source of truth for the three preference enums. Mirrors
// kolu-common/surface.ts's zod schemas; kept in lock-step by convention
// (the padi seal prevents importing them).
const NEW_TERMINAL_THEMES = ["inherit", "shuffle"] as const;
export type NewTerminalTheme = (typeof NEW_TERMINAL_THEMES)[number];

const SHUFFLE_BEHAVIORS = [
  "random",
  "dark",
  "light",
  "auto",
  "colourful",
] as const;
export type ShuffleBehavior = (typeof SHUFFLE_BEHAVIORS)[number];

const COLOR_SCHEMES = ["light", "dark", "system"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export interface TerminalThemePolicy {
  newTerminalTheme: NewTerminalTheme;
  shuffleBehavior: ShuffleBehavior;
  colorScheme: ColorScheme;
}

export const DEFAULT_TERMINAL_THEME_POLICY: TerminalThemePolicy = {
  newTerminalTheme: "shuffle",
  shuffleBehavior: "auto",
  colorScheme: "dark",
};

/** Narrow zod schema for just the three fields padi reads from the conf
 *  file. Full `PreferencesSchema` lives in `kolu-common/surface.ts`; this is
 *  the minimum subset padi's seal allows it to read. `.catch()` at each
 *  field maps a wrong-typed value to the whole-block fallback, matching
 *  kolu-server's fail-fast behaviour on the server side (the server throws
 *  on a corrupt file; padi falls back to defaults so a standalone create
 *  still works). */
const ThemePrefsSubsetSchema = z.object({
  newTerminalTheme: z
    .enum(NEW_TERMINAL_THEMES)
    .catch(DEFAULT_TERMINAL_THEME_POLICY.newTerminalTheme),
  shuffleBehavior: z
    .enum(SHUFFLE_BEHAVIORS)
    .catch(DEFAULT_TERMINAL_THEME_POLICY.shuffleBehavior),
  colorScheme: z
    .enum(COLOR_SCHEMES)
    .catch(DEFAULT_TERMINAL_THEME_POLICY.colorScheme),
});

/** The candidate-pool filter a shuffle should apply, copied from the
 *  `shuffleMode` helper in `kolu-common/surface` — copied because padi's
 *  package seal forbids importing `kolu-common` (the dependency arrow runs
 *  `kolu-common → @kolu/padi`, never back). `undefined` means no
 *  restriction (`random`). */
function shuffleMode(
  behavior: ShuffleBehavior,
  isDark: boolean,
): ThemePickMode | undefined {
  switch (behavior) {
    case "random":
      return undefined;
    case "dark":
      return "dark";
    case "light":
      return "light";
    case "auto":
      return isDark ? "dark" : "light";
    case "colourful":
      return "colourful";
    default:
      return undefined;
  }
}

/** POLICY CHOICE: padi treats an unresolvable color scheme as dark.
 *
 *  The app preference can be `"system"`, but padi runs headless — it has
 *  no OS media-query to consult. So rather than carry an "unknown" third
 *  state through the shuffle, we SMUSH: any non-`"light"` value counts as
 *  dark for shuffle purposes. The browser (which CAN resolve `"system"`)
 *  still uses the real value for its own shuffle decisions in
 *  `useTerminalCrud`; this asymmetry affects only padi-resolved shuffles
 *  under preference `"system"`. */
function isDarkFromPolicy(colorScheme: ColorScheme): boolean {
  return colorScheme !== "light";
}

/** Read the user's terminal-theme policy from a kolu conf directory.
 *  Pure function — testable without env-var shuffling. */
export function readTerminalThemePolicy(stateDir: string): TerminalThemePolicy {
  const configPath = join(stateDir, "config.json");
  if (!existsSync(configPath)) return DEFAULT_TERMINAL_THEME_POLICY;

  try {
    const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    const prefs =
      raw != null && typeof raw === "object" && "preferences" in raw
        ? raw.preferences
        : {};
    const parsed = ThemePrefsSubsetSchema.safeParse(prefs);
    return parsed.success ? parsed.data : DEFAULT_TERMINAL_THEME_POLICY;
  } catch {
    // A corrupt conf file is kolu-server's fail-fast concern, not padi's.
    // Falling back to defaults here keeps a standalone create working while
    // the server surfaces the real corruption on its own boot.
    return DEFAULT_TERMINAL_THEME_POLICY;
  }
}

/** Env-var-reading wrapper — the injectable default padi's surface deps use.
 *  `$KOLU_STATE_DIR` is already forwarded to padi by `daemonEnv`
 *  (`packages/server/src/padi/padiBinding.ts`), so a padi booted by
 *  kolu-server sees the live user prefs. A standalone padi (no server)
 *  returns defaults. */
export function readTerminalThemePolicyFromEnv(): TerminalThemePolicy {
  const stateDir = process.env.KOLU_STATE_DIR;
  if (!stateDir) return DEFAULT_TERMINAL_THEME_POLICY;
  return readTerminalThemePolicy(stateDir);
}

export interface ResolveCreateTerminalThemeOptions {
  /** An explicit caller override always wins. */
  overrideThemeName?: string;
  policy: TerminalThemePolicy;
  /** The active terminal's current `themeName`, if any. */
  activeThemeName?: string;
  /** The saved session's active-terminal `themeName` — inherit's fallback
   *  when no live terminal is active. (Named "last" because padi has no
   *  direct recency signal; the caller supplies the best proxy it has.) */
  lastThemeName?: string;
  /** Every live terminal's current `themeName` — used by "shuffle" to avoid
   *  landing on a duplicate background. */
  peerThemeNames: string[];
  /** Deterministic random source for tests. Defaults to `Math.random`. */
  rand?: () => number;
}

/** Pick the theme for a newly created terminal, honouring the user's preference
 *  exactly the way the browser's `useTerminalCrud` used to. */
export function resolveCreateTerminalTheme(
  opts: ResolveCreateTerminalThemeOptions,
): string {
  if (opts.overrideThemeName) {
    return opts.overrideThemeName;
  }

  if (opts.policy.newTerminalTheme === "inherit") {
    return opts.activeThemeName ?? opts.lastThemeName ?? DEFAULT_THEME_NAME;
  }

  const mode = shuffleMode(
    opts.policy.shuffleBehavior,
    isDarkFromPolicy(opts.policy.colorScheme),
  );
  const peerBgs = resolveThemeBgs(opts.peerThemeNames, (name) => name);
  return pickTheme(availableThemes, {
    spread: true,
    peerBgs,
    mode,
    rand: opts.rand,
  });
}
