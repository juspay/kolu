// @vitest-environment happy-dom
/** THE PEEK'S KEYBOARD HAND-BACK, OVER A REAL FOCUSABLE SCREEN — the twin of
 *  `TerminalPeek.driver.test.tsx`, from the other side of the hand-over.
 *
 *  `peekReadOnlyFocus` exists so a window the Conductor drives still answers
 *  the keys a reader uses: the screen keeps DOM focus while the terminal is
 *  read-only, so Page-Up/arrows scroll it back and Esc reaches xterm's key
 *  handler (`PeekTerminal.tsx` refuses Escape when `mayType()` is false, which
 *  is what lets it bubble out and close the window). So the effect calls
 *  `h.focus()` the moment typing stops being allowed.
 *
 *  Called INLINE from the apply arm, that focus is answered SYNCHRONOUSLY: the
 *  textarea raises `focus`, `PeekTerminal` turns it into `onFocus(true)` and
 *  `TerminalPeek` writes `focused`. The foot folds the same `driver` the arm's
 *  compute read with `typing()` off `focused`, so it is written twice for one
 *  hand-back — `EFFECT_RELAY_TEAR`, victim `p.children`, root
 *  `membership.driver`, relay `peekReadOnlyFocus` writing `focused`.
 *
 *  A person takes a terminal over and hands it back repeatedly inside one open
 *  peek window; this file does that three times and fails on the first
 *  sighting. Here `inputAllowedAt` is the product's own rule — the Conductor
 *  driving means no typing — so the driver write drives BOTH effects. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, createStore, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../../palette/fleetTerminals";
import { Shown } from "../../ui/shown";
import { closePeek, openPeek } from "./usePeek";

const ID = "22222222-2222-4222-8222-222222222222" as TerminalId;
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
  // THE PRODUCT'S OWN RULE (`workReadings.ts`, `inputAllowed`): a terminal the
  // Conductor drives takes no keys. So one driver write both closes the
  // keyboard and arms `peekReadOnlyFocus`.
  inputAllowedAt: (ref: string) => membership[ref]?.driver !== "conductor",
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

const footEl = () => document.querySelector('[data-testid="peek-foot"]');
const foot = () => footEl()?.textContent ?? null;
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

it("hands the keyboard back three times with no reader left torn", () => {
  setMembership((all) => {
    all[REF] = {
      work: "w",
      title: "w",
      role: "planner",
      driver: "you",
    };
  });
  openPeek({ host: HOST, id: ID });
  mount();
  flush();
  // Everything up to the first hand-back is this fixture's setup, not its
  // subject: the window opens on a terminal that is already yours.
  takeSolidDiagnostics();

  for (let round = 0; round < 3; round += 1) {
    // THE HAND BACK. First the person stops typing — a press on the foot,
    // which the window wires to `blurTerminal`, exactly as clicking out of the
    // screen to read back does — so the screen does NOT already hold the
    // keyboard when the Conductor takes the terminal.
    footEl()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    flush();
    expect(document.activeElement).not.toBe(screenTextarea());

    // The Conductor takes it: ONE write of the driver.
    setDriver("conductor");
    // Read-only, and the screen holds the keyboard so a reader can scroll it
    // back and Esc still reaches it.
    expect(document.activeElement).toBe(screenTextarea());
    expect(foot()).toBe(
      "Read-only while the Conductor drives it. Scroll to read back, drag to select. Esc closes.",
    );

    // THE TAKE OVER, so the next round has a hand-back to make.
    setDriver("you");
    expect(document.activeElement).toBe(screenTextarea());
    expect(foot()).toBe(
      `You’re driving: keys go to name:${REF}, Esc included. Close with × or a click outside.`,
    );
  }

  // The tear is the frame in between: the new `driver` beside the stale
  // `focused`, one foot written twice for one driver write.
  expect(takeSolidDiagnostics()).toEqual([]);
});

/** THE OTHER ARRIVAL at read-only: the window OPENS on a terminal the
 *  Conductor already drives, so `peekReadOnlyFocus` applies as the screen's
 *  handle arrives rather than as the driver changes. This pins which focus
 *  wins against the window's own mount focus (`onSettled(() =>
 *  contentEl?.focus())`), and that nothing tears on the way. */
it("opens read-only without tearing, and the window keeps the mount focus", () => {
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
  expect(foot()).toBe(
    "Read-only while the Conductor drives it. Scroll to read back, drag to select. Esc closes.",
  );
  expect(document.activeElement).toBe(
    document.querySelector('[data-testid="terminal-peek"]'),
  );
  expect(takeSolidDiagnostics()).toEqual([]);
});
