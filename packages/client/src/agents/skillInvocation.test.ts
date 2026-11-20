import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skillInvocation } from "./terminalTip";

const src = process.env.KOLU_AGENT_DISTRO_SRC;
if (!src)
  throw new Error(
    "KOLU_AGENT_DISTRO_SRC is unset: run the unit lane in kolu's dev shell (shell.nix)",
  );

const HARNESSES = readdirSync(join(src, "harnesses"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe("skillInvocation — every harness of the package", () => {
  it("the pin ships harnesses for this walk to find", () => {
    expect(HARNESSES).toContain("claude");
  });

  for (const harness of HARNESSES)
    it(`${harness} has a decided invocation`, () => {
      expect(() => skillInvocation(harness, "kolu")).not.toThrow();
    });
});
