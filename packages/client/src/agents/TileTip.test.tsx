// @vitest-environment happy-dom
/**
 * The tip inside the terminal body, mounted against mocked app state and a
 * scripted pane view. It renders the fold's answer and nothing else:
 *  - rungs 1–2 paint on the prompt line, one cell right of the cursor; rung 3
 *    paints top-right, inset one cell;
 *  - a tip shows whenever its state holds and the tile can be seen, and goes
 *    the moment either stops — another tile active, off-screen, zoomed out too
 *    far to read, the find bar open, no room on the prompt line, a command in
 *    front;
 *  - it comes back every time it is earned again (nothing is remembered);
 *  - git not yet resolved is not "not a repo": no rung-1 flash before rung 2;
 *  - ambient tips off, or a sleeping terminal: no tip;
 *  - there is no dismiss button.
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
vi.mock("./useAgentDistro", () => ({
  agentDistroListing: () => ({
    kind: "available",
    profiles: [
      {
        name: "vanilla",
        description: "Upstream harnesses",
        harnesses: [{ name: "claude", title: "Claude Code", version: "1" }],
      },
    ],
  }),
}));

{
  const [tipsOn, setTipsOn] = createSignal(true);
  const [meta, setMeta] = createSignal<unknown>(undefined);
  const [activeId, setActiveId] = createSignal<string | null>("t-1");
  Object.assign(state, {
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

/** A live terminal's record at the shell in a repo, only the fields the tip
 *  reads. */
function active(over: Record<string, unknown> = {}) {
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

/** An 80×24 grid of 9×17px cells, drawn 4px right and 2px down in the pane,
 *  the cursor at column 10 of row 3. */
const GRID = {
  cols: 80,
  rows: 24,
  cellW: 9,
  cellH: 17,
  originX: 4,
  originY: 2,
  cursor: { col: 10, row: 3 } as { col: number; row: number } | null,
};
const [grid, setGrid] = createSignal<typeof GRID | null>(GRID);
const [onScreen, setOnScreen] = createSignal(true);
const [scale, setScale] = createSignal(1);
const [findOpen, setFindOpen] = createSignal(false);

let dispose: (() => void) | undefined;
function mount() {
  dispose?.();
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <TileTip
        id={"t-1" as never}
        view={{ grid, onScreen, scale }}
        findOpen={findOpen}
        fontFamily="monospace"
        fontSize={() => 14}
        color={() => "#969896"}
      />
    ),
    root,
  );
}
const tip = () => document.querySelector('[data-testid="tile-tip"]');

