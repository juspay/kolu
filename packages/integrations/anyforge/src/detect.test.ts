import { describe, expect, it } from "vitest";
import { detectForge, parseRemoteHost } from "./detect.ts";

describe("parseRemoteHost", () => {
  it.each([
    {
      label: "https URL",
      url: "https://github.com/juspay/kolu.git",
      host: "github.com",
    },
    {
      label: "https URL without .git",
      url: "https://codeberg.org/owner/repo",
      host: "codeberg.org",
    },
    {
      label: "ssh:// URL",
      url: "ssh://git@codeberg.org/owner/repo.git",
      host: "codeberg.org",
    },
    {
      label: "ssh:// URL with port",
      url: "ssh://git@git.example.com:2222/owner/repo.git",
      host: "git.example.com",
    },
    {
      label: "SSH shorthand",
      url: "git@github.com:juspay/kolu.git",
      host: "github.com",
    },
    {
      label: "SSH shorthand with surrounding whitespace",
      url: "  git@codeberg.org:owner/repo.git\n",
      host: "codeberg.org",
    },
    {
      label: "uppercase host normalized",
      url: "https://GitHub.COM/owner/repo",
      host: "github.com",
    },
  ])("parses $label", ({ url, host }) => {
    expect(parseRemoteHost(url)).toBe(host);
  });

  it.each([
    { label: "empty string", url: "" },
    { label: "whitespace only", url: "   " },
    { label: "a local path", url: "/srv/git/repo.git" },
    { label: "a relative path", url: "../sibling-repo" },
  ])("returns null for $label", ({ url }) => {
    expect(parseRemoteHost(url)).toBeNull();
  });
});

describe("detectForge", () => {
  it.each([
    "https://codeberg.org/owner/repo.git",
    "git@codeberg.org:owner/repo.git",
  ])("maps codeberg.org remote %s to forgejo", (url) => {
    expect(detectForge(url)).toBe("forgejo");
  });

  it.each([
    { label: "github.com", url: "https://github.com/juspay/kolu.git" },
    {
      label: "an unknown host (gh is the fallback prober)",
      url: "https://git.example.com/owner/repo.git",
    },
    { label: "a null remote (no origin)", url: null },
    { label: "an unparseable remote (local path)", url: "/srv/git/repo.git" },
  ])("maps $label to github", ({ url }) => {
    expect(detectForge(url)).toBe("github");
  });
});
