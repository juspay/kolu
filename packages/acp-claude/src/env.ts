import { join } from "node:path";

/**
 * THE VARIABLES THE ADAPTER READS AS "THIS PERSON IS SOMEWHERE ELSE", and must
 * not: `acp-agent.js` (0.81.2) computes `isRemote` as exactly
 * `NO_BROWSER || SSH_CONNECTION || SSH_CLIENT || SSH_TTY || CLAUDE_CODE_REMOTE`,
 * and on a remote session it drops its paste-a-code login methods in favour of
 * a full-screen `claude /login`.
 */
export const REMOTE_SIGNALS: ReadonlyArray<string> = [
  "NO_BROWSER",
  "SSH_CONNECTION",
  "SSH_CLIENT",
  "SSH_TTY",
  "CLAUDE_CODE_REMOTE",
];

export const configDirIn = (
  env: { readonly [name: string]: string | undefined },
  home: string,
): string => env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
