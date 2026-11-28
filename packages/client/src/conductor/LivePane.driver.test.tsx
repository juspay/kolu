// @vitest-environment happy-dom
/** THE LIVE PANE'S KEYBOARD HAND-OVER, OVER A REAL FOCUSABLE SCREEN.
 *
 *  The pane's driver effect is the twin of the peek window's
 *  (`peek/TerminalPeek.tsx`, pinned by `peek/TerminalPeek.driver.test.tsx`):
 *  one DOM act in its apply arm — give the screen the keyboard the moment the
 *  terminal becomes yours. The screen is the SAME component in both views
 *  (`peek/PeekTerminal.tsx`), and it answers a focus SYNCHRONOUSLY: xterm's
 *  textarea raises `focus`, the screen turns it into `onFocus(true)` on the
 *  same stack.
 *
 *  What makes the two views differ is one line. The peek binds that report to
 *  a signal (`focused`) its foot reads, so the write landed in the arm's own
 *  frame and the foot was painted twice per hand-over. THIS pane binds it to
 *  `onFocus={() => {}}` — the report reaches no reactive state at all, so the
 *  arm's focus relays nothing and the inline call is honest.
 *
 *  That is what this file pins, because it is one line from being untrue:
 *  wire the pane's `onFocus` to any signal the head reads and this test goes
 *  red with the peek's own `EFFECT_RELAY_TEAR`, naming the fix (settle the
 *  focus, as `TerminalPeek.tsx` does). The screen stand-in below keeps the
 *  real one's two behaviours that matter here: a real textarea that takes DOM
 *  focus, and the focus listeners `onReady` installs over it.
 *
 *  Three hand-overs in one mounted pane, because a reader takes a terminal
 *  over, hands it back and takes it again inside one sitting — and because
 *  the relay tear escalates on its third sighting. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { TerminalId } from "kolu-common/surface";
import type { WorkRole } from "kolu-work";
import { createSignal, createStore, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import { Shown } from "../ui/shown";

const ID = "22222222-2222-4222-8222-222222222222" as TerminalId;
const HOST = "remote:nix@example";
const REF = `${HOST}/${ID}`;

interface Member {
  work: string;
  title: string;
  role: string;
  driver: "conductor" | "you" | "nobody";
}

/** THE ROOT, under the product's own store name: the membership projection a
 *  pane reads its terminal's driver off (`useWorks.ts`), so a leaf write here
 *  is reported as `membership.driver` exactly as the lane reports it. */
const [membership, setMembership] = createStore<Record<string, Member>>(
  {},
  { name: "membership" },
);

const live = (): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    grid: { cols: 80, rows: 24 },
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: "writing the plan",
      taskProgress: null,
    },
  } as never,
});
const [standing] = createSignal<FleetTerminalStanding>(live());

vi.mock("./peek/PeekTerminal", () => ({
  // THE SCREEN, as far as the keyboard is concerned: a real textarea that
  // takes DOM focus, a handle whose `focus()` focuses it (the real one calls
  // `terminal.focus()`), and the focus listeners `onReady` installs.
  default: (props: {
    onFocus: (focused: boolean) => void;
    onHandle: (handle: { focus: () => void; blur: () => void }) => void;
  }) => {
    const textarea = (
      <textarea data-testid="live-screen-textarea" />
    ) as HTMLTextAreaElement;
    textarea.addEventListener("focus", () => props.onFocus(true));
    textarea.addEventListener("blur", () => props.onFocus(false));
    props.onHandle({
      focus: () => textarea.focus(),
      blur: () => textarea.blur(),
    });
    return <div data-testid="live-screen">{textarea}</div>;
  },
}));
vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => standing(),
}));
vi.mock("./useOpenTile", () => ({ useOpenTile: () => () => {} }));
vi.mock("./workListing", () => ({ inspectMember: () => {} }));
vi.mock("@solid-primitives/resize-observer", () => ({
  createElementSize: () => ({ width: 800, height: 600 }),
}));
vi.mock("../useMobile", () => ({
  isDesktop: () => true,
  isTouch: () => false,
}));
vi.mock("../wire", () => ({
  padiMap: { entry: () => ({ state: () => ({ kind: "ready" }) }) },
  padiRpcOf: () => ({ lifecycle: { resize: () => undefined } }),
}));
vi.mock("./useWorks", () => ({
  // The product hands a pane a Map whose VALUES are the projection's rows,
  // so `membership().get(ref)?.driver` is a store-leaf read.
  useMembership: () => () => new Map(Object.entries(membership)),
  useSeen: () => () => new Map(),
}));
vi.mock("./WorkLock", () => ({
  default: () => <div data-testid="work-lock-stub" />,
}));
vi.mock("../MobileKeyBar", () => ({
  default: () => <div data-testid="mobile-key-bar-stub" />,
}));
vi.mock("./useConductor", () => ({
  useConductor: () => ({ takeOver: () => {}, handBack: () => {} }),
}));
vi.mock("./personInput", () => ({
  inputAllowedAt: () => true,
  personInputAt: () => false,
}));
vi.mock("./memberNames", () => ({
  useMemberName: () => (ref: string) => `name:${ref}`,
}));

import LivePane from "./LivePane";

const [shown] = createSignal(true);
/** The member's role, through a binding: a string literal in the JSX reads to
 *  the a11y lint as an ARIA `role`, which this prop is not. */
const ROLE: WorkRole = "planner";
const disposers: Array<() => void> = [];

const mount = () => {
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <Shown value={shown}>
        <LivePane host={HOST} id={ID} role={ROLE} connected height="400px" />
      </Shown>
    ),
    root,
  );
  disposers.push(() => {
    dispose();
    root.remove();
  });
};

const statusLine = () =>
  document.querySelector('[data-testid="live-statusline"]')?.textContent ?? "";
const screenTextarea = () =>
  document.querySelector('[data-testid="live-screen-textarea"]');

const setDriver = (driver: Member["driver"]) => {
  setMembership((all) => {
    const row = all[REF];
    if (row) row.driver = driver;
  });
  flush();
};

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  setMembership((all) => {
    for (const key of Object.keys(all)) delete all[key];
  });
});

it("takes the keyboard three times with no reader left torn", () => {
  setMembership((all) => {
    all[REF] = {
      work: "w",
      title: "w",
      role: "planner",
      driver: "conductor",
    };
  });
  mount();
  flush();
  expect(statusLine()).toContain("Conductor is driving · read-only");
  // Everything up to the first hand-over is this fixture's setup, not its
  // subject.
  takeSolidDiagnostics();

  for (let round = 0; round < 3; round += 1) {
    // THE TAKE-OVER: one write of the driver.
    setDriver("you");
    // The screen took the keyboard, and the head stopped saying the terminal
    // is the Conductor's.
    expect(document.activeElement).toBe(screenTextarea());
    expect(statusLine()).not.toContain("Conductor is driving · read-only");

    // THE HAND BACK: you click out of the screen to read back, and the
    // conductor takes the terminal again.
    (screenTextarea() as HTMLTextAreaElement).blur();
    flush();
    expect(document.activeElement).not.toBe(screenTextarea());
    setDriver("conductor");
    expect(statusLine()).toContain("Conductor is driving · read-only");
  }

  // One write of the driver, one application of the head, three times over.
  expect(takeSolidDiagnostics()).toEqual([]);
});
