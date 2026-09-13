/**
 * Every Nix command provisioning runs, read through Nix's own machine-readable
 * log (`--log-format internal-json`) — so what a failure SAYS is taken from what
 * Nix TAGGED, never guessed from free text.
 *
 * Plain `-v` stderr mixed three voices into one undifferentiated stream, and
 * reading them apart by pattern is what made the connect path lie:
 *
 *   - ssh's own stderr (Nix forks ssh with inherited stderr) — the ONLY voice
 *     that can say the host is unreachable;
 *   - Nix's own messages — the root error, and the "1 dependency failed"
 *     cascade that follows it;
 *   - a BUILDER's log (curl inside a crate fetch, a compiler) — which says
 *     nothing about the transport, however much it talks about connections.
 *
 * The incident this module exists for: a crate fetch on the host got HTTP 403,
 * the failure card showed `'nix build' exited with code 1`, the root error had
 * scrolled out of a 20-line tail under the cascade, and a curl
 * `Failed to connect` line inside a builder log would have made the session
 * call the host unreachable and retry forever.
 *
 * With internal-json each stderr line is either `@nix <json event>` or a raw
 * line ssh wrote itself (verified against nix 2.34, local and `ssh-ng://`
 * stores, and the legacy `nix-store` / `nix-instantiate` commands). The event
 * vocabulary used here is Nix's `src/libutil/logging.hh`: `msg` (with a
 * verbosity `level`, 0 = error), `start` of an activity (`type` 105 = a build,
 * whose `fields[0]` is the derivation), and `result` (`type` 101 = one line of
 * that build's log).
 */

import { stripVTControlCharacters } from "node:util";
import {
  buildSshProbeCommand,
  isLocalHost,
  looksLikeNetworkError,
  type SshDestination,
} from "./host";
import {
  type CaptureResult,
  describeExit,
  type LifetimePolicy,
  runCapture,
} from "./process";

/** The flag pair every provisioning Nix command carries. Nix accepts it on the
 *  new CLI and on the legacy `nix-store` / `nix-instantiate` alike. */
export const NIX_LOG_FORMAT_ARGS = ["--log-format", "internal-json"] as const;

/** Nix's verbosity for plain informational messages (`lvlInfo`). Messages and
 *  activities above it are the `-v` chatter ("evaluating file …") that the old
 *  plain-stderr tail was full of; they still keep a slow step alive (every
 *  stderr line bumps the lifetime policy) but are not narrated. */
const LVL_INFO = 3;

/** `ActivityType::actBuild` and `ResultType::resBuildLogLine`. */
const ACT_BUILD = 105;
const RES_BUILD_LOG_LINE = 101;

/** How many trailing log lines of each build are retained, and for how many
 *  builds — enough to name why the failed one failed, bounded so a long build
 *  graph cannot grow the server heap. */
const BUILD_LOG_TAIL = 8;
const BUILDS_RETAINED = 32;

/** The first error Nix reported in a run: its one-line `headline` (the
 *  message itself, colour and the `error:` prefix removed) and the `detail`
 *  that says WHY — the failed build's own last log lines when the error names
 *  a build we saw, otherwise the rest of Nix's message (an evaluation trace). */
export interface NixError {
  readonly headline: string;
  readonly detail: readonly string[];
}

/** Reads one Nix run's stderr. `line` is fed every stderr line; narration of
 *  the human-meaningful ones goes to the `narrate` sink it was built with. */
export interface NixLogReader {
  readonly line: (line: string) => void;
  /** The run's root error, or `null` when Nix reported none. */
  readonly rootError: () => NixError | null;
  /** Did ssh itself, or Nix about its own connection, report a transport
   *  failure? A builder's log is never consulted. */
  readonly sawTransportFailure: () => boolean;
  /** Lines narrated after the root error was — the cascade that pushes it out
   *  of a bounded tail. The caller re-narrates the root error when this is
   *  non-zero, so the tail ends on the cause rather than its fallout. */
  readonly narratedAfterRootError: () => number;
}

interface RootError {
  readonly headline: string;
  readonly text: string;
  readonly trace: readonly string[];
}

/** One Nix log event, as far as this reader needs to see it. Anything else
 *  (activity `stop`, progress `result`s, a future action) is `ignored`. */
