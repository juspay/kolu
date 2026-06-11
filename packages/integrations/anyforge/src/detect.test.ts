import { describe, expect, it } from "vitest";
import { parseRemoteHost } from "./detect.ts";

describe("parseRemoteHost", () => {
  it.each([
    ["https://github.com/owner/repo.git", "github.com"],
    ["https://codeberg.org/owner/repo", "codeberg.org"],
    ["ssh://git@codeberg.org:22/owner/repo.git", "codeberg.org"],
    ["git@github.com:owner/repo.git", "github.com"],
    ["git@git.example.com:owner/repo.git", "git.example.com"],
    // scp-style with no user — `new URL` parses this as an opaque URL with an
    // empty hostname, so the scp parser must be reached via the empty-host
    // fallthrough (not only the catch block).
    ["codeberg.org:owner/repo.git", "codeberg.org"],
    // scp host casing is normalized to lowercase, matching URL.hostname.
    ["git@CodeBerg.ORG:owner/repo.git", "codeberg.org"],
    // Credentials in the URL must not leak into the host.
    ["https://user:token@github.com/owner/repo.git", "github.com"],
  ])("extracts the host of %s", (url, host) => {
    expect(parseRemoteHost(url)).toBe(host);
  });

  it.each([null, "", "not a url"])("returns null for %s", (input) => {
    expect(parseRemoteHost(input)).toBeNull();
  });
});
