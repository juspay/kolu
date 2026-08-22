import type { IncomingMessage } from "node:http";

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
    // be set-cookie, which the allowlist refuses at bind.
    if (Array.isArray(value)) {
      throw new Error(
        `serveSurfaceApp: ${JSON.stringify(asked)} arrived as a list — node only hands set-cookie over that way, and the allowlist refuses it`,
      );
    }
    picked[asked] = value;
  }
  return Object.freeze(picked);
};
