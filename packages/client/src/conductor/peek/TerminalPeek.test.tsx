// @vitest-environment happy-dom
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../../palette/fleetTerminals";
import { Shown } from "../../ui/shown";
import { closePeek, openPeek, peekTarget, peekTyping } from "./usePeek";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const seam = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
  members: new Map<string, unknown>(),
  opened: [] as unknown[],
  took: [] as unknown[],
  gave: [] as unknown[],
  allowed: true,
  gateRefs: [] as string[],
  focusCalls: 0,
}));

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

const [standing, setStanding] = createSignal<FleetTerminalStanding>(live());
const [membership, setMembership] = createSignal<ReadonlyMap<string, unknown>>(
  new Map(),
);

vi.mock("./PeekTerminal", () => ({
  default: (props: Record<string, unknown>) => {
    seam.props = props;
    return <div data-testid="peek-screen" />;
  },
}));
vi.mock("../../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => standing(),
}));
vi.mock("../useOpenTile", () => ({
  useOpenTile: () => (at: unknown) => seam.opened.push(at),
}));
vi.mock("@solid-primitives/resize-observer", () => ({
  createWindowSize: () => ({ width: 1440, height: 900 }),
}));
vi.mock("../../useMobile", () => ({
  layoutMode: () => "desktop",
  isTouch: () => false,
}));
vi.mock("../useWorks", () => ({
  useWorkMembers: () => () => seam.members,
  useMembership: () => () => membership(),
}));
vi.mock("../WorkLock", () => ({
  default: (props: { pill?: boolean }) => (
    <div data-testid="work-lock-stub" data-pill={String(props.pill)} />
  ),
}));
vi.mock("../useConductor", () => ({
  useConductor: () => ({
    takeOver: (ref: string) => seam.took.push(ref),
    handBack: (ref: string) => seam.gave.push(ref),
  }),
}));
vi.mock("../personInput", () => ({
  inputAllowedAt: () => seam.allowed,
  personInputAt: (ref: string) => {
    seam.gateRefs.push(ref);
    return false;
  },
}));
vi.mock("../memberNames", () => ({
  useMemberName: () => (ref: string) => `name:${ref}`,
}));
vi.mock("../../ui/ModalDialog", () => ({
  default: (props: {
    open: boolean;
    escapeCloses?: boolean;
    children: unknown;
  }) => (
    <div
      data-open={props.open ? "" : undefined}
      data-escape-closes={String(props.escapeCloses)}
    >
      {props.children as never}
    </div>
  ),
}));
vi.mock("@corvu/dialog", () => ({
  default: {
    Content: (props: Record<string, unknown>) => <div {...props} />,
  },
}));

import TerminalPeek from "./TerminalPeek";

const [shown, setShown] = createSignal(true);

const disposers: Array<() => void> = [];

const mount = () => {
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <Shown.Provider value={shown}>
        <TerminalPeek />
      </Shown.Provider>
    ),
    root,
  );
  disposers.push(() => {
    dispose();
    root.remove();
  });
};

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  closePeek();
  setShown(true);
  setStanding(live());
  seam.props = undefined;
  seam.members = new Map();
  seam.opened = [];
  seam.took = [];
  seam.gave = [];
  seam.allowed = true;
  seam.gateRefs = [];
  seam.focusCalls = 0;
  setMembership(new Map());
});

