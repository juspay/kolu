import { join } from "node:path";

/**
 * THE VARIABLES THE ADAPTER READS AS "THIS PERSON IS SOMEWHERE ELSE", and must
 * not: `acp-agent.js` (0.81.2) computes `isRemote` as exactly
 * `NO_BROWSER || SSH_CONNECTION || SSH_CLIENT || SSH_TTY || CLAUDE_CODE_REMOTE`,
 * and on a remote session it drops its paste-a-code login methods in favour of
 * a full-screen `claude /login`. kolu runs on the far side of a browser and a
 * padi is always that remote session; the person is not.
 *
 * Published as data rather than applied here, because stripping an environment
 * is a decision about a PROCESS: kolu's registry hands this list to
 * `Registering.at` ({@link @kolu/acp/engine}), and olai's server strips the same
 * five from its own spawn.
 */
export const REMOTE_SIGNALS: ReadonlyArray<string> = [
  "NO_BROWSER",
  "SSH_CONNECTION",
  "SSH_CLIENT",
  "SSH_TTY",
  "CLAUDE_CODE_REMOTE",
];

/**
 * WHERE THIS AGENT KEEPS ITS SIGNATURE on the host kolu-server is running on.
 *
 * The CLI under the adapter reads `$CLAUDE_CONFIG_DIR` when one is exported
 * and `$HOME/.claude` otherwise — and MEASURED on the pair this build pins,
 * agent-distro's launcher (the `claude` `./adapter/default.nix` feeds kolu's
 * adapter build as `CLAUDE_CODE_EXECUTABLE`) does NOT redirect it: it prepends
 * `--plugin-dir` flags and sets `LITELLM_BASE_URL`, `AGENT_DISTRO_CWD` and
 * `PATH`, and nothing else. So the conductor's agent reads the same store as
 * every `claude` the person runs in their own terminals.
 *
 * A SENTENCE, NOT A CREDENTIAL PATH. Nothing in either product opens this
 * directory, copies out of it, or points the agent at a different one; it is
 * published so a signed-out panel can NAME the store it was judged against
 * instead of leaving the next person to guess which of the two it was.
 */
export const configDirIn = (
  env: { readonly [name: string]: string | undefined },
  home: string,
): string => env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
