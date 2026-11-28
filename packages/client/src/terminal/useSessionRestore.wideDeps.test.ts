// @vitest-environment happy-dom

/** HYDRATION AT A FLEET'S SIZE — 50 tiles, four panes each, 250 terminals on
 *  one host.
 *
 *  The hydration effect waits for EVERY listed terminal's composed record
 *  before it seeds the view, and a record read costs two store nodes before
 *  any field. Walking the list on the effect's own compute therefore put two
 *  sources per pane on it — Solid's development build judges a scope at 200
 *  — so a session of about a hundred panes was judged on every delta that
 *  re-ran it, which on a cold boot is every delta of the restore.
 *
 *  THE RECORDS ARE THE REAL STORE. The keys arrive on the real
 *  `createReactiveSubscription` stream and each record through the real
 *  per-key `useCollection` view (`hostScope/hostWireMirror.testlib.ts`),
 *  reached as production reaches them: `createHostWire` over that mirror
 *  (`hostScope/fleetScope.testlib.ts`), read through `terminalListSub` and
 *  `getMetadata` — the two seams the fold is over. The saved-session cell is
 *  the host's own, pushed through the same mirror.
 *
 *  THE VIEW AND THE PANE CHROME ARE REAL TOO. The scope carries the real
 *  `createViewState` over that wire — so the focus fact is the writable memo
 *  `override` under a derivation, and `seedCovers` is the derivation's own
 *  cover test — and the seed drives the real `useSubPanel`, so its tab writes
 *  land in the pane-chrome store through `editChrome`. Stubbing either (a
 *  plain-signal `view`, a `setActiveSubTab: () => {}`) is what made this case
 *  structurally unable to see the writes the seed makes (review 59 §2).
 *
 *  What the case holds: the whole drain, `info` included, and the hydration's
 *  published answer — the latch seeded, and the tile the blob named landed
 *  on. Then a realistic change (the landing tile's record moves) and both
 *  again, because a narrower graph that stops answering is no fix. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, flush } from "solid-js";
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
  activePadiRpc: { chrome: { setSubPanel: async () => {} } },
}));
vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => held.scope,
  hostScopeOf: () => held.scope,
}));
vi.mock("../rpc/rpc", () => ({ lifecycle: () => ({ kind: "connected" }) }));
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

import { terminalListSub } from "../hostScope/activeWire";
import type { HostRestoreLatch } from "../hostScope/createSessionRestore";
import type { HostViewState } from "../hostScope/createViewState";
import { fleetScope } from "../hostScope/fleetScope.testlib";
import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { useSessionRestore } from "./useSessionRestore";
import { useSubPanel } from "./useSubPanel";
import { useTerminalMetadata } from "./useTerminalMetadata";
import type { TerminalStore } from "./useTerminalStore";

/** THE SESSION: 50 tiles, each with three splits — 250 panes, well past the
 *  hundred at which the walk was judged. */
const TILES = 50;
const tileAt = (at: number) => `t${at}` as TerminalId;
const paneAt = (at: number, pane: number) => `t${at}p${pane}` as TerminalId;
const parentOfPane = (at: number, pane: number): TerminalId =>
  pane === 1 ? paneAt(at, 0) : pane === 3 ? paneAt(at, 2) : tileAt(at);

const ids: TerminalId[] = [];
for (let at = 0; at < TILES; at++) {
  ids.push(tileAt(at));
  for (let pane = 0; pane < 4; pane++) ids.push(paneAt(at, pane));
}

/** The tile the saved session says was active — not the first, so landing on
 *  it is a reading of the blob and not of the order. */
const SAVED = tileAt(17);
/** The tab hydration seeds that tile's strip with: its first pane, in census
 *  order — the write the real `useSubPanel` makes through `editChrome`. */
const SAVED_TAB = paneAt(17, 0);

const recordOf = (
  cwd: string,
  parentId: TerminalId | null,
  lastActivityAt: number,
): PadiTerminal =>
  ({
    state: "active",
    cwd,
    git: { kind: "none" },
    parentId,
    agent: null,
    foreground: null,
    rightPanel: null,
    ports: { status: "unknown" },
    lastActivityAt,
    promptedAt: null,
  }) as unknown as PadiTerminal;

