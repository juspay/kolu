import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deriveState } from "./core.ts";

// --- #1754: claude-code live state can lie on a fast turn ---
//
// On a fast/short turn kolu's claude-code live state can stick on a *working*
// state (`thinking`) after the turn has fully completed and never reconcile to
// `waiting` — a permanently lying pill. #1754 (and its two correcting comments)
// isolate the two mechanisms that are actually reproducible against today's
// code; each RED below pins one, reproduced first per #1690.
//
// NB the issue's ORIGINAL framing ("watcher attaches after the write and only
// tails, so it never sees the completion") is REFUTED by today's code and is
// deliberately NOT tested as a RED: every check reads a 256 KB tail
// (`TAIL_BYTES`) and `setupTranscriptWatching` fires an immediate
// `onTranscriptMaybeChanged` at attach, so a transcript already carrying
// `end_turn` at attach derives `waiting` immediately (verified by reproduction).
// The real defect is the OTHER half — the completion append that lands AFTER
// attach and whose fs.watch event is coalesced/dropped (Half 2) — pinned below.

describe("#1754 mechanism 2 — stop_reason fold strands `thinking`", () => {
  // A completed assistant reply whose turn has yielded, but whose `stop_reason`
  // is NOT `end_turn`. Real Anthropic terminal reasons (`max_tokens`,
  // `stop_sequence`) and a Messages-API-emulation reason (`stop`, ollama's shape
  // — the issue's named culprit) all fall through the fold's
  // `assistant + end_turn → waiting` / `assistant + tool_use → tool_use` cases
  // into the bare `assistant → thinking` branch. None of these is `tool_use`
  // (no further work is queued), so the turn HAS ended — the pill must read
  // `waiting`, not spin `thinking` forever. Fails today: all three derive
  // `thinking`.
  const YIELDED_NON_END_TURN = ["stop", "max_tokens", "stop_sequence"] as const;

  it.fails.each(
    YIELDED_NON_END_TURN,
  )("assistant with stop_reason=%s (turn yielded, not a tool call) → waiting", (stopReason) => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason: stopReason, model: "claude-opus-4-8" },
    });
    expect(deriveState([line])?.state).toBe("waiting");
  });
});

describe("#1754 mechanism 1 — completion append after attach must reconcile", () => {
  // Half 2, the ACTUAL flake: the terminal `end_turn` lands AFTER the watcher
  // has attached (on a fast turn), and its fs.watch event is coalesced/dropped
  // — most reliably on macOS kqueue, but structurally possible anywhere. Today
  // the watcher reconciles ONLY on an fs.watch fire (a trailing `thinking` that
  // is not orphaned arms no decay recheck — `decayTransientState` returns
  // `recheckAt: null`), so a missed completion event strands `thinking` for the
  // whole poll window. The fix is an fs.watch-independent re-read (a bounded
  // re-poll / re-stat while a working state is published) so a dropped event
  // can't strand a completed turn.
  //
  // fs.watch is neutralized for the whole test so NO append ever produces an
  // event — this isolates exactly the coalesced-miss case deterministically
  // (the real OS drop is timing-dependent and can't be forced). A correct fix
  // reconciles to `waiting` purely off its own timer; today it stays `thinking`.
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

  it.fails("reconciles to `waiting` after a post-attach completion append with no watch event", async () => {
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
      // nothing (coalesced/dropped). A correct watcher re-reads off its own
      // timer within a bounded window and publishes `waiting`.
      fs.appendFileSync(p, `${endTurn()}\n`);
      expect(await waitForState(state, "waiting", 4000)).toBe("waiting");
    } finally {
      watcher.destroy();
      watchSpy.mockRestore();
    }
  }, 20_000);
});
