import {
  DEFAULT_NEW_TERMINAL_POLICY,
  type NewTerminalPolicy,
} from "@kolu/padi-client/surface";
import { type CellStore, inMemoryStore } from "@kolu/surface/server";
import {
  availableThemes,
  pickTheme,
  resolveThemeBgs,
  type ThemePickMode,
} from "terminal-themes";
import { match } from "ts-pattern";
import { getTerminal, terminalEntries } from "./terminal-registry.ts";
import { getActiveTerminalId } from "./terminals.ts";

export const newTerminalPolicyStore: CellStore<NewTerminalPolicy> =
  inMemoryStore(DEFAULT_NEW_TERMINAL_POLICY);

export function shufflePeerBgs(): string[] {
  const peerIds = [...terminalEntries()]
    .filter(
      ([, entry]) =>
        entry.meta.state !== "parked" && entry.meta.parentId === undefined,
    )
    .map(([id]) => id);
  return resolveThemeBgs(peerIds, (id) => getTerminal(id)?.meta.themeName);
}

export function resolveNewTerminalTheme(): string | undefined {
  return match(newTerminalPolicyStore.get())
    .with({ kind: "inherit" }, () => {
      const activeId = getActiveTerminalId();
      return activeId === null
        ? undefined
        : getTerminal(activeId)?.meta.themeName;
    })
    .with({ kind: "shuffle" }, ({ mode }) =>
      pickTheme(availableThemes, {
        spread: true,
        peerBgs: shufflePeerBgs(),
        mode: mode === "random" ? undefined : (mode satisfies ThemePickMode),
      }),
    )
    .exhaustive();
}
