/**
 * OpenCode core — pure functions and IO helpers for detecting OpenCode
 * sessions and deriving state from its SQLite database.
 *
 * No dependency on server internals (no updateServerMetadata, no TerminalProcess).
 * The server's adapter imports these and wires them into the metadata system.
 *
 * Architecture: OpenCode (TUI mode) is a single process that owns
 * `~/.local/share/opencode/opencode.db` directly via SQLite WAL mode.
 * The TUI does NOT expose an HTTP server by default — that's `opencode serve`.
 * So the only way to observe TUI sessions is to read the SQLite DB directly.
 *
 * Read concurrency is safe because OpenCode uses WAL mode — readers don't
 * block writers and vice versa. We open the DB read-only.
 *
 * Schema: OpenCode ≥ 2.0 only. 2.x writes conversations to `session_v2` +
 * `session_message` (one row per message, its parts inline in
 * `data.content[]`); the 1.x `session` / `message` / `part` / `todo` tables
 * survive in an upgraded DB but stop being written at the cutover, so reading
 * them would find a frozen history. There is no 1.x path: a DB without
 * `session_v2` makes every query here throw, and that failure is logged at
 * `error` by `readDb` / `withDb` (see `findSessionsByDirectory` for what the
 * orchestrator does with it).
 *
 * State derivation from the latest conversational message (`type` column):
 *   - "user"                          → "thinking" (waiting for assistant)
 *   - "assistant", no time.completed  → "thinking" (in flight)
 *   - "assistant", finish: "stop"     → "waiting"  (assistant finished)
 *   - "assistant", finish: other      → "thinking" (still working)
 * and a "thinking" assistant is refined by its running tool parts
 * (`runningToolsBucket`) into "tool_use" / "awaiting_user".
 *
 * Structure note: this file holds the leaf module. Peers `session-watcher.ts`,
 * `wal-watcher.ts`, and `agent-adapter.ts` import from here; `index.ts` is
 * a pure barrel re-exporting from all of them plus `schemas.ts` / `config.ts`.
 */

import { DatabaseSync } from "node:sqlite";
import { classifyByAwaiting } from "anyagent";
import type { Logger } from "kolu-shared";
import { readDbList, withDb as sharedWithDb } from "kolu-shared/sqlite";
import { match } from "ts-pattern";
import { OPENCODE_DB_PATH } from "./config.ts";
import type { OpenCodeInfo } from "./schemas.ts";

// --- Database helpers ---

/** OpenCode-specific `withDb` — partial application of anyagent's
 *  shared helper over our `openDb`. Keeps the local call signature so
 *  consumers within this package don't need to change. */
function withDb<T>(
  fn: (db: DatabaseSync) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
  db?: DatabaseSync,
): T | null {
  return sharedWithDb<DatabaseSync, T>(openDb, fn, errorMsg, errorCtx, log, db);
}

// --- Database session lookup ---

/** Cap on the candidate list. The arbiter needs at most one distinct candidate
 *  per terminal sharing the directory, and this query re-runs per terminal on
 *  every reconcile — so an uncapped ORDER BY over a directory a user has run the
 *  agent in for years would re-materialize that whole history each time. Ordered
 *  most-recent-first, so the cap only ever drops sessions older than 64 others in
 *  the same directory, which no plausible number of concurrent terminals reaches. */
const MAX_CANDIDATES = 64;

