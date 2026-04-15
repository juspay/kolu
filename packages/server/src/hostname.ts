/** System hostname and process identity, resolved once at startup.
 *  Call `initHostname()` before accessing the getters. */
import { hostname as osHostname } from "node:os";
import { randomUUID } from "node:crypto";

// Private mutable state — never exported directly. Getters throw a
// descriptive error if accessed before init, instead of the opaque
// "Cannot read properties of undefined" you'd get with `export let`.
let _hostname: string | null = null;
let _processId: string | null = null;

/** System hostname, resolved once at startup. */
export function serverHostname(): string {
  if (!_hostname) throw new Error("serverHostname: call initHostname() first");
  return _hostname;
}

/** Unique ID for this server process — changes on every restart. */
export function serverProcessId(): string {
  if (!_processId) throw new Error("serverProcessId: call initHostname() first");
  return _processId;
}

/** Resolve hostname and generate a process UUID. Must be called once
 *  before any module that reads `serverHostname` or `serverProcessId`. */
export function initHostname(): void {
  _hostname = osHostname();
  _processId = randomUUID();
}