type NixEvent =
  | {
      readonly kind: "msg";
      readonly level: number;
      readonly msg: string;
      readonly rawMsg: string | undefined;
    }
  | {
      readonly kind: "start";
      readonly id: number;
      readonly level: number;
      readonly type: number;
      readonly text: string;
      readonly fields: readonly unknown[];
    }
  | { readonly kind: "result"; readonly id: number; readonly type: number; readonly fields: readonly unknown[] }
  | { readonly kind: "ignored" };

const NIX_PREFIX = "@nix ";

/** Decode an `@nix` line, or `null` when the line is not one (ssh's own
 *  stderr) — or claims to be one and is not valid JSON, which is surfaced
 *  verbatim as a raw line rather than dropped. */
function decodeNixEvent(line: string): NixEvent | null {
  if (!line.startsWith(NIX_PREFIX)) return null;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(NIX_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : undefined;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;
  const fields = Array.isArray(e.fields) ? (e.fields as unknown[]) : [];
  if (e.action === "msg") {
    const level = num(e.level);
    const msg = str(e.msg);
    if (level === undefined || msg === undefined) return null;
    return { kind: "msg", level, msg, rawMsg: str(e.raw_msg) };
  }
  if (e.action === "start") {
    const id = num(e.id);
    const level = num(e.level);
    const type = num(e.type);
    if (id === undefined || level === undefined || type === undefined)
      return null;
    return { kind: "start", id, level, type, text: str(e.text) ?? "", fields };
  }
  if (e.action === "result") {
    const id = num(e.id);
    const type = num(e.type);
    if (id === undefined || type === undefined) return null;
    return { kind: "result", id, type, fields };
  }
  return { kind: "ignored" };
}

/** Nix colours its messages even into a pipe; none of that reaches a screen. */
const plain = (s: string): string => stripVTControlCharacters(s);

/** The message's lines, colour removed, trailing space trimmed, blanks dropped. */
const linesOf = (s: string): string[] =>
  plain(s)
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");

/** The one-line headline of an error message. `raw_msg` (when Nix sends it) is
 *  the message without the `error:` prefix or trace; otherwise it is the
 *  message's first line with that prefix removed. An evaluation error's `msg`
 *  starts with a bare `error:` line and its trace, so the LAST `error:` line is
 *  the one that says what went wrong. */
function headlineOf(msg: string, rawMsg: string | undefined): string {
  const raw = rawMsg === undefined ? [] : linesOf(rawMsg);
  if (raw[0] !== undefined) return raw[0].trim();
  const lines = linesOf(msg);
  const errorLines = lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith("error:"))
    .map((l) => l.slice("error:".length).trim())
    .filter((l) => l !== "");
  return errorLines.at(-1) ?? lines[0]?.trim() ?? "";
}

export function nixLogReader(narrate: (line: string) => void): NixLogReader {
  let root: RootError | null = null;
  let afterRoot = 0;
  let transport = false;
  // Insertion-ordered, so the oldest build is the first key when trimming.
  const builds = new Map<number, { drv: string; tail: string[] }>();

  const say = (line: string): void => {
    if (root !== null) afterRoot += 1;
    narrate(line);
  };

  const onMsg = (level: number, msg: string, rawMsg: string | undefined) => {
    if (level > LVL_INFO) return;
    if (level > 0) {
      for (const l of linesOf(msg)) say(l);
      return;
    }
    const headline = headlineOf(msg, rawMsg);
    // Only the headline can be Nix speaking about its own connection; the rest
    // of an error message may quote a builder's log ("Last 17 log lines: > …").
    if (looksLikeNetworkError(headline)) transport = true;
    if (root === null) {
      const lines = linesOf(msg);
      root = { headline, text: plain(msg), trace: lines.slice(1) };
      for (const l of lines) narrate(l);
      return;
    }
    // A later error is the cascade of the first — one line each, never a block.
    say(`error: ${headline}`);
  };

  return {
    line: (line) => {
      const event = decodeNixEvent(line);
      if (event === null) {
        // ssh's own voice (or an undecodable line, shown as-is).
        if (looksLikeNetworkError(line)) transport = true;
        say(line);
        return;
      }
      switch (event.kind) {
        case "msg":
          onMsg(event.level, event.msg, event.rawMsg);
          return;
        case "start": {
          const drv = event.fields[0];
          if (event.type === ACT_BUILD && typeof drv === "string") {
            builds.set(event.id, { drv, tail: [] });
            if (builds.size > BUILDS_RETAINED) {
              const oldest = builds.keys().next().value;
              if (oldest !== undefined) builds.delete(oldest);
            }
          }
          if (event.level <= LVL_INFO && event.text !== "") say(event.text);
          return;
        }
        case "result": {
          if (event.type !== RES_BUILD_LOG_LINE) return;
          const build = builds.get(event.id);
          const text = event.fields[0];
          if (build === undefined || typeof text !== "string") return;
          const l = plain(text).trimEnd();
          if (l.trim() === "") return;
          build.tail.push(l);
          if (build.tail.length > BUILD_LOG_TAIL) build.tail.shift();
          return;
        }
        case "ignored":
          return;
      }
    },
    rootError: () => {
      if (root === null) return null;
      const r = root;
      const failed = [...builds.values()].find(
        (b) => b.tail.length > 0 && r.text.includes(b.drv),
      );
      return {
        headline: r.headline,
        detail: failed !== undefined ? failed.tail : r.trace,
      };
    },
    sawTransportFailure: () => transport,
    narratedAfterRootError: () => afterRoot,
  };
}

