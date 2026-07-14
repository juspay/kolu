/**
 * How a thread message is stamped before it reaches the coordinator. Every
 * relayed turn carries WHO sent it — `from Sridhar: …` — so the coordinator (and
 * its audit trail) always knows the human behind a request. B0 relays a single
 * operator, but the prefix is per-sender from day one, which is exactly what
 * makes widening the allowlist later a config change, not a code change.
 */

/** Prefix `message` with `from <name>: `. `name` is trimmed; an empty name falls
 *  back to `someone` so the coordinator never receives an unattributed turn. */
export function attribute(
  name: string | null | undefined,
  message: string,
): string {
  const who = (name ?? "").trim() || "someone";
  return `from ${who}: ${message}`;
}
