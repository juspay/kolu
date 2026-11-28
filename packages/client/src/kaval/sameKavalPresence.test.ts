/** THE KAVAL PRESENCE MEMO HOLDS STILL WHILE THE DAEMON'S COARSE ANSWER DOES.
 *
 *  `toKavalPresence` coarsens a whole `DaemonStatus` onto a five-arm sum and mints a
 *  referentially-new object per call, while its upstream (`localDaemonStatus`, which
 *  reprojects `startedAt` into `{...status}`) republishes on every daemon-status tick.
 *  A recycle/redeploy window is exactly four-plus such ticks whose coarse answer does not
 *  move, so the ungated memo woke every subscriber — the palette's Restart-kaval gate and
 *  the host strip's chain — and Solid's attribution engine raised `UNSTABLE_MEMO_OUTPUT`
 *  on the fourth.
 *
 *  This drives the REAL `activeKavalPresence` memo (not a replica) over the real fold,
 *  with only the two wire seams `useCanvasMode.test.ts`/`sameCanvasMode.test.ts` already
 *  stub — `../wire` and the host scope — and asserts after EVERY republish that
 *  `takeSolidDiagnostics()` is empty, info `EFFECT_RELAY_TEAR` included: a finding fails
 *  at its FIRST sighting here, not at the third the dev lane needs.
 *
 *  The pure cases below pin the comparison itself, including the two nested payloads
 *  (`identity`, `lifetime`) that ride a re-parsed wire frame and therefore cannot be
 *  compared by reference. */

import type { DaemonStatus } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The three facts this fold reads, each a REAL signal installed before the module under
 *  test evaluates. Not plain variables: `localDaemonStatus` and `daemonTransportLive` are
 *  app-lifetime memos whose first run happens at import (the reattach-announce root reads
 *  the former), and a memo that first ran over a constant has no source to wake it later —
 *  so a mutable flag would be read exactly once, for the whole file. */
const [daemonTick, setDaemonTick] = createSignal<DaemonStatus | undefined>(
  undefined,
);
/** The ws transport leg of `daemonChannelLive` (`app.health().live`). */
const [transportLive, setTransportLive] = createSignal(true);
/** The active host entry's own connection leg of `daemonChannelLive`. */
const [entryKind, setEntryKind] = createSignal<
  "connected" | "warming" | "not-a-member"
>("connected");

const h = vi.hoisted(() => ({
  /** The three reads above, installed below — a `vi.mock` factory is hoisted above every
   *  module-scope binding, so it can only reach them through this box. */
  status: (() => undefined) as () => DaemonStatus | undefined,
  live: (() => true) as () => boolean,
  entry: (() => "connected") as () => string,
}));
h.status = daemonTick;
h.live = transportLive;
h.entry = entryKind;

vi.mock("../wire", () => ({
  activeHost: () => LOCAL_HOST,
  app: {
    health: () => ({ live: h.live() }),
    // `padiLinkSub` opens this at module load; it is not on this fold's path.
    cells: { padiLink: { use: () => ({ value: () => undefined }) } },
  },
  padiMap: {
    entry: () => ({
      state: () => ({ kind: h.entry() }),
      // The foreign-clock fence: this test's statuses are already browser-local.
      clock: { toLocal: (at: number) => at },
    }),
  },
}));
vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({
    wire: { daemonStatus: { byKey: () => () => h.status() } },
  }),
}));

// Deferred import, not a static one: the module under test reads the two mocks above at
// module scope (its app-lifetime `createRoot`s run on first evaluation), so it must not
// evaluate before `vi.mock` is installed — the ordering `sameCanvasMode.test.ts` keeps.
const { activeKavalPresence } = await import("./useDaemonStatus");
const { sameKavalPresence, toKavalPresence } = await import(
  "./daemonPresentation"
);

/** A connected wire status whose COARSE answer is fixed, with every nested payload minted
 *  FRESH — the way a re-parsed wire frame arrives, so a reference comparison would see a
 *  different presence each time. `startedAt` is the daemon's boot time: constant for its
 *  life, which is what makes these ticks genuinely the same presence.
 *
 *  `adoptedAt` MOVES per tick: a leaf the status carries and the presence drops. That is
 *  the real shape of this churn — `localDaemonStatus` genuinely differs between ticks (so
 *  it is honestly republishing, not itself an unstable memo), while the fold's answer does
 *  not move at all. */
/** The `connected` arm alone — the variants below spread it, and a spread of the whole
 *  union cannot be re-narrowed to one arm. */
type ConnectedStatus = Extract<DaemonStatus, { state: "connected" }>;

const connectedTick = (at: number): ConnectedStatus => ({
  state: "connected",
  identity: { staleKey: "k1", navigableCommit: "c".repeat(40) },
  contractVersion: "5.2",
  startedAt: 1_700_000_000_000,
  socketPath: "/run/kaval/pty-host.sock",
  lifetime: { kind: "forever" },
  adopted: 2,
  adoptedAt: 1_700_000_100_000 + at,
});

