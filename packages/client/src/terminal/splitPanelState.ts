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
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { activeScope } from "../hostScope/hostScopes";
import { runAction } from "../runAction";
import { activePadiRpc } from "../wire";
import { foldEach } from "../wideFold";

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

/** The watermark {@link SplitPending.sawRecord} holds — the record's leaves
 *  COPIED out, never the record's own object. The collection MERGES a frame
 *  into the record standing at a key, so what `savedOf` hands back is the LIVE
 *  value: held as-is, "the record moved" would compare the record against
 *  itself and a foreign write could never be seen. */
function stampRecord(
  saved: SplitPanelState | undefined,
): SplitPanelState | undefined {
  return saved && { collapsed: saved.collapsed, panelSize: saved.panelSize };
}

/** One tile's saved split, COPIED out of its record — a row of the fold the
 *  settle rule subscribes through. `saved` is absent for a record that names
 *  no split, and for a departed terminal. */
interface SavedSplitRow {
  readonly id: TerminalId;
  readonly saved: SplitPanelState | undefined;
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
  /** Reader half of {@link write}, for a caller inside a Solid effect — where
   *  a reactive read is a strict-read warning. It does the two reads the write
   *  needs (the value already shown, the record this entry is measured from)
   *  and hands back the writes; `useSubPanel`'s own `plan…` verbs are built on
   *  it. A write of the value already shown plans NOTHING. */
  readonly planWrite: (id: TerminalId, next: SplitPanelState) => () => void;
  /** Drop a departed tile's in-flight entry. */
  readonly forget: (id: TerminalId) => void;
}

