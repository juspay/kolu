/**
 * WHAT IT TAKES TO SEAT AN ACP AGENT ON THIS HOST — the shape one AGENT
 * INTEGRATION hands over, and the shape the harness reads it back as.
 *
 * ## Why this is a module and not a table
 *
 * A table would put every agent's leg, id and probe in one file, so a second
 * agent is a PR in two packages. Each agent kolu knows how to talk to is one
 * package under `packages/integrations/` instead — its own adapter pin, its
 * own release clock (the Claude adapter's moved five times in a month) — so
 * what would have been a table is a REGISTRATION, and this is what it carries.
 *
 * ## Why it lives in `@kolu/acp`
 *
 * An integration registers these data and `@kolu/acp-harness` owns their
 * detection and use. An integration may not import the harness and the harness
 * may not import an integration, so the shared shape belongs below both
 * owners, at the protocol boundary.
 *
 * An integration hands over EITHER the adapter to spawn OR the sentence a
 * machine without it is owed, so `null` — the arm that silently dropped a row
 * from every face — is unspellable. This is the engine contract's canonical
 * `NotHere`; non-ACP probes declare their own structural absence below their
 * own boundary rather than depending on the engine protocol.
 */

import type { Leg } from "./leg.ts";

export * from "./leg.ts";

/**
 * Which executable speaks ACP, and what "none" means.
 *
 * **The default is the pinned Claude Code adapter, on every documented way of
 * starting kolu** — `nix/packages/acp-adapter.nix` builds it and `nix/env.nix`
 * puts the path in `koluEnv`, from which padi's wrapper bakes it with
 * `--set-default`. So a person who follows any documented path gets a working
 * orchestrator and never has to know this variable exists.
 *
 * `--set-default` RATHER THAN `--set`, and the difference is load-bearing
 * twice: a developer can point one host at a build of the adapter they are
 * working on, and kolu's own e2e suite points it at a scripted agent. A
 * `--set` would win over both — and the suite would silently have been driving
 * the real pinned adapter, which is exactly what it did until this was caught.
 *
 * It names the adapter resource and nothing else. An absent or empty value
 * leaves this engine unseated with a sentence saying why ({@link NotHere}),
 * never a silently missing row.
 */
export const AGENT_ENV = "KOLU_ACP_AGENT";
/**
 * WHAT TO SPAWN to reach one agent, or the absence of one.
 *
 * The value is a command line rather than a bare path, because an adapter is
 * often `node /path/to/index.js` and demanding a wrapper script for that would
 * be demanding one for the common case.
 */
