/**
 * THE CLAUDE CODE ENGINE, as one registration — and everything kolu knows
 * about this agent behind it.
 *
 * ## What is on THIS side of the wall, and what is not
 *
 * Here: how to find this adapter on a host, how to read its wire
 * ({@link ./leg.ts}), what its model picker calls things ({@link ./models.ts}),
 * and what a machine without it is owed ({@link ./install.ts}). Not here, and
 * never: a session, a prompt, a transcript. An integration hands over DATA and
 * PURE FUNCTIONS; `@kolu/acp-harness` does the talking. That is what makes
 * every bet in this directory a thing with a unit test rather than a branch
 * reachable only by starting a subprocess.
 *
 * ## The executable path belongs to this engine
 *
 * `KOLU_ACP_AGENT` names this adapter's command line. A Nix build bakes the
 * pinned adapter onto `koluBin`'s wrapper with `--set-default` — kolu-server
 * hosts the conversation now, so the pin rides on the binary that spawns it —
 * and that bake is what runs when nothing else supplies the name, so a person
 * who starts kolu by any documented path never has to know the variable
 * exists. An explicitly exported value WINS over the bake — a developer's own
 * build, or the e2e harness's scripted fixture adapter, which the harness
 * exports into the kolu-server process it spawns — and that ordering is the
 * only reason `orchestrator.feature` drives the fixture rather than a real
 * `claude`. An absent or empty one leaves THIS engine unseated and says why,
 * which is the {@link NotHere} arm rather than a missing row.
 */

import { join } from "node:path";

import {
  type Adapter,
  AGENT_ENV,
  adapterFrom,
  type NotHere,
  type Registering,
} from "@kolu/acp/engine";

import { INSTALL, NAME } from "./install.ts";
import { CLAUDE } from "./leg.ts";

export { INSTALL, NAME } from "./install.ts";
export { CLAUDE } from "./leg.ts";
export { MODELS, modelNameIn } from "./models.ts";

/**
 * THE VARIABLES THE ADAPTER READS AS "THIS PERSON IS SOMEWHERE ELSE", and must
 * not: `acp-agent.js` (0.81.2) computes `isRemote` as exactly
 * `NO_BROWSER || SSH_CONNECTION || SSH_CLIENT || SSH_TTY || CLAUDE_CODE_REMOTE`,
 * and on a remote session it drops its paste-a-code login methods in favour of
 * a full-screen `claude /login`. kolu runs on the far side of a browser and a
 * padi is always that remote session; the person is not.
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
 * agent-distro's launcher (the `claude` `nix/packages/acp-adapter.nix` bakes
 * into `CLAUDE_CODE_EXECUTABLE`) does NOT redirect it: it prepends
 * `--plugin-dir` flags and sets `LITELLM_BASE_URL`, `AGENT_DISTRO_CWD` and
 * `PATH`, and nothing else. So the orchestrator's agent reads the same store
 * as every `claude` the person runs in their own terminals.
 *
 * A SENTENCE, NOT A CREDENTIAL PATH. Nothing in kolu opens this directory,
 * copies out of it, or points the agent at a different one; it is published so
 * a signed-out panel can NAME the store it was judged against instead of
 * leaving the next person to guess which of the two it was.
 */
export const configDirIn = (
  env: { readonly [name: string]: string | undefined },
  home: string,
): string => env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");

/**
 * THIS ENGINE, as a VALUE.
 *
 * Exported rather than built where it is mounted for the reason every reader in
 * this directory is a pure function: what an integration registers is data, and
 * data is a thing a unit test can hold. A test asks {@link Registering.at} what
 * it makes of an environment; the alternative is a claim about this engine
 * reachable only by mounting a runtime.
 */
export const ENGINE: Registering = {
  name: NAME,
  leg: CLAUDE,
  // SHIPPED, NOT FOUND, which is why the probe is a variable read and never a
  // search-path lookup: the adapter is a wrapper inside the nix store and is on
  // nobody's PATH — `where.found` is not consulted here and padi hands one that
  // always answers `null` for exactly that reason. `null` from `adapterFrom` is
  // a padi started through neither the packaged binary nor the dev recipes — an
  // absence, not a fault — and the sentence a machine in that state is owed is
  // THIS ENGINE'S OWN ({@link ./install.ts}), handed back rather than dropped
  // so the orchestrator can publish the row and say why.
  at: (where): Adapter | NotHere => {
    const adapter = adapterFrom(where.env[AGENT_ENV]);
    if (adapter === null) return INSTALL;
    return {
      ...adapter,
      // FIVE VARIABLES THE ADAPTER MUST NOT HEAR, and every one of them is a
      // question kolu can answer better. The pinned adapter reads them to
      // decide the person is somewhere else and, on a session it calls remote,
      // offers only its own full-screen `claude /login` — a TUI the
      // orchestrator has no terminal for. kolu IS the remote end: the person is
      // at a browser, kolu runs the sign-in and draws it. So the adapter is
      // told nothing about where it is running, and it offers the paste-a-code
      // methods the harness can actually run.
      //
      // STRIPPED RATHER THAN GUESSED AT, because a variable that happens to be
      // set on somebody's host is not a fact about the person using kolu: an
      // SSH session that started padi, a development container that exports
      // `CLAUDE_CODE_REMOTE`, a `NO_BROWSER` in a shell profile. None of them
      // changes who is looking at the screen.
      unset: REMOTE_SIGNALS,
    };
  },
  // ACP has no system prompt on any wire, this one included, so the standing
  // instruction rides the first turn — where a person can read what their agent
  // was told. `@kolu/acp/engine`'s `PromptChannel` argues it, and the harness
  // switches on it exhaustively.
  prompt: { kind: "first-turn" },
};
