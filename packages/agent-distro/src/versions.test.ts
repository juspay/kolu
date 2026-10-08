import { describe, expect, it } from "vitest";
import { parseVersions, versionsFile } from "./versions.ts";

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
