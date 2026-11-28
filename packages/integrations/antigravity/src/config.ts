/** Where Antigravity CLI keeps its state. Leaf module — no imports from other
 *  package files. */

import os from "node:os";
import path from "node:path";

/** Antigravity CLI's app data directory, `~/.gemini/antigravity-cli` (Google's
 *  hooks page: "`<app_data_dir>` ... resolves to `~/.gemini/antigravity-cli`").
 *  It follows `HOME`. `KOLU_ANTIGRAVITY_DIR` points it at a fixture tree for
 *  tests and the e2e harness.
 *
 *  A credential file sits in this directory too. kolu reads only the paths
 *  named below and nothing else here. */
export const ANTIGRAVITY_DIR =
  process.env.KOLU_ANTIGRAVITY_DIR ??
  path.join(os.homedir(), ".gemini", "antigravity-cli");

/** One `<id>.lock` per conversation. The `agy` process that has a conversation
 *  keeps its lock open for as long as it has it — the identity kolu reads. */
export const PRESENCE_DIR = path.join(ANTIGRAVITY_DIR, "presence");

/** `title:"…"` per conversation, written by `agy` and replaced by `/rename`. */
export const ANNOTATIONS_DIR = path.join(ANTIGRAVITY_DIR, "annotations");

/** One directory per conversation, holding its transcript. */
export const BRAIN_DIR = path.join(ANTIGRAVITY_DIR, "brain");

/** Directory → the conversation last active there. Read only where a
 *  process's open files cannot be. */
export const LAST_CONVERSATIONS_FILE = path.join(
  ANTIGRAVITY_DIR,
  "cache",
  "last_conversations.json",
);

/** A conversation's transcript: one JSON object a line, appended. */
export function transcriptPathFor(id: string): string {
  return path.join(
    BRAIN_DIR,
    id,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
}

/** A conversation's title file. */
export function annotationsPathFor(id: string): string {
  return path.join(ANNOTATIONS_DIR, `${id}.pbtxt`);
}

/** The env key the e2e harness sets to point detection at fixtures. */
export const ANTIGRAVITY_ENV_KEYS = ["KOLU_ANTIGRAVITY_DIR"] as const;
