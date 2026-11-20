import os from "node:os";
import path from "node:path";
import { BREADCRUMB_SUBDIR } from "./agent-dir.ts";

const AGENT_DIR = process.env.KOLU_OMP_DIR
  ? process.env.KOLU_OMP_DIR
  : path.join(os.homedir(), ".omp", "agent");

/** kolu's knob as a raw value: `undefined` in production, so the per-terminal
 *  fold follows omp's own chain instead. Passed to `resolveAgentDir` rather
 *  than read there, so the fold stays pure. */
export const AGENT_DIR_OVERRIDE: string | undefined = process.env.KOLU_OMP_DIR;

/** The env key the e2e harness sets to point detection at fixtures. */
export const OMP_ENV_KEYS = ["KOLU_OMP_DIR"] as const;

/** kolu's default breadcrumb ("state" category) directory: where a
 *  DEFAULT-profile omp with no XDG state dir writes its `terminal-sessions/<tty
 *  id>` crumb. Per-terminal resolution does not use it (it goes through
 *  `resolveAgentDir`). */
export const BREADCRUMB_DIR = path.join(AGENT_DIR, BREADCRUMB_SUBDIR);
