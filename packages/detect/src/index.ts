/**
 * Is there a USABLE kolu on this host — and if not, why not?
 *
 * An app that wants to hand its coding agent kolu's terminals spawns
 * `kolu mcp` as an MCP server. The question it has to answer first is not "is
 * `kolu` installed"; it is "will the kolu that a spawn from HERE resolves to
 * actually serve a live workspace". Those come apart in ways that all look
 * identical from outside, and each of them shipped as a real incident:
 *
 *   - **A path is not evidence.** A kolu terminal prepends its own bundled
 *     copy to `PATH`, and one of those was an older build reporting the same
 *     version string while missing most of the verbs
 *     ([#2146](https://github.com/juspay/kolu/issues/2146), fixed by #2147).
 *     The lesson outlives the fix, because the wrong build still SPAWNS.
 *   - **A handshake is not evidence either.** `kolu mcp` completes
 *     `initialize`, lists every tool and lists its resources with NO daemon
 *     behind it at all ([#2148](https://github.com/juspay/kolu/issues/2148)).
 *     Only READING a cell the daemon owns separates a live workspace from a
 *     process that will fail every call it just advertised.
 *   - **The PATH that matters is the spawner's.** A server started as a
 *     systemd user service does not inherit the PATH its user types at, so a
 *     kolu that is plainly installed can be invisible to the process that
 *     needs it — the whole shape of one long mystery.
 *
 * So {@link detect} resolves the executable, STARTS it, handshakes, and asks
 * it to read {@link IDENTITY_RESOURCE} — padi's own identity (the commit it
 * runs, when it booted), which a kolu that reached no daemon cannot produce.
 * An answer is evidence of both halves at once: this binary speaks the
 * protocol, and a padi is behind it. The probe is never a client — it is
 * killed either way, and the caller spawns its own server afterwards, at the
 * ABSOLUTE PATH that answered rather than the bare word (handing over the word
 * would let the caller resolve it against a different PATH and get a different
 * build than the one that passed).
 *
 * ## What this module does NOT decide
 *
 * It reports; it does not editorialize. Every no is a VALUE naming which no it
 * was ({@link Detected}, {@link ProbeFailure}) and nothing here is logged,
 * thrown, or worded for a screen. That division is deliberate and load-bearing
 * for the consumer this was extracted for: whether a missing kolu is worth
 * telling a user about depends on facts kolu cannot see (did anything declare
 * that a workspace should be here?), and the sentence that renders it belongs
 * to whoever draws the screen. Kolu owns which padi and whether it answered;
 * the app owns what to say about it.
 *
 * Nothing here reads `process.env` to DECIDE anything, for the same reason:
 * {@link DetectOptions.path} and {@link DetectOptions.socket} are passed in,
 * so a caller forwarding a socket it inherited and a caller naming one
 * deliberately are the same code path, and a test can drive either without
 * mutating the environment underneath itself. The probe child does inherit
 * this process's environment — a `kolu` needs a real one to run in — but with
 * `PADI_SOCKET` stripped, so the only socket that can reach it is the one the
 * caller named and the probe can never be about a different padi than the
 * recipe it hands back (see {@link ambientEnv}).
 */

import { type ChildProcess, spawn as spawnChild } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";

/** The executable, its verb, and the variable naming which padi — kolu's own
 *  `.mcp.json` entry, so a caller never spells them itself. */
export const KOLU_COMMAND = "kolu";
export const KOLU_MCP_ARGS: readonly string[] = ["mcp"];
export const PADI_SOCKET_ENV = "PADI_SOCKET";

/** What the probe reads. A padi's identity is the DAEMON's own — its build
 *  commit and boot time — so a kolu that reached no daemon cannot answer it
 *  (it fails the read with `padi transport down` instead). Read-only, one
 *  round trip, and the one request that tells a live workspace from a process
 *  that merely speaks MCP (#2148). */
export const IDENTITY_RESOURCE = "surface://cells/identity";

/** How long a probe gets by default: generous for a process start plus one
 *  round trip over a unix socket, and spent before a caller's session opens. */
export const DEFAULT_PROBE_MS = 5_000;

/** The id the identity read is sent under, so the answer to it is the only
 *  message that decides anything. Exported because a fixture standing in for
 *  `kolu mcp` has to answer under it. */
export const PROBE_ID = 2;

/** How to spawn the kolu that answered. Handed to the caller so its own MCP
 *  client can start the real server — the same shape ACP's stdio entry and
 *  kolu's `.mcp.json` both want. */
