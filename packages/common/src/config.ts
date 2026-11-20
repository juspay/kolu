/** Default server port. Defined in `./defaultPort.ts` — a zero-import leaf — so
 *  the kolu command tree can read it without dragging this module's terminal
 *  vocabulary (see that file's header); re-exported here because this is the
 *  door app-side consumers already know. */
export { DEFAULT_PORT } from "./defaultPort.ts";

/** The CLIENT's visible scrollback, in lines — what the browser xterm retains
 *  and what `exportScrollbackAsPdf.ts` serializes. Re-exported from its home in
 *  `@kolu/terminal-vocab` (the shared browser-safe terminal vocabulary). */
export { DEFAULT_SCROLLBACK } from "@kolu/terminal-vocab/schema";
