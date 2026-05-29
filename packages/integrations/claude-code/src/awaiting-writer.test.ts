/** Tests for the standalone #905 hook writer (`awaiting-writer.mjs`).
 *
 *  Run as a real child process — that IS the contract: Claude spawns it as a
 *  separate `node` process, and the load-bearing guarantee is that it ALWAYS
 *  exits 0 (Claude only blocks the tool on exit code 2) and writes the sidecar
 *  atomically. We assert the exit code on every input shape, not just the
 *  happy path. */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AWAITING_WRITER_ASSET } from "./core.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "awaiting-writer-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Invoke the writer with `mode` and `stdin`, pointing it at an explicit
 *  awaiting dir. Returns the child's exit status. */
function run(mode: string, stdin: string, awaitingDir = dir): number | null {
  const res = spawnSync(process.execPath, [AWAITING_WRITER_ASSET, mode], {
    input: stdin,
    env: { ...process.env, KOLU_CLAUDE_AWAITING_DIR: awaitingDir },
    encoding: "utf8",
  });
  return res.status;
}

function sidecar(sessionId: string, awaitingDir = dir): unknown | null {
  const p = path.join(awaitingDir, `${sessionId}.json`);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

describe("awaiting-writer set", () => {
  it("writes an AskUserQuestion sidecar with question + options", () => {
    const stdin = JSON.stringify({
      session_id: "sess-1",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          {
            question: "Which approach?",
            options: [{ label: "A" }, { label: "B" }],
          },
        ],
      },
    });
    expect(run("set", stdin)).toBe(0);
    expect(sidecar("sess-1")).toMatchObject({
      sessionId: "sess-1",
      tool_name: "AskUserQuestion",
      question: "Which approach?",
      options: ["A", "B"],
    });
  });

  it("writes an empty prompt for ExitPlanMode (no discrete question)", () => {
    const stdin = JSON.stringify({
      session_id: "sess-2",
      tool_name: "ExitPlanMode",
      tool_input: { plan: "do the thing" },
    });
    expect(run("set", stdin)).toBe(0);
    expect(sidecar("sess-2")).toMatchObject({
      tool_name: "ExitPlanMode",
      question: null,
      options: [],
    });
  });
});

describe("awaiting-writer clear", () => {
  it("removes a previously written sidecar", () => {
    const stdin = JSON.stringify({
      session_id: "sess-3",
      tool_name: "ExitPlanMode",
    });
    expect(run("set", stdin)).toBe(0);
    expect(sidecar("sess-3")).not.toBeNull();
    expect(run("clear", stdin)).toBe(0);
    expect(sidecar("sess-3")).toBeNull();
  });

  it("exits 0 clearing an absent sidecar", () => {
    expect(run("clear", JSON.stringify({ session_id: "never-written" }))).toBe(
      0,
    );
  });
});

describe("awaiting-writer fail-open (always exits 0)", () => {
  it("malformed stdin", () => {
    expect(run("set", "{ not json")).toBe(0);
  });

  it("empty stdin", () => {
    expect(run("set", "")).toBe(0);
  });

  it("missing session_id (nothing to key on)", () => {
    expect(run("set", JSON.stringify({ tool_name: "AskUserQuestion" }))).toBe(
      0,
    );
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("unwritable awaiting dir (mkdir fails)", () => {
    // Point the dir *inside* a regular file so mkdirSync throws ENOTDIR.
    const file = path.join(dir, "blocker");
    fs.writeFileSync(file, "x");
    const bogus = path.join(file, "nested");
    expect(run("set", JSON.stringify({ session_id: "s" }), bogus)).toBe(0);
  });

  it("unknown mode", () => {
    expect(run("frobnicate", JSON.stringify({ session_id: "s" }))).toBe(0);
  });
});
