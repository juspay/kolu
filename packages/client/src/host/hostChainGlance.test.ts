/**
 * The host dot stops aggregating away the truth (juspay/kolu#2101 N4).
 *
 * The field contradiction, verbatim: the incident's host dot stayed GREEN while
 * the workspace behind it was dead. Nothing lied — the dot reported padi's own
 * link, which was up — but a host entry is the head of a chain (padi → kaval →
 * your terminals), and reporting one link as if it were the chain is a lie of
 * aggregation.
 *
 * These drive the client-state seam directly (`hostGlance`), not the timing: with
 * N1 the degraded window is transient, and a test that raced it would be pinning
 * the repair rather than the honesty of the window while it exists.
 */

import type { EntryState } from "@kolu/surface-map";
import { testMembershipId } from "@kolu/surface-map/testing";
import { describe, expect, it } from "vitest";
import type { KavalPresence } from "../kaval/daemonPresentation";
import {
  hostGlance,
  KAVAL_CHAIN_UNKNOWN,
  type KavalChain,
  kavalChainOf,
} from "./hostChipTone";

const GREEN = "bg-emerald-400";
const RED = "bg-red-400";

const connected: EntryState = {
  kind: "connected",
  membershipId: testMembershipId(),
  clockOffset: 0,
};
const warming: EntryState = {
  kind: "warming",
  membershipId: testMembershipId(),
};
const failed: EntryState<{ reason: string }> = {
  kind: "failed",
  membershipId: testMembershipId(),
  failure: { reason: "ssh: connection refused" },
} as EntryState<{ reason: string }>;

const SERVING: KavalChain = { kind: "serving" };
const DOWN: KavalChain = { kind: "down", verdict: "not running" };
const STARTING: KavalChain = { kind: "starting", verdict: "restarting…" };

describe("kavalChainOf — the presence fold the dot consumes", () => {
  it("a connected kaval is serving", () => {
    expect(
      kavalChainOf({
        kind: "connected",
        contractVersion: "4.1",
        startedAt: 0,
      } as KavalPresence),
    ).toEqual({ kind: "serving" });
  });

  it("a DEAD kaval is down, and NAMES its verdict", () => {
    const chain = kavalChainOf({ kind: "down", state: "dead" });
    expect(chain.kind).toBe("down");
    expect(chain.kind === "down" && chain.verdict.length).toBeGreaterThan(0);
  });

  it("an unknown kaval stays unknown — never optimistically serving", () => {
    expect(kavalChainOf({ kind: "unknown" })).toEqual(KAVAL_CHAIN_UNKNOWN);
  });
});

describe("hostGlance — padi-up + kaval-down renders DEGRADED, never green", () => {
  it("THE field contradiction: a connected host with a dead kaval is not green", () => {
    const g = hostGlance(connected, DOWN);
    expect(g.detailDot).not.toBe(GREEN);
    expect(g.detailDot).not.toContain("emerald");
    expect(g.stripDot).not.toBeNull();
    expect(g.stripDot).not.toContain("emerald");
  });

  it("names the kaval verdict in the tooltip, not merely a colour", () => {
    const g = hostGlance(connected, DOWN);
    expect(g.title).toContain("kaval");
    expect(g.title).toContain("not running");
    expect(g.short).toBe("kaval down");
  });

  it("is NOT painted as unreachable — the host answers, and its padi can repair", () => {
    const g = hostGlance(connected, DOWN);
    expect(g.down).toBe(false);
    expect(g.detailDot).not.toBe(RED);
    expect(g.labelDecoration).toBe("");
  });

  it("a kaval coming back up pulses, and says so", () => {
    const g = hostGlance(connected, STARTING);
    expect(g.detailDot).toContain("animate-pulse");
    expect(g.short).toBe("kaval starting");
    expect(g.title).toContain("restarting");
  });

  it("a whole chain is still plain green — the composition adds no noise", () => {
    const g = hostGlance(connected, SERVING);
    expect(g.detailDot).toBe(GREEN);
    expect(g.stripDot).toBeNull();
    expect(g.title).toBe("connected");
  });

  it("an UNKNOWN kaval verdict makes no claim either way", () => {
    expect(hostGlance(connected, KAVAL_CHAIN_UNKNOWN)).toEqual(
      hostGlance(connected, SERVING),
    );
  });
});

describe("hostGlance — the chain composes ONLY onto a connected entry", () => {
  it("a warming entry keeps its own tone: the kaval verdict through it is stale", () => {
    expect(hostGlance(warming, DOWN)).toEqual(
      hostGlance(warming, KAVAL_CHAIN_UNKNOWN),
    );
  });

  it("a failed entry keeps red + strike: unreachable outranks a stale daemon fact", () => {
    const g = hostGlance(failed, DOWN);
    expect(g.detailDot).toBe(RED);
    expect(g.down).toBe(true);
    expect(g.title).toContain("ssh: connection refused");
  });
});
