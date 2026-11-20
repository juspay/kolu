import { Schema } from "effect";

/** No terminal with this id — it exited, it was never created, or (for a
 *  MUTATION) it is a parked record that has no live PTY to mutate.
 *
 *  The two STREAM members that also raise it (`terminalAttach`, `terminalExit`)
 *  carry no error channel, so there it is an UNDECLARED failure: narrowable
 *  in-process, opaque across a wire hop. */
export class TerminalNotFound extends Schema.TaggedError<TerminalNotFound>(
  "padi/TerminalNotFound",
)("TerminalNotFound", { id: Schema.String }) {
  override get message(): string {
    return `Terminal ${this.id} not found`;
  }
}

/** The terminal EXISTS, but it is not the live arm the call needs — it is
 *  asleep (a record whose PTY was released) or parked (a reboot placeholder the
 *  restore card offers). Raised by padi's one active-terminal gate
 *  (`requireActiveTerminal`), declared beside {@link TerminalNotFound} as
 *  {@link TerminalGateErrorSchema}. The state rides as DATA. */
export class TerminalNotActive extends Schema.TaggedError<TerminalNotActive>(
  "padi/TerminalNotActive",
)("TerminalNotActive", {
  id: Schema.String,
  /** The registry arm the record IS in — never `active`, which is the arm that
   *  would not have raised this. */
  state: Schema.Literals(["sleeping", "parked"]),
}) {
  override get message(): string {
    return this.state === "parked"
      ? `Terminal ${this.id} is parked — it is a restore-card placeholder with no live screen; wake it by restoring the session`
      : `Terminal ${this.id} is asleep — wake it before reading its screen`;
  }
}

/** A proposed parent edge that is nonsense in any tree model — a self-parent,
 *  an edge that would close a cycle, or a parent already sitting in one. The
 *  `reason` field keeps the three distinguishable in a log;
 *  `childId`/`parentId` ride as data so the message is derived, never parsed. */
export class TerminalParentCycle extends Schema.TaggedError<TerminalParentCycle>(
  "padi/TerminalParentCycle",
)("TerminalParentCycle", {
  childId: Schema.String,
  parentId: Schema.String,
  reason: Schema.Literals(["self", "wouldCycle", "parentInCycle"]),
}) {
  override get message(): string {
    const said: Record<typeof this.reason, string> = {
      self: `Terminal ${this.childId} cannot be its own parent`,
      wouldCycle: `Parent ${this.parentId} would cycle through ${this.childId}`,
      parentInCycle: `Parent ${this.parentId} sits in a cycle`,
    };
    return said[this.reason];
  }
}

/** A `watch.drain` against a name nobody opened — declared rather than answered
 *  with an empty result, because "no subscription" and "no events yet" are two
 *  different states. The known names ride as data. */
export class WatchSubscriptionNotFound extends Schema.TaggedError<WatchSubscriptionNotFound>(
  "padi/WatchSubscriptionNotFound",
)("WatchSubscriptionNotFound", {
  name: Schema.String,
  /** Every subscription this padi currently holds. */
  known: Schema.Array(Schema.String),
}) {
  override get message(): string {
    const known = this.known.length === 0 ? "none" : this.known.join(", ");
    return `No standing subscription named "${this.name}" — open one first (known: ${known})`;
  }
}

/** The tag string, read OFF the class rather than re-spelled. */
const WATCH_SUBSCRIPTION_NOT_FOUND_TAG: string = new WatchSubscriptionNotFound({
  name: "",
  known: [],
})._tag;

/** Does `err` carry this tagged-error `_tag`?
 *
 *  The STRUCTURAL counterpart to {@link isPadiDeclaredError}'s `instanceof`: a
 *  value that crossed a wire was decoded in another realm, so its class identity
 *  is not ours and `instanceof` silently answers `false`. */
export function hasTag(err: unknown, tag: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { _tag?: unknown })._tag === tag
  );
}

/** Is `err` a {@link WatchSubscriptionNotFound} that may have CROSSED A WIRE?
 *  Structural on `_tag`, because a decoded value's class identity is another
 *  realm's and `instanceof` would answer `false`. */
export function isWatchSubscriptionNotFound(err: unknown): boolean {
  return hasTag(err, WATCH_SUBSCRIPTION_NOT_FOUND_TAG);
}

/** {@link TerminalNotFound}'s tag, read off the class. */
const TERMINAL_NOT_FOUND_TAG: string = new TerminalNotFound({ id: "" })._tag;

/** Is `err` a {@link TerminalNotFound} that may have CROSSED A WIRE? Structural
 *  on `_tag`, like its sibling above. */
export function isTerminalNotFound(err: unknown): boolean {
  return hasTag(err, TERMINAL_NOT_FOUND_TAG);
}

/** {@link TerminalNotActive}'s tag, read off the class. */
const TERMINAL_NOT_ACTIVE_TAG: string = new TerminalNotActive({
  id: "",
  state: "sleeping",
})._tag;

