/**
 * Everything the two spawn twins must agree on — how a child is LAUNCHED and
 * how a FAILED one is READ. It spawns nothing itself: `CHILD_OPTIONS` is the
 * options object, not the call.
 *
 * Its own module because the two spawn twins disagree about how they spell a
 * child's fate, and one reader has to reconcile them: `promisify(execFile)`
 * rejects with `.code` (the exit status) and `.killed`, while `execFileSync`
 * throws the raw spawnSync result — `.status`, `.signal`, and no `.code` at
 * all. A rule written against one spelling is silently inert on the other
 * twin, which is exactly how the exit-1 document rule below came to be
 * enforced on the async path and not the sync one.
 *
 * That same failure mode lives one level UP, at the call: a timeout, a kill
 * signal, or a buffer cap bumped on one twin and not the other would leave the
 * sync gate path quietly running the old policy. So the options and the
 * failure composition are stated ONCE here and applied by both twins, and the
 * only line the twins may still spell differently is `execFileAsync` versus
 * `execFileSync`.
 *
 * Being a pure function of the error object is what lets the classifier be
 * pinned without manufacturing a real child that exits mid-write. The module
 * is INTERNAL — absent from the package `exports`, and the only name of its
 * own that reaches `index.ts` is the timeout below, re-exported through
 * `client.ts` — so this is a unit with its own contract, not a test seam
 * punched through the client's production root.
 */

// From the zero-dependency leaf, not from `client.ts`: `client.ts` imports this
// module, so taking the class from there would make the pair a cycle.
import { OsfactsClientError } from "./clientError.ts";

/** How long a child may run before it is killed. Public (re-exported by
 *  `client.ts`, and consumed as `PORT_SCAN_COMMAND_TIMEOUT_MS` by padi), and
 *  defined HERE because it is a property of the child, not of the parser. */
export const OSFACTS_COMMAND_TIMEOUT_MS = 5_000;

/**
 * The spawn policy both twins run under, in one object.
 *
 * `killSignal: "SIGKILL"` because the timeout's job is to END the child, and a
 * SIGTERM a wedged osfacts ignores would leave the caller waiting forever on
 * the very deadline that was supposed to bound it. `maxBuffer` is 8 MiB — a
 * host-wide snapshot of a busy machine is the largest document the binary
 * writes, and truncating it would surface as a parse error about an arbitrary
 * row rather than as "the answer did not fit".
 */
export const CHILD_OPTIONS = {
  timeout: OSFACTS_COMMAND_TIMEOUT_MS,
  killSignal: "SIGKILL",
  maxBuffer: 8 * 1024 * 1024,
} as const;

/** The one guard every spawn entry point runs first. An empty path is the
 *  caller failing to resolve its bake, and `execFile("")` would report it as a
 *  confusing ENOENT rather than as the missing bake it is. */
export function assertBinPath(bin: string): void {
  if (!bin)
    throw new OsfactsClientError(
      "spawn",
      "osfacts binary path is empty — the caller must supply an absolute path",
    );
}

/** How a child's failure becomes the client's error — one composition, so the
 *  two twins cannot drift on what an operator is told. `errnoOf` first because
 *  a spawn errno (ENOENT/EACCES) names the cause better than any exit status
 *  the runtime may also have attached. */
export function spawnFailure(bin: string, err: unknown): OsfactsClientError {
  return new OsfactsClientError(
    "spawn",
    `osfacts \`${bin}\` failed (${errnoOf(err) ?? exitDescription(err)})${failureDetail(err)}`,
    { cause: err },
  );
}

/**
 * The child's exit status, however the runtime spelled it.
 *
 * `promisify(execFile)` puts it on `.code`; `execFileSync` throws the raw
 * spawnSync result, whose status is `.status` and which has no `.code` at all.
 * One reader for both, because the async and sync twins must not be able to
 * disagree about what "the binary exited 1" means — a guard that reads only
 * `.code` is silently inert on the sync path, which is exactly how the exit-1
 * document rule below came to be enforced on one twin and not the other.
 */
export function exitStatusOf(err: unknown): number | undefined {
  const failure = err as { code?: unknown; status?: unknown };
  if (typeof failure?.code === "number") return failure.code;
  if (typeof failure?.status === "number") return failure.status;
  return undefined;
}

export function errnoOf(err: unknown): string | undefined {
  // A spawn failure (ENOENT, EACCES) puts an errno STRING on `.code`; an exit
  // status puts a number there. Only the string is an errno.
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" ? code : undefined;
}
/** The ONE exit status that still carries a document — the binary's documented
 *  total-failure path, "write the V line and its E rows, then exit 1". */
const DOCUMENT_BEARING_EXIT = 1;

/**
 * The child's stdout when a non-zero exit still produced a V2 document.
 *
 * Two exclusions, and both are load-bearing:
 *
 * A child that was **ended by a signal** is excluded: on SIGKILL the output is
 * whatever had been flushed, so a `V` prefix there means a truncated document,
 * not a complete one — and a truncated document must surface as the spawn
 * failure it is rather than as a parse error about some arbitrary row.
 *
 * Exported for its own unit pins (NOT from the package index — this is not
 * public API): the two exclusions are one-line rules whose failure mode is a
 * silently discarded document, which no round-trip through a stub binary can
 * manufacture on demand.
 *
 * Any status **other than 1** is excluded, because the binary writes its
 * version line on the usage path too (deliberately — a consumer built against
 * another revision must see the version before anything else). Exit 2 is the
 * CLI *refusing the ask*: an unknown verb, an unknown flag, a missing
 * argument. Accepting that document turned "this binary does not have the verb
 * you asked for" into a perfectly well-formed answer of *nothing found* — the
 * exact collapse-to-empty the wire format exists to refuse, and the one an
 * older binary on a caller's `PATH` produces every single time.
 */
export function failureDocument(err: unknown): string | undefined {
  const failure = err as {
    stdout?: unknown;
    killed?: boolean;
    signal?: unknown;
  };
  // A child ended BY A SIGNAL flushed only part of its document, so its stdout
  // is a truncated one. `killed` is NOT that test: node sets it whenever WE
  // sent a signal, even when the child had already exited on its own — so when
  // the command timeout fires against a child that has just exited 1, node
  // reports `{ code: 1, killed: true, signal: null }` and a `killed` rule
  // discards a COMPLETE document, losing exactly the `E` rows naming which
  // source went blind. `signal` is populated on both twins (`error.signal` from
  // execFile, `signal` on the thrown spawnSync result), so one rule serves both.
  if (failure?.signal != null) return undefined;
  if (exitStatusOf(err) !== DOCUMENT_BEARING_EXIT) return undefined;
  const stdout = failure?.stdout;
  if (typeof stdout !== "string" || !stdout.startsWith("V\t")) return undefined;
  return stdout;
}

/** How the child failed when it was not a spawn errno: the exit status if the
 *  runtime reported one, so a caller can tell a refused ask (2) from a blind
 *  read (1) without re-deriving it from the message. */
export function exitDescription(err: unknown): string {
  const status = exitStatusOf(err);
  return status === undefined ? "non-zero exit" : `exit ${status}`;
}

/** The child's stderr, trimmed to one line — the only place the binary says
 *  WHY it refused an ask, so a spawn failure that discards it leaves the
 *  caller an opaque status code. */
export function failureDetail(err: unknown): string {
  const stderr = (err as { stderr?: unknown })?.stderr;
  const text = typeof stderr === "string" ? stderr.trim() : "";
  return text === "" ? "" : ` — ${text.split("\n")[0]}`;
}
