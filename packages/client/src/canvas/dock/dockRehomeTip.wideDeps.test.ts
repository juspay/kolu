// @vitest-environment happy-dom

/** THE RE-HOME TIP'S EDGE AT A FLEET'S SIZE — 250 terminals of one repo, 125
 *  tiles with a split each, all but one of them asleep.
 *
 *  The tip waits for the first card holding two LIVE top-level rows. The
 *  question is asked with `.filter`, which does NOT short-circuit, and the
 *  `.some` above it short-circuits only once the answer is YES — which is
 *  exactly the frame the effect stops running in. So the worst case is the
 *  ordinary one: a card with many rows and no legal pair, where a reading that
 *  asked each row's own record subscribed the tip's effect to two store leaves
 *  per row. Solid's development build judges `WIDE_SCOPE_DEPS` past 200
 *  sources, about 67 rows.
 *
 *  The records are the REAL store (the real per-key `useCollection` view, read
 *  through the real `useTerminalMetadata` projection) and the tree is the real
 *  `useDockOrder`, so the effect here reads what the mounted Dock reads.
 *
 *  What is pinned is the answer itself: a card of SLEEPING rows beside one live
 *  tile cannot be re-homed, and the moment a second tile wakes it can. */

import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({
  entry: (() => undefined) as () => unknown,
  scope: undefined as unknown,
}));

vi.mock("../../wire", () => ({
  padiMap: { entry: () => held.entry() },
  activeHost: () => ({ kind: "local" }),
  encActiveHost: () => "local",
  hostKeys: () => [{ kind: "local" }],
  interpretClientError: () => {},
  activePadiRpc: { chrome: { setSubPanel: async () => {} } },
}));
vi.mock("../../hostScope/hostScopes", () => ({
  activeScope: () => held.scope,
  hostScopeOf: () => held.scope,
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

import { fleetScope } from "../../hostScope/fleetScope.testlib";
import { hostWireMirror } from "../../hostScope/hostWireMirror.testlib";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { rehomePairPossible } from "./dockRehomeTip";
import { useDockOrder } from "./useDockOrder";

/** One repo, 125 tiles, one split each. */
const TILES = 125;
const CWD = "/w/shared";
const tileAt = (at: number) => `t${at}` as TerminalId;
const paneAt = (at: number) => `t${at}p0` as TerminalId;

/** The one tile that is awake when the fleet lands, and the one that wakes. */
const AWAKE = tileAt(0);
const SLEEPER = tileAt(1);

const ids: TerminalId[] = [];
for (let at = 0; at < TILES; at++) {
  ids.push(tileAt(at));
  ids.push(paneAt(at));
}

const recordOf = (
  parentId: TerminalId | null,
  lastActivityAt: number,
  sleeping: boolean,
): PadiTerminal =>
  ({
    ...(sleeping
      ? { state: "sleeping", sleptAt: lastActivityAt }
      : { state: "active" }),
    parentId,
    lastActivityAt,
    cwd: CWD,
    git: { kind: "none" },
  }) as unknown as PadiTerminal;

const emptyUrgency = {
  awaitingIds: [],
  workingIds: [],
  lingerIds: [],
  finishedIds: [],
  settled: true,
} as unknown as PadiUrgency;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it("answers the re-home tip over a 125-row card with no wide scope", async () => {
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  takeSolidDiagnostics();
  /** Every answer the effect published, in order. */
  const answers: boolean[] = [];
  const built = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    held.scope = fleetScope().scope;
    const store = useTerminalStore();
    const tree = useDockOrder();
    // The mounted Dock's own compute, verbatim — the predicate is shared, so
    // this cannot drift from what the component asks.
    createEffect(
      () => rehomePairPossible(tree(), store.liveTileIds()),
      (possible) => {
        answers.push(possible);
      },
    );
    return { store, tree };
  });

  mirror.pushKeys(ids);
  for (const [n, id] of ids.entries()) {
    const at = Number(/^t(\d+)/.exec(id)?.[1] ?? 0);
    const isPane = id.endsWith("p0");
    mirror.pushRecord(
      id,
      recordOf(isPane ? tileAt(at) : null, n, !isPane && id !== AWAKE),
    );
  }
  mirror.pushUrgency(emptyUrgency);
  mirror.pushActivity([]);
  await settle();
  flush();

  // ONE card, every tile in it, and exactly one of them with a grip: no pair,
  // no tip.
  expect(built.tree().groups.map((g) => g.name)).toEqual(["shared"]);
  expect(built.tree().groups[0]?.topRows.length).toBe(TILES);
  expect(built.store.liveTileIds()).toEqual([AWAKE]);
  expect(answers.at(-1)).toBe(false);
  expect(diagnostics()).toEqual([]);

  // A SECOND TILE WAKES: the card now holds a legal pair, and the tip's edge
  // fires exactly once.
  mirror.pushRecord(SLEEPER, recordOf(null, ids.indexOf(SLEEPER), false));
  await settle();
  flush();

  expect(built.store.liveTileIds()).toEqual([AWAKE, SLEEPER]);
  expect(built.tree().groups[0]?.topRows.length).toBe(TILES);
  expect(answers.at(-1)).toBe(true);
  expect(answers.filter((one) => one).length).toBe(1);
  expect(diagnostics()).toEqual([]);
});
