import type { Engine, Registering } from "@kolu/acp/engine";
import {
  type Adapter,
  AGENT_ENV,
  adapterFrom,
  type NotHere,
} from "@kolu/acp/engine";
import {
  CLAUDE,
  configDirIn as claudeConfigDir,
  NAME,
  REMOTE_SIGNALS,
} from "@kolu/acp-claude";

const INSTALL: NotHere = {
  name: NAME,
  where: null,
  why: "not found — this host's padi was started without the wrapper that carries the pinned adapter",
};

export const ENGINE: Registering = {
  name: NAME,
  leg: CLAUDE,
  at: (where): Adapter | NotHere => {
    const adapter = adapterFrom(where.env[AGENT_ENV]);
    if (adapter === null) return INSTALL;
    return {
      ...adapter,
      unset: REMOTE_SIGNALS,
    };
  },
  prompt: { kind: "first-turn" },
};

const CLAUDE_CODE = "claude-code";

/** Every agent kolu can hold an ACP conversation with, by the registry's own
 *  agent kind. */
export const ACP_ENGINES: Readonly<Record<string, Registering>> = {
  [CLAUDE_CODE]: ENGINE,
};

export const CONDUCTOR_ENGINE: Engine = { id: CLAUDE_CODE, ...ENGINE };

export const conductorConfigDir = (
  env: { readonly [name: string]: string | undefined },
  home: string,
): string => claudeConfigDir(env, home);
