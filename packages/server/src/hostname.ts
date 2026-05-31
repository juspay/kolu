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
