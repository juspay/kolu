/**
 * The upgrade's header ALLOWLIST — its grammar, and its read.
 *
 * Two halves of one thing, which must not drift: {@link checkUpgradeHeaders}
 * says which names a connection may be read under, and
 * {@link pickUpgradeHeaders} reads exactly those off one upgrade. WHY an app
 * names headers at all — and why an unnamed one is not merely filtered but
 * unreachable — is `./serve`'s module header.
 */

import { type IncomingMessage, validateHeaderName } from "node:http";

/** The allowlist's grammar, checked — and the names handed back UNCHANGED, so
 *  `H` reaches {@link pickUpgradeHeaders} straight off the app's own array and
 *  the picked record's keys are CHECKED against it rather than asserted.
 *
 *  The grammar is `node:http`'s own `validateHeaderName` — the same check the
 *  runtime applies to a header it writes, so this seam cannot drift from what a
 *  request can carry. A name outside it can never match, so an app asking for
 *  one would read a permanent, silent absence as "my proxy never sends this".
 *
 *  Two spellings of ONE wire header (`X-Forwarded-For` beside
 *  `x-forwarded-for`) are the same class of defect and are refused the same
 *  way: they would file one wire value under two keys, with nothing saying the
 *  two reads agree.
 *
 *  `set-cookie` is refused for a third reason of the same kind: it is the ONE
 *  header node hands over as an array, and its values contain commas of their
 *  own (`Expires=Wed, 21 Oct 2026 …`), so the comma-joined string this seam
 *  reports every other header as cannot be split back apart — RFC 6265 §5.2
 *  forbids folding it for exactly that reason. A name whose value this seam
 *  cannot state honestly is refused rather than reported wrongly. (It is a
 *  RESPONSE header; a request that carries one is already odd.)
 *
 *  ## Why it is exported, and where an app calls it
 *
 *  `serveSurfaceApp` calls this at the bind for a FIXED allowlist and at each
 *  accept for a LIVE one — and at an accept a bad name must not take the socket
 *  down (`./serve`'s `UpgradeHeadersRefused`), so the loud failure has nowhere
 *  to land there. An app whose allowlist is ASSEMBLED — a plugin row that
 *  offers its identity header when it is switched on — calls this where it
 *  MINTS the list, so a bad name fails THAT part, with this sentence, before
 *  any socket is ever accepted. The accept-time refusal is then only the race
 *  between an offer and an accept, which is the honest residue.
 *
 *  Throws rather than failing with `SurfaceAppListenFailed`: a bad name is the
 *  app's own defect, not a condition of the machine, and handing it to a
 *  consumer's `EADDRINUSE` port policy would have it retry forever against
 *  something no port can fix. */
export const checkUpgradeHeaders = <H extends string>(
  names: ReadonlyArray<H>,
): ReadonlyArray<H> => {
  const seen = new Set<string>();
  for (const asked of names) {
    try {
      validateHeaderName(asked);
    } catch {
      throw new Error(
        `upgradeHeaders: ${JSON.stringify(asked)} is not an HTTP header name — a connection's headers can only carry names a request can actually carry`,
      );
    }
    const lowercased = asked.toLowerCase();
    if (lowercased === "set-cookie") {
      throw new Error(
        `upgradeHeaders: ${JSON.stringify(asked)} cannot be read off an upgrade — set-cookie is the one header that arrives as a list, and its values carry commas, so the joined string this seam reports cannot be split back apart`,
      );
    }
    if (seen.has(lowercased)) {
      throw new Error(
        `upgradeHeaders: ${JSON.stringify(asked)} names a header already in upgradeHeaders — one wire header cannot be read under two names`,
      );
    }
    seen.add(lowercased);
  }
  return names;
};

/** The named headers one upgrade carried, and nothing else.
 *
 *  Node hands a REPEATED header over already folded into one comma-joined
 *  string (`", "`). This function does not re-fold: with `set-cookie` refused at
 *  the allowlist, a value is a string or absent. An array reaching here is a
 *  defect — node's one array-shaped header, which the allowlist refuses to name
 *  — not a shape to join. `forwardedForOf` in `@kolu/surface` is the one
 *  remaining spelling of that fold, and it stays private there.
 *
 *  Prototype-free on BOTH sides, which is not tidiness: `constructor` and
 *  `__proto__` are valid field names, so a plain `{}` would answer
 *  `headers["constructor"]` with `Object`'s constructor for a header nobody
 *  sent, and `picked["__proto__"] = …` would hit the setter and store nothing
 *  at all. `Object.hasOwn` and a null-prototype target make both unrepresentable
 *  rather than unlikely. Frozen so this record cannot be written through after
 *  the fact — one object is handed to `services` and to every later event arm. */
export const pickUpgradeHeaders = <H extends string>(
  request: IncomingMessage,
  names: ReadonlyArray<H>,
): Readonly<Partial<Record<H, string>>> => {
  // The one cast is about the PROTOTYPE, not the keys: `H` reaches this record
  // off the app's own allowlist, so nothing here ASSERTS that the keys are the
  // names — the compiler holds it.
  const picked = Object.create(null) as Partial<Record<H, string>>;
  for (const asked of names) {
    const lowercased = asked.toLowerCase();
    if (!Object.hasOwn(request.headers, lowercased)) continue;
    const value = request.headers[lowercased];
    // `undefined` is "not sent" and stays absent; `""` is a value and is kept.
    if (value === undefined) continue;
    // Node has already folded a repeated header (`", "`). An array here would
    // be set-cookie, which the allowlist refuses wherever it is checked.
    if (Array.isArray(value)) {
      throw new Error(
        `upgradeHeaders: ${JSON.stringify(asked)} arrived as a list — node only hands set-cookie over that way, and the allowlist refuses it`,
      );
    }
    picked[asked] = value;
  }
  return Object.freeze(picked);
};
