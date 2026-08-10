/**
 * `@kolu/padi/surface`'s DECLARED error vocabulary (PLAN D4).
 *
 * Every failure a caller can BRANCH on is a `Schema.TaggedError` declared
 * here and carried by the `padiSurface` members that raise it — so the
 * discriminant is a `_tag`, not a magic code string compared by hand, and the
 * payload rides as typed DATA rather than prose a reader has to re-parse. These
 * replace the eight `ORPCError(<CODE>)` sites the oRPC era spelled.
 *
 * What is NOT here is as load-bearing as what is. A failure that means "padi is
 * broken" — a `git` invocation that blew up, a non-repo path, a path that
 * escapes its root — stays an UNDECLARED throw, i.e. a DEFECT: it crosses the
 * wire opaquely and crashes loudly, which is the honest reading. Declare what a
 * caller can act on; leave the rest to the fail-fast channel.
 *
 * BROWSER-SAFE (Effect only, no `node:` imports): `surface.ts` DECLARES these on
 * the procedures, the client NARROWS on them, and padi's node-side handlers
 * RAISE them — one module all three reach, with the arrow pointing out of it.
 * It deliberately imports no other padi module, so it can never join a cycle
 * with `surface.ts` (the #1005 shape).
 */

import { Schema } from "effect";

// ── Terminal identity ─────────────────────────────────────────────────────

/** No terminal with this id — it exited, it was never created, or (for a
 *  MUTATION) it is a parked record that has no live PTY to mutate.
 *
 *  The successor of `ORPCError("NOT_FOUND", { message: "Terminal <id> not
 *  found" })`. The message is reproduced verbatim so an operator reading a log
 *  or a toast sees the same sentence; what changed is that a consumer now
 *  narrows on `_tag === "TerminalNotFound"` and can read the `id` off the
 *  value instead of scraping it out of the prose.
 *
 *  Declared on every per-terminal PROCEDURE that raises it. The two STREAM
 *  members that also raise it (`terminalAttach`, `terminalExit`) have no error
 *  channel to declare on — a `StreamSpec` carries no `error` — so there it is
 *  an UNDECLARED failure: narrowable in-process, opaque across a wire hop.
 *  That asymmetry is the framework's, and it is stated rather than papered
 *  over (the same call kaval's `PtyNotFound` makes for its five streams). */
export class TerminalNotFound extends Schema.TaggedError<TerminalNotFound>(
  "padi/TerminalNotFound",
)("TerminalNotFound", { id: Schema.String }) {
  override get message(): string {
    return `Terminal ${this.id} not found`;
  }
}

/** A proposed parent edge that is nonsense in any tree model — a self-parent,
 *  an edge that would close a cycle, or a parent already sitting in one.
 *
 *  The successor of the three `ORPCError("BAD_REQUEST")` throws in
 *  `requireAcyclicParent`. ONE class rather than three, because the three
 *  spelled ONE wire code and a caller acts on all of them identically (refuse
 *  the drop); the `reason` field keeps them distinguishable in a log without
 *  minting a discriminant nobody branches on. `childId`/`parentId` ride as
 *  data so the message is derived, never parsed. */
export class TerminalParentCycle extends Schema.TaggedError<TerminalParentCycle>(
  "padi/TerminalParentCycle",
)("TerminalParentCycle", {
  childId: Schema.String,
  parentId: Schema.String,
  reason: Schema.Literals(["self", "wouldCycle", "parentInCycle"]),
}) {
  override get message(): string {
    // A total lookup rather than a switch: the sentence per reason is DATA, and
    // an exhaustive `Record` keyed by the literal union makes adding a reason a
    // compile error here instead of a fall-through that returns nothing.
    const said: Record<typeof this.reason, string> = {
      self: `Terminal ${this.childId} cannot be its own parent`,
      wouldCycle: `Parent ${this.parentId} would cycle through ${this.childId}`,
      parentInCycle: `Parent ${this.parentId} sits in a cycle`,
    };
    return said[this.reason];
  }
}

// ── Standing settle-event subscriptions ───────────────────────────────────

