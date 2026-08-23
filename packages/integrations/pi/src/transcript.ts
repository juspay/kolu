/** One-shot transcript loader for the HTML export feature.
 *
 *  Pi's session JSONL lines carry one entry each; only `message` entries
 *  become conversation IR events, and within them only the four model-turn
 *  roles. Everything else — the `session` header, `model_change` /
 *  `thinking_level_change`, `compaction` / `branch_summary` summaries,
 *  `label`, `custom` / `custom_message`, and the interactive `bashExecution`
 *  / `custom` message roles — is state-derivation or extension material, not
 *  conversation, so it is skipped.
 *
 *  Entries form a tree (`id`/`parentId`) because pi supports in-file
 *  branching (`/tree` navigation): abandoned branches stay in the file
 *  interleaved with the live conversation. The export walks the parentId
 *  chain back from the file's LAST entry — pi's own `buildContextEntries()`
 *  does the same to reconstruct the active path — and emits only entries on
 *  that chain, in file order. Abandoned branches, which a dead file cannot
 *  present as anything but confusion, are dropped. */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import {
  type Fetcher,
  parseIsoTimestamp,
  type ToolInput,
  type Transcript,
  type TranscriptEvent,
} from "kolu-transcript-core";
import { parseSessionFileName, sessionDirFor } from "./core.ts";

interface PiEntry {
  id?: string;
  parentId?: string | null;
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    /** assistant toolCall blocks + toolResult envelope fields. */
    toolCallId?: string;
    isError?: boolean;
  };
}

/** Pull plain text out of pi's `content` string-or-block-array field. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}

/** Map a pi toolCall name + its already-parsed arguments onto the typed
 *  `ToolInput` union. Pi's built-ins read like a smaller Claude set
 *  (`read` / `bash` / `edit` / `write`); extension tools are namespaced
 *  freely, so anything unrecognized falls through to `unknown` with the
 *  raw arguments intact. Exported for tests. */
export function normalizePiToolInput(
  toolName: string,
  args: unknown,
): ToolInput {
  const o =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)
      : {};
  const str = (k: string): string =>
    typeof o[k] === "string" ? (o[k] as string) : "";
  switch (toolName) {
    case "read":
      return { kind: "read", filePath: str("path") || str("filePath") };
    case "bash":
      return { kind: "bash", command: str("command") };
    case "write":
      return { kind: "write", filePath: str("path"), content: str("content") };
    case "edit":
      return {
        kind: "edit",
        filePath: str("path"),
        edits: [{ oldText: str("oldText"), newText: str("newText") }],
      };
    default:
      return { kind: "unknown", toolName, raw: args };
  }
}

function eventsFromEntry(entry: PiEntry): TranscriptEvent[] {
  if (entry.type !== "message") return [];
  const msg = entry.message;
  if (!msg) return [];
  const ts = parseIsoTimestamp(entry.timestamp);

  switch (msg.role) {
    case "user": {
      const text = contentToText(msg.content);
      return text ? [{ kind: "user", text, ts }] : [];
    }
    case "assistant": {
      if (!Array.isArray(msg.content)) return [];
      const events: TranscriptEvent[] = [];
      const texts: string[] = [];
      for (const block of msg.content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "thinking" && typeof b.thinking === "string") {
          events.push({ kind: "reasoning", text: b.thinking, ts });
        } else if (b.type === "text" && typeof b.text === "string") {
          texts.push(b.text);
        } else if (b.type === "toolCall" && typeof b.name === "string") {
          events.push({
            kind: "tool_call",
            id: typeof b.id === "string" ? b.id : null,
            toolName: b.name,
            inputs: normalizePiToolInput(b.name, b.arguments),
            ts,
          });
        }
      }
      if (texts.length > 0) {
        events.push({
          kind: "assistant",
          text: texts.join("\n"),
          model: typeof msg.model === "string" ? msg.model : null,
          ts,
        });
      }
      return events;
    }
    case "toolResult":
      return [
        {
          kind: "tool_result",
          id: msg.toolCallId ?? null,
          output: contentToText(msg.content),
          isError: msg.isError === true,
          ts,
        },
      ];
    default:
      return [];
  }
}

