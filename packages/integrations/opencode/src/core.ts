import { DatabaseSync } from "node:sqlite";
import { classifyByAwaiting } from "anyagent";
import type { Logger } from "kolu-shared";
import { readDbList, withDb as sharedWithDb } from "kolu-shared/sqlite";
import { match } from "ts-pattern";
import { OPENCODE_DB_PATH } from "./config.ts";
import type { OpenCodeInfo } from "./schemas.ts";

function withDb<T>(
  fn: (db: DatabaseSync) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
  db?: DatabaseSync,
): T | null {
  return sharedWithDb<DatabaseSync, T>(openDb, fn, errorMsg, errorCtx, log, db);
}

const MAX_CANDIDATES = 64;

export interface OpenCodeSession {
  id: string;
  title: string | null;
  directory: string;
  /** Epoch-ms of the session’s earliest message — the same “when did this
   *  conversation begin” the watcher publishes as `AgentInfo.startedAt`.
   *  Null for a session with no messages yet. */
  startedAt: number | null;
}

/** Open a read-only connection to OpenCode's database. Returns null if absent.
 *  Caller MUST close the returned database when done. */
export function openDb(log?: Logger): DatabaseSync | null {
  try {
    return new DatabaseSync(OPENCODE_DB_PATH, { readOnly: true });
  } catch (err) {
    // ENOENT is the answer "OpenCode has never run here". Anything else is a
    // failure to LOOK — see the twin in kolu-codex core.ts.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    log?.debug({ err, path: OPENCODE_DB_PATH }, "opencode db unavailable");
    return null;
  }
}

/**
 * Every live session for a given directory, most recently updated FIRST.
 * Empty if no sessions exist for that directory or the DB is absent. `null`
 * means the store could not be read.
 *
 * `time_updated DESC` is a PREFERENCE, not an answer. `directory` is a property
 * of the repository, not of a terminal, so two OpenCode harnesses in one repo
 * match this same list — answering with only the first row handed both of them
 * the same session and their dock rows converged (juspay/kolu#2057). The
 * orchestrator's ownership arbiter walks the list and gives each terminal a
 * session of its own.
 */
export function findSessionsByDirectory(
  directory: string,
  log?: Logger,
  db?: DatabaseSync,
): OpenCodeSession[] | null {
  return readDbList(
    openDb,
    (conn) =>
      (
        conn
          .prepare(
            `SELECT s.id, s.title, s.directory, (SELECT MIN(time_created) FROM session_message m WHERE m.session_id = s.id) AS started_at FROM session_v2 s WHERE s.directory = ? AND s.time_archived IS NULL ORDER BY s.time_updated DESC LIMIT ${MAX_CANDIDATES}`,
          )
          .all(directory) as {
          id: string;
          title: string | null;
          directory: string;
          started_at: number | null;
        }[]
      ).map((row) => ({
        id: row.id,
        title: row.title || null,
        directory: row.directory,
        startedAt: row.started_at ?? null,
      })),
    "opencode session query failed",
    { directory },
    log,
    db,
  );
}

/** Re-read the current session title from the DB. Returns null if absent. */
export function getSessionTitle(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): string | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare("SELECT title FROM session_v2 WHERE id = ?")
        .get(sessionId) as { title: string | null } | undefined;
      return row?.title || null;
    },
    "opencode session title query failed",
    { sessionId },
    log,
    db,
  );
}

/** Read the session's start time — the `time_created` (epoch-ms) of its
 *  earliest message. Null when the session has no messages yet. */
export function getSessionStartedAt(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): number | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare(
          "SELECT time_created FROM session_message WHERE session_id = ? ORDER BY time_created ASC LIMIT 1",
        )
        .get(sessionId) as { time_created: number } | undefined;
      return row?.time_created ?? null;
    },
    "opencode session start query failed",
    { sessionId },
    log,
    db,
  );
}

/**
 * Read the session-scoped facts that live on assistant messages: the model the
 * newest assistant message ran on, and the context-window token count.
 *
 * Upstream (v2.0.29) `lastAssistantWithUsage`
 * (`packages/client/src/solid/usage.ts`) picks the newest assistant message
 * that HAS `tokens`, after the last completed compaction and before the
 * session's revert boundary (`session.revert.messageID`); `contextUsage`
 * (`packages/tui/src/util/session.ts`) sums `input + output + reasoning +
 * cache.read + cache.write` (`TokenUsage.total`) and shows nothing when that
 * is ≤ 0.
 *
 * `null` carries THREE causes: the session has no assistant message yet, the
 * query threw, or the newest assistant blob would not parse (logged at
 * `error`).
 */
