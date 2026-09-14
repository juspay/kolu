/** The e2e harness's EXPLICIT agent lists — kept explicit on purpose, because a
 *  harness that derived its fixtures from the registry would stop catching a
 *  registry mistake. Extracted into this side-effect-free module so the
 *  coverage test can assert the harness stays a SUBSET of the registry without
 *  importing `hooks.ts` (whose top-level creates fixtures, copies binaries and
 *  mutates the env). */

/** The agent-dir vars the harness sets/clears for a mock run. Deliberately
 *  narrower than the registry's `AGENT_DIR_ENV_KEYS`: the harness leaves the
 *  `*_DB` keys (codex/opencode) alone, so they are NOT here. Asserted a subset
 *  in `governance/agentHarnessCoverage.test.ts`. */
export const AGENT_DIR_VARS = [
  "KOLU_CLAUDE_SESSIONS_DIR",
  "KOLU_CLAUDE_PROJECTS_DIR",
  "KOLU_CODEX_DIR",
  "KOLU_GROK_DIR",
  "KOLU_PI_DIR",
  "KOLU_OMP_DIR",
  "KOLU_XYNE_DIR",
] as const;

/** Every fake binary the harness stages (copies of `bash`, renamed). `node` is
 *  NOT an agent — it is the root process for the command-rooted spawn repro. */
export const FAKE_BIN_NAMES = [
  "codex",
  "opencode",
  "grok",
  "claude",
  "node",
  "pi",
  "omp",
  "xyne",
] as const;
