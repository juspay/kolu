// @vitest-environment happy-dom
/**
 * The title-bar tip, mounted against mocked app state. It renders the fold's
 * answer and nothing else:
 *  - a tip shows whenever its state holds and the tile can be seen, and goes
 *    the moment either stops — another tile active, off-screen, a slot too
 *    narrow, a command in front;
 *  - it comes back every time it is earned again (nothing is remembered);
 *  - git not yet resolved is not "not a repo": no rung-1 flash before rung 2;
 *  - ambient tips off, or a sleeping terminal: no tip;
 *  - there is no dismiss button.
 */

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

const [width, setWidth] = createSignal<number | null>(400);
const [onScreen, setOnScreen] = createSignal(true);

let dispose: (() => void) | undefined;
function mount() {
  dispose?.();
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => <TileTip id={"t-1" as never} slot={{ px: width, onScreen }} />,
    root,
  );
}
const tip = () => document.querySelector('[data-testid="tile-tip"]');

beforeEach(() => {
  state.setTipsOn(true);
  state.setActiveId("t-1");
  state.setMeta(active());
  setWidth(400);
  setOnScreen(true);
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

  it("has no dismiss button", () => {
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

  it("the hover and the label carry the full sentence", () => {
    mount();
    expect(tip()?.textContent).toContain("Launch claude or agent-distro");
    expect(tip()?.getAttribute("aria-label")).toBe(
      "Launch an agent: claude, or agent-distro to pick one",
    );
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
    ["the slot too narrow", () => setWidth(100), () => setWidth(400)],
    ["the slot not measured yet", () => setWidth(null), () => setWidth(400)],
    ["off-screen", () => setOnScreen(false), () => setOnScreen(true)],
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
