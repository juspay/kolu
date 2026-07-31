/** The new-terminal policy reporter's ORDERING contract (#2045).
 *
 *  padi distinguishes "no chrome has reported" (→ no opinion, the caller's own
 *  default) from a real user preference. That distinction is only worth anything
 *  if the REPORTING side keeps it too: `preferences()` floors an unloaded cell to
 *  `DEFAULT_PREFERENCES`, so reporting off it would tell padi a confident
 *  `shuffle`/`auto` during the connect window — a terminal created in that window
 *  would land on a policy the user never chose, which is the very failure #2045
 *  is about. So the reporter stays SILENT until the preferences cell has yielded.
 *
 *  Drives the REAL production body over the shared mock `padiMap`
 *  (`mockHostMap.testlib`, whose `chrome.setNewTerminalPolicy` stub records what
 *  was sent), with membership, link state and the preferences cell as the levers. */

import type { HostKey } from "kolu-common/hostKey";
import type { Preferences } from "kolu-common/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The preferences cell, UNFLOORED — the lever the ordering contract turns on.
// A real signal so the reporter's memo tracks it, minted inside the mock factory
// (which runs before the module under test binds) and published on this bag.
const prefsBag = vi.hoisted(() => ({
  set: (_p: unknown) => {},
}));

vi.mock("../wire", async () => {
  const { mockPadiMap } = await import("./mockHostMap.testlib");
  const { createSignal } = await import("solid-js");
  const [prefs, setPrefs] = createSignal<unknown>(undefined);
  prefsBag.set = (p) => setPrefs(p);
  return {
    padiMap: mockPadiMap,
    hostKeys: () => mockPadiMap.entries.use().keys(),
    preferencesLoaded: prefs,
  };
});

vi.mock("../settings/useColorScheme", () => ({
  useColorScheme: () => ({ isDark: () => false }),
}));

import {
  addHost,
  policyReports,
  resetHosts,
  resetPolicyReports,
  setHostsConnected,
} from "./mockHostMap.testlib";
import { useNewTerminalPolicyReport } from "./useNewTerminalPolicyReport";

const LOCAL: HostKey = { kind: "local" };
const REMOTE: HostKey = { kind: "remote", target: "user@box" };

const PREFS = {
  newTerminalTheme: "inherit",
  shuffleBehavior: "colourful",
} as unknown as Preferences;

/** What the reporter should send for {@link PREFS} — `isDark` RESOLVED. */
const REPORTED = {
  newTerminalTheme: "inherit",
  shuffleBehavior: "colourful",
  isDark: false,
};

/** Solid flushes membership/keying effects on a microtask; a macrotask drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setPrefs = (p: Preferences | undefined): void => prefsBag.set(p);

// App-lifetime shared root — stood up ONCE, exactly as the app shell mounts it.
// Per-test isolation comes from membership: emptying it disposes each host's
// reporter owner, and re-adding builds a fresh one.
useNewTerminalPolicyReport();

beforeEach(async () => {
  resetHosts();
  setHostsConnected(true);
  setPrefs(undefined);
  await flush();
  resetPolicyReports();
});

describe("useNewTerminalPolicyReport", () => {
  it("sends NOTHING before the preferences cell has yielded", async () => {
    // Link up, host present — and still silent, because the only thing missing
    // is the fact itself. padi's "nobody has reported" branch stays reachable.
    addHost(LOCAL);
    await flush();
    expect(policyReports).toEqual([]);
  });

  it("sends once the cell lands — and reports what the user actually chose", async () => {
    addHost(LOCAL);
    await flush();
    setPrefs(PREFS);
    await flush();
    expect(policyReports).toEqual([{ host: LOCAL, policy: REPORTED }]);
  });

  it("holds a landed policy back until the host's link is up, then sends it", async () => {
    setHostsConnected(false);
    addHost(LOCAL);
    setPrefs(PREFS);
    await flush();
    expect(policyReports).toEqual([]);
    // A padi that respawned or was redialled starts with no reported policy —
    // the link coming (back) up is what re-seeds it.
    setHostsConnected(true);
    await flush();
    expect(policyReports).toEqual([{ host: LOCAL, policy: REPORTED }]);
  });

  it("reports to EVERY member host, not just the one being looked at", async () => {
    setPrefs(PREFS);
    addHost(LOCAL);
    addHost(REMOTE);
    await flush();
    expect(policyReports.map((r) => r.host)).toEqual([LOCAL, REMOTE]);
  });
});
