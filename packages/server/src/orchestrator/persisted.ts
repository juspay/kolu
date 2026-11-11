/**
 * WHAT SURVIVES A kolu-server RESTART about the one conversation.
 *
 * kolu-server is restarted on every upgrade, so a restart is the NORMAL path
 * rather than a crash recovery: a person who was mid-conversation when a new
 * kolu landed should come back to the same conversation, not to an empty panel
 * with a sentence about why. That makes resume the default and this record the
 * thing that makes it possible.
 *
 * WHAT IS HERE, and why each of the four:
 *
 *  - `sessionId` — the agent's own id for the conversation, replayed with
 *    `session/load`. It means nothing to any other agent, so a stored id is
 *    only ever handed back to the agent that minted it.
 *  - `cwd` — the directory the session was opened in. It is what makes a stored
 *    session findable at all (Claude scopes its store by prefix), so a
 *    kolu-server whose `$HOME` moved must open a fresh session rather than ask
 *    for one the agent will refuse.
 *  - `model` — the model a person CHOSE. The agent re-asserts its own default
 *    over a resumed conversation's model (`ANTHROPIC_MODEL`, then
 *    `settings.json`, then what the conversation was running), so a choice made
 *    here is the half that loses unless it is re-applied. Only a switch kolu
 *    SAW is remembered: a conversation that never left the machine's default
 *    comes back on the machine's default, because pinning a conversation to
 *    whatever the default resolved to that day would be inventing a choice
 *    nobody made.
 *  - `rows` — the transcript. The agent replays its own messages on
 *    `session/load`, but it replays the CONVERSATION, not kolu's reading of it:
 *    the kolu-aware tool cards, the background-task lanes, the notices this
 *    panel wrote about itself. Those are ours and they are only here.
 *  - `fleet` — which terminals this conversation has touched, as FLEET REFS
 *    (`host/id`). Membership only; every live fact about those terminals is
 *    read from that host's `terminals` collection, so a stale row cannot
 *    outlive the terminal it names.
 *
 * WHAT IS DELIBERATELY NOT HERE: the phase, the usage, the roster, the open
 * asks, the sign-in attempt. Every one of them is a fact about a subprocess
 * that no longer exists, and a restored one would be a lie with a timestamp on
 * it. They come back from the live agent or they do not come back.
 */

import {
  type OrchestratorRow,
  OrchestratorRowSchema,
  type OrchestratorState,
} from "kolu-common/orchestrator";
import type { CellStore } from "@kolu/surface/server";
import { Result, Schema } from "effect";

/** The record's SHAPE, as a schema rather than as an interface alone.
 *
 *  `confStore` hands back whatever is on disk under a cast — it decodes
 *  nothing — so without this the orchestrator would restore a hand-edited (or
 *  half-written) `orchestrator` key straight into a served cell and a replayed
 *  transcript, and the first thing to notice would be a row the panel cannot
 *  draw. Re-validated where it is READ ({@link readPersistedOrchestrator}),
 *  exactly as `getPersistedHosts` re-validates the server's `hosts` key: a
 *  parseable-but-invalid value is REFUSED loud, never normalized away and
 *  never collapsed to an empty conversation.
 *
 *  `rows` is the WIRE row on the `koluSurface` ladder, read back off a file on
 *  the kolu-server `SCHEMA_VERSION` one — so the first NON-ADDITIVE change to
 *  `OrchestratorRowSchema` owes that ladder a rung DROPPING
 *  `orchestrator.rows` ({@link ROW_CAP} bounds what is lost); nothing else can
 *  repair a file this schema no longer decodes. */
export const PersistedOrchestratorSchema = Schema.Struct({
  sessionId: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  model: Schema.NullOr(Schema.String),
  rows: Schema.Array(OrchestratorRowSchema),
  /** Fleet refs (`<encodedHostKey>/<terminalId>`), not bare ids — one
   *  conversation spans every host, and a bare id would name two terminals on
   *  a two-host fleet. */
  fleet: Schema.Array(Schema.String),
});

/** The record as a value. Derived from the schema rather than declared beside
 *  it, so the two cannot drift into disagreeing about what is on disk. */
export type PersistedOrchestrator = typeof PersistedOrchestratorSchema.Type;

