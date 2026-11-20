import { type ChildProcess, spawn as spawnChild } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { Readable } from "node:stream";

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

async function onPath(name: string, path: string): Promise<string | null> {
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return false;
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function probeCommand(
  command: string,
  env: Readonly<Record<string, string>>,
  deadlineMs: number,
): Promise<Probe> {
  let child: ChildProcess;
  try {
    child = spawnChild(command, [...KOLU_MCP_ARGS], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...envWithoutPadiSocket(), ...env },
    });
  } catch (cause) {
    return { _tag: "couldNotStart", cause: reasonOf(cause) };
  }

  return await Promise.race([execFailure(child), probe(child, deadlineMs)]);
}

function envWithoutPadiSocket(): NodeJS.ProcessEnv {
  const { [PADI_SOCKET_ENV]: _inherited, ...rest } = process.env;
  return rest;
}

const execFailure = (child: ChildProcess): Promise<ProbeFailure> =>
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

  let expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    child.kill("SIGKILL");
  }, deadlineMs);

  try {
    for (const message of conversation()) {
      stdin.write(`${JSON.stringify(message)}\n`);
    }

    for await (const line of linesOf(stdout)) {
      const verdict = verdictIn(line);
      if (verdict !== null) return verdict;
    }
    return expired ? { _tag: "timedOut", deadlineMs } : { _tag: "closed" };
  } catch (cause) {
    return { _tag: "failed", cause: reasonOf(cause) };
  } finally {
    clearTimeout(deadline);
    child.kill("SIGKILL");
  }
}

async function* linesOf(stream: Readable): AsyncGenerator<string> {
  let buffered = "";
  for await (const chunk of stream) {
    buffered += String(chunk);
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    yield* lines;
  }
}

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

interface ProbeReply {
  readonly result?: unknown;
  readonly error?: { readonly message?: unknown };
}

function replyToProbe(line: string): ProbeReply | null {
  if (line.trim() === "") return null;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  const shape = message as ProbeReply & { readonly id?: unknown };
  return shape.id === PROBE_ID ? shape : null;
}

function verdictIn(line: string): Probe | null {
  const reply = replyToProbe(line);
  if (reply === null) return null;
  if (reply.result !== undefined && reply.result !== null) {
    return { _tag: "answered" };
  }
  const said = reply.error?.message;
  return {
    _tag: "refused",
    said: typeof said === "string" && said !== "" ? said : null,
  };
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
