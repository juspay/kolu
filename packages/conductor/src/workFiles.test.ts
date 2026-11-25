/**
 * THE NAME A WORK'S KEPT FILES SIT UNDER — kolu's disk layout, which is why it
 * is here rather than in `kolu-work`.
 */

import { type WorkKey, workIdOf } from "kolu-work";
import { describe, expect, it } from "vitest";
import { workDirOf } from "./workFiles.ts";

const KEY: WorkKey = {
  kind: "branch",
  host: "remote:naiveintent",
  repo: "/home/me/code/kolu",
  branch: "agent-distro-update-errors",
  repoBy: { kind: "git" },
};
const ID = workIdOf(KEY);

describe("the directory a work's kept files sit in", () => {
  it("names one that is filesystem-safe", () => {
    // A work id carries a repository's absolute path, so the directory is a
    // hash of it: short, stable across runs, and different for a different
    // work.
    expect(workDirOf(ID)).toMatch(/^[0-9a-f]{16}$/);
    expect(workDirOf(ID)).toBe(workDirOf(ID));
    expect(workDirOf(ID)).not.toBe(workDirOf(`${ID}x`));
  });
});
