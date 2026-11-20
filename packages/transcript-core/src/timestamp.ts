/** Parse an ISO-8601 timestamp string to ms-since-epoch. Returns null on
 *  empty input or unparseable strings. */
export function parseIsoTimestamp(ts: string | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}