/** Is `err` a {@link TerminalNotActive} that may have CROSSED A WIRE? Structural
 *  on `_tag`, like its siblings. A sleeping terminal's refused read is a
 *  REFUSAL, not a `gone` and not a retryable `closed`. */
export function isTerminalNotActive(err: unknown): boolean {
  return hasTag(err, TERMINAL_NOT_ACTIVE_TAG);
}

/** The `{ id, state }` of a {@link TerminalNotActive} that crossed a wire, or
 *  `undefined` when `err` is not one. The companion of
 *  {@link isTerminalNotActive} for a face that must RENDER the refusal: the
 *  value was decoded in another realm, so its fields are read structurally. */
export function terminalNotActiveOf(
  err: unknown,
): { readonly id: string; readonly state: "sleeping" | "parked" } | undefined {
  if (!isTerminalNotActive(err)) return undefined;
  if (typeof err !== "object" || err === null) return undefined;
  if (!("state" in err) || !("id" in err)) return undefined;
  const state: unknown = err.state;
  const id: unknown = err.id;
  if (state !== "parked" && state !== "sleeping") return undefined;
  return typeof id === "string" ? { id, state } : undefined;
}

/** A scratch write the host REFUSES — a disallowed extension or an oversized
 *  payload. The authoritative server-side upload gate's answer (the client
 *  prechecks for a fast toast; this is the one that actually decides).
 *  `reason` is the user-facing sentence `rejectionFor` produced. */
export class ScratchWriteRejected extends Schema.TaggedError<ScratchWriteRejected>(
  "padi/ScratchWriteRejected",
)("ScratchWriteRejected", { reason: Schema.String }) {
  override get message(): string {
    return this.reason;
  }
}

/** An unranged / open-ended `preview.read` whose body would exceed the inline
 *  cap. Fail-fast, NEVER a silent truncation — and the message NAMES the fix
 *  (request a bounded byte range), which is why the cap rides as data: a client
 *  can compute a range from `limitBytes` instead of reading a number out of a
 *  sentence. */
export class PreviewTooLarge extends Schema.TaggedError<PreviewTooLarge>(
  "padi/PreviewTooLarge",
)("PreviewTooLarge", { limitBytes: Schema.Int }) {
  override get message(): string {
    return (
      `Preview body exceeds the ${this.limitBytes}-byte inline cap for ` +
      "an unranged read; request a bounded byte range (e.g. `bytes=0-…`) instead."
    );
  }
}

/** The terminal hosts no agent session, so there is nothing to export — no
 *  agent at all, or one that is up and has not been prompted yet (agents write
 *  their transcript with the first exchange). A precondition on the terminal's
 *  state, not a failure of the export. */
export class TranscriptNoAgent extends Schema.TaggedError<TranscriptNoAgent>(
  "padi/TranscriptNoAgent",
)("TranscriptNoAgent", {}) {
  override get message(): string {
    return "No agent session in this terminal yet — start an agent and prompt it first; it writes its transcript with the first exchange";
  }
}

/** The agent's transcript could not be loaded — the session id is live on the
 *  screen but its on-disk record is absent or unreadable. The agent kind +
 *  session id ride as data. */
export class TranscriptNotFound extends Schema.TaggedError<TranscriptNotFound>(
  "padi/TranscriptNotFound",
)("TranscriptNotFound", {
  agentKind: Schema.String,
  sessionId: Schema.String,
}) {
  override get message(): string {
    return `Transcript not found for ${this.agentKind} session ${this.sessionId}`;
  }
}

/** `agentDistro.models` could not answer which models a harness offers on
 *  this host — its agents are not ready here (off, not delivered, failed), or
 *  the harness's own list command failed or printed what kolu cannot read.
 *  `why` is the whole sentence: for a failed list command, its own words.
 *  Never an empty list: "could not list" and "lists nothing" are two answers
 *  ({@link AgentModelsSchema}'s `listed` with no ids is the second). */
export class AgentModelsUnavailable extends Schema.TaggedError<AgentModelsUnavailable>(
  "padi/AgentModelsUnavailable",
)("AgentModelsUnavailable", { harness: Schema.String, why: Schema.String }) {
  override get message(): string {
    return this.why;
  }
}

/** `agentDistro.launch` could not say how a harness's launch takes a model on
 *  this host — its agents are not ready here, its package is older than
 *  `--launch`, or the package printed what kolu cannot read. `why` is the
 *  whole sentence. `--launch` runs no harness, so a list command failing
 *  never lands here: a start is never refused for a list it does not need. */
export class AgentLaunchUnavailable extends Schema.TaggedError<AgentLaunchUnavailable>(
  "padi/AgentLaunchUnavailable",
)("AgentLaunchUnavailable", { harness: Schema.String, why: Schema.String }) {
  override get message(): string {
    return this.why;
  }
}

/** A PROVEN kaval contract skew, refused by `lifecycle.recycleKaval` (SK6).
 *  padi diagnosed it and cannot fix it — only the binder's reprovision can — so
 *  it refuses with both versions as TYPED data ({@link
 *  KavalSkewVersionsSchema}'s two fields, spelled here so the class is the
 *  wire shape rather than a wrapper around one). */
