import { describe, expect, it } from "vitest";
import { detectForge, dispatchingForgeAdapter } from "./sensors.ts";

describe("detectForge", () => {
  it.each([
    {
      label: "https github.com remote",
      url: "https://github.com/owner/repo.git",
    },
    {
      label: "scp-style github.com remote",
      url: "git@github.com:owner/repo.git",
    },
    {
      label: "mixed-case github.com host",
      url: "https://GitHub.com/owner/repo.git",
    },
  ])("routes a $label to the gh adapter", ({ url }) => {
    expect(detectForge(url)).toBe("github");
  });

  it.each([
    {
      label: "https Codeberg remote",
      url: "https://codeberg.org/owner/repo.git",
    },
    {
      label: "scp-style Codeberg remote",
      url: "git@codeberg.org:owner/repo.git",
    },
    {
      label: "a GitHub Enterprise host",
      url: "https://github.acme.example/owner/repo.git",
    },
    {
      label: "an unknown self-hosted host",
      url: "https://git.example.com/owner/repo.git",
    },
    { label: "a null remote (no origin)", url: null },
  ])("routes $label to the unsupported (non-gh) arm", ({ url }) => {
    expect(detectForge(url)).toBe("unsupported");
  });
});

describe("dispatchingForgeAdapter", () => {
  it("resolves a Codeberg remote to `unsupported` without consulting gh", async () => {
    const result = await dispatchingForgeAdapter.resolve(
      {
        repoRoot: "/tmp/repo",
        branch: "main",
        remoteUrl: "https://codeberg.org/owner/repo.git",
      },
      "context",
    );
    expect(result).toEqual({ kind: "unsupported" });
  });
});
