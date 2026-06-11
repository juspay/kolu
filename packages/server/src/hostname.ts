/** System hostname and process identity, resolved once at startup. */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import pkg from "../package.json" with { type: "json" };

export const serverHostname = hostname();

/** Unique ID for this server process — changes on every restart. */
export const serverProcessId = randomUUID();

/** Epoch-millis this server process booted — resolved once at import. Feeds
 *  the rail's `srv` uptime readout. Resets on every server restart, so when a
 *  surviving daemon outlives a deploy the rail shows `pty up 3h` against
 *  `srv up 2m` — visible proof the daemon survived. */
export const serverStartedAt = Date.now();

/** Git commit this server was built from — the nix wrapper bakes
 *  `KOLU_COMMIT_HASH`. `""` off-nix (dev / tsx, where the wrapper isn't in
 *  play). Surfaced on `server.info` for the ChromeBar's `srv` column. */
export const serverCommit = process.env.KOLU_COMMIT_HASH ?? "";

/** The app version — single source of truth is `packages/server/package.json`.
 *  `/release` bumps it before tagging; Nix reads the *same* file for the
 *  derivation version (no nix literal to drift). It's a committed, bundled
 *  file, so it's always present — no env var, nothing to "propagate" or fail
 *  hard on. This one accessor feeds the rail's `srv` column (`vX.Y.Z · <hash>`),
 *  `--version`, the startup log, and the pty's `TERM_PROGRAM_VERSION`. */
export const serverVersion = pkg.version;