export class KavalContractSkew extends Schema.TaggedError<KavalContractSkew>(
  "padi/KavalContractSkew",
)("KavalContractSkew", {
  /** The contract version the daemon actually speaks. */
  daemonVersion: Schema.String,
  /** The contract version this kolu's build requires. */
  requiredVersion: Schema.String,
}) {
  override get message(): string {
    return `kaval speaks pty-host contract ${this.daemonVersion}; this build requires ${this.requiredVersion}`;
  }
}

/** The file is GONE — deleted under an open preview, a build output cleaned
 *  under an open row. The ONE git/fs failure every reader branches on: the
 *  client's `BrowseFileDispatcher` swallows it, where any other failure is a
 *  visible error over a file the user merely deleted. */
export class FileGone extends Schema.TaggedError<FileGone>("padi/FileGone")(
  "FileGone",
  { path: Schema.String },
) {
  override get message(): string {
    return `Not found: ${this.path}`;
  }
}

/** The base branch a request names, or the repo's default one, does not
 *  exist. Two raisers, both through `unwrapGit`'s `BASE_BRANCH_NOT_FOUND`: a
 *  worktree create (pick another base) and the Branch comparison
 *  (`git.getStatus` / `git.getDiff` in branch mode, whose `origin` default
 *  branch was never fetched). Actionable either way — the detail says what to
 *  run — so declared. */
export class WorktreeBaseBranchMissing extends Schema.TaggedError<WorktreeBaseBranchMissing>(
  "padi/WorktreeBaseBranchMissing",
)("WorktreeBaseBranchMissing", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/** A worktree create refused because the name is already taken — actionable
 *  (pick another name), so declared. */
export class WorktreeNameCollision extends Schema.TaggedError<WorktreeNameCollision>(
  "padi/WorktreeNameCollision",
)("WorktreeNameCollision", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/** Git itself failed — the command errored, the path is not a repository, or a
 *  resolved path escaped its root. DECLARED rather than a defect, so the git
 *  message a user reads surfaces. */
export class GitFailed extends Schema.TaggedError<GitFailed>("padi/GitFailed")(
  "GitFailed",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** The ACTIVE-TERMINAL gate's two answers, for every member behind
 *  `requireActiveTerminal`: the id names nothing ({@link TerminalNotFound}), or
 *  it names a record with no live PTY ({@link TerminalNotActive}). One union so
 *  the pair cannot drift apart member by member — a procedure that narrows to
 *  the active arm declares THIS, never one half of it. */
export const TerminalGateErrorSchema = Schema.Union([
  TerminalNotFound,
  TerminalNotActive,
]);

/** Every fs/git READ can hit a gone file or a git failure. */
export const FsGitReadErrorSchema = Schema.Union([FileGone, GitFailed]);

/** The two reads that compare against a base branch (`git.getStatus`,
 *  `git.getDiff`) add the missing-base answer to every read's pair, so its
 *  sentence ("No base branch found … git fetch origin …") crosses the wire
 *  instead of failing the encode. */
export const GitBaseReadErrorSchema = Schema.Union([
  FileGone,
  GitFailed,
  WorktreeBaseBranchMissing,
]);

/** A worktree CREATE adds the two refusals a caller can correct. */
export const WorktreeCreateErrorSchema = Schema.Union([
  WorktreeBaseBranchMissing,
  WorktreeNameCollision,
  GitFailed,
]);

/** The whole declared vocabulary as CLASSES — the one list, from which both the
 *  closed union below and the runtime predicate are derived, so neither can
 *  drift from the other or from this file. */
const PADI_ERROR_CLASSES = [
  TerminalNotFound,
  TerminalNotActive,
  TerminalParentCycle,
  WatchSubscriptionNotFound,
  ScratchWriteRejected,
  PreviewTooLarge,
  TranscriptNoAgent,
  TranscriptNotFound,
  KavalContractSkew,
  FileGone,
  WorktreeBaseBranchMissing,
  WorktreeNameCollision,
  GitFailed,
  AgentModelsUnavailable,
  AgentLaunchUnavailable,
] as const;

/** The whole padi error vocabulary, as one closed union — the value a consumer
 *  decodes an unknown padi failure against, and the list a new member must be
 *  added to deliberately. */
export const PadiErrorSchema = Schema.Union([...PADI_ERROR_CLASSES]);
export type PadiError = typeof PadiErrorSchema.Type;

/** Is `err` one of the DECLARED failures above?
 *
 *  The predicate padi's SERVING seam uses to route a THROWN value onto the
 *  Effect FAILURE channel rather than the defect channel.
 *
 *  `instanceof`, deliberately, and sound at the one place it runs: the value was
 *  constructed by padi's own in-process code moments earlier, in this module
 *  realm. A value that CROSSED a wire is narrowed STRUCTURALLY on its `_tag`. */
export function isPadiDeclaredError(err: unknown): err is PadiError {
  return PADI_ERROR_CLASSES.some((Cls) => err instanceof Cls);
}
