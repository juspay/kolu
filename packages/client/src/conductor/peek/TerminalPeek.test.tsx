// @vitest-environment happy-dom
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../../palette/fleetTerminals";
import { Shown } from "../../ui/shown";
import { closePeek, openPeek, peekTarget } from "./usePeek";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const seam = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
  members: new Map<string, unknown>(),
  opened: [] as unknown[],
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
  useMembership: () => () => new Map(),
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
    expect(seam.props?.fontSize).toBe(10.5);
  });
});
