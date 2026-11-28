// @vitest-environment happy-dom
/** THE DEFAULT HIGHLIGHT IS COMPUTED FROM THE LIST THE OPEN WILL PAINT.
 *
 *  The rule is derived (a writable memo keyed on the SCOPE: open, drill, query,
 *  "where the user already is"), which is what keeps it from relaying the
 *  scope change it follows from. But a derivation is a COMPUTE, and in Solid 2
 *  an untracked read is SERVED the last committed value rather than pulling a
 *  dirty computed current — so reading the list through `untrack` handed the
 *  rule the SHUT-phase list, which a shut palette freezes. From the SECOND
 *  open of a session on (once the list memos hold a committed value) the
 *  highlight was therefore landed on a list the palette was no longer showing.
 *
 *  These cases assert the VALUE SHOWN, not just a silent diagnostics drain:
 *
 *  - an open whose toggle target is NOT row 0, over a list that moved while
 *    the palette was shut (warmth order deliberately unlike visit order);
 *  - ⌘⇧H, with the host trail's SETTLED switch write and the switch itself in
 *    one flush — the gesture the whole trail exists for;
 *  - each user gesture — arrows, Tab, hover — holding its own row across a
 *    filtered-list tick, which is what the scope memory is for.
 *
 *  Every case also drains `takeSolidDiagnostics()` to empty, advisories
 *  included: the index must arrive in the flush its scope changed. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, flush } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

/** The host pool, in the order the Hosts group lists it — pool order, never
 *  warmth order, which is what makes the HIGHLIGHT (not the position) the
 *  trail's whole answer. */
const LOCAL: HostKey = { kind: "local" };
const ALPHA: HostKey = { kind: "remote", target: "alpha" };
const BETA: HostKey = { kind: "remote", target: "beta" };

// The canvas host is a REAL signal the test writes, read through the palette's
// own `encActiveHost` — and through the host trail's recording effect, which is
// the subject of the ⌘⇧H case below.
const [activeHost, setActiveHost] = createSignal<HostKey>(LOCAL);

vi.mock("@corvu-next/dialog", () => ({
  default: {
    Content: (props: { children: JSX.Element }) => <div>{props.children}</div>,
  },
}));
vi.mock("./ui/ModalDialog", () => ({
  default: (props: { children: JSX.Element }) => <div>{props.children}</div>,
}));
vi.mock("./settings/useTips", () => ({
  useTips: () => ({ peekAmbientTipText: () => "" }),
}));
vi.mock("./useViewState", () => ({
  useViewState: () => ({ activeId: () => null }),
}));
vi.mock("./wire", () => ({
  encActiveHost: () => encodeHostKey(activeHost()),
  activeHost,
  padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
}));
vi.mock("./host/useHostKaval", () => ({
  useHostKavalChain: () => () => ({ kind: "serving" }),
}));
vi.mock("./attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle" as const, live: false }),
  }),
}));
vi.mock("./palette/CreateIdentityPreview", () => ({ default: () => null }));
// Imported after the mocks above so both module graphs — the palette's and the
// trail's — are built against them; a static import would be hoisted ahead.
const { default: CommandPalette } = await import("./CommandPalette");
const { hostRootActions } = await import("./palette/hostActions");

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  setActiveHost(LOCAL);
  flush();
  document.body.replaceChildren();
});

/** The row Enter would run. */
const highlighted = (): string | null =>
  document
    .querySelector('[role="option"][aria-selected="true"]')
    ?.getAttribute("data-palette-name") ?? null;

/** The rows on screen, in paint order. */
const optionNames = (): string[] =>
  [...document.querySelectorAll('[role="option"]')].map(
    (row) => row.getAttribute("data-palette-name") ?? "",
  );

const drained = (): string[] =>
  takeSolidDiagnostics().map((e) => `${e.severity} ${e.code} ${e.message}`);

const input = (): HTMLInputElement => {
  const el = document.querySelector("input");
  if (!el) throw new Error("the palette rendered no search input");
  return el;
};

const press = (key: string, init: KeyboardEventInit = {}) => {
  input().dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
  );
  flush();
};

const T = Date.now();

/** Terminal rows whose WARMTH order (`max(visitedAt, recencyAt)`) is not their
 *  VISIT order: `cold-but-loud` leads the list on its activity clock, while
 *  `last-visited` is the row the user actually came from — so the default
 *  highlight is row 1, and a rule reading the SHUT-phase list (which has no
 *  loud row in it at all) lands on row 0. */
const LAST_VISITED: PaletteItem = {
  kind: "action",
  name: "last-visited",
  onSelect: () => {},
  row: {
    kind: "terminal",
    terminalId: "t-last" as TerminalId,
    hostKey: LOCAL,
    visitedAt: T - 100,
  },
};
const COLD_BUT_LOUD: PaletteItem = {
  kind: "action",
  name: "cold-but-loud",
  onSelect: () => {},
  row: {
    kind: "terminal",
    terminalId: "t-loud" as TerminalId,
    hostKey: LOCAL,
    visitedAt: T - 5000,
    recencyAt: T - 10,
  },
};

