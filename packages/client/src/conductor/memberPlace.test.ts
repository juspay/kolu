/**
 * WHERE A MEMBER STANDS against its work's key — each arm, and the two easy
 * mistakes: a terminal on ANOTHER HOST in a folder of the same name, and one
 * in ANOTHER REPOSITORY on a branch of the same name. Both are elsewhere.
 */

import {
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { WorkKey } from "kolu-work";
import { describe, expect, it } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import { memberPlace, placeWords } from "./memberPlace";

const KEY: WorkKey = {
  kind: "branch",
  host: "local",
  repo: "/repo",
  branch: "solid-2-switch",
  repoBy: { kind: "git" },
};

const standingIn = (
  git: TerminalMetadata["git"],
  state: "active" | "sleeping" = "active",
): FleetTerminalStanding =>
  ({
    kind: "here",
    meta: {
      state,
      cwd: "/repo",
      git,
      location: LOCAL_LOCATION,
      pr: { kind: "absent" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
      lastActivityAt: 1,
      promptedAt: null,
    },
  }) as FleetTerminalStanding;

const repo = (
  mainRepoRoot: string,
  branch: string,
  repoName = "repo",
  state: "active" | "sleeping" = "active",
) =>
  standingIn(
    {
      kind: "repo",
      info: {
        repoRoot: `${mainRepoRoot}/.worktrees/${branch}`,
        repoName,
        worktreePath: `${mainRepoRoot}/.worktrees/${branch}`,
        branch,
        isWorktree: true,
        mainRepoRoot,
        remoteUrl: null,
        isBare: false,
      },
    },
    state,
  );

describe("where a member stands", () => {
  it("is in the worktree on the key's host, repository and branch", () => {
    expect(memberPlace(KEY, "local", repo("/repo", "solid-2-switch"))).toEqual({
      kind: "in-worktree",
    });
  });

  it("is elsewhere on another branch, and says where", () => {
    const place = memberPlace(
      KEY,
      "local",
      repo("/repo", "solid-2-migration", "kolu"),
    );
    expect(place).toEqual({
      kind: "elsewhere",
      repo: "kolu",
      branch: "solid-2-migration",
    });
    expect(placeWords(place)).toBe("elsewhere · kolu · solid-2-migration");
  });

  it("is elsewhere on another host, whatever the folder is called", () => {
    expect(
      memberPlace(KEY, "remote:box", repo("/repo", "solid-2-switch")).kind,
    ).toBe("elsewhere");
  });

  it("is elsewhere in another repository on a branch of the same name", () => {
    expect(
      memberPlace(KEY, "local", repo("/other", "solid-2-switch")).kind,
    ).toBe("elsewhere");
  });

  it("is in no repository when its record says so", () => {
    expect(memberPlace(KEY, "local", standingIn({ kind: "none" }))).toEqual({
      kind: "no-repository",
    });
  });

  it("reads a sleeping member where it slept", () => {
    const place = memberPlace(
      KEY,
      "local",
      repo("/repo", "other-branch", "kolu", "sleeping"),
    );
    expect(placeWords(place)).toBe("elsewhere · kolu · other-branch");
    expect(
      memberPlace(
        KEY,
        "local",
        repo("/repo", "solid-2-switch", "repo", "sleeping"),
      ),
    ).toEqual({ kind: "in-worktree" });
  });

  it("compares with the root git said, not the folder the key was written with", () => {
    // A HELD work keeps its old folder as `repo` and the root git said
    // apart: a member in that root's checkout is in the work's worktree.
    const held: WorkKey = {
      ...KEY,
      repo: "/repo/.worktrees/solid-2-switch",
      repoBy: { kind: "held", root: "/repo" },
    };
    expect(memberPlace(held, "local", repo("/repo", "solid-2-switch"))).toEqual(
      { kind: "in-worktree" },
    );
    // AS WRITTEN, git has said no root: on the key's branch the row cannot
    // say whether that is the work's repository; off it, it is elsewhere.
    const asWritten: WorkKey = { ...KEY, repoBy: { kind: "as-written" } };
    expect(
      memberPlace(asWritten, "local", repo("/repo", "solid-2-switch")).kind,
    ).toBe("unknown");
    expect(
      memberPlace(asWritten, "local", repo("/repo", "elsewhere-branch")).kind,
    ).toBe("elsewhere");
  });

  it("is unknown when it is not read, not here, not resolved, or the work is a watch", () => {
    expect(memberPlace(KEY, "local", undefined).kind).toBe("unknown");
    expect(memberPlace(KEY, "local", { kind: "gone" }).kind).toBe("unknown");
    expect(
      memberPlace(KEY, "local", standingIn({ kind: "unresolved" })).kind,
    ).toBe("unknown");
    expect(
      memberPlace(
        { kind: "watch", host: "local", id: "a" },
        "local",
        repo("/repo", "solid-2-switch"),
      ).kind,
    ).toBe("unknown");
  });

  it("puts words on the row only for elsewhere", () => {
    for (const place of [
      { kind: "in-worktree" },
      { kind: "no-repository" },
      { kind: "unknown" },
    ] as const)
      expect(placeWords(place)).toBeNull();
  });
});
