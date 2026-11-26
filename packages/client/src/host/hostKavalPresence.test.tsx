/** THE PER-HOST KAVAL PRESENCE MEMO HOLDS STILL WHILE THAT HOST'S DAEMON DOES.
 *
 *  `HostDaemonChips`'s `hostKavalPresence` is the second reactive consumer of
 *  `toKavalPresence` — the per-host twin of `activeKavalPresence` (pinned by
 *  `kaval/sameKavalPresence.test.ts`), with the same exposure: a host chip whose daemon
 *  status re-serves every tick while its coarse presence does not move. Both are gated on
 *  `sameKavalPresence`, so both are pinned the same way.
 *
 *  This mounts the REAL chip (the whole `HostDualDaemonSlot`, with the real fold, the real
 *  per-host reader and the real marks) and republishes five daemon statuses whose only
 *  moving leaves the fold drops. After EVERY republish `takeSolidDiagnostics()` must be
 *  empty, info `EFFECT_RELAY_TEAR` included: a finding fails at its FIRST sighting here,
 *  not at the third the dev lane needs. Only the wire, the host scope and the clock are
 *  stubbed. */

import type { DaemonStatus } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { render } from "@solidjs/web";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** This host's daemon-status cell, as its padi serves it — a REAL signal installed before
 *  the modules under test evaluate (`useDaemonStatus`'s app-lifetime memos run at import,
 *  and a memo that first ran over a constant has no source to wake it later). */
const [daemonTick, setDaemonTick] = createSignal<DaemonStatus | undefined>(
  undefined,
);

const h = vi.hoisted(() => ({
  /** The read above, installed below — a `vi.mock` factory is hoisted above every
   *  module-scope binding, so it can only reach it through this box. */
  status: (() => undefined) as () => DaemonStatus | undefined,
}));
h.status = daemonTick;

/** An empty, never-yielding cell — what every cell this chip's module graph opens at
 *  import reads as, except the one daemon-status collection the test drives. */
const emptyCell = { use: () => ({ value: () => undefined }) };

/** Any cell name, answered the same way: the module graph under this chip opens several
 *  app-lifetime cells at import (`daemonInventory`, `padiLink`, …) and none of them is on
 *  this fold's path, so naming them one by one would only make the mock rot. */
const anyCell: Record<string, typeof emptyCell> = new Proxy(
  {},
  { get: () => emptyCell },
);

const entryFace = () => ({
  state: () => ({ kind: "connected" }),
  // The foreign-clock fence: this test's statuses are already browser-local.
  clock: { toLocal: (at: number) => at },
  cells: anyCell,
});

vi.mock("../wire", () => ({
  activeHost: () => LOCAL_HOST,
  setActiveHost: () => {},
  hostKeys: () => [LOCAL_HOST],
  connectionInfo: () => undefined,
  app: {
    health: () => ({ live: true }),
    cells: anyCell,
  },
  padiMap: {
    live: () => true,
    entry: entryFace,
    useEntry: () => ({
      cells: anyCell,
      collections: {
        daemonStatus: {
          use: () => ({ byKey: () => () => h.status() }),
        },
      },
    }),
  },
}));
vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({
    wire: { daemonStatus: { byKey: () => () => h.status() } },
  }),
}));
vi.mock("../time/clock", () => ({
  getClockNow: () => () => 1_700_000_500_000,
  getMonotonicNow: () => () => 0,
}));

// Deferred import, not a static one: the chip's module graph reads the mocks above at
// module scope, so it must not evaluate before `vi.mock` is installed.
const { HostDualDaemonSlot } = await import("./HostDaemonChips");

/** A status whose coarse answer is fixed while a leaf the fold DROPS moves per tick —
 *  the real shape of this churn: the per-host status reader genuinely differs between
 *  ticks (so it is honestly republishing, not itself an unstable memo) while the fold's
 *  answer does not move at all.
 *
 *  `connecting` with a moving `socketPath` is what a recycle serves: the daemon is coming
 *  up at a fresh address, and the presence's warming arm carries only the state word. */
const warmingTick = (at: number): DaemonStatus => ({
  state: "connecting",
  socketPath: `/run/kaval-${at}/pty-host.sock`,
});

/** A connected status, for the arm the chip paints after the recycle lands. */
const connectedTick = (at: number): DaemonStatus => ({
  state: "connected",
  identity: { staleKey: "k1", navigableCommit: "c".repeat(40) },
  contractVersion: "5.2",
  startedAt: 1_700_000_000_000,
  socketPath: "/run/kaval/pty-host.sock",
  lifetime: { kind: "forever" },
  adopted: 2,
  adoptedAt: 1_700_000_100_000 + at,
});

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
});

beforeEach(() => {
  setDaemonTick(undefined);
  flush();
  takeSolidDiagnostics();
});

describe("the host chip's kaval presence under a churning daemon status", () => {
  it("raises no diagnostic across five ticks whose only moving leaves the fold drops", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => <HostDualDaemonSlot host={LOCAL_HOST} />,
      container,
    );
    disposers.push(dispose, () => container.remove());
    flush();
    takeSolidDiagnostics();

    for (let at = 0; at <= 4; at += 1) {
      setDaemonTick(warmingTick(at));
      flush();
      // Rule 1: graded at the FIRST sighting, advisories included.
      expect(takeSolidDiagnostics()).toEqual([]);
    }

    // The chip painted that one state the whole way through …
    expect(
      container
        .querySelector("[data-daemon-state]")
        ?.getAttribute("data-daemon-state"),
    ).toBe("connecting");

    // … and still moves when the daemon's coarse answer genuinely does.
    setDaemonTick(connectedTick(0));
    flush();
    expect(takeSolidDiagnostics()).toEqual([]);
    expect(
      container
        .querySelector("[data-daemon-state]")
        ?.getAttribute("data-daemon-state"),
    ).toBe("connected");
  });
});
