/**
 * Every Nix command provisioning runs, read through Nix's own machine-readable
 * log (`--log-format internal-json`) — so what a failure SAYS is taken from what
 * Nix TAGGED, never guessed from free text.
 *
 * Plain `-v` stderr mixed three voices into one undifferentiated stream, and
 * reading them apart by pattern is what made the connect path lie:
 *
 *   - ssh's own stderr (Nix forks ssh with inherited stderr), which arrives
 *     untagged;
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
 * whose `fields[0]` is the derivation; 100/101 = a copy path / a file transfer
 * inside it), and `result` — `type` 101 = one line of that build's log; `type`
 * 105 = an activity's progress counters, `[done, expected, running, failed]`
 * (byte counts for a copy), which is also the ONLY event Nix re-sends without
 * anything moving (see {@link NixLogReader.isActivity}); and `type` 106
 * (`resSetExpected`, `[activityType, expected]`). `start.type` and `result.type`
 * are DIFFERENT enums that share numbers; they never mix here.
 */

import { stripVTControlCharacters } from "node:util";
import { formatBytes } from "@kolu/byte-units";
import { Option, Schema } from "effect";
import QuickLRU from "quick-lru";
import { match, P } from "ts-pattern";
import {
  type buildSshProbeCommand,
  isLocalHost,
  looksLikeNetworkError,
  ResolveDrvError,
  type SshDestination,
  type SshRefusal,
  sshExitIsTransport,
  sshRefusalOf,
  sshReportsTransportFailure,
  targetOf,
} from "./host";
import {
  type CaptureResult,
  type DeadlinePolicy,
  describeExit,
  type ProgressLivenessPolicy,
} from "./process";
import { runCaptureAt } from "./remoteRun";

/** Nix's verbosity for plain informational messages (`lvlInfo`). Anything above
 *  it is chatter ("evaluating file …"): it still keeps a slow step alive (every
 *  stderr line bumps the lifetime policy) but is not narrated. */
const LVL_INFO = 3;

/** `ActivityType::actBuild`, `ResultType::resBuildLogLine`, and the two
 *  `result` types a copy narrates from — `resProgress` (105, whose fields are
 *  `[done, expected, running, failed]`, BYTES for a copy) and `resSetExpected`
 *  (106, `[activityType, expected]`).
 *  `start.type` and `result.type` are different enums, so the shared number 105
 *  means an activity type in one place and a result type in the other. */
const ACT_BUILD = 105;
const RES_BUILD_LOG_LINE = 101;
const RES_PROGRESS = 105;
const RES_SET_EXPECTED = 106;

/** How many activities' last `done` counter are remembered for
 *  {@link NixLogReader.isActivity}. An evicted activity's next progress event
 *  counts as activity once — a bounded table, never a missed stall: a stalled
 *  transfer repeats ONE activity's counter, which stays hot. */
const PROGRESS_RETAINED = 1024;

/** The copy activity whose progress is NARRATED: `actCopyPath` (100), whose
 *  `start` names the store path being copied and whose `resProgress` counts the
 *  BYTES of that path's nar.
 *
 *  Its two neighbours in the copy family are deliberately not narrated.
 *  `actFileTransfer` (101) reports the SAME download again — one level down, as
 *  the compressed stream, under the nar URL's hash — so narrating it would
 *  double-report one transfer under a second, opaque name. `actCopyPaths` (103)
 *  counts PATHS, not bytes, so a byte readout built from it would be a lie
 *  ("5 B of 5 B").
 *
 *  Both are still ACCEPTED by {@link classify}: a result line names only its
 *  activity's id, so the reader — not the classifier — is what knows an
 *  activity's type, and only a `start` of type 100 is ever tracked. */
const ACT_COPY_PATH = 100;

/** How many trailing log lines of each build are retained, and for how many
 *  builds — enough to name why the failed one failed, bounded so a long build
 *  graph cannot grow the server heap. */
const BUILD_LOG_TAIL = 8;
const BUILDS_RETAINED = 32;

