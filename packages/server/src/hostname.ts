/** System hostname and process identity, resolved once at startup. */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export const serverHostname = hostname();

/** Unique ID for this server process — changes on every restart. */
export const serverProcessId = randomUUID();
