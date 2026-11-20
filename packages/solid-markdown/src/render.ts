/** What this renderer does NOT support — math/LaTeX, emoji shortcodes,
 *  @mentions, #issue/SHA autolinks, and the non-GitHub ecosystem syntaxes — is
 *  catalogued in ../LIMITATIONS.md. Keep it in sync when adding or dropping a
 *  feature here. */

import { escapeHtml } from "@kolu/html-escape";
import { Marked, type Tokens } from "marked";
import markedAlert from "marked-alert";
import markedFootnote from "marked-footnote";
import { gfmHeadingId } from "marked-gfm-heading-id";
import { parse as parseYaml } from "yaml";

export type RenderOptions = {
  /** Inline-only parse: no block wrapper, for single-line annotation slots. */
  inline?: boolean;
  /** Treat a single newline as a hard line break (GitHub does NOT — it folds
   *  soft breaks to a space). On for the chat/dock intent scale (message-like),
   *  off for the document preview (GitHub-faithful). Defaults on. */
  breaks?: boolean;
  /** Pass *raw* inline/block HTML through to the sanitizer (true) or escape it
   *  to literal text at parse time (false). Only the document preview is a
   *  document, so only it admits a README's raw HTML. The compact/inline intent
   *  slots are clickable UI rows built from user/agent strings — there a raw
   *  `<h1>`/`<pre>`/`<a>` must render as literal text, NOT as markup. The
   *  downstream tag allowlist can't make this distinction on its own (it would
   *  also have to drop the *same* tags when markdown legitimately produces
   *  them), so the boundary is enforced here, at the token level. Defaults on. */
  rawHtml?: boolean;
  /** Render a leading YAML front-matter block as a metadata table at the top of
   *  the document (true) or strip it entirely (false). Only the full document
   *  preview surfaces metadata, GitHub-faithfully; the compact intent slot
   *  drops it, since a chat row that happens to open with `---` is not a
   *  document. Inert for the inline parse (no block layout). Also inert unless
   *  the sanitize pass runs in richHtml/document scope, since the metadata table
   *  tags live only in the document allowlist — same coupling as rawHtml.
   *  Defaults on. */
  frontMatter?: boolean;
};

function useGfmExtensions(inst: Marked): void {
  inst.use(gfmHeadingId());
  inst.use(markedFootnote());
  inst.use(markedAlert());
}

interface WikilinkToken {
  type: "wikilink";
  raw: string;
  target: string;
  heading?: string;
  alias?: string;
  embed: boolean;
}

