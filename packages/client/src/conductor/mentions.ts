/** The composer's `@` and `/` grammar — pure, so the menu, the chips and the
 *  prompt that finally goes out all read one rule.
 *
 *  A mention is TEXT, not a widget. The composer is a plain `<textarea>`, the
 *  words a person typed stay exactly as typed, and the structured
 *  `ConductorMention[]` the wire carries is RESOLVED from that text at send
 *  time against the fleet as it is right then. That ordering is the whole point:
 *  a `contenteditable` chip would have to be kept in step with a terminal that
 *  can be renamed or killed while the box sits unsent, and the one moment the
 *  reference has to be true is the moment it is sent. */

import type { ConductorMention } from "kolu-common/conductor";
import type { TerminalId } from "kolu-common/surface";

/** One terminal as the `@` menu offers it: what to type, which HOST it is on,
 *  and the three facts that tell two `fix-parser`s apart (what it is working
 *  on, where, how it is doing).
 *
 *  The host is not decoration. One conversation reaches every machine, so a
 *  bare terminal id is ambiguous on this wire — the reference the agent is
 *  handed is `host/id`, joined by kolu-server from the two halves this carries
 *  separately (`ConductorMentionSchema`). A candidate without its host is a
 *  mention that could name the wrong terminal on a two-host fleet. */
export interface MentionCandidate {
  readonly terminalId: TerminalId;
  /** The ENCODED host key (`local` / `remote:<target>`) the terminal lives
   *  on — the half that makes the id unambiguous across the fleet. */
  readonly host: string;
  /** The terminal's own name — the word that follows `@`. Never contains
   *  whitespace; the fleet's names are branch/intent keys. */
  readonly name: string;
  readonly intent: string | null;
  readonly cwd: string | null;
  /** The repo the terminal lives in, for the menu's quiet second column. */
  readonly repo: string | null;
  /** What tells this row apart from others under the same name — the
   *  intent, else the agent and its state, else the directory
   *  (`mentionDetail`). */
  readonly detail: MentionDetail | null;
}

/** A row's distinguishing detail, and which of the three it is. */
export interface MentionDetail {
  readonly kind: "intent" | "agent" | "directory";
  readonly text: string;
}

/** A completion in progress: the trigger's position and what has been typed
 *  after it. `null` when the caret is not inside one. */
export interface TokenQuery {
  /** Index of the trigger character itself. */
  readonly start: number;
  /** Index just past the typed query — always the caret. */
  readonly end: number;
  readonly query: string;
}

/** Characters that END a completion token. A mention's name cannot contain
 *  them, so the first one walking back from the caret bounds the token. */
const BREAKS = /[\s]/;

/** The completion token the caret sits in, for one trigger character.
 *
 *  A trigger only opens a menu at the start of the text or after whitespace —
 *  otherwise an email address would open the mention menu on every `@` a person
 *  types, and a path would open the command menu on every `/`. */
export function tokenQueryAt(
  text: string,
  caret: number,
  trigger: "@" | "/",
): TokenQuery | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === undefined) return null;
    if (BREAKS.test(ch)) return null;
    if (ch !== trigger) continue;
    const before = i === 0 ? undefined : text[i - 1];
    if (before !== undefined && !BREAKS.test(before)) return null;
    return { start: i, end: caret, query: text.slice(i + 1, caret) };
  }
  return null;
}

/** Rank candidates for a query: a prefix match beats a contained match, and
 *  ties keep the order the fleet arrived in (padi's own, which is the dock's). */
export function filterMentions(
  candidates: readonly MentionCandidate[],
  query: string,
): readonly MentionCandidate[] {
  if (query === "") return candidates;
  const needle = query.toLowerCase();
  const prefix: MentionCandidate[] = [];
  const contains: MentionCandidate[] = [];
  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();
    if (name.startsWith(needle)) prefix.push(candidate);
    else if (
      name.includes(needle) ||
      (candidate.intent ?? "").toLowerCase().includes(needle)
    )
      contains.push(candidate);
  }
  return [...prefix, ...contains];
}

/** Replace the token under the caret with `word`, leaving the caret past the
 *  separating space — so a person keeps typing a sentence rather than deleting
 *  a joined-up word. The space is ADDED only where there is not one already:
 *  completing mid-sentence otherwise leaves a double gap that nobody typed. */
export function completeToken(
  text: string,
  token: TokenQuery,
  trigger: "@" | "/",
  word: string,
): { readonly text: string; readonly caret: number } {
  const rest = text.slice(token.end);
  const head = `${text.slice(0, token.start)}${trigger}${word}${/^\s/.test(rest) ? "" : " "}`;
  return { text: head + rest, caret: head.length };
}

/** Every `@name` in the text that names a terminal the fleet still has, in the
 *  order they appear, each one mentioned once.
 *
 *  A name that matches nothing is left as ordinary prose: the agent still reads
 *  the words, and inventing a reference to a terminal that is not there would be
 *  worse than saying nothing structured about it.
 *
 *  A name that two hosts both carry resolves to the FIRST candidate offered,
 *  which is the fleet list's own order — most recently active first. The
 *  alternative is to resolve it to nothing, and a reference dropped because
 *  two machines happened to name a branch the same way is the worse failure:
 *  the host rides on the mention, so the chip says which one it took and the
 *  person can see it before they send. */
export function resolveMentions(
  text: string,
  candidates: readonly MentionCandidate[],
): readonly ConductorMention[] {
  const byName = new Map(candidates.map((c) => [c.name, c]));
  const seen = new Set<string>();
  const out: ConductorMention[] = [];
  // A mention ends where the SENTENCE does: `@fix-parser, then…` names
  // `fix-parser`, not `fix-parser,`. Trailing punctuation is prose, and a
  // reference that only resolved at the end of a sentence would be a reference
  // most of the time.
  for (const match of text.matchAll(/(^|\s)@([^\s@]+?)[.,;:!?)\]]*(?=\s|$)/g)) {
    const name = match[2];
    if (name === undefined) continue;
    const candidate = byName.get(name);
    if (candidate === undefined || seen.has(name)) continue;
    seen.add(name);
    out.push({
      terminalId: candidate.terminalId,
      host: candidate.host,
      name: candidate.name,
      intent: candidate.intent,
      cwd: candidate.cwd,
    });
  }
  return out;
}

/** Drop one resolved mention's `@name` token from the text — what the chip's ×
 *  does. Removes every occurrence, because the chip stands for all of them, and
 *  closes the gap it leaves: a chip press should read as an edit somebody made,
 *  not as a hole where a word used to be. */
export function dropMention(text: string, name: string): string {
  return text
    .replace(new RegExp(`(^|\\s)@${escapeForRegExp(name)}(?=\\s|$)`, "g"), "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Arm the composer with a terminal: the text a tile action drops into the box.
 *  One home for the spelling so "Ask the Conductor about this" and a
 *  hand-typed mention produce the same prompt. */
export function armedMentionText(text: string, name: string): string {
  const token = `@${name}`;
  if (new RegExp(`(^|\\s)@${escapeForRegExp(name)}(?=\\s|$)`).test(text))
    return text;
  return text === "" ? `${token} ` : `${token} ${text}`;
}
