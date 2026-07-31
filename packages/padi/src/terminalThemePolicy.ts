/** Terminal-theme policy for new terminals — the one place padi decides what a
 *  fresh terminal looks like when the caller doesn't pin a theme.
 *
 *  ── Why padi decides, and how it learns the preference ──────────────────────
 *  The theme used to be resolved in the browser (`useTerminalCrud`), which only
 *  browser-created terminals passed through — so a terminal created by the MCP
 *  server, a TUI or a script landed on the built-in default and ignored the
 *  user's setting (#2045). Resolution now happens at padi's `lifecycle.create`,
 *  the single front door EVERY caller passes through.
 *
 *  padi is not the OWNER of the preference — kolu-server is (its conf store).
 *  padi learns it by REPORT: the app chrome calls
 *  `chrome.setNewTerminalThemePolicy` and padi holds the last report, exactly
 *  the way `setActiveTerminalId` holds the last reported active terminal. The
 *  report travels over padi's surface, so it reaches a REMOTE padi over the ssh
 *  hop identically to a local one — which reading kolu-server's `config.json`
 *  off disk could never do (`$KOLU_STATE_DIR` is a local-arm-only env var; the
 *  remote arm carries state via `--state-root` argv, see `remotePadiBinding.ts`).
 *
 *  The report carries `isDark`, the browser's RESOLVED answer, never the raw
 *  `colorScheme` preference: `"system"` can only be resolved against a media
 *  query, and padi runs headless. The guarantee sits at the endpoint that knows
 *  enough to make it.
 *
 *  Until a chrome has reported (a padi nobody has opened a browser against),
 *  there is no user preference to honour and {@link resolveCreateTerminalTheme}
 *  returns `undefined` — the caller's own default, exactly what a create did
 *  before any of this existed. That is an ABSENT fact, not a degraded one; padi
 *  invents no default preference of its own to drift from kolu-common's.
 */

import {
  type NewTerminalTheme,
  type ShuffleBehavior,
  shuffleMode,
} from "@kolu/terminal-vocab/schema";
import { availableThemes, pickTheme, resolveThemeBgs } from "terminal-themes";

/** The user's new-terminal theme preference as the app chrome reports it —
 *  already resolved (`isDark`, not a `"system"` colour scheme). */
export interface TerminalThemePolicy {
  newTerminalTheme: NewTerminalTheme;
  shuffleBehavior: ShuffleBehavior;
  /** The app's RESOLVED dark mode. Only the browser can answer this for a
   *  `"system"` colour scheme, so it arrives resolved. */
  isDark: boolean;
}

/** The last policy the app chrome reported, or `null` if none ever has.
 *  Module-global for the same reason `activeTerminalId` is: one padi, one
 *  chrome-reported fact, read by whichever create comes next. */
let reportedPolicy: TerminalThemePolicy | null = null;

/** Record the app chrome's new-terminal theme report (`chrome.setNewTerminalThemePolicy`). */
export function setNewTerminalThemePolicy(policy: TerminalThemePolicy): void {
  reportedPolicy = policy;
}

/** The last reported policy, or `null` if no chrome has reported one yet. */
export function getNewTerminalThemePolicy(): TerminalThemePolicy | null {
  return reportedPolicy;
}

/** Test seam — drop the reported policy so a suite starts from "nobody has
 *  reported", the state a fresh padi boots in. */
export function resetNewTerminalThemePolicyForTest(): void {
  reportedPolicy = null;
}

export interface ResolveCreateTerminalThemeOptions {
  /** An explicit caller override always wins (session restore, a worktree
   *  create, an MCP caller that named a theme). */
  overrideThemeName?: string;
  /** The reported preference, or `null` when no chrome has reported one. */
  policy: TerminalThemePolicy | null;
  /** Inherit's sources, BEST FIRST — the live active terminal's theme, then the
   *  saved session's active terminal (padi's best proxy for "the terminal the
   *  user was last in" before any client has reconnected). The first defined
   *  entry wins; all-undefined means there is nothing to inherit. */
  inheritCandidates: readonly (string | undefined)[];
  /** Each live terminal's `themeName`, used by `shuffle` to avoid landing on a
   *  background already on screen. An `undefined` entry is NOT dropped — it
   *  means "on the default theme", which is what it renders as, and
   *  `resolveThemeBgs` maps it to that background. */
  peerThemeNames: readonly (string | undefined)[];
  /** Deterministic random source for tests. Defaults to `Math.random`. */
  rand?: () => number;
}

/** Pick the theme for a newly created terminal.
 *
 *  Returns `undefined` for "no opinion" — an unresolved `inherit` (nothing to
 *  inherit from) or an unreported policy — which leaves the caller on its own
 *  default rather than inventing one here. */
export function resolveCreateTerminalTheme(
  opts: ResolveCreateTerminalThemeOptions,
): string | undefined {
  if (opts.overrideThemeName) return opts.overrideThemeName;
  if (opts.policy === null) return undefined;

  if (opts.policy.newTerminalTheme === "inherit")
    return opts.inheritCandidates.find((name) => name !== undefined);

  return pickTheme(availableThemes, {
    spread: true,
    peerBgs: resolveThemeBgs(opts.peerThemeNames, (name) => name),
    mode: shuffleMode(opts.policy.shuffleBehavior, opts.policy.isDark),
    rand: opts.rand,
  });
}