beforeEach(() => {
  state.setTipsOn(true);
  state.setActiveId("t-1");
  state.setMeta(active());
  setGrid(GRID);
  setOnScreen(true);
  setScale(1);
  setFindOpen(false);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const tipId = () => tip()?.getAttribute("data-tip-id");

describe("TileTip", () => {
  it("rung 1 shows while its state holds", () => {
    state.setMeta(active({ git: NO_REPO }));
    mount();
    expect(tipId()).toBe("tip-cd-repo");
    expect(tip()?.getAttribute("role")).toBe("status");
    expect(tip()?.textContent).toContain("into a git repo");
  });

  it("has no dismiss button and no hover", () => {
    mount();
    expect(tip()).not.toBeNull();
    expect(tip()?.querySelector("button")).toBeNull();
  });

  it("follows the state: cd into a repo turns rung 1 into rung 2, and back", () => {
    state.setMeta(active({ git: NO_REPO }));
    mount();
    expect(tipId()).toBe("tip-cd-repo");
    state.setMeta(active());
    expect(tipId()).toBe("tip-launch-agent");
    state.setMeta(active({ git: NO_REPO }));
    expect(tipId()).toBe("tip-cd-repo");
  });

  it("goes when an agent starts working, and comes back when it is earned again", () => {
    mount();
    expect(tipId()).toBe("tip-launch-agent");
    state.setMeta(
      active({ agent: { kind: "claude-code", state: "thinking" } }),
    );
    expect(tip()).toBeNull();
    state.setMeta(active());
    expect(tipId()).toBe("tip-launch-agent");
  });

  it("rung 3 at an agent's first prompt names the plugin skill", () => {
    state.setMeta(active({ agent: { kind: "claude-code", state: "waiting" } }));
    mount();
    expect(tipId()).toBe("tip-skill:claude-code");
    expect(tip()?.textContent).toContain("/kolu");
  });

  it("git not resolved yet shows nothing — then the repo's rung, never rung 1", () => {
    state.setMeta(active({ git: { kind: "unresolved" } }));
    mount();
    expect(tip()).toBeNull();
    state.setMeta(active({ git: REPO }));
    expect(tipId()).toBe("tip-launch-agent");
  });

  it("reads the whole sentence, as ghost text that takes no input", () => {
    mount();
    expect(tip()?.textContent).toBe(
      "Launch an agent: claude, or agent-distro to pick one",
    );
    const style = (tip() as HTMLElement).style;
    expect(tip()?.classList.contains("pointer-events-none")).toBe(true);
    expect(style.color).toBe("#969896");
    expect(style.fontFamily).toBe("monospace");
  });

  it("with the ambient tips off: nothing renders", () => {
    state.setTipsOn(false);
    mount();
    expect(tip()).toBeNull();
  });

  it("a sleeping terminal has no tip", () => {
    state.setMeta({ state: "sleeping", git: NO_REPO, sleptAt: 1 });
    mount();
    expect(tip()).toBeNull();
  });
});

describe("TileTip — shown only where it can be seen", () => {
  const unseeable: [string, () => void, () => void][] = [
    [
      "another tile active",
      () => state.setActiveId("t-2"),
      () => state.setActiveId("t-1"),
    ],
    ["zoomed out too far to read", () => setScale(0.4), () => setScale(1)],
    ["the grid not measured yet", () => setGrid(null), () => setGrid(GRID)],
    ["off-screen", () => setOnScreen(false), () => setOnScreen(true)],
    ["the find bar open", () => setFindOpen(true), () => setFindOpen(false)],
    [
      "no room on the prompt line",
      () => setGrid({ ...GRID, cursor: { col: 70, row: 3 } }),
      () => setGrid(GRID),
    ],
    [
      "the cursor scrolled out of view",
      () => setGrid({ ...GRID, cursor: null }),
      () => setGrid(GRID),
    ],
    [
      "a command in front of the shell",
      () =>
        state.setMeta(
          active({ foreground: { name: "ls", title: null, shell: false } }),
        ),
      () => state.setMeta(active()),
    ],
  ];
  for (const [what, hide, back] of unseeable) {
    it(`${what}: nothing on first render, then the tip once it can be seen`, () => {
      hide();
      mount();
      expect(tip()).toBeNull();
      back();
      expect(tipId()).toBe("tip-launch-agent");
    });
    it(`${what}: a shown tip goes, and comes back`, () => {
      mount();
      expect(tipId()).toBe("tip-launch-agent");
      hide();
      expect(tip()).toBeNull();
      back();
      expect(tipId()).toBe("tip-launch-agent");
    });
  }
});

describe("TileTip — where it paints", () => {
  const box = () => {
    const st = (tip() as HTMLElement).style;
    return {
      left: st.left,
      top: st.top,
      width: st.width,
      height: st.height,
      align: st.textAlign,
    };
  };

  it("rungs 1–2: on the prompt line, one cell right of the cursor, to the right edge", () => {
    mount();
    expect(tipId()).toBe("tip-launch-agent");
    expect(tip()?.getAttribute("data-tip-anchor")).toBe("prompt");
    // left = 4 + (10 + 1) × 9, top = 2 + 3 × 17, width = (80 − 11) × 9.
    expect(box()).toEqual({
      left: "103px",
      top: "53px",
      width: "621px",
      height: "17px",
      align: "left",
    });
  });

  it("follows the cursor", () => {
    mount();
    setGrid({ ...GRID, cursor: { col: 30, row: 5 } });
    expect(box()).toMatchObject({ left: "283px", top: "87px", width: "441px" });
  });

  it("rung 3: top-right, inset one cell from the top and right edges", () => {
    state.setMeta(active({ agent: { kind: "claude-code", state: "waiting" } }));
    mount();
    expect(tip()?.getAttribute("data-tip-anchor")).toBe("top-right");
    // left = 4 + 9, top = 2 + 17, width = (80 − 2) × 9: right edge one cell in.
    expect(box()).toEqual({
      left: "13px",
      top: "19px",
      width: "702px",
      height: "17px",
      align: "right",
    });
  });
});

describe("TileTip — nothing in the title bar", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  it("the title bar's files do not know the tip", () => {
    for (const f of [
      "canvas/CanvasTile.tsx",
      "canvas/TerminalCanvas.tsx",
      "canvas/TileTitleActions.tsx",
      "terminal/TerminalMeta.tsx",
      "App.tsx",
    ])
      expect(read(f), f).not.toMatch(/TileTip|tile-tip/);
  });

  it("the terminal body mounts it", () => {
    expect(read("terminal/Terminal.tsx")).toMatch(/<TileTip\b/);
  });
});
