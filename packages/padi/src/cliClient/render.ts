/**
 * Pure rendering helpers for padi's CLI faces — no I/O, no transport, no tty — so
 * the formatting is unit-tested without a socket or a terminal. Each CLI's `main`
 * is the thin glue that reads padi's `terminals` collection and prints these.
 * Shared here (beside the dial kit) because padi-tui and kolu's CLI render the
 * SAME table from the same records; a second copy would be a second truth.
 *
 * Not only VIEWS: `parsePlacementFlags` is here for the same reason and on the
 * same terms — pure, no I/O, and shared because both faces must answer one
 * question identically. The line this module draws is "does it need a socket or
 * a tty?", not "is it formatting?"; a flag pair read down to the placement it
 * means is as much a pure fold as the roster table is, and leaving it to each
 * `main` is exactly the second truth the paragraph above refuses.
 *
 * These views show what each terminal *is in* — its record state (active ·
 * sleeping · parked) · repo·branch · PR + checks · agent state · foreground —
 * read off padi's composed `terminals` collection (the same record the canvas
 * Dock reads). The `wait` verb compares the agent's coarse BUCKET
 * (`agentBucket`), never the raw `AgentInfo['state']`, so the one fold in
 * `@kolu/terminal-vocab/agentProjection` stays the single source of truth.
 */

// `../terminalVocab.ts`, NOT `./dial.ts`. The three symbols are the same ones —
// `dial.ts` merely re-exports them — but reaching them through the dial kit put
// `socketDuplexLink`, `@kolu/surface-daemon-supervisor`, `@kolu/surface-remote`
// and `kolu-pty` in this formatter's module graph, refuting the "no I/O, no
// transport, no tty" promise on line 1. A stated invariant the import graph
// contradicts will be relied on and will break.
// A VALUE import from `../surface.ts`, and the line the header draws still
// holds: the promise is "no I/O, no transport, no tty", and the graph that broke
// it was the DIAL kit's (`socketDuplexLink`, the supervisor, `kolu-pty`).
// `surface.ts` is schemas and a spec — browser-safe by contract, since the
// client imports it — and the wire's own literal set is the only honest place to
// read a wire column's width from.
import {
  type PadiStateEvent,
  type PadiTerminal,
  WATCH_STATE_EVENT_KINDS,
} from "../surface.ts";
import { activeAgent } from "../terminalVocab.ts";
import {
  agentBucket,
  agentShortName,
  agentStatusLabel,
  DASH,
  relativeTime,
  WAIT_STATES,
} from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import columnify from "columnify";

/** How many leading chars of a terminal id the human views show. v4 UUIDs
 *  collide with vanishing probability across the handful one runs; `--json`
 *  keeps the full id. */
export const SHORT_ID_LEN = 8;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

/** "You did not say where the terminal goes" — the CLI-flag spelling of the
 *  wire's `PLACEMENT_REQUIRED`.
 *
 *  `command` is the only difference between the two faces' sentences, so it is
 *  the only thing {@link parsePlacementFlags} passes. It names BOTH flags,
 *  because the failure mode is a caller who did not know there was a choice —
 *  "missing required flag" sends a script author hunting for a typo — and it
 *  ends with the migration, in the one word it costs, because a script that
 *  breaks at 2am is not going to find the changelog. */
function placementRequiredMessage(command: string): string {
  return `${command} must state WHERE the terminal goes — pass exactly one of --toplevel (a tile of its own) or --parent <id> (a split inside that terminal). There is no default: the canvas and the Dock read a terminal's parent as who-works-for-whom, so a guessed placement silently flattens the hierarchy. A script that used to say \`${command}\` means \`${command} --toplevel\`.`;
}

/** …and "you said both". Not a precedence question with a quiet winner — the
 *  two flags are contradictory claims about one terminal, and picking one would
 *  BE the silent decision the pair exists to delete. Face-independent, so unlike
 *  {@link placementRequiredMessage} it needs no command name. */
const PLACEMENT_FLAGS_EXCLUSIVE =
  "--toplevel and --parent are mutually exclusive: a terminal is either a tile of its own or a split inside exactly one parent, never both. Pass exactly one.";

