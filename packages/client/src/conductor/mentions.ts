/** The composer's `@` and `/` grammar — pure, so the menu, the chips and the
 *  prompt that finally goes out all read one rule.
 *
 *  A MENTION IS A PIECE OF WORK OR A TERMINAL. `@` offers the works kolu is
 *  running first and the fleet's terminals after them; a work is typed as a
 *  slug of its title ({@link workSlug}) because the token ends at the first
 *  space, and what goes out carries the work's id and the title it had then.
 *
 *  A mention is TEXT, not a widget. The composer is a plain `<textarea>`, the
 *  words a person typed stay exactly as typed, and the structured
 *  `ConductorMention[]` the wire carries is RESOLVED from that text at send
 *  time against the works and the fleet as they are right then. That ordering
 *  is the whole point: a `contenteditable` chip would have to be kept in step
 *  with a terminal that can be renamed or killed — or a work that can end —
 *  while the box sits unsent, and the one moment the reference has to be true
 *  is the moment it is sent. */

import type {
  ConductorMention,
  ConductorWorkMention,
} from "kolu-common/conductor";
import type { TerminalId } from "kolu-common/surface";
import type { Work, WorkId } from "kolu-work";

/** One terminal as the `@` menu offers it: what to type, which HOST it is on,
 *  and the three facts that tell two `fix-parser`s apart (what it is working
 *  on, where, how it is doing).
 *
 *  The host is not decoration. One conversation reaches every machine, so a
 *  bare terminal id is ambiguous on this wire — the reference the agent is
 *  handed is `host/id`, joined by kolu-server from the two halves this carries
 *  separately (`ConductorMentionSchema`). A candidate without its host is a
 *  mention that could name the wrong terminal on a two-host fleet. */
export interface TerminalCandidate {
  readonly kind: "terminal";
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
  /** What tells this row apart from others under the same name — the work it
   *  is a member of, else the intent, else the agent and its state, else the
   *  directory (`mentionDetail`). */
  readonly detail: MentionDetail | null;
}

/** One piece of work as the `@` menu offers it. A work is named in prose by a
 *  SLUG of its title ({@link workSlug}), because the token after `@` ends at
 *  the first space and a title is a sentence — and the title itself rides
 *  along, so the chip and the sent mention say the words a person would. */
export interface WorkCandidate {
  readonly kind: "work";
  /** The id the work is filed under. */
  readonly work: WorkId;
  readonly title: string;
  /** The whitespace-free word that follows `@` — `workSlug(title)`. */
  readonly name: string;
  /** The record itself, for the chip face the menu row draws. */
  readonly record: Work;
  /** Where the work stands, in a few words (`standingLine`'s lead). */
  readonly standing: string;
}

/** What the `@` menu offers: a piece of work, or a terminal. */
export type MentionCandidate = TerminalCandidate | WorkCandidate;

/** THE WORD THAT STANDS FOR A WORK after `@`. A mention's token ends at the
 *  first space (`BREAKS`), so a title — which is a sentence — is cut down to
 *  one typeable word: lowercased, every run of anything that is not a letter
 *  or a digit becoming a `-`, nothing hanging off either end.
 *
 *  Letters of ANY script survive, so a title that is not English is still
 *  mentionable; a title made of nothing else is `work`, and two works that
 *  slug the same resolve to the first the menu offered — the same rule two
 *  hosts carrying one name already answer to. */
export function workSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "work" : slug;
}

