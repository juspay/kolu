import { RpcClientError } from "effect/rpc/RpcClientError";
import { SocketReadError } from "effect/socket/Socket";
import type { HostKey } from "kolu-common/hostKey";
import {
  registerSubscription,
  resetSubscriptionLiveness,
  type SubscriptionProbe,
} from "@kolu/surface/subscriptions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const T_SUBSCRIBED = 1_700_000_000_000;
const T_FIRST_FRAME = T_SUBSCRIBED + 1_000;
const T_SWALLOWED = T_SUBSCRIBED + 3_000;
const T_REOPEN = T_SUBSCRIBED + 5_000;
const T_CAPTURE = T_SUBSCRIBED + 9_000;

const LOCAL: HostKey = { kind: "local" };

const dials = [
  {
    startedAt: T_SUBSCRIBED - 1_000,
    openedAt: T_SUBSCRIBED - 900,
    endedAt: T_SWALLOWED - 100,
    classification: "opened-then-closed" as const,
  },
  {
    startedAt: T_SWALLOWED,
    endedAt: T_SWALLOWED + 50,
    classification: "ended-without-open" as const,
  },
  {
    startedAt: T_REOPEN - 50,
    openedAt: T_REOPEN,
    classification: "in-flight" as const,
  },
];

const entryLens = (state: unknown) =>
  new Proxy(
    { state: () => state },
    {
      get(target, prop) {
        if (prop === "state") return target.state;
        throw new Error(
          `diagnosticSnapshot reached entry.${String(prop)} — the builder must read client-held state only`,
        );
      },
    },
  );

vi.mock("./wire", () => ({
  wire: { status: () => "open" },
  wireDiagnostics: { dialHistory: () => dials, epoch: () => 2 },
  hostKeys: () => [LOCAL],
  padiMap: {
    entry: () =>
      entryLens({ kind: "connected", connection: { phase: "connected" } }),
  },
}));
vi.mock("./rpc/rpc", () => ({ serverProcessId: () => "777182df" }));
vi.mock("./kaval/useDaemonStatus", () => ({
  localDaemonStatus: () => ({ contractVersion: "5.1" }),
}));

const {
  collectDiagnosticSnapshot,
  formatDiagnosticSnapshot,
  subscriptionVerdict,
} = await import("./diagnosticSnapshot");
const { recordProbeSettled } = await import("./wireProbes");

function openTheTabsSubscriptions(): {
  entries: SubscriptionProbe;
  preferences: SubscriptionProbe;
} {
  vi.setSystemTime(T_SUBSCRIBED);
  const entries = registerSubscription("entries[local]");
  const preferences = registerSubscription("preferences");
  vi.setSystemTime(T_FIRST_FRAME);
  entries.frame();
  preferences.frame();
  return { entries, preferences };
}

beforeEach(() => {
  resetSubscriptionLiveness();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the snapshot proves the park by itself", () => {
  it("PRE-J1: names the parked subscription, with its frame frozen before the wire opened", () => {
    openTheTabsSubscriptions();
    vi.setSystemTime(T_CAPTURE);
    const snap = collectDiagnosticSnapshot();

    expect(snap.wire.openSince).toBe(T_REOPEN);
    const entries = snap.subscriptions.find(
      (s) => s.label === "entries[local]",
    );
    expect(entries?.verdict).toBe("parked");
    expect(entries?.lastFrameAt).toBe(T_FIRST_FRAME);
    expect(entries?.lastFrameAt as number).toBeLessThan(
      snap.wire.openSince as number,
    );
    expect(entries?.state).toBe("live");
    expect(
      snap.subscriptions
        .filter((s) => s.verdict === "parked")
        .map((s) => s.label),
    ).toEqual(["entries[local]", "preferences"]);

    const text = formatDiagnosticSnapshot(snap);
    expect(text).toContain("PARKED entries[local]");
    expect(text).toContain("ended-without-open");
  });

  it("a stable heartbeat failure and re-subscription land reads live", () => {
    const { entries, preferences } = openTheTabsSubscriptions();
    vi.setSystemTime(T_REOPEN + 120);
    entries.retry(
      new RpcClientError({
        reason: new SocketReadError({ cause: new Error("ping timeout") }),
      }),
    );
    entries.frame();
    preferences.retry(
      new RpcClientError({
        reason: new SocketReadError({ cause: new Error("ping timeout") }),
      }),
    );
    preferences.frame();

    vi.setSystemTime(T_CAPTURE);
    const snap = collectDiagnosticSnapshot();
    expect(
      snap.subscriptions.filter((s) => s.verdict === "parked"),
    ).toHaveLength(0);
    const row = snap.subscriptions.find((s) => s.label === "entries[local]");
    expect(row?.verdict).toBe("live");
    expect(row?.retries).toBe(1);
    expect(row?.lastFrameAt as number).toBeGreaterThan(
      snap.wire.openSince as number,
    );
  });

  it("says `unknown`, never `parked`, while the wire is not open", () => {
    openTheTabsSubscriptions();
    vi.setSystemTime(T_CAPTURE);
    const parked = collectDiagnosticSnapshot().subscriptions[0];
    if (parked === undefined) throw new Error("no subscription registered");
    expect(parked.verdict).toBe("parked");
    expect(subscriptionVerdict(parked, undefined)).toBe("unknown");
    expect(subscriptionVerdict({ ...parked, state: "ended" }, T_REOPEN)).toBe(
      "ended",
    );
    expect(subscriptionVerdict({ ...parked, state: "failed" }, T_REOPEN)).toBe(
      "failed",
    );
    expect(
      subscriptionVerdict(
        { ...parked, subscribedAt: T_REOPEN + 1, lastFrameAt: undefined },
        T_REOPEN,
      ),
    ).toBe("warming");
  });
});

describe("the block a user pastes", () => {
  it("renders every section in a stable order, with absent values as `unknown`", () => {
    openTheTabsSubscriptions();
    vi.setSystemTime(T_CAPTURE);
    const text = formatDiagnosticSnapshot(collectDiagnosticSnapshot());
    const order = ["[build]", "[wire]", "[subscriptions]", "[hosts]"].map((s) =>
      text.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("last probe: unknown");
    expect(text).toContain("last stale verdict: unknown");
    expect(text).toContain("server commit: unknown");
    expect(text).toContain("daemon contract version: 5.1");
  });

  it("carries the host entry with its client-side last-update stamp", () => {
    openTheTabsSubscriptions();
    vi.setSystemTime(T_CAPTURE);
    const snap = collectDiagnosticSnapshot();
    expect(snap.hosts).toEqual([
      {
        key: "local",
        kind: "connected",
        detail: "connected",
        lastUpdateAt: T_FIRST_FRAME,
      },
    ]);
  });

  it("reports the watchdog's last probe verdict once one has settled", () => {
    recordProbeSettled(false, T_SWALLOWED);
    recordProbeSettled(true, T_REOPEN + 500);
    openTheTabsSubscriptions();
    vi.setSystemTime(T_CAPTURE);
    const snap = collectDiagnosticSnapshot();
    expect(snap.wire.lastProbeOk).toBe(true);
    expect(snap.wire.lastProbeAt).toBe(T_REOPEN + 500);
    expect(snap.wire.lastStaleAt).toBe(T_SWALLOWED);
  });

  it("builds synchronously off client-held state — no promise, no wire call", () => {
    openTheTabsSubscriptions();
    vi.setSystemTime(T_CAPTURE);
    const snap = collectDiagnosticSnapshot();
    expect(snap).not.toBeInstanceOf(Promise);
    expect(snap.capturedAt).toBe(T_CAPTURE);
  });
});
