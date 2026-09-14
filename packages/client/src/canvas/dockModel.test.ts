import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import { metaBucket, paintBucket, workspaceSearchText } from "./dockModel";

describe("paintBucket", () => {
  it("maps absent agent to none", () => {
    expect(paintBucket(null)).toBe("none");
    expect(paintBucket(undefined)).toBe("none");
  });
});

describe("metaBucket", () => {
  it("folds a plain active shell to none", () => {
    const meta = { state: "active" } as TerminalMetadata;
    expect(metaBucket(meta)).toBe("none");
  });
});

describe("workspaceSearchText", () => {
  it("includes repo, branch, and intent in the corpus", () => {
    const text = workspaceSearchText({
      repoName: "kolu",
      label: "main",
      meta: {
        state: "active",
        intent: "FABLE ship it",
        cwd: "/home/u/kolu",
      } as TerminalMetadata,
    });
    expect(text).toContain("kolu");
    expect(text).toContain("main");
    expect(text).toContain("fable");
  });
});
