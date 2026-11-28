// @vitest-environment happy-dom

/** ONE REPO SECTION'S ATTENTION TRIPLET AT A FLEET'S SIZE — 250 terminals of
 *  one repo, 50 tiles with four panes each, under one header.
 *
 *  The header counts every row the section owns, splits included, and asks
 *  three things about each: is it unread (a keyed projection leaf), which class
 *  is it in, and are its bytes moving (two more). Folded on one scope that is
 *  three sources per row, which Solid's development build judges
 *  `WIDE_SCOPE_DEPS` past 200 — about 66 rows, an ordinary repo on a busy host.
 *
 *  Every one of those three comes off the REAL store here: the records arrive
 *  through the real per-key `useCollection` view, the class and the live flag
 *  off the real `urgency` cell and `activity` stream through
 *  `useAttentionFacts`, and the unread ledger through the same keyed projection
 *  `savedAttention` uses.
 *
 *  What is pinned is the published triplet — the ids each leg counts, in the
 *  section's own row order — before and after one blocked agent answers and
 *  starts emitting again. */

import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, flush } from "solid-js";
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
import type { DockGroup } from "./dockTree";
import { useDockOrder } from "./useDockOrder";
import { useSectionAttention } from "./useSectionAttention";

const TILES = 50;
const PANES = 4;
/** The ids are REAL ones — `TerminalIdSchema` UUIDs. The unread ledger under
 *  test is this host's own `savedAttention` record (reached through the view
 *  state the fleet scope builds), and that record VALIDATES what it stores:
 *  a `t3p1`-shaped id is dropped on the next read, taking the whole record's
 *  marks with it. One digit span per row keeps them readable. */
const uuidAt = (slot: number): TerminalId =>
  `00000000-0000-4000-8000-${slot.toString(10).padStart(12, "0")}` as TerminalId;
const tileAt = (at: number) => uuidAt(at * 10);
const paneAt = (at: number, pane: number) => uuidAt(at * 10 + pane + 1);

/** One repo, so one section holds the whole fleet. */
const CWD = "/w/one";

/** The server's order: each tile, then its own panes — and the section's rows
 *  arrive in exactly that order, which is what every leg below is read against. */
const ids: TerminalId[] = [];
for (let at = 0; at < TILES; at++) {
  ids.push(tileAt(at));
  for (let pane = 0; pane < PANES; pane++) ids.push(paneAt(at, pane));
}

const parentOfPane = (at: number, pane: number): TerminalId =>
  pane === 1 ? paneAt(at, 0) : pane === 3 ? paneAt(at, 2) : tileAt(at);

const recordOf = (
  parentId: TerminalId | null,
  lastActivityAt: number,
): PadiTerminal =>
  ({
    state: "active",
    parentId,
    lastActivityAt,
    cwd: CWD,
    git: { kind: "none" },
  }) as unknown as PadiTerminal;

const urgencyOf = (over: Partial<Record<string, TerminalId[]>>): PadiUrgency =>
  ({
    awaitingIds: over.awaitingIds ?? [],
    workingIds: over.workingIds ?? [],
    lingerIds: over.lingerIds ?? [],
    finishedIds: over.finishedIds ?? [],
    settled: true,
  }) as unknown as PadiUrgency;

/** The blocked agent that answers. A split, so the fold's "a shell cannot ask
 *  but every sub-row joins the other legs" rule is exercised on a sub-row. */
const BLOCKED = paneAt(3, 1);
/** The other blocked agent, which stays blocked. */
const STILL_BLOCKED = tileAt(17);
/** An agent at work, and an agentless pane whose bytes are moving. */
const WORKING = tileAt(5);
const NOISY = paneAt(9, 2);
/** Two rows carrying an unread mark — one tile, one split. */
const UNREAD = [tileAt(2), paneAt(40, 3)] as const;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it("counts one section's 250 rows with no wide scope", async () => {
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  takeSolidDiagnostics();
  const built = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const fleet = fleetScope();
    held.scope = fleet.scope;
    const tree = useDockOrder();
    const group = (): DockGroup => {
      const one = tree().groups[0];
      if (one === undefined) throw new Error("no section");
      return one;
    };
    return { fleet, tree, attention: useSectionAttention(group) };
  });

  mirror.pushKeys(ids);
  for (const [n, id] of ids.entries()) {
    // The order above is one tile then its four panes, so the position says
    // which row this is — the ids themselves are opaque UUIDs.
    const at = Math.floor(n / (PANES + 1));
    const pane = (n % (PANES + 1)) - 1;
    mirror.pushRecord(
      id,
      recordOf(pane < 0 ? null : parentOfPane(at, pane), n),
    );
  }
  mirror.pushUrgency(
    urgencyOf({
      awaitingIds: [BLOCKED, STILL_BLOCKED],
      workingIds: [WORKING],
    }),
  );
  mirror.pushActivity([WORKING, NOISY]);
  built.fleet.setUnread(UNREAD);
  await settle();
  flush();

  // The section owns every tile and every split, in server order.
  expect(built.tree().groups.length).toBe(1);
  expect(built.tree().groups[0]?.allTopRows.length).toBe(TILES);

  // ASKING is the attention class verbatim; ACTIVE is that partition minus
  // asking (a working agent, and an agentless pane whose bytes move); UNSEEN is
  // the independent unread axis. Each in the section's row order.
  expect(built.attention()).toEqual({
    askingIds: [BLOCKED, STILL_BLOCKED],
    activeIds: [WORKING, NOISY],
    unseenIds: [...UNREAD],
  });
  expect(diagnostics()).toEqual([]);

  // THE BLOCKED SPLIT ANSWERS and starts emitting again: it leaves the violet
  // leg for the rust one, in its own place in the row order, and the two other
  // legs stay as they were.
  mirror.pushUrgency(
    urgencyOf({
      awaitingIds: [STILL_BLOCKED],
      workingIds: [WORKING],
      finishedIds: [BLOCKED],
    }),
  );
  mirror.pushActivity([BLOCKED, WORKING, NOISY]);
  await settle();
  flush();

  expect(built.attention()).toEqual({
    askingIds: [STILL_BLOCKED],
    activeIds: [BLOCKED, WORKING, NOISY],
    unseenIds: [...UNREAD],
  });
  expect(diagnostics()).toEqual([]);
});