/** Parse a pi session JSONL file's contents into transcript events,
 *  following pi's tree semantics: entries carry `id`/`parentId` and form a
 *  branching tree (see pi's docs/session-format.md — `/tree` navigation
 *  re-points the leaf to an older entry). The live conversation is the path
 *  from the file's last entry back to the root; entries off that path belong
 *  to abandoned branches and are dropped. Entries without an `id` (older pi
 *  versions) pass through, matching pre-tree pi files. Exported for tests. */
export function parsePiTranscript(content: string): TranscriptEvent[] {
  const ordered: PiEntry[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    try {
      // Malformed line — skip. A truncated final write is the only
      // practical failure mode; one corrupt entry must not fail the export.
      ordered.push(JSON.parse(line) as PiEntry);
    } catch {
      // skip
    }
  }
  const byId = new Map<string, PiEntry>();
  for (const entry of ordered) {
    if (typeof entry.id === "string") byId.set(entry.id, entry);
  }
  // Tree linkage exists at all? Older pi files carry ids but no parent
  // chain — filter ONLY on a linkage witness so such files render whole.
  const hasLinkage = ordered.some(
    (e) => typeof e.parentId === "string" && byId.has(e.parentId),
  );
  const onActivePath = new Set<string>();
  if (hasLinkage) {
    let cur = [...ordered].reverse().find((e) => typeof e.id === "string");
    while (cur && typeof cur.id === "string" && !onActivePath.has(cur.id)) {
      onActivePath.add(cur.id);
      cur =
        typeof cur.parentId === "string" ? byId.get(cur.parentId) : undefined;
    }
  }
  const events: TranscriptEvent[] = [];
  for (const entry of ordered) {
    if (
      hasLinkage &&
      typeof entry.id === "string" &&
      !onActivePath.has(entry.id)
    )
      continue;
    events.push(...eventsFromEntry(entry));
  }
  return events;
}

/** Resolve the transcript path by scanning the cwd's session directory for
 *  the file whose id matches (pi's `--session <id>` accepts the same id the
 *  filename carries). Returns null when the directory is absent or holds no
 *  such session — the exporter shows "not found", never a fabricated path. */
function findTranscriptPath(
  sessionId: string,
  cwd: string,
  log?: Logger,
): string | null {
  const dir = sessionDirFor(cwd);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    // ENOENT = the directory legitimately doesn't exist (pi never ran in
    // that cwd) — "session not found" is the honest answer. Anything else
    // (EMFILE/EACCES) collapsing to "not found" would lie to the user, so
    // it throws and surfaces as a real export error.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, dir }, "pi: transcript dir unreadable");
      throw err;
    }
    return null;
  }
  for (const name of names) {
    const parsed = parseSessionFileName(name);
    if (parsed?.id === sessionId) return path.join(dir, name);
  }
  return null;
}

/** Read the session JSONL and normalize to the unified IR. Returns null when
 *  the session file can't be located; throws only on a genuine read failure
 *  after the file was positively found (a race mid-export must not render as
 *  "session does not exist"). */
export const loadPiTranscript: Fetcher = (input, log) => {
  // Without a cwd there is no session directory to locate the id in —
  // the same "transcript not findable" null claude-code returns.
  if (input.cwd === null) return null;
  const path = findTranscriptPath(input.sessionId, input.cwd, log);
  if (!path) return null;
  const raw = fs.readFileSync(path, "utf8");
  const transcript: Transcript = {
    agentKind: "pi",
    sessionId: input.sessionId,
    title: input.title,
    repoName: input.repoName,
    cwd: input.cwd,
    model: input.model,
    contextTokens: input.contextTokens,
    pr: input.pr,
    exportedAt: Date.now(),
    events: parsePiTranscript(raw),
  };
  return transcript;
};
