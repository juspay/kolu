import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  type TerminalTipFacts,
  TIP_MIN_CELL_PX,
  TIP_MIN_CELLS,
  terminalTip,
} from "./terminalTip";

const KOLU = {
  name: "kolu",
  blurb: "drive one AI agent from another through kolu's terminals",
};

const LISTING: TerminalTipFacts["listing"] = {
  kind: "available",
  profiles: [
    {
      name: "vanilla",
      description: "Upstream harnesses",
      harnesses: [
        { name: "claude", title: "Claude Code", version: "2.1.292" },
        { name: "codex", title: "Codex", version: "0.112.0" },
      ],
    },
  ],
};

const AGENTS = { profile: "vanilla", bundle: "/nix/store/abc-vanilla" };
const REPO: TerminalTipFacts["git"] = {
  kind: "repo",
  info: {
    repoRoot: "/src/kolu",
    repoName: "kolu",
    worktreePath: "/src/kolu",
    branch: "master",
    isWorktree: false,
    mainRepoRoot: "/src/kolu",
    remoteUrl: null,
  },
};
const NO_REPO: TerminalTipFacts["git"] = { kind: "none" };
const SHELL: TerminalTipFacts["foreground"] = {
  name: "zsh",
  title: null,
  shell: true,
};
const PLACE: TerminalTipFacts["place"] = {
  active: true,
  onScreen: true,
  cellPx: 17,
  findOpen: false,
  promptCells: 60,
  cornerCells: 85,
};

const agent = (
  kind: AgentInfo["kind"],
  state: AgentInfo["state"],
): TerminalTipFacts["agent"] => ({ kind, state });

const facts = (over: Partial<TerminalTipFacts> = {}): TerminalTipFacts => ({
  place: PLACE,
  git: REPO,
  foreground: SHELL,
  agent: null,
  promptedAt: null,
  agents: AGENTS,
  listing: LISTING,
  skills: [KOLU],
  ...over,
});

/** The tip's id, text and anchor, or `quiet: <why>`. */
function show(f: TerminalTipFacts) {
  const t = terminalTip(f);
  switch (t.kind) {
    case "tip":
      return { id: t.id, text: t.text, anchor: t.anchor };
    case "quiet":
      return { quiet: t.why };
  }
}

describe("terminalTip — the rungs", () => {
  it("rung 1: a shell outside a repo is told to cd into one", () => {
    expect(show(facts({ git: NO_REPO }))).toEqual({
      id: "tip-cd-repo",
      text: "Start in a project: cd into a git repo",
      anchor: "prompt",
    });
  });

  it("rung 1 shows with no agents too", () => {
    expect(show(facts({ git: NO_REPO, agents: undefined }))).toMatchObject({
      id: "tip-cd-repo",
    });
  });

  it("rung 2: a shell in a repo with agents is told the first harness", () => {
    expect(show(facts())).toEqual({
      id: "tip-launch-agent",
      text: "Launch an agent: claude, or agent-distro to pick one",
      anchor: "prompt",
    });
  });

  it("rung 3, Claude Code: the skill as a slash command, top-right", () => {
    expect(show(facts({ agent: agent("claude-code", "waiting") }))).toEqual({
      id: "tip-skill:claude-code",
      text: "Try a skill: type /kolu at the prompt — drive one AI agent from another through kolu's terminals",
      anchor: "top-right",
    });
  });

  it("rung 3, any other agent: the skill asked for in words", () => {
    expect(show(facts({ agent: agent("codex", "waiting") }))).toEqual({
      id: "tip-skill:codex",
      text: "Try a skill: ask the agent to use the kolu skill — drive one AI agent from another through kolu's terminals",
      anchor: "top-right",
    });
  });
});

describe("terminalTip — quiet while nobody could see it", () => {
  const at = (place: Partial<TerminalTipFacts["place"]>) =>
    show(facts({ place: { ...PLACE, ...place } }));

  it("on every tile but the active one", () => {
    expect(at({ active: false })).toEqual({ quiet: "not the active tile" });
  });

  it("on a tile off-screen", () => {
    expect(at({ onScreen: false })).toEqual({ quiet: "off-screen" });
  });

  it("when the text is too small to read (zoomed out), and before the grid is measured", () => {
    expect(at({ cellPx: TIP_MIN_CELL_PX - 0.5 })).toEqual({
      quiet: "text too small to read",
    });
    expect(at({ cellPx: TIP_MIN_CELL_PX })).toMatchObject({
      id: "tip-launch-agent",
    });
    expect(at({ cellPx: null })).toEqual({
      quiet: "terminal not measured yet",
    });
  });

  it("while the find bar is open, for every rung", () => {
    expect(at({ findOpen: true })).toEqual({ quiet: "the find bar is open" });
    expect(
      show(
        facts({
          place: { ...PLACE, findOpen: true },
          agent: agent("claude-code", "waiting"),
        }),
      ),
    ).toEqual({ quiet: "the find bar is open" });
  });

  it("the state is asked first: no tip to show is quiet for that reason", () => {
    expect(
      show(
        facts({
          place: { ...PLACE, active: false },
          git: { kind: "unresolved" },
        }),
      ),
    ).toEqual({ quiet: "git not resolved yet" });
  });
});

