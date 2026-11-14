/**
 * WHAT A WATCHED TERMINAL IS CALLED — the ladder, rung by rung, and the one
 * thing no rung may ever produce: a bare terminal id.
 *
 * The defect this module exists for is a row that read
 * `fcb131f3-67a9-4d1a-bf2e-261b557c4b6b`, because the `@` menu's index holds
 * tiles and that terminal was a split. So the cases below are mostly "the
 * fleet has no name for it" — and the last assertion of nearly every one is
 * that the words are not the uuid.
 */

import {
  type ActiveTerminal,
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import {
  shortWatchedRef,
  watchedGroupName,
  watchedName,
  type WatchedNaming,
} from "./watchedName";

const ID = "fcb131f3-67a9-4d1a-bf2e-261b557c4b6b";
const REF = `local/${ID}`;
const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_REF = `local/${PARENT_ID}`;

function meta(overrides: Partial<ActiveTerminal> = {}): TerminalMetadata {
  return {
    state: "active",
    cwd: "/home/srid/code/kolu",
    git: { kind: "none" },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: null,
    promptedAt: null,
    ...overrides,
  } as TerminalMetadata;
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    kind: "claude-code",
    state: "thinking",
    sessionId: "s1",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
    ...overrides,
  } as ActiveTerminal["agent"];
}

/** A terminal INSIDE a repo, on `branch` — the rung the dock's tile rows
 *  carry, and the one a split falls to when nothing else names it. */
function inRepo(branch: string): ActiveTerminal["git"] {
  return {
    kind: "repo",
    info: {
      repoName: "kolu",
      branch,
      repoRoot: "/home/srid/code/kolu",
      mainRepoRoot: "/home/srid/code/kolu",
      worktreePath: "/home/srid/code/kolu",
      isWorktree: false,
      remoteUrl: null,
    },
  };
}

/** The two lookups the panel supplies, as plain tables. */
function naming(over: {
  fleet?: Record<string, string>;
  records?: Record<string, TerminalMetadata>;
}): WatchedNaming {
  return {
    fleetName: (ref) => over.fleet?.[ref],
    metaOf: (ref) => over.records?.[ref],
  };
}

describe("what a watched terminal is called", () => {
  it("takes the `@` menu's name first, so the panel and the composer agree", () => {
    const words = watchedName(
      REF,
      naming({
        fleet: { [REF]: "kolu (fix-parser)" },
        // ...even over an intent, which a tile also has: the menu's name is
        // what a person would TYPE to mean this terminal.
        records: { [REF]: meta({ intent: "rewrite the parser" }) },
      }),
    );
    expect(words).toBe("kolu (fix-parser)");
  });

  it("falls to the terminal's own intent, line one", () => {
    const words = watchedName(
      REF,
      naming({
        records: {
          [REF]: meta({ intent: "rewrite the parser\nthen the printer" }),
        },
      }),
    );
    expect(words).toBe("rewrite the parser");
  });

  it("falls to the agent's own title when nobody set an intent", () => {
    const words = watchedName(
      REF,
      naming({
        records: {
          [REF]: meta({ agent: agent({ summary: "writing the plan" }) }),
        },
      }),
    );
    expect(words).toBe("writing the plan");
  });

  it("names an untitled split by its agent and who it is a split of", () => {
    const words = watchedName(
      REF,
      naming({
        fleet: { [PARENT_REF]: "paths-kept-by" },
        records: {
          [REF]: meta({ parentId: PARENT_ID, agent: agent() }),
        },
      }),
    );
    expect(words).toBe("Claude Code · split of paths-kept-by");
    expect(words).not.toContain(ID);
  });

  it("names the parent by this same ladder, and never nests the phrase", () => {
    // The parent is itself an unnamed split with an agent in it: it is named
    // by its own next rung (where it is) rather than by a second "split of",
    // which is what keeps the phrase readable and the recursion bounded.
    const words = watchedName(
      REF,
      naming({
        records: {
          [REF]: meta({ parentId: PARENT_ID, agent: agent() }),
          [PARENT_REF]: meta({
            parentId: "22222222-2222-4222-8222-222222222222",
            agent: agent(),
            git: inRepo("conductor-never-blocks"),
          }),
        },
      }),
    );
    expect(words).toBe("Claude Code · split of conductor-never-blocks");
  });

  it("does not spin on records that name each other as parents", () => {
    const words = watchedName(
      REF,
      naming({
        records: {
          [REF]: meta({ parentId: PARENT_ID, agent: agent() }),
          [PARENT_REF]: meta({ parentId: ID, agent: agent() }),
        },
      }),
    );
    // The parent is named by where it is — the ladder below the phrase — so
    // the cycle is never walked a second time.
    expect(words).toBe("Claude Code · split of kolu");
  });

  it("falls to the branch inside a repo", () => {
    const words = watchedName(
      REF,
      naming({
        records: { [REF]: meta({ git: inRepo("fix-parser") }) },
      }),
    );
    expect(words).toBe("fix-parser");
  });

  it("falls to the directory the dock would name it by, outside a repo", () => {
    const words = watchedName(
      REF,
      naming({ records: { [REF]: meta({ cwd: "/home/srid/scratch/odu" }) } }),
    );
    expect(words).toBe("odu");
  });

  it("takes the short id only when nothing can be read at all", () => {
    // A host that is away, or a terminal that is gone: there is no record to
    // read a name off, and the Conductor is still watching it.
    const words = watchedName(REF, naming({}));
    expect(words).toBe("fcb131f3");
    expect(words).not.toBe(ID);
    expect(ID).toContain(words);
  });

  it("says a ref it cannot parse back as it was written", () => {
    expect(shortWatchedRef("nonsense")).toBe("nonsense");
    expect(watchedName("nonsense", naming({}))).toBe("nonsense");
  });

  it("heads a group by the same words its root's row carries", () => {
    const source = naming({
      records: {
        [REF]: meta({ agent: agent({ summary: "writing the plan" }) }),
      },
    });
    expect(watchedGroupName({ root: REF, name: "stale-name" }, source)).toBe(
      watchedName(REF, source),
    );
  });

  it("heads an unreadable group by the name the server last read", () => {
    // Nothing live to read — and the server's own reading beats eight
    // characters of hex, which is where a heading differs from a row.
    expect(
      watchedGroupName({ root: REF, name: "paths-kept-by" }, naming({})),
    ).toBe("paths-kept-by");
    expect(watchedGroupName({ root: REF, name: "" }, naming({}))).toBe(
      "fcb131f3",
    );
  });
});
