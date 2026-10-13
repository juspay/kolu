import { describe, expect, it } from "vitest";
import { bundleChanges, parseVersions, versionsFile } from "./versions.ts";

/** A real bundle's `share/agent-distro/versions` (vanilla, 2026-10-07). */
const REAL = [
  "omp\tOh My Pi\t18.7.0",
  "codex\tCodex\t0.160.1",
  "claude\tClaude Code\t2.1.292",
  "opencode\tOpenCode\t1.18.35+53d1eab",
  "opencode2\tOpenCode v2\t2.0.24",
  "pi\tPi\t1.0.4",
  "",
].join("\n");

describe("parseVersions", () => {
  it("reads a real versions file, in its order", () => {
    expect(parseVersions(REAL)).toEqual([
      { name: "omp", title: "Oh My Pi", version: "18.7.0" },
      { name: "codex", title: "Codex", version: "0.160.1" },
      { name: "claude", title: "Claude Code", version: "2.1.292" },
      { name: "opencode", title: "OpenCode", version: "1.18.35+53d1eab" },
      { name: "opencode2", title: "OpenCode v2", version: "2.0.24" },
      { name: "pi", title: "Pi", version: "1.0.4" },
    ]);
  });
  it("keeps a version that itself has a tab, as upstream does", () => {
    expect(parseVersions("x\tX\t1\tbeta")).toEqual([
      { name: "x", title: "X", version: "1\tbeta" },
    ]);
  });
  it("throws on a line that is not three fields", () => {
    expect(() => parseVersions("claude Claude Code 2.1.292")).toThrow();
  });
  it("sits under the bundle", () => {
    expect(versionsFile("/nix/store/x")).toBe(
      "/nix/store/x/share/agent-distro/versions",
    );
  });
});

describe("bundleChanges — upstream's history words", () => {
  const v = (name: string, title: string, version: string) => ({
    name,
    title,
    version,
  });
  const claude = v("claude", "Claude Code", "1");
  const pi = v("pi", "Pi", "0.3");
  const before = [claude, pi];

  it("a first landing names every agent with its version", () => {
    expect(bundleChanges(undefined, before)).toBe("Claude Code 1, Pi 0.3");
  });
  it("a changed version reads old → new", () => {
    expect(bundleChanges(before, [v("claude", "Claude Code", "2"), pi])).toBe(
      "Claude Code 1 → 2",
    );
  });
  it("names an added agent with its version, and a removed one", () => {
    expect(bundleChanges(before, [claude, v("codex", "Codex", "0.1")])).toBe(
      "Codex added 0.1, Pi removed",
    );
  });
  it("says so when nothing changed", () => {
    expect(bundleChanges(before, before)).toBe("no harness version changed");
  });
  it("says so when the new bundle records no versions", () => {
    expect(bundleChanges(before, undefined)).toBe(
      "versions not recorded by this bundle",
    );
  });
});
