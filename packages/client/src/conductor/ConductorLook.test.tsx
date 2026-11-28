// @vitest-environment happy-dom
import type { TerminalId } from "kolu-common/surface";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;

const peek = vi.hoisted(() => ({ opened: [] as unknown[] }));

const [standing, setStanding] = createSignal<FleetTerminalStanding>({
  kind: "gone",
});

vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => standing(),
}));
vi.mock("../settings/useTips", () => ({
  useTips: () => ({ showTipOnce: () => {} }),
}));
vi.mock("./peek/usePeek", () => ({
  openPeek: (t: unknown) => peek.opened.push(t),
}));

import ConductorLook from "./ConductorLook";
import { Shown } from "../ui/shown";

const working = (
  agent: Record<string, unknown> = {},
): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: "writing the plan",
      taskProgress: null,
      ...agent,
    },
  } as never,
});

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

const [shown, setShown] = createSignal(true);

function mount(): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <Shown value={shown}>
        <ConductorLook host="remote:nix@example" id={TERMINAL} />
      </Shown>
    ),
    root,
  );
  return root;
}

function unmount(): void {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
}

const toggle = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('[data-testid="conductor-look-toggle"]');

beforeEach(() => {
  setShown(true);
  peek.opened = [];
  setStanding(working());
});

afterEach(() => {
  unmount();
});

describe("an agent line", () => {
  it("says the agent's state and what it is doing", () => {
    const el = mount();
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("Thinking · writing the plan");
    expect(toggle(el)?.textContent).toBe("Look");
  });

  it("says how far through its own task list the agent is, when it keeps one", () => {
    setStanding(working({ taskProgress: { completed: 7, total: 12 } }));
    const el = mount();
    expect(
      el.querySelector('[data-testid="conductor-look-progress"]')?.textContent,
    ).toBe("7/12");
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("Thinking · 7/12 · writing the plan");
  });

  it("says nothing about tasks for an agent that keeps no list", () => {
    const el = mount();
    expect(el.querySelector('[data-testid="conductor-look-progress"]')).toBe(
      null,
    );
  });

  it("offers no Look on a sleeping terminal — there is no live screen to show", () => {
    setStanding({ kind: "here", meta: { state: "sleeping" } as never });
    const el = mount();
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("asleep");
    expect(toggle(el)).toBeNull();
  });

  it("reads an agent that is only PRESENT off the record, quietly", () => {
    setStanding(working({ state: "starting", summary: null }));
    const el = mount();
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("Starting");
    const dot = el.querySelector('[data-testid="conductor-look"] span');
    expect(dot?.className).toContain("bg-fg-3");
    expect(dot?.className).not.toContain("animate-pulse");

    unmount();
    setStanding(working({ state: "fresh", summary: null }));
    const ready = mount();
    expect(
      ready.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("Ready");
    expect(
      ready.querySelector('[data-testid="conductor-look"] span')?.className,
    ).toContain("bg-fg-3");
  });

  it("still says 'no agent' for a program that is none of ours, and for the shell", () => {
    setStanding({
      kind: "here",
      meta: {
        state: "active",
        agent: null,
        foreground: { name: "vim", title: null, shell: false },
      } as never,
    });
    const el = mount();
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("no agent · vim");

    unmount();
    setStanding({
      kind: "here",
      meta: {
        state: "active",
        agent: null,
        foreground: { name: "bash", title: null, shell: true },
      } as never,
    });
    const shell = mount();
    expect(
      shell.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("no agent · at the shell");
  });

  it("says 'terminal gone' for a terminal the roster no longer has, and offers nothing", () => {
    const el = mount();
    setStanding({ kind: "gone" });
    flush();
    expect(
      el.querySelector('[data-testid="conductor-look-status"]')?.textContent,
    ).toBe("terminal gone");
    expect(toggle(el)).toBeNull();
  });

  it("opens the peek on that terminal's host and id", () => {
    const el = mount();
    toggle(el)?.click();
    expect(peek.opened).toEqual([{ host: "remote:nix@example", id: TERMINAL }]);
  });
});
