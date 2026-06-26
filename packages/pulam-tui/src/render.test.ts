import { agentStatusLabel } from "@kolu/terminal-workspace/agentProjection";
import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import { describe, expect, it } from "vitest";
import {
  formatAwarenessJson,
  formatStatus,
  formatWatchEvent,
  formatWatchJson,
  formatWatchRemoval,
  formatWatchRemovalJson,
  shortId,
} from "./render.ts";

/** A seed awareness value; `over` patches the fields a case cares about. The
 *  git/pr/agent sub-shapes are cast — render only reads a few fields of each,
 *  and these tests exercise rendering, not schema validity. */
function val(over: Partial<AwarenessValue>): AwarenessValue {
  return {
    cwd: "/repo",
    git: null,
    lastActivityAt: 0,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ...over,
  } as AwarenessValue;
}

const agentVal = (state: string): AwarenessValue["agent"] =>
  ({ kind: "claude-code", state }) as AwarenessValue["agent"];

const gitVal = (repoName: string, branch: string): AwarenessValue["git"] =>
  ({ repoName, branch, repoRoot: `/r/${repoName}` }) as AwarenessValue["git"];

const id = (s: string): TerminalId => s as TerminalId;
const NOW = 1_700_000_000_000;

describe("shortId", () => {
  it("keeps the leading 8 chars (the whole id when shorter)", () => {
    expect(shortId("a3f1c0de-1234-5678")).toBe("a3f1c0de");
    expect(shortId("abc")).toBe("abc");
  });
});

describe("formatStatus", () => {
  it("is an honest one-liner when there are no terminals", () => {
    expect(formatStatus([], { now: NOW })).toBe("no terminals.");
  });

  it("renders a header + one row per terminal, sorted by id", () => {
    const out = formatStatus(
      [
        [
          id("b7c2bbbb"),
          val({
            git: gitVal("drishti", "master"),
            agent: agentVal("awaiting_user"),
            foreground: { name: "codex" } as AwarenessValue["foreground"],
          }),
        ],
        [
          id("a3f1aaaa"),
          val({
            git: gitVal("kolu", "feat/dial-ssh"),
            pr: {
              kind: "ok",
              value: { number: 1412, state: "open", checks: "pass" },
            } as AwarenessValue["pr"],
            agent: agentVal("tool_use"),
            foreground: { name: "node" } as AwarenessValue["foreground"],
            lastActivityAt: NOW - 5000,
          }),
        ],
      ],
      { now: NOW },
    );
    const lines = out.split("\n");
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("REPO·BRANCH");
    expect(lines[0]).toContain("FOREGROUND");
    // Sorted by id: a3f1 before b7c2.
    expect(lines[1]).toContain("a3f1aaaa");
    expect(lines[2]).toContain("b7c2bbbb");
    // The resolved PR with passing checks renders its number + glyph.
    expect(lines[1]).toContain("#1412");
    expect(lines[1]).toContain("✓");
    // The agent cell is `claude · <label>` (the shared projection).
    expect(lines[1]).toContain(`claude · ${agentStatusLabel("tool_use")}`);
    // repo·branch joined with the middle dot.
    expect(lines[1]).toContain("kolu·feat/dial-ssh");
    // 5s of idle on the a3f1 row.
    expect(lines[1]).toContain("5s");
  });

  it("strips control bytes from a hostile branch so the table can't be corrupted", () => {
    const out = formatStatus(
      [[id("aaaa1111"), val({ git: gitVal("kolu", "main\n\x1b[31mEVIL") })]],
      { now: NOW },
    );
    expect(out).not.toContain("\n\x1b");
    expect(out).not.toContain("\x1b[31m");
  });
});

describe("formatAwarenessJson", () => {
  it("is a parseable top-level array with the FULL id and deep fields", () => {
    const out = formatAwarenessJson([
      [id("a3f1aaaa-1111-2222"), val({ git: gitVal("kolu", "main") })],
    ]);
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("a3f1aaaa-1111-2222"); // full id, not shortened
    expect(parsed[0].git.repoName).toBe("kolu");
    expect(parsed[0].cwd).toBe("/repo");
  });
});

describe("formatWatchEvent", () => {
  it("renders `HH:MM:SS  <id>  <repo·branch>  <agent>` with no live dot when idle", () => {
    const line = formatWatchEvent(
      id("a3f1aaaa-1111"),
      val({ git: gitVal("kolu", "feat/x"), agent: agentVal("tool_use") }),
      { now: NOW, live: false },
    );
    expect(line).toMatch(
      /^\d\d:\d\d:\d\d {2}a3f1aaaa {2}kolu·feat\/x {2}claude · /,
    );
    expect(line).not.toContain("●");
  });

  it("appends the live dot when the terminal is moving bytes", () => {
    const line = formatWatchEvent(id("a3f1aaaa"), val({}), {
      now: NOW,
      live: true,
    });
    expect(line.endsWith("●")).toBe(true);
  });
});

describe("formatWatchJson / removal", () => {
  it("is one-line NDJSON carrying terminalId, active, and the raw value", () => {
    const line = formatWatchJson(
      id("a3f1aaaa-1111-2222"),
      val({ git: gitVal("kolu", "main") }),
      { live: true },
    );
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed.terminalId).toBe("a3f1aaaa-1111-2222");
    expect(parsed.active).toBe(true);
    expect(parsed.git.repoName).toBe("kolu");
  });

  it("emits a removal sentinel, human and JSON", () => {
    expect(formatWatchRemoval(id("a3f1aaaa"), { now: NOW })).toContain(
      "(gone)",
    );
    expect(JSON.parse(formatWatchRemovalJson(id("a3f1aaaa-1111")))).toEqual({
      terminalId: "a3f1aaaa-1111",
      removed: true,
    });
  });
});
