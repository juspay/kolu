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

/**
 * `where` is null: installing anything does not restore a wrapper padi was
 * started without. The adapter is kolu's to provide, not the user's to
 * download.
 *
 * A WHOLE SENTENCE and nothing composes around it. **The harness displays a
 * sentence and never composes one** — the same rule `NotHere.why` is declared
 * under.
 */
const INSTALL: NotHere = {
  name: NAME,
  where: null,
  why: "not found — this host's padi was started without the wrapper that carries the pinned adapter",
};

/**
 * THE CLAUDE CODE ENGINE, as a VALUE — everything kolu's side of the wall adds
 * to the facts its own package owns.
 *
 * Exported rather than built where it is mounted for the reason every reader in
 * this tree is a pure function: what an integration registers is data, and data
 * is a thing a unit test can hold.
 */
export const ENGINE: Registering = {
  name: NAME,
  leg: CLAUDE,
  // SHIPPED, NOT FOUND, which is why the probe is a variable read and never a
  // search-path lookup: the adapter is a wrapper inside the nix store and is on
  // nobody's PATH — `where.found` is not consulted here and padi hands one that
  // always answers `null` for exactly that reason.
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

/**
 * The engine a host's conductor runs, WITH THE KEY IT IS REGISTERED UNDER —
 * which is what a caller that has to name the agent (the client files a
 * conversation's memory and model notes under it) reads, so nobody retypes
 * the word.
 *
 * A CONSTANT rather than a setting, deliberately: the adapter it names is
 * baked into kolu's closure (`KOLU_ACP_AGENT`), one per build, and an engine
 * knob would be a choice a person could make that the binary cannot honour.
 * When a second adapter is pinned, this becomes a reading of whatever the
 * build actually carries — still not a knob.
 */
export const CONDUCTOR_ENGINE: Engine = { id: CLAUDE_CODE, ...ENGINE };

/**
 * WHERE THAT ENGINE READS ITS SIGNATURE on the host this daemon runs on.
 *
 * HERE for the reason every other per-agent fact is: the conductor has to
 * NAME the store in the sentence it shows a signed-out person, and a daemon
 * that worked the path out itself would be a daemon that knows an agent's
 * credential layout — the exact braid `agentDepFence.test.ts` holds red. The
 * engine's own package owns the answer; this is the registry handing it over
 * without the caller learning whose it is.
 *
 * A SENTENCE, NOT A CREDENTIAL PATH: nothing above reads the directory, and
 * nothing anywhere points an agent at a different one.
 */
export const conductorConfigDir = (
  env: { readonly [name: string]: string | undefined },
  home: string,
): string => claudeConfigDir(env, home);
