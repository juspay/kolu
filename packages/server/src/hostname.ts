/** System hostname and process identity, resolved once at startup.
 *  Call `initHostname()` before accessing the exports. */
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

// Set by initHostname(). Declared as `let` so the module is inert on import —
// the system call and crypto operation only happen when the server explicitly
// requests them, not as a side effect of loading the module graph.
export let serverHostname: string;

/** Unique ID for this server process — changes on every restart. */
export let serverProcessId: string;

/** Resolve hostname and generate a process UUID. Must be called once
 *  before any module that reads `serverHostname` or `serverProcessId`. */
export function initHostname(): void {
  serverHostname = hostname();
  serverProcessId = randomUUID();
}
