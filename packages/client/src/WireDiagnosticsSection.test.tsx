// @vitest-environment happy-dom
/**
 * The Diagnostic Info block, rendered (kolu#2101 J2).
 *
 * The copy path is tested against the BUILDER (`diagnosticSnapshot.test.ts`);
 * this is the other half — that the on-screen block a user reads before copying
 * carries the same three sections, off the same live registry, with the parked
 * subscription called out rather than buried in a list.
 */

import type { HostKey } from "kolu-common/hostKey";
import {
  registerSubscription,
  resetSubscriptionLiveness,
} from "@kolu/surface/subscriptions";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const T_SUBSCRIBED = 1_700_000_000_000;
const T_FIRST_FRAME = T_SUBSCRIBED + 1_000;
const T_REOPEN = T_SUBSCRIBED + 5_000;

const LOCAL: HostKey = { kind: "local" };

vi.mock("./wire", () => ({
  wire: { status: () => "open" },
  wireDiagnostics: {
    epoch: () => 2,
    dialHistory: () => [
      {
        startedAt: T_SUBSCRIBED - 1_000,
        openedAt: T_SUBSCRIBED - 900,
        endedAt: T_REOPEN - 3_000,
        closeCode: 1000,
        classification: "opened-then-closed",
      },
      {
        startedAt: T_REOPEN - 2_000,
        endedAt: T_REOPEN - 1_950,
        classification: "ended-without-open",
      },
      {
        startedAt: T_REOPEN - 50,
        openedAt: T_REOPEN,
        classification: "in-flight",
      },
    ],
  },
  hostKeys: () => [LOCAL],
  padiMap: {
    entry: () => ({
      state: () => ({ kind: "connected", connection: { phase: "connected" } }),
    }),
  },
}));
vi.mock("./rpc/rpc", () => ({ serverProcessId: () => "777182df" }));
vi.mock("./kaval/useDaemonStatus", () => ({
  localDaemonStatus: () => undefined,
}));

const { default: WireDiagnosticsSection } = await import(
  "./WireDiagnosticsSection"
);

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  resetSubscriptionLiveness();
  vi.useFakeTimers();
});
afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  vi.useRealTimers();
});

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <WireDiagnosticsSection />, host);
  return host;
}

it("renders the dial history, the subscription table and the host entries, in that order", () => {
  vi.setSystemTime(T_SUBSCRIBED);
  const parked = registerSubscription("entries[local]");
  vi.setSystemTime(T_FIRST_FRAME);
  parked.frame();
  // A second subscription that DID re-drive, so the block is proven to
  // distinguish them rather than painting everything red.
  vi.setSystemTime(T_REOPEN + 100);
  registerSubscription("terminalAttach[pane-1]").frame();
  vi.setSystemTime(T_REOPEN + 4_000);

  const root = mount();
  const block = root.querySelector('[data-testid="wire-diagnostics"]');
  expect(block).not.toBeNull();

  const dials = root.querySelector('[data-testid="wire-dials"]');
  const subs = root.querySelector('[data-testid="wire-subscriptions"]');
  const hosts = root.querySelector('[data-testid="wire-hosts"]');
  // Stable order on screen, the same order the copied text uses.
  const html = block?.innerHTML ?? "";
  expect(html.indexOf('data-testid="wire-dials"')).toBeLessThan(
    html.indexOf('data-testid="wire-subscriptions"'),
  );
  expect(html.indexOf('data-testid="wire-subscriptions"')).toBeLessThan(
    html.indexOf('data-testid="wire-hosts"'),
  );

  // The swallowed dial — the one that leaves no trace anywhere else.
  expect(dials?.textContent).toContain("ended-without-open");
  // The park, named, beside the subscription that is genuinely live.
  expect(subs?.textContent).toContain("parked");
  expect(subs?.textContent).toContain("entries[local]");
  expect(subs?.textContent).toContain("live");
  expect(subs?.textContent).toContain("terminalAttach[pane-1]");
  // The count that makes it readable at a glance.
  expect(block?.textContent).toContain("1 PARKED");
  // The host entry as the client believes it, with its client-side stamp.
  expect(hosts?.textContent).toContain("local");
  expect(hosts?.textContent).toContain("connected");
});

it("says so plainly when there is nothing to report, rather than rendering an empty block", () => {
  vi.setSystemTime(T_REOPEN + 4_000);
  const root = mount();
  expect(
    root.querySelector('[data-testid="wire-subscriptions"]')?.textContent,
  ).toContain("no subscription registered");
});
