/**
 * The close frame a surface socket is allowed to carry — one rule, one home,
 * shared by both ends of the seam that sends one: the app's
 * `SurfaceAppConnection.close` (which must reject a bad frame at the CALLER,
 * before the serving exists) and `SurfaceSocketServing.close` (which owns the
 * socket). Neither is exported from the package, so this module is the rule's
 * only door.
 *
 * Why it is not left to `ws`: `ws.close` sets `readyState = CLOSING` and only
 * THEN validates, so a bad frame strands the peer with no close frame and no
 * close timer. The check has to run before anything changes, and the only way to
 * guarantee that on both paths is for both paths to ask the same function.
 */

/** The close frame this seam is willing to put on the wire — `1000` (normal
 *  closure) or an APPLICATION code, `3000`–`4999` (RFC 6455 §7.4.2), with a
 *  reason of at most 123 UTF-8 bytes (a control frame's payload is 125 bytes,
 *  less the two-byte code). Anything else throws `RangeError`, and the reason is
 *  counted in BYTES — 42 of `あ` is already over the limit.
 *
 *  `Number.isInteger` is the first half of the code check, not decoration: `NaN`
 *  fails every range comparison (`NaN < 3000` and `NaN > 4999` are both false),
 *  so a bare range check waves it through to a transport that throws *after*
 *  marking the socket CLOSING. It is reachable from typed code (`Number(h)`), and
 *  a non-number from an untyped caller behaves the same way. */
export function checkCloseFrame(code?: number, reason?: string): void {
  if (
    code !== undefined &&
    (!Number.isInteger(code) || (code !== 1000 && (code < 3000 || code > 4999)))
  ) {
    throw new RangeError(
      `close code ${String(code)} is not one this seam sends: use 1000 (normal closure) or the application range 3000–4999 (RFC 6455 §7.4.2)`,
    );
  }
  if (reason !== undefined) {
    if (typeof reason !== "string") {
      throw new RangeError(
        `close reason must be a string, got ${typeof reason}`,
      );
    }
    const bytes = Buffer.byteLength(reason, "utf8");
    if (bytes > 123) {
      throw new RangeError(
        `close reason is ${bytes} UTF-8 bytes; a control frame carries at most 123`,
      );
    }
  }
}
