/** THE EVICTION RECONCILE OVER THE REAL SUB-PANEL. The other reconcile suite
 *  drives `planEviction` through spy ports, and a spy is exactly what hides
 *  this: the tab-strip repair's write IS the subject here. `setActiveSubTab`
 *  and the focus override are written from the reconcile's APPLY ARM, whose
 *  compute has just read the terminal census — so a reader that folds that
 *  same census (a pane's "am I the shown split?", the right panel's subject)
 *  re-ran inside the effect's frame against the list the arm was answering.
 *  Solid grades that `EFFECT_RELAY_TEAR`; this file fails on it at the FIRST
 *  sighting rather than waiting for the threshold to escalate it. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Effect } from "effect";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { expect, it, vi } from "vitest";
import type { HostViewState } from "../hostScope/createViewState";

/** The host scope the real `useSubPanel` reads through: this file's own view
 *  state, built from `createViewState` in the test's root. */
const h = vi.hoisted(() => ({
  view: undefined as HostViewState | undefined,
}));

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () =>
    h.view === undefined
      ? undefined
      : {
          view: h.view,
          // No terminal records here: every tile's saved split reads its one
          // default. The keys stream is still present, as every host wire has
          // one — the split settle rule subscribes to it.
          wire: { terminals: undefined, terminalKeys: () => [] },
        },
}));

vi.mock("../wire", () => ({
  padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
  activePadiRpc: { chrome: { setSubPanel: () => Effect.void } },
}));

vi.mock("solid-sonner", () => ({ toast: { error: vi.fn() } }));

import { createViewState } from "../hostScope/createViewState";
import {
  createEvictionDedup,
  planEviction,
  useActiveReconcile,
} from "./useActiveReconcile";
import { useSubPanel } from "./useSubPanel";

const T = (s: string) => s as TerminalId;
const P = T("p0000000-0000-4000-8000-000000000001");
const S1 = T("s1000000-0000-4000-8000-000000000002");
const S2 = T("s2000000-0000-4000-8000-000000000003");

it("repairs a departed split's tab strip with no reader left torn", () => {
  localStorage.clear();
  const parents: Record<string, TerminalId | null> = {
    [P]: null,
    [S1]: P,
    [S2]: P,
  };
  const [ids, setIds] = createSignal<TerminalId[]>([P, S1, S2]);
  const subPanel = useSubPanel();
  const shown: (TerminalId | null)[] = [];
  const subjects: (TerminalId | null)[] = [];
  const dispose = createRoot((dispose) => {
    const view = createViewState(
      LOCAL_HOST,
      (id) =>
        parents[id] === undefined
          ? { kind: "missing" }
          : parents[id] === null
            ? { kind: "top-level" }
            : { kind: "split", parentId: parents[id] as TerminalId },
      () => null,
      () => ids().filter((id) => parents[id] === null),
      ids,
      () => true,
    );
    h.view = view;
    // (the seed lands outside this owner: a write inside it is
    // `REACTIVE_WRITE_IN_OWNED_SCOPE`)
    // THE VICTIM, as the tile renders it: which split is on screen is the
    // census (is this pane still a pane of the tile?) AND the tab strip's
    // choice — the pair `TerminalContent`'s `subVisible` folds and the xterm
    // refit reads.
    createEffect(
      () => {
        const live = ids();
        const active = subPanel.paneChrome(P).activeSubTab;
        return active !== null && live.includes(active) ? active : null;
      },
      (visible) => {
        shown.push(visible);
      },
      { name: "subVisible" },
    );
    // THE SECOND VICTIM: the right panel's subject, which folds the same
    // census with the focus override the repair's successor verb writes.
    createEffect(
      () => {
        const live = ids();
        const focused = h.view?.focusedTerminalId() ?? null;
        return focused !== null && live.includes(focused) ? focused : null;
      },
      (subject) => {
        subjects.push(subject);
      },
      { name: "rightPanelSubject" },
    );
    const eviction = createEvictionDedup(
      (id, parentId, topLevelBefore, departing, removal) =>
        planEviction(
          {
            activeId: view.activeId,
            focusedTerminalId: view.focusedTerminalId,
            takeAutoSwitch: view.takeAutoSwitch,
            noteAutoSwitch: view.noteAutoSwitch,
            planActivate: (next) => () => {
              view.writeFocus(
                next === null ? null : { id: next, tileHint: next },
              );
            },
            planPromoteToTopLevel: () => () => {},
            rehomeUnder: () => {},
            // THE REAL WRITERS: the panel's own verbs, not spies.
            subPanel,
            removeRightPanel: () => {},
            removeSearch: () => {},
          },
          id,
          parentId,
          topLevelBefore,
          departing,
          removal,
        ),
    );
    useActiveReconcile({
      rawList: ids,
      parentOf: (id) => parents[id] ?? null,
      activeHostKey: () => "local",
      planEvictDeparted: eviction.planEvictDeparted,
      listIsAuthoritative: () => true,
    });
    return dispose;
  });
  // The user is on the first split, which is the tile's shown tab — a gesture,
  // so it is written from out here where one happens.
  h.view?.writeFocus({ id: S1, tileHint: P });
  subPanel.setActiveSubTab(P, S1);
  flush();
  expect(subPanel.paneChrome(P).activeSubTab).toBe(S1);

  // The shown split's PTY exits: the list drops it, and the repair must hand
  // the strip to the surviving pane.
  delete parents[S1];
  setIds([P, S2]);
  flush();

  expect(subPanel.paneChrome(P).activeSubTab).toBe(S2);
  expect(shown.at(-1)).toBe(S2);
  // The departed pane was the focused one, so the successor carries the focus
  // fact too — and the panel's subject follows it.
  expect(subjects.at(-1)).toBe(S2);
  // RED AT THE FIRST SIGHTING: an advisory relay tear is a finding here.
  expect(takeSolidDiagnostics()).toEqual([]);
  h.view = undefined;
  subPanel.removePanel(P);
  dispose();
});
