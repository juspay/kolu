/**
 * The recent-agents MRU's WRITE rules (juspay/kolu#2326 review, should-fix 3 & 9).
 *
 * Two things the palette depends on:
 *
 *  - a row is KEYED through the live allowlist (`stableFlagTokens`), the same
 *    filter `agentLaunchLine` renders through — otherwise an allowlist narrowing
 *    leaves two rows that render the identical line;
 *  - a FLAGLESS row for a kind is a placeholder (the first sample may land before
 *    the process's argv can be read), and the first successful read SUPERSEDES it
 *    — the palette must never offer both `claude` and `claude --model sonnet`.
 */

import type { ActivityFeed } from "@kolu/padi-client/surface";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { trackRecentAgent } from "./activity.ts";

let feed: ActivityFeed;

function recordingFeed(): void {
  feed = { recentRepos: [], recentAgents: [] };
  const base = noopPadiSurfaceCtxForTest();
  setPadiSurfaceCtx({
    ...base,
    cells: new Proxy({} as never, {
      get: (_t, name) =>
        name === "activityFeed"
          ? {
              get: () => feed,
              set: (value: ActivityFeed) => {
                feed = value;
              },
              patch: () => {},
            }
          : (base.cells as Record<string, unknown>)[name as string],
    }),
  } as ReturnType<typeof noopPadiSurfaceCtxForTest>);
}

beforeEach(() => {
  __resetPadiSurfaceCtxForTest();
  recordingFeed();
});

describe("trackRecentAgent", () => {
  it("keys through the allowlist — a non-allowlisted flag never forks a row", () => {
    trackRecentAgent("claude-code", ["--model", "x", "--resume", "abc"]);
    trackRecentAgent("claude-code", ["--model", "x"]);
    expect(feed.recentAgents).toHaveLength(1);
    expect(feed.recentAgents[0]).toMatchObject({
      kind: "claude-code",
      argv: ["--model", "x"],
    });
  });

  it("supersedes a flagless placeholder when the flags arrive", () => {
    // First sample: identity resolved, argv unread → the live path stores `[]`.
    trackRecentAgent("claude-code", []);
    expect(feed.recentAgents).toEqual([
      expect.objectContaining({ kind: "claude-code", argv: [] }),
    ]);
    // Second sample: same identity, flags read. The placeholder must go.
    trackRecentAgent("claude-code", ["--model", "sonnet"], {
      replacePlaceholder: true,
    });
    expect(feed.recentAgents).toEqual([
      expect.objectContaining({
        kind: "claude-code",
        argv: ["--model", "sonnet"],
      }),
    ]);
  });

  it("keeps a deliberate bare launch beside a flagged one (no blind supersede)", () => {
    // The default is NOT to replace: a bare `claude` the user ran on purpose is
    // still a launch they may want back.
    trackRecentAgent("claude-code", []);
    trackRecentAgent("claude-code", ["--model", "opus"]);
    expect(feed.recentAgents).toHaveLength(2);
    expect(feed.recentAgents.map((r) => r.argv)).toEqual(
      expect.arrayContaining([[], ["--model", "opus"]]),
    );
  });

  it("keeps a flagless row for a DIFFERENT kind (no cross-agent supersede)", () => {
    trackRecentAgent("claude-code", []);
    trackRecentAgent("codex", ["--model", "x"], { replacePlaceholder: true });
    expect(feed.recentAgents).toHaveLength(2);
  });
});
