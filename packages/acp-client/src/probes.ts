/**
 * OPTIONAL MCP SERVERS: whether the tools this host might have are here, asked
 * once per conversation.
 *
 * A session is handed olai's own tool server and then whatever else this
 * machine turns out to be running. What "whatever else" IS, this package does
 * not know and must not: it takes a LIST of things that answer one question —
 * *is your tool here, and what am I owed if it is not* — and the composition
 * root fills the list (the product's own `Options.probes` on `make`).
 *
 * ## The name that used to be here
 *
 * This was `kolu.ts`, 341 lines of one appliance's name inside a package whose
 * whole subject is one conversation with one ACP agent. The judgement half of
 * it — what an absent padi MEANS, and the five English sentences it means it in
 * — is `olai-plugin-kolu`'s now, where the rest of olai's judgement about kolu
 * lives, and what is left here is the shape of the question.
 *
 * The division is worth stating in the words it is enforced by: **core displays
 * a sentence and never composes one.** There is no template in this file that a
 * plugin fills a noun into, because the ways a terminal daemon fails and the
 * ways a CI coordinator does have nothing in common but that they failed, and a
 * sentence built out of that shared nothing is the debug log line on a screen —
 * which is precisely what the incident behind `mcp-fail-visible` was debugged
 * around. {@link Probed} carries whole sentences and this module carries them
 * through.
 *
 * ## Three shapes, spelled here rather than imported
 *
 * `@olai/plugin-api` declares these too, and so does each plugin, and that is the
 * arrangement rather than a duplication waiting to be tidied. This package sits
 * a floor BELOW the plugin system — it is `@olai/server` that meets an
 * appliance, through one door, and `olai-plugin-chat` that is handed a list — so an
 * import from here would invert the direction the whole plugin wall is built
 * out of. What proves the two spellings agree is the composition root, where a
 * plugin's probe and this list meet in one expression; a shape that drifted is
 * a type error on that line.
 */

import { Duration, Effect } from "effect";

import type { MissingServer } from "./servers.ts";

/**
 * AN MCP SERVER A PROBE FOUND AND OFFERS TO HAND OVER — {@link ./agent.ts}'s
 * `mcpServersOf` renders it into the protocol's own stdio arm, which is a
 * different shape with a different name (`@kolu/acp-harness`'s `StdioServer`).
 *
 * `command` is ABSOLUTE, and that is load-bearing rather than tidy: it is the
 * file that answered the probe, not a word to resolve again. Handing the bare
 * word would leave the agent free to resolve it against a different PATH and
 * spawn a different build than the one that answered.
 */
