import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findCodexStateDbPath } from "./config.ts";

describe("findCodexStateDbPath", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the directory does not exist", () => {
    expect(findCodexStateDbPath(path.join(dir, "missing"))).toBeNull();
  });

  it("returns null when the directory has no state_<N>.sqlite files", () => {
    fs.writeFileSync(path.join(dir, "config.toml"), "");
    fs.writeFileSync(path.join(dir, "logs_2.sqlite"), "");
    expect(findCodexStateDbPath(dir)).toBeNull();
  });

  it("picks the single state file when only one is present", () => {
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    expect(findCodexStateDbPath(dir)).toBe(path.join(dir, "state_5.sqlite"));
  });

  it("picks the highest numbered version when multiple are present", () => {
    // Future-proof: user upgrades Codex, new state_7.sqlite appears
    // alongside legacy state_5.sqlite. We must pick v7 — v5 is stale.
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    fs.writeFileSync(path.join(dir, "state_7.sqlite"), "");
    fs.writeFileSync(path.join(dir, "state_6.sqlite"), "");
    expect(findCodexStateDbPath(dir)).toBe(path.join(dir, "state_7.sqlite"));
  });

  it("compares by numeric value, not lexicographic order", () => {
    // "10" < "9" lexicographically; must treat them as numbers.
    fs.writeFileSync(path.join(dir, "state_9.sqlite"), "");
    fs.writeFileSync(path.join(dir, "state_10.sqlite"), "");
    expect(findCodexStateDbPath(dir)).toBe(path.join(dir, "state_10.sqlite"));
  });

  it("ignores files that don't match state_<digits>.sqlite", () => {
    // logs_*.sqlite is a sibling family (different schema, different
    // purpose). state_5.sqlite.backup, state_5.sqlite-wal etc. are also
    // excluded — only the canonical filename matches.
    fs.writeFileSync(path.join(dir, "logs_2.sqlite"), "");
    fs.writeFileSync(path.join(dir, "state_5.sqlite-wal"), "");
    fs.writeFileSync(path.join(dir, "state_5.sqlite.backup"), "");
    fs.writeFileSync(path.join(dir, "state_abc.sqlite"), "");
    fs.writeFileSync(path.join(dir, "state_5.sqlite"), "");
    expect(findCodexStateDbPath(dir)).toBe(path.join(dir, "state_5.sqlite"));
  });
});
