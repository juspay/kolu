/** How a port becomes a URL — the one builder both the ports section and the
 *  forward rows use.
 *
 *  Its own leaf because those two import each other's pieces otherwise: the
 *  section renders a forward's controls, the rows build a forward's URL, and a
 *  cycle between them is a real one (biome refuses it) rather than a stylistic
 *  complaint. A URL builder depends on neither.
 */

/** The URL a wildcard-bound port answers on: the host the page was served from,
 *  which IS the kolu server's host. Exported for the unit test — the whole point of
 *  this function is the hostname it does NOT use.
 *
 *  An IPv6 literal is RE-BRACKETED. `location.hostname` strips the brackets the URL
 *  form requires, so a kolu reached over IPv6 (a tailnet `fd7a:…` address is the
 *  ordinary case, not an exotic one) yielded `http://fd7a::2:8123` — where the
 *  parser reads the last `:8123` as part of the address and the URL is simply
 *  malformed. Detected by the colon: a registered hostname or an IPv4 literal can
 *  never contain one, so this needs no address parsing. */
export function portUrl(hostname: string, port: number): string {
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `http://${host}:${port}`;
}
