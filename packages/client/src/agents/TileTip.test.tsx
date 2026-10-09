// @vitest-environment happy-dom
/**
 * The tile tip's bar, mounted against mocked app state. It renders the fold's
 * answer and nothing else:
 *  - each tip: its lead, chips, rest and source;
 *  - the chips are the only click targets, and type for you: each launch chip
 *    launches its own harness (name + Enter), the skill chip inserts `/kolu `
 *    with no Enter — whichever harness is in front;
 *  - the launch chips that do not fit go behind a `+N` chip whose menu launches
 *    the picked one;
 *  - the bar opens while its state holds and folds away otherwise (another
 *    tile active, a command in front, an agent at work), with a 220ms height
 *    transition that reduced motion turns off;
 *  - a press on the bar neither selects nor drags the tile;
 *  - two sizes, one preference: the bar's chevron folds it to a tab hanging
 *    from the title bar, the tab opens the bar again, and both follow the
 *    state;
 *  - tone "Tint": accent-washed surface, accent lead and left edge, a solid
 *    accent chip, a muted source;
 *  - ambient tips off, or a sleeping terminal: no tip;
 *  - the in-body overlay is gone: the terminal does not mount it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  // Filled in below, once solid-js is importable.
  tipsOn: undefined as unknown as () => boolean,
  setTipsOn: undefined as unknown as (v: boolean) => void,
  meta: undefined as unknown as () => unknown,
  setMeta: undefined as unknown as (v: unknown) => void,
  activeId: undefined as unknown as () => string | null,
  setActiveId: undefined as unknown as (v: string | null) => void,
  typed: [] as { id: string; text: string; enter: boolean }[],
  collapsed: undefined as unknown as () => boolean,
  setCollapsed: undefined as unknown as (v: boolean) => void,
}));

vi.mock("./tipBarSize", () => ({
  tipBarCollapsed: () => state.collapsed(),
  setTipBarCollapsed: (v: boolean) => state.setCollapsed(v),
}));
// The tooltip renders its trigger and keeps its words where a test can read
// them.
vi.mock("../ui/Tip", () => ({
  default: (p: { label: string; children: unknown }) => {
    const el = document.createElement("div");
    el.dataset.tooltip = p.label;
    el.append(p.children as Node);
    return el;
  },
}));

vi.mock("../capabilities", () => ({
  showsAmbientTips: () => state.tipsOn(),
}));
vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: () => state.meta(),
    activeId: () => state.activeId(),
  }),
}));
vi.mock("../terminal/useTerminalCrud", () => ({
  useTerminalCrud: () => ({
    handleTypeInto: (id: string, text: string, enter: boolean) => ({
      id,
      text,
      enter,
    }),
  }),
}));
// The send path is mocked: running an action records what it would type.
vi.mock("../runAction", () => ({
  runAction: (
    _label: string,
    a: { id: string; text: string; enter: boolean },
  ) => state.typed.push(a),
}));
const HARNESSES = vi.hoisted(() => [
  "claude",
  "codex",
  "opencode",
  "pi",
  "omp",
]);
vi.mock("./useAgentDistro", () => ({
  agentDistroListing: () => ({
    kind: "available",
    profiles: [
      {
        name: "vanilla",
        description: "Upstream harnesses",
        harnesses: HARNESSES.map((name) => ({
          name,
          title: name,
          version: "1",
        })),
      },
    ],
  }),
}));

{
  const [tipsOn, setTipsOn] = createSignal(true);
  const [meta, setMeta] = createSignal<unknown>(undefined);
  const [activeId, setActiveId] = createSignal<string | null>("t-1");
  const [collapsed, setCollapsed] = createSignal(false);
  Object.assign(state, {
    collapsed,
    setCollapsed,
    tipsOn,
    setTipsOn,
    meta,
    setMeta,
    activeId,
    setActiveId,
  });
}

const { default: TileTip } = await import("./TileTip");

const AGENTS = { profile: "vanilla", bundle: "/nix/store/abc-vanilla" };
const REPO = { kind: "repo", info: { repoName: "kolu" } };
const NO_REPO = { kind: "none" };
const SHELL = { name: "zsh", title: null, shell: true };
/** `name` in front of the shell. */
const running = (name: string) => ({ name, title: null, shell: false });
const CLAUDE_STARTED = { foreground: running("claude") };
const CLAUDE_WAITING = {
  foreground: running("claude"),
  agent: { kind: "claude-code", state: "waiting" },
};

/** A live terminal's record at the shell in a repo, only the fields the tip
 *  reads. */
