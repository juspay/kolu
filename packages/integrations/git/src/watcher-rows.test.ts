import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listDirWatcherRows } from "kolu-io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKIP_DARWIN_FSWATCH } from "./fs-watch-delivery.testlib.ts";
import { _resetIgnoreRulesWatchers } from "./ignore-rules-watcher.ts";
import { subscribeRepoChange } from "./repo-change.ts";
import { waitFor } from "./working-tree-watcher.testlib.ts";
import { listWorkingTreeWatcherRows } from "./working-tree-watcher.ts";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

let root: string;
const offs: Array<() => void> = [];

function initRepo(name: string): string {
  const repo = path.join(root, name);
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "a@b.c");
  git(repo, "config", "user.name", "a");
  fs.writeFileSync(path.join(repo, "src", "app.ts"), "1\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  return repo;
}

const treeRow = (repo: string) =>
  listWorkingTreeWatcherRows().find((r) => r.repoRoot === repo);

const headRow = (repo: string) =>
  listDirWatcherRows().find(
    (r) => r.kind === "git: head" && r.dir === path.join(repo, ".git"),
  );

beforeEach(() => {
  _resetIgnoreRulesWatchers();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kolu-rows-")));
  const globalConfig = path.join(root, "gitconfig-global");
  fs.writeFileSync(globalConfig, "");
  vi.stubEnv("XDG_CONFIG_HOME", path.join(root, "xdg"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_CEILING_DIRECTORIES", path.dirname(root));
});

afterEach(() => {
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("watcher rows", () => {
  it("two askers of one repo share one working-tree row and one HEAD row", async () => {
    const repo = initRepo("repo");
    const stopA = subscribeRepoChange(repo, "terminal a", () => {});
    const stopB = subscribeRepoChange(repo, "stream b", () => {});
    offs.push(stopB);

    expect(await waitFor(() => treeRow(repo)?.state.kind === "watching")).toBe(
      true,
    );
    expect(await waitFor(() => headRow(repo) !== undefined)).toBe(true);

    expect(
      listWorkingTreeWatcherRows().filter((r) => r.repoRoot === repo),
    ).toHaveLength(1);
    expect(treeRow(repo)?.askers).toEqual(["terminal a", "stream b"]);
    expect(headRow(repo)?.askers).toEqual(["terminal a", "stream b"]);
    expect(treeRow(repo)?.lastInstallMs.kind).toBe("measured");
    expect(treeRow(repo)?.ignoredPaths).toEqual({
      kind: "measured",
      value: 1,
    });

    stopA();
    expect(treeRow(repo)?.askers).toEqual(["stream b"]);
    expect(headRow(repo)?.askers).toEqual(["stream b"]);
  }, 30_000);

  it.skipIf(SKIP_DARWIN_FSWATCH)(
    "a rebuild is counted, with its reason and a measured install",
    async () => {
      const repo = initRepo("repo");
      fs.writeFileSync(path.join(repo, ".gitignore"), "dist/\n");
      fs.mkdirSync(path.join(repo, "dist"));
      fs.writeFileSync(path.join(repo, "dist", "out.js"), "1\n");
      offs.push(subscribeRepoChange(repo, "terminal a", () => {}));
      expect(
        await waitFor(() => treeRow(repo)?.state.kind === "watching"),
      ).toBe(true);
      expect(treeRow(repo)?.rebuilds).toBe(0);

      fs.writeFileSync(path.join(repo, ".gitignore"), "");
      expect(await waitFor(() => (treeRow(repo)?.rebuilds ?? 0) > 0)).toBe(
        true,
      );
      expect(
        await waitFor(() => treeRow(repo)?.state.kind === "watching"),
      ).toBe(true);
      const row = treeRow(repo);
      expect(row?.lastRebuildReason).toBe("ignore rules changed");
      expect(row?.lastInstallMs.kind).toBe("measured");
    },
    30_000,
  );
});
