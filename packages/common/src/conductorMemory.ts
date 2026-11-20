/**
 * THE CONDUCTOR'S MEMORY — what kolu keeps for the Conductor across sessions,
 * and the proposals waiting on the human to become part of it.
 *
 * Shared by kolu-server (the store, the memory block, the MCP resource) and
 * the browser (the sheet, the proposal card, "what needs you"), so every face
 * counts, measures and refuses the same way. Browser-safe: Effect only.
 *
 * A proposal is not memory. Only `entries` is what the Conductor remembers;
 * `proposals` are waiting on the human, and `declined` is kept only to refuse
 * the same proposal again.
 */

import { Schema } from "effect";

export const MEMORY_TITLE_CAP = 80;
export const MEMORY_BODY_CAP = 1_200;
export const MEMORY_ABOUT_CAP = 80;
export const MEMORY_WHY_CAP = 200;
/** Characters of titles and bodies, over every entry. */
export const MEMORY_CAP = 16_000;
export const MEMORY_WAITING_CAP = 20;
export const MEMORY_DECLINED_KEPT = 50;

/** The words of one memory, as written: the title, an optional "about" label
 *  (a repository, a host), and the body in Markdown with no heading lines. */
export const MemoryTextSchema = Schema.Struct({
  title: Schema.String,
  about: Schema.NullOr(Schema.String),
  body: Schema.String,
});
export type MemoryText = typeof MemoryTextSchema.Type;

/** One thing the Conductor remembers. `by` is who wrote it first; `edited`
 *  says the human changed what the Conductor proposed or wrote. */
export const MemoryEntrySchema = Schema.Struct({
  id: Schema.String,
  ...MemoryTextSchema.fields,
  by: Schema.Literals(["you", "conductor"]),
  edited: Schema.Boolean,
  at: Schema.String,
});
export type MemoryEntry = typeof MemoryEntrySchema.Type;

/** What a proposal would do to the memory. */
export const MemoryChangeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("add"),
    ...MemoryTextSchema.fields,
  }),
  Schema.Struct({
    kind: Schema.Literal("replace"),
    entry: Schema.String,
    ...MemoryTextSchema.fields,
  }),
  Schema.Struct({
    kind: Schema.Literal("forget"),
    entry: Schema.String,
  }),
]);
export type MemoryChange = typeof MemoryChangeSchema.Type;

/** A change the Conductor asked for, waiting on the human. `batch` is the
 *  turn it came from: proposals of one turn ring the bell once. */
export const MemoryProposalSchema = Schema.Struct({
  id: Schema.String,
  change: MemoryChangeSchema,
  why: Schema.NullOr(Schema.String),
  at: Schema.String,
  batch: Schema.String,
});
export type MemoryProposal = typeof MemoryProposalSchema.Type;

/** A proposal the human declined, kept to refuse the same one again. */
export const MemoryDeclinedSchema = Schema.Struct({
  change: MemoryChangeSchema,
  at: Schema.String,
});
export type MemoryDeclined = typeof MemoryDeclinedSchema.Type;

/** The whole record. `next` numbers both entries (`m1`) and proposals
 *  (`p1`), so no id is ever given out twice. */
export const MemorySchema = Schema.Struct({
  entries: Schema.Array(MemoryEntrySchema),
  proposals: Schema.Array(MemoryProposalSchema),
  declined: Schema.Array(MemoryDeclinedSchema),
  next: Schema.Int,
});
export type Memory = typeof MemorySchema.Type;

export const EMPTY_MEMORY: Memory = {
  entries: [],
  proposals: [],
  declined: [],
  next: 1,
};

/** What a browser is told: the entries and the proposals waiting. The
 *  declined list stays on the server, and the room is measured from the
 *  entries with {@link memoryUsed}, so it is never a second number. */
export const ConductorMemoryViewSchema = Schema.Struct({
  entries: Schema.Array(MemoryEntrySchema),
  proposals: Schema.Array(MemoryProposalSchema),
});
export type ConductorMemoryView = typeof ConductorMemoryViewSchema.Type;

export const EMPTY_MEMORY_VIEW: ConductorMemoryView = {
  entries: [],
  proposals: [],
};

export const memoryView = (memory: Memory): ConductorMemoryView => ({
  entries: memory.entries,
  proposals: memory.proposals,
});