describe("terminalTip — rungs 1 and 2 need room on the prompt line", () => {
  const at = (place: Partial<TerminalTipFacts["place"]>) =>
    show(facts({ place: { ...PLACE, ...place } }));

  it("too few empty cells right of the cursor (a long command, a right-side prompt, the cursor moved back into text)", () => {
    expect(at({ promptCells: TIP_MIN_CELLS - 1 })).toEqual({
      quiet: "no room on the prompt line",
    });
    expect(at({ promptCells: TIP_MIN_CELLS })).toMatchObject({
      id: "tip-launch-agent",
    });
  });

  it("the cursor out of view (scrolled back)", () => {
    expect(at({ promptCells: null })).toEqual({
      quiet: "the prompt line is out of view",
    });
  });

  it("rung 3 needs room in the top-right corner instead", () => {
    const at3 = (cornerCells: number | null) =>
      show(
        facts({
          place: { ...PLACE, cornerCells },
          agent: agent("claude-code", "waiting"),
        }),
      );
    expect(at3(TIP_MIN_CELLS - 1)).toEqual({
      quiet: "no room in the top-right corner",
    });
    expect(at3(null)).toEqual({ quiet: "no room in the top-right corner" });
    expect(at3(TIP_MIN_CELLS)).toMatchObject({ id: "tip-skill:claude-code" });
  });

  it("rungs 1–2 do not ask about the corner", () => {
    expect(at({ cornerCells: 0 })).toMatchObject({ id: "tip-launch-agent" });
  });

  it("rung 3 sits top-right, so the prompt line does not matter", () => {
    expect(
      show(
        facts({
          place: { ...PLACE, promptCells: null },
          agent: agent("claude-code", "waiting"),
        }),
      ),
    ).toMatchObject({ id: "tip-skill:claude-code", anchor: "top-right" });
  });
});

describe("terminalTip — the shell must be in front for rungs 1 and 2", () => {
  it("ssh or vim outside a repo hides rung 1", () => {
    for (const name of ["ssh", "vim"])
      expect(
        show(
          facts({
            git: NO_REPO,
            foreground: { name, title: null, shell: false },
          }),
        ),
      ).toEqual({ quiet: "a command is running" });
  });

  it("a running command in a repo hides rung 2", () => {
    expect(
      show(facts({ foreground: { name: "make", title: null, shell: false } })),
    ).toEqual({ quiet: "a command is running" });
  });

  it("before the foreground is first sampled", () => {
    expect(show(facts({ foreground: null }))).toEqual({
      quiet: "foreground not sampled yet",
    });
  });

  it("rung 3 does not ask about the shell", () => {
    expect(
      show(
        facts({
          agent: agent("claude-code", "waiting"),
          foreground: { name: "claude", title: null, shell: false },
        }),
      ),
    ).toMatchObject({ id: "tip-skill:claude-code", anchor: "top-right" });
  });
});

describe("terminalTip — git not resolved is not 'no repo'", () => {
  it("an unresolved git is quiet, not rung 1", () => {
    expect(show(facts({ git: { kind: "unresolved" } }))).toEqual({
      quiet: "git not resolved yet",
    });
  });
});

describe("terminalTip — broken invariants throw", () => {
  it("a listed profile with no harness", () => {
    const empty: TerminalTipFacts["listing"] = {
      kind: "available",
      profiles: [{ name: "vanilla", description: "d", harnesses: [] as never }],
    };
    expect(() => terminalTip(facts({ listing: empty }))).toThrow(/no harness/);
  });

  it("no plugin skill at an agent's first prompt", () => {
    expect(() =>
      terminalTip(
        facts({ agent: agent("claude-code", "waiting"), skills: [] }),
      ),
    ).toThrow(/no plugin skill/);
  });
});

describe("terminalTip — quiet", () => {
  it("listing pending", () => {
    expect(show(facts({ listing: undefined }))).toEqual({
      quiet: "the agents listing is pending",
    });
  });

  it("built without agents", () => {
    expect(show(facts({ listing: { kind: "unavailable" } }))).toMatchObject({
      quiet: expect.stringContaining("without agents"),
    });
  });

  it("profile unknown to the listing", () => {
    expect(
      show(facts({ agents: { profile: "juspay", bundle: "/nix/store/x" } })),
    ).toEqual({ quiet: "profile juspay is not in the listing" });
  });

  it("no agents on this terminal: rung 2 and rung 3 stay quiet", () => {
    expect(show(facts({ agents: undefined }))).toEqual({
      quiet: "no agents on this terminal",
    });
    expect(
      show(
        facts({ agents: undefined, agent: agent("claude-code", "waiting") }),
      ),
    ).toEqual({ quiet: "no agents on this terminal" });
  });

  it("an agent working, or asking you something", () => {
    for (const state of ["thinking", "tool_use", "running_background"] as const)
      expect(show(facts({ agent: agent("claude-code", state) }))).toEqual({
        quiet: "claude-code is working",
      });
    expect(
      show(facts({ agent: agent("claude-code", "awaiting_user") })),
    ).toEqual({ quiet: "claude-code is asking you something" });
  });

  it("an agent that already took its first prompt", () => {
    expect(
      show(facts({ agent: agent("claude-code", "waiting"), promptedAt: 1000 })),
    ).toEqual({ quiet: "the first prompt went out" });
  });
});