/** How many in-flight copy activities keep milestone state. Nix runs a handful of
 *  transfers at once and retires each as it lands, so this sits far above any real
 *  concurrency: it is a heap bound, not a behaviour — an evicted activity simply
 *  stops narrating, and its bytes are still covered one level up. */
const COPY_ACTIVITIES_RETAINED = 64;

/** When a copy narrates: every another {@link MILESTONE_PERCENT} of the
 *  transfer, or — for one slow enough that 10% takes longer than
 *  {@link MILESTONE_INTERVAL_MS} — on that cadence instead. Both are needed: the
 *  fraction keeps a fast transfer from narrating a hundred times, the interval
 *  keeps a slow one from going silent for minutes. */
const MILESTONE_PERCENT = 10;
const MILESTONE_INTERVAL_MS = 15_000;

/** The longest single stderr line a Nix run may write. internal-json puts one
 *  event per line and a builder's log line inside one event, so the default
 *  64 KiB text bound would kill a build whose compiler printed one long line
 *  (verified: a 131072-character builder line). Still a bound — a line past it
 *  fails the run loudly rather than growing the heap without limit. */
const NIX_LOG_LINE_MAX = 16 * 1024 * 1024;

/** The first error Nix reported in a run: its one-line `headline` (the
 *  message itself, colour and the `error:` prefix removed) and the `detail`
 *  that says WHY — the failed build's own last log lines when the error names
 *  a build we saw, otherwise the rest of Nix's message (an evaluation trace). */
export interface NixError {
  readonly headline: string;
  readonly detail: readonly string[];
}

/** An ssh refusal and the stderr line that proved it. */
export interface SshRefusalEvidence {
  readonly kind: SshRefusal;
  readonly line: string;
}

/** Reads one Nix run's stderr. `line` is fed every stderr line; narration of
 *  the human-meaningful ones goes to the `narrate` sink it was built with. */
export interface NixLogReader {
  readonly line: (line: string) => void;
  /** Was this stderr line real ACTIVITY — what a silence bound may be reset by?
   *  Every line is, except a progress result (`type` 105) whose `done` counter
   *  has not moved past the last one that activity reported. Nix re-sends a
   *  transfer's progress about once a second from curl's progress callback
   *  EVEN WHEN NOTHING MOVED, so counting those heartbeats as activity let a
   *  deadlocked `nix copy` look alive for 25 minutes past a 10-minute bound.
   *  Stateful (it remembers each activity's last `done`): call it ONCE per
   *  line. */
  readonly isActivity: (line: string) => boolean;
  /** The run's root error, or `null` when Nix reported none. */
  readonly rootError: () => NixError | null;
  /** Did the HEADLINE of Nix's own error report a failed connection (a failed
   *  ssh connection, an unreachable download)? A builder's log — and Nix
   *  quoting it inside an error — is never consulted. */
  readonly nixReportedTransportFailure: () => boolean;
  /** Did ssh's own untagged stderr say ssh failed the connection
   *  ({@link sshReportsTransportFailure})? Kept apart from Nix's headline: what
   *  it proves depends on the seat, which {@link runNix} decides. */
  readonly sshReportedTransportFailure: () => boolean;
  /** Did any raw line look like a bare network-connectivity failure
   *  ({@link looksLikeNetworkError}) — narrower than
   *  {@link sshReportedTransportFailure}: it excludes an ssh REFUSAL (a
   *  credential or host-key rejection). The local seat trusts only this one
   *  without exit-code corroboration (see {@link runNix}); a refusal needs
   *  that corroboration and the local seat structurally cannot supply it (Nix
   *  owns the exit code there, not ssh). */
  readonly sshReportedNetworkFailure: () => boolean;
  /** The first refusal ssh's own untagged stderr reported ({@link sshRefusalOf}),
   *  with the line that said it, or `null`. Read off the reader — the component
   *  that knows which lines are ssh's own voice — never off the narration. */
  readonly sshRefusal: () => SshRefusalEvidence | null;
  /** The root error's lines to narrate once more when something was narrated
   *  after it (the cascade that pushes it out of a bounded tail), so the tail
   *  ends on the cause; empty when the root error is already last, or absent. */
  readonly recap: () => readonly string[];
}

