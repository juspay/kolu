/** Pure URL-shape predicates — DOM-free, zero-dependency. "Shape" is the
 *  structural question (does this ref carry its own origin/scheme?), distinct
 *  from "policy" (which schemes are *allowed*) — that allowlist stays with each
 *  consumer.
 *
 *  This lives in its own leaf package so two unrelated owners can share it
 *  without a dependency arrow between them: the Markdown href policy
 *  (`@kolu/solid-markdown`'s `safeHref`/`sanitize`) and the host-agnostic
 *  relative-ref resolver (`@kolu/solid-browser`). Neither owns "is this a
 *  navigable path" more than the other, and routing one through the other would
 *  drag solid-js + DOMPurify into the node-pure resolver. */

/** Does this ref carry an origin/scheme of its own — i.e. it is NOT a bare
 *  repo-relative path? True for a protocol-relative `//host`, anything with a
 *  scheme (`https:`, `data:`, `mailto:`, …), and an in-page `#anchor`. The
 *  image/link resolver uses this to bail before treating a ref as a repo path;
 *  the Markdown policy uses it as the shape decision that `safeHref` then
 *  *allowlists* among — kept in one place so "has its own origin" is encoded
 *  once. */
export function hasOwnScheme(src: string): boolean {
  const trimmed = src.trim();
  return (
    trimmed.startsWith("#") || // in-page anchor (own "origin": this document)
    trimmed.startsWith("//") || // protocol-relative `//host`
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) // an explicit scheme
  );
}
