/**
 * OpenCode integration — pure functions and IO helpers for detecting
 * OpenCode sessions and deriving state from the REST/SSE API.
 *
 * No dependency on server internals (no updateMetadata, no TerminalProcess).
 * The server's provider imports these and wires them into the metadata system.
 *
 * Detection: queries OpenCode's HTTP API on localhost to find sessions
 * matching a given CWD, then subscribes to SSE events for live state updates.
 *
 * State derivation:
 *   - session.status → busy  → "thinking"
 *   - session.status → idle  → "waiting"
 *   - session.status → retry → "thinking"
 */

import { z } from "zod";
import { match } from "ts-pattern";

// --- OpenCode schemas (single source of truth) ---

export const OpenCodeInfoSchema = z.object({
  kind: z.literal("opencode"),
  /** Current state derived from session status. */
  state: z.enum(["thinking", "tool_use", "waiting"]),
  /** Session ID from OpenCode's API. */
  sessionId: z.string(),
  /** Model identifier if available (e.g. "anthropic/claude-sonnet-4-5"). */
  model: z.string().nullable(),
  /** Session title from OpenCode. */
  summary: z.string().nullable(),
});

export type OpenCodeInfo = z.infer<typeof OpenCodeInfoSchema>;

// --- Configuration ---

/** OpenCode server port, configurable via env for testing. */
export const OPENCODE_PORT = process.env.KOLU_OPENCODE_PORT ?? "4096";

export const OPENCODE_BASE_URL =
  process.env.KOLU_OPENCODE_URL ?? `http://127.0.0.1:${OPENCODE_PORT}`;

// --- REST client ---

type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

/** Check if the OpenCode server is reachable. */
export async function healthCheck(
  signal?: AbortSignal,
  log?: Logger,
): Promise<boolean> {
  try {
    const res = await fetch(`${OPENCODE_BASE_URL}/health`, { signal });
    return res.ok;
  } catch (err) {
    log?.debug({ err }, "opencode health check failed");
    return false;
  }
}

/** OpenCode session info — subset of fields we care about. */
export interface OpenCodeSession {
  id: string;
  title: string | null;
  directory: string;
}

/** List sessions matching a given directory. */
export async function listSessions(
  directory: string,
  signal?: AbortSignal,
  log?: Logger,
): Promise<OpenCodeSession[]> {
  try {
    const url = new URL(`${OPENCODE_BASE_URL}/session`);
    url.searchParams.set("directory", directory);
    const res = await fetch(url, {
      signal,
      headers: { "x-opencode-directory": directory },
    });
    if (!res.ok) {
      log?.debug({ status: res.status }, "opencode session list failed");
      return [];
    }
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (s): s is { id: string; title?: string; directory?: string } =>
          typeof s === "object" &&
          s !== null &&
          "id" in s &&
          typeof (s as Record<string, unknown>).id === "string",
      )
      .map((s) => ({
        id: s.id,
        title: typeof s.title === "string" ? s.title : null,
        directory: typeof s.directory === "string" ? s.directory : directory,
      }));
  } catch (err) {
    log?.debug({ err, directory }, "opencode session list failed");
    return [];
  }
}

/** Session status from the status endpoint. */
export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

/** Get status of all sessions. Returns a map of sessionId → status. */
export async function getSessionStatuses(
  signal?: AbortSignal,
  log?: Logger,
): Promise<Map<string, SessionStatus>> {
  try {
    const res = await fetch(`${OPENCODE_BASE_URL}/session/status`, { signal });
    if (!res.ok) {
      log?.debug({ status: res.status }, "opencode session status failed");
      return new Map();
    }
    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null) return new Map();
    const result = new Map<string, SessionStatus>();
    for (const [id, status] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (typeof status === "object" && status !== null && "type" in status) {
        result.set(id, status as SessionStatus);
      }
    }
    return result;
  } catch (err) {
    log?.debug({ err }, "opencode session status failed");
    return new Map();
  }
}

// --- State derivation ---

/** Map OpenCode session status to Kolu agent state. */
export function deriveState(status: SessionStatus): OpenCodeInfo["state"] {
  return match(status)
    .with({ type: "busy" }, () => "thinking" as const)
    .with({ type: "idle" }, () => "waiting" as const)
    .with({ type: "retry" }, () => "thinking" as const)
    .exhaustive();
}

// --- SSE event stream ---

/** Parsed SSE event from OpenCode's /event endpoint. */
export type OpenCodeEvent =
  | {
      type: "session.status";
      properties: { sessionID: string; status: SessionStatus };
    }
  | {
      type: "session.updated";
      properties: { id: string; title?: string };
    }
  | { type: "heartbeat" }
  | { type: "unknown"; raw: string };

/**
 * Subscribe to OpenCode's SSE event stream. Calls `onEvent` for each
 * parsed event. Returns when the connection closes or is aborted.
 *
 * This is a blocking async function — the caller should run it in the
 * background and use the AbortSignal to stop it.
 */
export async function subscribeToEvents(
  signal: AbortSignal,
  onEvent: (event: OpenCodeEvent) => void,
  log?: Logger,
): Promise<void> {
  const res = await fetch(`${OPENCODE_BASE_URL}/event`, {
    signal,
    headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
  });

  if (!res.ok || !res.body) {
    log?.warn({ status: res.status }, "opencode SSE connection failed");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      let currentData = "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          currentData += line.slice(5).trimStart();
        } else if (line === "" && currentData) {
          // Empty line = end of SSE event
          const event = parseSseData(currentData);
          onEvent(event);
          currentData = "";
        }
      }
    }
  } catch (err) {
    if (!signal.aborted) {
      log?.debug({ err }, "opencode SSE stream error");
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse a single SSE data payload into a typed event. */
function parseSseData(data: string): OpenCodeEvent {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed))
      return { type: "unknown", raw: data };

    const obj = parsed as Record<string, unknown>;
    const eventType = obj.type;

    if (eventType === "session.status") {
      const props = obj.properties as
        | { sessionID?: string; status?: SessionStatus }
        | undefined;
      if (props?.sessionID && props?.status) {
        return {
          type: "session.status",
          properties: {
            sessionID: props.sessionID,
            status: props.status,
          },
        };
      }
    }

    if (eventType === "session.updated") {
      const props = obj.properties as
        | { id?: string; title?: string }
        | undefined;
      if (props?.id) {
        return {
          type: "session.updated",
          properties: { id: props.id, title: props.title },
        };
      }
    }

    if (eventType === "server.heartbeat") {
      return { type: "heartbeat" };
    }

    return { type: "unknown", raw: data };
  } catch {
    // Malformed JSON from the SSE stream — treat as unknown event.
    // The caller (subscribeToEvents) already logs unrecognized events
    // at debug level via the provider's plog, so no separate log here.
    return { type: "unknown", raw: data };
  }
}
