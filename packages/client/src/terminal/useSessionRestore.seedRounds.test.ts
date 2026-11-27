// @vitest-environment happy-dom

/** THREE RESTORE ROUNDS, OVER THE REAL VIEW STATE AND THE REAL SUB-PANEL.
 *
 *  The hydration effect's apply arm performs the view seed, and that seed
 *  WRITES: `setActiveSubTab` edits the tile's pane chrome (`state.<tile>`) and
 *  the landing writes the per-host focus fact (`createViewState.override`, a
 *  writable memo over this host's census). The arm's own compute has just read
 *  that census — so every reader folding the same census (the WebGL tile
 *  budget, the chrome bar's panel-open condition) re-runs inside the effect's
 *  frame against the list the compute was answering. Solid grades that
 *  `EFFECT_RELAY_TEAR`: advisory at the first sighting, `warn` at the third
 *  against the same (effect, write name).
 *
 *  WHY THE OTHER HYDRATION SUITE CANNOT SEE IT. `useSessionRestore.wideDeps`
 *  mocks `useSubPanel` away (`setActiveSubTab: () => {}`), so `editChrome`
 *  never runs, and takes its scope from a hand-written view stub with a
 *  plain-signal `activeId` and no `writeFocus` at all — so `override` does not
 *  exist there. Here the view state is the REAL `createViewState` over the REAL
 *  `createHostWire` (`hostWireMirror`'s streams and per-key collection), the
 *  store is the real `useTerminalStore`, and the sub-panel is the real module.
 *
 *  THREE ROUNDS, because the escalation needs three: an in-session restore
 *  re-spawns the host's panes under fresh ids (`reseedForRestore` re-arms the
 *  latch), so each round is a whole seed. After every round the case holds the
 *  entire drain — `info` included — AND the published answer: the tile the
 *  restore named is the active one, and each tile's tab strip shows its split. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createMemo, createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

// `useCollection` opens each key's stream through this; the mirror's procedure
// IS the stream, so calling it is the whole wire.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({
  entry: (() => undefined) as () => unknown,
  scope: undefined as unknown,
}));

vi.mock("../wire", () => ({
  padiMap: { entry: () => held.entry() },
  activeHost: () => ({ kind: "local" }),
  encActiveHost: () => "local",
  hostKeys: () => [{ kind: "local" }],
  interpretClientError: () => {},
  // The host's active-terminal report, which a landing forks through
  // `runAction` — answered, never asserted on here.
  padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
  activePadiRpc: { chrome: { setSubPanel: () => Effect.void } },
}));
vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => held.scope,
  hostScopeOf: () => held.scope,
}));
vi.mock("../rpc/rpc", () => ({ lifecycle: () => ({ kind: "connected" }) }));
// The right panel's in-memory navigation history is not a view fact this case
// reads; the seed's call into it is already settled on its own.
vi.mock("../right-panel/useRightPanel", () => ({
  useRightPanel: () => ({ seedHistory: () => {} }),
}));
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));

import { Effect } from "effect";
import { createBootPick } from "../hostScope/createBootPick";
import { createHostWire } from "../hostScope/createHostWire";
import { createSessionRestore } from "../hostScope/createSessionRestore";
import { createViewState } from "../hostScope/createViewState";
import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { useSessionRestore } from "./useSessionRestore";
import { useSubPanel } from "./useSubPanel";
import { useTerminalStore } from "./useTerminalStore";

/** One round's census: two tiles, each with one split. The restore names the
 *  SECOND tile, so landing on it is a reading of the answer and not of the
 *  order. */
const tileAt = (round: number, at: number) => `r${round}t${at}` as TerminalId;
const splitAt = (round: number, at: number) => `r${round}t${at}s` as TerminalId;
const idsFor = (round: number): TerminalId[] => [
  tileAt(round, 0),
  splitAt(round, 0),
  tileAt(round, 1),
  splitAt(round, 1),
];
const parentOf = (id: TerminalId, round: number): TerminalId | null =>
  id === splitAt(round, 0)
    ? tileAt(round, 0)
    : id === splitAt(round, 1)
      ? tileAt(round, 1)
      : null;

const recordFor = (id: TerminalId, round: number, at: number): PadiTerminal =>
  ({
    state: "active",
    cwd: `/w/r${round}`,
    git: { kind: "none" },
    parentId: parentOf(id, round),
    agent: null,
    foreground: null,
    rightPanel: null,
    ports: { status: "unknown" },
    lastActivityAt: at,
    promptedAt: null,
  }) as unknown as PadiTerminal;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  held.scope = undefined;
});

it("seeds three restores with no reader left torn", async () => {
  localStorage.clear();
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  /** What the victim memo answered, one entry per run. */
  const panelOpen: boolean[] = [];
  const built = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    // THE HOST'S OWNED WORLD, composed exactly as `hostScopes` composes it:
    // the retained wire, the restore latch, then the view state over this
    // host's own census — so `override` is the writable memo production
    // writes, not a plain signal.
    const wire = createHostWire(LOCAL_HOST);
    const restore = createSessionRestore();
    const view = createViewState(
      LOCAL_HOST,
      wire.placementOf,
      createBootPick(wire, restore.restoreInFlight),
      wire.tileIds,
      wire.terminalKeys,
      wire.listIsCensus,
    );
    held.scope = { view, wire, restore };
    const store = useTerminalStore();
    const subPanel = useSubPanel();
    // THE VICTIM, as the chrome bar folds it: the inspector toggle is shown
    // when this host holds tiles (the census) and the active tile's split is
    // not shut (the focus override). Both legs, one memo —
    // `right-panel/useRightPanel`'s `panelOpen` narrowed to its two reads.
    createMemo(
      () => {
        const open =
          store.terminalIds().length > 0 &&
          !subPanel.savedSplit(store.activeId() ?? tileAt(1, 0)).collapsed;
        panelOpen.push(open);
        return open;
      },
      { name: "restoreRounds.panelOpen" },
    );
    useSessionRestore({ store });
    return { restore, view, store, subPanel };
  });

  /** One in-session restore: the latch re-arms, the host answers which tile is
   *  active, and the re-spawned panes arrive under their own fresh ids. */
  const round = async (at: number): Promise<void> => {
    built.restore.reseedForRestore();
    built.restore.beginRestore();
    built.restore.reportRestoredActive(tileAt(at, 1));
    const ids = idsFor(at);
    mirror.pushKeys(ids);
    for (const [n, id] of ids.entries())
      mirror.pushRecord(id, recordFor(id, at, n));
    mirror.pushRoster({ kind: "established", at, ids: [...ids] });
    mirror.pushSession({ activeTerminalId: tileAt(at, 1) });
    await settle();
    flush();
  };

  for (const at of [1, 2, 3]) {
    await round(at);

    // THE SEED'S PUBLISHED ANSWER: the host's answered tile holds the
    // selection, and every tile's strip shows the split hydration seeded.
    expect(built.restore.phase).toBe("seeded");
    expect(built.view.activeId()).toBe(tileAt(at, 1));
    expect(built.view.focusedTerminalId()).toBe(tileAt(at, 1));
    expect(built.subPanel.paneChrome(tileAt(at, 0)).activeSubTab).toBe(
      splitAt(at, 0),
    );
    expect(built.subPanel.paneChrome(tileAt(at, 1)).activeSubTab).toBe(
      splitAt(at, 1),
    );
    // The victim answered, and its last answer is the settled one.
    expect(panelOpen.at(-1)).toBe(true);
    // RED AT THE FIRST SIGHTING: an advisory relay tear is a finding here.
    expect(diagnostics()).toEqual([]);
  }
});
