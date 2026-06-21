/**
 * Orchestrator tests — `startFleet` / `snapshotFleet` against fake in-process
 * arivu clients (no socket, no ssh). The fake's `keys` stream yields a snapshot
 * then stays open, so a host reads as live `connected` until the test closes it;
 * that lets us assert the (host, terminalId) keying, the status transitions, and
 * that one dead dial degrades to a per-host `unreachable` rather than sinking
 * the board.
 */

import {
  ARIVU_CONTRACT_VERSION,
  type AwarenessValue,
  type TerminalId,
} from "@kolu/arivu-contract";
import { describe, expect, it } from "vitest";
import type { Connection } from "./connect.ts";
import { type FleetSink, snapshotFleet, startFleet } from "./fleet.ts";
import type { FleetHost } from "./hosts.ts";
import type { FleetHostStatus } from "./fleetTypes.ts";

const id = (s: string): TerminalId => s as TerminalId;
function val(over: Partial<AwarenessValue>): AwarenessValue {
  return {
    cwd: "/repo",
    git: null,
    lastActivityAt: 0,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ...over,
  } as AwarenessValue;
}
const agentVal = (state: string): AwarenessValue["agent"] =>
  ({ kind: "claude-code", state }) as AwarenessValue["agent"];

async function* once<T>(v: T): AsyncGenerator<T> {
  yield v;
}

const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

interface Fake {
  conn: Connection;
  /** Simulate the link dropping (the keys stream ends) without a deliberate dispose. */
  dropLink: () => void;
}

/** A fake arivu connection whose `awareness.keys` yields one snapshot then stays
 *  open (so the host reads as live) until `dropLink()` / `dispose()` ends it. */
function fakeConn(opts: {
  version?: string;
  terminals: Record<string, AwarenessValue>;
}): Fake {
  let endKeys!: () => void;
  const open = new Promise<void>((res) => {
    endKeys = res;
  });
  const client = {
    surface: {
      version: {
        get: async () =>
          once({ contractVersion: opts.version ?? ARIVU_CONTRACT_VERSION }),
      },
      awareness: {
        keys: async () =>
          (async function* () {
            yield Object.keys(opts.terminals) as TerminalId[];
            await open;
          })(),
        get: async ({ key }: { key: TerminalId }) =>
          once(opts.terminals[key] as AwarenessValue),
      },
    },
  };
  return {
    conn: {
      client: client as unknown as Connection["client"],
      dispose: () => endKeys(),
    },
    dropLink: () => endKeys(),
  };
}

function recordingSink(): {
  sink: FleetSink;
  statuses: Array<[string, FleetHostStatus]>;
  upserts: Array<[string, string, AwarenessValue]>;
  removes: Array<[string, string]>;
} {
  const statuses: Array<[string, FleetHostStatus]> = [];
  const upserts: Array<[string, string, AwarenessValue]> = [];
  const removes: Array<[string, string]> = [];
  return {
    statuses,
    upserts,
    removes,
    sink: {
      setStatus: (l, s) => statuses.push([l, s]),
      upsert: (l, i, v) => upserts.push([l, i, v]),
      remove: (l, i) => removes.push([l, i]),
    },
  };
}

const hostsOf = (...labels: string[]): FleetHost[] =>
  labels.map((label) => ({ label, ssh: `nix@${label}` }));