/** An untouched state dir's record: no conversation, nothing to resume. */
export const EMPTY_PERSISTED_ORCHESTRATOR: PersistedOrchestrator = {
  sessionId: null,
  cwd: "",
  model: null,
  rows: [],
  fleet: [],
};

/** The re-validation, compiled once. `decodeUnknownResult` is a BRANCH rather
 *  than a throw, which is what lets the failure arm name the FILE — the one
 *  thing a person holding a corrupt state file has to act on. */
const decodePersisted = Schema.decodeUnknownResult(PersistedOrchestratorSchema);

/** Read the remembered conversation out of kolu-server's state, or CRASH naming
 *  the file.
 *
 *  There is no recovery arm on purpose. The two silent alternatives are both
 *  worse than a loud stop: dropping the offending rows would hand a person a
 *  transcript with holes in it and no way to know, and starting empty would
 *  throw away a conversation that is still on disk and still readable by hand.
 *  `conf` itself is fail-fast about an UNPARSEABLE file; this is the
 *  parseable-but-wrong case it cannot see. */
export function readPersistedOrchestrator(
  store: CellStore<PersistedOrchestrator>,
  path: string,
): PersistedOrchestrator {
  const result = decodePersisted(store.get());
  if (Result.isFailure(result)) {
    throw new Error(
      `the remembered orchestrator in ${path} does not match schema (${String(result.failure)}). Fix the \`orchestrator\` key to recover.`,
    );
  }
  const record = result.success;
  return { ...record, rows: oneDividerPerReset(record.rows) };
}

/** Collapse every RUN of consecutive dividers to the first of them.
 *
 *  A divider means one thing — the agent's memory was reset — so a run of
 *  four in a row cannot be four resets with nothing between them: it is one
 *  reset written four times, by however many bring-ups wrote it. The first is
 *  the one kept, because the reset happened at the first; keeping the last
 *  would draw the line later than the event it marks.
 *
 *  On the READ rather than only at the writer, and deliberately: the records
 *  already on disk carry the runs, and a fix that only stopped new ones from
 *  being written would leave every state file that saw the bug showing them
 *  forever. `rows` arrives in `seq` order ({@link persistedFrom} writes the
 *  host's sorted array), so "consecutive" is a neighbour test and not a sort. */
function oneDividerPerReset(
  rows: ReadonlyArray<OrchestratorRow>,
): ReadonlyArray<OrchestratorRow> {
  const kept: OrchestratorRow[] = [];
  let previousWasDivider = false;
  for (const row of rows) {
    const divider = row.kind === "divider";
    if (!(divider && previousWasDivider)) kept.push(row);
    previousWasDivider = divider;
  }
  return kept.length === rows.length ? rows : kept;
}

/** What to write back after the conversation moved.
 *
 *  Derived from the live state and rows rather than accumulated beside them,
 *  so the record cannot disagree with what a reader is looking at. The row
 *  cap is a bound on the FILE, not on the panel: a conversation that has run
 *  for a week is still whole in memory, and what a restart brings back is its
 *  tail — which is the half a person scrolls to anyway.
 *
 *  THE ROWS GO THROUGH UNTOUCHED, attachments included, because an attachment
 *  carries no bytes to strip: it is a name, a size and the path kolu-server
 *  wrote the file to. A row restored from here is therefore the same value it
 *  was when it was minted — which is what makes "send again" on an hour-old
 *  message read the same file the first send did. The thumbnail is the only
 *  thing that does not survive, and it never left the browser that drew it. */
export function persistedFrom(
  state: OrchestratorState,
  rows: ReadonlyArray<OrchestratorRow>,
): PersistedOrchestrator {
  return {
    sessionId: state.sessionId,
    cwd: state.cwd,
    model: state.model?.id ?? null,
    rows: rows.length > ROW_CAP ? rows.slice(rows.length - ROW_CAP) : rows,
    fleet: state.fleet,
  };
}

/** How many transcript rows the state file keeps.
 *
 *  Chosen for the file rather than for the screen: kolu-server's `config.json`
 *  holds the host map and the preferences beside this, and a conversation that
 *  has made two thousand tool calls would otherwise make every read of that
 *  file pay for scrollback nobody asked for. */
const ROW_CAP = 400;
