import { describe, expect, it } from "vitest";
import {
  agentBundleShortHash,
  agentDistroStatusText,
  harnessLine,
} from "./agentDistroText";

describe("agentDistroStatusText", () => {
  it("shows bytes while fetching", () => {
    expect(
      agentDistroStatusText({
        kind: "downloading",
        profile: "vanilla",
        progress: { done: 1_100_000_000, total: 2_000_000_000 },
      }),
    ).toEqual({ tone: "busy", text: "Downloading agents… 1.1 GB of 2.0 GB" });
  });

  it("says no numbers when there are none to say — including a 0-byte total", () => {
    for (const progress of [undefined, { done: 0, total: 0 }])
      expect(
        agentDistroStatusText({
          kind: "downloading",
          profile: "vanilla",
          ...(progress ? { progress } : {}),
        }),
      ).toEqual({ tone: "busy", text: "Downloading agents…" });
  });

  it("is silent for ready, off and unavailable; an error is its message", () => {
    expect(
      agentDistroStatusText({ kind: "ready", profile: "v", bundle: "/b" }),
    ).toBeUndefined();
    expect(agentDistroStatusText({ kind: "off" })).toBeUndefined();
    expect(
      agentDistroStatusText({ kind: "error", profile: "v", message: "m" }),
    ).toEqual({ tone: "error", text: "m" });
  });
});

describe("agentBundleShortHash", () => {
  it("is the first 8 characters of the store hash", () => {
    expect(
      agentBundleShortHash(
        "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla",
      ),
    ).toBe("nd11nx5f");
  });
});

describe("harnessLine", () => {
  it("lists each harness's command and version, in listing order", () => {
    expect(
      harnessLine({
        name: "vanilla",
        description: "d",
        harnesses: [
          {
            name: "claude",
            title: "Claude Code",
            tagline: "t",
            version: "2.1.291",
          },
          { name: "codex", title: "Codex", tagline: "t", version: "0.80.1" },
          { name: "omp", title: "Oh My Pi", tagline: "t", version: "18.7.0" },
        ],
      }),
    ).toBe("claude 2.1.291 · codex 0.80.1 · omp 18.7.0");
  });
});