describe("startFleet", () => {
  it("mirrors each host live, keyed by (host, terminalId) — same id stays distinct", async () => {
    const a = fakeConn({
      terminals: { [id("same")]: val({ agent: agentVal("thinking") }) },
    });
    const b = fakeConn({
      terminals: { [id("same")]: val({ agent: agentVal("awaiting_user") }) },
    });
    const { sink, statuses, upserts } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("a", "b"),
      connect: async (h) => (h.label === "a" ? a.conn : b.conn),
      sink,
      log: () => {},
    });
    await delay(20);

    expect(statuses).toContainEqual(["a", { kind: "connected" }]);
    expect(statuses).toContainEqual(["b", { kind: "connected" }]);
    // Identical terminal id under two hosts: both mirrored, never collided.
    expect(
      upserts
        .filter(([, i]) => i === "same")
        .map(([l]) => l)
        .sort(),
    ).toEqual(["a", "b"]);
    handle.dispose();
  });

  it("surfaces a dead dial as unreachable while the other host keeps mirroring", async () => {
    const good = fakeConn({
      terminals: { [id("t")]: val({ agent: agentVal("thinking") }) },
    });
    const { sink, statuses, upserts } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("dead", "good"),
      connect: async (h) => {
        if (h.label === "dead") throw new Error("ECONNREFUSED");
        return good.conn;
      },
      sink,
      log: () => {},
    });
    await delay(20);

    expect(statuses).toContainEqual([
      "dead",
      { kind: "unreachable", reason: "ECONNREFUSED" },
    ]);
    expect(statuses).toContainEqual(["good", { kind: "connected" }]);
    expect(upserts).toContainEqual(["good", "t", expect.anything()]);
    handle.dispose();
  });

  it("flags a contract-version mismatch as skew", async () => {
    const skewed = fakeConn({ version: "9.9", terminals: {} });
    const { sink, statuses } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("x"),
      connect: async () => skewed.conn,
      sink,
      log: () => {},
    });
    await delay(20);

    expect(statuses).toContainEqual([
      "x",
      {
        kind: "skew",
        localVersion: ARIVU_CONTRACT_VERSION,
        hostVersion: "9.9",
      },
    ]);
    handle.dispose();
  });

  it("flips a host to unreachable when its link drops after connecting", async () => {
    const f = fakeConn({ terminals: {} });
    const { sink, statuses } = recordingSink();
    const handle = startFleet({
      hosts: hostsOf("x"),
      connect: async () => f.conn,
      sink,
      log: () => {},
    });
    await delay(20);
    expect(statuses).toContainEqual(["x", { kind: "connected" }]);

    f.dropLink(); // the box went away
    await delay(20);
    expect(statuses).toContainEqual([
      "x",
      { kind: "unreachable", reason: "connection closed" },
    ]);
    handle.dispose();
  });
});

describe("snapshotFleet", () => {
  it("dumps each host's terminals, and a dead host as an unreachable snapshot", async () => {
    const a = fakeConn({ terminals: { [id("t1")]: val({ cwd: "/x" }) } });
    const snaps = await snapshotFleet(hostsOf("a", "dead"), async (h) => {
      if (h.label === "dead") throw new Error("boom");
      return a.conn;
    });
    expect(snaps).toHaveLength(2);
    const ok = snaps.find((s) => s.label === "a");
    expect(ok?.kind).toBe("ok");
    expect(ok?.kind === "ok" && ok.entries[0]?.[0]).toBe("t1");
    expect(snaps.find((s) => s.label === "dead")).toEqual({
      label: "dead",
      kind: "unreachable",
      reason: "boom",
    });
  });

  it("flags a contract-skewed host as skew, keeping its rows visible", async () => {
    const skewed = fakeConn({
      version: "9.9",
      terminals: { [id("t1")]: val({ cwd: "/x" }) },
    });
    const [snap] = await snapshotFleet(hostsOf("old"), async () => skewed.conn);
    // The skew signal is carried AND the host's entries are kept — a skewed box
    // is visible WITH its rows, not dumped as if fully compatible.
    expect(snap?.kind).toBe("skew");
    expect(snap?.kind === "skew" && snap.localVersion).toBe(
      ARIVU_CONTRACT_VERSION,
    );
    expect(snap?.kind === "skew" && snap.hostVersion).toBe("9.9");
    expect(snap?.kind === "skew" && snap.entries[0]?.[0]).toBe("t1");
  });
});
