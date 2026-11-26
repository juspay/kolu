// @vitest-environment happy-dom
/** THE STRIP'S SORTABLE ID LIST HOLDS STILL WHILE THE ACTIVE HOST MOVES.
 *
 *  `hostFit()` re-runs on every `activeHost()` change and returns fresh arrays
 *  of host keys; when every chip already fits, the seating it decides is
 *  identical (`hostOverflow.ts`'s own invariant). `draggableVisible` filters
 *  those keys, so without an equality gate it publishes a new-but-equal array
 *  on every host switch — four of them are Solid's `UNSTABLE_MEMO_OUTPUT`,
 *  which `@kolu/solid-test-setup` fails a test on, and every sortable chip
 *  under `SortableProvider` re-derives its slot for nothing.
 *
 *  The real strip is mounted; only the services around it (the wire, the
 *  attention store, the daemon chains, tips) are replaced with inert surfaces,
 *  the way `BootStalledCanvas.test.tsx` replaces `../wire`. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { testMembershipId } from "@kolu/surface-map/testing";
import { createEffect, createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";

const LOCAL: HostKey = { kind: "local" };
const ZEST: HostKey = { kind: "remote", target: "zest" };
const PEAR: HostKey = { kind: "remote", target: "pear" };

const [activeHostSignal, setActiveHostSignal] = createSignal<HostKey>(LOCAL);

vi.mock("../wire", () => ({
  activeHost: () => activeHostSignal(),
  hostKeys: () => [LOCAL, ZEST, PEAR],
  padiMap: {
    entry: () => ({
      state: () => ({
        kind: "connected",
        membershipId: testMembershipId(),
        clockOffset: 0,
      }),
    }),
  },
  updatePreferences: () => {},
}));
type Observed = {
  target: () => HTMLElement | undefined | HTMLElement[];
  report: (rect: { width: number; height: number }, el: HTMLElement) => void;
};
const observed = vi.hoisted(() => [] as Observed[]);
vi.mock("@solid-primitives/resize-observer", () => ({
  createResizeObserver: (
    target: Observed["target"],
    report: Observed["report"],
  ) => {
    observed.push({ target, report });
  },
}));

/** happy-dom reports a zero layout box for every element, which would push
 *  every chip but the active one into overflow — and a host switch would then
 *  really change the seating. Hand the strip real measurements instead: a wide
 *  row, and a uniform chip width, which is `hostOverflow.ts`'s own invariant (a
 *  chip's measured width never depends on whether it is active). */
function measure(): void {
  for (const { target, report } of observed) {
    const resolved = target();
    const els = Array.isArray(resolved) ? resolved : resolved ? [resolved] : [];
    // A measuring twin carries the host key; the strip's own box does not.
    for (const el of els)
      report({ width: el.dataset.hostKey ? 96 : 600, height: 32 }, el);
  }
  flush();
}
vi.mock("./isActiveHost", () => ({
  useActiveHostSelector: () => (key: string) =>
    key === encodeHostKey(activeHostSignal()),
}));
vi.mock("../attention/attentionMarks", () => ({
  hostMarks: () => ({
    active: () => 0,
    asking: () => 0,
    unseenFinished: () => 0,
  }),
}));
vi.mock("../attention/attentionNav", () => ({ jumpToAsking: () => {} }));
vi.mock("../forwards/useForwards", () => ({ forwardsForHost: () => [] }));
vi.mock("./useHostKaval", () => ({
  useHostKavalChain: () => () => ({ kind: "serving" }),
}));
vi.mock("../kaval/useDaemonStatus", () => ({
  // The ACTIVE host's kaval presence, which `kavalChainOf` folds into a chain.
  activeKavalPresence: () => ({ kind: "connected" }),
}));
vi.mock("../useServerIdentity", () => ({
  useServerIdentity: () => ({ hostname: () => "box" }),
}));
vi.mock("./useHostDiagnosticsOpen", () => ({
  useHostDiagnosticsSelector: () => () => false,
  toggleHostDiagnostics: () => {},
  releaseHostDiagnosticsAnchor: () => {},
}));
vi.mock("../settings/useTips", () => ({
  useTips: () => ({ showTipOnce: () => {} }),
}));
vi.mock("../agents/AgentDistroHostMark", () => ({ default: () => null }));
vi.mock("./addHost", () => ({ addHost: () => {} }));
vi.mock("./removeHost", () => ({ removeHost: () => {} }));
vi.mock("./selectHostTab", () => ({
  selectHostTab: (host: HostKey) => setActiveHostSignal(host),
}));
vi.mock("../runAction", () => ({ runAction: () => {} }));

const { default: HostSelectorStrip } = await import("./HostSelectorStrip");

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root?.remove();
  root = undefined;
  setActiveHostSignal(LOCAL);
  observed.length = 0;
});

it("keeps the sortable host list still across four host switches", () => {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <HostSelectorStrip />, root);
  flush();
  measure();
  const row = root.querySelector('[data-testid="host-chip-row"]');
  const seated = () =>
    Array.from(row?.querySelectorAll('[data-testid="host-chip"]') ?? []).map(
      (el) => el.getAttribute("data-host"),
    );
  const before = seated();
  expect(before).toEqual([LOCAL, ZEST, PEAR].map(encodeHostKey));

  // Four switches, each landing on the same seating: every chip fits, and
  // which host is ACTIVE never moves one.
  for (const host of [ZEST, PEAR, LOCAL, ZEST]) {
    setActiveHostSignal(host);
    flush();
  }

  expect(seated()).toEqual(before);
});