export const MemoryApproveInputSchema = Schema.Struct({
  proposal: Schema.String,
  edited: Schema.NullOr(MemoryTextSchema),
});
export const MemoryApproveOutputSchema = Schema.Struct({
  ended: Schema.Literals(["remembered", "edited", "forgotten"]),
});
export const MemoryProposalInputSchema = Schema.Struct({
  proposal: Schema.String,
});
export const MemorySaveInputSchema = Schema.Struct({
  entry: Schema.NullOr(Schema.String),
  text: MemoryTextSchema,
});
export const MemoryEntryInputSchema = Schema.Struct({
  entry: Schema.String,
});
export const MemoryImportInputSchema = Schema.Struct({
  entries: Schema.Array(MemoryTextSchema),
});
export const MemoryImportOutputSchema = Schema.Struct({
  added: Schema.Int,
  already: Schema.Int,
});

export const MemoryRefusalKindSchema = Schema.Literals([
  "invalid",
  "too-long",
  "full",
  "too-many-waiting",
  "already-remembered",
  "already-waiting",
  "declined-before",
  "no-such-entry",
  "no-such-proposal",
]);
export type MemoryRefusalKind = typeof MemoryRefusalKindSchema.Type;

/** A change to the memory that kolu will not make. `why` is the whole
 *  sentence for whoever asked, with the numbers in it. */
export class MemoryRefused extends Schema.TaggedError<MemoryRefused>(
  "kolu/MemoryRefused",
)("MemoryRefused", {
  kind: MemoryRefusalKindSchema,
  why: Schema.String,
}) {
  override get message(): string {
    return this.why;
  }
}

const refused = (kind: MemoryRefusalKind, why: string): MemoryRefused =>
  new MemoryRefused({ kind, why });

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

const characters = (n: number): string => plural(n, "character", "characters");

const HEADING_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/mu;

/** The text as kolu stores it: the title and about trimmed, an empty about
 *  as none, the body without leading or trailing blank lines. */
export const tidyMemoryText = (text: MemoryText): MemoryText => {
  const about = text.about?.trim() ?? "";
  return {
    title: text.title.trim(),
    about: about === "" ? null : about,
    body: text.body.replace(/^(?:[ \t]*\r?\n)+/u, "").trimEnd(),
  };
};

/** Why this text cannot be a memory, or `null` when it can. Expects
 *  {@link tidyMemoryText}'s output. */
export const memoryTextRefusal = (text: MemoryText): MemoryRefused | null => {
  if (text.title === "") return refused("invalid", "A memory needs a title.");
  if (/[\r\n]/u.test(text.title))
    return refused("invalid", "A memory's title is one line.");
  if (text.title.length > MEMORY_TITLE_CAP)
    return refused(
      "too-long",
      `The title is ${characters(text.title.length)}; it can be ${MEMORY_TITLE_CAP}.`,
    );
  if (text.about !== null && /[\r\n]/u.test(text.about))
    return refused("invalid", "A memory's about line is one line.");
  if (text.about !== null && text.about.length > MEMORY_ABOUT_CAP)
    return refused(
      "too-long",
      `The about line is ${characters(text.about.length)}; it can be ${MEMORY_ABOUT_CAP}.`,
    );
  if (text.body.trim() === "")
    return refused("invalid", "A memory needs some text.");
  if (text.body.length > MEMORY_BODY_CAP)
    return refused(
      "too-long",
      `The text is ${characters(text.body.length)}; it can be ${MEMORY_BODY_CAP.toLocaleString("en")}.`,
    );
  if (HEADING_LINE.test(text.body))
    return refused(
      "invalid",
      "A memory's text cannot hold a heading line: headings are how the export file separates memories.",
    );
  return null;
};

/** Why this reason cannot go with a proposal, or `null` when it can. */
export const memoryWhyRefusal = (why: string | null): MemoryRefused | null =>
  why !== null && why.length > MEMORY_WHY_CAP
    ? refused(
        "too-long",
        `The reason is ${characters(why.length)}; it can be ${MEMORY_WHY_CAP}.`,
      )
    : null;

/** How much of the memory's room some text takes. */
export const memorySize = (text: Pick<MemoryText, "title" | "body">): number =>
  text.title.length + text.body.length;

/** How much of the memory's room the entries take. */
export const memoryUsed = (entries: ReadonlyArray<MemoryText>): number =>
  entries.reduce((sum, entry) => sum + memorySize(entry), 0);