/** …and "you spelled --parent but named nothing". Face-independent for the same
 *  reason as the sentence above: it names only the flags. It says which of the two
 *  fixes applies, because an unset variable and a genuine change of mind want
 *  opposite repairs. */
const PLACEMENT_PARENT_BLANK =
  "--parent was passed with an empty value — an unset shell variable, most likely. It names the terminal to split, and an empty string is not an id: pass the parent's id (any unique prefix), or use --toplevel if you meant a tile of its own.";

/** A flag the user SPELLED but left EMPTY — `--parent "$ID"` with `$ID` unset,
 *  the ordinary shell accident. ONE predicate, so every gate on either CLI face
 *  agrees on what blank IS: whitespace counts, because `--parent " "` is the same
 *  accident with a quoted space. `kolu-cli`'s `exit.ts` re-exports it. */
export const isBlank = (value: string): boolean => value.trim() === "";

/** WHERE ON THE CANVAS a create lands, as the CLI FLAGS spell it — the two arms
 *  that are a STATEMENT. The `child-of` arm carries the RAW `--parent` query
 *  rather than a `TerminalId`, because a user hands either CLI any unique prefix
 *  and widening it needs the live roster, which needs the dial. So the ARM is
 *  decided purely, before a `--host` can provision a cold box for a command that
 *  was never going to run; only the id inside it is resolved on the far side. */
export type StatedPlacementFlags =
  | { readonly kind: "toplevel" }
  | { readonly kind: "child-of"; readonly parentQuery: string };

/** …and the third arm, which is what the parse returns when the pair does not
 *  amount to a statement. A value, not a throw or an `Effect`: the two faces
 *  fail on different error types (`kolu`'s `CliFailure`, `padi-tui`'s own), and
 *  keeping the parse plain data is what lets them share the DECISION while each
 *  keeps its own way of failing. */
export type PlacementFlagsRead =
  | StatedPlacementFlags
  | { readonly kind: "refused"; readonly message: string };

/** Read the `--toplevel` / `--parent` pair down into the one thing it means —
 *  the ONE authority on the CLI-flag half of the no-default rule.
 *
 *  Both padi CLI faces carry this verb and must answer it identically, so the
 *  branch lives here rather than in each `main`: sharing only the two sentences
 *  above (as this did at first) leaves the DECISION hand-written twice, free to
 *  drift on the next edit — a reordered check, a third flag, a differently
 *  handled `--parent ""` — with nothing structural noticing. That drift is the
 *  same class of defect the whole no-default rule exists to delete, one layer up:
 *  two faces quietly disagreeing about what a create meant.
 *
 *  Both flags is the exclusion refusal, neither is the required refusal, and each
 *  alone is its arm. Pure, so it is unit-tested without a socket and both faces'
 *  gates run before their dial.
 *
 *  A BLANK `--parent` is refused here rather than treated as a statement. `--parent
 *  "$ID"` with `$ID` unset is not a caller who chose the `child-of` arm; it is a
 *  variable that did not expand, and an empty string is not an id. Left as a
 *  statement it reached the far side and failed only after the dial — so `padi-tui
 *  create --parent ""` over `--host` would Nix-provision a cold box for a command
 *  that was never going to run. `kolu create` never showed this, because its own
 *  `refuseBlankFlags` fires first with a per-flag sentence; that gate still wins
 *  there and its message is unchanged, which leaves this branch unreachable on that
 *  face and load-bearing on the other. A shared parse has to be right on its own. */
export function parsePlacementFlags(
  command: string,
  flags: { readonly toplevel: boolean; readonly parent: string | undefined },
): PlacementFlagsRead {
  const { toplevel, parent } = flags;
  if (toplevel && parent !== undefined)
    return { kind: "refused", message: PLACEMENT_FLAGS_EXCLUSIVE };
  if (toplevel) return { kind: "toplevel" };
  if (parent !== undefined) {
    return isBlank(parent)
      ? { kind: "refused", message: PLACEMENT_PARENT_BLANK }
      : { kind: "child-of", parentQuery: parent };
  }
  return { kind: "refused", message: placementRequiredMessage(command) };
}