function live(over: Record<string, unknown> = {}) {
  return {
    state: "active",
    git: REPO,
    foreground: SHELL,
    agent: null,
    promptedAt: null,
    agents: AGENTS,
    ...over,
  };
}

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
function mount() {
  dispose?.();
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <TileTip id={"t-1" as never} />, host);
}
const slot = () =>
  document.querySelector<HTMLElement>('[data-testid="tile-tip-slot"]');
const bar = () =>
  document.querySelector<HTMLElement>('[data-testid="tile-tip"]');
const tab = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="tile-tip-tab"]');
const collapse = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-testid="tile-tip-collapse"]',
  );
const tabOpen = () => tab()?.hasAttribute("data-open") ?? false;
const chip = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="tile-tip-chip"]');
const chips = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="tile-tip-chip"]',
    ),
  );
const isOpen = () => bar()?.hasAttribute("data-open") ?? false;

beforeEach(() => {
  state.setTipsOn(true);
  state.setActiveId("t-1");
  state.setCollapsed(false);
  state.setMeta(live());
  state.typed.length = 0;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

describe("TileTip — the bar for each rung", () => {
  it("launch an agent: one chip per harness in the listing's order, no sentence after, agent-distro with the profile as the source", () => {
    mount();
    expect(slot()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
    expect(chips().map((c) => c.textContent)).toEqual(HARNESSES);
    expect(document.querySelector('[data-testid="tile-tip-rest"]')).toBeNull();
    expect(document.querySelector('[data-testid="tile-tip-more"]')).toBeNull();
    expect(
      document
        .querySelector('[data-testid="tile-tip-source"]')
        ?.textContent?.trim(),
    ).toBe("agent-distro · vanilla");
  });

  it("try a skill: the skill chip and its sentence, and the kolu plugin as the source", () => {
    state.setMeta(live(CLAUDE_STARTED));
    mount();
    expect(slot()?.getAttribute("data-tip-id")).toBe("tip-skill:claude");
    expect(chip()?.textContent).toBe("/kolu");
    expect(
      document.querySelector('[data-testid="tile-tip-rest"]')?.textContent,
    ).toBe("— drive one AI agent from another through kolu's terminals");
    expect(
      document
        .querySelector('[data-testid="tile-tip-source"]')
        ?.textContent?.trim(),
    ).toBe("kolu plugin");
  });

  it("tone Tint: the surface washed with the accent, an accent lead and left edge, a solid accent chip, a muted source", () => {
    mount();
    const cls = bar()?.className ?? "";
    expect(cls).toContain(
      "bg-[color-mix(in_oklch,var(--color-accent)_22%,var(--color-surface-0))]",
    );
    expect(cls).toContain("text-fg");
    expect(cls).toContain("border-l-4");
    expect(cls).toContain("border-accent");
    expect(bar()?.querySelector(".font-bold")?.className).toContain(
      "text-accent",
    );
    expect(chip()?.className).toContain("bg-accent");
    expect(chip()?.className).toContain("text-surface-0");
    expect(
      document.querySelector('[data-testid="tile-tip-source"]')?.className,
    ).toContain("text-fg-3");
    expect(collapse()?.className).toContain("text-fg-3");
  });
});

describe("TileTip — the chip types for you", () => {
  it("each launch chip launches its own harness in this terminal (name + Enter)", () => {
    mount();
    expect(chips().map((c) => c.getAttribute("aria-label"))).toEqual(
      HARNESSES.map((h) => `Launch ${h}`),
    );
    for (const c of chips()) c.click();
    expect(state.typed).toEqual(
      HARNESSES.map((text) => ({ id: "t-1", text, enter: true })),
    );
  });

  it("the skill chip inserts /kolu into the agent's input, no Enter — as soon as the harness starts, before the agent is detected", () => {
    state.setMeta(live(CLAUDE_STARTED));
    mount();
    expect(chip()?.getAttribute("aria-label")).toBe(
      "Type “/kolu” into the input",
    );
    chip()?.click();
    expect(state.typed).toEqual([{ id: "t-1", text: "/kolu ", enter: false }]);
  });

  it("the same slash command in omp, pi, codex and opencode", () => {
    for (const harness of ["omp", "pi", "codex", "opencode"]) {
      state.typed.length = 0;
      state.setMeta(live({ foreground: running(harness) }));
      mount();
      expect(slot()?.getAttribute("data-tip-id")).toBe(`tip-skill:${harness}`);
      chip()?.click();
      expect(state.typed).toEqual([
        { id: "t-1", text: "/kolu ", enter: false },
      ]);
    }
  });

  it("the rest of the bar is not a click target", () => {
    state.setMeta(live(CLAUDE_STARTED));
    mount();
    // The chip, and the chevron that folds the bar.
    expect(
      Array.from(bar()?.querySelectorAll("button") ?? []).map((b) =>
        b.getAttribute("data-testid"),
      ),
    ).toEqual(["tile-tip-chip", "tile-tip-collapse"]);
    document
      .querySelector<HTMLElement>('[data-testid="tile-tip-rest"]')
      ?.click();
    bar()?.click();
    expect(state.typed).toEqual([]);
  });

  it("a press on the bar neither selects nor drags the tile", () => {
    mount();
    const seen: string[] = [];
    for (const type of ["mousedown", "pointerdown"])
      host.addEventListener(type, () => seen.push(type));
    bar()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    bar()?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(seen).toEqual([]);
  });
});

describe("TileTip — rung 2's chips that do not fit go behind +N", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Every chip 60px wide, in a 200px row: two fit beside the `+N`. */
  function narrow() {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(60);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  }

  it("keeps the whole chips that fit, then +N for the rest", () => {
    narrow();
    mount();
    expect(chips().map((c) => c.textContent)).toEqual(["claude", "codex"]);
    const more = document.querySelector('[data-testid="tile-tip-more"]');
    expect(more?.textContent).toBe("+3");
    expect(more?.getAttribute("aria-label")).toBe("3 more");
  });

  it("the +N menu lists the rest, and picking one launches it", () => {
    narrow();
    mount();
    document
      .querySelector<HTMLButtonElement>('[data-testid="tile-tip-more"]')
      ?.click();
    const menu = document.querySelector('[data-testid="tile-tip-more-menu"]');
    expect(
      Array.from(menu?.querySelectorAll("button") ?? []).map(
        (b) => b.textContent,
      ),
    ).toEqual(["opencode", "pi", "omp"]);
    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="tile-tip-more-option-pi"]',
      )
      ?.click();
    expect(state.typed).toEqual([{ id: "t-1", text: "pi", enter: true }]);
    expect(
      document.querySelector('[data-testid="tile-tip-more-menu"]'),
    ).toBeNull();
  });

  it("with room for all, there is no +N", () => {
    mount();
    expect(chips()).toHaveLength(HARNESSES.length);
    expect(document.querySelector('[data-testid="tile-tip-more"]')).toBeNull();
  });
});