export function getLatestAssistantFacts(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): { model: string | null; contextTokens: number | null } | null {
  return withDb(
    (conn) => {
      const latest = conn
        .prepare(
          "SELECT data FROM session_message WHERE session_id = ? AND type = 'assistant' ORDER BY seq DESC LIMIT 1",
        )
        .get(sessionId) as { data: string } | undefined;
      if (!latest) return null;
      const usage = latestUsageRow(conn, sessionId);
      try {
        return {
          model: assistantModelLabel(parseData(latest.data)),
          contextTokens: usage ? contextTokensOf(parseData(usage.data)) : null,
        };
      } catch (err) {
        log?.error(
          { err, sessionId },
          "opencode assistant message.data parse failed",
        );
        return null;
      }
    },
    "opencode assistant-facts query failed",
    { sessionId },
    log,
    db,
  );
}

/** The assistant row whose `tokens` fill the context window now — upstream's
 *  `lastAssistantWithUsage` (see `getLatestAssistantFacts`): the newest
 *  assistant row with `tokens`, after the last completed compaction and
 *  before the revert boundary (`session_v2.revert.messageID`; that message
 *  and everything after it are undone). A boundary that names no message
 *  yields nothing, as upstream returns `undefined` for it. */
function latestUsageRow(
  conn: DatabaseSync,
  sessionId: string,
): { data: string } | undefined {
  const revertId =
    (
      conn
        .prepare(
          "SELECT json_extract(revert, '$.messageID') AS id FROM session_v2 WHERE id = ?",
        )
        .get(sessionId) as { id: string | null } | undefined
    )?.id ?? null;
  let bound: number | null = null;
  if (revertId !== null) {
    const row = conn
      .prepare(
        "SELECT seq FROM session_message WHERE session_id = ? AND id = ?",
      )
      .get(sessionId, revertId) as { seq: number } | undefined;
    if (!row) return undefined;
    bound = row.seq;
  }
  return conn
    .prepare(
      `WITH floor AS (
         SELECT COALESCE(MAX(seq), -1) AS seq FROM session_message
          WHERE session_id = ?1 AND type = 'compaction' AND json_extract(data, '$.status') = 'completed'
            AND (?2 IS NULL OR seq < ?2)
       )
       SELECT data FROM session_message
        WHERE session_id = ?1 AND type = 'assistant' AND json_extract(data, '$.tokens') IS NOT NULL
          AND seq > (SELECT seq FROM floor) AND (?2 IS NULL OR seq < ?2)
        ORDER BY seq DESC LIMIT 1`,
    )
    .get(sessionId, bound) as { data: string } | undefined;
}

/** OpenCode's `TokenUsage.total` over one assistant message, `null` when the
 *  message carries no usage or it sums to ≤ 0 (the TUI shows nothing then).
 *  See `getLatestAssistantFacts` for the upstream citation. */
function contextTokensOf(m: MessageData): number | null {
  const t = m.tokens;
  if (!t) return null;
  const total = t.input + t.output + t.reasoning + t.cache.read + t.cache.write;
  return total > 0 ? total : null;
}

/** OpenCode tools whose pending invocation means the agent is awaiting the
 *  human. At v2.0.29 that is the `question` tool alone
 *  (`packages/core/src/tool/plugin/question.ts`, `name = "question"`): it
 *  blocks on the user's reply while its content part sits at
 *  `state.status = "running"`. Plan mode (`packages/core/src/plugin/plan.ts`)
 *  registers no tool. Other interactive flows (`ctx.ask` permission prompts
 *  inside `shell`/`edit`/`write`/etc.) don't surface a distinct tool name —
 *  the part stays `shell`/etc. and is indistinguishable from a real-work
 *  tool. */
const AWAITING_USER_TOOLS: ReadonlySet<string> = new Set(["question"]);

/** Classify the tool parts currently in the "running" state for one
 *  assistant message (the current turn). In 2.x the parts live inline in
 *  the message's `data.content[]` as `{ type: "tool", name, state: { status } }`.
 *  Returns `null` when no tools are running, `"tool_use"` when at least one
 *  real-work tool is in flight, and `"awaiting_user"` when every running part
 *  is in `AWAITING_USER_TOOLS`. */
