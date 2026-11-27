// @vitest-environment happy-dom

/** THE SETTLE RULE AT A FLEET'S SIZE — 250 tiles, every one carrying a saved
 *  split.
 *
 *  The rule is a writable derivation, so it must SUBSCRIBE to the leaves it
 *  compares — otherwise an entry armed after its last run would watch nothing
 *  and never settle. Subscribing by reading every live record's two leaves on
 *  the rule's own scope costs two nodes per tile, which Solid's development
 *  build judges `WIDE_SCOPE_DEPS` past 200 sources — about 33 tiles. The
 *  leaves are folded per id now and the rule reads the joined list.
 *
 *  THE RECORDS ARE THE REAL STORE. `activeScope()` is mocked, because the
 *  module reads it, but what it answers is `createHostWire` over the real
 *  `createReactiveSubscription` keys stream and the real per-key
 *  `useCollection` view (`hostScope/fleetScope.testlib.ts`,
 *  `hostScope/hostWireMirror.testlib.ts`): a tile's saved split is read off
 *  the store leaf the browser reads it off, and a foreign write arrives as a
 *  FRAME on that key's own stream. A hand-written scope over plain records
 *  under-measures that graph about threefold.
 *
 *  Judged on the diagnostics taken whole AND on what the rule answers: a
 *  gesture still shows at once, a foreign write to ANOTHER tile does not end
 *  it, and the record landing on our value does. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import { Deferred } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

type Saved = { collapsed: boolean; panelSize: number };

const TILES = 250;
const tileAt = (at: number) => `wide-tile-${at}` as TerminalId;

const h = vi.hoisted(() => ({
  setSubPanel: vi.fn(),
  toastError: vi.fn(),
}));
h.setSubPanel.mockImplementation(() => Deferred.await(Deferred.makeUnsafe()));

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

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => held.scope,
  hostScopeOf: () => held.scope,
}));

vi.mock("../wire", () => ({
  padiMap: { entry: () => held.entry() },
  activeHost: () => ({ kind: "local" }),
  encActiveHost: () => "local",
  hostKeys: () => [{ kind: "local" }],
  interpretClientError: () => {},
  activePadiRpc: { chrome: { setSubPanel: h.setSubPanel } },
}));

vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: h.toastError,
    warning: () => {},
    info: () => {},
  }),
}));

import { fleetScope } from "../hostScope/fleetScope.testlib";
import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { useSplitPanelState } from "./splitPanelState";

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

const savedAt = (at: number): Saved => ({
  collapsed: false,
  panelSize: 0.3 + at / 1000,
});

const ids = Array.from({ length: TILES }, (_, at) => tileAt(at));

/** A composed record as this fleet serves one: a live top-level tile whose
 *  chrome names its saved split. */
const recordOf = (subPanel: Saved, lastActivityAt: number): PadiTerminal =>
  ({
    state: "active",
    parentId: null,
    lastActivityAt,
    cwd: "/w/one",
    git: { kind: "none" },
    subPanel,
  }) as unknown as PadiTerminal;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it("watches 250 tiles' saved splits with no wide scope", async () => {
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  takeSolidDiagnostics();
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    held.scope = fleetScope().scope;
  });
  const split = useSplitPanelState();

  mirror.pushKeys(ids);
  for (const [at, id] of ids.entries())
    mirror.pushRecord(id, recordOf(savedAt(at), at));
  await settle();
  flush();

  // Every tile reads its own record through the rule.
  for (let at = 0; at < TILES; at++)
    expect(split.state(tileAt(at))).toEqual(savedAt(at));
  expect(diagnostics()).toEqual([]);

  // A gesture on one tile shows at once and leaves the others alone.
  const gesture = { collapsed: true, panelSize: 0.3 };
  split.write(tileAt(9), gesture);
  flush();
  expect(split.state(tileAt(9))).toEqual(gesture);
  expect(split.state(tileAt(10))).toEqual(savedAt(10));
  expect(diagnostics()).toEqual([]);

  // A foreign write to ANOTHER tile wakes the rule and settles nothing: our
  // entry is still owed a write, and its own record has not moved.
  mirror.pushRecord(
    tileAt(200),
    recordOf({ collapsed: true, panelSize: 0.9 }, 200),
  );
  await settle();
  flush();
  expect(split.state(tileAt(9))).toEqual(gesture);
  expect(split.state(tileAt(200))).toEqual({
    collapsed: true,
    panelSize: 0.9,
  });
  expect(diagnostics()).toEqual([]);

  // The record lands on our value: the entry ends and the record speaks.
  mirror.pushRecord(tileAt(9), recordOf({ ...gesture }, 9));
  await settle();
  flush();
  expect(split.state(tileAt(9))).toEqual(gesture);
  split.forget(tileAt(9));
  flush();
  expect(split.state(tileAt(9))).toEqual(gesture);
  expect(diagnostics()).toEqual([]);
});
