/**
 * OpenCode state reader — derives agent state from the global SQLite database.
 *
 * OpenCode (anomalyco/opencode, TypeScript) stores data at ~/.local/share/opencode/opencode.db.
 * Sessions are scoped by `directory` field. State is derived from the latest parts:
 * - thinking:  latest message is "user", or latest part is "step-start" (no matching step-finish)
 * - tool_use:  latest step-finish has reason "tool-calls"
 * - waiting:   latest step-finish has reason "stop"
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { AgentInfo, AgentState } from "kolu-common";
import { log } from "../log.ts";

const plog = log.child({ provider: "opencode" });

/** Global OpenCode data directory. */
const OPENCODE_DATA_DIR =
  process.env.OPENCODE_DATA_DIR ??
  path.join(os.homedir(), ".local", "share", "opencode");

const DB_PATH = path.join(OPENCODE_DATA_DIR, "opencode.db");

/** Stale threshold — don't report state from an old session. */
const STALE_THRESHOLD_MS = 30_000;

/** Derive state from the latest step part's type and reason. */
export function deriveOpenCodeState(
  partType: string,
  reason: string | null,
  messageRole: string,
): AgentState {
  // If the latest message is from the user, agent is about to think
  if (messageRole === "user") return "thinking";

  if (partType === "step-start") return "thinking";
  if (partType === "step-finish") {
    if (reason === "tool-calls") return "tool_use";
    // "stop", "cancel", "error", etc. → waiting
    return "waiting";
  }
  // reasoning, text, tool parts mid-step → thinking
  return "thinking";
}

/**
 * Read OpenCode agent state for a terminal's working directory.
 * Queries the global SQLite DB for the latest session matching the CWD.
 *
 * Requires `sqlite3` CLI (added to nix runtime deps).
 */
export function readOpenCodeState(cwd: string): AgentInfo | null {
  // Fast check: does the DB exist and was it modified recently?
  // Check both .db and .db-wal — WAL mode writes go to the WAL file,
  // so the main .db mtime may lag behind active usage.
  try {
    const dbMtime = fs.statSync(DB_PATH).mtimeMs;
    let walMtime = 0;
    try {
      walMtime = fs.statSync(DB_PATH + "-wal").mtimeMs;
    } catch {
      // No WAL file — DB may use journal mode instead
    }
    const latestMtime = Math.max(dbMtime, walMtime);
    if (Date.now() - latestMtime > STALE_THRESHOLD_MS) return null;
  } catch {
    // DB doesn't exist — OpenCode not installed
    return null;
  }

  try {
    // Find the latest session for this CWD, then its latest message + part.
    // The step-start/step-finish parts tell us the agent's current state.
    const query = `
      SELECT
        m_role,
        p_type,
        p_reason,
        s_id
      FROM (
        SELECT
          json_extract(m.data, '$.role') as m_role,
          json_extract(p.data, '$.type') as p_type,
          json_extract(p.data, '$.reason') as p_reason,
          s.id as s_id,
          ROW_NUMBER() OVER (ORDER BY p.time_updated DESC) as rn
        FROM part p
        JOIN message m ON p.message_id = m.id
        JOIN session s ON m.session_id = s.id
        WHERE s.parent_id IS NULL
          AND s.directory = '${cwd.replace(/'/g, "''")}'
          AND s.time_archived IS NULL
      ) WHERE rn = 1
    `;

    // execFileSync avoids shell — no injection risk from CWD paths
    const result = execFileSync("sqlite3", ["-json", DB_PATH, query], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const trimmed = result.trim();
    if (!trimmed || trimmed === "[]") return null;

    const rows = JSON.parse(trimmed);
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const row = rows[0] as {
      m_role: string;
      p_type: string;
      p_reason: string | null;
      s_id: string;
    };

    const state = deriveOpenCodeState(row.p_type, row.p_reason, row.m_role);

    return {
      kind: "opencode",
      state,
      sessionId: row.s_id,
      model: null,
    };
  } catch (err) {
    plog.warn({ err, cwd }, "failed to read opencode state");
    return null;
  }
}