/** The live foreground process of a composed record, or `null` — active-only,
 *  same as `activeAgent` (which now lives in the dial kit's watch module,
 *  beside the wait predicate it feeds). */
function activeForeground(v: PadiTerminal): { name: string } | null {
  return v.state === "active" ? v.foreground : null;
}

/** The outcome of resolving a user-typed id-or-prefix against the live ids —
 *  pure, so the decision is unit-tested apart from the `fail()`/exit the CLI glue
 *  maps it to. Mirrors kaval-tui's `resolveTerminalId`. */
export type ResolveResult =
  | { kind: "found"; id: TerminalId }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: TerminalId[] };

/** Resolve a user-supplied id-or-prefix to a single full terminal id against the
 *  live `terminals` keys. A full id is a prefix of itself, so a pasted full id
 *  keeps resolving to itself. Matching is case-insensitive — UUIDs are lowercase
 *  hex, but a hand-typed/pasted upper-case prefix should still land. Zero matches
 *  → `none`; more than one → `ambiguous` with the full ids so the caller can ask
 *  for more chars. */
export function resolveTerminalId(
  query: string,
  ids: readonly TerminalId[],
): ResolveResult {
  // An empty query is a prefix of EVERY id, so with one live terminal it would
  // silently resolve to it — a wrong-terminal footgun when `$id` is accidentally
  // empty. Reject it as a no-match so the caller fails loud instead.
  if (query === "") return { kind: "none" };
  const q = query.toLowerCase();
  const exact = ids.find((id) => id.toLowerCase() === q);
  if (exact !== undefined) return { kind: "found", id: exact };
  const matches = ids.filter((id) => id.toLowerCase().startsWith(q));
  const [first, ...rest] = matches;
  if (first === undefined) return { kind: "none" };
  if (rest.length > 0) return { kind: "ambiguous", matches };
  return { kind: "found", id: first };
}

// `parseUntilStates` used to live here: the comma split, plus a `--until:`-
// prefixed error string, inside a module that renders. `watch.ts`'s header states
// the rule it broke — "the CLI-flag grammar (`--until`'s comma parse and its
// error strings) stays in the face; only the surface-shaped vocabulary and the
// watch/wait machinery live here" — and the tell was that its one caller THREW
// the returned message away and re-spelled it, because a padi-side error cannot
// name the three `--until` FORMS a CLI user needs. What padi owns is
// `isWaitState` (`terminalVocab.ts`): whether a token is a bucket, and nothing
// about commas.

/** The last `tail` lines of a rendered screen, with the trailing run of
 *  whitespace-only rows dropped first.
 *
 *  A pure fold over `screen.text`'s output, and it lives beside padi's other
 *  formatters because the rule it encodes is about padi's REPLY: the rendered
 *  buffer ends in the empty viewport below the cursor, which carries zero
 *  information and would otherwise BE the tail (`tail: 6` on a fresh shell
 *  returned six blank lines — a real bug, caught on the MCP face). Blank lines
 *  BETWEEN content are kept verbatim.
 *
 *  It was `kolu-mcp/screenText`'s until `kolu snapshot --tail` became its second
 *  consumer and imported it from there — a CLI verb reaching sideways into a
 *  sibling FACE's adapter for domain knowledge, which also made `cli.ts`'s
 *  per-face fence claim false (a terminal verb was building an MCP argument
 *  schema at module load). Both faces now import it from the package that owns
 *  the reply it folds. */
export function tailLines(text: string, tail: number): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] as string).trim() === "") end -= 1;
  return lines.slice(Math.max(0, end - tail), end).join("\n");
}

/** Strip terminal-hostile bytes from a human-rendered value. A shell can set its
 *  title / process name / branch to anything (newlines, raw ESC), so painting
 *  them verbatim could break the column layout or inject control effects. JSON
 *  output stays raw (`JSON.stringify` escapes controls); this is human-only. */