describe("TerminalPeek", () => {
  it("draws nothing while no terminal is peeked at", () => {
    mount();
    expect(document.querySelector('[data-testid="terminal-peek"]')).toBeNull();
  });

  it("draws the window on the target and says what its agent is doing", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    expect(
      document.querySelector('[data-testid="terminal-peek"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="peek-status"]')?.textContent,
    ).toBe("Thinking · writing the plan");
    expect(seam.props?.host).toBe("remote:nix@example");
    expect(seam.props?.id).toBe(ID);
  });

  it("closes on the window's ×", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    document
      .querySelector<HTMLButtonElement>('[data-testid="peek-close"]')
      ?.click();
    expect(peekTarget()).toBeNull();
  });

  it("shows a terminal in no work under its own name and with no tabs", () => {
    openPeek({ host: "local", id: ID });
    mount();
    expect(
      document.querySelector('[data-testid="peek-title"]')?.textContent,
    ).toBe(`name:local/${ID}`);
    expect(document.querySelector('[data-testid="peek-tab"]')).toBeNull();
  });

  it("draws one tab per member and moves to the one you pick", () => {
    const OTHER = "22222222-2222-4222-8222-222222222222" as TerminalId;
    const member = (role: string) => ({
      work: "w1",
      role,
      joinedAt: "2026-01-01T00:00:00.000Z",
      worktree: { kind: "unread" },
    });
    seam.members = new Map<string, unknown>([
      [`local/${ID}`, member("planner")],
      [`local/${OTHER}`, member("implementor")],
    ]);
    openPeek({ host: "local", id: ID });
    mount();
    const tabs = document.querySelectorAll('[data-testid="peek-tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute("data-active")).toBe("");
    expect(tabs[1]?.getAttribute("data-ref")).toBe(`local/${OTHER}`);
    document
      .querySelector<HTMLButtonElement>(
        `[data-testid="peek-tab"][data-ref="local/${OTHER}"]`,
      )
      ?.click();
    expect(peekTarget()).toEqual({ host: "local", id: OTHER });
  });

  it("closes when the Conductor stops being the view", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    setShown(false);
    expect(peekTarget()).toBeNull();
  });

  it("says a gone terminal has no screen, and cannot open its tile", () => {
    setStanding({ kind: "gone" });
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    const empty = document.querySelector('[data-testid="peek-empty"]');
    expect(empty?.getAttribute("data-standing")).toBe("gone");
    expect(empty?.textContent).toContain("terminal gone");
    expect(document.querySelector('[data-testid="peek-screen"]')).toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-testid="peek-open-tile"]',
      )?.disabled,
    ).toBe(true);
  });

  it("says a sleeping terminal has no screen either", () => {
    setStanding({
      kind: "here",
      meta: { state: "sleeping" } as never,
    });
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    expect(
      document.querySelector('[data-testid="peek-empty"]')?.textContent,
    ).toContain("asleep");
    expect(document.querySelector('[data-testid="peek-screen"]')).toBeNull();
  });

  it("opens the tile and closes the peek", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    document
      .querySelector<HTMLButtonElement>('[data-testid="peek-open-tile"]')
      ?.click();
    expect(seam.opened).toEqual([{ host: "remote:nix@example", id: ID }]);
    expect(peekTarget()).toBeNull();
  });

  it("leaves a terminal that fits at the default font size alone", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    const onGrid = seam.props?.onGrid as (g: {
      cols: number;
      rows: number;
    }) => void;
    const onCell = seam.props?.onCell as (
      c: { width: number; height: number },
      p: { x: number; y: number },
    ) => void;
    onGrid({ cols: 110, rows: 34 });
    onCell({ width: 8.4, height: 17 }, { x: 26, y: 12 });
    expect(document.querySelector('[data-testid="peek-fit"]')).toBeNull();
    expect(seam.props?.fontSize).toBe(14);
  });

  it("offers Fit width on a wide terminal and shrinks its font", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    const onGrid = seam.props?.onGrid as (g: {
      cols: number;
      rows: number;
    }) => void;
    const onCell = seam.props?.onCell as (
      c: { width: number; height: number },
      p: { x: number; y: number },
    ) => void;
    onGrid({ cols: 212, rows: 52 });
    onCell({ width: 8.4, height: 17 }, { x: 26, y: 12 });
    const fit = document.querySelector<HTMLButtonElement>(
      '[data-testid="peek-fit"]',
    );
    expect(fit).not.toBeNull();
    fit?.click();
    expect(fit?.getAttribute("aria-pressed")).toBe("true");
    expect(seam.props?.fontSize).toBe(9.5);
  });

  it("offers Take over while the Conductor drives, and is read-only", () => {
    const ref = `remote:nix@example/${ID}`;
    seam.allowed = false;
    setMembership(
      new Map([
        [ref, { work: "w", title: "w", role: "planner", driver: "conductor" }],
      ]),
    );
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    expect(
      document
        .querySelector('[data-testid="peek-lock"]')
        ?.getAttribute("data-driver"),
    ).toBe("conductor");
    document
      .querySelector<HTMLButtonElement>('[data-testid="peek-take-over"]')
      ?.click();
    expect(seam.took).toEqual([ref]);
    const mayType = seam.props?.mayType as () => boolean;
    expect(mayType()).toBe(false);
    expect(
      document
        .querySelector('[data-testid="work-lock-stub"]')
        ?.getAttribute("data-pill"),
    ).toBe("false");
  });

  it("offers Hand back once the terminal is yours", () => {
    const ref = `remote:nix@example/${ID}`;
    setMembership(
      new Map([
        [ref, { work: "w", title: "w", role: "planner", driver: "you" }],
      ]),
    );
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    document
      .querySelector<HTMLButtonElement>('[data-testid="peek-hand-back"]')
      ?.click();
    expect(seam.gave).toEqual([ref]);
  });

  it("draws no lock for a terminal nobody drives", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    expect(document.querySelector('[data-testid="peek-lock"]')).toBeNull();
  });

  it("counts as typing only when the terminal has focus and the gate allows", () => {
    seam.allowed = true;
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    const onFocus = seam.props?.onFocus as (focused: boolean) => void;
    onFocus(true);
    expect(peekTyping()).toBe(true);
    expect(document.querySelector('[data-testid="peek-esc-hint"]')).toBeNull();
    onFocus(false);
    expect(peekTyping()).toBe(false);
  });

  const conductorDrives = () => {
    seam.allowed = false;
    setMembership(
      new Map([
        [
          `remote:nix@example/${ID}`,
          { work: "w", title: "w", role: "planner", driver: "conductor" },
        ],
      ]),
    );
  };

  const handOver = (focus: () => void) => {
    (seam.props?.onHandle as (h: unknown) => void)({
      focus,
      blur: () => {},
    });
  };

  const keyDown = (key: string, selector = '[data-testid="terminal-peek"]') => {
    document
      .querySelector(selector)
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
  };

  it("puts the keyboard in a driven terminal so a key reaches the gate", () => {
    conductorDrives();
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    handOver(() => {
      seam.focusCalls += 1;
    });
    expect(seam.focusCalls).toBeGreaterThanOrEqual(1);
  });

  it("leaves the keyboard where it is for a terminal you can type in", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    handOver(() => {
      seam.focusCalls += 1;
    });
    expect(seam.focusCalls).toBe(0);
  });

  it("keeps one size whatever terminal is in it", () => {
    const OTHER = "22222222-2222-4222-8222-222222222222" as TerminalId;
    const member = (role: string) => ({
      work: "w1",
      role,
      joinedAt: "2026-01-01T00:00:00.000Z",
      worktree: { kind: "unread" },
    });
    seam.members = new Map<string, unknown>([
      [`local/${ID}`, member("planner")],
      [`local/${OTHER}`, member("implementor")],
    ]);
    openPeek({ host: "local", id: ID });
    mount();
    const window = document.querySelector<HTMLElement>(
      '[data-testid="terminal-peek"]',
    );
    expect(window?.style.width).toBe("1280px");
    expect(window?.style.height).toBe("836px");
    const onGrid = seam.props?.onGrid as (g: {
      cols: number;
      rows: number;
    }) => void;
    const onCell = seam.props?.onCell as (
      c: { width: number; height: number },
      p: { x: number; y: number },
    ) => void;
    onGrid({ cols: 80, rows: 24 });
    onCell({ width: 8.4, height: 17 }, { x: 26, y: 12 });
    expect(window?.style.width).toBe("1280px");
    expect(window?.style.height).toBe("836px");
    onGrid({ cols: 212, rows: 52 });
    expect(window?.style.width).toBe("1280px");
    expect(window?.style.height).toBe("836px");
    document
      .querySelector<HTMLButtonElement>(
        `[data-testid="peek-tab"][data-ref="local/${OTHER}"]`,
      )
      ?.click();
    expect(
      document.querySelector<HTMLElement>('[data-testid="terminal-peek"]')
        ?.style.width,
    ).toBe("1280px");
    expect(
      document.querySelector<HTMLElement>('[data-testid="terminal-peek"]')
        ?.style.height,
    ).toBe("836px");
  });

  it("raises the Take over card for a key typed at a driven terminal", () => {
    conductorDrives();
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    keyDown("a");
    expect(seam.gateRefs).toContain(`remote:nix@example/${ID}`);

    const before = seam.gateRefs.length;
    keyDown("Enter", '[data-testid="peek-open-tile"]');
    expect(seam.gateRefs).toHaveLength(before);
    expect(seam.opened).toHaveLength(0);
  });

  it("raises no card for a key typed at a terminal nobody locks", () => {
    seam.allowed = true;
    setMembership(
      new Map([
        [
          `remote:nix@example/${ID}`,
          { work: "w", title: "w", role: "planner", driver: "you" },
        ],
      ]),
    );
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    keyDown("a");
    expect(seam.gateRefs).toHaveLength(0);
  });

  it("tells the dialog to leave Esc alone only while the terminal holds the keyboard", () => {
    seam.allowed = true;
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    const dialog = () =>
      document.querySelector("[data-escape-closes]") as HTMLElement;
    expect(dialog().getAttribute("data-escape-closes")).toBe("true");
    const onFocus = seam.props?.onFocus as (focused: boolean) => void;
    onFocus(true);
    expect(dialog().getAttribute("data-escape-closes")).toBe("false");
  });
});