/** The events this reader acts on, decoded with the package's validation
 *  vocabulary. Unknown keys are tolerated (Nix adds `file`/`line`/`column`). */
const NixEventSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("msg"),
    level: Schema.Number,
    msg: Schema.String,
    raw_msg: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    action: Schema.Literal("start"),
    id: Schema.Number,
    level: Schema.Number,
    type: Schema.Number,
    text: Schema.String,
    fields: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  }),
  Schema.Struct({
    action: Schema.Literal("result"),
    id: Schema.Number,
    // The RESULT type, dispatched in the reader (`resBuildLogLine` /
    // `resProgress` / `resSetExpected`) rather than narrowed to a literal here:
    // which result a line is is the reader's decision, and one arm per literal
    // would spell the same struct three times.
    type: Schema.Number,
    fields: Schema.Array(Schema.Unknown),
  }),
]);
type NixEvent = typeof NixEventSchema.Type;
const decodeNixEvent = Schema.decodeUnknownOption(NixEventSchema);

const NIX_PREFIX = "@nix ";

/** Nix writes `action` first, so a result line is recognisable from its prefix
 *  alone. Of the result types Nix emits, only three are ever wanted — a build's
 *  log line, and the two progress results a copy narrates from — so a line whose
 *  `type` is none of them is dropped before any parse; anything else falls
 *  through to the parse. Whitespace-tolerant (`\s*`), not a literal `includes`:
 *  the exact byte spelling is unspecified JSON formatting, not part of the
 *  protocol, and this pre-filter is a PURE optimisation over the parse below
 *  (which already checks the decoded type against the same set) — a false
 *  negative here would silently drop either the exact evidence (a failed
 *  build's own last log lines) or a download's progress, the two things this
 *  module exists to keep.
 *
 *  The progress results are the ones Nix sends by the hundred thousand during a
 *  large copy; they are PARSED now (the old filter dropped them here, which is
 *  why a long download narrated nothing while it ran). */
const RESULT_PREFIX = `${NIX_PREFIX}{"action":"result"`;
const WANTED_RESULT_TYPES: readonly number[] = [
  RES_BUILD_LOG_LINE,
  RES_PROGRESS,
  RES_SET_EXPECTED,
];
const WANTED_RESULT_TYPE_RE = new RegExp(
  `"type"\\s*:\\s*(?:${WANTED_RESULT_TYPES.join("|")})\\b`,
);

/** The SAME whitespace-tolerant pre-filter, tightened to a progress result: the
 *  liveness question only ever asks about one, and a build-log line should reach
 *  {@link progressOf} as a regex miss rather than as a parse. */
const PROGRESS_TYPE_RE = new RegExp(`"type"\\s*:\\s*${RES_PROGRESS}\\b`);

/** A progress result's activity id and `done` counter, or `null` when `line`
 *  is not one. Only a line that passed the prefix + type filters is parsed.
 *
 *  A progress line is therefore parsed twice — here for the liveness verdict
 *  (which must be answerable before {@link nixLogReader}'s `line` looks at
 *  anything) and again by {@link classify} for the narration. Both parses are of
 *  a small object; sharing one would couple the liveness verdict to the reader's
 *  decode for no measurable gain. */
