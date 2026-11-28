// @vitest-environment happy-dom
/** THE PEEK'S KEYBOARD HAND-OVER, OVER A REAL FOCUSABLE SCREEN.
 *
 *  The driver effect's whole job is one DOM act: give the screen the keyboard
 *  when the terminal becomes yours. The screen answers a focus SYNCHRONOUSLY
 *  — xterm's textarea raises `focus`, `PeekTerminal.tsx` turns it into
 *  `onFocus(true)`, and `TerminalPeek` writes `focused`. Called from the
 *  effect's apply arm, that write lands in the arm's own frame, so the foot —
 *  which folds the same `driver` the arm's compute read with `typing()` off
 *  `focused` — is written twice for one hand-over: the judged
 *  `EFFECT_RELAY_TEAR`, advisory at the first sighting and `warn` at the
 *  third. A user can take the terminal over, hand it back and take it over
 *  again inside one open peek window, so the third sighting is reachable; this
 *  file does exactly that, and fails on the FIRST sighting.
 *
 *  The screen stand-in below is the real one's two behaviours that matter
 *  here: a real textarea that takes DOM focus, and a focus listener that
 *  reports it back on the same stack. Nothing else about xterm is needed. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, createStore, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../../palette/fleetTerminals";
import { Shown } from "../../ui/shown";
import { closePeek, openPeek } from "./usePeek";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const HOST = "remote:nix@example";
const REF = `${HOST}/${ID}`;

interface Member {
  work: string;
  title: string;
  role: string;
  driver: "conductor" | "you" | "nobody";
}

/** THE ROOT, with the product's own store name: the membership projection the
 *  peek reads a terminal's driver off (`useWorks.ts`, `{ name: "membership"
 *  }`), so a leaf write here is reported as `membership.driver` exactly as the
 *  lane reports it. */
const [membership, setMembership] = createStore<Record<string, Member>>(
  {},
  { name: "membership" },
);

const live = (): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: "writing the plan",
      taskProgress: null,
    },
  } as never,
});
const [standing] = createSignal<FleetTerminalStanding>(live());

vi.mock("./PeekTerminal", () => ({
  // THE SCREEN, as far as the keyboard is concerned: a real textarea that
  // takes DOM focus, a handle whose `focus()` focuses it (the real one calls
  // `terminal.focus()`), and the focus listeners `onReady` installs.
  default: (props: {
    onFocus: (focused: boolean) => void;
    onHandle: (handle: { focus: () => void; blur: () => void }) => void;
  }) => {
    const textarea = (
      <textarea data-testid="peek-screen-textarea" />
    ) as HTMLTextAreaElement;
    textarea.addEventListener("focus", () => props.onFocus(true));
    textarea.addEventListener("blur", () => props.onFocus(false));
    props.onHandle({
      focus: () => textarea.focus(),
      blur: () => textarea.blur(),
    });
    return <div data-testid="peek-screen">{textarea}</div>;
  },
}));
vi.mock("../../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => standing(),
}));
vi.mock("../useOpenTile", () => ({ useOpenTile: () => () => {} }));
vi.mock("@solid-primitives/resize-observer", () => ({
  createWindowSize: () => ({ width: 1440, height: 900 }),
}));
vi.mock("../../useMobile", () => ({
  layoutMode: () => "desktop",
  isTouch: () => false,
}));
vi.mock("../useWorks", () => ({
  useWorkMembers: () => () => new Map(),
  // The product hands the peek a Map whose VALUES are the projection's rows,
  // so `membership().get(ref)?.driver` is a store-leaf read.
  useMembership: () => () => new Map(Object.entries(membership)),
  useSeen: () => () => new Map(),
}));
vi.mock("../WorkLock", () => ({
  default: () => <div data-testid="work-lock-stub" />,
}));
vi.mock("../useConductor", () => ({
  useConductor: () => ({ takeOver: () => {}, handBack: () => {} }),
}));
vi.mock("../personInput", () => ({
  // The keyboard is allowed at this terminal, so the foot's `typing()` turns
  // on `focused()` alone — the leaf the relay writes.
  inputAllowedAt: () => true,
  personInputAt: () => false,
}));
vi.mock("../memberNames", () => ({
  useMemberName: () => (ref: string) => `name:${ref}`,
}));
vi.mock("../../ui/ModalDialog", () => ({
  default: (props: { open: boolean; children: unknown }) => (
    <div data-open={props.open ? "" : undefined}>{props.children as never}</div>
  ),
}));
vi.mock("@corvu-next/dialog", () => ({
  default: {
    Content: (props: Record<string, unknown>) => <div {...props} />,
  },
}));

import TerminalPeek from "./TerminalPeek";

const [shown] = createSignal(true);
const disposers: Array<() => void> = [];

const mount = () => {
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <Shown value={shown}>
        <TerminalPeek />
      </Shown>
    ),
    root,
  );
  disposers.push(() => {
    dispose();
    root.remove();
  });
};

const foot = () =>
  document.querySelector('[data-testid="peek-foot"]')?.textContent ?? null;
const screenTextarea = () =>
  document.querySelector('[data-testid="peek-screen-textarea"]');

const setDriver = (driver: Member["driver"]) => {
  setMembership((all) => {
    const row = all[REF];
    if (row) row.driver = driver;
  });
  flush();
};

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  closePeek();
  setMembership((all) => {
    for (const key of Object.keys(all)) delete all[key];
  });
});

it("hands the keyboard over three times with no reader left torn", () => {
  setMembership((all) => {
    all[REF] = {
      work: "w",
      title: "w",
      role: "planner",
      driver: "conductor",
    };
  });
  openPeek({ host: HOST, id: ID });
  mount();
  flush();
  expect(foot()).toContain("Read-only while the Conductor drives it");
  // Everything up to the first hand-over is this fixture's setup, not its
  // subject.
  takeSolidDiagnostics();

  for (let round = 0; round < 3; round += 1) {
    // THE TAKE-OVER: one write of the driver.
    setDriver("you");
    // The screen took the keyboard, and the foot states the settled pair —
    // driving AND typing.
    expect(document.activeElement).toBe(screenTextarea());
    expect(foot()).toBe(
      `You’re driving: keys go to name:${REF}, Esc included. Close with × or a click outside.`,
    );

    // THE HAND BACK: you stop typing — a press on the foot, which the window
    // wires to `blurTerminal`, so the screen gives the keyboard up exactly as
    // it does when you click out of it to read back — and the conductor takes
    // the terminal again.
    document
      .querySelector('[data-testid="peek-foot"]')
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    flush();
    expect(document.activeElement).not.toBe(screenTextarea());
    setDriver("conductor");
    expect(foot()).toContain("Read-only while the Conductor drives it");
  }

  // ONE write of the driver, one application of the foot, three times over.
  // The tear is the frame in between: "You’re driving. Click the terminal to
  // type in it.", the new driver beside the stale `focused`.
  expect(takeSolidDiagnostics()).toEqual([]);
});
