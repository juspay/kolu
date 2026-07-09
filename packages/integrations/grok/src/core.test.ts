import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Point Grok home at a temp dir BEFORE importing modules that capture paths.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-grok-test-"));
process.env.KOLU_GROK_DIR = tmpHome;

const {
  encodeCwd,
  foldEventsState,
  KNOWN_PHASES,
  readActiveSessions,
  readSummary,
  resolveGrokSession,
} = await import("./core.ts");
const { ACTIVE_SESSIONS_PATH, SESSIONS_DIR } = await import("./config.ts");

function writeActiveSessions(
  entries: { session_id: string; pid: number; cwd: string }[],
): void {
  fs.mkdirSync(tmpHome, { recursive: true });
  fs.writeFileSync(ACTIVE_SESSIONS_PATH, JSON.stringify(entries));
}

function writeSession(opts: {
  cwd: string;
  id: string;
  events: object[];
  model?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}): void {
  const dir = path.join(SESSIONS_DIR, encodeCwd(opts.cwd), opts.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "events.jsonl"),
    opts.events.length === 0
      ? ""
      : `${opts.events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    JSON.stringify({
      info: { id: opts.id, cwd: opts.cwd },
      current_model_id: opts.model ?? "grok-4.5",
      generated_title: opts.title ?? "Test",
      created_at: opts.createdAt ?? "2026-07-09T15:00:00.000Z",
      updated_at: opts.updatedAt ?? "2026-07-09T15:01:00.000Z",
    }),
  );
}

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.mkdirSync(tmpHome, { recursive: true });
});

describe("encodeCwd", () => {
  it("url-encodes absolute paths like Grok does", () => {
    expect(encodeCwd("/home/srid/code/kolu")).toBe(
      "%2Fhome%2Fsrid%2Fcode%2Fkolu",
    );
  });
});

describe("foldEventsState", () => {
  it("maps permission_prompt → awaiting_user", () => {
    expect(
      foldEventsState([
        { type: "turn_started" },
        { type: "phase_changed", phase: "permission_prompt" },
      ]),
    ).toBe("awaiting_user");
  });

  it("maps tool_execution → tool_use", () => {
    expect(
      foldEventsState([
        { type: "turn_started" },
        { type: "phase_changed", phase: "tool_execution" },
      ]),
    ).toBe("tool_use");
  });

  it("maps streaming phases → thinking", () => {
    for (const phase of [
      "waiting_for_model",
      "streaming_reasoning",
      "streaming_text",
    ]) {
      expect(
        foldEventsState([
          { type: "turn_started" },
          { type: "phase_changed", phase },
        ]),
      ).toBe("thinking");
    }
  });

  it("maps turn_ended → waiting", () => {
    expect(
      foldEventsState([
        { type: "turn_started" },
        { type: "phase_changed", phase: "streaming_text" },
        { type: "turn_ended" },
      ]),
    ).toBe("waiting");
  });

  it("prefers the newest signal", () => {
    expect(
      foldEventsState([
        { type: "phase_changed", phase: "tool_execution" },
        { type: "phase_changed", phase: "streaming_text" },
      ]),
    ).toBe("thinking");
  });

  it("unknown phase degrades to thinking", () => {
    expect(
      foldEventsState([{ type: "phase_changed", phase: "brand_new_phase" }]),
    ).toBe("thinking");
  });

  it("KNOWN_PHASES lists every phase the fold handles specially", () => {
    expect(KNOWN_PHASES).toContain("permission_prompt");
    expect(KNOWN_PHASES).toContain("tool_execution");
  });
});

describe("resolveGrokSession", () => {
  const cwd = "/tmp/proj";
  const id = "019f4782-7854-7592-8d87-3ba3a205a0a1";

  it("matches by foreground pid via active_sessions.json", () => {
    writeSession({
      cwd,
      id,
      events: [{ type: "turn_started" }],
    });
    writeActiveSessions([{ session_id: id, pid: 4242, cwd }]);
    const session = resolveGrokSession(4242, cwd);
    expect(session).not.toBeNull();
    expect(session?.id).toBe(id);
  });

  it("falls back to latest session under encoded cwd when pid is unknown", () => {
    writeSession({
      cwd,
      id,
      events: [{ type: "turn_ended" }],
      title: "Older",
      updatedAt: "2026-07-09T15:01:00.000Z",
    });
    const newerId = "019f4782-7854-7592-8d87-3ba3a205a0a2";
    writeSession({
      cwd,
      id: newerId,
      events: [{ type: "phase_changed", phase: "streaming_text" }],
      title: "Newer",
      createdAt: "2026-07-09T16:00:00.000Z",
      updatedAt: "2026-07-09T17:00:00.000Z",
    });

    const session = resolveGrokSession(undefined, cwd);
    expect(session?.id).toBe(newerId);
  });

  it("returns null when pid is known but absent from active_sessions (no cwd guess)", () => {
    writeSession({
      cwd,
      id,
      events: [{ type: "turn_ended" }],
    });
    // Stale leftover session under cwd must NOT match a live grok pid
    // that hasn't written active_sessions yet.
    expect(resolveGrokSession(9999, cwd)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(resolveGrokSession(undefined, "/no/such/cwd")).toBeNull();
  });
});

describe("readActiveSessions / readSummary", () => {
  it("returns [] when active_sessions is missing", () => {
    expect(readActiveSessions()).toEqual([]);
  });

  it("parses summary model and title", () => {
    const cwd = "/tmp/x";
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    writeSession({ cwd, id, events: [], model: "grok-4.5", title: "Hello" });
    const summary = readSummary(
      path.join(SESSIONS_DIR, encodeCwd(cwd), id, "summary.json"),
    );
    expect(summary?.model).toBe("grok-4.5");
    expect(summary?.title).toBe("Hello");
    expect(summary?.startedAt).toBe(Date.parse("2026-07-09T15:00:00.000Z"));
  });
});
