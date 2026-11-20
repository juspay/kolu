import type {
  AuthoredActiveTerminal,
  AuthoredParkedTerminal,
  AuthoredSleepingTerminal,
  TerminalInfo,
} from "@kolu/padi-client/surface";
import { TerminalNotActive, TerminalNotFound } from "@kolu/padi-client/surface";
import type { TerminalId, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import type { TerminalHandle } from "./endpoint.ts";

export interface ActiveTerminalProcess {
  info: TerminalInfo;
  meta: AuthoredActiveTerminal;
  snapshot: TerminalSnapshot;
  handle: TerminalHandle;
}

export interface SleepingTerminalProcess {
  info: TerminalInfo;
  meta: AuthoredSleepingTerminal;
  snapshot: TerminalSnapshot;
  handle?: never;
}

export interface ParkedTerminalProcess {
  info: TerminalInfo;
  meta: AuthoredParkedTerminal;
  snapshot: TerminalSnapshot;
  handle?: never;
}

export type TerminalProcess =
  | ActiveTerminalProcess
  | SleepingTerminalProcess
  | ParkedTerminalProcess;

export type MutableTerminalProcess =
  | ActiveTerminalProcess
  | SleepingTerminalProcess;

const terminals = new Map<TerminalId, TerminalProcess>();

export function registerTerminal(id: TerminalId, entry: TerminalProcess): void {
  terminals.set(id, entry);
}

/** Remove a terminal by id. Returns true if the entry was present. */
export function unregisterTerminal(id: TerminalId): boolean {
  return terminals.delete(id);
}

export function claimActiveTerminal(
  id: TerminalId,
): ActiveTerminalProcess | undefined {
  const entry = terminals.get(id);
  if (!entry?.handle) return undefined;
  terminals.delete(id);
  return entry;
}

export function drainTerminals(): TerminalProcess[] {
  const entries = [...terminals.values()];
  terminals.clear();
  return entries;
}

/** Entries in canonical `Map` insertion order — the client's display
 *  ordering for the terminal list. */
export function terminalEntries(): IterableIterator<
  [TerminalId, TerminalProcess]
> {
  return terminals.entries();
}

export function terminalIds(): TerminalId[] {
  return [...terminals.keys()];
}

export function listTerminals(): TerminalInfo[] {
  return [...terminals.values()].map((entry) => entry.info);
}

export function registryMap<V>(
  pick: (entry: TerminalProcess) => V,
): Map<string, V> {
  const map = new Map<string, V>();
  for (const [id, entry] of terminals) map.set(id, pick(entry));
  return map;
}

export function parkedTerminalIds(): TerminalId[] {
  const ids: TerminalId[] = [];
  for (const [id, entry] of terminals)
    if (entry.meta.state === "parked") ids.push(id);
  return ids;
}

export function hasParkedTerminals(): boolean {
  for (const entry of terminals.values())
    if (entry.meta.state === "parked") return true;
  return false;
}

export function familyOf(id: TerminalId): TerminalId[] {
  const children = new Map<TerminalId, TerminalId[]>();
  for (const [childId, entry] of terminals) {
    const parentId = entry.meta.parentId;
    if (parentId === undefined) continue;
    const siblings = children.get(parentId);
    if (siblings === undefined) children.set(parentId, [childId]);
    else siblings.push(childId);
  }
  const family: TerminalId[] = [];
  const seen = new Set<TerminalId>();
  const visit = (node: TerminalId): void => {
    if (seen.has(node)) return;
    seen.add(node);
    family.push(node);
    for (const childId of children.get(node) ?? []) visit(childId);
  };
  visit(id);
  return family;
}

export const terminalCount = (): number => terminals.size;

export const activeTerminalCount = (): number => {
  let n = 0;
  for (const entry of terminals.values()) if (entry.handle) n++;
  return n;
};

export function countActiveClaudeSessions(): number {
  let n = 0;
  for (const entry of terminals.values()) {
    if (
      entry.meta.state === "active" &&
      entry.snapshot.agent?.kind === "claude-code"
    )
      n++;
  }
  return n;
}

export function getTerminal(id: TerminalId): TerminalProcess | undefined {
  return terminals.get(id);
}

export function snapshotFor(id: TerminalId): TerminalSnapshot | undefined {
  return terminals.get(id)?.snapshot;
}

export function getActiveTerminal(
  id: TerminalId,
): ActiveTerminalProcess | undefined {
  const entry = terminals.get(id);
  return entry?.handle ? entry : undefined;
}

export function requireActiveTerminal(id: TerminalId): ActiveTerminalProcess {
  const entry = terminals.get(id);
  if (!entry) throw terminalNotFound(id);
  if (!entry.handle) throw terminalNotActive(id, entry.meta.state);
  return entry;
}

export function requireTerminal(id: TerminalId): TerminalProcess {
  const entry = getTerminal(id);
  if (!entry) throw terminalNotFound(id);
  return entry;
}

function isMutable(entry: TerminalProcess): entry is MutableTerminalProcess {
  return entry.meta.state !== "parked";
}

export function requireMutableTerminal(id: TerminalId): MutableTerminalProcess {
  const entry = requireTerminal(id);
  if (!isMutable(entry)) throw terminalNotFound(id);
  return entry;
}

export function terminalNotFound(id: string): TerminalNotFound {
  return new TerminalNotFound({ id });
}

export function terminalNotActive(
  id: string,
  state: "sleeping" | "parked",
): TerminalNotActive {
  return new TerminalNotActive({ id, state });
}
