/** The kaval-attention truth table (B3.4 currency + SK5 contract skew) — when
 *  the ONE joined derivation nudges, and on which axis.
 *
 *  Mirrors surface-app's `clientIsStale` test: the falsifiable proof the
 *  currency nudge fires ONLY for a connected daemon whose reported staleKey
 *  provably differs from the server's expected build, and stays silent on every
 *  #1034 over-prompting trap (a matching build, an off-nix "" id on either
 *  side, a transient/down state). Plus the SK5 axis rules: the `incompatible`
 *  verdict reads the TYPED status arm (both versions), floors on the same
 *  channel liveness, and is mutually exclusive with `stale` by construction
 *  (a skewed kaval is never connected). Imports the pure module only — no
 *  daemonStatus subscription, no DOM. */

import type { DaemonStatus } from "@kolu/padi/surface";
import { describe, expect, it } from "vitest";
import { kavalAttention } from "./kavalCurrency";

/** A connected wire status carrying `reported` as its identity staleKey —
 *  `undefined` reported models an identity-less (pre-identity) survivor. */
const connected = (reported: string | undefined): DaemonStatus => ({
  state: "connected",
  identity:
    reported === undefined
      ? undefined
      : { staleKey: reported, navigableCommit: "c".repeat(40) },
  contractVersion: "5.2",
  startedAt: 1,
});

/** The proven-skew arm (SK4) — versions are REQUIRED typed fields. */
const incompatible = (): DaemonStatus => ({
  state: "incompatible",
  daemonVersion: "5.0",
  requiredVersion: "5.2",
});

describe("kavalAttention — the currency axis (B3.4 truth table)", () => {
  it.each([
    {
      expected: "newhash",
      status: connected("oldhash"),
      result: { kind: "stale" },
      why: "connected + two non-empty ids that differ → build behind (nudge)",
    },
    {
      expected: "newhash",
      status: connected("oldhash"),
      live: false,
      result: { kind: "none" },
      why: "connected + differing ids BUT the link is not live (half-open) → silent — the transport-liveness floor; a dead channel can't assert the daemon is connected-and-behind",
    },
    {
      expected: "samehash",
      status: connected("samehash"),
      result: { kind: "none" },
      why: "connected + matching ids → up to date (the no-op-deploy case)",
    },
    {
      expected: "",
      status: connected("oldhash"),
      result: { kind: "none" },
      why: "expected is '' (off-nix server) → silent, never '' !== hash",
    },
    {
      expected: "newhash",
      status: connected(""),
      result: { kind: "none" },
      why: "reported is '' (off-nix daemon) → silent",
    },
    {
      expected: "",
      status: connected(""),
      result: { kind: "none" },
      why: "both '' (off-nix both sides) → silent, never '' !== ''",
    },
    {
      expected: undefined,
      status: connected("oldhash"),
      result: { kind: "none" },
      why: "no expected yet (buildInfo not resolved) → silent",
    },
    {
      expected: "newhash",
      status: connected(undefined),
      result: { kind: "none" },
      why: "no reported (identity absent) → silent",
    },
    {
      expected: "newhash",
      status: { state: "connecting" } as DaemonStatus,
      result: { kind: "none" },
      why: "connecting (transient) → silent, never nudge while warming",
    },
    {
      expected: "newhash",
      status: { state: "restarting" } as DaemonStatus,
      result: { kind: "none" },
      why: "restarting (transient) → silent",
    },
    {
      expected: "newhash",
      status: { state: "degraded" } as DaemonStatus,
      result: { kind: "none" },
      why: "degraded (down) → silent — a build-behind-but-unreachable survivor",
    },
    {
      expected: "newhash",
      status: { state: "dead" } as DaemonStatus,
      result: { kind: "none" },
      why: "dead (down) → silent",
    },
    {
      expected: "newhash",
      status: undefined,
      result: { kind: "none" },
      why: "no status yet (still loading) → silent",
    },
  ])("$why", ({ expected, status, result, live = true }) => {
    expect(kavalAttention(expected, status, live)).toEqual(result);
  });
});

describe("kavalAttention — the contract axis (SK5)", () => {
  it("reads the incompatible verdict off the TYPED status arm, versions intact", () => {
    expect(kavalAttention("newhash", incompatible(), true)).toEqual({
      kind: "incompatible",
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    });
  });

  it("floors on channel liveness exactly like the currency axis — a dead link can't assert a skew", () => {
    expect(kavalAttention("newhash", incompatible(), false)).toEqual({
      kind: "none",
    });
  });

  it("wins regardless of the currency inputs — the axes are mutually exclusive by construction (a skewed kaval is never connected, so no status can satisfy both)", () => {
    // Even with a currency-looking `expected`, an incompatible status is the
    // contract verdict — there is no identity on the arm to compare builds with.
    expect(kavalAttention("newhash", incompatible(), true).kind).toBe(
      "incompatible",
    );
  });
});
