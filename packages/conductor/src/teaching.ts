/**
 * WHAT KOLU'S CONDUCTOR IS TOLD — AND HOW IT ARRIVES.
 *
 * ## THE CHANNEL: a message preamble, and not a system prompt
 *
 * The pinned adapter takes a system prompt only through a private field of
 * its own (`_meta.systemPrompt`); it ignores ACP's standard one and does not
 * advertise it. Measured, text given there survives a compaction — but it is
 * one adapter's door, and a change to it makes that adapter rebuild the
 * session.
 *
 * So it rides MESSAGES of the session, and the consequences are the argument
 * for it. It is IN THE TRANSCRIPT, where a person can read what their
 * conductor was told, rather than being a thing that happened to somebody
 * else's process. It costs a turn only where there is one: the lines go out
 * with the words rather than as a turn of their own. And it survives a
 * `/clear` by construction, because "has this session been taught" is written
 * down per SESSION.
 *
 * WHEN IT RIDES is the harness's: under the first message of a session, under
 * the message the agent will compact before it reads (measured, that message
 * is still there whole after the summary), under the first message after a
 * restart, and under the next message after a compaction nobody saw coming.
 *
 * ## WHERE THE WORDS LIVE: `./teaching.md`, read once at start
 *
 * The prompt is prose a PERSON has to be able to read and review, so it is a
 * Markdown file — headings, lists and tables — and it is SENT as the Markdown
 * it is, so the structure that makes it readable to a person reaches the
 * model too. The file needs no build wiring: kolu-server runs this package
 * from source, and the built closure copies the whole member directory. It is
 * read at MODULE LOAD, which kolu-server reaches through a static import chain
 * at boot, so a missing or malformed file stops kolu-server from starting
 * instead of failing the first conversation.
 *
 * ## The words, and what they deliberately do not say
 *
 * THE FLEET IS TAUGHT AS AN IDENTITY, not as a feature. A terminal is `host/id`
 * on every call, the `hosts` resource is the live roster and it CHANGES under
 * the conversation, and a terminal is created on the host whose disk the repo
 * is on. Those three are the whole difference between this conversation and a
 * per-host one, and they have to be said: an agent that assumes one machine
 * will cheerfully create a worktree on the wrong box and never notice.
 *
 * NO TOOL CATALOGUE. Every kolu tool carries its own description, which the
 * model reads with the tool; a rule that belongs to one tool lives THERE, so
 * it has one source. The file names a tool where the loop needs it named.
 *
 * ONE PROCEDURE IS TAUGHT WHOLE: the waterfall. "Implement this end to end"
 * is the request a conductor exists for, and the order of its steps is where
 * the value is — a planner in a fresh worktree, the human's approval before
 * anything is built, an implementor beside the planner, review rounds, one
 * refactor pass, CI once. Left to work it out, an agent skips exactly the
 * steps that keep a person in charge (the approval, the review), so they are
 * spelled out step by step — including WHO does each step (the implementor
 * refactors and runs CI; the conductor never touches the code) and what is
 * closed at the end (the two terminals it opened, nothing else). It
 * names no new tool: a planner and an implementor are terminals, opened with
 * the same `lifecycle_create` the loop already uses. How to LAUNCH them is
 * deliberately not here — which harness and which model is the person's
 * choice, asked in each waterfall's setup with kolu's own options, so this
 * prompt cannot go stale on a model name.
 *
 * PURE, over the name of the machine kolu-server runs on, so what an
 * conductor is told is decided in a unit test rather than by starting one.
 * VERSIONED WITH THE BINARY and re-sent on every new session, so one deploy
 * means one contract.
 *
 * AND KOLU'S, not the harness's. The words spell kolu's OWN MCP verbs —
 * `lifecycle_create`, `agent_say` — which `packages/kolu-mcp` owns and
 * renames on its own clock, which is why `conductor.test.ts` checks every verb
 * these words name against that registry: a hand-copy nothing binds goes stale
 * silently, and a stale prompt reads as the agent being wrong.
 * `@kolu/acp-harness` hides the PROTOCOL and takes this text as data
 * (`HarnessOptions.teaching`); a rename it cannot see would otherwise make the
 * package that speaks ACP the one that has to follow kolu's tool names.
 */

import { readFileSync } from "node:fs";

/** The one placeholder the file may use: the machine kolu-server runs on. */
const HOST = "{{host}}";

/** The leading `<!-- … -->` note is for the person editing the file and is not
 *  sent. Cut by position, not by pattern: only the LEADING note is the
 *  editor's, and a `<!--` anywhere after it throws rather than reaching the
 *  agent as prompt text. */
function withoutNote(source: string): string {
  const body = source.trimStart();
  if (!body.startsWith("<!--")) return assertNoNote(source);
  const end = body.indexOf("-->");
  if (end === -1) {
    throw new Error("teaching.md: the leading <!-- note is never closed");
  }
  return assertNoNote(body.slice(end + "-->".length));
}

function assertNoNote(prompt: string): string {
  if (prompt.includes("<!--")) {
    throw new Error(
      "teaching.md: only the leading <!-- note is not sent; move this one there",
    );
  }
  return prompt;
}

/** The prompt file, as the Markdown that is sent: the leading note cut
 *  (`withoutNote`) and the ends trimmed. Throws on a file with nothing left to
 *  say, or on a `{{…}}` placeholder this module does not fill — an unfilled
 *  placeholder would reach the agent verbatim. */
export function parseTeaching(source: string): string {
  const prompt = withoutNote(source).trim();
  if (prompt === "") {
    throw new Error("teaching.md: the standing prompt is empty");
  }
  // Each `{{` up to the next `}}` is a placeholder. Scanned by position, never
  // by a backtracking pattern, and an unclosed `{{` ends the scan: there is no
  // placeholder after it.
  for (let at = prompt.indexOf("{{"); at !== -1; ) {
    const end = prompt.indexOf("}}", at + 2);
    if (end === -1) break;
    const placeholder = prompt.slice(at, end + 2);
    if (placeholder !== HOST) {
      throw new Error(
        `teaching.md: unknown placeholder ${placeholder} — only ${HOST} is filled in`,
      );
    }
    at = prompt.indexOf("{{", end + 2);
  }
  return prompt;
}

/** Read at module load — see the header: a broken file stops the boot. */
const PROMPT = parseTeaching(
  readFileSync(new URL("./teaching.md", import.meta.url), "utf8"),
);

/**
 * The standing prompt for kolu's one conductor: `./teaching.md` as written,
 * with the machine filled in.
 *
 * @param host the machine kolu itself runs on, as kolu names it — where this
 *   conversation's own `cwd` is, and only one of the hosts its hands reach.
 */
export const teaching = (host: string): string => PROMPT.replaceAll(HOST, host);
