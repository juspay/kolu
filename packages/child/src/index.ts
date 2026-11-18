/**
 * @kolu/child — one owner for a subprocess.
 *
 * Spawn, the exec-failure that arrives after spawn returns, drained pipes, and
 * a kill with a grace period. Listeners attach at spawn. A wait is the EVENT
 * (the chunk, the exit, ESRCH); a clock is only a hang detector that throws
 * with what the child said.
 *
 * Explicitly out: readiness, transport, restart policy, the orphan sweep. A
 * caller whose needs exceed the socket keeps that residue on top of it.
 */

export {
  type Child,
  type Close,
  childEnvOf,
  Hung,
  run,
  type Run,
  type Said,
  start,
  type Start,
} from "./child.ts";
