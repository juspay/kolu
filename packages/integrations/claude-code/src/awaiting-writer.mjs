#!/usr/bin/env node
/**
 * kolu Claude Code hook writer (issue #905).
 *
 * Invoked by the Claude Code `PreToolUse` ("set") and `PostToolUse` ("clear")
 * hooks for the `AskUserQuestion|ExitPlanMode` matcher. On "set" it drops a
 * per-session sidecar at `<AWAITING_DIR>/<session_id>.json`; on "clear" it
 * removes it. kolu's session-watcher reads that sidecar to surface the
 * "awaiting input" state during the wait window — the Claude Agent SDK buffers
 * the in-flight `tool_use` message off-disk until the user answers, so no
 * JSONL-polling strategy can see it.
 *
 * HARD CONTRACT — never block or fail the agent:
 *   - Zero dependencies (no kolu imports, no tsx). Plain `node` cold-start is
 *     tens of ms, far under Claude's hook timeout.
 *   - Every code path is wrapped so the process ALWAYS `process.exit(0)`.
 *     Claude only blocks the tool on exit code 2; by never exiting non-zero we
 *     guarantee fail-open. A broken/missing/locked sidecar dir degrades to the
 *     pre-#905 "no signal" behavior, it never wedges the agent.
 *   - One synchronous stdin read + one atomic `writeFileSync`+`renameSync`
 *     (set) or one `unlinkSync` (clear). The rename makes the write atomic so
 *     the watcher never reads a half-written file.
 *
 * This file is shipped as a source asset and copied verbatim by the server's
 * `claudeHooks.ts` into `~/.claude/kolu-hooks/awaiting-writer.mjs`.
 */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function awaitingDir() {
  return (
    process.env.KOLU_CLAUDE_AWAITING_DIR ||
    join(homedir(), ".claude", "kolu-awaiting")
  );
}

/** Best-effort question + options from the hook's `tool_input`. Detection is
 *  presence-only, so any shape mismatch degrades to `{ question: null,
 *  options: [] }` — the sidecar is still written and the SIGNAL still fires.
 *   - AskUserQuestion: `{ questions: [{ question, options: [{label}|string] }] }`
 *   - ExitPlanMode:    `{ plan }` — no discrete question/options. */
function extractPrompt(payload) {
  try {
    const input = payload.tool_input ?? {};
    const q = Array.isArray(input.questions) ? input.questions[0] : null;
    if (q && typeof q.question === "string") {
      const options = Array.isArray(q.options)
        ? q.options
            .map((o) => (typeof o === "string" ? o : o?.label))
            .filter((s) => typeof s === "string")
        : [];
      return { question: q.question, options };
    }
  } catch {
    // fall through to the empty prompt
  }
  return { question: null, options: [] };
}

function main() {
  const mode = process.argv[2]; // "set" | "clear"

  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    // no stdin — nothing to key on
  }
  let payload = {};
  try {
    payload = JSON.parse(stdin) || {};
  } catch {
    payload = {};
  }

  const sessionId =
    typeof payload.session_id === "string" ? payload.session_id : null;
  if (!sessionId) return; // can't key the sidecar without a session id

  const file = join(awaitingDir(), `${sessionId}.json`);

  if (mode === "clear") {
    try {
      unlinkSync(file);
    } catch {
      // already gone (ENOENT) or unremovable — fine
    }
    return;
  }

  // mode === "set" (PreToolUse)
  const { question, options } = extractPrompt(payload);
  const body = JSON.stringify({
    sessionId,
    tool_name: typeof payload.tool_name === "string" ? payload.tool_name : null,
    question,
    options,
    ts: Date.now(),
  });
  try {
    mkdirSync(awaitingDir(), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, file); // atomic: watcher never sees a partial write
  } catch {
    // any IO failure → no sidecar → degrade to pre-#905 behavior
  }
}

try {
  main();
} catch {
  // unreachable in practice (main swallows its own IO), but the outer guard
  // makes the exit-0 contract structural: no path can throw past here.
}
process.exit(0);
