/** A REPLY'S FIRST SENTENCE — the one line a notification says about it.
 *
 *  A notification body is one line, so a finished reply is cut at the end of
 *  its first sentence. It is cut at a full stop that ENDS something, never
 *  one inside a commit hash, a path, a URL, a version or `e.g.`
 *  ({@link ends}). A reply that does not open with prose — a heading, a list,
 *  a fence — is cut at the first line of that block instead, which is what a
 *  person skimming would read aloud. */

/** A RUN OF CHARACTERS A FULL STOP INSIDE CANNOT END A SENTENCE: a code span
 *  (`69b08e9`, `.waterfall/mockup/`) and a URL. Masked to the same length
 *  before the scan, so the index it finds is an index into the real text. */
const GUARDED = /`[^`]*`|<?https?:\/\/[^\s)>]+>?/g;

/** What a sentence may put between its full stop and the space after it. */
const CLOSERS = "\"”’')]»*_`";

/** What may OPEN the sentence after this one. A capital, a quote, an opening
 *  bracket, or a dash — anything else (a lower-case word, a digit) means the
 *  full stop was part of what came before it. */
const OPENERS = "\"“‘'([«—–*_`#";

/** THE ABBREVIATIONS a full stop belongs to rather than ends — written out,
 *  because "e.g. Something" and "i.e. A thing" both put a capital after a dot
 *  and a space, which is exactly the shape of a sentence boundary. */
const ABBREVIATION =
  /(?:^|[\s("'])(?:e\.g|i\.e|etc|vs|cf|Mr|Mrs|Ms|Dr|Prof|Fig|No|approx|[A-Z])$/;

/** Is the full stop at `i` the end of a sentence? */
function ends(text: string, i: number): boolean {
  let j = i + 1;
  while (j < text.length && CLOSERS.includes(text[j] as string)) j += 1;
  if (j >= text.length) return true;
  if (!/\s/.test(text[j] as string)) return false;
  while (j < text.length && /\s/.test(text[j] as string)) j += 1;
  if (j >= text.length) return true;
  const next = text[j] as string;
  const capital = next === next.toUpperCase() && next !== next.toLowerCase();
  if (!capital && !OPENERS.includes(next)) return false;
  return !ABBREVIATION.test(text.slice(0, i));
}

/** The text with every guarded run replaced by `x`s of the same length — the
 *  string the scan reads, so a dot inside a commit hash or a path is a dot
 *  the rule never sees. Its length is kept, so an index into it is an index
 *  into the real text. */
const masked = (text: string): string =>
  text.replace(GUARDED, (run) => "x".repeat(run.length));

/** Markdown's inline marks taken off: a link is its words, a code span is its
 *  code, emphasis is the text it emphasised. The line is drawn as PLAIN TEXT
 *  — a notification body is not a place to render markdown — so the marks
 *  would otherwise be read as punctuation. */
function plain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?!\s)([^_]+?)(?<!\s)_(?![\w_])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lines a block cannot start with and still be prose: a heading, a list
 *  item, a quote, a table row, a fence. */
const MARKER =
  /^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?|\|\s*|```+\s*\w*\s*$|:::\s*\w*)/;

/** A line that is only a rule — `---`, `***`, `___` — which separates blocks
 *  and says nothing. */
const RULE = /^(-{3,}|\*{3,}|_{3,})\s*$/;

/** THE REPLY'S HEADLINE — its first sentence, or, when the reply does not
 *  open with prose, the first line of whatever it does open with.
 *
 *  A reply that opens with a heading or a list ("**What it found:**",
 *  "- **The cache rule is its to choose**") has no first sentence to cut: the
 *  line is that block's first line with its marker taken off, which is what a
 *  person skimming would read aloud. Everything else is cut at the first full
 *  stop that ENDS something ({@link ends}). */
export function firstSentence(markdown: string): string {
  const lines = markdown.split("\n");
  let at = 0;
  while (at < lines.length && (lines[at] as string).trim() === "") at += 1;
  while (at < lines.length && RULE.test((lines[at] as string).trim())) {
    at += 1;
    while (at < lines.length && (lines[at] as string).trim() === "") at += 1;
  }
  const first = (lines[at] ?? "").trim();
  if (first === "") return "";
  const mark = MARKER.exec(first);
  if (mark !== null) {
    // A FENCE opens a block whose first line is the fence itself ("```bash"),
    // which says nothing; the code's own first line is the news.
    if (first.startsWith("```"))
      return plain((lines[at + 1] ?? "").trim()).slice(0, 200);
    return plain(first.slice((mark[0] as string).length));
  }
  // The paragraph: every line up to the first blank one or the first line
  // that starts a block of its own.
  const paragraph: string[] = [];
  for (let i = at; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() === "") break;
    if (i > at && (MARKER.test(line.trim()) || RULE.test(line.trim()))) break;
    paragraph.push(line.trim());
  }
  const text = paragraph.join(" ");
  const scan = masked(text);
  for (let i = 0; i < scan.length; i += 1) {
    const char = scan[i] as string;
    if (char !== "." && char !== "!" && char !== "?") continue;
    // A run of terminators (`?!`, `...`) ends at its last one.
    let end = i;
    while (end + 1 < scan.length && ".!?".includes(scan[end + 1] as string))
      end += 1;
    if (!ends(scan, end)) {
      i = end;
      continue;
    }
    let stop = end;
    while (stop + 1 < scan.length && CLOSERS.includes(scan[stop + 1] as string))
      stop += 1;
    return plain(text.slice(0, stop + 1));
  }
  return plain(text);
}
