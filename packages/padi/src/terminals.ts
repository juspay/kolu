import type { RightPanelPerTerminalState } from "@kolu/padi-client/surface";
import {
  type CreateTerminalInput,
  composeTerminalMetadata,
  LOCAL_LOCATION,
  parentIdOf,
  type RestoreOnlyMetadata,
  type SavedTerminal,
  SavedTerminalSchema,
  type TerminalClientMetadata,
  type TerminalInfo,
  TerminalParentCycle,
  type TerminalPlacement,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";
import { reportActiveTerminalId } from "./session/autosaveGate.ts";
import { type SessionSnapshot, saveSession } from "./session/session.ts";
import {
  type ActiveTerminalProcess,
  familyOf,
  getActiveTerminal,
  getTerminal,
  type MutableTerminalProcess,
  terminalEntries,
  terminalNotFound,
} from "./terminal-registry.ts";
import {
  beginSleepLocal,
  releaseSleptLocalPty,
  restartSleptLocal,
  wakeSubtreeLocal,
} from "./terminalEndpoint/local.ts";
// biome-ignore-start assist/source/organizeImports: cycle-sensitive load order
import { updateClientMetadata } from "./terminalEndpoint/metadata.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";

// biome-ignore-end assist/source/organizeImports: cycle-sensitive load order

const decodeSavedTerminal = Schema.decodeUnknownSync(SavedTerminalSchema);

const localEndpoint = resolveTerminalEndpoint(LOCAL_LOCATION);

export {
  activeTerminalCount,
  countActiveClaudeSessions,
  getTerminal,
  listTerminals,
  type TerminalProcess,
  terminalCount,
} from "./terminal-registry.ts";

function persistableEntries(): [TerminalId, MutableTerminalProcess][] {
  return [...terminalEntries()].filter(
    (entry): entry is [TerminalId, MutableTerminalProcess] =>
      entry[1].meta.state !== "parked",
  );
}

function savedTerminalOf(
  id: TerminalId,
  entry: MutableTerminalProcess,
): SavedTerminal {
  return decodeSavedTerminal({
    ...composeTerminalMetadata(entry.meta, entry.snapshot),
    id,
  });
}

export function snapshotSession(): SessionSnapshot {
  return {
    terminals: persistableEntries().map(([id, entry]) =>
      savedTerminalOf(id, entry),
    ),
    activeTerminalId,
  };
}

/** Create a new terminal — the ORDINARY constructor: mints an id and forwards to
 *  the endpoint, which owns PTY spawn, provider startup and registry insert.
 *  `initial` seeds client-owned chrome before providers run. Session restore uses
 *  {@link restoreSpawn}, the only constructor that may seed server-derived facts. */
export function createTerminal(
  placement: TerminalPlacement,
  cwd?: string,
  initial?: CreateTerminalInput,
): TerminalInfo {
  const id = crypto.randomUUID();
  return localEndpoint.spawnPty(id, {
    cwd,
    parentId: parentIdOf(placement),
    initialMetadata: initial,
  });
}

/** Re-spawn a terminal DURING SESSION RESTORE, under its OWN id — the one
 *  constructor that may seed the three server-derived authored facts
 *  (`restoreOnly`). Called only by `sessionRestore.ts`'s `respawnActive`, which
 *  guarantees the id is free. */
export function restoreSpawn(
  id: TerminalId,
  cwd: string | undefined,
  parentId: string | undefined,
  initial: CreateTerminalInput,
  restoreOnly: RestoreOnlyMetadata,
): TerminalInfo {
  return localEndpoint.spawnPty(id, {
    cwd,
    parentId,
    initialMetadata: { ...initial, ...restoreOnly },
  });
}

/** Kill a terminal, routed to the endpoint that owns it. Returns final info, or
 *  `undefined` when `id` is not an active terminal — which includes losing the
 *  race to a concurrent kill that claimed it first. */
export async function killTerminal(
  id: TerminalId,
): Promise<TerminalInfo | undefined> {
  const entry = getTerminal(id);
  if (!entry) return undefined;
  return resolveTerminalEndpoint(entry.meta.location).killTerminal(id);
}

/** Sleep a terminal AND ITS SPLITS — one family, one dormant record per member,
 *  persisted once before any PTY is released. A no-op when no member was active. */
export async function sleepTerminal(id: TerminalId): Promise<void> {
  const slept: TerminalId[] = [];
  for (const member of familyOf(id).reverse())
    if (beginSleepLocal(member)) slept.push(member);
  if (slept.length === 0) return;
  saveSession(snapshotSession());
  for (const member of slept) await releaseSleptLocalPty(member);
}

/** Restart a terminal AND ITS SPLITS IN PLACE — a fresh PTY per member, each on
 *  its own id, in its own cwd, keeping its layout, parent edge, theme and title.
 *  `undefined` when `id` is not an active terminal. */
export async function restartTerminal(
  id: TerminalId,
): Promise<{ info: TerminalInfo; resumed: boolean } | undefined> {
  if (!getActiveTerminal(id)) return undefined;
  const family = familyOf(id);
  const owesPtyRelease = new Set<TerminalId>();
  for (const member of [...family].reverse())
    if (beginSleepLocal(member)) owesPtyRelease.add(member);
  const done = (async () => {
    saveSession(snapshotSession());
    let asked: { info: TerminalInfo; resumed: boolean } | undefined;
    const handled = new Set<TerminalId>();
    try {
      for (const member of family) {
        if (handled.has(member)) continue;
        if (!owesPtyRelease.has(member)) {
          for (const covered of familyOf(member))
            if (!owesPtyRelease.has(covered)) handled.add(covered);
          await wakeSubtreeLocal(member);
          continue;
        }
        owesPtyRelease.delete(member);
        const result = await restartSleptLocal(member);
        if (member === id) asked = result;
      }
      return asked;
    } catch (err) {
      for (const member of owesPtyRelease)
        if (getTerminal(member)?.meta.state === "sleeping")
          await releaseSleptLocalPty(member);
      throw err;
    }
  })();
  const settled = done.then(
    () => undefined,
    () => undefined,
  );
  for (const member of family) restartsInFlight.set(member, settled);
  try {
    return await done;
  } finally {
    for (const member of family) restartsInFlight.delete(member);
  }
}

const restartsInFlight = new Map<TerminalId, Promise<undefined>>();

/** The terminal an ATTACH may open: an attach landing during a restart waits for
 *  that restart to settle. A sleeping or absent id is refused as
 *  `TerminalNotFound`, the one tag a stream consumer can act on. */
export async function requireAttachableTerminal(
  id: TerminalId,
): Promise<ActiveTerminalProcess> {
  const pending = restartsInFlight.get(id);
  if (pending !== undefined) await pending;
  const attachable = getActiveTerminal(id);
  if (!attachable) throw terminalNotFound(id);
  return attachable;
}

/** Refuse a parent edge that is nonsense in any tree model: self-parent, or an
 *  edge that would close a cycle. Depth is not limited. */
export function requireAcyclicParent(
  childId: TerminalId,
  parentId: TerminalId,
): void {
  if (childId === parentId) {
    throw new TerminalParentCycle({ childId, parentId, reason: "self" });
  }
  let cur: string | undefined = parentId;
  const seen = new Set<string>();
  while (cur !== undefined) {
    if (cur === childId) {
      throw new TerminalParentCycle({
        childId,
        parentId,
        reason: "wouldCycle",
      });
    }
    if (seen.has(cur)) {
      throw new TerminalParentCycle({
        childId,
        parentId,
        reason: "parentInCycle",
      });
    }
    seen.add(cur);
    cur = getTerminal(cur as TerminalId)?.meta.parentId;
  }
}

export function setTerminalParent(
  id: TerminalId,
  parentId: string | null,
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  if (parentId !== null) requireAcyclicParent(id, parentId as TerminalId);
  updateClientMetadata(entry, id, (m) => {
    // `Schema.optionalKey` accepts an ABSENT key and REJECTS a present
    // `undefined` one, and the record is re-decoded on every flip.
    if (parentId === null) delete m.parentId;
    else m.parentId = parentId;
  });
}

export function setCanvasLayout(
  id: TerminalId,
  layout: { x: number; y: number; w: number; h: number },
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  updateClientMetadata(entry, id, (m) => {
    m.canvasLayout = layout;
  });
}

function publishClientMetadataIfChanged<K extends keyof TerminalClientMetadata>(
  id: TerminalId,
  key: K,
  value: NonNullable<TerminalClientMetadata[K]>,
  equal: (
    a: NonNullable<TerminalClientMetadata[K]>,
    b: NonNullable<TerminalClientMetadata[K]>,
  ) => boolean,
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  const meta: TerminalClientMetadata = entry.meta;
  const current = meta[key];
  if (current !== undefined && equal(current, value)) return;
  updateClientMetadata(entry, id, (m) => {
    m[key] = value;
  });
}

export function setSubPanelState(
  id: TerminalId,
  state: { collapsed: boolean; panelSize: number },
): void {
  publishClientMetadataIfChanged(id, "subPanel", state, subPanelStateEqual);
}

function subPanelStateEqual(
  a: { collapsed: boolean; panelSize: number },
  b: { collapsed: boolean; panelSize: number },
): boolean {
  return a.collapsed === b.collapsed && a.panelSize === b.panelSize;
}

export function setRightPanelState(
  id: TerminalId,
  state: RightPanelPerTerminalState,
): void {
  publishClientMetadataIfChanged(id, "rightPanel", state, rightPanelStateEqual);
}

function rightPanelStateEqual(
  a: RightPanelPerTerminalState,
  b: RightPanelPerTerminalState,
): boolean {
  if (a.collapsed !== b.collapsed) return false;
  if (a.activeTab !== b.activeTab || a.codeMode !== b.codeMode) return false;
  const am = a.selectedFileByMode;
  const bm = b.selectedFileByMode;
  if (am === bm) return true;
  if (!am || !bm) return false;
  if (am.local !== bm.local) return false;
  if (am.branch !== bm.branch) return false;
  if (am.browse !== bm.browse) return false;
  return true;
}

let activeTerminalId: TerminalId | null = null;

function assignActiveTerminalId(id: TerminalId | null): void {
  activeTerminalId = id;
}

/** The client-reported active-terminal marker. It can name a terminal that no
 *  longer exists — re-validate through `getTerminal` rather than trust it. */
export function getActiveTerminalId(): TerminalId | null {
  return activeTerminalId;
}

/** Store which terminal is active (reported by the client). A null report is
 *  dropped rather than persisted. */
export function setActiveTerminalId(id: TerminalId | null): void {
  assignActiveTerminalId(id);
  if (id !== null) reportActiveTerminalId(id);
}

/** Seed the active-terminal marker from a session adopted at boot, WITHOUT
 *  persisting anything. */
export function restoreActiveTerminalId(id: TerminalId | null): void {
  assignActiveTerminalId(id);
}

export function setTerminalTheme(id: TerminalId, themeName: string): void {
  const entry = getTerminal(id);
  if (entry) {
    updateClientMetadata(entry, id, (m) => {
      m.themeName = themeName;
    });
  }
}

/** Set or clear a terminal's freeform intent annotation. Empty string clears. */
export function setTerminalIntent(id: TerminalId, intent: string): void {
  const entry = getTerminal(id);
  if (!entry) return;
  updateClientMetadata(entry, id, (m) => {
    if (intent.length > 0) m.intent = intent;
    else delete m.intent;
  });
}

export async function killAllTerminals(): Promise<void> {
  await localEndpoint.killAllTerminals();
}