/** A `watch.drain` against a name nobody opened.
 *
 *  DECLARED rather than answered with an empty result, and that is the whole
 *  point of the class: "no subscription" and "no events yet" are the two states a
 *  supervisor must never confuse. Returning `{events: []}` for an unopened name
 *  would let an agent that typo'd its subscription name — or that assumed a
 *  subscription surviving something that did not survive — sit in a drain loop
 *  reading silence as calm. The known names ride as data so the answer to "then
 *  what AM I subscribed to" is in the failure itself. */
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

/** The tag string, read OFF the class rather than re-spelled — a rename moves
 *  this with it instead of silently un-matching (the same discipline as
 *  `reattachingDeltas.ts`'s `PTY_NOT_FOUND_TAG`). A hand-copied literal here
 *  would make the predicate answer `false` for every real occurrence, which is
 *  exactly the collapse it exists to stop. */
const WATCH_SUBSCRIPTION_NOT_FOUND_TAG: string = new WatchSubscriptionNotFound({
  name: "",
  known: [],
})._tag;

/** Is `err` a {@link WatchSubscriptionNotFound} that may have CROSSED A WIRE?
 *
 *  Structural on `_tag`, deliberately — the sibling of `isPadiDeclaredError`'s
 *  `instanceof` and the reason that one documents its own narrowness. This is
 *  read by a CLIENT (`awaitWatchEvents`), where the value was decoded from a
 *  wire frame and its class identity is another realm's. An `instanceof` there
 *  silently answers `false` and the failure collapses into the retryable arm —
 *  precisely the collapse this predicate exists to stop. */
export function isWatchSubscriptionNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { _tag?: unknown })._tag === WATCH_SUBSCRIPTION_NOT_FOUND_TAG
  );
}

// ── Byte writes / reads ───────────────────────────────────────────────────

/** A scratch write the host REFUSES — a disallowed extension or an oversized
 *  payload. The authoritative server-side upload gate's answer (the client
 *  prechecks for a fast toast; this is the one that actually decides), and the
 *  successor of `servePadi`'s `ORPCError("BAD_REQUEST", { message: reason })`.
 *  `reason` is the same user-facing sentence `rejectionFor` already produced. */
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
 *  sentence. Successor of `ORPCError("PAYLOAD_TOO_LARGE")`. */
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

// ── Transcript export ─────────────────────────────────────────────────────

/** The terminal hosts no agent session, so there is nothing to export.
 *  Successor of `ORPCError("PRECONDITION_FAILED")` — a precondition on the
 *  terminal's state, not a failure of the export. */
export class TranscriptNoAgent extends Schema.TaggedError<TranscriptNoAgent>(
  "padi/TranscriptNoAgent",
)("TranscriptNoAgent", {}) {
  override get message(): string {
    return "No active agent session in this terminal — start Claude Code, OpenCode, Codex, or Grok first";
  }
}

/** The agent's transcript could not be loaded — the session id is live on the
 *  screen but its on-disk record is absent or unreadable. Successor of
 *  `ORPCError("NOT_FOUND")`; the agent kind + session id ride as data. */
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

// ── kaval supervision ─────────────────────────────────────────────────────

/** A PROVEN kaval contract skew, refused by `lifecycle.recycleKaval` (SK6).
 *  padi diagnosed it and cannot fix it — only the binder's reprovision can — so
 *  it refuses with both versions as TYPED data ({@link
 *  KavalSkewVersionsSchema}'s two fields, spelled here so the class is the
 *  wire shape rather than a wrapper around one).
 *
 *  Successor of the oRPC `errors: { KAVAL_CONTRACT_SKEW: { data } }` map entry
 *  and its injected `errors.KAVAL_CONTRACT_SKEW(...)` constructor: the handler
 *  now FAILS with an instance of this class, and the client narrows on
 *  `_tag === "KavalContractSkew"` instead of `error.code`. */
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

// ── fs / git ──────────────────────────────────────────────────────────────