export interface KoluServer {
  /** ABSOLUTE: the file that answered the probe, not a word to resolve again. */
  readonly command: string;
  readonly args: readonly string[];
  /** What to set beyond what the process inherits — carries
   *  {@link PADI_SOCKET_ENV} when a socket was named, and is empty otherwise
   *  (kolu resolves this host's padi by itself when nothing names one). */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * What a probe found — and, when it found nothing usable, WHY.
 *
 * Three arms rather than a `KoluServer | null`, because "no kolu here" and "a
 * kolu here that would not answer" are different facts about a host, and a
 * caller renders them differently (an absence is the ordinary state of most
 * machines; a kolu that is present and silent is the one worth reporting).
 * Collapsing them is what leaves a spawn failure, a stale build, a wedged
 * daemon and a host that simply never had kolu all arriving as one silent no.
 */
export type Detected =
  /** Kolu is here, it answered, and this is how to start it. */
  | { readonly _tag: "reachable"; readonly server: KoluServer }
  /** No executable by that name on the given PATH. Whether that is worth
   *  saying anything about is the caller's call, not this module's. */
  | { readonly _tag: "notOnPath" }
  /** A file was found and started, and did not prove a live workspace.
   *  `command` is the absolute path that failed — a caller reporting this can
   *  name the file. */
  | {
      readonly _tag: "unreachable";
      readonly command: string;
      readonly why: ProbeFailure;
    };

/** Why a started `kolu mcp` did not prove a live workspace. Each arm is a
 *  DIFFERENT recovery and a different sentence, so they stay apart:
 *  `couldNotStart` is a file that would not exec; `refused` is the server
 *  answering the identity read with an error (`said` is its own words, or
 *  `null` when it gave none) — the one that means "kolu is installed and
 *  running against nothing"; `closed` is a hang-up before any answer;
 *  `timedOut` is a process that stayed alive and said nothing; `failed` is our
 *  own end of the conversation breaking. */
export type ProbeFailure =
  | { readonly _tag: "couldNotStart"; readonly cause: string }
  | { readonly _tag: "refused"; readonly said: string | null }
  | { readonly _tag: "closed" }
  | { readonly _tag: "timedOut"; readonly deadlineMs: number }
  | { readonly _tag: "failed"; readonly cause: string };

/** A probe's verdict: it answered, or one of the ways it did not. */
export type Probe = { readonly _tag: "answered" } | ProbeFailure;

export interface DetectOptions {
  /** The PATH to resolve {@link KOLU_COMMAND} against. Pass the LIVE one
   *  (`process.env.PATH`) — that is what a spawn would resolve against, and
   *  the point of the whole exercise is to probe the file that would actually
   *  run. Defaults to empty, which finds nothing: a caller that means "look
   *  where I would look" says so. */
  readonly path?: string;
  /** The padi socket to forward as {@link PADI_SOCKET_ENV}. Omit to forward
   *  nothing and let kolu resolve this host's padi by itself (it already owns
   *  that choice, and says so when a host is running more than one). */
  readonly socket?: string;
  /** How long the probe gets, in milliseconds. */
  readonly deadlineMs?: number;
}

/**
 * Resolve `kolu` on PATH, start it, and prove a live workspace is behind it.
 *
 * Never throws and never logs: every way of failing is an arm of
 * {@link Detected}. Costs one process start and one round trip.
 */
export async function detect(options: DetectOptions = {}): Promise<Detected> {
  const env: Readonly<Record<string, string>> =
    options.socket !== undefined && options.socket !== ""
      ? { [PADI_SOCKET_ENV]: options.socket }
      : {};

  const command = await onPath(KOLU_COMMAND, options.path ?? "");
  if (command === null) return { _tag: "notOnPath" };

  const why = await probeCommand(
    command,
    env,
    options.deadlineMs ?? DEFAULT_PROBE_MS,
  );
  if (why._tag !== "answered") return { _tag: "unreachable", command, why };
  return {
    _tag: "reachable",
    server: { command, args: KOLU_MCP_ARGS, env },
  };
}

/** The first executable file by that name on `path`, or `null`. The PATH is a
 *  PARAMETER rather than read here: the caller's live one is the fact that
 *  matters (see the module doc), and a test needs to replace it wholesale
 *  rather than prepend to a developer machine's own. */
async function onPath(name: string, path: string): Promise<string | null> {
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Not there, not a file, or not executable — the next directory is the
      // answer, exactly as a shell's own lookup would treat it.
    }
  }
  return null;
}

/** Start it and ask, killing it either way. Separate from {@link probe}
 *  because a file that will not EXEC fails on a different axis than a
 *  conversation does — see the race below. */
async function probeCommand(
  command: string,
  env: Readonly<Record<string, string>>,
  deadlineMs: number,
): Promise<Probe> {
  let child: ChildProcess;
  try {
    child = spawnChild(command, [...KOLU_MCP_ARGS], {
      stdio: ["pipe", "pipe", "ignore"],
      // The child inherits this process's environment for the ordinary reasons
      // (`HOME`, `NODE_*`, whatever the host was started with) — with
      // {@link PADI_SOCKET_ENV} STRIPPED first, so the only one that can reach
      // it is the one the caller named. Deleted rather than blanked: an empty
      // string is a value kolu would have to interpret, and this is the absence
      // of an instruction.
      //
      // That strip is what keeps the probe and the RECIPE about the same padi.
      // Without it, a caller that named no socket is handed `env: {}` ("kolu
      // resolves its own") while the child that produced the evidence quietly
      // talked to whatever this process happened to carry — so a `reachable`
      // could be earned against a daemon the caller's real server will never
      // dial, or a refusal blamed on one it will. The evidence has to come from
      // the arrangement it describes.
      env: { ...ambientEnv(), ...env },
    });
  } catch (cause) {
    return { _tag: "couldNotStart", cause: reasonOf(cause) };
  }

  // A file on PATH with the executable bit is not necessarily a program, and
  // an exec that fails does so AFTER `spawn` has returned — so the `catch`
  // above never sees one. It arrives as an `error` EVENT, and it is RACED
  // rather than merely handled because what FOLLOWS an exec failure is our own
  // write to a stdin that died with it: unraced, the caller is told "write
  // after end", a fact about our end of a pipe, instead of the name of the
  // file that would not run. Listening also keeps that event from reaching a
  // host process as an uncaught exception.
  return await Promise.race([unstartable(child), probe(child, deadlineMs)]);
}