export interface OpenCodeSession {
  id: string;
  title: string | null;
  directory: string;
  /** Epoch-ms of the session’s earliest message — the same “when did this
   *  conversation begin” the watcher publishes as `AgentInfo.startedAt`, read at
   *  MATCH time because session ownership is arbitrated before any watcher
   *  exists. Null for a session with no messages yet. */
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
 * Empty if no sessions exist for that directory or the DB is absent.
 *
 * `time_updated DESC` is a PREFERENCE, not an answer. `directory` is a property
 * of the repository, not of a terminal, so two OpenCode harnesses in one repo
 * match this same list — answering with only the first row handed both of them
 * the same session and their dock rows converged (juspay/kolu#2057). The
 * orchestrator's ownership arbiter walks the list and gives each terminal a
 * session of its own.
 *
 * A DB with no `session_v2` (OpenCode < 2.0) makes the prepare throw: `readDb`
 * logs it at `error` ("opencode session query failed", the SQLite message
 * naming the missing table) and this returns `null`. Only a missing DB FILE is
 * swallowed (`openDb`'s ENOENT → `[]`). `null` is the adapter contract's
 * "could not read the store", so the orchestrator holds the terminal's previous
 * match rather than releasing it — for a pre-2.0 DB there never was one, so the
 * terminal shows no OpenCode row and the error line says why, every reconcile.
 */
export function findSessionsByDirectory(
  directory: string,
  log?: Logger,
  db?: DatabaseSync,
): OpenCodeSession[] | null {
  // `readDb`, not `withDb` — see the twin in kolu-codex's `core.ts`: the
  // ownership arbiter releases a terminal's session on an empty list, so a
  // caught query error must not wear the same shape as "this directory has no
  // sessions". A missing database IS that second fact.
  //
  // `started_at` is the same "when did this conversation begin" that
  // `getSessionStartedAt` reads for the watcher, folded into this one query as a
  // correlated MIN over `session_message_session_time_created_id_idx`
  // (session_id, time_created, id) — an index seek per row rather than a round
  // trip per candidate. It rides the match result because session ownership is
  // arbitrated before any watcher exists, and without it a terminal could never
  // tell its own session from an earlier run's in the same directory.
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

// --- Session title refresh ---

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

// --- Session start time ---

/**
 * Read the session's start time — the `time_created` (epoch-ms) of its
 * earliest message. One indexed query against (session_id, time_created),
 * `LIMIT 1` so it touches a single row. Returns null when the session has
 * no messages yet (a brand-new session): the caller retries on the next
 * WAL event until the first message lands, then caches the result (the
 * value is immutable once a message exists).
 */
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

// --- Latest assistant message ---

/**
 * Read the session-scoped facts that live on assistant messages: the model the
 * newest assistant message ran on, and the context-window token count.
 *
 * Independent of `deriveSessionState` because the signals terminate
 * differently: state pivots on the newest conversational message of either
 * type, but these two only live on assistant messages — taking them from the
 * single latest message would blank both whenever the user's prompt is the
 * newest row, i.e. throughout the Thinking window. For the model that is not
 * merely a blank: the wire's `model` means one thing across every integration
 * — see `AgentInfoShape.model`.
 *
 * `contextTokens` is OpenCode's own context-usage number, so the badge agrees
 * with the TUI's footer/sidebar. Upstream (v2.0.29) `lastAssistantWithUsage`
 * (`packages/client/src/solid/usage.ts`) picks the newest assistant message
 * that HAS `tokens`, after the last completed compaction and before the
 * session's revert boundary (`session.revert.messageID`); `contextUsage`
 * (`packages/tui/src/util/session.ts`) sums `input + output + reasoning +
 * cache.read + cache.write` (`TokenUsage.total`) and shows nothing when that
 * is ≤ 0. `latestUsageRow` is that selection; the sum is `contextTokensOf`. The streaming assistant carries no `tokens` yet, so the
 * count stays on the previous step instead of blanking mid-turn.
 *
 * The message queries ride `session_message_session_type_seq_idx`
 * (session_id, type, seq) and stop at the first row.
 *
 * `null` is `withDb`'s documented fold and carries THREE causes: the session
 * has no assistant message yet, the query threw, or the newest assistant blob
 * would not parse (logged at `error`). The first is an answer — "nothing to
 * report"; the other two are ignorance, and a caller that must not publish
 * "this session has no model" on a corrupt row is the case `readDb` exists for
 * (see `sqlite/with-db.ts`). The watcher publishes this null straight onto the
 * wire, so a schema-drifted build drops the model tag until a readable row
 * lands.
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
      let latestData: MessageData;
      let usageData: MessageData | null;
      try {
        latestData = JSON.parse(latest.data) as MessageData;
        usageData = usage ? (JSON.parse(usage.data) as MessageData) : null;
      } catch (err) {
        // OpenCode writes this JSON itself, so a parse failure is a real
        // anomaly — surface it rather than silently blanking the badge.
        log?.error(
          { err, sessionId },
          "opencode assistant message.data parse failed",
        );
        return null;
      }
      return {
        model: assistantModelLabel(latestData),
        contextTokens: usageData ? contextTokensOf(usageData) : null,
      };
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
  // `?2 IS NULL`: no revert boundary.
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

// --- Tool detection ---

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
 *  the message's `data.content[]` as `{ type: "tool", name, state: { status } }`,
 *  so this is a pure fold over the blob `deriveSessionState` already parsed —
 *  no second read.
 *
 *  Returns `null` when no tools are running (the caller keeps its base
 *  state), `"tool_use"` when at least one real-work tool is in flight,
 *  and `"awaiting_user"` when every running part is in
 *  `AWAITING_USER_TOOLS`. Exported for unit testing. */
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

// --- State derivation ---

/** The conversational `session_message.type` values — the ones state derives
 *  from. 2.x also writes non-conversational rows into the same sequence, such
 *  as `system` (a tool-rename notice), `synthetic` (injected instructions),
 *  `compaction` (a summary) and `idle` (a turn-end marker); none of them says
 *  whose turn it is, and a `system` row is the newest one in many settled
 *  sessions, so the latest message is picked among these two only. */
type ConversationalType = "user" | "assistant";

/** One entry of an assistant message's `data.content[]`. Only the fields we
 *  read. */
export interface ContentPart {
  type?: string;
  name?: string;
  state?: { status?: string };
}

/** Shape of the JSON in `session_message.data` for a user/assistant row.
 *  Only the fields we read. */
interface MessageData {
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
  content?: ContentPart[];
}

/** How one message blob names the model it ran on: the `provider/model`
 *  OpenCode records as `model.providerID` + `model.id` (`anthropic` +
 *  `claude-opus-4-6`), falling back to the id alone, `null` when it names
 *  none. The ONE spelling shared by its two readers — the session-scoped
 *  assistant query (the wire's `model`, a session fact) and the transcript
 *  loader, which labels each message by its own. */
export function assistantModelLabel(
  m: Pick<MessageData, "model">,
): string | null {
  const id = m.model?.id;
  if (!id) return null;
  const provider = m.model?.providerID;
  return provider ? `${provider}/${id}` : id;
}

/** State derived from message JSON content only. Telemetry is a separate
 *  signal (see `getLatestAssistantFacts`) because the latest-message lens this
 *  function provides doesn't match the latest-assistant-message lens those
 *  facts need. */
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
      const row = conn
        .prepare(
          "SELECT type, data FROM session_message WHERE session_id = ? AND type IN ('user', 'assistant') ORDER BY seq DESC LIMIT 1",
        )
        .get(sessionId) as
        | { type: ConversationalType; data: string }
        | undefined;
      if (!row) {
        // Genuinely empty session — an expected-absent condition, logged at
        // the layer that knows the row is missing. A malformed latest row is
        // a different story: parseMessageState logs that as an error below.
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
 *  the latter is logged as an error (OpenCode owns this JSON, so a parse
 *  failure is real schema drift or corruption, not an empty session). Pass
 *  `sessionId` to tag that error. Exported for unit testing. */
export function parseMessageState(
  type: string,
  data: string,
  log?: Logger,
  sessionId?: string,
): ParsedMessageState | null {
  let parsed: MessageData;
  try {
    parsed = JSON.parse(data) as MessageData;
  } catch (err) {
    // Distinct from "no row": there IS a latest message, we just can't read
    // it. Surface it as a dropped-state error so the watcher never reports
    // it as the benign "no messages yet". Mirrors
    // getLatestAssistantFacts' handling of the same blob — same
    // `{ err, sessionId }` shape, same error level.
    log?.error({ err, sessionId }, "opencode message.data parse failed");
    return null;
  }

  return match(type)
    .with("user", () => ({ state: "thinking" as const }))
    .with("assistant", () => {
      // Assistant message with completion timestamp + clean stop = waiting
      if (parsed.time?.completed && parsed.finish === "stop") {
        return { state: "waiting" as const };
      }
      // Otherwise still working (no completion yet, or a non-stop finish
      // like "tool-calls"): a running tool part refines "thinking" into
      // "tool_use" / "awaiting_user".
      return {
        state: runningToolsBucket(parsed.content) ?? ("thinking" as const),
      };
    })
    .otherwise(() => null);
}