it("opens on the row the user last visited after the list moved while shut", () => {
  const [commands, setCommands] = createSignal<PaletteItem[]>([LAST_VISITED]);
  const [open, setOpen] = createSignal(false);
  dispose = render(
    () => (
      <CommandPalette
        commands={commands}
        open={open()}
        onOpenChange={() => {}}
      />
    ),
    document.body,
  );
  flush();
  // A first open and its close: from here on the list memos hold a COMMITTED
  // value, which is the one an untracked read is served.
  setOpen(true);
  flush();
  setOpen(false);
  flush();
  takeSolidDiagnostics();

  // A background tick while the palette is shut — a terminal printing on the
  // canvas. The shut palette freezes its tree, so this is exactly the news the
  // open edge has to take in.
  setCommands([LAST_VISITED, COLD_BUT_LOUD]);
  flush();

  setOpen(true);
  flush();

  // Paint order is WARMTH, so the loud row leads…
  expect(optionNames()).toEqual(["cold-but-loud", "last-visited"]);
  // …and the highlight is the row YOU were last on, which is not row 0.
  expect(highlighted()).toBe("last-visited");
  expect(drained()).toEqual([]);
});

it("opens ⌘⇧H on the host you came from, with the switch in the same flush", () => {
  // The Hosts group exactly as production builds it: `hostRootActions` over the
  // pool, in pool order, each row's `visitedAt` read off the live switch trail.
  const commands = (): PaletteItem[] => [
    {
      kind: "group",
      name: "Hosts",
      children: hostRootActions([LOCAL, ALPHA, BETA], activeHost(), () => {}),
    },
  ];
  const [open, setOpen] = createSignal(false);
  dispose = render(
    () => (
      <CommandPalette
        commands={commands}
        open={open()}
        onOpenChange={() => {}}
        initialPath={["Hosts"]}
      />
    ),
    document.body,
  );
  flush();

  // The trail behind the gesture: booted on local, switched to alpha, and one
  // ⌘⇧H already pressed and dismissed — the second press is the ordinary one.
  setActiveHost(ALPHA);
  flush();
  setOpen(true);
  flush();
  expect(highlighted()).toBe("local");
  setOpen(false);
  flush();
  takeSolidDiagnostics();

  // THE GESTURE: switch to beta and press ⌘⇧H in ONE flush. The trail's own
  // write is settled, so it lands in a LATER PASS of this same flush — which
  // is precisely the pass a highlight that does not track the list misses.
  setActiveHost(BETA);
  setOpen(true);
  flush();

  // Pool order, never warmth.
  expect(optionNames()).toEqual(["local", "alpha", "beta"]);
  // The host you came from — not the first row of the pool, and never the one
  // you are already on.
  expect(highlighted()).toBe("alpha");
  expect(drained()).toEqual([]);
});

/** Three plain command rows: no trail, so the default highlight is row 0 and
 *  every move off it is the user's own. */
const COMMANDS = (): PaletteItem[] =>
  ["one", "two", "three"].map((name) => ({
    kind: "action",
    name,
    onSelect: () => {},
  }));

/** Mount an open palette over a tree the test can tick, and hand back the
 *  ticker: a FRESH set of equivalent rows, which is what the list churns with
 *  when an unrelated command source republishes. */
const openOverTickableRows = (): (() => void) => {
  const [commands, setCommands] = createSignal<PaletteItem[]>(COMMANDS());
  dispose = render(
    () => <CommandPalette commands={commands} open onOpenChange={() => {}} />,
    document.body,
  );
  flush();
  expect(highlighted()).toBe("one");
  takeSolidDiagnostics();
  return () => {
    setCommands(COMMANDS());
    flush();
  };
};

it("keeps the arrowed-to row across a filtered-list tick", () => {
  const tick = openOverTickableRows();

  press("ArrowDown");
  press("ArrowDown");
  expect(highlighted()).toBe("three");

  tick();

  expect(optionNames()).toEqual(["one", "two", "three"]);
  expect(highlighted()).toBe("three");
  expect(drained()).toEqual([]);
});

it("keeps the tabbed-to row across a filtered-list tick", () => {
  const tick = openOverTickableRows();

  press("Tab");
  expect(highlighted()).toBe("two");

  tick();

  expect(highlighted()).toBe("two");
  expect(drained()).toEqual([]);
});

it("keeps the hovered row across a filtered-list tick", () => {
  const tick = openOverTickableRows();

  // Hover only follows a REAL pointer delta: seed a position, then move. The
  // flush between the move and the enter is what the browser gives for free —
  // two separate tasks, so the armed gate is committed before the row asks.
  const list = document.querySelector('[role="listbox"]')?.parentElement;
  if (!list) throw new Error("the palette rendered no list");
  for (const x of [10, 24]) {
    list.dispatchEvent(
      new MouseEvent("mousemove", { clientX: x, clientY: 10 }),
    );
  }
  flush();
  const third = [...document.querySelectorAll('[role="option"]')][2];
  third?.dispatchEvent(new MouseEvent("mouseenter"));
  flush();
  expect(highlighted()).toBe("three");

  tick();

  expect(highlighted()).toBe("three");
  expect(drained()).toEqual([]);
});