/** A row's distinguishing detail, and which of the four it is. */
export interface MentionDetail {
  readonly kind: "work" | "intent" | "agent" | "directory";
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

/** WHAT A CANDIDATE MATCHES A QUERY ON, as a rank: 0 for a prefix, 1 for a
 *  contained match, `null` for no match at all. A work is looked up by its
 *  slug AND by its title, so `@pa` finds "Page chats open in a pane" the way
 *  a person reaching for it would type it. */
function matchRank(candidate: MentionCandidate, needle: string): number | null {
  const name = candidate.name.toLowerCase();
  const title = candidate.kind === "work" ? candidate.title.toLowerCase() : "";
  if (name.startsWith(needle) || title.startsWith(needle)) return 0;
  if (name.includes(needle) || title.includes(needle)) return 1;
  if (candidate.kind === "terminal")
    return (candidate.intent ?? "").toLowerCase().includes(needle) ? 1 : null;
  return null;
}

/** Rank candidates for a query: WORKS FIRST — a piece of work is the thing a
 *  person is steering, and a terminal is how it gets done — then a prefix
 *  match ahead of a contained one, and ties keeping the order they were
 *  offered in (the works' own order, then the fleet's, which is the dock's).
 *
 *  The group outranks the match so the menu's two headings never interleave:
 *  a terminal whose name starts with the query still sits under "Terminals",
 *  below a work the query is merely contained in. */
export function filterMentions(
  candidates: readonly MentionCandidate[],
  query: string,
): readonly MentionCandidate[] {
  const needle = query.toLowerCase();
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      group: candidate.kind === "work" ? 0 : 1,
      rank: needle === "" ? 0 : matchRank(candidate, needle),
    }))
    .filter((one): one is typeof one & { rank: number } => one.rank !== null)
    .sort((a, b) => a.group - b.group || a.rank - b.rank || a.index - b.index)
    .map((one) => one.candidate);
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

/** Every `@name` in the text that names a piece of work or a terminal kolu
 *  still has, in the order they appear, each one mentioned once.
 *
 *  A name that matches nothing is left as ordinary prose: the agent still reads
 *  the words, and inventing a reference to a terminal that is not there would be
 *  worse than saying nothing structured about it.
 *
 *  A token two candidates both answer to resolves to the FIRST one offered —
 *  and the menu offers the works first, so a work's slug that a terminal is
 *  also called by is the WORK. The alternative is to resolve it to nothing,
 *  and a reference dropped because a branch and the work cut from it share a
 *  word is the worse failure: the chip says which one it took and the person
 *  can see it before they send. */
export function resolveMentions(
  text: string,
  candidates: readonly MentionCandidate[],
): readonly ConductorMention[] {
  const byName = new Map<string, MentionCandidate>();
  // FIRST WINS, written out: `new Map(entries)` keeps the LAST of a repeated
  // key, which is the opposite of the rule above.
  for (const candidate of candidates)
    if (!byName.has(candidate.name)) byName.set(candidate.name, candidate);
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
    out.push(
      candidate.kind === "work"
        ? { kind: "work", work: candidate.work, title: candidate.title }
        : {
            kind: "terminal",
            terminalId: candidate.terminalId,
            host: candidate.host,
            name: candidate.name,
            intent: candidate.intent,
            cwd: candidate.cwd,
          },
    );
  }
  return out;
}

/** THE TOKEN A RESOLVED MENTION CAME FROM — a terminal's own name, a work's
 *  slug — which is what the chip's × drops from the text. Derived rather than
 *  carried: the mention holds the title the slug was cut from, so the two can
 *  never disagree about which word to remove. */
export function mentionToken(mention: ConductorMention): string {
  return mention.kind === "work" ? workSlug(mention.title) : mention.name;
}

/** WHAT A MESSAGE CARRIES when the chat is pointed at a piece of work: what
 *  the words named, and the scope itself when they did not name it. A message
 *  sent from a scoped chat is about that work whether or not it was typed —
 *  that is what pointing the chat at it meant. */
export function withScopeMention(
  mentions: readonly ConductorMention[],
  scope: ConductorWorkMention | null,
): readonly ConductorMention[] {
  if (scope === null) return mentions;
  return mentions.some((one) => one.kind === "work" && one.work === scope.work)
    ? mentions
    : [...mentions, scope];
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
