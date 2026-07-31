import { describe, expect, it } from "vitest";
import { backgroundGit, backgroundGitEnv } from "./background.ts";

describe("background Git", () => {
  it("preserves the process environment and disables optional locks", () => {
    const env = backgroundGitEnv();
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.GIT_OPTIONAL_LOCKS).toBe("0");
  });

  it("runs through simple-git with the bounded background environment", async () => {
    await expect(backgroundGit().raw(["--version"])).resolves.toMatch(
      /^git version /,
    );
  });
});