export function sanitize(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

function orDash(value: string | null | undefined): string {
  return value ? sanitize(value) || DASH : DASH;
}

/** `repo·branch` from the raw repo/branch source — each half sanitized (repo
 *  names come from fs paths, branches from git, so both can carry control bytes),
 *  or a dash when the terminal isn't in a git repo (both `null`). */
function repoBranchText(
  repoName: string | null,
  branch: string | null,
): string {
  return repoName === null && branch === null
    ? DASH
    : `${orDash(repoName)}·${orDash(branch)}`;
}

/** The agent · state cell — `claude · working`, or a dash when no agent runs. */
function agentValue(agent: AgentInfo | null): string {
  if (!agent) return DASH;
  return `${agentShortName(agent.kind)} · ${agentStatusLabel(agent.state)}`;
}

/** The check status of an already-resolved PR — the resolved checks with `null`
 *  (no checks configured) folded to `pending`. */
function prChecks(
  checks: Extract<PadiTerminal["pr"], { kind: "ok" }>["value"]["checks"],
): "pass" | "fail" | "pending" {
  switch (checks) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "pending":
    case null:
      return "pending";
    default: {
      const _exhaustive: never = checks;
      return _exhaustive;
    }
  }
}

/** The PR resolution, every arm: `#<n> <state> <✓/✗/·>` when resolved, the
 *  pending/absent/unsupported/unavailable kind (with the failure code) otherwise. */
function prValueText(pr: PadiTerminal["pr"]): string {
  switch (pr.kind) {
    case "ok": {
      const { number, state } = pr.value;
      const checks = prChecks(pr.value.checks);
      const glyph = checks === "pass" ? "✓" : checks === "fail" ? "✗" : "·";
      return `#${number} ${state} ${glyph}`;
    }
    case "pending":
      return "pending";
    case "absent":
    case "unsupported":
      return DASH;
    case "unavailable":
      return `unavailable: ${pr.source.code}`;
    default: {
      const _exhaustive: never = pr;
      return _exhaustive;
    }
  }
}

/** Render the `status` table — one row per terminal, columns auto-sized by
 *  `columnify` (the borderless, space-aligned `docker ps` style kaval-tui's
 *  `list` uses). Sorted by id for a stable display. Empty inventory gets an
 *  honest one-liner, not a bare header. The STATE column names the record arm
 *  (active · sleeping · parked) — padi serves dormant records too, unlike the
 *  retired pulam daemon's awareness snapshot. */
export function formatStatus(
  entries: Array<[TerminalId, PadiTerminal]>,
): string {
  if (entries.length === 0) return "no terminals.";
  const rows = [...entries]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, v]) => ({
      ID: shortId(id),
      STATE: v.state,
      REPO·BRANCH: repoBranchText(
        v.git?.repoName ?? null,
        v.git?.branch ?? null,
      ),
      PR: prValueText(v.pr),
      AGENT: agentValue(activeAgent(v)),
      FOREGROUND: orDash(activeForeground(v)?.name),
    }));
  return columnify(rows, {
    columns: ["ID", "STATE", "REPO·BRANCH", "PR", "AGENT", "FOREGROUND"],
    columnSplitter: "  ",
  })
    .split("\n")
    .map((row) => row.trimEnd())
    .join("\n");
}

/** `status --json` — a top-level array of `{ id, ...record }`, 2-space indented,
 *  full ids, controls JSON-escaped (so `jq '.[]'` works). The complete raw
 *  composed record, including the deep fields the table doesn't break out. */
export function formatStatusJson(
  entries: Array<[TerminalId, PadiTerminal]>,
): string {
  return JSON.stringify(
    entries.map(([id, value]) => ({ id, ...value })),
    null,
    2,
  );
}

/** The `wait` success trailer (stderr) — `a1b2c3d4 reached awaiting · claude
 *  awaiting_user`: the short id, the bucket it landed in (the shared `agentBucket`
 *  fold), and the agent's short name + raw state for the detail. `--json` emits
 *  the full `{ id, agent }` instead. */
export function formatWaitMet(id: TerminalId, agent: AgentInfo): string {
  return `${shortId(id)} reached ${agentBucket(agent.state)} · ${agentShortName(agent.kind)} ${agentStatusLabel(agent.state)}`;
}

