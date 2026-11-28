// @vitest-environment happy-dom
/** THE STRIP'S FIT TABLE OVER A 250-HOST POOL.
 *
 *  Each chip's measured width lands in a `createStore` keyed by the encoded
 *  host, so `chipWidths[key]` is that chip's own store leaf. A single memo
 *  mapping the pool therefore held one source per host: a pool a couple of
 *  hundred deep put it past Solid's 200-source `WIDE_SCOPE_DEPS` judge, and
 *  every `ResizeObserver` report re-ran the whole fit.
 *
 *  THE STORE IS THE PRODUCT'S OWN: the strip is mounted and its real
 *  `createResizeObserver` registrations are driven, so the widths arrive the
 *  way the browser delivers them — a write per chip into the real store.
 *
 *  The chips are measured UNEVENLY (a widening run), so the greedy prefix fit
 *  has a real decision to make and a test that merely counted seats could not
 *  pass. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { testMembershipId } from "@kolu/surface-map/testing";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";

const HOSTS = 250;
/** The pool: the local host, then 249 remotes in a fixed order. */
const hosts: HostKey[] = [
  { kind: "local" },
  ...Array.from(
    { length: HOSTS - 1 },
    (_, n) => ({ kind: "remote", target: `h${n}` }) as HostKey,
  ),
];
const keys = hosts.map(encodeHostKey);

/** The row's own width, and each chip's: the first chips are narrow and they
 *  widen along the pool, so the prefix that fits is not simply "the first N of
 *  a uniform width". */
const ROW_WIDTH = 900;
const widthAt = (at: number): number => 40 + at * 2;

const [activeHostSignal, setActiveHostSignal] = createSignal<HostKey>(
  hosts[0] as HostKey,
);

vi.mock("../wire", () => ({
  activeHost: () => activeHostSignal(),
  hostKeys: () => hosts,
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

/** The strip's own reserves, restated here because they are module-private to
 *  it: the "+ add a host" affordance's room, and the "⋯ +N" trigger's. */
const ADD_BUTTON_RESERVE = 38;
const OVERFLOW_TRIGGER_RESERVE = 44;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

/** happy-dom reports a zero layout box for every element, so the strip is
 *  handed real measurements: the row's own width, and each measuring twin's
 *  own chip width by its host key. `widen` re-reports ONE chip wider — the
 *  realistic change (a host's title arrives and its chip grows). */
function measure(widen?: { key: string; width: number }): void {
  for (const { target, report } of observed) {
    const resolved = target();
    const els = Array.isArray(resolved) ? resolved : resolved ? [resolved] : [];
    for (const el of els) {
      const key = el.dataset.hostKey;
      if (key === undefined) {
        report({ width: ROW_WIDTH, height: 32 }, el);
        continue;
      }
      report(
        {
          width: widen?.key === key ? widen.width : widthAt(keys.indexOf(key)),
          height: 32,
        },
        el,
      );
    }
  }
  flush();
}

/** The chips the strip should seat: the greedy prefix that fits the budget,
 *  computed here from the same widths rather than through the product's fold. */
function seatedPrefix(widen?: { key: string; width: number }): string[] {
  const budget = ROW_WIDTH - ADD_BUTTON_RESERVE - OVERFLOW_TRIGGER_RESERVE;
  const out: string[] = [];
  let used = 0;
  for (const [at, key] of keys.entries()) {
    const width = widen?.key === key ? widen.width : widthAt(at);
    if (used + width > budget) break;
    used += width;
    out.push(key);
  }
  return out;
}

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root?.remove();
  root = undefined;
  setActiveHostSignal(hosts[0] as HostKey);
  observed.length = 0;
});

it("fits a 250-host pool with no wide memo", () => {
  takeSolidDiagnostics();
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <HostSelectorStrip />, root);
  flush();
  measure();

  const row = root.querySelector('[data-testid="host-chip-row"]');
  const seated = (): (string | null)[] =>
    Array.from(row?.querySelectorAll('[data-testid="host-chip"]') ?? []).map(
      (el) => el.getAttribute("data-host"),
    );

  expect(seated()).toEqual(seatedPrefix());
  expect(diagnostics()).toEqual([]);

  // One seated chip grows past the budget's slack: it keeps its seat and the
  // chips that no longer fit behind it leave, which is the one fit decision
  // this table exists to make.
  const grown = { key: keys[2] as string, width: 400 };
  measure(grown);
  expect(seated()).toEqual(seatedPrefix(grown));
  expect(diagnostics()).toEqual([]);
});