/** The one-line account of a Nix error: its headline, and the last line of its
 *  detail when that adds the WHY ("… — cannot download … from any mirror"). */
export function describeNixError(error: NixError): string {
  const last = error.detail.at(-1)?.trim();
  return last === undefined || last === "" || error.headline.includes(last)
    ? error.headline
    : `${error.headline} — ${last}`;
}

/** A finished Nix run: how the process ended, plus what its log said. */
export type NixRun = CaptureResult & {
  /** The run's root error, or `null` when Nix reported none. */
  readonly error: NixError | null;
  /** The transport failed — ssh (or Nix about its ssh connection) said so, or
   *  the ssh we spawned exited with its own 255. Never inferred from a builder. */
  readonly transportFailure: boolean;
};

/** Run one Nix command with its log read through {@link nixLogReader} — the ONE
 *  way provisioning runs Nix, so no step can report an exit code where Nix
 *  said why, or classify a builder's chatter as the host going away.
 *
 *  `target` is where the command runs, exactly as {@link buildSshProbeCommand}
 *  takes it: `"localhost"` spawns it directly (also the arm for a local `nix`
 *  that reaches a remote store over `ssh-ng://`), a host wraps it in the dial's
 *  ssh. `argv[0]` is the Nix command; the log-format flag goes right after it.
 *
 *  When the run fails after its root error was pushed down by the cascade, the
 *  root error is narrated once more as the LAST lines — a bounded progress tail
 *  (the failure card's evidence) then ends on the cause, not its fallout. */
export async function runNix(
  target: string | SshDestination,
  argv: readonly [string, ...string[]],
  opts: {
    readonly narrate?: (line: string) => void;
    readonly policy: LifetimePolicy;
    readonly signal: AbortSignal | undefined;
    readonly env?: Readonly<Record<string, string>>;
  },
): Promise<NixRun> {
  const narrate = opts.narrate ?? (() => {});
  const reader = nixLogReader(narrate);
  const [nixCommand, ...rest] = argv;
  const { command, args } = buildSshProbeCommand(
    target,
    nixCommand,
    ...NIX_LOG_FORMAT_ARGS,
    ...rest,
  );
  const res = await runCapture(command, args, {
    onProgress: reader.line,
    policy: opts.policy,
    signal: opts.signal,
    env: opts.env,
  });
  const error = reader.rootError();
  if (!res.ok && error !== null && reader.narratedAfterRootError() > 0) {
    narrate(`error: ${error.headline}`);
    for (const l of error.detail) narrate(l);
  }
  const host = typeof target === "string" ? target : target.host;
  const sshExit255 =
    !isLocalHost(host) && res.kind === "exit" && res.code === 255;
  return {
    ...res,
    error,
    transportFailure: reader.sawTransportFailure() || sshExit255,
  };
}

/** How a Nix run ended, in words: Nix's own root error when it exited having
 *  reported one, otherwise the process outcome (a kill, an abort, a spawn
 *  fault — or an exit Nix said nothing about). */
export function describeNixRun(res: NixRun): string {
  return res.kind === "exit" && res.error !== null
    ? describeNixError(res.error)
    : describeExit(res);
}
