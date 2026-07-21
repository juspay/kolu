import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  APPEND_REPOLL_MS,
  APPEND_SETTLE_WINDOW_MS,
  appendRepollDeadline,
  deriveState,
  TRANSIENT_STALE_MS,
} from "./core.ts";

// --- #1754: claude-code live state can lie on a fast turn ---
//
// On a fast/short turn kolu's claude-code live state can stick on a *working*
// state (`thinking`) after the turn has fully completed and never reconcile to
// `waiting` — a permanently lying pill. #1754 (and its two correcting comments)
// isolate the two mechanisms that are actually reproducible against today's
// code; the fix folds them both. Reproduced first per #1690.
//
// NB the issue's ORIGINAL framing ("watcher attaches after the write and only
// tails, so it never sees the completion") is REFUTED by the code and is NOT
// tested: every check reads a 256 KB tail (`TAIL_BYTES`) and
// `setupTranscriptWatching` fires an immediate `onTranscriptMaybeChanged` at
// attach, so a transcript already carrying `end_turn` at attach derives
// `waiting` immediately (verified by reproduction). The real defect is the
// OTHER half — the completion append that lands AFTER attach and whose fs.watch
// event is coalesced/dropped (Half 2) — pinned by mechanism 1 below.

describe("#1754 M2 — stop_reason fold: a yielded turn reads `waiting`", () => {
  // A completed assistant reply whose turn has yielded but whose `stop_reason`
  // is NOT `end_turn`. Real Anthropic terminal reasons (`max_tokens`,
  // `stop_sequence`, `refusal`) and a Messages-API-emulation reason (`stop`,
  // ollama's shape — the issue's named culprit) all fall through the fold's
  // `end_turn`/`tool_use` arms into the assistant fallthrough. None is a
  // CONTINUATION reason, so the turn HAS ended → `waiting`, not stuck
  // `thinking`. (Pre-fix: all derived `thinking`.)
  const YIELDED_TERMINAL = [
    "stop",
    "max_tokens",
    "stop_sequence",
    "refusal", // C1: locks the "populated non-continuation ⇒ waiting" direction
  ] as const;

  it.each(
    YIELDED_TERMINAL,
  )("assistant with stop_reason=%s (turn yielded) → waiting", (stopReason) => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason: stopReason, model: "claude-opus-4-8" },
    });
    expect(deriveState([line])?.state).toBe("waiting");
  });

  // C1 — the sharpest gap the gate flagged: a fix spelled `stopReason !== null
  // && stopReason !== "tool_use"` passes every `waiting` pin above while
  // silently clearing `pause_turn` early. `pause_turn` is a CONTINUATION reason
  // (the harness resumes the turn), so it MUST stay a working state; and a
  // null/streaming stop_reason is a not-yet-finalized message. These pin the
  // continuation direction so a wrong deny-list can't pass.
  it.each([
    { stop_reason: "pause_turn", label: "pause_turn (turn will resume)" },
    { stop_reason: null, label: "null (message not finalized)" },
  ])("assistant with stop_reason=$label stays thinking", ({ stop_reason }) => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason, model: "claude-opus-4-8" },
    });
    expect(deriveState([line])?.state).toBe("thinking");
  });

  // C4 — M2 widens `running_background` eligibility: a truncated turn
  // (`max_tokens`) that reaches `waiting` and holds a live workflow runId IS
  // busy-waiting, so it must promote — today only `end_turn` did. (Pre-fix:
  // `max_tokens` → `thinking`, never promoted.)
  it("promotes a `max_tokens` turn holding a live workflow to running_background", () => {
    const maxTokens = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "max_tokens", model: "claude-opus-4-8" },
    });
    expect(
      deriveState([maxTokens], [{ taskId: "t1", runId: "wf_1" }])?.state,
    ).toBe("running_background");
  });
});

