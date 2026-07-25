/**
 * `acp-proxy`'s command line.
 *
 * Its own module so it can be tested without importing the proxy, whose module
 * body starts a server the moment it is loaded.
 *
 * Deliberately not `node:util`'s `parseArgs`: the contract here is that the
 * `--` separator is **mandatory** — it is what makes the adapter command
 * unambiguous data rather than flags this program might one day want to claim.
 * `parseArgs` folds bare positionals and post-`--` tokens into the same array,
 * so it cannot express "the separator is required", which is the one rule worth
 * enforcing.
 */

export const USAGE =
  "usage: acp-proxy --id <id> -- <adapter-command> [args...]";

export interface ProxyArgv {
  /** Names the socket; in kolu this is the terminal the proxy runs in. */
  id: string;
  /** The adapter to spawn, resolved on PATH exactly as typed. */
  command: string;
  args: string[];
}

export function parseArgv(argv: string[]): ProxyArgv {
  const separator = argv.indexOf("--");
  if (separator === -1) {
    throw new Error(`the adapter command must follow \`--\`\n${USAGE}`);
  }
  const flags = argv.slice(0, separator);
  const [command, ...args] = argv.slice(separator + 1);
  if (!command) {
    throw new Error(`no adapter command after \`--\`\n${USAGE}`);
  }
  if (flags.length !== 2 || flags[0] !== "--id" || !flags[1]) {
    throw new Error(`--id <id> is required\n${USAGE}`);
  }
  return { id: flags[1], command, args };
}
