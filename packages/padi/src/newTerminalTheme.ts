/**
 * New-terminal theme resolution — the padi half of the policy split.
 *
 * kolu-server pushes the RESOLVED {@link NewTerminalPolicy} into the
 * `newTerminalPolicy` cell; `lifecycle.create` calls
 * {@link resolveNewTerminalTheme} whenever the caller supplied no explicit
 * `themeName`. Because the resolution happens HERE, every face that creates a
 * terminal — browser, MCP, CLI — obeys the user's setting, which is the whole
 * point of #2045.
 *
 * DELIBERATE split with the browser's ⌘⇧J shuffle (`useThemeManager.ts`): that
 * one is a live viewer act on the focused tile and keeps its local resolution.
 * Same preference, two sites, on purpose.
 */

import { type CellStore, inMemoryStore } from "@kolu/surface/server";
import {
  availableThemes,
  pickTheme,
  resolveThemeBgs,
  type ThemePickMode,
} from "terminal-themes";
import {
  DEFAULT_NEW_TERMINAL_POLICY,
  type NewTerminalPolicy,
} from "./newTerminalPolicy.ts";
import { getTerminal, terminalEntries } from "./terminal-registry.ts";
import { getActiveTerminalId } from "./terminals.ts";

/** The backing store of the `newTerminalPolicy` cell — a module-level store the
 *  cell declaration and {@link resolveNewTerminalTheme} SHARE, so the create
 *  handler resolves against exactly what the binder wrote over the wire.
 *  Deliberately not read back through `padiSurfaceCtx`: the noop test ctx answers
 *  `undefined` for every cell, which would force a `?? DEFAULT` fallback into
 *  production code. */
export const newTerminalPolicyStore: CellStore<NewTerminalPolicy> =
  inMemoryStore(DEFAULT_NEW_TERMINAL_POLICY);

/** The theme backgrounds a shuffle scores against — every registry entry EXCEPT
 *  the parked ones, whose tints belong to a dead pre-reboot session rather than a
 *  visible tile. Exported for the test suite. */
export function shufflePeerBgs(): string[] {
  const peerIds = [...terminalEntries()]
    .filter(([, entry]) => entry.meta.state !== "parked")
    .map(([id]) => id);
  return resolveThemeBgs(peerIds, (id) => getTerminal(id)?.meta.themeName);
}

/** The theme a new terminal gets under the current policy, or `undefined` when
 *  the policy resolves to no theme at all (inherit with nothing to inherit from)
 *  — that IS the answer: the metadata stays theme-less and the client renders its
 *  built-in default. */
export function resolveNewTerminalTheme(): string | undefined {
  const policy = newTerminalPolicyStore.get();
  switch (policy.kind) {
    case "inherit": {
      // The marker can name a terminal that has since been killed, so it is only
      // an id until the registry confirms it.
      const activeId = getActiveTerminalId();
      return activeId === null
        ? undefined
        : getTerminal(activeId)?.meta.themeName;
    }
    case "shuffle":
      return pickTheme(availableThemes, {
        spread: true,
        peerBgs: shufflePeerBgs(),
        // `pickTheme` spells "the whole catalogue" as an absent mode — its
        // `ThemePickMode` has no "random" member.
        mode:
          policy.mode === "random"
            ? undefined
            : (policy.mode satisfies ThemePickMode),
      });
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}
