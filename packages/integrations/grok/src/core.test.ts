import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Point Grok home at a temp dir BEFORE importing modules that capture paths.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-grok-test-"));
process.env.KOLU_GROK_DIR = tmpHome;

const {
  deriveGrokInfo,
  encodeCwd,
  foldEventsState,
  KNOWN_PHASES,
  readActiveSessions,
  readContextTokens,
  readSummary,
  resolveGrokSession,
  signalsPathFor,
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

  // Live capture (vira session 019f47d4-…): ask_user_question stays open
  // under phase tool_execution after permission auto-allow — chrome must
  // show awaiting_user, not "Running tools".
  it("promotes open ask_user_question over tool_execution phase", () => {
    expect(
      foldEventsState([
        { type: "turn_started" },
        { type: "phase_changed", phase: "tool_execution" },
        { type: "tool_started", tool_name: "ask_user_question" },
        { type: "phase_changed", phase: "permission_prompt" },
        {
          type: "permission_resolved",
          tool_name: "ask_user_question",
        },
        { type: "phase_changed", phase: "tool_execution" },
      ]),
    ).toBe("awaiting_user");
  });

  it("does not promote after ask_user_question completes", () => {
    expect(
      foldEventsState([
        { type: "tool_started", tool_name: "ask_user_question" },
        { type: "phase_changed", phase: "tool_execution" },
        {
          type: "tool_completed",
          tool_name: "ask_user_question",
        },
        { type: "phase_changed", phase: "streaming_text" },
      ]),
    ).toBe("thinking");
  });

  // Turn-scoped: an ask_user_question left open when its turn ends (the
  // user escaped the prompt / the turn was interrupted) must NOT stick in
  // awaiting_user — the trailing turn_ended wins.
  it("does not stick in awaiting_user after the turn ends with the prompt open", () => {
    expect(
      foldEventsState([
        { type: "turn_started" },
        { type: "phase_changed", phase: "tool_execution" },
        { type: "tool_started", tool_name: "ask_user_question" },
        { type: "turn_ended" },
      ]),
    ).toBe("waiting");
  });

  // Turn-scoped: a dangling ask_user_question from a prior turn must not
  // leak into a fresh turn — the newer turn_started resets the window.
  it("does not carry an open ask_user_question into a new turn", () => {
    expect(
      foldEventsState([
        { type: "turn_started" },
        { type: "tool_started", tool_name: "ask_user_question" },
        { type: "turn_started" },
      ]),
    ).toBe("thinking");
  });

  it("does not promote ordinary open tools (read_file)", () => {
    expect(
      foldEventsState([
        { type: "tool_started", tool_name: "read_file" },
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

  // /goal planner window: between goal_planner_fired and the main
  // turn_started there is no open turn, so without this recognition the
  // fold would fall through to the stale turn_ended and paint waiting.
  it("maps goal_planner_fired → thinking", () => {
    expect(
      foldEventsState([{ type: "turn_ended" }, { type: "goal_planner_fired" }]),
    ).toBe("thinking");
    // completed alone falls back to the last real boundary
    expect(
      foldEventsState([
        { type: "turn_ended" },
        { type: "goal_planner_fired" },
        { type: "goal_planner_completed" },
      ]),
    ).toBe("waiting");
    // happy path: turn_started after the planner window wins on its own
    expect(
      foldEventsState([
        { type: "turn_ended" },
        { type: "goal_planner_fired" },
        { type: "goal_planner_completed" },
        { type: "turn_started" },
      ]),
    ).toBe("thinking");
    // sequential re-open: a later fire is active again
    expect(
      foldEventsState([
        { type: "turn_ended" },
        { type: "goal_planner_fired" },
        { type: "goal_planner_completed" },
        { type: "goal_planner_fired" },
      ]),
    ).toBe("thinking");
    // completed with no prior fire is a no-op closer
    expect(
      foldEventsState([
        { type: "turn_ended" },
        { type: "goal_planner_completed" },
      ]),
    ).toBe("waiting");
    // nested multi-fire: stacked completes close every open fire
    expect(
      foldEventsState([
        { type: "turn_ended" },
        { type: "goal_planner_fired" },
        { type: "goal_planner_fired" },
        { type: "goal_planner_completed" },
        { type: "goal_planner_completed" },
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

  it("includes signalsPath on a matched session", () => {
    writeSession({
      cwd,
      id,
      events: [{ type: "turn_started" }],
    });
    writeActiveSessions([{ session_id: id, pid: 4242, cwd }]);
    const session = resolveGrokSession(4242, cwd);
    expect(session?.signalsPath).toBe(signalsPathFor(cwd, id));
  });
});

describe("readContextTokens / deriveGrokInfo", () => {
  it("reads contextTokensUsed from signals.json", () => {
    const cwd = "/tmp/proj";
    const id = "sess-tokens";
    writeSession({ cwd, id, events: [{ type: "turn_started" }] });
    fs.writeFileSync(
      signalsPathFor(cwd, id),
      JSON.stringify({
        contextTokensUsed: 247658,
        contextWindowTokens: 500000,
      }),
    );
    expect(readContextTokens(signalsPathFor(cwd, id))).toBe(247658);

    writeActiveSessions([{ session_id: id, pid: 7, cwd }]);
    const session = resolveGrokSession(7, cwd);
    expect(session).not.toBeNull();
    const info = deriveGrokInfo(session!);
    expect(info.contextTokens).toBe(247658);
  });

  it("returns null contextTokens when signals.json is absent", () => {
    const cwd = "/tmp/proj";
    const id = "sess-no-sig";
    writeSession({ cwd, id, events: [{ type: "turn_started" }] });
    writeActiveSessions([{ session_id: id, pid: 8, cwd }]);
    const info = deriveGrokInfo(resolveGrokSession(8, cwd)!);
    expect(info.contextTokens).toBeNull();
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
