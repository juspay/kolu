/** Does this ref carry an origin/scheme of its own — i.e. it is NOT a bare
 *  repo-relative path? True for a protocol-relative `//host`, anything with a
 *  scheme (`https:`, `data:`, `mailto:`, …), and an in-page `#anchor`. */
export function hasOwnScheme(src: string): boolean {
  const trimmed = src.trim();
  return (
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  );
}

/** `host:port` in the form a URL parser accepts, bracketing an IPv6 literal.
 *
 *  `location.hostname` and Node's `AddressInfo.address` both hand an IPv6
 *  address over without the brackets the URL form requires. */
export function hostAuthority(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

/** Is this hostname a loopback / all-interfaces bind spelling: `localhost`, the
 *  entire `127.0.0.0/8`, IPv6 loopback, `0.0.0.0` (and its IPv6 twin)? Accepts
 *  an IPv6 literal with or without brackets. */
export function isLoopbackHostname(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (h === "localhost") return true;
  if (h === "0.0.0.0") return true;
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

/** A loopback URL taken apart — port, path, query, hash. `null` when the text
 *  is not a loopback URL (non-http(s), non-loopback host, unparseable). */
export type LoopbackUrl = {
  /** Hostname as the URL parser reports it (IPv6 bare, no brackets). */
  host: string;
  port: number;
  /** Scheme the printout used. */
  protocol: "http:" | "https:";
  /** Pathname including a leading `/` (URL always has one). */
  pathname: string;
  /** Search including the leading `?`, or `""`. */
  search: string;
  /** Hash including the leading `#`, or `""`. */
  hash: string;
};

/** What counts as a web URL inside terminal text: `@xterm/addon-web-links`'
 *  own `strictUrlRegex` default, restated because the addon does not export
 *  it. Non-global, like the addon's; a scanner that needs every match builds a
 *  global copy from `.source`. */
export const WEB_URL_PATTERN =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`]*[^\s"':,.!?{}|\\\^~\[\]`()<>]/;

/** Parse a printed URL into a loopback target, or `null` when it is not one.
 *  Only `http:` / `https:` count; a missing port defaults to the scheme's
 *  default (80 / 443). */
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