export interface Adapter {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Extra environment for the SPAWN, merged over kolu's own — the one door an
   *  adapter has for being pointed at something that is not on kolu's PATH. An
   *  adapter that WRAPS an agent (pi-acp spawns `pi`) puts the found agent here,
   *  because kolu's PATH is not your shell's and the adapter's own lookup would
   *  read a third one, its child's. Omitted for adapters that want nothing, so a
   *  child inherits exactly what kolu has.
   *
   *  This is also where an engine keeps its own memory OFF: an engine under
   *  kolu keeps no memory of its own, and one whose harness has such a memory
   *  says in its `at` how it is switched off. A value set here wins over the
   *  same name in kolu's own environment.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * ... AND THE VARIABLES IT MUST NOT SEE, removed from that same spawn.
   *
   * The other direction, which `env` cannot express: an adapter that reads the
   * environment to GUESS something — the pinned Claude Code adapter reads
   * `NO_BROWSER`, `SSH_CONNECTION`, `SSH_CLIENT`, `SSH_TTY` and
   * `CLAUDE_CODE_REMOTE` to decide the person is remote, and on a remote
   * session offers only a full-screen login TUI — has no way to be told that
   * the guess is wrong about a CLIENT that runs its own terminal. Olai is such
   * a client and is always "remote", so the engine names what its adapter must
   * not be told, and the SPAWN (which is chat's) does the removal.
   *
   * A list of names rather than a predicate: the plugin knew which variables it
   * meant, and a callback here would be that decision spelled a second time in
   * the package that spawns.
   */
  readonly unset?: ReadonlyArray<string>;
}

/**
 * SOMETHING THIS HOST DOES NOT HAVE, and what a person is owed about it.
 *
 * OWNED HERE AND NOWHERE ELSE, beside the {@link Registering.at} that answers
 * one: this is the shape an INTEGRATION hands back, and an integration already
 * opens this door for its leg and its adapter, so it needs no second one. A
 * probe about something that is not an ACP engine — an MCP server, a padi —
 * spells the same three fields itself rather than importing this name, because
 * contravariance makes the narrower spelling the stronger claim and a package
 * that speaks the protocol has no business owning another subject's absence.
 * Keeping the canonical shape here also preserves ACP's leaf dependency
 * boundary.
 *
 * `where` is where the thing WOULD be, in whichever way makes sense for it: the
 * file a probe asked for, or the page a person downloads it from. `null` for
 * the ways of being absent that name no place at all.
 *
 * `why` is a WHOLE SENTENCE and nothing composes around it. The words belong to
 * whoever found out — where to get the Claude adapter is the Claude
 * integration's to word — because a sentence built out of a core template with
 * an integration's noun dropped into it is a debug log line on a screen.
 * **The harness displays a sentence and never composes one.**
 */
export interface NotHere {
  readonly name: string;
  readonly where: string | null;
  readonly why: string;
}

/**
 * An adapter out of one environment variable, or `null` for "not here".
 *
 * Split on whitespace: a path with a space in it is a thing somebody can work
 * around with a wrapper, and a shell is a thing nobody can take back.
 *
 * KEPT even though {@link Registering.at} answers `Adapter | NotHere` now:
 * "the variable names a command line or it does not" is a question half of its
 * own, and the two engines shipped rather than found ask it of their own
 * variable before composing the sentence the other answer carries.
 */
export const adapterFrom = (value: string | undefined): Adapter | null => {
  const words = (value ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const [command, ...args] = words;
  return command === undefined ? null : { command, args };
};

/**
 * WHAT A PROBE IS GIVEN: the environment to read, the directory the agent would
 * work in, and how to look on the search path.
 *
 * HANDED IN rather than reached for, so an engine's {@link Engine.at} is a pure
 * function of them and a test needs no machine. `found` in particular is core's:
 * kolu's PATH is not your shell's — run as a systemd user service it inherits
 * neither your profile nor your login shell — so where the probes look is a
 * decision about the SERVE (`KOLU_AGENT_PATH`) rather than one each engine
 * makes for itself.
 */
export interface Where {
  readonly env: { readonly [name: string]: string | undefined };
  readonly cwd: string;
  /** The first RUNNABLE file of that name on the agent search path, or `null`. */
  readonly found: (name: string) => string | null;
}

/**
 * WHERE A STANDING PROMPT GOES on this engine's wire.
 *
 * kolu teaches an orchestrator's session one standing instruction, once
 * (padi's `teaching.ts`, which argues both the words and the channel — the
 * words name kolu's own MCP verbs, so they belong to the host, not here).
 * The TEXT of it is the host's and is versioned with the binary — one
 * contract, one spelling, and a reader comparing two agents' first turns sees
 * one law. WHICH CHANNEL it rides is not: it is a fact about the engine, so the
 * engine's own integration package says it.
 *
 * ONE ARM TODAY, and the arm is the ruling rather than a placeholder. ACP has no
 * system prompt — `session/new` carries a cwd and a list of MCP servers and
 * nothing else a client may put words in — so every engine kolu ships rides the
 * first turn: the lines go under the first message a person sends, which puts
 * them IN THE TRANSCRIPT where the person can read what their agent was told,
 * costs a turn only where somebody says something, and survives a `/clear` by
 * construction because "has this session been taught" is written down per
 * session.
 *
 * A SECOND ARM IS A `tsc` ERROR UNTIL CORE HANDLES IT, which is the whole point
 * of the field being data rather than an assumption: `@kolu/acp-harness` switches on
 * this exhaustively, so an engine that grows a real system-prompt slot adds an
 * arm here and the compiler names every place that has to learn it — instead of
 * core growing a branch on an engine's id.
 */
export type PromptChannel =
  /** Under the first message of the session, as lines a person can read. */
  { readonly kind: "first-turn" };

/**
 * ONE ENGINE, AS ITS INTEGRATION PACKAGE REGISTERS IT.
 *
 * NO `id`. The id is the REGISTRY'S WORD — the key the harness files this
 * engine under, which is also the settings namespace and the address of its
 * docs page. An integration cannot spell another's, because there is no field
 * here to spell one in.
 */
export interface Registering {
  /** WHAT A PERSON READS — in the picker, and in the header beside the model.
   *
   *  The plugin's, because it is a name rather than an identifier: "Claude Code"
   *  is not the word `claude` with a capital letter, and a core table mapping
   *  one to the other would be the thing this whole phase deleted. */
  readonly name: string;
  /** How to read this agent's wire — {@link ./leg.ts}. */
  readonly leg: Leg;
  /** How to start it HERE, or what a person is owed about its absence.
   *
   *  ONE ANSWER AND NO `null` ARM. A machine that simply is not running the
   *  tool has had nothing go wrong — that is the {@link NotHere} arm, the
   *  engine's own whole sentence (its `install.ts`, the same words its
   *  browser half used to hang), and it is answered whether or not anybody
   *  looked. `null` was the arm that made an absence invisible: the roster
   *  dropped the row and no face, log line or cell could say why, which is
   *  the defect this union exists to close. */
  readonly at: (where: Where) => Adapter | NotHere;
  /** Which channel this engine's standing prompt rides —
   *  {@link PromptChannel}. */
  readonly prompt: PromptChannel;
}

/**
 * ...AND AS THE REGISTRY HOLDS IT — the registration with the word the fiber
 * was bound under stamped on it.
 *
 * A separate type from {@link Registering} rather than an optional field, for
 * the reason every keyed door in this tree keeps the two apart: a plugin writes
 * the first and can never write the second, and core reads the second and never
 * has to trust the first about whose it is.
 */
export interface Engine extends Registering {
  readonly id: string;
}