function progressOf(line: string): { id: number; done: number } | null {
  if (!line.startsWith(RESULT_PREFIX) || !PROGRESS_TYPE_RE.test(line))
    return null;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(NIX_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { type, id, fields } = value as {
    type?: unknown;
    id?: unknown;
    fields?: unknown;
  };
  const done = Array.isArray(fields) ? fields[0] : undefined;
  return type === RES_PROGRESS &&
    typeof id === "number" &&
    typeof done === "number"
    ? { id, done }
    : null;
}

/** Classify one stderr line: a decoded event, `"ignored"` for a Nix event this
 *  reader has no use for (activity stops, result types outside
 *  {@link WANTED_RESULT_TYPES} — dropped before any schema work), or `"raw"` for
 *  a line that is not a Nix event at all (ssh's own stderr — or a line that
 *  claims to be one and is not valid JSON, which is surfaced verbatim rather
 *  than dropped). */
function classify(line: string): NixEvent | "ignored" | "raw" {
  if (!line.startsWith(NIX_PREFIX)) return "raw";
  if (line.startsWith(RESULT_PREFIX) && !WANTED_RESULT_TYPE_RE.test(line)) {
    return "ignored";
  }
  let value: unknown;
  try {
    value = JSON.parse(line.slice(NIX_PREFIX.length));
  } catch {
    return "raw";
  }
  if (typeof value !== "object" || value === null) return "raw";
  const { action, type } = value as { action?: unknown; type?: unknown };
  const wanted =
    action === "msg" ||
    action === "start" ||
    (action === "result" &&
      typeof type === "number" &&
      WANTED_RESULT_TYPES.includes(type));
  if (!wanted) return "ignored";
  return Option.getOrElse(decodeNixEvent(value), (): "ignored" => "ignored");
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

/** One in-flight copy's milestone state. `expected` arrives LATE (Nix knows a
 *  path's size only once it has the nar header), so a milestone waits for it
 *  rather than reading `0 B of 0 B`. */
interface CopyActivity {
  readonly name: string;
  expected: number;
  /** Where the last narrated milestone stood: the byte count, and when it was
   *  said. */
  lastDone: number;
  lastAt: number;
}

/** A copied store path, as a person reads it: `/nix/store/<32-character
 *  hash>-glibc-2.44-25` → `glibc-2.44-25`. `null` for anything else — a start
 *  whose `fields[0]` is not a well-formed store path simply never narrates. */
function copyActivityName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/^\/nix\/store\/[0-9a-z]{32}-/, "");
  return name === value || name === "" ? null : name;
}

