/**
 * padi's repo-change LEASE — the host-owned reference that makes a repo's
 * watcher outlive a browser pane's focus (juspay/kolu#2286).
 *
 * Driven through the REAL registry write seams (`installSnapshot`,
 * `commitSnapshot`, `publishTerminalState`, `dropSnapshot`) rather than by
 * calling `syncRepoWatchLease` directly: the thing that can regress is a seam
 * forgetting to reconcile, and a test that calls the reconciler itself would pass
 * through that regression. The endpoint's fs face is mocked to a hold/release
 * tally, so this file asserts padi's reference arithmetic only — kolu-git's own
 * `repo-change.test.ts` owns the install / grace / retire behaviour underneath.
 */

import type { GitFact, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The mocked local endpoint — every `holdRepoChange` and its release lands in
 *  one ordered tally, so a test reads padi's references as a sequence. */
const endpoint = vi.hoisted(() => {
  const state = { holds: [] as string[], releases: [] as string[] };
  return {
    state,
    create: () => ({
      fs: {
        holdRepoChange: (repoPath: string) => {
          state.holds.push(repoPath);
          return () => {
            state.releases.push(repoPath);
          };
        },
      },
      git: {},
    }),
  };
});

vi.mock("./terminalWorkspace/endpoint.ts", () => ({
  createTerminalWorkspaceEndpoint: endpoint.create,
}));

import {
  AuthoredSleepingSchema,
  type AuthoredSleepingTerminal,
  LOCAL_LOCATION,
} from "@kolu/padi-client/surface";
import { Schema } from "effect";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
import { _repoWatchLeases } from "./repoWatchLease.ts";
import {
  type ActiveTerminalProcess,
  registerTerminal,
  unregisterTerminal,
} from "./terminal-registry.ts";
import {
  commitSnapshot,
  dropSnapshot,
  installSnapshot,
  publishTerminalState,
} from "./terminalEndpoint/metadata.ts";

const ID = "term-repo-lease";

const inRepo = (repoRoot: string): GitFact => ({
  kind: "repo",
  info: {
    repoRoot,
    repoName: repoRoot.split("/").at(-1) ?? repoRoot,
    worktreePath: repoRoot,
    branch: "main",
    isWorktree: false,
    mainRepoRoot: repoRoot,
    remoteUrl: null,
  },
});

function snapshot(git: GitFact): TerminalSnapshot {
  return {
    cwd: git.kind === "repo" ? git.info.repoRoot : "/tmp",
    git,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
  };
}

function activeEntry(git: GitFact): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 4242 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
    },
    snapshot: snapshot(git),
    // The lease path never touches the PTY; `handle` is only the active-arm tag.
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

const sleepingMeta: AuthoredSleepingTerminal = Schema.decodeUnknownSync(
  AuthoredSleepingSchema,
)({
  state: "sleeping",
  location: LOCAL_LOCATION,
  lastActivityAt: 7,
  sleptAt: 111,
});

beforeEach(() => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  endpoint.state.holds.length = 0;
  endpoint.state.releases.length = 0;
});

afterEach(() => {
  unregisterTerminal(ID);
  dropSnapshot(ID);
  __resetPadiSurfaceCtxForTest();
});

describe("padi repo-change leases", () => {
  it("takes a hold when the git sensor resolves a repo, and holds it across the snapshot firehose", () => {
    registerTerminal(ID, activeEntry({ kind: "unresolved" }));
    installSnapshot(ID);
    expect(endpoint.state.holds).toEqual([]);

    commitSnapshot(ID, snapshot(inRepo("/work/alpha")));
    expect(endpoint.state.holds).toEqual(["/work/alpha"]);
    expect(_repoWatchLeases().get(ID)).toBe("/work/alpha");

    // The ~150ms observation firehose re-commits the same repo root constantly;
    // none of that may churn the reference.
    for (let i = 0; i < 50; i += 1) {
      commitSnapshot(ID, snapshot(inRepo("/work/alpha")));
    }
    expect(endpoint.state.holds).toEqual(["/work/alpha"]);
    expect(endpoint.state.releases).toEqual([]);
  });

  it("a cwd that moves OUT of the repo releases the hold", () => {
    registerTerminal(ID, activeEntry(inRepo("/work/alpha")));
    installSnapshot(ID);
    expect(endpoint.state.holds).toEqual(["/work/alpha"]);

    commitSnapshot(ID, snapshot({ kind: "none" }));
    expect(endpoint.state.releases).toEqual(["/work/alpha"]);
    expect(_repoWatchLeases().has(ID)).toBe(false);
  });

  it("a cwd that moves to ANOTHER repo swaps the hold", () => {
    registerTerminal(ID, activeEntry(inRepo("/work/alpha")));
    installSnapshot(ID);

    commitSnapshot(ID, snapshot(inRepo("/work/beta")));
    expect(endpoint.state.releases).toEqual(["/work/alpha"]);
    expect(endpoint.state.holds).toEqual(["/work/alpha", "/work/beta"]);
    expect(_repoWatchLeases().get(ID)).toBe("/work/beta");
  });

  it("a cold-restored entry whose snapshot already names a repo holds at install", () => {
    // The persisted snapshot carries a resolved git fact, so waiting for the
    // first sensor commit would leave the repo unheld indefinitely.
    registerTerminal(ID, activeEntry(inRepo("/work/restored")));
    installSnapshot(ID);
    expect(endpoint.state.holds).toEqual(["/work/restored"]);
  });

  it("removal releases the hold", () => {
    registerTerminal(ID, activeEntry(inRepo("/work/alpha")));
    installSnapshot(ID);

    // The removal order every padi removal path uses: drop the entry, then fan
    // the removal out.
    unregisterTerminal(ID);
    dropSnapshot(ID);
    expect(endpoint.state.releases).toEqual(["/work/alpha"]);
    expect(_repoWatchLeases().has(ID)).toBe(false);
  });

  it("sleep releases the hold and wake re-takes it", () => {
    registerTerminal(ID, activeEntry(inRepo("/work/alpha")));
    installSnapshot(ID);
    expect(endpoint.state.holds).toEqual(["/work/alpha"]);

    // Sleep REPLACES the entry with the sleeping arm (no handle, snapshot kept)
    // and publishes the flip.
    const active = activeEntry(inRepo("/work/alpha"));
    registerTerminal(ID, {
      info: active.info,
      meta: sleepingMeta,
      snapshot: active.snapshot,
    });
    publishTerminalState(ID);
    expect(endpoint.state.releases).toEqual(["/work/alpha"]);

    registerTerminal(ID, active);
    publishTerminalState(ID);
    expect(endpoint.state.holds).toEqual(["/work/alpha", "/work/alpha"]);
    expect(_repoWatchLeases().get(ID)).toBe("/work/alpha");
  });
});