/** The file is GONE — deleted under an open preview, a build output cleaned
 *  under an open row. The ONE git/fs failure every reader branches on: the
 *  client's `BrowseFileDispatcher` swallows it (matching the old value stream,
 *  which simply stopped yielding), where any other failure is a visible error
 *  over a file the user merely deleted.
 *
 *  Successor of `unwrapGit`'s `FILE_GONE → ORPCError("NOT_FOUND")` mapping.
 *  It stays a DECLARED error rather than becoming a defect precisely because
 *  it is the branch point — the regression this classification exists for
 *  (`filePreviewTag` relying on errno text surviving into a message) lived in
 *  exactly that seam. */
export class FileGone extends Schema.TaggedError<FileGone>("padi/FileGone")(
  "FileGone",
  { path: Schema.String },
) {
  override get message(): string {
    return `Not found: ${this.path}`;
  }
}

/** A worktree create refused because its base branch does not exist.
 *  Successor of `unwrapGit`'s `BASE_BRANCH_NOT_FOUND →
 *  ORPCError("PRECONDITION_FAILED")`; actionable (pick another base), so
 *  declared. */
export class WorktreeBaseBranchMissing extends Schema.TaggedError<WorktreeBaseBranchMissing>(
  "padi/WorktreeBaseBranchMissing",
)("WorktreeBaseBranchMissing", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/** A worktree create refused because the name is already taken. Successor of
 *  `unwrapGit`'s `WORKTREE_NAME_COLLISION → ORPCError("CONFLICT")`; actionable
 *  (pick another name), so declared. */
export class WorktreeNameCollision extends Schema.TaggedError<WorktreeNameCollision>(
  "padi/WorktreeNameCollision",
)("WorktreeNameCollision", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/** Git itself failed — the command errored, the path is not a repository, or a
 *  resolved path escaped its root.
 *
 *  THREE `GitResult` codes collapse here (`GIT_FAILED`, `NOT_A_REPO`,
 *  `PATH_ESCAPES_ROOT`) because all three already spelled ONE wire code
 *  (`INTERNAL_SERVER_ERROR`) and were indistinguishable to every consumer —
 *  folding them preserves exactly today's distinguishability rather than
 *  minting discriminants nobody branches on.
 *
 *  It is DECLARED rather than left a defect for one reason: `unwrapGit` exists
 *  so a git error SURFACES with its message instead of collapsing to an empty
 *  result, and that message is what the user reads in the toast. A defect
 *  would keep the fail-fast property but lose the sentence. */
export class GitFailed extends Schema.TaggedError<GitFailed>("padi/GitFailed")(
  "GitFailed",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

// ── Declared unions, per member family ────────────────────────────────────
//
// A `ProcedureSpec.error` is ONE schema, so each family's union is named once
// here and referenced by every member that raises it. Naming them here (rather
// than inlining a `Schema.Union` per member in `surface.ts`) is what keeps
// "which members can fail how" a single readable table.

/** Every fs/git READ can hit a gone file or a git failure. */
export const FsGitReadErrorSchema = Schema.Union([FileGone, GitFailed]);

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
] as const;

/** The whole padi error vocabulary, as one closed union — the value a consumer
 *  decodes an unknown padi failure against, and the list a new member must be
 *  added to deliberately. */
export const PadiErrorSchema = Schema.Union([...PADI_ERROR_CLASSES]);
export type PadiError = typeof PadiErrorSchema.Type;

/** Is `err` one of the DECLARED failures above?
 *
 *  The predicate padi's SERVING seam (`servePadi.ts`'s one handler bridge) uses
 *  to route a THROWN value onto the Effect FAILURE channel rather than the
 *  defect channel — the single place D4's "declared vs defect" line is drawn
 *  for every procedure, instead of once per member.
 *
 *  `instanceof`, deliberately, and sound at the one place it runs: the value was
 *  constructed by padi's own in-process code moments earlier, in this module
 *  realm. A value that CROSSED a wire is narrowed STRUCTURALLY on its `_tag`
 *  instead (see `terminalEndpoint/reattachingDeltas.ts`), because there the
 *  class identity genuinely may differ. */
export function isPadiDeclaredError(err: unknown): err is PadiError {
  return PADI_ERROR_CLASSES.some((Cls) => err instanceof Cls);
}
