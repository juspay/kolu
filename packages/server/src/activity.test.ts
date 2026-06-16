/**
 * Activity feed — recent-repos pruning + host-aware MRU dedup.
 *
 * `surfaceCtx` is mocked with a REAL in-memory `activityFeed` cell so the
 * upsert/prune logic round-trips through a live store (the production wiring
 * is a single cell get/set). `log` is a no-op. The `existsOnDisk` prune is
 * exercised with real paths: a never-created tmp path for the missing-local
 * case, the actual `os.tmpdir()` for the present-local case.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityFeed } from "kolu-common/surface";

const cell = vi.hoisted(() => {
  let value: ActivityFeed = { recentRepos: [], recentAgents: [] };
  return {
    activityFeed: {
      get: () => value,
      set: (next: ActivityFeed) => {
        value = next;
      },
    },
    reset: () => {
      value = { recentRepos: [], recentAgents: [] };
    },
  };
});

vi.mock("./surfaceCtx.ts", () => ({
  surfaceCtx: { cells: { activityFeed: cell.activityFeed } },
}));
vi.mock("./log.ts", () => ({ log: { info: vi.fn() } }));

import { getActivityFeed, trackRecentRepo } from "./activity.ts";

/** A path guaranteed NOT to exist on the local fs. */
const MISSING_LOCAL = path.join(
  os.tmpdir(),
  `kolu-activity-test-missing-${process.pid}`,
);
/** A path guaranteed to exist on the local fs. */
const PRESENT_LOCAL = os.tmpdir();

beforeEach(() => {
  cell.reset();
  // Make sure the "missing" path really doesn't exist.
  expect(fs.existsSync(MISSING_LOCAL)).toBe(false);
  expect(fs.existsSync(PRESENT_LOCAL)).toBe(true);
});

describe("getActivityFeed — recent-repos pruning", () => {
  it("does NOT prune a remote entry whose path is absent from the local fs", () => {
    // A remote repo: its `repoRoot` lives on the remote host, so it is NOT on
    // THIS machine's disk — but it must survive the prune because `hostId` is set.
    trackRecentRepo(MISSING_LOCAL, "kolu", "prod");
    const repos = getActivityFeed().recentRepos;
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ repoRoot: MISSING_LOCAL, hostId: "prod" });
  });

  it("prunes a LOCAL entry whose path is absent from the local fs", () => {
    trackRecentRepo(MISSING_LOCAL, "gone"); // hostId undefined ⇒ local
    expect(getActivityFeed().recentRepos).toHaveLength(0);
  });

  it("keeps a LOCAL entry whose path is present on the local fs", () => {
    trackRecentRepo(PRESENT_LOCAL, "here");
    expect(getActivityFeed().recentRepos).toHaveLength(1);
  });
});

describe("trackRecentRepo — host-aware MRU dedup", () => {
  it("stores a remote entry DISTINCTLY from a same-path local entry", () => {
    // Same `repoRoot`, different host: local (undefined) vs remote ("prod").
    // The MRU key folds in `hostId`, so these must NOT collapse onto each other.
    trackRecentRepo(PRESENT_LOCAL, "kolu"); // local
    trackRecentRepo(PRESENT_LOCAL, "kolu", "prod"); // remote, same path

    // Both survive the prune (the local one's path exists; the remote one is
    // exempt) and remain two separate entries.
    const repos = getActivityFeed().recentRepos;
    expect(repos).toHaveLength(2);
    expect(repos.filter((r) => r.hostId === undefined)).toHaveLength(1);
    expect(repos.filter((r) => r.hostId === "prod")).toHaveLength(1);
  });

  it("dedups two entries with the same path AND same host", () => {
    trackRecentRepo(PRESENT_LOCAL, "kolu", "prod");
    trackRecentRepo(PRESENT_LOCAL, "kolu", "prod");
    expect(getActivityFeed().recentRepos).toHaveLength(1);
  });
});
