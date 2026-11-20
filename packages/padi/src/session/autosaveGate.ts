import type { SavedSession } from "@kolu/padi-client/surface";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import type { SessionSnapshot } from "./session.ts";

interface AutosaveGateDeps {
  /** The live terminal set to persist — computed fresh at each fire. */
  snapshot: () => SessionSnapshot;
  isRestorePending: () => boolean;
  orphanedParkedIds: () => string[];
  /** Persist a snapshot (clears the blob on an empty snapshot). */
  persist: (snapshot: SessionSnapshot) => void;
  persistFinal: (snapshot: SessionSnapshot) => void;
  persistActiveId: (id: string) => void;
}

/** The gate's answer at fire time — computed fresh each fire from the pushed
 *  freeze leases and the live restore-pending query. */
export type SaveDecision =
  | { kind: "persist" }
  | { kind: "frozen"; reason: string }
  | { kind: "suppressed-parked" };

const ACTIVE_ID_DEBOUNCE_MS = 5_000;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

let activeIdTimer: ReturnType<typeof setTimeout> | undefined;
let pendingActiveId: string | undefined;

const activeFreezes = new Map<symbol, string>();

/** An opaque freeze lease — {@link freezeAutosave} returns one,
 *  {@link unfreezeAutosave} releases it. Idempotent: releasing an
 *  already-released (or unknown) token is a no-op. */
export type AutosaveFreeze = symbol;

/** Cancel any pending (armed) autosave AND any pending active-id write,
 *  returning the gate to **idle** without firing either. */
export function cancelPendingAutosave(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  clearTimeout(activeIdTimer);
  activeIdTimer = undefined;
  pendingActiveId = undefined;
}

/** The padi `session` cell's write hook. A write that REPLACES the saved blob
 *  disarms whatever was armed against the old one; the marker patch below
 *  ({@link reportActiveTerminalId}) replaces nothing — it re-stamps
 *  `activeTerminalId` on the blob already on disk — so it leaves them armed. */
export function onSavedSessionWrite(
  previous: SavedSession | null,
  next: SavedSession | null,
): void {
  if (isActiveIdOnlyPatch(previous, next)) return;
  cancelPendingAutosave();
}

function isActiveIdOnlyPatch(
  previous: SavedSession | null,
  next: SavedSession | null,
): boolean {
  return (
    previous !== null &&
    next !== null &&
    next.savedAt === previous.savedAt &&
    next.activeTerminalId !== previous.activeTerminalId &&
    JSON.stringify(next.terminals) === JSON.stringify(previous.terminals)
  );
}

/** Enter **frozen(reason)** for a critical section — a restart's
 *  capture→drain→park, or a `session.restore` spawn window. While frozen the
 *  fire bails, so a `terminals:dirty` raised inside the section cannot arm a
 *  save that nulls the just-captured session. */
export function freezeAutosave(reason: string): AutosaveFreeze {
  const token: AutosaveFreeze = Symbol(reason);
  activeFreezes.set(token, reason);
  return token;
}

/** Release a freeze lease — the gate returns to **idle** / **armed** per the
 *  timer ONLY once EVERY lease is released. Idempotent; a token-LESS call thaws
 *  ALL leases (the test teardown's reset). */
export function unfreezeAutosave(token?: AutosaveFreeze): void {
  if (token === undefined) activeFreezes.clear();
  else activeFreezes.delete(token);
}

function decideSave(deps: AutosaveGateDeps): SaveDecision {
  if (activeFreezes.size > 0)
    return { kind: "frozen", reason: [...activeFreezes.values()].join("; ") };
  if (deps.isRestorePending()) {
    const orphaned = deps.orphanedParkedIds();
    if (orphaned.length > 0) {
      log.error(
        { orphanedParkedIds: orphaned },
        `session-trace autosave: suppressed-parked while ${orphaned.length} parked row${orphaned.length === 1 ? " is" : "s are"} absent from the saved session — nothing can consume them, so the autosave is pinned`,
      );
    }
    return { kind: "suppressed-parked" };
  }
  return { kind: "persist" };
}

let wiredDeps: AutosaveGateDeps | undefined;

/** Capture the live session at a SHUTDOWN EDGE — a SIGTERM the supervisor sent,
 *  a control-core drain — and persist it through the gate's own decision, so a
 *  stop does not get to answer "is it safe to persist now?" differently.
 *  Returns the decision so the caller can narrate it. Throws if the gate was
 *  never wired. */
export function captureFinalSession(why: string): SaveDecision {
  const deps = wiredDeps;
  if (deps === undefined) {
    throw new Error(
      `autosave gate is not wired — captureFinalSession(${why}) ran before initAutosaveGate`,
    );
  }
  cancelPendingAutosave();
  const snap = deps.snapshot();
  const decision = decideSave(deps);
  log.info(
    {
      why,
      decision: decision.kind,
      reason: decision.kind === "frozen" ? decision.reason : undefined,
      snapshot: snap.terminals.length,
    },
    `session-trace final capture (${why}): ${decision.kind} (snapshot=${snap.terminals.length})`,
  );
  if (decision.kind === "persist") deps.persistFinal(snap);
  return decision;
}

/** The CONTINUOUS FOCUS EDGE — the client reported which terminal is active.
 *  Trailing-debounced an order of magnitude slower than the trace throttle, and
 *  it writes ONLY the `activeTerminalId` field of the blob already on disk.
 *  Silently inert until the gate is wired. */
export function reportActiveTerminalId(id: string): void {
  if (id === pendingActiveId) return;
  pendingActiveId = id;
  clearTimeout(activeIdTimer);
  activeIdTimer = setTimeout(() => {
    activeIdTimer = undefined;
    const next = pendingActiveId;
    pendingActiveId = undefined;
    const deps = wiredDeps;
    if (next === undefined || deps === undefined) return;
    const decision = decideSave(deps);
    if (decision.kind !== "persist") {
      log.info(
        { decision: decision.kind, activeTerminalId: next },
        `session-trace active-id write: ${decision.kind}`,
      );
      return;
    }
    deps.persistActiveId(next);
  }, ACTIVE_ID_DEBOUNCE_MS);
  activeIdTimer.unref?.();
}

export function initAutosaveGate(gateDeps: AutosaveGateDeps): void {
  wiredDeps = gateDeps;
  void (async () => {
    try {
      for await (const _ of terminalsDirtyChannel.subscribe(undefined)) {
        if (saveTimer) continue;
        saveTimer = setTimeout(() => {
          saveTimer = undefined;
          const snap = gateDeps.snapshot();
          const decision = decideSave(gateDeps);
          log.info(
            {
              decision: decision.kind,
              reason: decision.kind === "frozen" ? decision.reason : undefined,
              snapshot: snap.terminals.length,
            },
            `session-trace autosave: ${decision.kind} (snapshot=${snap.terminals.length})`,
          );
          if (decision.kind === "persist") gateDeps.persist(snap);
        }, 500);
      }
    } catch (err) {
      log.error({ err }, "session auto-save subscription failed");
    }
  })();
}
