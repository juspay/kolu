/**
 * THE FALSIFIER for kolu#2101 J2: the snapshot must be able to prove the field
 * incident by itself.
 *
 * The incident: a woken tab whose socket, watchdog and header dot were all
 * healthy while every fenced subscription in it was parked on a re-dial the
 * protocol swallowed. The two arms below are that exact drive, before and after
 * J1's fix, differing in ONE fact — whether a frame arrived after the current
 * socket opened:
 *
 *   PRE-J1  the entries subscription hears nothing after the reopen → the
 *           snapshot NAMES it, verdict `parked`, last frame frozen before the
 *           wire's open-since.
 *   POST-J1 the re-dial fails the orphan, the fence re-subscribes, a frame lands
 *           → the same subscription reads `live`.
 *
 * The registry side is REAL (`@kolu/surface/subscriptions`, driven through its
 * own writer); the wire's dial history is SCRIPTED, because post-J1 the park can
 * no longer be produced by driving a real link — the fix is unconditional, and a
 * knob to disable it would be the defect this repo's fail-fast rule forbids. The
 * REAL-link half of the same claim is asserted in
 * `packages/surface/src/links/socketRedialLaws.test.ts` (law 3, "THE FIELD
 * SHAPE"), which drives a served surface over a silently-killed socket and pins
 * the registry's post-J1 numbers off it.
 */

import type { HostKey } from "kolu-common/hostKey";
import {
  registerSubscription,
  resetSubscriptionLiveness,
  type SubscriptionProbe,
} from "@kolu/surface/subscriptions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const T_SUBSCRIBED = 1_700_000_000_000;
const T_FIRST_FRAME = T_SUBSCRIBED + 1_000;
/** The swallowed dial — no `open`, no close code, no server-side trace at all. */
const T_SWALLOWED = T_SUBSCRIBED + 3_000;
/** The socket the tab is sitting on now. Every parked verdict is measured here. */
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

/** An entry lens that answers `state()` and NOTHING else. Reaching for
 *  `collections` / `streams` / `procedures` here would open a subscription or
 *  issue a call — a network round-trip inside a diagnostic that promises none,
 *  and useless in exactly the case it exists for (a wire that is lying). So the
 *  lens throws rather than quietly allowing it. */
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

/** The tab's two long-lived subscriptions, opened on the socket that later died
 *  silently. `entries[local]` is the one that drives the tab dots and the boot
 *  canvas — the subscription whose park the field saw. */
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
    // …and then nothing. The wire re-dialled underneath (dial #2 swallowed, #3
    // open at T_REOPEN) and the orphaned subscriptions were never re-driven.
    vi.setSystemTime(T_CAPTURE);
    const snap = collectDiagnosticSnapshot();

    expect(snap.wire.openSince).toBe(T_REOPEN);
    const entries = snap.subscriptions.find(
      (s) => s.label === "entries[local]",
    );
    expect(entries?.verdict).toBe("parked");
    expect(entries?.lastFrameAt).toBe(T_FIRST_FRAME);
    // The proof, spelled out: the last frame predates the socket the tab is
    // sitting on. Nothing else in the client could state this.
    expect(entries?.lastFrameAt as number).toBeLessThan(
      snap.wire.openSince as number,
    );
    expect(entries?.state).toBe("live"); // not ended, not erroring — the disease
    expect(
      snap.subscriptions
        .filter((s) => s.verdict === "parked")
        .map((s) => s.label),
    ).toEqual(["entries[local]", "preferences"]);

    // And in the text a user actually pastes.
    const text = formatDiagnosticSnapshot(snap);
    expect(text).toContain("PARKED entries[local]");
    // The dial nothing else in the system records — not the client, not the
    // console, not the server's log, because the server never saw a connection.
    expect(text).toContain("ended-without-open");
  });

  it("POST-J1: the same drive with the re-drive lands reads live", () => {
    const { entries, preferences } = openTheTabsSubscriptions();
    // J1's epoch wrap fails the orphaned calls on the reopen edge; the fence's
    // existing retry road re-subscribes and the fresh snapshot arrives.
    vi.setSystemTime(T_REOPEN + 120);
    entries.retry(new Error("the wire re-dialled beneath this call"));
    entries.frame();
    preferences.retry(new Error("the wire re-dialled beneath this call"));
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
    // A wire that is not open has no current socket, so nothing can be said
    // about how stale a subscription is relative to one. Answering `parked`
    // there would report an ordinary disconnection as the incident, and this
    // block's whole value is that a verdict in it means something.
    openTheTabsSubscriptions();
    vi.setSystemTime(T_CAPTURE);
    const parked = collectDiagnosticSnapshot().subscriptions[0];
    if (parked === undefined) throw new Error("no subscription registered");
    expect(parked.verdict).toBe("parked");
    expect(subscriptionVerdict(parked, undefined)).toBe("unknown");
    // …and an ended or failed subscription answers with its own state, not with
    // a staleness verdict it cannot have.
    expect(subscriptionVerdict({ ...parked, state: "ended" }, T_REOPEN)).toBe(
      "ended",
    );
    expect(subscriptionVerdict({ ...parked, state: "failed" }, T_REOPEN)).toBe(
      "failed",
    );
    // Opened ON the current socket with no frame yet is honest warming.
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
    // Never fabricated: no probe has settled in this tab, and the block says so.
    expect(text).toContain("last probe: unknown");
    expect(text).toContain("last stale verdict: unknown");
    // Build identity is stated even when only some of it is known.
    expect(text).toContain("server commit: unknown");
    expect(text).toContain("daemon contract version: 5.1");
  });

  it("carries the host entry with its client-side last-update stamp", () => {
    openTheTabsSubscriptions();
    vi.setSystemTime(T_CAPTURE);
    const snap = collectDiagnosticSnapshot();
    // The stamp comes off the map's OWN per-key subscription in the liveness
    // registry — `surface-map`'s entry state carries no timestamp, and widening
    // it for a client-side need would cost every consumer of a shared package.
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
    // The stale verdict is the fingerprint of the cycle the park rode in on, so
    // it is kept even after a later probe answers.
    expect(snap.wire.lastStaleAt).toBe(T_SWALLOWED);
  });

  it("builds synchronously off client-held state — no promise, no wire call", () => {
    openTheTabsSubscriptions();
    vi.setSystemTime(T_CAPTURE);
    // The entry lens throws on any reach past `state()` (see `entryLens`), so a
    // builder that opened a subscription or issued a call could not get here.
    const snap = collectDiagnosticSnapshot();
    expect(snap).not.toBeInstanceOf(Promise);
    expect(snap.capturedAt).toBe(T_CAPTURE);
  });
});