export function nixLogReader(
  narrate: (line: string) => void,
  /** The clock the milestone cadence reads. Injectable so a test can drive the
   *  15-second gate without waiting 15 seconds; production reads the wall
   *  clock. */
  now: () => number = Date.now,
): NixLogReader {
  let root: { readonly headline: string; readonly msg: string } | null = null;
  let narratedAfterRoot = false;
  let nixTransport = false;
  let sshTransport = false;
  let sshNetworkError = false;
  let refusal: SshRefusalEvidence | null = null;
  const builds = new QuickLRU<number, { drv: string; tail: string[] }>({
    maxSize: BUILDS_RETAINED,
  });
  /** Each activity's last `done` counter, for {@link NixLogReader.isActivity}'s
   *  verdict — the ONE piece of state that tells a moving transfer from one Nix
   *  keeps re-reporting unchanged. */
  const lastDone = new QuickLRU<number, number>({
    maxSize: PROGRESS_RETAINED,
  });
  /** The copy activities whose progress is worth narrating, by Nix's activity
   *  id — the milestone cadence's whole state, not the liveness verdict: only an
   *  `actCopyPath` start is ever tracked here, and its `lastDone` is the byte
   *  cursor the 10% gate measures from (a different question, and a different
   *  bound, from the table above — an evicted entry just stops narrating). */
  const copies = new QuickLRU<number, CopyActivity>({
    maxSize: COPY_ACTIVITIES_RETAINED,
  });

  const say = (line: string): void => {
    if (root !== null) narratedAfterRoot = true;
    narrate(line);
  };

  /** Narrate a copy's progress at a human cadence — "glibc-2.44-25: 42 MiB of
   *  180 MiB" — once the transfer has moved another {@link MILESTONE_PERCENT}
   *  of its total, or, for one slow enough that 10% takes longer, on
   *  {@link MILESTONE_INTERVAL_MS} instead. The interval gate also requires the
   *  byte count to have MOVED: a stalled transfer repeating its last figure every
   *  15 seconds would be noise, not progress. */
  const onCopyProgress = (id: number, fields: readonly unknown[]): void => {
    const copy = copies.get(id);
    if (copy === undefined) return;
    const [done, expected] = fields;
    if (typeof done !== "number") return;
    if (typeof expected === "number" && expected > 0) copy.expected = expected;
    if (copy.expected <= 0) return;
    const at = now();
    // INTEGER arithmetic, not a float fraction: `100 * moved >=
    // MILESTONE_PERCENT * expected` IS "moved another 10%", where
    // `done / expected - last >= 0.1` would skip boundaries in binary floating
    // point (0.3 - 0.2 < 0.1).
    const moved = done - copy.lastDone;
    const byFraction = 100 * moved >= MILESTONE_PERCENT * copy.expected;
    const byInterval = at - copy.lastAt >= MILESTONE_INTERVAL_MS && moved > 0;
    if (!byFraction && !byInterval) return;
    say(`${copy.name}: ${formatBytes(done)} of ${formatBytes(copy.expected)}`);
    copy.lastDone = done;
    copy.lastAt = at;
  };

  /** `resSetExpected` — Nix announcing an activity's total AFTER its start. Kept
   *  rather than dropped because it is the other source of that number, for the
   *  activities whose own progress events carry `expected: 0` until the header
   *  lands. */
  const onSetExpected = (id: number, fields: readonly unknown[]): void => {
    const copy = copies.get(id);
    if (copy === undefined) return;
    const expected = fields[1];
    if (typeof expected === "number" && expected > 0) copy.expected = expected;
  };

  const onMsg = (level: number, msg: string, rawMsg: string | undefined) => {
    if (level > LVL_INFO) return;
    if (level > 0) {
      for (const l of linesOf(msg)) say(l);
      return;
    }
    const headline = headlineOf(msg, rawMsg);
    // Only the headline can be Nix speaking about a connection; the rest of an
    // error message may quote a builder's log ("Last 17 log lines: > …").
    if (looksLikeNetworkError(headline)) nixTransport = true;
    if (root === null) {
      root = { headline, msg };
      for (const l of linesOf(msg)) narrate(l);
      return;
    }
    // A later error is the cascade of the first — one line each, never a block.
    say(`error: ${headline}`);
  };

  const rootError = (): NixError | null => {
    if (root === null) return null;
    const { headline, msg } = root;
    const text = plain(msg);
    const failed = [...builds.values()].find(
      (b) => b.tail.length > 0 && text.includes(b.drv),
    );
    return {
      headline,
      detail: failed !== undefined ? failed.tail : linesOf(msg).slice(1),
    };
  };

  return {
    isActivity: (line) => {
      const progress = progressOf(line);
      if (progress === null) return true;
      const before = lastDone.get(progress.id);
      if (before !== undefined && progress.done <= before) return false;
      lastDone.set(progress.id, progress.done);
      return true;
    },
    line: (line) => {
      const event = classify(line);
      if (event === "ignored") return;
      if (event === "raw") {
        if (sshReportsTransportFailure(line)) sshTransport = true;
        if (looksLikeNetworkError(line)) sshNetworkError = true;
        if (refusal === null) {
          const kind = sshRefusalOf(line);
          if (kind !== null) refusal = { kind, line };
        }
        say(line);
        return;
      }
      switch (event.action) {
        case "msg":
          onMsg(event.level, event.msg, event.raw_msg);
          return;
        case "start": {
          const drv = event.fields?.[0];
          if (event.type === ACT_BUILD && typeof drv === "string") {
            builds.set(event.id, { drv, tail: [] });
          }
          // A copied path to watch: its id is how the progress results below
          // find their name, and `fields[0]` is the store path's own name part.
          if (event.type === ACT_COPY_PATH) {
            const name = copyActivityName(drv);
            if (name !== null) {
              copies.set(event.id, {
                name,
                expected: 0,
                lastDone: 0,
                lastAt: now(),
              });
            }
          }
          if (event.level <= LVL_INFO && event.text !== "") say(event.text);
          return;
        }
        case "result": {
          if (event.type === RES_PROGRESS) {
            onCopyProgress(event.id, event.fields);
            return;
          }
          if (event.type === RES_SET_EXPECTED) {
            onSetExpected(event.id, event.fields);
            return;
          }
          // The last wanted result type: a build's own log line, kept as that
          // build's failure evidence.
          const build = builds.get(event.id);
          const text = event.fields[0];
          if (build === undefined || typeof text !== "string") return;
          const l = plain(text).trimEnd();
          if (l.trim() === "") return;
          build.tail.push(l);
          if (build.tail.length > BUILD_LOG_TAIL) build.tail.shift();
          return;
        }
      }
    },
    rootError,
    nixReportedTransportFailure: () => nixTransport,
    sshReportedTransportFailure: () => sshTransport,
    sshReportedNetworkFailure: () => sshNetworkError,
    sshRefusal: () => refusal,
    recap: () => {
      const error = narratedAfterRoot ? rootError() : null;
      return error === null
        ? []
        : [`error: ${error.headline}`, ...error.detail];
    },
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

/** How long a Nix run may live, and who else watches it for silence. */
export type NixRunLifetime =
  | { readonly policy: DeadlinePolicy }
  | {
      readonly policy: ProgressLivenessPolicy;
      readonly onActivity: () => void;
    };

/** A finished Nix run: how the process ended, plus what its log said. */
export type NixRun = CaptureResult & {
  /** The run's root error, or `null` when Nix reported none. */
  readonly error: NixError | null;
  /** The connection failed: Nix's own error headline said so, or ssh did — on
   *  the local seat a bare network-connectivity line in its forked ssh's
   *  stderr alone (Nix exits with its own code, so there is no exit-code
   *  corroboration to ask for; see {@link NixLogReader.sshReportedNetworkFailure}
   *  for why an ssh REFUSAL is excluded there), on an ssh-wrapped seat only
   *  through {@link sshExitIsTransport} (the ssh we spawned exited 255 AND said
   *  why — a refusal included, since ssh's own 255 IS the corroboration), the
   *  same rule as the agent dial. */
  readonly transportFailure: boolean;
  /** See {@link NixLogReader.sshRefusal}. */
  readonly sshRefusal: SshRefusalEvidence | null;
};

/** Run one Nix command with its log read through {@link nixLogReader} — the ONE
 *  way provisioning runs Nix, so no step can report an exit code where Nix
 *  said why, or classify a builder's chatter as the host going away.
 *
 *  `target` is where the command runs, exactly as {@link buildSshProbeCommand}
 *  takes it: `"localhost"` spawns it directly (also the arm for a local `nix`
 *  that reaches a remote store over `ssh-ng://`), a host wraps it in the dial's
 *  ssh. `argv[0]` is the Nix command; the log-format flag goes right after it.
 *  It runs through {@link runCaptureAt}, so a remote run that ends ABANDONED —
 *  aborted, or killed by its own lifetime policy — is SIGKILLed on the host
 *  before this returns, and a retry never queues behind the previous attempt's
 *  store-path lock.
 *
 *  When the run fails after its root error was pushed down by the cascade, the
 *  root error is narrated once more as the LAST lines — a bounded progress tail
 *  (the failure card's evidence) then ends on the cause, not its fallout.
 *
 *  A `progress-liveness` run REQUIRES `onActivity`, called for every stderr line
 *  that is real activity ({@link NixLogReader.isActivity}) — narrated or
 *  filtered. The child's own policy is kept alive by those same lines, so an
 *  owner watching for silence one level up (the session's pre-connected
 *  backstop) must see them too, or a healthy build whose output is all
 *  filtered log lines is cycled there while its own bound never fires. A quick
 *  `deadline` run has no such owner to feed, so the type refuses one. */
export async function runNix(
  target: string | SshDestination,
  argv: readonly [string, ...string[]],
  opts: {
    readonly narrate?: (line: string) => void;
    readonly signal: AbortSignal | undefined;
    readonly env?: Readonly<Record<string, string>>;
    /** A raw stderr line the caller knows is noise, kept from the log reader
     *  — never narrated, never a root error (it still counts as activity). */
    readonly dropLine?: (line: string) => boolean;
  } & NixRunLifetime,
): Promise<NixRun> {
  const narrate = opts.narrate ?? (() => {});
  const reader = nixLogReader(narrate);
  const remote = !isLocalHost(targetOf(target).host);
  const [nixCommand, ...rest] = argv;
  const res = await runCaptureAt(
    target,
    [nixCommand, "--log-format", "internal-json", ...rest],
    {
      isActivity: (line) => {
        // A dropped line is still activity: the store-dedup noise it filters
        // (`/nix/store/.links/…`) is the daemon unpacking, which is progress.
        const active =
          opts.dropLine?.(line) === true || reader.isActivity(line);
        if (active && "onActivity" in opts) opts.onActivity();
        return active;
      },
      onProgress: (line) => {
        if (opts.dropLine?.(line) !== true) reader.line(line);
      },
      onRemoteKillFailure: narrate,
      policy: opts.policy,
      signal: opts.signal,
      env: opts.env,
      maxLineLength: NIX_LOG_LINE_MAX,
    },
  );
  if (!res.ok) for (const l of reader.recap()) narrate(l);
  // See `NixRun.transportFailure` for why the two seats read ssh differently.
  // The local seat trusts only the bare network-error signal, never a
  // refusal alone: `runNix("localhost", …)` also runs a source flake's own
  // evaluation (`resolveAgentDrv`) and a declared cache's own copy
  // (`prefetchAgentClosure`), whose forked ssh (if any) is not provably
  // talking to THIS dial's target host — an unrelated ssh's "Permission
  // denied" would otherwise misclassify a permanent local config fault as
  // the untyped, retry-forever "network" cause.
  const sshFailed = remote
    ? sshExitIsTransport({
        usesSsh: true,
        code: res.kind === "exit" ? res.code : null,
        sshReportedTransportFailure: reader.sshReportedTransportFailure(),
      })
    : reader.sshReportedNetworkFailure();
  return {
    ...res,
    error: reader.rootError(),
    transportFailure: reader.nixReportedTransportFailure() || sshFailed,
    sshRefusal: reader.sshRefusal(),
  };
}

/** The multi-line account of how a Nix run ended: Nix's root error headline
 *  followed by its whole detail (an evaluation trace, or a failed build's last
 *  log lines) when there is one, otherwise {@link describeNixRun}. */
export function describeNixRunWithDetail(res: NixRun): string {
  return res.kind === "exit" &&
    res.error !== null &&
    res.error.detail.length > 0
    ? [res.error.headline, ...res.error.detail].join("\n")
    : describeNixRun(res);
}

/** How a Nix run ended, in words: Nix's own root error when it exited having
 *  reported one, otherwise the process outcome (a kill, an abort, a spawn
 *  fault — or an exit Nix said nothing about). */
export function describeNixRun(res: NixRun): string {
  return res.kind === "exit" && res.error !== null
    ? describeNixError(res.error)
    : describeExit(res);
}

/** A resolver's verdict for a failed Nix run — the ONE table from a {@link NixRun}
 *  to the error a `resolveDrvPath` rejects with, shared by the arch probe and the
 *  agent evaluation so the two can never classify the same outcome differently.
 *
 *  - An `exit` with transport evidence stays the untyped (retry-forever) error;
 *    without it the command RAN and failed, so it is a bounded `unavailable`
 *    carrying Nix's own error.
 *  - `spawn-error` / `output-error` / `signal` are local resource or setup
 *    faults, not transport facts: retrying a missing executable or an externally
 *    OOM-killed evaluator inside the reconnect loop would respawn the same
 *    failure indefinitely, so they are bounded too. (A spawn fault depends on
 *    WHICH program was launched: the arch probe handles its own spawn faults
 *    before reaching this table — see `arch.ts`.)
 *  - Our own kills (`lifetime-expired`) and the user's abort stay untyped. */
export function resolverErrorOf(message: string, run: NixRun): Error {
  const unavailable = (): Error =>
    new ResolveDrvError(message, {
      kind: "unavailable",
      failureCause: "remote",
      terminal: false,
    });
  return match(run)
    .with({ kind: "exit" }, (r) =>
      r.transportFailure ? new Error(message) : unavailable(),
    )
    .with(
      { kind: P.union("spawn-error", "output-error", "signal") },
      unavailable,
    )
    .with(
      { kind: P.union("lifetime-expired", "aborted") },
      () => new Error(message),
    )
    .exhaustive();
}