/** The memo's subscriber, as the palette's Restart gate and the host strip hold it. */
const harness = () => {
  const published: string[] = [];
  const dispose = createRoot((disposer) => {
    createEffect(
      () => activeKavalPresence(),
      (presence) => {
        published.push(presence.kind);
      },
    );
    return disposer;
  });
  flush();
  // The mount's own frame is not what this pins; clear it so each publish below is
  // graded on its own.
  takeSolidDiagnostics();
  return {
    published,
    dispose,
    /** One daemon-status tick, graded immediately — rule 1: red at the FIRST sighting. */
    tick: (next: DaemonStatus | undefined) => {
      setDaemonTick(next);
      flush();
      expect(takeSolidDiagnostics()).toEqual([]);
    },
  };
};

beforeEach(() => {
  setEntryKind("connected");
  setTransportLive(true);
  // The memos are app-lifetime: reset the signals, and settle the reset, so each test
  // starts from the same `unknown` presence rather than the previous test's arm.
  setDaemonTick(undefined);
  flush();
  takeSolidDiagnostics();
});

describe("activeKavalPresence under a churning daemon status", () => {
  it("publishes nothing across five ticks whose only moving leaves the fold drops", () => {
    const run = harness();
    run.tick(connectedTick(0));
    expect(run.published).toEqual(["unknown", "connected"]);

    // Four more ticks of the same daemon — a redeploy/recycle window. Each is a genuinely
    // new status; none of them is news about the daemon's presence.
    for (let at = 1; at <= 4; at += 1) run.tick(connectedTick(at));

    expect(run.published).toEqual(["unknown", "connected"]);
    run.dispose();
  });

  it("publishes nothing across five ticks a dead channel folds to `unknown`", () => {
    // The #1568 floor: not live ⇒ `unknown`, whatever the retained status says. The
    // statuses below differ in every leaf and still are not news.
    setTransportLive(false);
    flush();
    const run = harness();
    for (let at = 0; at < 5; at += 1)
      run.tick({
        state: "connected",
        identity: { staleKey: `k${at}`, navigableCommit: `${at}`.repeat(40) },
        contractVersion: `5.${at}`,
        startedAt: at,
      });

    expect(run.published).toEqual(["unknown"]);
    run.dispose();
  });

  it("still publishes every arm transition", () => {
    const run = harness();
    run.tick(connectedTick(0));
    run.tick({ state: "restarting" });
    run.tick({ state: "dead" });
    run.tick({ state: "degraded" });
    run.tick({
      state: "incompatible",
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    });

    expect(run.published).toEqual([
      "unknown",
      "connected",
      "warming",
      "down",
      "down",
      "incompatible",
    ]);
    run.dispose();
  });

  it("still publishes a payload change inside one arm — a recycle's new boot time", () => {
    const run = harness();
    run.tick(connectedTick(0));
    run.tick({ ...connectedTick(0), startedAt: 1_700_000_999_999 });

    expect(run.published).toEqual(["unknown", "connected", "connected"]);
    run.dispose();
  });
});

describe("sameKavalPresence — the comparison itself", () => {
  const connected = () => toKavalPresence(connectedTick(0), true);

  it("folds two independently-minted connected presences together", () => {
    expect(sameKavalPresence(connected(), connected())).toBe(true);
  });

  it("separates arms", () => {
    expect(
      sameKavalPresence({ kind: "unknown" }, { kind: "down", state: "dead" }),
    ).toBe(false);
  });

  it("separates each connected leaf, nested payloads included", () => {
    const base = connected();
    const moved: ConnectedStatus[] = [
      { ...connectedTick(0), contractVersion: "5.3" },
      { ...connectedTick(0), startedAt: 2 },
      { ...connectedTick(0), socketPath: "/run/other.sock" },
      {
        ...connectedTick(0),
        identity: { staleKey: "k2", navigableCommit: "c".repeat(40) },
      },
      {
        ...connectedTick(0),
        identity: { staleKey: "k1", navigableCommit: "d".repeat(40) },
      },
      { ...connectedTick(0), lifetime: { kind: "boundToPid", pid: 7 } },
      { ...connectedTick(0), lifetime: undefined },
    ];
    for (const status of moved)
      expect(sameKavalPresence(base, toKavalPresence(status, true))).toBe(
        false,
      );
  });

  it("separates two lifetimes of one kind that differ in their number", () => {
    const withLifetime = (pid: number) =>
      toKavalPresence(
        { ...connectedTick(0), lifetime: { kind: "boundToPid", pid } },
        true,
      );
    expect(sameKavalPresence(withLifetime(7), withLifetime(7))).toBe(true);
    expect(sameKavalPresence(withLifetime(7), withLifetime(8))).toBe(false);
  });

  it("separates the state word on the payload-bearing scalar arms", () => {
    expect(
      sameKavalPresence(
        { kind: "warming", state: "connecting" },
        { kind: "warming", state: "restarting" },
      ),
    ).toBe(false);
    expect(
      sameKavalPresence(
        { kind: "down", state: "dead" },
        { kind: "down", state: "degraded" },
      ),
    ).toBe(false);
  });

  it("folds the payload-free arms on their kind alone", () => {
    expect(sameKavalPresence({ kind: "unknown" }, { kind: "unknown" })).toBe(
      true,
    );
    expect(
      sameKavalPresence({ kind: "incompatible" }, { kind: "incompatible" }),
    ).toBe(true);
  });
});
