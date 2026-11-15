/** A split's SAVED state — is it collapsed, and where the divider sits.
 *
 * ONE SOURCE: the terminal's own record (`TerminalMetadata.subPanel`). This
 * module adds exactly one thing on top of it — the user's IN-FLIGHT change,
 * held until it has landed or failed — which is the same shape
 * `usePendingLayouts.ts` gives a tile's canvas geometry, for the same reason:
 * a gesture must show instantly, and the server is still the truth.
 *
 * It replaces a copy: a browser-side store that answered DEFAULTS until a
 * restore copied the record into it, which a tile then laid itself out from.
 * Reading the record directly makes that unrepresentable — there is no moment
 * at which a tile holds a different answer than the record does, because
 * there is no second place for an answer to live. The copy's other failure,
 * a MOUNT persisting the size its own programmatic transition produced, is
 * `TerminalContent`'s to prevent — only a gesture may call {@link
 * SplitPanelStore.write} — and this module makes that rule checkable by being
 * the only writer of `chrome.setSubPanel` in the client.
 *
 * **AN IN-FLIGHT ENTRY CANNOT OUTLIVE ITS WRITE**, and that is the whole of
 * what keeps "the record is the source" true rather than merely intended. An
 * entry that sat in front of the record until the record came to EQUAL it had
 * two ways to never leave: a write that FAILED (the tile would show a collapse
 * the server never saved, and the next reload would silently undo it), and a
 * write by SOMEONE ELSE on the same terminal — another browser, an agent
 * through MCP — whose value this tile could then never see, which is the very
 * case the record-is-the-source rule exists to allow. So an entry ends on
 * exactly three events, and {@link settleSplitPending} is the whole rule:
 *
 *  - the record came to equal it — it has landed;
 *  - our last outstanding write FAILED — there is nothing owed and nothing
 *    saved, so the record is the answer again;
 *  - the record MOVED to something else while we had nothing in flight —
 *    somebody else's value, and it wins.
 *
 * The in-flight COUNT is what keeps a drag smooth: a drag is many writes whose
 * echoes arrive behind the latest one, so while any write is outstanding an
 * older echo is not "the record moving on" and the divider does not jump back
 * to it. Once the last write resolves there are no echoes left behind it — a
 * reply travels the same socket after the record delta its write produced —
 * so the next thing the record says is either our value (landed) or theirs.
 *
 * HOST-SCOPING: the record is read off the ACTIVE host while the in-flight map
 * is host-independent (keyed by globally-unique TerminalId, like
 * `usePendingLayouts`). A host switch therefore reads `undefined` for an
 * entry's record and retires it as superseded — intended: by then the write
 * has been made, and the tile is not on screen to show anything.
 *
 * The record is read off the active host's `terminals` collection rather than
 * through `useTerminalMetadata`: the reprojection lives inside
 * `useTerminalStore`, which reads THIS module (the WebGL budget asks whether a
 * tile's split is collapsed), so taking the store as a dependency here would
 * close an import cycle. The collection is the same one the projection reads —
 * opened once per host and retained — so this is a second READ of one fact,
 * never a second copy of it.
 */

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
  /** Is the split shut? A collapsed tile's main pane owns the whole tile. */
  readonly collapsed: boolean;
  /** The sub pane's share of the tile, as a fraction. */
  readonly panelSize: number;
}

/** The answer for a tile whose record names no split state — a terminal that
 *  never had a split, and a brand-new one. Decided HERE, once: every reader
 *  goes through {@link savedSplitOf}, so "what does an unsaid split look like"
 *  cannot be answered differently in two places. */
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
  /** How many writes of ours have not answered yet. Non-zero means an older
   *  echo is still possible, so a record that disagrees is not somebody
   *  else's value — it is ours, arriving late. */
  readonly inFlight: number;
  /** What the record said when this entry was armed (and after each run of
   *  the settle rule). The rule compares against THIS, not against the
   *  entry's own value, so "the record moved" is a change rather than a
   *  mismatch — a record that has simply always disagreed is what an
   *  optimistic entry looks like, not a foreign write. */
  readonly sawRecord: SplitPanelState | undefined;
}

/** Has the record moved under this entry since it last looked? One rule, read
 *  by both consumers: the settle verdict below, and the re-stamp of
 *  `sawRecord` that keeps the watermark current. */
export function splitRecordMoved(
  pending: SplitPending,
  record: SplitPanelState | undefined,
): boolean {
  return record
    ? !pending.sawRecord || !sameSplitPanelState(record, pending.sawRecord)
    : !!pending.sawRecord;
}

/** Does this in-flight entry end here, and why — the whole rule, pure.
 *
 *  `"keep"` — still owed, nothing has moved. `"landed"` — the record is now
 *  our value. `"superseded"` — the record moved to somebody else's value with
 *  nothing of ours outstanding. (A FAILED write ends an entry too, but that is
 *  not a fact about the record, so it rides {@link SplitPanelStore.write}'s own
 *  completion rather than this reading.) */