const WIKILINK_RE =
  /^(!)?\[\[([^\][\n|#]+)(?:#([^\][\n|]+))?(?:\|([^\][\n]+))?\]\]/;

function useWikilinkExtension(inst: Marked): void {
  inst.use({
    extensions: [
      {
        name: "wikilink",
        level: "inline",
        start(src: string) {
          return src.match(/!?\[\[/)?.index;
        },
        tokenizer(src: string): WikilinkToken | undefined {
          const m = WIKILINK_RE.exec(src);
          if (!m || m[2] === undefined) return undefined;
          return {
            type: "wikilink",
            raw: m[0],
            target: m[2].trim(),
            heading: m[3]?.trim(),
            alias: m[4]?.trim(),
            embed: m[1] === "!",
          };
        },
        renderer(token) {
          const w = token as WikilinkToken;
          if (w.embed) return escapeHtml(w.raw);
          const payload = w.heading ? `${w.target}#${w.heading}` : w.target;
          const display = w.alias ?? payload;
          return `<a href="#" data-md-wikilink="${escapeHtml(payload)}">${escapeHtml(display)}</a>`;
        },
      },
    ],
  });
}

function fenceLang(token: Tokens.Code): string {
  return (token.lang ?? "").trim().split(/\s+/)[0] ?? "";
}

/** The fence language that draws as a diagram. */
export const DIAGRAM_LANG = "mermaid";

function useCodeFenceRenderer(inst: Marked): void {
  inst.use({
    renderer: {
      code(token) {
        const lang = fenceLang(token);
        const attr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
        return `<pre><code${attr}>${escapeHtml(token.text)}</code></pre>\n`;
      },
    },
  });
}

function useRawHtmlPolicy(inst: Marked, rawHtml: boolean): void {
  inst.use({
    renderer: {
      html({ text }) {
        return rawHtml ? false : escapeHtml(text);
      },
    },
  });
}

function buildMarked(breaks: boolean, rawHtml: boolean): Marked {
  const inst = new Marked({ gfm: true, breaks });
  useGfmExtensions(inst);
  if (rawHtml) useWikilinkExtension(inst);
  useCodeFenceRenderer(inst);
  useRawHtmlPolicy(inst, rawHtml);
  return inst;
}

const FRONT_MATTER_RE =
  /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** Split a leading YAML front-matter block off the document. `yaml` is the raw
 *  YAML body (null when there is no front-matter); `body` is the markdown that
 *  follows. Separating the two lets the caller either render the metadata as a
 *  table or drop it, while the body always parses as plain markdown — never as a
 *  spurious top-of-page `<hr>` + Setext heading. Exported so a reader of a
 *  front-matter document that never renders it (kolu's plugin-skill loader)
 *  splits it the same way. */
export function splitFrontMatter(markdown: string): {
  yaml: string | null;
  body: string;
} {
  const m = FRONT_MATTER_RE.exec(markdown);
  if (!m) return { yaml: null, body: markdown };
  return { yaml: m[1] ?? "", body: markdown.slice(m[0].length) };
}

function formatFrontMatterValue(value: unknown): string {
  const scalar = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "object") {
      try {
        return JSON.stringify(v);
      } catch {
        return "[unserializable]";
      }
    }
    return String(v);
  };
  return Array.isArray(value) ? value.map(scalar).join(", ") : scalar(value);
}

function renderFrontMatterTable(entries: [string, unknown][]): string {
  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(
          formatFrontMatterValue(value),
        )}</td></tr>`,
    )
    .join("");
  return `<table data-md-frontmatter><tbody>${rows}</tbody></table>\n`;
}

function renderRawFrontMatter(yaml: string): string {
  return `<pre><code data-lang="yaml">${escapeHtml(yaml)}</code></pre>\n`;
}

function renderFrontMatter(yaml: string): string {
  if (yaml.trim() === "") return "";
  let data: unknown;
  try {
    data = parseYaml(yaml);
  } catch {
    return renderRawFrontMatter(yaml);
  }
  if (data != null && typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length > 0) return renderFrontMatterTable(entries);
  }
  return renderRawFrontMatter(yaml);
}

/** Rewrite `marked-alert`'s class-based markup into an allowlist-safe
 *  `data-md-alert` attribute. The sanitizer drops `class` outright (an
 *  untrusted README must not apply app classes) and strips the injected
 *  octicon SVG, so the alert type is carried on a data attribute the allowlist
 *  permits and the icon comes from CSS instead. */
function rewriteAlerts(html: string): string {
  return html
    .replace(
      /<div class="markdown-alert markdown-alert-(\w+)"\s*>/g,
      '<div data-md-alert="$1">',
    )
    .replace(/<p class="markdown-alert-title"\s*>/g, "<p data-md-alert-title>");
}

/** Flag both footnote anchor kinds with allowlist-safe `data-md-footnote*`
 *  attributes, so the client can recognise each after the sanitizer strips
 *  marked-footnote's own markers (`class`, `data-footnote-*` and
 *  `aria-describedby` are all dropped). Same move alerts make above.
 *
 *  marked-footnote emits a *forward* ref as
 *  `<sup><a … data-footnote-ref aria-describedby="footnote-label">n</a></sup>`
 *  and the *back*-ref (↩) as `<a … data-footnote-backref>`. The bare
 *  `data-footnote-ref` / `data-footnote-backref` attributes uniquely tell the
 *  two apart — so we stamp `data-md-footnote` on the forward ref (the host opens
 *  its definition in a popover) and a sibling `data-md-footnote-backref` on the
 *  back-ref (the popover strips these from its clone — a "jump to marker" link
 *  is meaningless inside the note). Tagging here, on the parser's own output, is
 *  unambiguous; detecting either structurally *after* sanitization would mistake
 *  a back-ref (whose href is also `#md-footnote-…`) — or a heading literally
 *  titled "Footnote 1" minting the same id — for a marker, and couples the host
 *  to marked-footnote's id scheme. The forward ref's definition is found
 *  post-sanitize from the anchor's own `href`.
 *
 *  Spoof guard (mirrors the wikilink policy): `data-md-footnote` is in the
 *  document allowlist, so a README's *raw* inline HTML could pre-seed
 *  `<a data-md-footnote href="#md-…">` to opt an arbitrary same-page anchor into
 *  the host's footnote-popover callback. App-read data hooks must be
 *  parser-minted, not document-authored — so strip any pre-existing
 *  `data-md-footnote*` token from every anchor *first*, then re-mint it only
 *  beside marked-footnote's own `data-footnote-ref` / `data-footnote-backref`.
 *  Net: the markers only ever ride the parser's own footnote refs, never a raw
 *  anchor that merely declared them. */
const DOC_FOOTNOTE_ATTR =
  /\s+data-md-footnote(?:-backref)?(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;

function rewriteFootnotes(html: string): string {
  return html
    .replace(/<a\b[^>]*>/g, (tag) => tag.replace(DOC_FOOTNOTE_ATTR, ""))
    .replace(/<a (?=[^>]*\bdata-footnote-ref\b)/g, "<a data-md-footnote ")
    .replace(
      /<a (?=[^>]*\bdata-footnote-backref\b)/g,
      "<a data-md-footnote-backref ",
    );
}

const INSTANCES = new Map<string, Marked>();
function instance(breaks: boolean, rawHtml: boolean): Marked {
  const key = `${breaks}:${rawHtml}`;
  let inst = INSTANCES.get(key);
  if (!inst) {
    inst = buildMarked(breaks, rawHtml);
    INSTANCES.set(key, inst);
  }
  return inst;
}

/** Parse Markdown to raw (untrusted) HTML. Sanitize before inserting. */
export function renderMarkdownToRawHtml(
  markdown: string,
  opts: RenderOptions,
): string {
  const inst = instance(opts.breaks ?? true, opts.rawHtml ?? true);
  if (opts.inline) return inst.parseInline(markdown) as string;
  const { yaml, body } = splitFrontMatter(markdown);
  const meta =
    (opts.frontMatter ?? true) && yaml !== null ? renderFrontMatter(yaml) : "";
  return meta + rewriteFootnotes(rewriteAlerts(inst.parse(body) as string));
}

const FENCE_OPENER_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSER_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function isFinishedFence(token: Tokens.Code): boolean {
  const lines = token.raw.replace(/\n+$/, "").split("\n");
  if (lines.length < 2) return false;
  const opener = FENCE_OPENER_RE.exec(lines[0] ?? "")?.[1];
  const closer = FENCE_CLOSER_RE.exec(lines[lines.length - 1] ?? "")?.[1];
  return (
    opener !== undefined &&
    closer !== undefined &&
    closer[0] === opener[0] &&
    closer.length >= opener.length
  );
}

/** The text of every FINISHED ` ```mermaid ` block in the document, in order —
 *  the ones the component asks to have drawn. A block whose closing fence has
 *  not arrived (a chat answer still streaming, an intent being typed, a file
 *  still being written) is not listed, so it stays an ordinary code block and
 *  never reaches mermaid. Nor is an empty (or whitespace-only) block: there is
 *  nothing to draw, and mermaid would only answer "No diagram type detected".
 *  Each entry equals the `textContent` the sanitizer reads from that block's
 *  `<code>`, which is how a drawing finds its block.
 *
 *  Lexed with the package's own parser (front-matter split off, as the render
 *  does), walking into lists and quotes. Block structure does not depend on
 *  the `breaks` / `rawHtml` switches the instances differ by, so one instance
 *  serves every variant. */
export function mermaidSources(markdown: string): string[] {
  const inst = instance(false, true);
  // The extensions' own token walk runs too, exactly as `parse` runs it:
  // `marked-footnote` resets its per-document state there, and a lex without
  // that reset would break footnotes in the next render on this instance.
  const extensionWalk = inst.defaults.walkTokens;
  const sources: string[] = [];
  inst.walkTokens(inst.lexer(splitFrontMatter(markdown).body), (token) => {
    extensionWalk?.call(inst, token);
    if (
      token.type === "code" &&
      fenceLang(token as Tokens.Code) === DIAGRAM_LANG &&
      (token as Tokens.Code).text.trim() !== "" &&
      isFinishedFence(token as Tokens.Code)
    ) {
      sources.push((token as Tokens.Code).text);
    }
  });
  return sources;
}
