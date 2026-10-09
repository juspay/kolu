// @vitest-environment happy-dom
/**
 * The tile tip's bar, mounted against mocked app state. It renders the fold's
 * answer and nothing else:
 *  - each rung: its lead, chip, rest and source;
 *  - the chip is the one click target, and types for you: rung 1 opens the
 *    recent repos, rung 2 types the harness and presses Enter, rung 3 inserts
 *    the skill with no Enter;
 *  - the bar opens while its state holds and folds away otherwise (another
 *    tile active, a command in front, an agent at work), with a 220ms height
 *    transition that reduced motion turns off;
 *  - a press on the bar neither selects nor drags the tile;
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
  opened: [] as string[],
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
vi.mock("../useCommandPalette", () => ({
  useCommandPalette: () => ({
    openGroup: (g: string) => state.opened.push(g),
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
const { CD_REPO_GROUP } = await import("../palette/cdRepoGroup");

const AGENTS = { profile: "vanilla", bundle: "/nix/store/abc-vanilla" };
const REPO = { kind: "repo", info: { repoName: "kolu" } };
const NO_REPO = { kind: "none" };
const SHELL = { name: "zsh", title: null, shell: true };
const CLAUDE_WAITING = { kind: "claude-code", state: "waiting" };

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
const bar = () =>
  document.querySelector<HTMLElement>('[data-testid="tile-tip"]');
const chip = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="tile-tip-chip"]');
const isOpen = () => bar()?.hasAttribute("data-open") ?? false;

beforeEach(() => {
  state.setTipsOn(true);
  state.setActiveId("t-1");
  state.setMeta(live());
  state.typed.length = 0;
  state.opened.length = 0;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

describe("TileTip — the bar for each rung", () => {
  it("rung 1: lead, the cd chip, the rest, no source", () => {
    state.setMeta(live({ git: NO_REPO }));
    mount();
    expect(isOpen()).toBe(true);
    expect(bar()?.getAttribute("data-tip-id")).toBe("tip-cd-repo");
    expect(bar()?.textContent).toBe("Start in a projectcdinto a git repo");
    expect(bar()?.getAttribute("aria-label")).toBe(
      "Start in a project: cd into a git repo",
    );
    expect(
      document.querySelector('[data-testid="tile-tip-source"]'),
    ).toBeNull();
  });

  it("rung 2: the harness chip, and agent-distro with the profile as the source", () => {
    mount();
    expect(bar()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
    expect(chip()?.textContent).toBe("claude");
    expect(
      document.querySelector('[data-testid="tile-tip-rest"]')?.textContent,
    ).toBe("or agent-distro to pick one");
    expect(
      document
        .querySelector('[data-testid="tile-tip-source"]')
        ?.textContent?.trim(),
    ).toBe("agent-distro · vanilla");
  });

  it("rung 3: the skill chip, and the kolu plugin as the source", () => {
    state.setMeta(live({ agent: CLAUDE_WAITING }));
    mount();
    expect(bar()?.getAttribute("data-tip-id")).toBe("tip-skill:claude-code");
    expect(chip()?.textContent).toBe("/kolu");
    expect(
      document
        .querySelector('[data-testid="tile-tip-source"]')
        ?.textContent?.trim(),
    ).toBe("kolu plugin");
  });

  it("is the app accent with the app background as its type", () => {
    mount();
    expect(bar()?.className).toContain("bg-accent");
    expect(bar()?.className).toContain("text-surface-0");
  });
});

describe("TileTip — the chip types for you", () => {
  it("rung 1 opens the recent repos", () => {
    state.setMeta(live({ git: NO_REPO }));
    mount();
    chip()?.click();
    expect(state.opened).toEqual([CD_REPO_GROUP]);
    expect(state.typed).toEqual([]);
  });

  it("rung 2 types the harness into this terminal and presses Enter", () => {
    mount();
    expect(chip()?.getAttribute("aria-label")).toBe(
      "Type claude and press Enter",
    );
    chip()?.click();
    expect(state.typed).toEqual([{ id: "t-1", text: "claude", enter: true }]);
  });

  it("rung 3 inserts the skill into the agent's input, no Enter", () => {
    state.setMeta(live({ agent: CLAUDE_WAITING }));
    mount();
    chip()?.click();
    expect(state.typed).toEqual([{ id: "t-1", text: "/kolu ", enter: false }]);
  });

  it("the rest of the bar is not a click target", () => {
    mount();
    expect(bar()?.querySelectorAll("button")).toHaveLength(1);
    document
      .querySelector<HTMLElement>('[data-testid="tile-tip-rest"]')
      ?.click();
    bar()?.click();
    expect(state.typed).toEqual([]);
    expect(state.opened).toEqual([]);
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
    expect(bar()?.getAttribute("aria-label")).toBeNull();
  });

  it("follows the state: cd into a repo turns rung 1 into rung 2, and back", () => {
    state.setMeta(live({ git: NO_REPO }));
    mount();
    expect(bar()?.getAttribute("data-tip-id")).toBe("tip-cd-repo");
    state.setMeta(live());
    expect(bar()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
    state.setMeta(live({ git: NO_REPO }));
    expect(bar()?.getAttribute("data-tip-id")).toBe("tip-cd-repo");
  });

  it("folds while an agent works, and opens again when it is earned again", () => {
    state.setMeta(live({ agent: CLAUDE_WAITING }));
    mount();
    expect(isOpen()).toBe(true);
    state.setMeta(live({ agent: { kind: "claude-code", state: "thinking" } }));
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

  it("git not resolved yet stays folded — then the repo's rung, never rung 1", () => {
    state.setMeta(live({ git: { kind: "unresolved" } }));
    mount();
    expect(isOpen()).toBe(false);
    expect(chip()).toBeNull();
    state.setMeta(live());
    expect(bar()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
  });
});

describe("TileTip — where there is none", () => {
  it("with the ambient tips off", () => {
    state.setTipsOn(false);
    mount();
    expect(isOpen()).toBe(false);
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