/** A wall-clock `HH:MM:SS` stamp for a `watch` line, in local time — the live
 *  feed wants "when did this happen", not a relative age. */
function clockTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

/** One `watch` event as a human line: `HH:MM:SS  <id>  <state>  <repo·branch>
 *  <agent · state>  [●]`, the trailing `●` present only when the terminal is
 *  moving bytes right now (the `activity` live dot). `now` is the wall clock at
 *  emit; `live` is annotation, not its own event (see `watchTerminals`). */
export function formatWatchEvent(
  id: TerminalId,
  v: PadiTerminal,
  opts: { now: number; live: boolean },
): string {
  const where = repoBranchText(v.git?.repoName ?? null, v.git?.branch ?? null);
  const cells = [
    clockTime(opts.now),
    shortId(id),
    v.state,
    where,
    agentValue(activeAgent(v)),
  ];
  if (opts.live) cells.push("●");
  return cells.join("  ");
}

/** A terminal leaving the collection (its kaval PTY ended) as a human line. */
export function formatWatchRemoval(
  id: TerminalId,
  opts: { now: number },
): string {
  return `${clockTime(opts.now)}  ${shortId(id)}  (gone)`;
}

/** A live-byte-activity transition as a human line: `HH:MM:SS  <id>  ● busy` when
 *  a terminal starts moving bytes, `○ idle` when it goes quiet — the `activity`
 *  stream surfaced on its own line (the daemon-side twin of the browser green
 *  dot's on/off). */
export function formatWatchActivity(
  id: TerminalId,
  live: boolean,
  opts: { now: number },
): string {
  return `${clockTime(opts.now)}  ${shortId(id)}  ${live ? "● busy" : "○ idle"}`;
}

/** Every `kind` the CHANGE tail can print — the vocabulary this module INVENTS
 *  (unlike {@link WATCH_STATE_EVENT_KINDS}, which is padi's own wire spelling).
 *  An array rather than three bare literals at three unrelated call sites: it is
 *  half of what a consumer's `jq` switch must know, and the three sites had no
 *  way to disagree loudly. */
export const WATCH_CHANGE_EVENT_KINDS = [
  "terminal",
  "removed",
  "activity",
] as const;

export function formatWatchActivityJson(id: TerminalId, live: boolean): string {
  return JSON.stringify({
    kind: "activity" satisfies WatchFeedKind,
    id,
    activity: live,
  });
}

/** `watch --json` — one JSON object per line (NDJSON, so `jq -c` streams it): the
 *  full raw record plus the live flag and the full terminal id. The `id` key
 *  matches `status --json`.
 *
 *  EVERY line carries a `kind`, whichever feed produced it — the whole
 *  vocabulary is {@link WATCH_FEED_KINDS}. A consumer must be able to tell the
 *  two feeds apart by reading a line, not by inspecting the argv that produced
 *  it or probing for which key happens to be present. */
export function formatWatchJson(
  id: TerminalId,
  v: PadiTerminal,
  opts: { live: boolean },
): string {
  return JSON.stringify({
    kind: "terminal" satisfies WatchFeedKind,
    id,
    live: opts.live,
    ...v,
  });
}

export function formatWatchRemovalJson(id: TerminalId): string {
  return JSON.stringify({ kind: "removed" satisfies WatchFeedKind, id });
}

/** One agent-STATE event as an NDJSON line — the wire event, verbatim.
 *
 *  It looks like a wrapper around `JSON.stringify` and it is one on purpose: the
 *  `--json` contract ("every line carries a `kind`") is stated here, and three
 *  of its six kinds are enforced by the functions above ADDING that key. If the
 *  other three were stringified at the call site, the contract would hold only
 *  because the wire event happens to carry a field of that name — no owner, and
 *  nothing to fail if `kind` were ever renamed or nested. Naming the projection
 *  puts all six lines in one module, where the pins can see them.
 *
 *  Verbatim because the event already IS the line: re-shaping it would invent a
 *  second spelling of padi's own answer for a consumer's `jq` to learn. */
