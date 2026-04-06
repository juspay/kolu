/**
 * OpenCode state reader — derives agent state from the per-project SQLite database.
 *
 * OpenCode (Go TUI) stores sessions and messages in `.opencode/opencode.db` (SQLite, WAL mode).
 * State is derived from the last assistant message's `parts` JSON:
 * - thinking:  no finish part yet, or role is "user" (API call in flight)
 * - tool_use:  finish.reason === "tool_use"
 * - waiting:   finish.reason === "end_turn" | "canceled" | "error" | "max_tokens"
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AgentInfo, AgentState } from "kolu-common";
import { log } from "../log.ts";

const plog = log.child({ provider: "opencode" });

interface PartWrapper {
  type: string;
  data: { reason?: string; [key: string]: unknown };
}

/** Derive OpenCode agent state from a message's parts JSON. */
export function deriveOpenCodeState(
  role: string,
  partsJson: string,
): AgentState | null {
  if (role === "user" || role === "tool") {
    return "thinking";
  }
  if (role !== "assistant") return null;

  try {
    const parts: PartWrapper[] = JSON.parse(partsJson);
    // Find the finish part
    const finish = parts.find((p) => p.type === "finish");
    if (!finish) {
      // No finish part — still generating
      return "thinking";
    }
    const reason = finish.data?.reason;
    if (reason === "tool_use") return "tool_use";
    // end_turn, canceled, error, max_tokens → waiting for user
    return "waiting";
  } catch {
    // Malformed parts JSON — can't determine state
    return null;
  }
}

/** Stale threshold — don't report state from an old session. */
const STALE_THRESHOLD_MS = 30_000;

/**
 * Read OpenCode agent state from the per-project SQLite database.
 * Returns AgentInfo or null if no active OpenCode session is found.
 *
 * Uses `sqlite3` CLI to avoid a native addon dependency. The query is tiny (one row).
 */
export function readOpenCodeState(cwd: string): AgentInfo | null {
  const dbPath = path.join(cwd, ".opencode", "opencode.db");

  // Fast check: does the DB exist and was it modified recently?
  try {
    const stat = fs.statSync(dbPath);
    if (Date.now() - stat.mtimeMs > STALE_THRESHOLD_MS) return null;
  } catch {
    // DB doesn't exist — OpenCode not initialized in this project
    return null;
  }

  try {
    // execFileSync avoids shell — no injection risk from CWD paths
    const result = execFileSync(
      "sqlite3",
      [
        "-json",
        dbPath,
        "SELECT m.role, m.parts, m.session_id FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.parent_session_id IS NULL ORDER BY m.created_at DESC LIMIT 1",
      ],
      { encoding: "utf8", timeout: 2_000, stdio: ["pipe", "pipe", "pipe"] },
    );

    const rows = JSON.parse(result.trim());
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const row = rows[0] as {
      role: string;
      parts: string;
      session_id: string;
    };
    const state = deriveOpenCodeState(row.role, row.parts);
    if (!state) return null;

    return {
      kind: "opencode",
      state,
      sessionId: row.session_id,
      model: null,
    };
  } catch (err) {
    plog.debug({ err, dbPath }, "failed to read opencode state");
    return null;
  }
}
