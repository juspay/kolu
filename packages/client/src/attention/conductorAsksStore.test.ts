/** THE BELL OVER THE CELL'S OWN STORE.
 *
 *  Every other case of the Conductor's bell hands `conductorAsks` a plain
 *  object from a signal (`useAttention.test.ts`), and a plain object is the
 *  one shape this path never gets in the app: the `conductor` cell's value
 *  lives in a Solid STORE (`createSubscription`), so `cell.openAsks` is a
 *  store proxy, and the bell walks both ask lists in an effect's IMPERATIVE
 *  phase — where a proxy read is untracked by construction.
 *
 *  So this drives the real `useAttention` over a real `createSubscription`,
 *  hand-fed frames, and asks the two questions a mocked reading cannot:
 *
 *   1. **Does a second frame reach the bell at all?** The merge reconciles a
 *      list IN PLACE, so subscribing to the key `openAsks` alone subscribes to
 *      nothing that moves when an ask arrives — the effect never re-runs and
 *      the bell never rings.
 *   2. **Does anything read reactive state in the effect phase?**
 *      `@kolu/solid-test-setup` fails the test on any Solid dev diagnostic,
 *      and walking the proxy there raises `STRICT_READ_UNTRACKED`.
 */

import { createSubscription } from "@kolu/surface/solid";
import { controllableStream, settle } from "@kolu/surface/solid/testlib";
import {
  DEFAULT_CONDUCTOR_STATE,
  type ConductorState,
} from "kolu-common/conductor";
import type { Preferences } from "kolu-common/surface";
import { createRoot } from "solid-js";
import { expect, it, vi } from "vitest";

/** The conductor cell, opened by the shared root the moment the real
 *  `useConductorFacts` first reads it — a REAL subscription over a stream this
 *  test pushes frames into. Wired below, after the imports: the mock factory
 *  is hoisted above them. */
const cell = vi.hoisted(() => ({
  open: (): { value: () => ConductorState | undefined } => {
    throw new Error("the conductor cell was opened before the test wired it");
  },
}));
/** Desktop notifications the one path raised, by tag. */
const popups = vi.hoisted(() => [] as string[]);

// The wire, with the one member the real `useConductorFacts` opens.
vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  setActiveHost: () => {},
  preferencesArrived: () => true,
  preferences: () => ({ attentionAlerts: true }) as Preferences,
  app: { cells: { conductor: { use: () => cell.open() } } },
}));
// Everything the engine reads BESIDE the conductor cell says nothing: this
// case is about the asks, and the per-host mirror has no frame here.
vi.mock("./useAttentionFacts", () => ({ useAttentionFacts: () => ({}) }));
vi.mock("../conductor/useWorks", () => ({
  useMembership: () => () => new Map(),
  useNeedsYou: () => () => [],
  useWorkMap: () => () => new Map(),
}));
vi.mock("../conductor/useConductorMode", () => ({
  conductorMode: () => true,
  enterConductorMode: () => {},
}));
vi.mock("../conductor/workListing", () => ({ showWork: () => {} }));
vi.mock("../conductor/memory/useMemory", () => ({
  memorySheet: { openDialog: () => {} },
  useMemoryNeed: () => () => undefined,
}));
vi.mock("../attentionNotify", () => ({
  notify: {
    requestPermission: async () => {},
    show: async (shown: { tag: string }) => {
      popups.push(shown.tag);
    },
    onClick: () => () => {},
  },
}));

import { useAttention } from "./useAttention";

/** The frames this test pushes: a conversation that is idle, with whatever is
 *  being asked. */
const frame = (openAsks: string[]): ConductorState => ({
  ...DEFAULT_CONDUCTOR_STATE,
  phase: "idle",
  openAsks,
  workAsks: [],
});

it("rings for a question that arrives in a LATER frame of the cell's store", async () => {
  const stream = controllableStream<ConductorState>();
  cell.open = () => {
    const sub = createSubscription(stream.source);
    return { value: () => sub() };
  };
  // The window is away, so a ring raises a desktop notification as well as
  // the chime — the two facts this asserts on.
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const chimes = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);

  const dispose = createRoot((disposeRoot) => {
    useAttention({
      activeId: () => null,
      focusedId: () => null,
      activate: () => {},
      activeSubject: () => ({ title: "t", description: undefined }),
      terminalIds: () => [],
      activeAgentState: () => undefined,
    });
    return disposeRoot;
  });
  try {
    // The server's first word: nothing is being asked. The baseline — and the
    // frame whose two empty lists the bell walks.
    stream.push(frame([]));
    await settle();
    expect(chimes).not.toHaveBeenCalled();

    // A question, delivered by a frame that MERGES into the standing value.
    stream.push(frame(["c1"]));
    await settle();
    expect(chimes).toHaveBeenCalledTimes(1);
    expect(popups).toEqual(["conductor"]);
  } finally {
    dispose();
  }
});
