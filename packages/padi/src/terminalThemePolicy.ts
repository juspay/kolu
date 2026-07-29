/** Terminal-theme policy for new terminals — the one place padi decides what a
 *  fresh terminal looks like when the caller doesn't pin a theme.
 *
 *  The preference values are read from the existing kolu-server conf store
 *  (`$KOLU_STATE_DIR/config.json`) so the browser and every out-of-band caller
 *  (MCP, a TUI, a script) converge on the same user setting without duplicating
 *  the decision in each frontend. The on-disk shape is the single source of
 *  truth; padi only reads the two fields it needs.
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

export type NewTerminalTheme = "inherit" | "shuffle";

export type ShuffleBehavior =
  | "random"
  | "dark"
  | "light"
  | "auto"
  | "colourful";

export type ColorScheme = "light" | "dark" | "system";

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

function isNewTerminalTheme(v: unknown): v is NewTerminalTheme {
  return v === "inherit" || v === "shuffle";
}

function isShuffleBehavior(v: unknown): v is ShuffleBehavior {
  return (
    v === "random" ||
    v === "dark" ||
    v === "light" ||
    v === "auto" ||
    v === "colourful"
  );
}

function isColorScheme(v: unknown): v is ColorScheme {
  return v === "light" || v === "dark" || v === "system";
}

/** The candidate-pool filter a shuffle should apply, copied from the
 *  `shuffleMode` helper in `kolu-common/surface` so padi doesn't need to import
 *  across the package boundary. `undefined` means no restriction (`random`). */
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

/** Resolve whether the current color scheme family is dark. `"system"` defaults
 *  to dark because padi has no access to the OS media query; an explicit
 *  `"light"` is the only headless signal we can act on. */
function isDarkFromPolicy(colorScheme: ColorScheme): boolean {
  return colorScheme !== "light";
}

/** Read the user's terminal-theme policy from the kolu-server conf store.
 *  `$KOLU_STATE_DIR` is already forwarded to padi by `daemonEnv`
 *  (`packages/server/src/padi/padiBinding.ts`), so a padi booted by kolu-server
 *  sees the live user prefs. A standalone padi (no server) returns defaults —
 *  the create still works, just with the built-in defaults. */
export function readTerminalThemePolicyFromEnv(): TerminalThemePolicy {
  const stateDir = process.env.KOLU_STATE_DIR;
  if (!stateDir) return DEFAULT_TERMINAL_THEME_POLICY;

  const configPath = join(stateDir, "config.json");
  if (!existsSync(configPath)) return DEFAULT_TERMINAL_THEME_POLICY;

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    const prefs =
      raw != null && typeof raw === "object" && "preferences" in raw
        ? (raw.preferences as unknown)
        : {};
    const prefObj = prefs != null && typeof prefs === "object" ? prefs : {};
    return {
      newTerminalTheme: isNewTerminalTheme(
        (prefObj as Record<string, unknown>).newTerminalTheme,
      )
        ? ((prefObj as Record<string, unknown>)
            .newTerminalTheme as NewTerminalTheme)
        : DEFAULT_TERMINAL_THEME_POLICY.newTerminalTheme,
      shuffleBehavior: isShuffleBehavior(
        (prefObj as Record<string, unknown>).shuffleBehavior,
      )
        ? ((prefObj as Record<string, unknown>)
            .shuffleBehavior as ShuffleBehavior)
        : DEFAULT_TERMINAL_THEME_POLICY.shuffleBehavior,
      colorScheme: isColorScheme(
        (prefObj as Record<string, unknown>).colorScheme,
      )
        ? ((prefObj as Record<string, unknown>).colorScheme as ColorScheme)
        : DEFAULT_TERMINAL_THEME_POLICY.colorScheme,
    };
  } catch {
    // A corrupt conf file is kolu-server's fail-fast concern, not padi's.
    // Falling back to defaults here keeps a standalone create working while
    // the server surfaces the real corruption on its own boot.
    return DEFAULT_TERMINAL_THEME_POLICY;
  }
}

export interface ResolveCreateTerminalThemeOptions {
  /** An explicit caller override always wins. */
  overrideThemeName?: string;
  policy: TerminalThemePolicy;
  /** The active terminal's current `themeName`, if any. */
  activeThemeName?: string;
  /** The most recently used explicit theme, used by "inherit" when nothing is
   *  currently active. */
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