export function runningToolsBucket(
  content: readonly ContentPart[] | undefined,
): "tool_use" | "awaiting_user" | null {
  let total = 0;
  let awaiting = 0;
  for (const part of content ?? []) {
    if (part.type !== "tool" || part.state?.status !== "running") continue;
    total++;
    if (part.name !== undefined && AWAITING_USER_TOOLS.has(part.name))
      awaiting++;
  }
  if (total === 0) return null;
  return classifyByAwaiting(awaiting, total);
}

/** One entry of an assistant message's `data.content[]` — a `text`,
 *  `reasoning` or `tool` part. Only the fields kolu reads. */
export interface ContentPart {
  type?: string;
  text?: string;
  /** Tool-call id. */
  id?: string;
  /** Tool name. */
  name?: string;
  state?: {
    status?: string;
    input?: unknown;
    /** The tool's output, as content blocks (`{ type: "text", text }`). */
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
    /** A subagent call records its child session here — `sessionID` from
     *  the `subagent` tool, `sessionId` from the older `task` tool. */
    metadata?: { sessionID?: string; sessionId?: string } & Record<
      string,
      unknown
    >;
  };
}

/** Shape of the JSON in `session_message.data` for a user/assistant row.
 *  Only the fields kolu reads. */
export interface MessageData {
  /** A user message's prompt. */
  text?: string;
  model?: { id?: string; providerID?: string };
  finish?: string;
  time?: { created?: number; completed?: number };
  /** Present on an assistant message once OpenCode has accounted the step. */
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  /** An assistant message's parts. */
  content?: ContentPart[];
}

/** Parse a `session_message.data` blob. Throws on malformed JSON. */
export function parseData(data: string): MessageData {
  return JSON.parse(data) as MessageData;
}

/** How one message blob names the model it ran on: the `provider/model`
 *  OpenCode records as `model.providerID` + `model.id` (`anthropic` +
 *  `claude-opus-4-6`), falling back to the id alone, `null` when it names
 *  none. */
export function assistantModelLabel(
  m: Pick<MessageData, "model">,
): string | null {
  const id = m.model?.id;
  if (!id) return null;
  const provider = m.model?.providerID;
  return provider ? `${provider}/${id}` : id;
}

/** State derived from message JSON content only. */
export type ParsedMessageState = {
  state: OpenCodeInfo["state"];
};

/**
 * Read the latest conversational message for a session and derive Kolu state
 * from it. Returns null if the session has no user/assistant messages or the
 * DB is absent.
 *
 * Pass an existing `db` to share a connection with the caller — used by
 * `createOpenCodeWatcher` to avoid opening/closing on every WAL event.
 * If `db` is omitted, opens and closes its own connection.
 */
export function deriveSessionState(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): ParsedMessageState | null {
  return withDb(
    (conn) => {
      // Only the conversational rows say whose turn it is. 2.x also writes
      // non-conversational rows into the same sequence, such as `system` (a
      // tool-rename notice), `synthetic` (injected instructions), `compaction`
      // (a summary) and `idle` (a turn-end marker) — and a `system` row is the
      // newest one in many settled sessions.
      const row = conn
        .prepare(
          "SELECT type, data FROM session_message WHERE session_id = ? AND type IN ('user', 'assistant') ORDER BY seq DESC LIMIT 1",
        )
        .get(sessionId) as { type: string; data: string } | undefined;
      if (!row) {
        log?.debug({ sessionId }, "no messages yet for opencode session");
        return null;
      }
      return parseMessageState(row.type, row.data, log, sessionId);
    },
    "opencode message query failed",
    { sessionId },
    log,
    db,
  );
}

/** Derive state from one message row: its `type` column plus its `data` JSON
 *  blob. Returns null for a type we don't model, and for malformed JSON — but
 *  the latter is logged as an error. Pass `sessionId` to tag that error. */
export function parseMessageState(
  type: string,
  data: string,
  log?: Logger,
  sessionId?: string,
): ParsedMessageState | null {
  let parsed: MessageData;
  try {
    parsed = parseData(data);
  } catch (err) {
    log?.error({ err, sessionId }, "opencode message.data parse failed");
    return null;
  }

  return match(type)
    .with("user", () => ({ state: "thinking" as const }))
    .with("assistant", () => {
      if (parsed.time?.completed && parsed.finish === "stop") {
        return { state: "waiting" as const };
      }
      return {
        state: runningToolsBucket(parsed.content) ?? ("thinking" as const),
      };
    })
    .otherwise(() => null);
}
