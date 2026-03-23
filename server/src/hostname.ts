/** System hostname, resolved once at startup. */
import { hostname } from "node:os";

export const serverHostname = hostname();
