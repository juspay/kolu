import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeTempRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tw-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(repo, "untracked.txt"), "x\n");
  return repo;
}