export interface ProbedServer {
  readonly name: string;
  /** Absolute: the file that answered the probe, not a word to resolve again. */
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** What to set when launching it, beyond what it inherits. */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * WHAT ONE PROBE FOUND — both halves at once, because they are one reading.
 *
 * TWO FIELDS RATHER THAN A UNION, and it is an invariant with an incident
 * behind it ({@link ./agent.ts}: one probe, two reads). The two arms are not
 * the same answer — a host that never had the tool had nothing go wrong and is
 * owed no sentence, while a tool that is HERE and would not answer is the one
 * worth telling somebody about — and a caller that asked once for the servers
 * to hand over and again for the sentences would spawn each tool twice per
 * conversation and could answer the two questions about two different moments.
 *
 * Both halves are read off ONE value below ({@link handedIn},
 * {@link missingIn}), so the arrangement is not a rule somebody keeps: there is
 * only one answer in hand to read.
 */
export interface Probed {
  /** The server to hand a session, or `null` where there is none to hand. */
  readonly server: ProbedServer | null;
  /** What a person is owed about the one they did not get, or `null` where an
   *  absence is the ordinary case and no fault. */
  readonly missing: MissingServer | null;
  /** The probing plugin's own page for this server, if it has one. */
  readonly at?: string;
}

/** ONE THING TO ASK — the caller's own name for it, and the question.
 *
 *  The name is for the log line and for the ORDER, and for nothing else. What a
 *  ROSTER row is called comes off the answer, where whoever found the server
 *  named it. */
export interface Probe {
  readonly name: string;
  /**
   * Ask this host. IT NEVER FAILS: every way of failing is an ARM of
   * {@link Probed}, which is the whole reason that type has two fields rather
   * than an error channel — "the tool is not here" is an answer and not a
   * fault, and "it is here and would not work" is a SENTENCE somebody has to
   * read.
   *
   * AN EFFECT, and it used to be a thunk over a `Promise`. Both halves of that
   * change are the same fact: everything a plugin hands core is an Effect now,
   * so the bound below is expressed as Effect concurrency over the Effects
   * themselves rather than as a `forEach` that wraps each thunk on the way past
   * — one fewer shape between the plugin that answers and the fiber that asks.
   *
   * The no-failure contract is the prober's rather than this file's to enforce,
   * and deliberately: a defect caught here could only become silence (which
   * loses the one thing worth saying) or a sentence this package composed
   * (which is the one thing it may not do). `@kolu/detect` states the same
   * guarantee one wall down — *never throws and never logs* — and a plugin's
   * probe is the piece that keeps it.
   */
  readonly ask: Effect.Effect<Probed>;
}

/**
 * HOW MANY AT ONCE, and why there is a number here at all.
 *
 * A probe starts a subprocess and waits for it to answer, with a deadline
 * measured in seconds — kolu's is five. This runs on the SESSION-OPEN path, and
 * that path already has a documented race: the panel is emptied and `session`
 * is `null` until the open completes, so anything slow in here is a window in
 * which a leftover notification from the conversation just left lands on the
 * next one ({@link ./agent.ts}'s `closed` set). Asking N plugins one after
 * another would multiply that window by N, which is the same bug with a bigger
 * number on it.
 *
 * So they overlap, and the wall clock is the SLOWEST probe rather than the sum.
 * Bounded rather than unbounded because each one is a process start: a build
 * with a dozen plugins would otherwise fork a dozen executables at the instant
 * somebody pressed a conversation open, on a machine that may be running none
 * of them. Four is the width at which the two plugins this binary has today —
 * and the next few — cost exactly one probe's latency.
 */
const AT_ONCE = 4;

/**
 * Ask every one of them, and say what came back.
 *
 * ORDER IS PRESERVED, which the roster depends on: `Effect.forEach` answers in
 * the order it was given whatever order the answers arrived in, so the servers
 * a session is handed and the rows a person reads are in registry order rather
 * than in whichever-daemon-was-quickest order — a list that reshuffled itself
 * per conversation would be a panel nobody can read twice.
 */
export const probed = (
  probes: ReadonlyArray<Probe>,
): Effect.Effect<ReadonlyArray<Probed>> =>
  Effect.forEach(
    probes,
    (one) =>
      Effect.gen(function* () {
        const [duration, found] = yield* Effect.timed(one.ask);
        yield* said(one.name, found).pipe(
          Effect.annotateLogs({
            duration: `${Math.round(Duration.toMillis(duration))}ms`,
          }),
        );
        return found;
      }),
    { concurrency: AT_ONCE },
  );

/**
 * One debug line per completed probe, including an absent tool: even a
 * negative answer can explain a slow conversation open.
 */
const said = (name: string, found: Probed): Effect.Effect<void> => {
  if (found.server !== null) {
    return Effect.annotateLogs(Effect.logDebug(`${name} is on this session`), {
      command: found.server.command,
    });
  }
  if (found.missing !== null) {
    return Effect.annotateLogs(
      Effect.logDebug(`${name} is not on this session`),
      {
        where: found.missing.where,
        why: found.missing.why,
      },
    );
  }
  return Effect.logDebug(`${name} is not running`);
};

/** The servers to hand a session, out of what the probes found. */
export const handedIn = (
  found: ReadonlyArray<Probed>,
): ReadonlyArray<ProbedServer> =>
  found.flatMap((one) => (one.server === null ? [] : [one.server]));

/** ... and the other half of the SAME reading: what a person is owed about the
 *  ones this session did not get. Read off the array {@link handedIn} was read
 *  off, never off a second probe — see {@link Probed}. */
export const missingIn = (
  found: ReadonlyArray<Probed>,
): ReadonlyArray<MissingServer> =>
  found.flatMap((one) => (one.missing === null ? [] : [one.missing]));

/** ...and the app addresses of the ones that have a page, by server name. Read
 *  off the same array, for {@link handedIn}'s reason. */
export const addressesIn = (
  found: ReadonlyArray<Probed>,
): ReadonlyMap<string, string> =>
  new Map(
    found.flatMap((one) =>
      one.server !== null && one.at !== undefined
        ? [[one.server.name, one.at] as const]
        : [],
    ),
  );
