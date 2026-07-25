/**
 * The bits of wire vocabulary both faces of the proxy have to agree on.
 *
 * Its own module for the same reason `events.ts` is: the proxy PRODUCES these
 * and a client CONSUMES them, so neither should have to import the other to
 * name them. `SESSION_CWD_META` living in the client module meant the server
 * imported its own consumer to spell a constant it writes.
 */

/**
 * Where a proxy publishes the working directory its one session is rooted at,
 * inside the `initialize` response's `_meta`. `session/new` refuses any other
 * directory, and a client cannot obey a rule it has no way to read.
 */
export const SESSION_CWD_META = "kolu.acp/cwd";
