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
    trackRecentAgent("claude-code", []);
    expect(feed.recentAgents).toEqual([
      expect.objectContaining({ kind: "claude-code", argv: [] }),
    ]);
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
