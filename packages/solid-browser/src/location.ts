/** A browser location — the agnostic "URL" of a navigable document space.
 *  One document, optionally focused on a line range. The host maps `path` to
 *  whatever it resolves content from (a repo-relative path, an HTTP URL, an
 *  ssh target); this package never interprets it beyond passing it around. */

export type LineRange = { start: number; end: number };

export type BrowserLocation = {
  /** Opaque document identifier in the host's space (e.g. a repo-relative path). */
  path: string;
  /** Optional line focus, when navigating to a specific span; null/absent opens
   *  the document with no highlight. */
  line?: LineRange | null;
};
