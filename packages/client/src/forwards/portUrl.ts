/** How a port becomes a URL — the one builder both the ports section and the
 *  forward rows use.
 *
 *  Its own leaf because those two import each other's pieces otherwise: the
 *  section renders a forward's controls, the rows build a forward's URL, and a
 *  cycle between them is a real one (biome refuses it) rather than a stylistic
 *  complaint. A URL builder depends on neither.
 */

import { hostAuthority } from "@kolu/url-shape";

/** The URL a port answers on: the host the page was served from, which IS the
 *  kolu server's host. Exported for the unit test — the whole point of this
 *  function is the hostname it does NOT use.
 *
 *  The `host:port` half is `@kolu/url-shape`'s {@link hostAuthority} — the ONE
 *  place an IPv6 literal is re-bracketed, shared with the server leg that prints
 *  a bound origin. `location.hostname` strips the brackets the URL form requires,
 *  so a kolu reached over IPv6 (a tailnet `fd7a:…` address is the ordinary case,
 *  not an exotic one) yielded `fd7a::2:8123` — where a parser reads the last
 *  `:8123` as part of the address and the whole thing is simply malformed. A row
 *  that SHOWS the address as well as linking it (`ForwardPill`) calls
 *  `hostAuthority` directly, so the spelling it renders and the URL it copies are
 *  one derivation.
 *
 *  Scheme defaults to `http:` (dev-server doors and wildcard chips). Pass
 *  `https:` when the printed URL (or the listener) is TLS — a TCP door carries
 *  bytes, so the browser still has to speak the right scheme. */
export function portUrl(
  hostname: string,
  port: number,
  protocol: "http:" | "https:" = "http:",
): string {
  return `${protocol}//${hostAuthority(hostname, port)}`;
}
