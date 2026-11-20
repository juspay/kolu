import {
  knownPorts,
  type TerminalId,
  type TerminalPorts,
} from "kolu-common/surface";
import {
  terminalKey,
  type TerminalLocation,
} from "@kolu/terminal-vocab/terminalKey";

export interface ServingCandidate {
  id: TerminalId;
  parentId: TerminalId | null;
  ports: TerminalPorts;
}

export function terminalServingPort(opts: {
  port: number;
  terminals: readonly ServingCandidate[];
}): TerminalId | undefined {
  for (const candidate of opts.terminals) {
    if (knownPorts(candidate.ports).some((p) => p.port === opts.port)) {
      return candidate.parentId ?? candidate.id;
    }
  }
  return undefined;
}

export function servingLink(opts: {
  port: number;
  candidates: readonly ServingCandidate[];
  armOf: (id: TerminalId) => TerminalLocation | undefined;
  activate: (id: TerminalId) => void;
}): { name: string; jump: () => void } | undefined {
  const found = terminalServingPort({
    port: opts.port,
    terminals: opts.candidates,
  });
  if (found === undefined) return undefined;
  const arm = opts.armOf(found);
  if (arm === undefined) return undefined;
  return {
    name: servingTerminalName(arm),
    jump: () => {
      opts.activate(found);
    },
  };
}

export function servingTerminalName(loc: TerminalLocation): string {
  const key = terminalKey(loc);
  return loc.git.kind === "repo" ? `${key.group}/${key.label}` : key.label;
}
