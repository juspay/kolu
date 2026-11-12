/**
 * WHAT KOLU'S CONDUCTOR IS TOLD, ONCE — AND HOW IT ARRIVES.
 *
 * ## THE CHANNEL: a first-turn preamble, and not a system prompt
 *
 * ACP has no system prompt. `session/new` carries a cwd and a list of MCP
 * servers and nothing else a client may put words in, so there is no field to
 * put this in on any wire kolu talks to; getting one would mean patching a
 * pinned adapter, and the feature would then be absent on every other engine —
 * exactly the shape this repo refuses, because a capability silently missing
 * cannot be told apart from one that is broken.
 *
 * So it rides the FIRST MESSAGE of the session, and the three consequences are
 * the argument for it. It is IN THE TRANSCRIPT, where a person can read what
 * their conductor was told, rather than being a thing that happened to
 * somebody else's process. It costs a turn only where there is one: a kolu
 * nobody talks to spends nothing, and the lines go out with the words rather
 * than as a turn of their own. And it survives a `/clear` by construction,
 * because "has this session been taught" is written down per SESSION — a new
 * session is untaught, which is right, since the whole point is that the
 * transcript is not what carries the contract.
 *
 * ## WHERE THE WORDS LIVE: `./teaching.md`, read once at start
 *
 * The prompt is prose a PERSON has to be able to read and review, so it is a
 * Markdown file of wrapped paragraphs — one paragraph per instruction, so an
 * edit is a few changed lines in a diff — rather than a row of
 * thousand-character string literals. The file needs no build wiring:
 * kolu-server runs this package from source, and the built closure copies the
 * whole member directory. It is read at MODULE LOAD, which kolu-server reaches
 * through a static import chain at boot, so a missing or malformed file stops
 * kolu-server from starting instead of failing the first conversation.
 *
 * ## The words, and what they deliberately do not say
 *
 * PROSE AN AGENT READS, not a bullet spec. The loop is named as a loop because
 * that is how it is done, and the one place exactness is worth more than flow —
 * the settle call's own arguments — is spelled out, because an agent that waits
 * on the wrong state waits forever and an agent that polls a screen burns a
 * turn per look.
 *
 * THE FLEET IS TAUGHT AS AN IDENTITY, not as a feature. A terminal is `host/id`
 * on every call, the `hosts` resource is the live roster and it CHANGES under
 * the conversation, and a terminal is created on the host whose disk the repo
 * is on. Those three are the whole difference between this conversation and a
 * per-host one, and they have to be said: an agent that assumes one machine
 * will cheerfully create a worktree on the wrong box and never notice.
 *
 * NO TOOL CATALOGUE. Which verbs are reachable is a property of the MCP server
 * this session was handed, and an instruction naming a call the session does
 * not have would be teaching a contract it cannot keep. The six tools the
 * file names are the ones the loop IS; everything else the server offers the
 * agent finds the ordinary way.
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
 * choice, asked once per conversation, so this prompt cannot go stale on a
 * model name.
 *
 * PURE, over the name of the machine kolu-server runs on, so what an
 * conductor is told is decided in a unit test rather than by starting one.
 * VERSIONED WITH THE BINARY and re-sent on every new session, so one deploy
 * means one contract.
 *
 * AND KOLU'S, not the harness's. The words spell kolu's OWN MCP verbs —
 * `lifecycle_create`, `wait_agentState` — which `packages/kolu-mcp` owns and
 * renames on its own clock, which is why `conductor.test.ts` checks every verb
 * these words name against that registry: a hand-copy nothing binds goes stale
 * silently, and a stale prompt reads as the agent being wrong.
 * `@kolu/acp-harness` hides the PROTOCOL and takes these lines as data
 * (`HarnessOptions.teaching`); a rename it cannot see would otherwise make the
 * package that speaks ACP the one that has to follow kolu's tool names.
 */

import { readFileSync } from "node:fs";

/** The one placeholder the file may use: the machine kolu-server runs on. */
const HOST = "{{host}}";

/** The prompt file's paragraphs. The leading `<!-- … -->` note is for the
 *  person editing the file and is not sent; a blank line ends a paragraph, and
 *  a paragraph's wrapped lines are joined with single spaces. Throws on a file
 *  with no paragraphs, or on a `{{…}}` placeholder this module does not fill —
 *  an unfilled placeholder would reach the agent verbatim. */
export function parseTeaching(source: string): ReadonlyArray<string> {
  const paragraphs = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\n[ \t]*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join(" "),
    )
    .filter((paragraph) => paragraph !== "");
  if (paragraphs.length === 0) {
    throw new Error("teaching.md: the standing prompt has no paragraphs");
  }
  for (const [placeholder] of paragraphs
    .join("\n")
    .matchAll(/\{\{[^}]*\}\}/g)) {
    if (placeholder !== HOST) {
      throw new Error(
        `teaching.md: unknown placeholder ${placeholder} — only ${HOST} is filled in`,
      );
    }
  }
  return paragraphs;
}

/** Read at module load — see the header: a broken file stops the boot. */
const PARAGRAPHS = parseTeaching(
  readFileSync(new URL("./teaching.md", import.meta.url), "utf8"),
);

/**
 * The standing prompt for kolu's one conductor: one line per paragraph of
 * `./teaching.md`, each carrying `[kolu] ` — THE ONE PLACE that prefix is
 * spelled.
 *
 * @param host the machine kolu itself runs on, as kolu names it — said in the
 *   first line because it is where this conversation's own `cwd` is, and it is
 *   only one of the hosts its hands reach.
 */
export const teachingLines = (host: string): ReadonlyArray<string> =>
  PARAGRAPHS.map((paragraph) => `[kolu] ${paragraph.replaceAll(HOST, host)}`);