describe("TileTip — pops in and out", () => {
  it("is 36px open and 0 folded, with a 220ms ease-out height transition off under reduced motion", () => {
    mount();
    expect(bar()?.style.height).toBe("36px");
    const cls = bar()?.className ?? "";
    expect(cls).toContain("transition-[height]");
    expect(cls).toContain("duration-[220ms]");
    expect(cls).toContain("ease-[cubic-bezier(.2,.8,.2,1)]");
    expect(cls).toContain("motion-reduce:transition-none");
    state.setActiveId("t-2");
    expect(isOpen()).toBe(false);
    expect(bar()?.style.height).toBe("0px");
  });

  it("keeps its words while folding, and takes no input folded", () => {
    mount();
    state.setActiveId("t-2");
    expect(chip()?.textContent).toBe("claude");
    expect(bar()?.hasAttribute("inert")).toBe(true);
    expect(slot()?.getAttribute("aria-label")).toBeNull();
  });

  it("follows the state: launching a harness turns the launch tip into the skill tip, and back at the shell", () => {
    mount();
    expect(slot()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
    state.setMeta(live(CLAUDE_STARTED));
    expect(slot()?.getAttribute("data-tip-id")).toBe("tip-skill:claude");
    state.setMeta(live(CLAUDE_WAITING));
    expect(slot()?.getAttribute("data-tip-id")).toBe("tip-skill:claude");
    state.setMeta(live());
    expect(slot()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
  });

  it("folds outside a repo (there is no cd tip)", () => {
    state.setMeta(live({ git: NO_REPO }));
    mount();
    expect(isOpen()).toBe(false);
  });

  it("folds on the first live turn", () => {
    state.setMeta(live(CLAUDE_WAITING));
    mount();
    expect(isOpen()).toBe(true);
    state.setMeta(live({ ...CLAUDE_WAITING, promptedAt: 1000 }));
    expect(isOpen()).toBe(false);
  });

  it("folds while an agent works, and opens again when it is earned again", () => {
    state.setMeta(live({ agent: CLAUDE_WAITING }));
    mount();
    expect(isOpen()).toBe(true);
    state.setMeta(
      live({
        foreground: running("claude"),
        agent: { kind: "claude-code", state: "thinking" },
      }),
    );
    expect(isOpen()).toBe(false);
    state.setMeta(live({ agent: CLAUDE_WAITING }));
    expect(isOpen()).toBe(true);
  });

  it("folds with a command in front of the shell", () => {
    mount();
    state.setMeta(
      live({ foreground: { name: "make", title: null, shell: false } }),
    );
    expect(isOpen()).toBe(false);
  });

  it("git not resolved yet stays folded — then the launch tip", () => {
    state.setMeta(live({ git: { kind: "unresolved" } }));
    mount();
    expect(isOpen()).toBe(false);
    expect(chip()).toBeNull();
    state.setMeta(live());
    expect(slot()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
  });
});

describe("TileTip — two sizes: the bar and the tab", () => {
  it("the bar's chevron folds it to the tab: the terminal gets its rows back, the tab shows the lead", () => {
    mount();
    expect(isOpen()).toBe(true);
    expect(tabOpen()).toBe(false);
    expect(tab()?.closest("[inert]")).not.toBeNull();
    collapse()?.click();
    expect(state.collapsed()).toBe(true);
    expect(isOpen()).toBe(false);
    expect(bar()?.style.height).toBe("0px");
    expect(tabOpen()).toBe(true);
    expect(tab()?.closest("[inert]")).toBeNull();
    expect(tab()?.textContent).toBe("Launch an agent");
    expect(tab()?.getAttribute("aria-label")).toBe(
      "Open the tip: Launch an agent",
    );
    expect(slot()?.getAttribute("data-size")).toBe("tab");
    // Folding typed nothing.
    expect(state.typed).toEqual([]);
  });

  it("the tab carries the whole sentence as its tooltip, and opens the bar", () => {
    state.setCollapsed(true);
    state.setMeta(live(CLAUDE_STARTED));
    mount();
    expect(tab()?.textContent).toBe("Try a skill");
    expect(tab()?.closest("[data-tooltip]")?.getAttribute("data-tooltip")).toBe(
      "Try a skill: /kolu — drive one AI agent from another through kolu's terminals",
    );
    tab()?.click();
    expect(state.collapsed()).toBe(false);
    expect(isOpen()).toBe(true);
    expect(tabOpen()).toBe(false);
    expect(state.typed).toEqual([]);
  });

  it("the tab slides down from under the title bar with the same 220ms motion", () => {
    state.setCollapsed(true);
    mount();
    expect(tab()?.style.transform).toBe("none");
    const cls = tab()?.className ?? "";
    expect(cls).toContain("duration-[220ms]");
    expect(cls).toContain("motion-reduce:transition-none");
    state.setActiveId("t-2");
    expect(tabOpen()).toBe(false);
    expect(tab()?.style.transform).toBe("translateY(-100%)");
  });

  it("the tab follows the state too: no tip, no tab", () => {
    state.setCollapsed(true);
    mount();
    expect(slot()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
    state.setMeta(live(CLAUDE_STARTED));
    expect(slot()?.getAttribute("data-tip-id")).toBe("tip-skill:claude");
    expect(tab()?.textContent).toBe("Try a skill");
    state.setMeta(live({ ...CLAUDE_WAITING, promptedAt: 1000 }));
    expect(tabOpen()).toBe(false);
    expect(isOpen()).toBe(false);
    expect(slot()?.hasAttribute("data-tip-id")).toBe(false);
  });

  it("the tab takes the same tone", () => {
    state.setCollapsed(true);
    mount();
    const cls = tab()?.className ?? "";
    expect(cls).toContain(
      "bg-[color-mix(in_oklch,var(--color-accent)_22%,var(--color-surface-0))]",
    );
    expect(cls).toContain("border-accent");
    expect(tab()?.querySelector("span")?.className).toContain("text-accent");
  });

  it("a press on the tab neither selects nor drags the tile", () => {
    state.setCollapsed(true);
    mount();
    const seen: string[] = [];
    for (const type of ["mousedown", "pointerdown"])
      host.addEventListener(type, () => seen.push(type));
    tab()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    tab()?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(seen).toEqual([]);
  });
});

describe("TileTip — where there is none", () => {
  it("with the ambient tips off", () => {
    state.setTipsOn(false);
    mount();
    expect(isOpen()).toBe(false);
    state.setCollapsed(true);
    expect(tabOpen()).toBe(false);
  });

  it("on a sleeping terminal", () => {
    state.setMeta({ state: "sleeping" });
    mount();
    expect(isOpen()).toBe(false);
  });
});

describe("TileTip — the bar is tile chrome, not part of the terminal", () => {
  const src = (rel: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), "utf8");

  it("the terminal does not mount it, and App hands it to the tile", () => {
    expect(src("../terminal/Terminal.tsx")).not.toMatch(/TileTip/);
    expect(src("../App.tsx")).toMatch(/renderTileBar=\{\(id\) => <TileTip/);
  });
});
