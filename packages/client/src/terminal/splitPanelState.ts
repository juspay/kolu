/** A split's SAVED state — is it collapsed, and where the divider sits.
 *
 * ONE SOURCE: the terminal's own record (`TerminalMetadata.subPanel`). This
 * module adds exactly one thing on top of it — the user's IN-FLIGHT change,
 * held until the record echoes it back — which is the same shape
 * `usePendingLayouts.ts` gives a tile's canvas geometry, for the same reason:
 * a gesture must show instantly, and the server is still the truth.
 *
 * It replaces a copy. The split's state used to live a second time in a
 * browser-side store that answered DEFAULTS until `hydrateFromTerminals`
 * copied the record into it, and a tile laid itself out from that copy. Two
 * consequences, both measured in CI (kolu#2362):
 *
 *  - every mount of a tile with a split laid the tile out as an EXPANDED,
 *    default-sized split for ~230 ms — one PTY resize on the way in and
 *    another on the way back — because `collapsed: false, panelSize: 0.3` is
 *    what the copy says before anyone has filled it in;
 *  - the Corvu size report that programmatic transition produced was
 *    persisted, so the first mount after a user collapsed a split WROTE
 *    `collapsed: false` over it and the collapse was gone for good.
 *
 * Reading the record directly makes the first unrepresentable: there is no
 * moment at which a tile holds a different answer than the record does,
 * because there is no second place for an answer to live. The second is
 * `TerminalContent`'s to prevent — only a gesture may call {@link
 * SplitPanelStore.state}'s writer — and this module makes that rule checkable
 * by being the only writer of `chrome.setSubPanel` in the client.
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

/** The one precedence: the user's in-flight change, else the record, else the
 *  default. Pure, so the rule is unit-testable without a host or a store. */
export function savedSplitOf(
  saved: SplitPanelState | undefined,
  pending: SplitPanelState | undefined,
): SplitPanelState {
  return pending ?? saved ?? DEFAULT_SPLIT_PANEL_STATE;
}

/** Persist a split's state on the server — the ONE `chrome.setSubPanel` call
 *  site in the client, so "who writes this" has a single answer to audit. */
function persistSplitPanel(id: TerminalId, state: SplitPanelState): void {
  runAction(
    "save split panel state",
    activePadiRpc.chrome.setSubPanel({ id, ...state }).pipe(
      Effect.catch((err) =>
        // A failed write means the optimistic state is NOT persisted and
        // reverts on the next read of the record. The health pip reports only
        // TRANSPORT health, so an application-level rejection on an otherwise-
        // live padi would go unseen. One STABLE id dedups a downed padi onto a
        // single toast rather than one per drag step.
        Effect.sync(() => {
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
  const [pending, setPending] = createStore<
    Record<TerminalId, SplitPanelState>
  >({});

  /** This terminal's record, as the active host's collection holds it.
   *  `subPanel` is an optional key on the record, and a PARKED row carries no
   *  chrome at all, so the `in` check is the narrowing rather than a cast. */
  const savedOf = (id: TerminalId): SplitPanelState | undefined => {
    const record = activeScope()?.wire.terminals?.byKey(id)?.();
    return record && "subPanel" in record ? record.subPanel : undefined;
  };

  // An in-flight change the record has caught up with is no longer in flight.
  // Dropping it is what keeps the record the source: a later change from
  // somewhere else (another viewer, an agent through MCP) must reach this tile,
  // and it cannot while an equal stand-in sits in front of it. Converges: the
  // only write here deletes keys, and a run with none returns before writing.
  createComputed(() => {
    const ids = Object.keys(pending);
    if (ids.length === 0) return;
    const settled = ids.filter((id) => {
      const entry = pending[id];
      const saved = savedOf(id);
      return !!entry && !!saved && sameSplitPanelState(saved, entry);
    });
    if (settled.length === 0) return;
    setPending(
      produce((draft: Record<string, SplitPanelState>) => {
        for (const id of settled) delete draft[id];
      }),
    );
  });

  return {
    state: (id) => savedSplitOf(savedOf(id), pending[id]),
    write: (id, next) => {
      setPending(id, next);
      persistSplitPanel(id, next);
    },
    forget: (id) => {
      setPending(produce((draft) => delete draft[id]));
    },
  };
});