const recordFor = (id: TerminalId, n: number, cwd?: string): PadiTerminal => {
  const at = Number(id.slice(1).split("p")[0]);
  const pane = id.includes("p") ? Number(id.split("p")[1]) : null;
  return recordOf(
    cwd ?? `/w/p${at}`,
    pane === null ? null : parentOfPane(at, pane),
    n,
  );
};

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

interface Harness {
  /** Where the seed landed — the one write hydration plans. */
  readonly landedOn: () => TerminalId | null | undefined;
  readonly seeded: () => boolean;
  /** The pane the view state holds focused — the DERIVED answer, off the
   *  real `createViewState` the scope carries. */
  readonly focused: () => TerminalId | null;
  /** One tile's seeded tab, off the real `useSubPanel` store. */
  readonly activeTab: (tile: TerminalId) => TerminalId | null;
  readonly setCwd: (id: TerminalId, cwd: string) => void;
}

/** The session, landed: the real keys stream, the real per-key collection,
 *  the real saved-session cell, and the hook reading them through the facade
 *  production hands it. */
const drive = async (): Promise<Harness> => {
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  let landedOn: TerminalId | null | undefined;
  let view: HostViewState | undefined;
  let latch: HostRestoreLatch | undefined;
  takeSolidDiagnostics();
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const fleet = fleetScope();
    held.scope = fleet.scope;
    latch = fleet.restore;
    view = fleet.view;
    const metadata = useTerminalMetadata({ list: terminalListSub });
    // The store as its composer builds it, for the two members this fold is
    // over: the LIST facade and the metadata census. The landing is a spy,
    // because where the seed lands is the published answer here — but the
    // COVER test is the real derivation's (`createViewState.seedCovers`), so
    // the seed takes the arm a cold boot takes.
    const store = {
      ...metadata,
      listSub: terminalListSub,
      seedCovers: fleet.view.seedCovers,
      planSetActiveSilently: (id: TerminalId | null) => () => {
        landedOn = id;
      },
      planNoteSeededActivation: (id: TerminalId) => () => {
        landedOn = id;
      },
    } as unknown as TerminalStore;
    useSessionRestore({ store });
  });
  mirror.pushKeys(ids);
  mirror.pushSession({ activeTerminalId: SAVED });
  for (const [n, id] of ids.entries()) mirror.pushRecord(id, recordFor(id, n));
  await settle();
  flush();
  return {
    landedOn: () => landedOn,
    seeded: () => latch?.phase === "seeded",
    focused: () => view?.focusedTerminalId() ?? null,
    activeTab: (tile) => useSubPanel().paneChrome(tile).activeSubTab,
    setCwd: (id, cwd) =>
      mirror.pushRecord(id, recordFor(id, ids.indexOf(id), cwd)),
  };
};

it("hydrates a 250-pane saved session with no wide scope", async () => {
  const h = await drive();

  // Every listed record arrived, so the view seeded — on the tile the blob
  // named, not the first of the order. The view state is the real one, so the
  // focus fact is the derivation's own answer for that tile, and the tab the
  // seed wrote is on the real pane-chrome store.
  expect(h.seeded()).toBe(true);
  expect(h.landedOn()).toBe(SAVED);
  expect(h.focused()).toBe(SAVED);
  expect(h.activeTab(SAVED)).toBe(SAVED_TAB);
  expect(diagnostics()).toEqual([]);

  // The landing tile's record moves: the seed is once-only, so nothing lands
  // again and nothing widens.
  h.setCwd(SAVED, "/w/moved");
  await settle();
  flush();
  expect(h.seeded()).toBe(true);
  expect(h.landedOn()).toBe(SAVED);
  expect(h.focused()).toBe(SAVED);
  expect(h.activeTab(SAVED)).toBe(SAVED_TAB);
  expect(diagnostics()).toEqual([]);
});
