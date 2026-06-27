/** The B3.4 currency truth table — when the rail nudges "update pending".
 *
 *  Mirrors surface-app's `clientIsStale` test: the falsifiable proof the nudge
 *  fires ONLY for a connected daemon whose reported staleKey provably differs
 *  from the server's expected build, and stays silent on every #1034
 *  over-prompting trap (a matching build, an off-nix "" id on either side, a
 *  transient/down state). Imports the pure module only — no daemonStatus
 *  subscription, no DOM. */

import type { DaemonState } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { kavalStale } from "./kavalCurrency";

describe("kavalStale — the read-site currency nudge", () => {
  it.each([
    {
      expected: "newhash",
      reported: "oldhash",
      state: "connected" as DaemonState,
      result: true,
      why: "connected + two non-empty ids that differ → build behind (nudge)",
    },
    {
      expected: "newhash",
      reported: "oldhash",
      state: "connected" as DaemonState,
      live: false,
      result: false,
      why: "connected + differing ids BUT the link is not live (half-open) → silent — the transport-liveness floor; a dead channel can't assert the daemon is connected-and-behind",
    },
    {
      expected: "samehash",
      reported: "samehash",
      state: "connected" as DaemonState,
      result: false,
      why: "connected + matching ids → up to date (the no-op-deploy case)",
    },
    {
      expected: "",
      reported: "oldhash",
      state: "connected" as DaemonState,
      result: false,
      why: "expected is '' (off-nix server) → silent, never '' !== hash",
    },
    {
      expected: "newhash",
      reported: "",
      state: "connected" as DaemonState,
      result: false,
      why: "reported is '' (off-nix daemon) → silent",
    },
    {
      expected: "",
      reported: "",
      state: "connected" as DaemonState,
      result: false,
      why: "both '' (off-nix both sides) → silent, never '' !== ''",
    },
    {
      expected: undefined,
      reported: "oldhash",
      state: "connected" as DaemonState,
      result: false,
      why: "no expected yet (buildInfo not resolved) → silent",
    },
    {
      expected: "newhash",
      reported: undefined,
      state: "connected" as DaemonState,
      result: false,
      why: "no reported (identity absent) → silent",
    },
    {
      expected: "newhash",
      reported: "oldhash",
      state: "connecting" as DaemonState,
      result: false,
      why: "connecting (transient) → silent, never nudge while warming",
    },
    {
      expected: "newhash",
      reported: "oldhash",
      state: "restarting" as DaemonState,
      result: false,
      why: "restarting (transient) → silent",
    },
    {
      expected: "newhash",
      reported: "oldhash",
      state: "degraded" as DaemonState,
      result: false,
      why: "degraded (down) → silent — a build-behind-but-unreachable survivor",
    },
    {
      expected: "newhash",
      reported: "oldhash",
      state: "dead" as DaemonState,
      result: false,
      why: "dead (down) → silent",
    },
    {
      expected: "newhash",
      reported: "oldhash",
      state: undefined,
      result: false,
      why: "no state yet (status still loading) → silent",
    },
  ])("$why", ({ expected, reported, state, result, live = true }) => {
    // Existing rows default `live: true` (they predate the floor); the floor row
    // sets `live: false` to pin that a not-live link silences the nudge.
    expect(kavalStale(expected, reported, state, live)).toBe(result);
  });
});
