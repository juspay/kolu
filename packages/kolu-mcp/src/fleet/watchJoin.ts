/**
 * The joins, as the tuple both schemas are built from.
 *
 * - `created` — the Conductor opened it (`lifecycle_create`) with no command.
 * - `created-run` — ... and typed a command at its first prompt. The ONLY join
 *   `ended` applies to: nothing else gives kolu a command whose return to the
 *   prompt means anything.
 * - `asked` — the Conductor (or a person) adopted an existing terminal into a
 *   work with `work_adopt`. The only join that BASELINES, because it is the
 *   only one whose terminal already has a state nobody here caused.
 */
export const FLEET_WATCH_JOINS = ["created", "created-run", "asked"] as const;
