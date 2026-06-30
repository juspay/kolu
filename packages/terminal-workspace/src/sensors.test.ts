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
      label: "https Codeberg remote",
      url: "https://codeberg.org/owner/repo.git",
    },
    {
      label: "scp-style Codeberg remote",
      url: "git@codeberg.org:owner/repo.git",
    },
    { label: "ssh Codeberg remote", url: "ssh://git@codeberg.org/owner/repo" },
    {
      label: "mixed-case Codeberg host",
      url: "https://Codeberg.org/owner/repo.git",
    },
  ])("routes a $label to the unsupported (non-gh) arm", ({ url }) => {
    expect(detectForge(url)).toBe("unsupported");
  });

  it.each([
    { label: "github.com", url: "https://github.com/owner/repo.git" },
    {
      label: "GitHub Enterprise host",
      url: "https://github.acme.example/owner/repo.git",
    },
    // gh owns the "this host isn't one I serve" classification for any host we
    // can't recognize from the URL alone (self-hosted Forgejo/Gitea included),
    // so an unknown host defaults to github rather than being guessed here.
    {
      label: "an unknown self-hosted host",
      url: "https://git.example.com/owner/repo.git",
    },
    { label: "a null remote (no origin)", url: null },
  ])("routes $label to github", ({ url }) => {
    expect(detectForge(url)).toBe("github");
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
