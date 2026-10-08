// @vitest-environment happy-dom
/**
 * The title-bar tip, mounted against mocked app state:
 *  - a tip shows on the first render whose answer is a tip, and is marked seen
 *    then;
 *  - × hides it, and it stays gone (it is seen) — also after a remount;
 *  - nothing is shown OR marked while the user could not see it: ambient tips
 *    off, another tile active, a title bar too narrow, the saved seen-list not
 *    yet arrived — and each shows the tip once its fact turns;
 *  - git not yet resolved is not "not a repo": no rung-1 flash before rung 2;
 *  - a sleeping terminal has no tip;
 *  - a tip leaves when its fact changes.
 */

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  // Filled in below, once solid-js is importable.
  seen: undefined as unknown as () => string[],
  setSeen: undefined as unknown as (v: string[]) => void,
  loaded: undefined as unknown as () => boolean,
  setLoaded: undefined as unknown as (v: boolean) => void,
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
vi.mock("../settings/useTips", () => ({
  useTips: () => ({
    hasSeen: (id: string) => state.seen().includes(id),
    markSeen: (id: string) => {
      if (!state.loaded()) throw new Error("markSeen before preferences");
      if (!state.seen().includes(id)) state.setSeen([...state.seen(), id]);
    },
    seenTipsLoaded: () => state.loaded(),
  }),
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
  const [seen, setSeen] = createSignal<string[]>([]);
  const [loaded, setLoaded] = createSignal(true);
  const [tipsOn, setTipsOn] = createSignal(true);
  const [meta, setMeta] = createSignal<unknown>(undefined);
  const [activeId, setActiveId] = createSignal<string | null>("t-1");
  Object.assign(state, {
    seen,
    setSeen,
    loaded,
    setLoaded,
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

const [width, setWidth] = createSignal<number | null>(800);

let dispose: (() => void) | undefined;
function mount() {
  dispose?.();
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => <TileTip id={"t-1" as never} titleBarPx={width} />,
    root,
  );
}
const tip = () => document.querySelector('[data-testid="tile-tip"]');

beforeEach(() => {
  state.setSeen([]);
  state.setLoaded(true);
  state.setTipsOn(true);
  state.setActiveId("t-1");
  state.setMeta(active());
  setWidth(800);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

describe("TileTip", () => {
  it("shows on its first render and is marked seen then", () => {
    state.setMeta(active({ git: NO_REPO }));
    mount();
    expect(tip()?.getAttribute("data-tip-id")).toBe("tip-cd-repo");
    expect(tip()?.getAttribute("role")).toBe("status");
    expect(tip()?.textContent).toContain("into a git repo");
    expect(state.seen()).toEqual(["tip-cd-repo"]);
  });

  it("× hides it, and it stays gone — across a remount too", () => {
    mount();
    expect(tip()).not.toBeNull();
    document
      .querySelector<HTMLButtonElement>('[data-testid="tile-tip-dismiss"]')
      ?.click();
    expect(tip()).toBeNull();
    expect(state.seen()).toEqual(["tip-launch-agent"]);
    mount();
    expect(tip()).toBeNull();
  });

  it("leaves when its fact changes: an agent starts", () => {
    mount();
    expect(tip()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
    state.setMeta(
      active({ agent: { kind: "claude-code", state: "thinking" } }),
    );
    expect(tip()).toBeNull();
  });

  it("rung 3 at an agent's first prompt names the plugin skill", () => {
    state.setMeta(active({ agent: { kind: "claude-code", state: "waiting" } }));
    mount();
    expect(tip()?.getAttribute("data-tip-id")).toBe("tip-skill:claude-code");
    expect(tip()?.textContent).toContain("/kolu");
  });

  it("git not resolved yet shows nothing — then the repo's rung, never rung 1", () => {
    state.setMeta(active({ git: { kind: "unresolved" } }));
    mount();
    expect(tip()).toBeNull();
    state.setMeta(active({ git: REPO }));
    expect(tip()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
    expect(state.seen()).toEqual(["tip-launch-agent"]);
  });

  it("another tile active: nothing shown or marked — until this one is", () => {
    state.setActiveId("t-2");
    mount();
    expect(tip()).toBeNull();
    expect(state.seen()).toEqual([]);
    state.setActiveId("t-1");
    expect(tip()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
  });

  it("a title bar too narrow: nothing shown or marked — until it widens", () => {
    setWidth(500);
    mount();
    expect(tip()).toBeNull();
    expect(state.seen()).toEqual([]);
    setWidth(800);
    expect(tip()?.getAttribute("data-tip-id")).toBe("tip-launch-agent");
  });

  it("before the saved seen-list arrives: nothing shown or marked", () => {
    // Already seen on the server — the empty default must not show it again,
    // nor overwrite the list by marking.
    state.setLoaded(false);
    mount();
    expect(tip()).toBeNull();
    state.setSeen(["tip-launch-agent"]);
    state.setLoaded(true);
    expect(tip()).toBeNull();
    expect(state.seen()).toEqual(["tip-launch-agent"]);
  });

  it("with the ambient tips off: nothing renders, nothing is marked", () => {
    state.setTipsOn(false);
    mount();
    expect(tip()).toBeNull();
    expect(state.seen()).toEqual([]);
  });

  it("a sleeping terminal has no tip", () => {
    state.setMeta({ state: "sleeping", git: NO_REPO, sleptAt: 1 });
    mount();
    expect(tip()).toBeNull();
    expect(state.seen()).toEqual([]);
  });
});
