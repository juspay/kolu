/**
 * WHICH AGENTS SPEAK THE AGENT CLIENT PROTOCOL — the registry's ACP half.
 *
 * Every other per-agent fact in kolu is folded here rather than reached for by
 * name, and the conductor's engine is no exception: `@kolu/padi` hosts one
 * ACP conversation per host, and a padi that imported `kolu-claude-code`
 * directly would have re-braided the per-agent knowledge this package exists
 * to de-complect. `packages/tests/governance/agentDepFence.test.ts` holds that
 * red — a daemon naming an agent is the defect, and this file is the fix
 * rather than an exemption.
 *
 * ONE ENGINE TODAY, and the shape is the ruling rather than a placeholder. The
 * `Registering` contract (`@kolu/acp/engine`) already says everything a second
 * agent would need to say — its name, the leg that reads its wire, how to seat
 * it on a host, and the channel its standing prompt rides — so a codex or an
 * opencode that grows an ACP adapter joins by adding a row to {@link ACP_ENGINES},
 * and nothing above here learns its name.
 */

import type { Registering } from "@kolu/acp/engine";
import {
  ENGINE as CLAUDE_CODE,
  configDirIn as claudeConfigDir,
} from "kolu-claude-code/acp";

/** Every agent kolu can hold an ACP conversation with, by the registry's own
 *  agent kind. */
export const ACP_ENGINES: Readonly<Record<string, Registering>> = {
  "claude-code": CLAUDE_CODE,
};

/**
 * The engine a host's conductor runs.
 *
 * A CONSTANT rather than a setting, deliberately: the adapter it names is
 * baked into kolu's closure (`KOLU_ACP_AGENT`), one per build, and an engine
 * knob would be a choice a person could make that the binary cannot honour.
 * When a second adapter is pinned, this becomes a reading of whatever the
 * build actually carries — still not a knob.
 */
export const CONDUCTOR_ENGINE: Registering = CLAUDE_CODE;

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
