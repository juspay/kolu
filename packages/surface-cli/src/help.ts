/**
 * THE HELP A PERSON READS — the layout, and only the layout.
 *
 * `--help` on the parent command is where somebody finds out what a surface
 * offers, and for most of them it is the ONLY place they will look. What the
 * projection can write by itself is a flat alphabetical dump of every verb it
 * mounted, which is a table of contents for a book nobody wrote: `add_node`
 * sits beside `search_nodes` and `set_done` with no hint that two of them read
 * and one writes, no example of a single one, and no sentence saying what the
 * command is FOR.
 *
 * So the layout is here — in the framework, so every surface client gets the
 * same shape — and the WORDING is the app's, because only the app knows what
 * its verbs are for (`SurfaceCliHelp`). The split is the same one this package
 * makes everywhere else: the projection is generic, the domain is not.
 *
 * ## What this module is not
 *
 * It is not a help RENDERER. `effect/unstable/cli` renders `--help`, and this
 * writes the parent command's DESCRIPTION, which that renderer prints. So a
 * host adopting it is one `Command.withDescription` away, nothing about the
 * built-in help changes, and `<verb> --help` keeps answering with the verb's own
 * flags and their types — which is a table this layout deliberately does not
 * duplicate.
 *
 * It is also PURE TEXT over resolved rows: what a verb is called, what it takes,
 * what it says. It does not know what a `Command` is, which is what lets its
 * output be pinned by a test that runs no parser.
 */

/** One group of verbs, in the order the author wants them read. */
export interface HelpGroup {
  /** The heading — "Read", "Write", "Capture". The author's word, printed as
   *  given rather than upper-cased here: a layout that shouts is a layout
   *  decision, and this one belongs to whoever wrote the word. */
  readonly title: string;
  /** Verb names, in the order to print them. A name that no verb answers to is
   *  refused at build (see `surfaceHelp`) — a group is a promise about what
   *  exists, and a stale one is a help page describing a command that is gone. */
  readonly verbs: ReadonlyArray<string>;
}

/** The app's WORDING. Every field here is a sentence only the app can write. */
export interface SurfaceCliHelp {
  /** The parent command the projection is mounted under — `surface`, in
   *  `olai surface capture …`. Required, because only the host knows it, and
   *  every usage line and every example on this page is written under it: a
   *  default would put a prefix nobody can type in front of every example. */
  readonly command: string;
  /** One line: what this command is for. It is the first thing printed and the
   *  only thing some readers will read. */
  readonly purpose: string;
  /** The verbs, grouped by what they DO. Anything the projection mounts and no
   *  group names is printed under a trailing group of its own rather than
   *  dropped — a verb missing from the help is a verb nobody finds. */
  readonly groups: ReadonlyArray<HelpGroup>;
  /** One example command line per verb, WITHOUT the binary and the parent
   *  command in front of it (`capture "a thought" --text "…"`). The layout adds
   *  the prefix, so an example cannot name the wrong binary. */
  readonly examples?: Record<string, string>;
  /** The endpoint's OWN flags, as the app spells them — the app declared them
   *  (`EndpointSeam.flags`), so the app words them. This face's own two are
   *  appended by the layout, because they are this face's to explain. */
  readonly flags?: ReadonlyArray<HelpFlag>;
  /** The last paragraph: where the answer goes, and anything else the reader
   *  needs once. Printed verbatim, wrapped by nothing. */
  readonly answer?: string;
}

/** One flag line: how it is typed, and what it does. */
export interface HelpFlag {
  /** As it is typed, value placeholder included — `--url <server>`. */
  readonly spelling: string;
  readonly description: string;
}

/** One verb or reader, resolved to the three things a help line shows. */
export interface HelpRow {
  /** The name, for grouping. */
  readonly name: string;
  /** How it is typed, arguments included — `get <member> [key]`. */
  readonly usage: string;
  /** Its own one-line description — the verb's, so the help page and the
   *  agent's tool listing carry the same sentence. */
  readonly description: string;
  /** The example, already prefixed with the binary and parent command. */
  readonly example?: string;
}

/** Everything the layout needs, resolved. */
export interface HelpLayout {
  readonly purpose: string;
  readonly usage: string;
  readonly groups: ReadonlyArray<{
    readonly title: string;
    readonly rows: ReadonlyArray<HelpRow>;
  }>;
  readonly flags: ReadonlyArray<HelpFlag>;
  readonly answer?: string;
}

/** How far a description is pushed right. A CONSTANT rather than the longest
 *  name in the table: a column computed from the content moves every line of the
 *  page when one verb is added, which makes a golden test of the help a test of
 *  the longest verb's name. A row whose usage is wider than the column takes its
 *  description on the next line instead of pushing the whole page over. */
const COLUMN = 30;

/** Two spaces of indent per level, spelled once. */
const IN = "  ";

/** The whole page, as the parent command's description. */
export function helpText(layout: HelpLayout): string {
  const out: string[] = [layout.purpose, "", "Usage", `${IN}${layout.usage}`];
  for (const group of layout.groups) {
    if (group.rows.length === 0) continue;
    out.push("", group.title);
    for (const row of group.rows) {
      out.push(...describe(row));
    }
  }
  if (layout.flags.length > 0) {
    out.push("", "Flags every verb takes");
    for (const flag of layout.flags) {
      out.push(
        ...describe({ usage: flag.spelling, description: flag.description }),
      );
    }
  }
  if (layout.answer !== undefined && layout.answer !== "") {
    out.push("", layout.answer);
  }
  return out.join("\n");
}

/** One row: its usage, its sentence, and its example under it.
 *
 *  The sentence goes on the SAME line when the usage fits the column and on its
 *  own line when it does not — rather than pushing the column out for one long
 *  name, which would reflow the whole page. */
function describe(row: {
  readonly usage: string;
  readonly description: string;
  readonly example?: string;
}): string[] {
  const lead = `${IN}${row.usage}`;
  const lines =
    lead.length < COLUMN
      ? [`${lead.padEnd(COLUMN)}${row.description}`.trimEnd()]
      : [lead, `${" ".repeat(COLUMN)}${row.description}`.trimEnd()];
  if (row.example !== undefined) {
    lines.push(`${" ".repeat(COLUMN)}$ ${row.example}`);
  }
  return lines;
}
