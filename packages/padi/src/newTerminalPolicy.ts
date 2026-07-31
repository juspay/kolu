/** New-terminal policy — what a fresh terminal looks like when the caller
 *  doesn't pin it. Applied at `createTerminal`, the one door every caller
 *  passes through (#2045). See `packages/padi/README.md` § preferences for the
 *  whole rationale — why padi is TOLD the policy rather than reading it, and
 *  what the three rules below mean.
 *
 *  This module owns its own inputs: {@link resolveCreateTerminalTheme} reads the
 *  registry itself, so "what counts as an inherit source" and "what counts as a
 *  peer" live HERE rather than being hand-assembled by the caller.
 *  {@link resolveCreateTerminalThemeFrom} is the pure core the unit suite drives.
 */

import {
  type NewTerminalPolicy,
  shuffleMode,
} from "@kolu/terminal-vocab/schema";
import { availableThemes, pickTheme, resolveThemeBgs } from "terminal-themes";
import { getActiveTerminalId, getNewTerminalPolicy } from "./chromeReports.ts";
import { getTerminal, visibleTerminalThemeNames } from "./terminal-registry.ts";

export interface ResolveCreateTerminalThemeOptions {
  /** An explicit caller override always wins (session restore, a worktree
   *  create, an MCP caller that named a theme). */
  overrideThemeName?: string;
  /** The reported preference, or `null` when no chrome has reported one. */
  policy: NewTerminalPolicy | null;
  /** The theme of the terminal the user was last in — padi's ONE answer to that
   *  question (`activeTerminalId`, which boot already converges FROM the saved
   *  session). `undefined` means "nothing to inherit, or the source is itself on
   *  the default theme"; both leave `inherit` with no opinion rather than
   *  reaching further back. LAZY: only `inherit` reads it. */
  inheritThemeName: () => string | undefined;
  /** Every ON-SCREEN terminal's `themeName`, used by `shuffle` to avoid landing
   *  on a background already visible. LAZY: only `shuffle` reads it, and it
   *  walks the whole registry. */
  peerThemeNames: () => readonly (string | undefined)[];
}

/** Resolve the theme for a create, reading padi's own registry for the policy's
 *  inputs.
 *
 *  `parentId` is the create's parent when it is a SPLIT. The policy governs
 *  TOP-LEVEL creates ONLY: a sub-terminal is a pane inside its parent's tile,
 *  not a tile of its own, and it took the caller/server default before #2045 —
 *  so a `shuffle` preference (the default) must not start tinting splits that
 *  were never tinted. */
export function resolveCreateTerminalTheme(input: {
  themeName?: string;
  parentId?: string;
}): string | undefined {
  if (input.parentId !== undefined) return input.themeName;
  return resolveCreateTerminalThemeFrom({
    overrideThemeName: input.themeName,
    policy: getNewTerminalPolicy(),
    inheritThemeName: () => {
      const activeId = getActiveTerminalId();
      return activeId ? getTerminal(activeId)?.meta.themeName : undefined;
    },
    peerThemeNames: visibleTerminalThemeNames,
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

  if (opts.policy.newTerminalTheme === "inherit")
    return opts.inheritThemeName();

  return pickTheme(availableThemes, {
    spread: true,
    peerBgs: resolveThemeBgs(opts.peerThemeNames()),
    mode: shuffleMode(opts.policy.shuffleBehavior, opts.policy.isDark),
  });
}