/** The refusal for a change that needs more room than is left. */
export const memoryFullRefusal = (needs: number, left: number): MemoryRefused =>
  refused(
    "full",
    `Memory is full: this needs ${characters(needs)} and ${left.toLocaleString("en")} ${left === 1 ? "is" : "are"} left. Delete or shorten an entry first.`,
  );

/** Two texts are the same memory when their titles match, ignoring case, and
 *  their bodies match, ignoring how the lines are spaced. */
export const sameMemory = (
  a: Pick<MemoryText, "title" | "body">,
  b: Pick<MemoryText, "title" | "body">,
): boolean =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
  a.body.replace(/\s+/gu, " ").trim() === b.body.replace(/\s+/gu, " ").trim();

/** The title a proposal is shown by: its own, or for a forget, the title of
 *  the entry it would forget. */
export const proposalTitle = (
  memory: Pick<Memory, "entries">,
  proposal: Pick<MemoryProposal, "change">,
): string => {
  const change = proposal.change;
  if (change.kind !== "forget") return change.title;
  return (
    memory.entries.find((entry) => entry.id === change.entry)?.title ??
    change.entry
  );
};

/** Memory's one item in "what needs you", or `null` when nothing waits.
 *  `identity` is the batch of the newest waiting proposal, so a batch rings
 *  once and a later turn rings again; `title` is there when one waits. */
export interface MemoryNeed {
  readonly identity: string;
  readonly count: number;
  readonly title: string | null;
}

export const memoryNeed = (
  memory: Pick<Memory, "entries" | "proposals">,
): MemoryNeed | null => {
  const newest = memory.proposals.at(-1);
  if (newest === undefined) return null;
  const count = memory.proposals.length;
  return {
    identity: newest.batch,
    count,
    title: count === 1 ? proposalTitle(memory, newest) : null,
  };
};

export const MEMORY_FILE_NAME = "kolu-conductor-memory.md";
const FILE_HEADING = "# kolu Conductor memory";
const ABOUT_LINE = /^About:[ \t]*(.*)$/u;
const ENTRY_HEADING = /^## (.*)$/u;

/** The memory as one Markdown file: a `##` per entry, an optional `About:`
 *  line, then the body. {@link readMemoryFile} reads it back. */
export const memoryFile = (entries: ReadonlyArray<MemoryText>): string =>
  [
    FILE_HEADING,
    ...entries.map((entry) =>
      [
        `## ${entry.title}`,
        ...(entry.about === null ? [] : [`About: ${entry.about}`]),
        "",
        entry.body,
      ].join("\n"),
    ),
  ].join("\n\n") + "\n";

/** The memories a Markdown file holds, in its order, or why it cannot be
 *  read. A file with no entry is refused, not read as empty, and one entry
 *  that could not be a memory refuses the whole file. */
export const readMemoryFile = (
  file: string,
): ReadonlyArray<MemoryText> | MemoryRefused => {
  const lines = file.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const found: Array<{ title: string; lines: Array<string>; line: number }> =
    [];
  for (const [index, line] of lines.entries()) {
    const heading = ENTRY_HEADING.exec(line);
    if (heading !== null) {
      found.push({ title: heading[1] ?? "", lines: [], line: index + 1 });
      continue;
    }
    const current = found.at(-1);
    if (current !== undefined) {
      current.lines.push(line);
      continue;
    }
    if (line.trim() !== "" && line.trim() !== FILE_HEADING)
      return refused(
        "invalid",
        `Line ${index + 1} is outside any memory: every memory starts with a "## " title.`,
      );
  }
  if (found.length === 0)
    return refused(
      "invalid",
      `This file holds no memory: each one starts with a "## " title.`,
    );
  const entries: Array<MemoryText> = [];
  for (const entry of found) {
    const first = entry.lines.findIndex((line) => line.trim() !== "");
    const about =
      first === -1 ? null : ABOUT_LINE.exec(entry.lines[first] ?? "");
    const body = about === null ? entry.lines : entry.lines.slice(first + 1);
    const text = tidyMemoryText({
      title: entry.title,
      about: about === null ? null : (about[1] ?? ""),
      body: body.join("\n"),
    });
    const refusal = memoryTextRefusal(text);
    if (refusal !== null)
      return refused(
        refusal.kind,
        `"${text.title}", on line ${entry.line}: ${refusal.why}`,
      );
    entries.push(text);
  }
  return entries;
};
