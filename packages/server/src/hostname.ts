/** System hostname and process identity, resolved once at startup. */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export const serverHostname = hostname();

/** Unique ID for this server process — changes on every restart. */
export const serverProcessId = randomUUID();

/** Git commit this server was built from — the nix wrapper bakes
 *  `KOLU_COMMIT_HASH`. `""` off-nix (dev / tsx, where the wrapper isn't in
 *  play). Surfaced on `server.info` for the ChromeBar's `srv` column. */
export const serverCommit = process.env.KOLU_COMMIT_HASH ?? "";

/** App version (X.Y) this server was built from. Every launch path *sets*
 *  `KOLU_VERSION`: the nix wrapper bakes a real `X.Y`, the devShell sets it
 *  empty ("no released version" — the rail then hides it). So an **unset**
 *  value can only mean a nix-built artifact dropped the var — a packaging
 *  regression. There is NO silent fallback for that: we refuse to boot rather
 *  than ship a blank-but-plausible version (cf. the #761 smoke-test class).
 *  Surfaced beside `commit` on the rail's `srv` column as `vX.Y · <hash>`. */
const koluVersion = process.env.KOLU_VERSION;
if (koluVersion === undefined) {
  throw new Error(
    "KOLU_VERSION is unset — the nix wrapper and the devShell each bake it " +
      "(real X.Y vs. empty). An unset value is a packaging regression; " +
      "refusing to boot.",
  );
}
export const serverVersion = koluVersion;
