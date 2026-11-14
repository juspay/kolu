/**
 * HOW A TERMINAL CAME TO BE WATCHED — the whole vocabulary, in one place.
 *
 * This word crosses three boundaries: an MCP tool records it (`watch_terminal`,
 * `lifecycle_create`), the Conductor's rules decide `ready` and `ended` from it
 * (`kolu-conductor`'s `WatchJoin`), and it is written to disk with the
 * conversation (`kolu-conductor`'s persisted record). Spelled once per
 * boundary, a fourth join would COMPILE in all three and then be refused at the
 * next boot's record decode — after the write that made the file unreadable.
 *
 * **A LEAF with no imports at all**, for the same reason `./ref.ts` is one: the
 * rules package reaches it as `kolu-mcp/fleetWatchJoin` and must not take an
 * edge to the MCP SDK, to padi-client or to effect to learn three words. The
 * effect SCHEMA built on this tuple lives in `./fleetSurface.ts`, where effect
 * is allowed, and the persisted field builds its own from the same tuple.
 */

/**
 * The joins, as the tuple both schemas are built from.
 *
 * - `created` — the Conductor opened it (`lifecycle_create`) with no command.
 * - `created-run` — ... and typed a command at its first prompt. The ONLY join
 *   `ended` applies to: nothing else gives kolu a command whose return to the
 *   prompt means anything.
 * - `asked` — the Conductor (or a person) put an existing terminal on the list
 *   with `watch_terminal`. The only join that BASELINES, because it is the only
 *   one whose terminal already has a state nobody here caused.
 */
export const FLEET_WATCH_JOINS = ["created", "created-run", "asked"] as const;