describe("#1754 M1 — appendRepollDeadline (append-robust re-poll policy)", () => {
  const now = 1_700_000_000_000;

  it.each([
    "thinking",
    "tool_use",
  ] as const)("arms a re-poll for a stranding-prone working state (%s) within the settle window", (state) => {
    // Net-new for `thinking`: `decayTransientState` returns null for a live
    // (non-orphaned) thinking, so this is the ONLY recheck that recovers a
    // dropped completion event.
    expect(appendRepollDeadline(state, 200, now)).toBe(now + APPEND_REPOLL_MS);
  });

  it.each([
    "waiting",
    "running_background",
    "awaiting_user",
  ] as const)("never arms a re-poll for terminal state %s (self-terminating)", (state) => {
    expect(appendRepollDeadline(state, 200, now)).toBeNull();
  });

  it("stops re-polling once the transcript has been quiet past the settle window", () => {
    // A dropped fs.watch event can only occur near a write; polling this far
    // from the last write recovers nothing (the correctness bound, not cost).
    expect(
      appendRepollDeadline("thinking", APPEND_SETTLE_WINDOW_MS + 1, now),
    ).toBeNull();
  });

  it("does not re-poll when the transcript quiet is unknown (stat failed)", () => {
    expect(appendRepollDeadline("thinking", null, now)).toBeNull();
  });

  it("tightens a `tool_use` recheck far below the 2-min decay window", () => {
    // decay re-arms tool_use at TRANSIENT_STALE_MS; the re-poll fires first.
    expect(appendRepollDeadline("tool_use", 200, now)).toBeLessThan(
      now + TRANSIENT_STALE_MS,
    );
  });
});

describe("#1754 M1 — watcher reconciles a missed completion append", () => {
  // Half 2, the ACTUAL flake: the terminal `end_turn` lands AFTER the watcher
  // attaches (fast turn), and its fs.watch event is coalesced/dropped. fs.watch
  // is neutralized for the whole test so NO append ever produces an event —
  // this isolates the coalesced-miss case deterministically (the real OS drop
  // is timing-dependent). A correct watcher reconciles to `waiting` purely off
  // its own append re-poll timer. (Pre-fix: stayed `thinking` forever.)
  let tmpDir: string;
  let createSessionWatcher: typeof import("./index.ts").createSessionWatcher;
  let encodeProjectPath: typeof import("./index.ts").encodeProjectPath;
  const sessionId = "stuck-state-session";
  const cwd = "/home/user/stuck-state-project";
  const session = { pid: 1, sessionId, cwd };
  const noopLog = { debug() {}, info() {}, warn() {}, error() {} };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-stuck-state-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();
    const mod = await import("./index.ts");
    createSessionWatcher = mod.createSessionWatcher;
    encodeProjectPath = mod.encodeProjectPath;
  });
  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const projectDir = () => path.join(tmpDir, encodeProjectPath(cwd));
  const transcriptPath = () => path.join(projectDir(), `${sessionId}.jsonl`);
  const endTurn = () =>
    JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn", model: "claude-opus-4-8" },
    });
  const userPrompt = () =>
    JSON.stringify({ type: "user", message: { content: "hi" } });

  /** Poll the latest emitted state until it equals `want` or the deadline
   *  passes; returns the last observed state. No `onTick` re-fire (unlike the
   *  fork-lifecycle harness) — the point is that reconciliation must NOT depend
   *  on a re-delivered fs event. */
  async function waitForState(
    latest: () => string | null,
    want: string,
    timeoutMs: number,
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (latest() === want) return want;
      await new Promise((r) => setTimeout(r, 25));
    }
    return latest();
  }

  it("reconciles to `waiting` after a post-attach completion append with no watch event", async () => {
    const watchSpy = vi
      .spyOn(fs, "watch")
      .mockImplementation(() => ({ close() {} }) as unknown as fs.FSWatcher);
    const p = transcriptPath();
    fs.mkdirSync(projectDir(), { recursive: true });
    // Attach while the tail is a bare user prompt → `thinking`.
    fs.writeFileSync(p, `${userPrompt()}\n`);
    const emitted: import("./index.ts").ClaudeCodeInfo[] = [];
    const watcher = createSessionWatcher(
      session,
      (i) => emitted.push(i),
      noopLog,
    );
    const state = () => emitted.at(-1)?.state ?? null;
    try {
      expect(await waitForState(state, "thinking", 1000)).toBe("thinking");
      // The turn completes: `end_turn` is appended, but fs.watch delivers
      // nothing (coalesced/dropped). The watcher's own append re-poll re-reads
      // the tail within a bounded window and publishes `waiting`.
      fs.appendFileSync(p, `${endTurn()}\n`);
      expect(await waitForState(state, "waiting", 4000)).toBe("waiting");
    } finally {
      watcher.destroy();
      watchSpy.mockRestore();
    }
  }, 20_000);
});