export function formatStateEventJson(event: PadiStateEvent): string {
  return JSON.stringify(event satisfies { kind: WatchFeedKind });
}

/** One agent-STATE event as a human line:
 *  `HH:MM:SS  a1b2c3d4  nag         waiting   7m  fix the parser` — the clock,
 *  the short id, WHY you are being told (snapshot · transition · nag), the bucket
 *  it is holding, HOW LONG it has held it, and its intent when it has one.
 *
 *  The hold is the column that matters and the reason it is rendered rather than
 *  left to the reader: a supervision line's whole job is to distinguish "just
 *  finished" from "has been sitting there for forty minutes", and two epochs a
 *  reader has to subtract do not do that at 3am. It is the SHARED
 *  `relativeTime` fold, the same `3s`/`5m`/`2h` spelling every other kolu
 *  surface ages a timestamp with.
 *
 *  `intent` is the only wire field beyond the event's own vocabulary that lands
 *  here, and it earns the width: a short id names a terminal a human cannot
 *  identify, and the intent is what its owner wrote down about it. Nothing else
 *  from the record is joined in — the event stays thin, and a reader who wants
 *  the repo, the branch or the screen has `kolu ls` and `kolu snapshot`. */
const widestOf = (words: readonly string[]): number =>
  words.reduce((w, s) => Math.max(w, s.length), 0);
/** Every `kind` a `kolu watch --json` line can carry, both feeds and the pulse:
 *  padi's state-event kinds, the change tail's, and this face's own liveness
 *  line — which is not a terminal event but IS a line on the same stream. ONE
 *  array, so the column width, every NDJSON literal above and a consumer's `jq`
 *  switch cannot disagree — the same reason {@link WATCH_STATE_EVENT_KINDS} is
 *  an array and not a bare literal union. */
export const WATCH_FEED_KINDS = [
  ...WATCH_STATE_EVENT_KINDS,
  ...WATCH_CHANGE_EVENT_KINDS,
  "heartbeat",
] as const;

/** One line's `kind`, whichever feed produced it — what every `--json` writer
 *  above declares itself against. */
export type WatchFeedKind = (typeof WATCH_FEED_KINDS)[number];

// The supervision table's kind column, measured over the WHOLE vocabulary: the
// change tail has no such column, so the only cost of measuring it too is that
// a widened change kind would widen a column it never appears in — and the one
// thing that must not happen (a running feed silently misaligning) still cannot.
const KIND_WIDTH = widestOf(WATCH_FEED_KINDS);
const STATE_WIDTH = widestOf(WAIT_STATES);

export function formatStateEvent(event: PadiStateEvent): string {
  const cells = [
    clockTime(event.at),
    shortId(event.id),
    // Both vocabularies are closed sets, so the columns line up without
    // measuring the feed — which is what a reader scanning it at 3am is actually
    // using. The widths are DERIVED from those sets rather than from a
    // hand-picked exemplar string: a fourth kind or a fourth bucket then widens
    // the column instead of silently misaligning a running feed.
    event.kind.padEnd(KIND_WIDTH),
    event.state.padEnd(STATE_WIDTH),
    relativeTime(event.since, event.at),
  ];
  if (event.intent !== undefined) cells.push(event.intent);
  return cells.join("  ");
}

/** A CLI-only alive line: silence on a held stdout is otherwise unfalsifiable
 *  (stream-dead and process-frozen look the same). Not a padi event — MCP's
 *  `watch_next` already has `timeoutMs` for the same question. */
export function formatHeartbeat(at: number): string {
  // The short-id column is BLANK, not skipped: a two-cell line on a five-cell
  // table puts the word "heartbeat" where every neighbour has an id, which is
  // exactly the misalignment the derived widths above exist to prevent. Blank
  // keeps "no terminal on it" a structural fact rather than a documented habit.
  return [clockTime(at), " ".repeat(SHORT_ID_LEN), "heartbeat"].join("  ");
}

export function formatHeartbeatJson(at: number): string {
  return JSON.stringify({
    kind: "heartbeat" satisfies WatchFeedKind,
    at,
  });
}
