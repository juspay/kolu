import os from "node:os";
import path from "node:path";

/** kolu's default oh-my-pi agent directory — `KOLU_OMP_DIR` when the harness
 *  set it, else omp's own `~/.omp/agent`. omp's agent dir is the root of its
 *  state tree and the directory holding the `terminal-sessions` breadcrumbs
 *  kolu anchors detection on; omp's own `PI_CODING_AGENT_DIR` env var overrides
 *  it, and its default is `~/.omp/agent` (omp 18.1.21's `getAgentDir()`,
 *  `packages/utils/src/dirs.ts`), itself a function of omp's `PI_CONFIG_DIR`
 *  (default `.omp`).
 *
 *  `KOLU_OMP_DIR` is deliberately the sole kolu knob and overrides nothing
 *  per-invocation: omp's own directory chain (`PI_CODING_AGENT_DIR`, `--profile`
 *  / `OMP_PROFILE` / `PI_PROFILE`, `PI_CONFIG_DIR`, the XDG state dir) belongs to
 *  the omp process in the terminal, not to padi, and is resolved per terminal
 *  from that process's own argv/env — see `agent-dir.ts`. Reading it from the
 *  DAEMON's env here would be a silent lie on any host that doesn't run padi
 *  inside the omp deployment env, so config never consults `OMP_*`/`PI_*`.
 *
 *  Module-private: the value a consumer needs is `resolveAgentDir`'s
 *  per-terminal answer, and a public `AGENT_DIR` would read as exactly that. */
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
 *  id>` crumb. Two consumers only — the `externalChanges.isPresent` probe, and
 *  the e2e fixture. Per-terminal resolution never uses it (it goes through
 *  `resolveAgentDir`). */
export const BREADCRUMB_DIR = path.join(AGENT_DIR, "terminal-sessions");