export const useSplitPanelState = createSharedRoot((): SplitPanelStore => {
  /** This terminal's record, as the active host's collection holds it.
   *  `subPanel` is an optional key on the record, and a PARKED row carries no
   *  chrome at all, so the `in` check is the narrowing rather than a cast. */
  const savedOf = (id: TerminalId): SplitPanelState | undefined => {
    const record = activeScope()?.wire.terminals?.byKey(id)?.();
    return record && "subPanel" in record ? record.subPanel : undefined;
  };

  /** EVERY LIVE RECORD'S COMPARED LEAVES, ONE ROW PER TILE. The settle rule
   *  below is a writable derivation, and a writable derivation does not
   *  re-derive on its own writes: its dependencies are the ones its last run
   *  read. An entry armed by a gesture after that run would therefore watch
   *  nothing — its own record included — and never settle. So the rule must
   *  subscribe to every live record's two leaves.
   *
   *  Doing that on the RULE's own scope costs an index leaf, the per-key
   *  lookup, the record and its three nested leaves per tile — seven sources,
   *  which Solid's development build judges `WIDE_SCOPE_DEPS` past 200, about
   *  28 tiles. One row memo per tile holds those seven; the rule reads the
   *  joined list, and looks each entry's record up in it.
   *
   *  The leaves, not the record object: the `terminals` collection is served
   *  per key and merged leaf by leaf, so a `subPanel` written elsewhere (a
   *  second browser, an agent over MCP) keeps the record's identity and
   *  notifies `subPanel.collapsed`/`.panelSize` alone. A row COPIES exactly
   *  what {@link settleSplitPending} compares, so "a record moved" wakes the
   *  rule whatever the entries were when it last looked — and the copy is the
   *  watermark {@link SplitPending.sawRecord} wants anyway. */
  const savedRows = foldEach(
    "splitPanel.saved",
    () => activeScope()?.wire.terminalKeys() ?? [],
    (id): SavedSplitRow => ({ id, saved: stampRecord(savedOf(id)) }),
    (a, b) =>
      a.id === b.id &&
      a.saved?.collapsed === b.saved?.collapsed &&
      a.saved?.panelSize === b.saved?.panelSize,
  );

  /** The live entries, and the settle rule that ends them — one writable
   *  derivation rather than a rule that writes the state it reads. A gesture
   *  (`write`), a write answering (`settleWrite`) and a departure (`forget`)
   *  SET it; a record moving RE-DERIVES it from what was last set, dropping
   *  the entries that landed or were superseded and re-stamping `sawRecord`
   *  on the ones that stay. A run where nothing moved and nothing settled
   *  returns the very map it was given, so it notifies nobody. */
  const [pending, setPending] = createSignal<Record<TerminalId, SplitPending>>(
    (prev: Record<TerminalId, SplitPending> = {}) => {
      // The one read, and the subscription for the whole rule: a record this
      // census does not hold is a departed terminal, which is what `savedOf`
      // answered for it too.
      const live = new Map(savedRows().map((row) => [row.id, row.saved]));
      const readings = Object.entries(prev).flatMap(([id, entry]) =>
        entry
          ? [
              {
                id: id as TerminalId,
                entry,
                record: live.get(id as TerminalId),
              },
            ]
          : [],
      );
      if (readings.length === 0) return prev;
      const acts = readings.map((r) => ({
        id: r.id,
        entry: r.entry,
        record: r.record,
        verdict: settleSplitPending(r.entry, r.record),
        moved: splitRecordMoved(r.entry, r.record),
      }));
      if (acts.every((a) => a.verdict === "keep" && !a.moved)) return prev;
      const next: Record<TerminalId, SplitPending> = {};
      for (const { id, entry, record, verdict } of acts) {
        if (verdict !== "keep") continue;
        next[id] = { ...entry, sawRecord: stampRecord(record) };
      }
      return next;
    },
  );

  /** One of our writes answered: it is no longer outstanding, and a failure
   *  with nothing left outstanding ends the entry outright. Guarded on the
   *  entry still being there — a tile can depart mid-write.
   *
   *  `prev` defaults like the derivation's own parameter: a setter that runs
   *  before the rule has ever derived (nothing has read `pending()` yet) is
   *  handed `undefined`, and "the rule has produced nothing yet" IS the empty
   *  map — entries only ever come from a write. */
  const settleWrite = (id: TerminalId, ok: boolean): void => {
    setPending((prev: Record<TerminalId, SplitPending> = {}) => {
      const entry = prev[id];
      if (!entry) return prev;
      const inFlight = Math.max(0, entry.inFlight - 1);
      const next = { ...prev };
      if (!ok && inFlight === 0) delete next[id];
      else next[id] = { ...entry, inFlight };
      return next;
    });
  };

  const state = (id: TerminalId): SplitPanelState =>
    savedSplitOf(savedOf(id), pending()[id]?.value);

  /** The reads a write needs, done once, with the writes handed back. The two
   *  phases exist because the effect that drives a collapse (an eviction, a
   *  dock re-home) may not read: a Solid 2 effect callback is a strict-read
   *  window. Hoisting both reads out of the write changes no answer — a staged
   *  write is not visible to a read on the same synchronous run anyway. */
  const planWrite = (id: TerminalId, next: SplitPanelState): (() => void) => {
    // A REPORT OF THE VALUE ALREADY SHOWN IS NOT A CHANGE, and saying so
    // here is what keeps a drag from eating itself. Corvu re-emits the
    // controlled `sizes` it was just handed, so a drag's own echo comes back
    // through `onSizesChange` while the gesture is still in progress. Writing
    // that echo would touch this state (a fresh entry, one more owed write),
    // which moves the controlled value, which re-emits — a cycle with no
    // fixpoint, because an entry is a new object every time even when its
    // value is not. The copy this module replaced was immune by accident:
    // it wrote one NUMBER into a store, and solid-js drops a property write
    // that equals what is there.
    if (sameSplitPanelState(state(id), next)) return () => {};
    // Stamped from the record as it stands NOW, so this entry's "the record
    // moved" is measured from the gesture, not from nothing.
    const sawRecordNow = stampRecord(savedOf(id));
    return () => {
      setPending((prev: Record<TerminalId, SplitPending> = {}) => {
        const was = prev[id];
        return {
          ...prev,
          [id]: {
            value: next,
            inFlight: (was?.inFlight ?? 0) + 1,
            sawRecord: was?.sawRecord ?? sawRecordNow,
          },
        };
      });
      persistSplitPanel(id, next, (ok) => settleWrite(id, ok));
    };
  };

  return {
    state,
    write: (id, next) => {
      planWrite(id, next)();
    },
    planWrite,
    forget: (id) => {
      setPending((prev: Record<TerminalId, SplitPending> = {}) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
  };
});
