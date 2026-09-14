/** One-shot transcript loader for the HTML export feature.
 *
 *  omp's session JSONL lines carry one entry each; only `message` entries
 *  become conversation IR events, and within them only the four model-turn
 *  roles. Everything else — the line-1 title slot, the `session` header,
 *  `model_change` / `thinking_level_change`, `compaction` / `branch_summary`
 *  summaries, `title_change`, `label`, `custom` — is state-derivation or
 *  extension material, not conversation, so it is skipped.
 *
 *  Entries form a tree (`id`/`parentId`) because omp supports in-file branching
 *  (omp forked pi's session format): abandoned branches stay in the file
 *  interleaved with the live conversation. The export walks the parentId chain
 *  back from the file's LAST entry and emits only entries on that chain, in file
 *  order. Abandoned branches, which a dead file cannot present as anything but
 *  confusion, are dropped.
 *
 *  WHERE the file is: the breadcrumb, and nothing else. `resolveSessions`
 *  records the absolute path omp itself handed kolu, keyed by session id; this
 *  loader reads that map and returns `null` — the `Fetcher` contract's
 *  "transcript not available" value — for a session this padi never observed
 *  live. No cwd glob, no second lookup: omp's session-directory key is lossy,
 *  and the store moves per invocation, so any re-derivation would be a guess. */

import fs from "node:fs";
import {
  type Fetcher,
  parseIsoTimestamp,
  type ToolInput,
  type Transcript,
  type TranscriptEvent,
} from "kolu-transcript-core";
import { match } from "ts-pattern";
import { knownOmpSessionPath } from "./agent-adapter.ts";
import { readTitleSlot } from "./core.ts";
import { ompVocab } from "./schemas.ts";

interface OmpEntry {
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

/** Pull plain text out of omp's `content` string-or-block-array field. */
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

/** Map an omp toolCall name + its already-parsed arguments onto the typed
 *  `ToolInput` union. omp forked pi's built-ins (`read` / `bash` / `edit` /
 *  `write`, with omp's own namespaced additions); anything unrecognized falls
 *  through to `unknown` with the raw arguments intact. Copied from `kolu-pi`'s
 *  equivalent rather than imported — the dependency fence forbids
 *  `kolu-omp` → `kolu-pi`, and the two agents' tool vocabularies are forks that
 *  may drift. Exported for tests. */
export function normalizeOmpToolInput(
  toolName: string,
  args: unknown,
): ToolInput {
  const o =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)
      : {};
  const str = (k: string): string =>
    typeof o[k] === "string" ? (o[k] as string) : "";
  return match(toolName)
    .with(
      "read",
      (): ToolInput => ({
        kind: "read",
        filePath: str("path") || str("filePath"),
      }),
    )
    .with("bash", (): ToolInput => ({ kind: "bash", command: str("command") }))
    .with(
      "write",
      (): ToolInput => ({
        kind: "write",
        filePath: str("path"),
        content: str("content"),
      }),
    )
    .with(
      "edit",
      (): ToolInput => ({
        kind: "edit",
        filePath: str("path"),
        edits: [{ oldText: str("oldText"), newText: str("newText") }],
      }),
    )
    .otherwise((): ToolInput => ({ kind: "unknown", toolName, raw: args }));
}

function eventsFromEntry(entry: OmpEntry): TranscriptEvent[] {
  if (entry.type !== "message") return [];
  const msg = entry.message;
  if (!msg) return [];
  const ts = parseIsoTimestamp(entry.timestamp);

  const userResult = (): TranscriptEvent[] => {
    const text = contentToText(msg.content);
    return text ? [{ kind: "user", text, ts }] : [];
  };
  const assistantResult = (): TranscriptEvent[] => {
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
          inputs: normalizeOmpToolInput(b.name, b.arguments),
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
  };
  const toolResultResult = (): TranscriptEvent[] => [
    {
      kind: "tool_result",
      id: msg.toolCallId ?? null,
      output: contentToText(msg.content),
      isError: msg.isError === true,
      ts,
    },
  ];
  return match(msg.role)
    .with("user", userResult)
    .with("assistant", assistantResult)
    .with("toolResult", toolResultResult)
    .otherwise(() => []);
}

/** Parse an omp session JSONL file's contents into transcript events,
 *  following omp's tree semantics (omp forked pi's format — see
 *  `kolu-pi/transcript.ts` for the shared reasoning): entries carry
 *  `id`/`parentId` and form a branching tree, and the live conversation is the
 *  path from the file's last entry back to the root. Entries off that path
 *  belong to abandoned branches and are dropped. The line-1 title slot and the
 *  `session` header carry no `type: "message"`, so the same gate that drops
 *  every non-conversation entry drops them. Exported for tests. */
export function parseOmpTranscript(content: string): TranscriptEvent[] {
  const ordered: OmpEntry[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    try {
      // Malformed line — skip. A truncated final write is the only practical
      // failure mode; one corrupt entry must not fail the export.
      ordered.push(JSON.parse(line) as OmpEntry);
    } catch {
      // skip
    }
  }
  const byId = new Map<string, OmpEntry>();
  for (const entry of ordered) {
    if (typeof entry.id === "string") byId.set(entry.id, entry);
  }
  // Tree linkage exists at all? An older file with ids but no parent chain
  // renders whole — filter ONLY on a linkage witness.
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

/** Read the session JSONL and normalize to the unified IR, or null when kolu
 *  never observed this session live (no path recorded, so there is nothing to
 *  read — the same "transcript not available" answer the other integrations
 *  give for a session they cannot locate). Throws only on a genuine read
 *  failure after the file was positively recorded: a race mid-export must not
 *  render as "session does not exist".
 *
 *  The title is read from the file's own line-1 title slot rather than taken
 *  from `input.title` — the export renders the FILE, and the live summary the
 *  caller carries came from that identical slot. */
export const loadOmpTranscript: Fetcher = (input, log) => {
  const path = knownOmpSessionPath(input.sessionId);
  if (path === null) return null;
  const title = readTitleSlot(path, log);
  const raw = fs.readFileSync(path, "utf8");
  const transcript: Transcript = {
    agentName: ompVocab.displayName,
    sessionId: input.sessionId,
    title,
    repoName: input.repoName,
    cwd: input.cwd,
    model: input.model,
    contextTokens: input.contextTokens,
    pr: input.pr,
    exportedAt: Date.now(),
    events: parseOmpTranscript(raw),
  };
  return transcript;
};
