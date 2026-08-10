/** Pure URL-shape predicates — DOM-free, zero-dependency. "Shape" is the
 *  structural question (does this ref carry its own origin/scheme? is this host
 *  loopback?), distinct from "policy" (which schemes are *allowed*, which door a
 *  loopback URL should open) — that stays with each consumer.
 *
 *  This lives in its own leaf package so two unrelated owners can share it
 *  without a dependency arrow between them: the Markdown href policy
 *  (`@kolu/solid-markdown`'s `safeHref`/`sanitize`) and the host-agnostic
 *  relative-ref resolver (`@kolu/solid-browser`). Neither owns "is this a
 *  navigable path" more than the other, and routing one through the other would
 *  drag solid-js + DOMPurify into the node-pure resolver. The loopback-URL
 *  grammar (PRT4) is the same kind of fact: web-shaped, not kolu policy. */

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

/** `host:port` in the form a URL parser accepts — the ONE place an IPv6 literal
 *  is re-bracketed, and therefore the one authority on how a door is addressed.
 *
 *  `location.hostname` and Node's `AddressInfo.address` both strip the brackets
 *  the URL form requires, so an IPv6 address (a tailnet `fd7a:…` is the ordinary
 *  case, not an exotic one) yields `fd7a::2:8123` — where a parser reads the last
 *  `:8123` as part of the address and the whole thing is simply malformed.
 *  Detected by the colon: a registered hostname or an IPv4 literal can never
 *  contain one, so this needs no address parsing.
 *
 *  It lives here because bracketing and its inverse are one fact: this package
 *  already owns the UNbracketing ({@link isLoopbackHostname} and
 *  {@link parseLoopbackUrl} both strip `[]`), and it is the zero-dependency leaf
 *  unrelated owners share — a server leg (`serveSurfaceApp`'s bound origin, kolu's
 *  "listening" line) and a browser leg (kolu's port-forward URLs) both reach it
 *  without a dependency arrow between them. An address shown in one spelling and
 *  dialled in another is an address where only one of them works. */
export function hostAuthority(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

/** Is this hostname a loopback / all-interfaces bind spelling — the set a
 *  printed dev-server URL uses for "this machine"?
 *
 *  `localhost` · the entire `127.0.0.0/8` · IPv6 loopback · `0.0.0.0` (and its
 *  IPv6 twin). Brackets on an IPv6 literal are stripped first: a URL parser
 *  hands `hostname` bare, but a hand-built authority may still carry them. */
export function isLoopbackHostname(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (h === "localhost") return true;
  if (h === "0.0.0.0") return true;
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  // 127.0.0.0/8 — every 127.* is loopback, not only 127.0.0.1.
  if (/^127(?:\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

/** A loopback URL taken apart — port, path, query, hash — so a door open can
 *  carry the printed path through. `null` when the text is not a loopback URL
 *  (non-http(s), non-loopback host, unparseable). */
export type LoopbackUrl = {
  /** Hostname as the URL parser reports it (IPv6 bare, no brackets). */
  host: string;
  port: number;
  /** Scheme the printout used — carried so a door/open can keep TLS intact. */
  protocol: "http:" | "https:";
  /** Pathname including a leading `/` (URL always has one). */
  pathname: string;
  /** Search including the leading `?`, or `""`. */
  search: string;
  /** Hash including the leading `#`, or `""`. */
  hash: string;
};

/** Parse a printed URL into a loopback target, or `null` when it is not one.
 *
 *  Only `http:` / `https:` count — a `file:` or `ws:` URL is not a dev-server
 *  printout. Missing port defaults to the scheme's default (80 / 443), matching
 *  what the browser would dial. */
export function parseLoopbackUrl(text: string): LoopbackUrl | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Some URL implementations hand IPv6 hostnames still bracketed; normalise so
  // consumers never have to strip twice.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!isLoopbackHostname(host)) return null;
  const port =
    url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    host,
    port,
    protocol: url.protocol === "https:" ? "https:" : "http:",
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}
