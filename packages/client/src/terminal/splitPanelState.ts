import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createComputed } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { activeScope } from "../hostScope/hostScopes";
import { runAction } from "../runAction";
import { activePadiRpc } from "../wire";

/** What a tile's record says about its split. */
export interface SplitPanelState {
  readonly collapsed: boolean;
  readonly panelSize: number;
}

/** The answer for a tile whose record names no split state. */
export const DEFAULT_SPLIT_PANEL_STATE: SplitPanelState = Object.freeze({
  collapsed: false,
  panelSize: 0.3,
});

export const sameSplitPanelState = (
  a: SplitPanelState,
  b: SplitPanelState,
): boolean => a.collapsed === b.collapsed && a.panelSize === b.panelSize;

/** The user's in-flight change to one tile's split, and how much of it is
 *  still owed to the server. */
export interface SplitPending {
  /** What the user asked for — what the tile shows until this entry ends. */
  readonly value: SplitPanelState;
  /** How many writes of ours have not answered yet. */
  readonly inFlight: number;
  /** What the record said when this entry was armed, and after each run of
   *  the settle rule. */
  readonly sawRecord: SplitPanelState | undefined;
}

/** One event in an entry's life: the record moved under it, or one of our
 *  writes answered. */
export type SplitPendingEvent =
  | { readonly kind: "record"; readonly record: SplitPanelState | undefined }
  | { readonly kind: "write"; readonly ok: boolean };

/** The entry's whole lifetime, in one step. `undefined` is the entry ENDING —
 *  it landed (the record is now our value), somebody else's value superseded it
 *  with nothing of ours outstanding, or its last write failed. The SAME entry
 *  back means nothing moved. */
export function advanceSplitPending(
  entry: SplitPending,
  event: SplitPendingEvent,
): SplitPending | undefined {
  if (event.kind === "write") {
    const inFlight = Math.max(0, entry.inFlight - 1);
    if (!event.ok && inFlight === 0) return undefined;
    return { ...entry, inFlight };
  }
  const { record } = event;
  if (record && sameSplitPanelState(record, entry.value)) return undefined;
  const moved = record
    ? !entry.sawRecord || !sameSplitPanelState(record, entry.sawRecord)
    : entry.sawRecord !== undefined;
  if (!moved) return entry;
  return entry.inFlight > 0 ? { ...entry, sawRecord: record } : undefined;
}

/** The one precedence: the user's in-flight change, else the record, else the
 *  default. */
export function savedSplitOf(
  saved: SplitPanelState | undefined,
  pending: SplitPanelState | undefined,
): SplitPanelState {
  return pending ?? saved ?? DEFAULT_SPLIT_PANEL_STATE;
}

/** Persist a split's state on the server — the ONE `chrome.setSubPanel` call
 *  site in the client. `onSettled` runs exactly once, with the server's verdict. */
function persistSplitPanel(
  id: TerminalId,
  state: SplitPanelState,
  onSettled: (ok: boolean) => void,
): void {
  runAction(
    "save split panel state",
    activePadiRpc.chrome.setSubPanel({ id, ...state }).pipe(
      Effect.tap(() => Effect.sync(() => onSettled(true))),
      Effect.catch((err) =>
        Effect.sync(() => {
          onSettled(false);
          toast.error(
            `Failed to save split panel state: ${toError(err).message}`,
            { id: "sub-panel-report-failed" },
          );
        }),
      ),
    ),
  );
}

export interface SplitPanelStore {
  /** A tile's saved split state: in-flight change ⊕ record ⊕ default. */
  readonly state: (id: TerminalId) => SplitPanelState;
  /** State a NEW saved split — a user's gesture, and nothing else. */
  readonly write: (id: TerminalId, next: SplitPanelState) => void;
  /** Drop a departed tile's in-flight entry. */
  readonly forget: (id: TerminalId) => void;
}

export const useSplitPanelState = createSharedRoot((): SplitPanelStore => {
  const [pending, setPending] = createStore<Record<TerminalId, SplitPending>>(
    {},
  );

  /** This terminal's record, as the active host's collection holds it. */
  const savedOf = (id: TerminalId): SplitPanelState | undefined => {
    const record = activeScope()?.wire.terminals?.byKey(id)?.();
    return record && "subPanel" in record ? record.subPanel : undefined;
  };

  createComputed(() => {
    const steps = Object.entries(pending).flatMap(([id, entry]) =>
      entry
        ? [
            {
              id,
              entry,
              next: advanceSplitPending(entry, {
                kind: "record",
                record: savedOf(id),
              }),
            },
          ]
        : [],
    );
    if (steps.every((s) => s.next === s.entry)) return;
    setPending(
      produce((draft: Record<string, SplitPending>) => {
        for (const { id, entry, next } of steps) {
          if (next === entry) continue;
          if (next === undefined) delete draft[id];
          else draft[id] = next;
        }
      }),
    );
  });

  /** One of our writes answered. */
  const settleWrite = (id: TerminalId, ok: boolean): void => {
    setPending(
      produce((draft: Record<string, SplitPending>) => {
        const entry = draft[id];
        if (!entry) return;
        const next = advanceSplitPending(entry, { kind: "write", ok });
        if (next === undefined) delete draft[id];
        else draft[id] = next;
      }),
    );
  };

  const state = (id: TerminalId): SplitPanelState =>
    savedSplitOf(savedOf(id), pending[id]?.value);

  return {
    state,
    write: (id, next) => {
      // Corvu re-emits the controlled `sizes` it was just handed, so a drag's
      // own echo arrives here mid-gesture; writing it would arm a fresh entry,
      // move the controlled value and re-emit — a cycle with no fixpoint.
      if (sameSplitPanelState(state(id), next)) return;
      setPending(id, (prev: SplitPending | undefined) => ({
        value: next,
        inFlight: (prev?.inFlight ?? 0) + 1,
        sawRecord: prev?.sawRecord ?? savedOf(id),
      }));
      persistSplitPanel(id, next, (ok) => settleWrite(id, ok));
    },
    forget: (id) => {
      setPending(produce((draft) => delete draft[id]));
    },
  };
});
