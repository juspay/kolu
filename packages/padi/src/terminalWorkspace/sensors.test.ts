/**
 * Forge dispatch: which adapter resolves a repo's PR, picked from its `origin`
 * remote host. The decision is made HERE — at the knowing endpoint that holds
 * the URL — never guessed downstream from `gh`'s stderr.
 *
 * Regression guard for juspay/kolu#1627: a Codeberg (Forgejo) remote used to
 * route through `gh pr view`, which exits 1 on a non-GitHub remote and produced
 * error-level log noise + a "gh: unknown error" popover every poll. It now maps
 * to the honest `unsupported` state without spawning `gh`.
 */

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
    // The reported bug: a Codeberg (Forgejo) remote.
    {
      label: "https Codeberg remote",
      url: "https://codeberg.org/owner/repo.git",
    },
    {
      label: "scp-style Codeberg remote",
      url: "git@codeberg.org:owner/repo.git",
    },
    // Only github.com is treated as GitHub. A GitHub Enterprise host is an
    // arbitrary corporate domain we can't recognize from the URL — claiming it
    // is GitHub would be a guess — so it routes to `unsupported` too (GHE is out
    // of scope: no PR pill, reopened by per-host config / the real adapter, #1240).
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
    // `unsupported` can only come from the non-gh arm — the gh adapter never
    // returns it — so this result proves `gh` was never spawned for Codeberg.
    const result = await dispatchingForgeAdapter.resolve({
      repoRoot: "/tmp/repo",
      branch: "main",
      remoteUrl: "https://codeberg.org/owner/repo.git",
    });
    expect(result).toEqual({ kind: "unsupported" });
  });
});
