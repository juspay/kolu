/** New-terminal policy — the one place padi decides what a fresh terminal looks
 *  like when the caller doesn't pin it.
 *
 *  The theme used to be resolved in the browser (`useTerminalCrud`), which only
 *  browser-created terminals passed through — so a terminal created by the MCP
 *  server, a TUI or a script landed on the built-in default and ignored the
 *  user's setting (#2045). Resolution now happens at padi's `lifecycle.create`,
 *  the single front door EVERY caller passes through, from the policy the app
 *  chrome REPORTS (held in `terminals.ts`, beside the other chrome-reported
 *  facts). See `packages/padi/README.md` § preferences for WHY this is a report
 *  and not a read, and why it carries an already-resolved `isDark`.
 *
 *  This module owns its own inputs: {@link resolveCreateTerminalTheme} reads the
 *  registry itself, so "what counts as an inherit source" and "what counts as a
 *  peer" live HERE rather than being hand-assembled by the RPC handler.
 *  {@link resolveCreateTerminalThemeFrom} is the pure core the unit suite drives.
 */

import {
  type NewTerminalPolicy,
  shuffleMode,
} from "@kolu/terminal-vocab/schema";
import { availableThemes, pickTheme, resolveThemeBgs } from "terminal-themes";
import { getTerminal, visibleTerminalThemeNames } from "./terminal-registry.ts";
import { getActiveTerminalId, getNewTerminalPolicy } from "./terminals.ts";

export interface ResolveCreateTerminalThemeOptions {
  /** An explicit caller override always wins (session restore, a worktree
   *  create, an MCP caller that named a theme). */
  overrideThemeName?: string;
  /** The reported preference, or `null` when no chrome has reported one. */
  policy: NewTerminalPolicy | null;
  /** The theme of the terminal the user was last in — padi's ONE answer to that
   *  question (`activeTerminalId`, which boot already converges FROM the saved
   *  session, keeping the marker iff its terminal is still present). `undefined`
   *  means "nothing to inherit, or the source is itself on the default theme";
   *  both leave `inherit` with no opinion rather than reaching further back. */
  inheritThemeName?: string;
  /** Every ON-SCREEN terminal's `themeName`, used by `shuffle` to avoid landing
   *  on a background already visible. An `undefined` entry is NOT dropped — it
   *  means "on the default theme", which is what it renders as. */
  peerThemeNames: readonly (string | undefined)[];
  /** Deterministic random source for tests. Defaults to `Math.random`. */
  rand?: () => number;
}

/** Resolve the theme for a create at padi's `lifecycle.create` front door,
 *  reading padi's own registry for the policy's inputs.
 *
 *  `parentId` is the create's parent when it is a SPLIT. The new-terminal policy
 *  governs TOP-LEVEL creates ONLY: a sub-terminal is a pane inside its parent's
 *  tile, not a tile of its own, and it took the caller/server default before
 *  #2045 — so a `shuffle` preference (the default) must not start tinting splits
 *  that were never tinted. Inheriting the PARENT's theme would be a new feature,
 *  not this fix. */
export function resolveCreateTerminalTheme(input: {
  themeName?: string;
  parentId?: string;
}): string | undefined {
  if (input.parentId !== undefined) return input.themeName;
  const activeId = getActiveTerminalId();
  return resolveCreateTerminalThemeFrom({
    overrideThemeName: input.themeName,
    policy: getNewTerminalPolicy(),
    inheritThemeName: activeId
      ? getTerminal(activeId)?.meta.themeName
      : undefined,
    peerThemeNames: visibleTerminalThemeNames(),
  });
}

/** The pure core of {@link resolveCreateTerminalTheme} — every input explicit,
 *  so the decision is unit-testable without a registry.
 *
 *  Returns `undefined` for "no opinion" — an unresolved `inherit` (nothing to
 *  inherit from) or an unreported policy — which leaves the caller on its own
 *  default rather than inventing one here. */
export function resolveCreateTerminalThemeFrom(
  opts: ResolveCreateTerminalThemeOptions,
): string | undefined {
  if (opts.overrideThemeName) return opts.overrideThemeName;
  if (opts.policy === null) return undefined;

  if (opts.policy.newTerminalTheme === "inherit") return opts.inheritThemeName;

  return pickTheme(availableThemes, {
    spread: true,
    peerBgs: resolveThemeBgs(opts.peerThemeNames),
    mode: shuffleMode(opts.policy.shuffleBehavior, opts.policy.isDark),
    rand: opts.rand,
  });
}
