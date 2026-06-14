/** The B3.3 reattach-toast dedupe truth table — when the "N terminals
 *  reattached" confirmation fires.
 *
 *  Mirrors `kavalCurrency.test.ts`: the falsifiable proof the toast fires ONCE
 *  per real adoption and — the regression this locks — NOT again when the SAME
 *  adoption snapshot is replayed to a fresh client context (a page reload /
 *  mobile-Safari tab eviction). Imports the pure module only — no daemonStatus
 *  subscription, no DOM. See juspay/kolu#1365. */

import type { DaemonState } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { reattachToAnnounce } from "./reattachAnnounce";

describe("reattachToAnnounce — the B3.3 one-shot dedupe", () => {
  it.each([
    {
      state: "connected" as DaemonState,
      adopted: 3,
      adoptedAt: 1000,
      lastAnnouncedAt: 0,
      result: { count: 3, at: 1000 },
      why: "first adoption (nothing announced yet) → announce",
    },
    {
      // THE BUG (juspay/kolu#1365): the same adoption snapshot is replayed to a
      // fresh JS context on reconnect/reload; `lastAnnouncedAt` persisted across
      // the reload equals this `adoptedAt`, so it must STAY SILENT.
      state: "connected" as DaemonState,
      adopted: 3,
      adoptedAt: 1000,
      lastAnnouncedAt: 1000,
      result: null,
      why: "same adoptedAt already announced (reload replay) → silent",
    },
    {
      state: "connected" as DaemonState,
      adopted: 2,
      adoptedAt: 2000,
      lastAnnouncedAt: 1000,
      result: { count: 2, at: 2000 },
      why: "a genuinely newer adoption (later update) → announce again",
    },
    {
      state: "connected" as DaemonState,
      adopted: 2,
      adoptedAt: 1000,
      lastAnnouncedAt: 2000,
      result: null,
      why: "a stale/older replay below the high-water mark → never re-fire",
    },
    {
      state: "connected" as DaemonState,
      adopted: 0,
      adoptedAt: undefined,
      lastAnnouncedAt: 0,
      result: null,
      why: "cold boot (no adoption) carries no adoptedAt → silent",
    },
    {
      state: "connected" as DaemonState,
      adopted: 2,
      adoptedAt: undefined,
      lastAnnouncedAt: 0,
      result: null,
      why: "a count with no identity → never announce without an adoptedAt",
    },
    {
      state: "connecting" as DaemonState,
      adopted: 3,
      adoptedAt: 1000,
      lastAnnouncedAt: 0,
      result: null,
      why: "not yet connected → silent (the snapshot isn't authoritative)",
    },
    {
      state: "degraded" as DaemonState,
      adopted: 3,
      adoptedAt: 1000,
      lastAnnouncedAt: 0,
      result: null,
      why: "daemon down → silent",
    },
  ])("$why", ({ state, adopted, adoptedAt, lastAnnouncedAt, result }) => {
    expect(
      reattachToAnnounce(state, adopted, adoptedAt, lastAnnouncedAt),
    ).toEqual(result);
  });
});