export function settleSplitPending(
  pending: SplitPending,
  record: SplitPanelState | undefined,
): "keep" | "landed" | "superseded" {
  if (record && sameSplitPanelState(record, pending.value)) return "landed";
  if (pending.inFlight > 0) return "keep";
  return splitRecordMoved(pending, record) ? "superseded" : "keep";
}

/** The one precedence: the user's in-flight change, else the record, else the
 *  default. Pure, so the rule is unit-testable without a host or a store. */
export function savedSplitOf(
  saved: SplitPanelState | undefined,
  pending: SplitPanelState | undefined,
): SplitPanelState {
  return pending ?? saved ?? DEFAULT_SPLIT_PANEL_STATE;
}

/** Persist a split's state on the server — the ONE `chrome.setSubPanel` call
 *  site in the client, so "who writes this" has a single answer to audit.
 *  `onSettled` runs exactly once per call, with whether the server took it. */
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
        // The optimistic entry ENDS here: nothing was saved, so the record is
        // the answer again and the tile goes back to showing it rather than a
        // collapse (or a divider) that exists only in this browser. The health
        // pip reports only TRANSPORT health, so an application-level rejection
        // on an otherwise-live padi would go unseen — hence the toast. One
        // STABLE id dedups a downed padi onto a single toast rather than one
        // per drag step.
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
  /** State a NEW saved split — a user's gesture, and nothing else. Shows at
   *  once (the in-flight entry) and is persisted in the same breath. */
  readonly write: (id: TerminalId, next: SplitPanelState) => void;
  /** Drop a departed tile's in-flight entry. */
  readonly forget: (id: TerminalId) => void;
}

export const useSplitPanelState = createSharedRoot((): SplitPanelStore => {
  const [pending, setPending] = createStore<Record<TerminalId, SplitPending>>(
    {},
  );

  /** This terminal's record, as the active host's collection holds it.
   *  `subPanel` is an optional key on the record, and a PARKED row carries no
   *  chrome at all, so the `in` check is the narrowing rather than a cast. */
  const savedOf = (id: TerminalId): SplitPanelState | undefined => {
    const record = activeScope()?.wire.terminals?.byKey(id)?.();
    return record && "subPanel" in record ? record.subPanel : undefined;
  };

  // The settle rule, run against every live entry whenever a record one of
  // them watches moves. Converges: each run either drops keys or re-stamps
  // `sawRecord` with the value it just read, and a run where nothing moved
  // and nothing settled returns before writing.
  createComputed(() => {
    const readings = Object.entries(pending).flatMap(([id, entry]) =>
      entry ? [{ id, entry, record: savedOf(id) }] : [],
    );
    if (readings.length === 0) return;
    const acts = readings.map((r) => ({
      id: r.id,
      record: r.record,
      verdict: settleSplitPending(r.entry, r.record),
      moved: splitRecordMoved(r.entry, r.record),
    }));
    if (acts.every((a) => a.verdict === "keep" && !a.moved)) return;
    setPending(
      produce((draft: Record<string, SplitPending>) => {
        for (const { id, record, verdict } of acts) {
          if (verdict !== "keep") {
            delete draft[id];
            continue;
          }
          const entry = draft[id];
          if (entry) draft[id] = { ...entry, sawRecord: record };
        }
      }),
    );
  });

  /** One of our writes answered: it is no longer outstanding, and a failure
   *  with nothing left outstanding ends the entry outright. Guarded on the
   *  entry still being there — a tile can depart mid-write. */
  const settleWrite = (id: TerminalId, ok: boolean): void => {
    setPending(
      produce((draft: Record<string, SplitPending>) => {
        const entry = draft[id];
        if (!entry) return;
        const inFlight = Math.max(0, entry.inFlight - 1);
        if (!ok && inFlight === 0) {
          delete draft[id];
          return;
        }
        draft[id] = { ...entry, inFlight };
      }),
    );
  };

  const state = (id: TerminalId): SplitPanelState =>
    savedSplitOf(savedOf(id), pending[id]?.value);

  return {
    state,
    write: (id, next) => {
      // A REPORT OF THE VALUE ALREADY SHOWN IS NOT A CHANGE, and saying so
      // here is what keeps a drag from eating itself. Corvu re-emits the
      // controlled `sizes` it was just handed, so a drag's own echo comes back
      // through `onSizesChange` while the gesture is still in progress. Writing
      // that echo would touch this store (a fresh entry, one more owed write),
      // which moves the controlled value, which re-emits — a cycle with no
      // fixpoint, because an entry is a new object every time even when its
      // value is not. The copy this module replaced was immune by accident:
      // it wrote one NUMBER into a store, and solid-js drops a property write
      // that equals what is there.
      if (sameSplitPanelState(state(id), next)) return;
      setPending(id, (prev: SplitPending | undefined) => ({
        value: next,
        inFlight: (prev?.inFlight ?? 0) + 1,
        // Stamped from the record as it stands NOW, so this entry's "the
        // record moved" is measured from the gesture, not from nothing.
        sawRecord: prev?.sawRecord ?? savedOf(id),
      }));
      persistSplitPanel(id, next, (ok) => settleWrite(id, ok));
    },
    forget: (id) => {
      setPending(produce((draft) => delete draft[id]));
    },
  };
});
