import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findOpencodeDbPath } from "./config.ts";

/** Touch a file with a specific mtime so the mtime-ordering is deterministic
 *  (real filesystems can coalesce same-millisecond writes). */
function touch(file: string, mtimeMs: number): void {
  fs.writeFileSync(file, "");
  const t = mtimeMs / 1000;
  fs.utimesSync(file, t, t);
}

describe("findOpencodeDbPath", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-config-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the directory does not exist", () => {
    expect(findOpencodeDbPath(path.join(dir, "missing"))).toBeNull();
  });

  it("returns null when there is no opencode*.db", () => {
    fs.writeFileSync(path.join(dir, "log"), "");
    fs.writeFileSync(path.join(dir, "opencode.db-wal"), ""); // not the DB itself
    expect(findOpencodeDbPath(dir)).toBeNull();
  });

  it("finds the channel-suffixed stable DB the current release writes", () => {
    fs.writeFileSync(path.join(dir, "opencode-stable.db"), "");
    expect(findOpencodeDbPath(dir)).toBe(path.join(dir, "opencode-stable.db"));
  });

  it("finds the plain opencode.db (latest/beta/prod channels)", () => {
    fs.writeFileSync(path.join(dir, "opencode.db"), "");
    expect(findOpencodeDbPath(dir)).toBe(path.join(dir, "opencode.db"));
  });

  it("finds the local-channel DB a from-source / nix build writes", () => {
    // opencode's InstallationChannel defaults to "local" (version.ts), and
    // path() then writes `opencode-local.db` (database.ts). This is the one a
    // nix-built opencode uses — the case the e2e exercises.
    fs.writeFileSync(path.join(dir, "opencode-local.db"), "");
    expect(findOpencodeDbPath(dir)).toBe(path.join(dir, "opencode-local.db"));
  });

  it.each([
    "dev",
    "beta",
    "latest",
    "prod",
    "nightly",
  ])("matches an arbitrary channel suffix: opencode-%s.db", (channel) => {
    // The class, not the instance: whatever channel opencode's enum yields,
    // `opencode-<channel>.db` is resolved (database.ts derives the suffix
    // from InstallationChannel).
    fs.writeFileSync(path.join(dir, `opencode-${channel}.db`), "");
    expect(findOpencodeDbPath(dir)).toBe(
      path.join(dir, `opencode-${channel}.db`),
    );
  });

  it("picks the most-recently-modified DB across channels", () => {
    // A machine that ran multiple opencode channels has several DBs; the one
    // the user actually writes to is the freshest — that's the live session.
    touch(path.join(dir, "opencode.db"), 1_000);
    touch(path.join(dir, "opencode-local.db"), 3_000);
    touch(path.join(dir, "opencode-stable.db"), 2_000);
    expect(findOpencodeDbPath(dir)).toBe(path.join(dir, "opencode-local.db"));
  });

  it("ignores non-DB files that merely start with opencode", () => {
    fs.writeFileSync(path.join(dir, "opencode.json"), "");
    fs.writeFileSync(path.join(dir, "opencode-stable.db-shm"), "");
    fs.writeFileSync(path.join(dir, "opencode.dbx"), "");
    expect(findOpencodeDbPath(dir)).toBeNull();
  });
});