/** This process's environment MINUS the one variable a probe must never pick
 *  up by accident — see the spawn above for why. Everything else is inherited
 *  unchanged: a `kolu` needs a real environment to run in, and this module has
 *  no opinion about the rest of it. */
function ambientEnv(): NodeJS.ProcessEnv {
  const { [PADI_SOCKET_ENV]: _inherited, ...rest } = process.env;
  return rest;
}

/** Why this child never ran — a promise that settles ONLY if it did not. */
const unstartable = (child: ChildProcess): Promise<ProbeFailure> =>
  new Promise((resolve) => {
    child.once("error", (cause) =>
      resolve({ _tag: "couldNotStart", cause: reasonOf(cause) }),
    );
  });

/**
 * Say the whole conversation to an ALREADY-STARTED `kolu mcp` and wait for the
 * one answer that decides it — then kill it.
 *
 * Exported beside {@link detect} because the two answer different questions
 * and a caller may already own the process: `detect` asks "is there a usable
 * kolu on this host", this asks "does THIS process speak for a live
 * workspace". Taking the deadline as a parameter is also what makes the
 * timeout arm testable without spending it.
 *
 * Almost every way of failing arrives by one door — the pipes closing ends the
 * read, and the deadline is a KILL rather than a race, so a wedged server and
 * one that hung up are the same closed pipe with a flag to tell them apart.
 */
export async function probe(
  child: ChildProcess,
  deadlineMs: number = DEFAULT_PROBE_MS,
): Promise<Probe> {
  const { stdin, stdout } = child;
  if (stdin === null || stdout === null) {
    return {
      _tag: "failed",
      cause: "the subprocess was started without pipes",
    };
  }

  /** Whether the deadline is what ended this, so the closed pipe below reads
   *  as the timeout it is rather than as a server that hung up. */
  let expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    child.kill("SIGKILL");
  }, deadlineMs);

  try {
    // Written at once: a server that reads its input in order answers in
    // order, and one that cannot is one whose answer we would not want.
    // stdin stays OPEN — a server told its client has gone is entitled to
    // leave before finishing, and the kill below is what ends this one.
    for (const message of conversation()) {
      stdin.write(`${JSON.stringify(message)}\n`);
    }

    let buffered = "";
    for await (const chunk of stdout) {
      buffered += String(chunk);
      // Line-delimited JSON. The trailing element is a partial line (or "")
      // and stays in the buffer until its newline arrives.
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const verdict = verdictIn(line);
        if (verdict !== null) return verdict;
      }
    }
    return expired ? { _tag: "timedOut", deadlineMs } : { _tag: "closed" };
  } catch (cause) {
    return { _tag: "failed", cause: reasonOf(cause) };
  } finally {
    clearTimeout(deadline);
    child.kill("SIGKILL");
  }
}

/** The handshake plus the one question. */
const conversation = (): ReadonlyArray<unknown> => [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: KOLU_COMMAND, version: "0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  {
    jsonrpc: "2.0",
    id: PROBE_ID,
    method: "resources/read",
    params: { uri: IDENTITY_RESOURCE },
  },
];

/** What one output line decides, or `null` when it decides nothing (a
 *  notification, a reply to the handshake, a line that isn't JSON at all —
 *  a binary that is not kolu produces those, and the deadline is what ends
 *  the wait for an answer that never comes).
 *
 *  A message under {@link PROBE_ID} is OURS whether it succeeded or refused,
 *  and a refusal is a verdict rather than noise: it is what a kolu that
 *  reached no daemon sends, which is the case this whole module exists to
 *  tell apart from a working one. */
function verdictIn(line: string): Probe | null {
  if (line.trim() === "") return null;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  const shape = message as {
    readonly id?: unknown;
    readonly result?: unknown;
    readonly error?: { readonly message?: unknown };
  };
  if (shape.id !== PROBE_ID) return null;
  if (shape.result !== undefined && shape.result !== null) {
    return { _tag: "answered" };
  }
  const said = shape.error?.message;
  return {
    _tag: "refused",
    said: typeof said === "string" && said !== "" ? said : null,
  };
}

/** The sentence inside an unknown throw, without deciding how to word the
 *  failure it belongs to — that is the caller's. */
const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
