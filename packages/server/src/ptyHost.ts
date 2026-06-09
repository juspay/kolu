/**
 * The single in-process pty-host for this kolu-server process.
 *
 * `servePtyHost`'s router is the transport-agnostic seam: this module builds
 * the host once and exposes both views of it —
 *   - `ptyHostClient` — the identity-link (`directLink`, no wire) client the
 *     `LocalTerminalBackend` (the web path) consumes;
 *   - `ptyHostServedRouter` — the same host's contract-wrapped router, which
 *     `index.ts` serves over a unix socket so `kolu-tui` (the raw CLI client)
 *     can reach the same PTYs.
 *
 * One PTY host, two transports, byte-identical handlers. Instantiating here
 * (rather than inside `local.ts`) keeps it a single shared instance — both
 * `local.ts` and the socket listener import from this one module, so the
 * pty-host can never be accidentally created twice.
 */
import { createInProcessPtyHost } from "@kolu/pty-host";
import pkg from "../package.json" with { type: "json" };
import { koluShellDir } from "./koluRoot.ts";
import { log } from "./log.ts";

const ptyHost = createInProcessPtyHost({
  log,
  shellDir: koluShellDir,
  version: pkg.version,
});

/** The contract-wrapped router — served over the unix socket in `index.ts`
 *  for kolu-tui (and, later, a standalone daemon). */
export const ptyHostServedRouter = ptyHost.servedRouter;

/** The in-process (no-wire) client the LocalTerminalBackend consumes. */
export const ptyHostClient = ptyHost.client;
