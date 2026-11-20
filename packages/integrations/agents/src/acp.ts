/**
 * WHICH AGENTS SPEAK THE AGENT CLIENT PROTOCOL — the registry's ACP half.
 *
 * Every other per-agent fact in kolu is folded here rather than reached for by
 * name, and the conductor's engine is no exception: `@kolu/padi` hosts one
 * ACP conversation per host, and a padi that imported `@kolu/acp-claude`
 * directly would have re-braided the per-agent knowledge this package exists
 * to de-complect. `packages/tests/governance/agentDepFence.test.ts` holds that
 * red — a daemon naming an agent is the defect, and this file is the fix
 * rather than an exemption.
 *
 * THE SEAM THIS FILE IS, now that the agent's own facts live in a package both
 * products share: `@kolu/acp-claude` owns the leg, the adapter, the model table
 * and the name; THIS file owns what it takes to SEAT that engine on a host —
 * which variable carries the adapter's command line, which five variables the
 * adapter must not hear, and the sentence a machine without it is owed. The
 * sentence says "this host's padi was started without the wrapper that carries
 * the pinned adapter", and a padi is kolu's; the same package vendored into
 * olai would be telling a person about a daemon olai does not have.
 *
 * ONE ENGINE TODAY, and the shape is the ruling rather than a placeholder. The
 * `Registering` contract (`@kolu/acp/engine`) already says everything a second
 * agent would need to say — its name, the leg that reads its wire, how to seat
 * it on a host, and the channel its standing prompt rides — so a codex or an
 * opencode that grows an ACP adapter joins by adding a row to {@link ACP_ENGINES},
 * and nothing above here learns its name.
 */

import type { Engine, Registering } from "@kolu/acp/engine";
import {
  type Adapter,
  AGENT_ENV,
  adapterFrom,
  type NotHere,
} from "@kolu/acp/engine";
import {
  COMPACTION_OVERRIDES,
  compactingAt,
  configDirIn as claudeConfigDir,
  NAME,
  REMOTE_SIGNALS,
} from "@kolu/acp-claude";

/**
 * ...AND WHAT A MACHINE THAT HAS NONE IS TOLD.
 *
 * IT SAYS THE CAUSE rather than the ordinary case, and the difference matters
 * because of WHEN it is read. This engine does ship with kolu — the pinned
 * adapter is baked into padi's wrapper on every documented way of starting a
 * host — so the only way anybody reaches this sentence is a padi started round
 * all of them. A row that said "comes with kolu" would be telling a person the
 * thing that is true everywhere except where they are standing, which is the
 * shape of an error message that reads as correct and helps nobody.
 *
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

const COMPACTS_AT = 200_000;

/**
 * WHAT THE LAUNCHER IN FRONT OF THIS ADAPTER SETS, said again. The adapter
 * drives agent-distro's `claude`, which launches the CLI with `--settings`
 * turning Claude Code's own attribution off; the session settings the leg
 * opens with replace those rather than merge with them (measured), so they
 * carry this too. A person who turned attribution on in their own settings is
 * overridden by it, for the Conductor's session only.
 */
const LAUNCHER_SETTINGS = { attribution: { commit: "", pr: "" } };

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
  ...compactingAt(COMPACTS_AT, LAUNCHER_SETTINGS),
  // SHIPPED, NOT FOUND, which is why the probe is a variable read and never a
  // search-path lookup: the adapter is a wrapper inside the nix store and is on
  // nobody's PATH — `where.found` is not consulted here and padi hands one that
  // always answers `null` for exactly that reason. `null` from `adapterFrom` is
  // a padi started through neither the packaged binary nor the dev recipes — an
  // absence, not a fault — and the sentence a machine in that state is owed is
  // {@link INSTALL}, handed back rather than dropped so the conductor can
  // publish the row and say why.
  at: (where): Adapter | NotHere => {
    const adapter = adapterFrom(where.env[AGENT_ENV]);
    if (adapter === null) return INSTALL;
    return {
      ...adapter,
      // FIVE VARIABLES THE ADAPTER MUST NOT HEAR, and every one of them is a
      // question kolu can answer better. The pinned adapter reads them to
      // decide the person is somewhere else and, on a session it calls remote,
      // offers only its own full-screen `claude /login` — a TUI the
      // conductor has no terminal for. kolu IS the remote end: the person is
      // at a browser, kolu runs the sign-in and draws it. So the adapter is
      // told nothing about where it is running, and it offers the paste-a-code
      // methods the harness can actually run.
      //
      // STRIPPED RATHER THAN GUESSED AT, because a variable that happens to be
      // set on somebody's host is not a fact about the person using kolu: an
      // SSH session that started padi, a development container that exports
      // `CLAUDE_CODE_REMOTE`, a `NO_BROWSER` in a shell profile. None of them
      // changes who is looking at the screen.
      //
      // ... AND FOUR MORE THAT WOULD OVERRIDE THE COMPACTION the open's
      // settings ask for ({@link COMPACTS_AT}): a host that exports
      // one would otherwise turn it off or move it, for this conversation and
      // without a word.
      unset: [...REMOTE_SIGNALS, ...COMPACTION_OVERRIDES],
    };
  },
  // This adapter takes ACP's standard system prompt nowhere and its own only
  // through a private field, so the standing instruction rides messages —
  // where a person can read what their agent was told. `@kolu/acp/engine`'s
  // `PromptChannel` argues it, and the harness switches on it exhaustively.
  prompt: { kind: "first-turn" },
};

/** The word this engine is registered under — an identifier, not the name a
 *  person reads ({@link ENGINE}`.name`). Written once, here, and read by both
 *  the registry below and the conductor that files its conversation's notes
 *  under it. */
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
