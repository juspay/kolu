/** System hostname and process identity, resolved once at startup. */
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export const serverHostname = hostname();

/** Unique ID for this server process — changes on every restart. */
export const serverProcessId = randomUUID();
