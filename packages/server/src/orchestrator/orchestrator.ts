/**
 * KOLU'S ONE CONVERSATION — the Orchestrator, hosted by kolu-server.
 *
 * kolu-server owns exactly one ACP conversation: it spawns the adapter, holds
 * the session, keeps the transcript, persists enough of it to come back, and
 * serves the whole of it as `koluSurface`'s `orchestrator` cell, the
 * `orchestratorTranscript` stream and the `orchestrator` procedures.
 *
 * ## Why kolu-server and not padi
 *
 * The conversation's hands are EVERY host's terminals. A supervisor that could
 * only see the box it happens to run on is not a supervisor of a fleet: it
 * would have to be started once per host, taught once per host, and watched
 * once per host, and no one of its copies could ever answer "which agent needs
 * me". kolu-server is the one process that already mirrors every padi over
 * ssh, so it is the only place a single conversation can reach all of them.
 * Its hands are the FLEET MCP FACE — kolu's own MCP expose map lifted over the
 * host map, served in-process on a loopback listener — and every terminal it
 * names is `host/id`.
 *
 * padi, in exchange, goes back to knowing only its own terminals.
 *
 * ## It starts when somebody looks
 *
 * The adapter is a real Claude subprocess, and a kolu nobody has opened should
 * not be running one. So the conversation is brought up by the first READER —
 * the first transcript subscription or the first procedure call — and then
 * kept for the process's life. That is not a lazy-init convenience: it is what
 * makes a server nobody is watching cost nothing, while a server somebody
 * actually opens has its conversation back (with `session/load`) before they
 * have finished reading the first screen.
 *
 * The REMEMBERED record is read on that same edge, not at construction. This
 * module is built by the first caller of `live.ts`, which may run before the
 * surface ctx exists (and never has a ctx at all in a unit test), so a read at
 * construction would be a crash in every test that assembles the surface.
 * Nothing is lost by waiting: the first reader is the first moment the record
 * can be shown to anybody.
 *
 * The persisted rows are served BEFORE the agent is up, which is why the
 * stream's first snapshot never waits on a handshake: a restart shows the
 * conversation you were in, and the live agent arrives underneath it.
 *
 * ## The restart fence
 *
 * Our rows are AUTHORITATIVE across a restart, and the agent's replay is not.
 * `session/load` replays the agent's own messages, but a kolu transcript is
 * more than that — the kolu-aware tool cards, the background-task lanes, the
 * notices this panel wrote about itself — so dropping what we hold in favour
 * of the replay would lose the richer half. What makes the two survivable side
 * by side is `resumedSeq`: the harness mints its ids and ordering numbers
 * STARTING AFTER the highest one we already hold, so a row the new process
 * emits can neither collide with a persisted id nor sort above a persisted
 * row.
 *
 * ## Absent is absent
 *
 * The ACP adapter is baked into kolu's closure (`KOLU_ACP_AGENT`), so its
 * absence is a broken build rather than a configuration a person chose. There
 * is no fallback path and no knob: the cell carries the integration's own
 * sentence and every procedure refuses with it. The fleet MCP endpoint is
 * held to the same rule, and proved rather than trusted — see
 * {@link OrchestratorDeps.fleetMcp}.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, sep } from "node:path";
import { ORCHESTRATOR_ENGINE as ENGINE } from "kolu-agents/acp";
import type { NotHere } from "@kolu/acp/engine";
import {
  type Harness,
  type HarnessOptions,
  HarnessRefused,
  HarnessUnavailable,
  type HttpServer,
} from "@kolu/acp-harness";
import {
  appendedText,
  ATTACHMENT_BYTE_CAP,
  attachmentGone,
  attachmentTooBig,
  DEFAULT_ORCHESTRATOR_STATE,
  type OrchestratorAttachment,
  type OrchestratorFrame,
  type OrchestratorRow,
  type OrchestratorState,
  PROMPT_ATTACHMENT_BYTE_CAP,
  promptAttachmentsTooBig,
} from "kolu-common/orchestrator";
import {
  OrchestratorRefused,
  OrchestratorUnavailable,
} from "kolu-common/orchestratorErrors";
import type { CellStore } from "@kolu/surface/server";
import type { Logger } from "pino";
import { proveFleetMcpEndpoint } from "../fleet/mcpEndpoint.ts";
import {
  persistedFrom,
  type PersistedOrchestrator,
  readPersistedOrchestrator,
} from "./persisted.ts";
import { teachingLines } from "./teaching.ts";

/** What a reader of the transcript stream is handed, in order: one snapshot,
 *  then deltas, for as long as it is subscribed. */
export type OrchestratorFrameSink = (frame: OrchestratorFrame) => void;

export interface OrchestratorHost {
  /** The live cell value. Readable before the agent is up — it then says
   *  `offline` with the remembered session and fleet, which is the truth.
   *  Readable before the REMEMBERED record has been read too (it is read on
   *  the first reader's edge, see the module doc), which is what the cell's
   *  serve-time seed takes. */
  readonly state: () => OrchestratorState;
  /** Subscribe to the transcript. The sink is called SYNCHRONOUSLY with the
   *  snapshot before this returns, so a stream's first frame can never race
   *  the first delta. */
  readonly watch: (sink: OrchestratorFrameSink) => () => void;
  readonly prompt: (
    text: string,
    /** The terminals the message was ABOUT. `host` is the encoded host key
     *  and `terminalId` the id on that host; the harness joins them into the
     *  `host/id` the agent is told, which is the only name a fleet-wide
     *  conversation can act on. */
    mentions: ReadonlyArray<{
      terminalId: string;
      host: string;
      name: string;
      intent: string | null;
      cwd: string | null;
    }>,
    /** The files that came with the words, by NAME — each was uploaded ahead
     *  of this call by {@link OrchestratorHost.attach} and is already on disk
     *  under kolu-server's state root. What the harness is handed is the same
     *  shape with `bytes` and `path` re-read from the file; see
     *  {@link namedAttachments}. */
    attachments: ReadonlyArray<OrchestratorAttachment>,
  ) => Promise<{ rowId: string }>;
  /** ONE CHUNK of a file on its way up, ahead of the prompt that names it.
   *
   *  The first call for an id creates the file, each later one passes back
   *  the `path` it was handed and appends to it — which is how a 12 MiB
   *  screenshot reaches this host without a single frame that scales with it.
   *  SEQUENTIAL per attachment: this appends to one growing file, so two
   *  chunks in flight at once interleave and corrupt it silently — which is
   *  also why it is synchronous rather than a promise. */
  readonly attach: (chunk: {
    id: string;
    name: string;
    mimeType: string;
    data: string;
    appendTo?: string;
  }) => { path: string; bytes: number };
  readonly cancel: () => Promise<void>;
  readonly answer: (
    askId: string,
    answers: ReadonlyArray<{
      key: string;
      values: ReadonlyArray<string>;
    }> | null,
  ) => Promise<boolean>;
  readonly signIn: (
    method: string,
  ) => Promise<"signed-in" | "failed" | "cancelled" | "attached">;
  readonly signInInput: (text: string) => Promise<void>;
  readonly signInCancel: () => Promise<boolean>;
  readonly setOption: (id: string, value: string) => Promise<void>;
  readonly newSession: () => Promise<void>;
  /** Process-lifetime teardown: stop the child, write the record, drop the
   *  readers. AWAITED by kolu-server's shutdown, because the adapter is spawned
   *  `detached` — a teardown that only fired the stop would leave the adapter,
   *  its `claude` and its MCP client running after the server that owns them
   *  is gone. */
  readonly dispose: () => Promise<void>;
}

/** WHERE THE FLEET MCP FACE IS LISTENING, and the credential that opens it.
 *
 *  A loopback URL alone is not an address a conversation can be handed: every
 *  other process on this box can reach 127.0.0.1, so the listener is gated by
 *  a bearer token minted per process, and the two travel together or neither
 *  is useful. */
export interface FleetMcpEndpoint {
  readonly url: string;
  readonly token: string;
}

export interface OrchestratorDeps {
  readonly log: Logger;
  /** `$HOME` of the machine kolu-server runs on — the directory the
   *  conversation works in, and what makes a stored session findable when it
   *  is resumed. */
  readonly home: string;
  /** What this machine is CALLED. The standing prompt says "you are kolu's
   *  orchestrator, running on <this>", and a directory is not an answer to
   *  that: an agent told it runs on `/home/srid` has been told the one fact it
   *  cannot use when it reports where it did something. */
  readonly hostName: string;
  /** WHERE THE FLEET'S HANDS ARE — the in-process MCP endpoint and its token,
   *  or `null` while the listener is not up.
   *
   *  A THUNK, because the listener is started by the boot that owns it and
   *  this module may be constructed before that line runs; reading it per
   *  bring-up is what lets the first reader arrive in either order. The value
   *  is not merely NAMED when it is found: it is PROVED with a real request
   *  (see {@link provenFleetServer}), because this hand-over happens once
   *  inside `session/new` and an endpoint the agent cannot reach is marked
   *  failed for the life of the conversation. */
  readonly fleetMcp: () => FleetMcpEndpoint | null;
  /** Publish the live cell value. Pushed in rather than imported for the
   *  reason `spawn` is: this module owns the conversation, not the surface,
   *  and an import of the served ctx would be a cycle (`surface.ts` builds the
   *  cell that seeds itself from this host's first reading). */
  readonly publish: (state: OrchestratorState) => void;
  readonly store: CellStore<PersistedOrchestrator>;
  /** The FILE behind `store`, named in the refusal a corrupt record raises —
   *  the one thing a person holding a bad state-root can act on. */
  readonly storePath: () => string;
  /** The DIRECTORY that file is in — where a prompt's attachments are written
   *  so the agent can be handed a path to read. A plain string rather than a
   *  thunk like the two above: those are resolved late (the endpoint is not
   *  known until the listener binds, the config path is derived per read),
   *  while the state root is the one thing this process was started with. */
  readonly stateRoot: string;
  /** How a conversation is STARTED — `startHarness`, pushed in at assembly.
   *
   *  This module owns the record, the readers and the refusals; it owns no
   *  part of running a subprocess, and an import of the one function that
   *  does would make the two inseparable. Pushed in the way the autosave gate
   *  takes its effects: one arrow, out of the composition root, so the
   *  bookkeeping here is exercised without an adapter on the machine. */
  readonly spawn: (options: HarnessOptions) => Promise<Harness>;
}

/** The sentence a kolu-server whose fleet listener is not up yet says. It is a
 *  real window — the orchestrator is reachable the instant the surface serves,
 *  and the listener binds a few lines later — so it is stated rather than
 *  papered over with a retry loop that would hide a boot that genuinely never
 *  got there. */
const NO_FLEET_MCP =
  "This kolu has not published its fleet MCP endpoint yet, so the orchestrator cannot tell its agent where the fleet's terminals are. Try again once the server has finished starting.";

/** How long a burst of transcript movement may go unwritten.
 *
 *  A streaming answer is one row and six hundred frames, and the record lives
 *  in `config.json` BESIDE the host map and the preferences — so a write per
 *  frame rewrote the whole of kolu's state at the agent's output cadence.
 *  Leading-edge: the first movement is durable immediately, and a burst then
 *  costs one write a second instead of six hundred. An order
 *  of magnitude above the session trace's 500 ms throttle on purpose — a
 *  transcript row is reconstructible from the agent's own replay in a way a
 *  terminal layout is not, so it is the cheaper thing to trail. */
const PERSIST_THROTTLE_MS = 1_000;

/** How long a teardown STANDS THERE for a bring-up that is still in flight.
 *
 *  The handle that can stop the child exists only once the whole open has
 *  landed, and an open that is a `session/load` may sit on the wire for the
 *  harness's own load deadline — so a teardown that awaited it outright would
 *  hang a drain, an upgrade or a SIGTERM over a conversation nobody is
 *  watching. The STOP itself is not bounded by this: it is issued on a
 *  continuation of that same promise, so a harness that lands late is stopped
 *  when it does. Five seconds because what this window actually covers — a
 *  `spawn`, an `initialize` and a session request — is sub-second work on any
 *  machine that is not already wedged. */
const STOP_IN_FLIGHT_MS = 5_000;

/** The sentence behind a thrown thing. The harness's two refusals and the two
 *  wire errors all carry a WHOLE SENTENCE in `why`, and that is the half a
 *  reader is shown; a plain `Error` has only its message. */
const sentenceOf = (err: unknown): string => {
  if (typeof err === "object" && err !== null && "why" in err) {
    const { why } = err;
    if (typeof why === "string" && why !== "") return why;
  }
  return err instanceof Error ? err.message : String(err);
};

/** Where a prompt's files land, under kolu-server's state root.
 *
 *  Beside `config.json` rather than inside it: an image is bytes, and bytes
 *  base64'd into the record would make every read of the state file — on
 *  every boot, for every reader — pay for a screenshot nobody is looking at.
 *  Its own directory under an `orchestrator/` corner so a person can see what
 *  the conversation is holding, and delete it, without a tool. */
const ATTACHMENTS_DIR = join("orchestrator", "attachments");

/** An id is the WHOLE filename, so it may be nothing but a filename. A
 *  browser that sent `../../id_rsa` would otherwise be choosing where this
 *  server writes; leading dots are out too, so neither `.` nor `..` can be
 *  spelled. Refused rather than sanitized — a name this end had to repair is
 *  a name the two ends no longer agree on. */
const SAFE_ATTACHMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** How long a file nobody has sent yet is kept.
 *
 *  THE RULE a file lives by is the transcript row that names it, and an
 *  upload that has not been sent has no row — so the only thing keeping it is
 *  that somebody may still press Send. That hope has a lifetime: a composer
 *  left open across a meeting still sends, an image pasted and thought better
 *  of does not outlive the afternoon. Without it the chunked upload is a leak
 *  with a wider mouth than the one it replaced — a person can attach three
 *  files and never send any of them, and nothing would ever name them.
 *
 *  What makes the directory grow is also what cleans it: the sweep runs on
 *  every upload that CREATES a file, so a server nobody is pasting into holds
 *  whatever it holds, and one that is pasted into reaps as it goes.
 *
 *  Exported so the test drives the window rather than re-spelling it: a
 *  retention rule nobody can wind the clock past is a rule nobody has
 *  checked. */
export const UNSENT_ATTACHMENT_MS = 60 * 60 * 1_000;

export function startOrchestratorHost(
  deps: OrchestratorDeps,
): OrchestratorHost {
  const {
    log,
    home,
    hostName,
    fleetMcp,
    publish,
    store,
    storePath,
    stateRoot,
    spawn,
  } = deps;

  /** What the integration says about being seated here — the adapter it would
   *  spawn, or the whole sentence a machine without it is owed. Asked ONCE, at
   *  boot: `KOLU_ACP_AGENT` is baked, so it cannot change under a running
   *  server, and re-probing per call would be pretending it could. */
  const seating = ENGINE.at({
    env: process.env,
    cwd: home,
    found: () => null,
  });
  const absent: NotHere | null = "why" in seating ? seating : null;

  /** The three fields THIS SERVER is the author of — whether the adapter is
   *  seated on this machine, what the agent is called, and the directory this
   *  conversation is in — known here at boot from the engine and the home this
   *  process was started with. Folded back over every state the harness
   *  reports, so each has exactly ONE author. */
  const serverAuthored = {
    install:
      absent === null
        ? { kind: "installed" }
        : {
            kind: "absent",
            name: absent.name,
            where: absent.where,
            why: absent.why,
          },
    agentName: ENGINE.name,
    cwd: home,
  } satisfies Pick<OrchestratorState, "install" | "agentName" | "cwd">;

  let state: OrchestratorState = {
    ...DEFAULT_ORCHESTRATOR_STATE,
    ...serverAuthored,
  };

  // The transcript as a MAP, written in place. The frames that move it are
  // per-id (upsert / remove / append-to-one-row), so rebuilding an array per
  // frame would make a streaming answer quadratic in its own length. The array
  // is materialized only when somebody takes the whole of it — a snapshot for
  // a new reader, or a throttled write — and the sort lives there rather than
  // in the hot path.
  const byId = new Map<string, OrchestratorRow>();
  let rowsCache: ReadonlyArray<OrchestratorRow> | null = null;
  const rows = (): ReadonlyArray<OrchestratorRow> =>
    (rowsCache ??= [...byId.values()].sort((a, b) => a.seq - b.seq));

  let seq = 0;
  const sinks = new Set<OrchestratorFrameSink>();
  let harness: Harness | null = null;
  let starting: Promise<Harness> | null = null;
  let disposed = false;

  // What a restart starts from — read ONCE, on the first reader's edge. The
  // record is this module's to write from here on, and re-reading it would
  // make the file the authority over a live conversation that has moved past
  // it.
  let read = false;
  /** The session id the agent is asked to replay and the model a person CHOSE.
   *  Both stay at their empty value until the record has been read, and for a
   *  state-root with nothing to resume they stay there. */
  let resume: string | null = null;
  let chosenModel: string | null = null;

  const publishState = (): void => {
    publish(state);
  };

  const remembered = (): void => {
    if (read) return;
    let record: PersistedOrchestrator;
    try {
      record = readPersistedOrchestrator(store, storePath());
    } catch (err) {
      // This read happens on edges OUTSIDE `live()`'s refusal arm — a `watch`,
      // whose sink cannot be thrown at, and the first procedure call, before
      // there is a spawn to fail. Left to itself the schema's crash would
      // cross as an undeclared error while the cell still said `refusal:
      // null`: an idle-looking panel over a state-root nobody can read. Said
      // in the cell AND rethrown — the reader sees the sentence naming the
      // file, and the caller that CAN hear it still fails fast.
      sayRefusal(err);
      throw err;
    }
    // Marked read only once the record HAS been read: a refusal that left this
    // set would be a crash the first reader saw and every later one silently
    // did not, which is the fail-fast stance inverted.
    read = true;
    // A state-root whose `$HOME` moved cannot resume: a stored session id is
    // scoped to the directory it was opened in, and asking the agent for one
    // it cannot find is a refusal with nothing to do about it. Opening fresh
    // is the honest answer, and the rows AND the fleet go with the session —
    // a transcript claiming a conversation that is not coming back is a lie,
    // and so is a fleet strip naming the terminals of one.
    if (record.cwd === home) {
      resume = record.sessionId;
      // The agent re-asserts its own default over a resumed conversation, so a
      // choice kolu saw is the half that loses unless it is handed back.
      chosenModel = record.model;
      for (const row of record.rows) byId.set(row.id, row);
      rowsCache = null;
      state = { ...state, sessionId: record.sessionId, fleet: record.fleet };
      publishState();
    }
    // ... and the files go with them. This is the one edge where the set of
    // rows can SHRINK — the record was capped at {@link ROW_CAP}, or the home
    // moved and the whole transcript was let go — so it is the one edge where
    // a file can be left naming nothing. See {@link sweepAttachments}.
    sweepAttachments();
  };

  // ── a prompt's files ────────────────────────────────────────────────────

  const attachmentsDir = (): string => join(stateRoot, ATTACHMENTS_DIR);

  /** The uploads this server has taken that no row names YET — id to the
   *  moment the last chunk of it landed. An upload in progress is in here
   *  from its first chunk, which is what stops the sweep below from deleting
   *  a file out from under the chunk that is about to extend it. */
  const unsent = new Map<string, number>();

  /** Reconcile the attachment directory to the rows that still name a file,
   *  plus the uploads somebody may still send.
   *
   *  THE RULE: a file lives exactly as long as the transcript row it came in
   *  on. That ties four leaks shut at one seam — a record the row cap
   *  trimmed, a state-root whose home moved and let the whole transcript go,
   *  a server that died between writing the bytes and persisting the row that
   *  names them, and a prompt that was REFUSED after its files had been
   *  uploaded.
   *
   *  The one exception is an upload younger than {@link
   *  UNSENT_ATTACHMENT_MS}: it has no row because nobody has pressed Send
   *  yet, and deleting it would be this server reaping a file while a person
   *  is still typing the sentence it goes with.
   *
   *  It runs on the RESTORE (the moment rows are LOST), on every upload that
   *  creates a file (the moment the directory GROWS), and after a prompt that
   *  was refused (the moment files stop being destined for a row). A
   *  `newSession` is none of those and must not be: the divider says the
   *  agent's memory was reset, not that the scroll above it was thrown away,
   *  and the rows above it still draw their chips. Rows otherwise only
   *  arrive; the only ones a frame REMOVES are the ones the harness upserts
   *  at a fixed key (the plan, a tool card), which carry no files.
   *
   *  BEFORE THE RECORD IS READ it does nothing at all: `byId` is empty until
   *  the restore, and a sweep judging a restored state-root against an empty
   *  transcript would delete every file the conversation is still drawing.
   *
   *  A sweep that cannot read its own directory is WARNED about rather than
   *  thrown from: what it would have cost is disk, and refusing to open the
   *  conversation over that would cost the conversation. */
  const sweepAttachments = (): void => {
    if (!read) return;
    const dir = attachmentsDir();
    if (!existsSync(dir)) return;
    const named = new Set<string>();
    for (const row of byId.values()) {
      if (row.kind !== "user") continue;
      for (const one of row.attachments) named.add(one.id);
    }
    const now = Date.now();
    try {
      for (const name of readdirSync(dir)) {
        if (named.has(name)) continue;
        const since = unsent.get(name);
        if (since !== undefined) {
          if (now - since < UNSENT_ATTACHMENT_MS) continue;
          unsent.delete(name);
        }
        rmSync(join(dir, name), { force: true });
      }
    } catch (err) {
      log.warn(
        { err, dir },
        "kolu-server: the orchestrator could not sweep its attachments",
      );
    }
  };

  /** Take ONE CHUNK of a file and put it on disk.
   *
   *  WHY THE BYTES ARRIVE IN PIECES AT ALL. A prompt carrying its own base64
   *  is one frame that scales with the file, and the RPC decoder does not
   *  fail an oversized frame — it closes the socket with 1009 and takes every
   *  subscription in the tab with it. The terminal's paste learned this in
   *  production (`packages/client/src/terminal/pasteDelivery.ts`), and this
   *  is the same shape: the sender cuts the base64 into frame-sized pieces,
   *  the first creates, each later one appends to the path it was handed.
   *
   *  The writes are SYNCHRONOUS on purpose. An append is only correct if
   *  nothing interleaves with it, and a sync write is the cheapest way to say
   *  that about a handler the surface may enter twice — the sender is
   *  sequential per attachment, and this is what happens when it is not.
   *
   *  `appendTo` comes from the wire, so it is VALIDATED rather than trusted:
   *  a continuation token that could name any path turns an upload into an
   *  arbitrary-file append. It must resolve inside this state-root's
   *  attachments directory and be this attachment's own file; `realpathSync`
   *  resolves symlinks BEFORE the comparison, so a link planted in the
   *  directory cannot point the append out of it. */
  const attachChunk = (chunk: {
    id: string;
    name: string;
    mimeType: string;
    data: string;
    appendTo?: string;
  }): { path: string; bytes: number } => {
    if (!SAFE_ATTACHMENT_ID.test(chunk.id)) {
      throw new OrchestratorRefused({
        why: `“${chunk.name}” came with the id ${JSON.stringify(chunk.id)}, which is not a name this server will write a file under.`,
        auth: false,
      });
    }
    mkdirSync(attachmentsDir(), { recursive: true });
    const dir = realpathSync(attachmentsDir());
    const body = Buffer.from(chunk.data, "base64");
    let path: string;
    if (chunk.appendTo === undefined) {
      // THE CREATE, and the moment the directory grows — so it is where the
      // reaping happens. The write TRUNCATES: a second upload under the same
      // id is a file being sent again, not a file being doubled.
      remembered();
      sweepAttachments();
      writeFileSync(join(dir, chunk.id), body, { mode: 0o600 });
      path = realpathSync(join(dir, chunk.id));
    } else {
      // An append is only ever a CONTINUATION. A missing target is a protocol
      // violation rather than a first chunk, and it is checked before
      // `realpathSync`, which would otherwise throw a bare ENOENT that reads
      // as a crash instead of a refusal.
      if (!existsSync(chunk.appendTo)) {
        throw new OrchestratorRefused({
          why: `“${chunk.name}” has no file to append to on this host, so the upload was refused. Start it again.`,
          auth: false,
        });
      }
      const real = realpathSync(chunk.appendTo);
      // `sep`-terminated prefix, so `/state/orchestrator/attachments` cannot
      // be matched by `/state/orchestrator/attachments-elsewhere`; and the
      // file must be this attachment's own, which is the id it was validated
      // under.
      if (!real.startsWith(dir + sep) || basename(real) !== chunk.id) {
        throw new OrchestratorRefused({
          why: `“${chunk.name}” tried to continue into ${JSON.stringify(chunk.appendTo)}, which is not this attachment's file under this host's attachments directory.`,
          auth: false,
        });
      }
      appendFileSync(real, body, { mode: 0o600 });
      path = real;
    }
    // Measured from the FILE, after the write: the cap is enforced on what
    // this server actually holds, never on a chunk count or on what the
    // sender said it was sending. Per chunk rather than at the end, because
    // an upload that is refused only once it is finished has already cost the
    // disk it was refused for.
    const bytes = statSync(path).size;
    unsent.set(chunk.id, Date.now());
    if (bytes > ATTACHMENT_BYTE_CAP) {
      // Dropped rather than left half-written: a file the cap refused must
      // not be one a prompt can still name.
      rmSync(path, { force: true });
      unsent.delete(chunk.id);
      throw new OrchestratorRefused({
        why: attachmentTooBig(chunk.name, bytes),
        auth: false,
      });
    }
    return { path, bytes };
  };

  /** The attachments a prompt NAMED, found on disk and measured.
   *
   *  Nothing is written here — the bytes arrived chunk by chunk through
   *  {@link attachChunk}, and what a prompt carries is a name. The `path` the
   *  caller sent is not read at all: the file is looked up by ID under this
   *  server's own directory, so a path from the wire cannot choose what the
   *  agent is handed, and `bytes` is re-read from the file so the chip, the
   *  cap and the thing on disk are three readings of one number.
   *
   *  The per-PROMPT cap lives here because this is the only place a message's
   *  attachments are seen together; the per-attachment cap is enforced where
   *  the bytes are written, which is the only place a growing file is seen at
   *  all. The composer refuses first because refusing early is kinder, but
   *  this is the end that has to live with the bytes, and a cap that only the
   *  sender enforces is not a cap. */
  const namedAttachments = (
    attachments: ReadonlyArray<OrchestratorAttachment>,
  ): ReadonlyArray<OrchestratorAttachment> => {
    if (attachments.length === 0) return attachments;
    const named: OrchestratorAttachment[] = [];
    let total = 0;
    for (const one of attachments) {
      if (!SAFE_ATTACHMENT_ID.test(one.id)) {
        throw new OrchestratorRefused({
          why: `“${one.name}” came with the id ${JSON.stringify(one.id)}, which is not a name this server will write a file under.`,
          auth: false,
        });
      }
      const held = join(attachmentsDir(), one.id);
      if (!existsSync(held)) {
        throw new OrchestratorRefused({
          why: attachmentGone(one.name),
          auth: false,
        });
      }
      const path = realpathSync(held);
      const bytes = statSync(path).size;
      total += bytes;
      if (total > PROMPT_ATTACHMENT_BYTE_CAP) {
        throw new OrchestratorRefused({
          why: promptAttachmentsTooBig(total),
          auth: false,
        });
      }
      named.push({ ...one, bytes, path });
    }
    return named;
  };

  // ── the record, written on a throttle ───────────────────────────────────

  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let persistDue = false;
  let persistedAt = 0;

  const writeRecord = (): void => {
    persistDue = false;
    persistedAt = Date.now();
    store.set(persistedFrom(state, rows()));
  };

  /** The conversation moved; the file should say so within the window. */
  const schedulePersist = (): void => {
    persistDue = true;
    if (persistTimer !== undefined) return;
    const since = Date.now() - persistedAt;
    if (since >= PERSIST_THROTTLE_MS) {
      writeRecord();
      return;
    }
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      if (persistDue) writeRecord();
    }, PERSIST_THROTTLE_MS - since);
    // A pending write must never be the reason this process stays up: the
    // record is a convenience for the NEXT kolu-server, and `dispose` flushes it.
    persistTimer.unref();
  };

  /** Write whatever the throttle still owes the file, now. The one caller is
   *  `dispose` — a server that stopped mid-window would otherwise lose the
   *  tail of the conversation it just finished having. */
  const flushPersist = (): void => {
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    if (persistDue) writeRecord();
  };

  const snapshot = (): OrchestratorFrame => ({
    kind: "snapshot",
    seq,
    rows: [...rows()],
  });

  /** One place where a conversation's movement reaches everybody: the rows we
   *  keep, the readers subscribed now, and the file a restart will read.
   *
   *  REMOVES, then UPSERTS, then APPENDS — the canonical fold order, stated on
   *  `OrchestratorFrameSchema` and obeyed identically by the client's copy. A
   *  frame that removes a row and re-upserts the same id in one breath is a
   *  REPLACEMENT, and an append in the same frame is appended to the row that
   *  frame just put there. */
  const applyRows = (change: {
    upserts: ReadonlyArray<OrchestratorRow>;
    removes: ReadonlyArray<string>;
    appends: ReadonlyArray<{ of: string; at: number; text: string }>;
  }): void => {
    seq += 1;
    for (const id of change.removes) byId.delete(id);
    for (const row of change.upserts) byId.set(row.id, row);
    for (const saying of change.appends) {
      const row = byId.get(saying.of);
      if (row !== undefined && "text" in row) {
        byId.set(saying.of, {
          ...row,
          text: appendedText(row.text, saying.at, saying.text),
        });
      }
    }
    rowsCache = null;
    const frame: OrchestratorFrame = {
      kind: "delta",
      seq,
      upserts: change.upserts,
      removes: change.removes,
      appends: change.appends,
    };
    for (const sink of sinks) sink(frame);
    schedulePersist();
  };

  /** The one MCP server the session is handed, PROVEN before it is handed
   *  over. EXACTLY one, by design: the conversation's whole job is the fleet's
   *  terminals, and every other server on its wire is one the AGENT brought —
   *  which is what the roster strip's "plus the agent's own" says out loud.
   *
   *  It is an HTTP server rather than a stdio child, and that is the whole
   *  point of the fleet face: the hands are IN THIS PROCESS, over a loopback
   *  listener, so there is no relay subprocess per host and no ssh child
   *  beside the adapter. A host that arrives or leaves while the conversation
   *  runs flows through the one URL the session was opened with.
   *
   *  WHY THE ENDPOINT IS PROVED AND NOT JUST NAMED. This hand-over happens
   *  ONCE, inside `session/new`, and nothing ever revisits it: the agent
   *  connects the server, and if that connect does not land it marks it failed
   *  for the life of the conversation and carries on — running shell commands
   *  itself instead of opening terminals, which is the one failure this whole
   *  feature exists to prevent. Measured against the pinned adapter on this
   *  host: a server naming nothing is `failed` one second in, one that accepts
   *  and never answers is `failed` eleven seconds in, and the agent says
   *  nothing about either beyond a word on a roster nobody is reading yet. So
   *  a URL that is merely a STRING is not good enough to hand over: the
   *  refusal belongs here, where it can be said in the panel, rather than
   *  thirty seconds later inside an agent that has already decided to do
   *  without us.
   *
   *  What the proof establishes is that the URL accepts this process's token
   *  and OPENS A SESSION to it — the first three things the adapter's client
   *  will find out, found out first by the server that is about to claim they
   *  work. A door that is listening and will not serve this caller is the
   *  failure that matters most, because it is the one that looks like health.
   *  It does not prove the fleet is healthy; a host that is unreachable is the
   *  fleet face's own business to refuse by name, per host, as it is asked. */
  const provenFleetServer = async (): Promise<HttpServer> => {
    const at = fleetMcp();
    if (at === null) throw new OrchestratorUnavailable({ why: NO_FLEET_MCP });
    // The door reports what it saw; the refusal is this module's to raise —
    // the shape `FleetHosts` already uses for a host that is not answering.
    const why = await proveFleetMcpEndpoint(at, log);
    if (why !== null) throw new OrchestratorUnavailable({ why });
    return {
      kind: "http",
      name: "kolu",
      url: at.url,
      headers: { Authorization: `Bearer ${at.token}` },
    };
  };

  /** A bring-up that did not get there, said OUT LOUD.
   *
   *  The failure is a missing socket, an adapter that would not start, or a
   *  session the agent refused — and in every one of them the caller that
   *  tripped it may be a transcript subscription, which cannot throw at
   *  anybody. Publishing it is the difference between a panel that says what
   *  happened and an idle-looking one with a live composer under it. */
  const sayRefusal = (err: unknown): void => {
    state = { ...state, phase: "offline", refusal: sentenceOf(err) };
    publishState();
  };

  /** Bring the conversation up, once, and hand back the same promise to every
   *  caller that arrives while it is in flight — so two readers opening at the
   *  same instant cannot spawn two adapters. */
  const live = async (): Promise<Harness> => {
    const running = harness;
    if (running !== null) {
      if (running.alive()) return running;
      // A CORPSE is absent, not present-and-broken. The child exited (the
      // agent crashed, somebody killed it, the machine ran out of memory) and
      // every verb — `newSession` included — would otherwise refuse for the
      // life of the process with nothing a person could do about it. The stop
      // is fired rather than awaited so this stays synchronous up to the
      // `starting` assignment below: a second caller arriving mid-await would
      // see no harness and no bring-up in flight, and spawn a second adapter.
      harness = null;
      void running.stop().catch((err: unknown) => {
        log.warn(
          { err },
          "kolu-server: the orchestrator's dead agent did not clean up",
        );
      });
    }
    if (starting !== null) return starting;
    if (absent !== null) throw new OrchestratorUnavailable({ why: absent.why });
    if (disposed) {
      throw new OrchestratorUnavailable({
        why: "This kolu is shutting down, so its orchestrator is no longer accepting work.",
      });
    }
    remembered();
    // THE WHOLE BRING-UP IS ONE PROMISE, assigned to `starting` on the line
    // after it is made and never awaited before then — so two readers arriving
    // in the same tick share it rather than spawning two adapters. It has to
    // be a promise from the first step now that the first step is asking
    // whether this kolu's own fleet MCP face is answering ({@link
    // provenFleetServer}): a refusal there is a rejection like any other, which
    // is why there is no synchronous arm around the options any more.
    const begun = (async (): Promise<Harness> => {
      const kolu = await provenFleetServer();
      return spawn({
        leg: ENGINE.leg,
        adapter: seating as Exclude<typeof seating, NotHere>,
        cwd: home,
        mcpServers: [kolu],
        teaching: teachingLines(hostName),
        log,
        resume,
        // THE RESTART FENCE (see the module doc), taken HERE rather than at the
        // restore, because the restore is not the only spawn: a replacement
        // adapter comes up over everything the dead one minted as well as
        // everything the file restored, and a fence frozen at restore time
        // would hand it a number it has already passed — `user:1` and
        // `agent:2` minted a second time, overwriting by id the rows we are
        // still holding. `rows()` is sorted by `seq`, so its last is the
        // highest one that exists.
        resumedSeq: rows().at(-1)?.seq ?? 0,
        // THE DIVIDER FENCE, across the same seam and for the same reason.
        // A replacement harness builds a FRESH transcript, whose
        // "no two dividers in a row" guard can only see the rows IT minted —
        // so a `newSession` taken straight after a respawn would mint a
        // divider beside our last row, which is already one, and the
        // panel would draw two rules for one reset until the next boot
        // read collapsed them.
        resumedEndsWithDivider: rows().at(-1)?.kind === "divider",
        // The terminals this conversation was working with. Membership
        // otherwise accrues only from tool-call frames, and a resumed
        // conversation's frames are the replay the harness drops — so without
        // this seed the first publish would carry an empty fleet, and we
        // would write that emptiness back over our own record.
        fleet: state.fleet,
        model: chosenModel,
        onChange: (change) => {
          if (change.kind === "state") {
            // A TEARDOWN'S LAST BREATH IS NOT NEWS. `stop()` nulls the live
            // session and publishes one final state saying so, and we persist
            // what we are told — so a drain or an upgrade would write
            // `sessionId: null` beside the rows it just kept, and the next
            // boot would restore the transcript into a conversation it never
            // resumed. What the file must hold is the conversation as it stood
            // when the process let go of it.
            if (disposed) return;
            state = { ...change.state, ...serverAuthored };
            publishState();
            schedulePersist();
            return;
          }
          applyRows(change);
        },
      });
    })();
    starting = begun
      .then((started) => {
        harness = started;
        return started;
      })
      .catch((err: unknown) => {
        sayRefusal(err);
        throw err;
      })
      .finally(() => {
        starting = null;
      });
    return starting;
  };

  /** Every procedure goes through here, so the two refusals a caller can
   *  branch on are translated at ONE seam rather than at eight. A harness word
   *  that is neither is a DEFECT and crosses the wire as one: an orchestrator
   *  that broke in a way nobody declared should crash loudly, not arrive as a
   *  polite sentence in a chat. */
  const ask = async <T>(work: (agent: Harness) => Promise<T>): Promise<T> => {
    try {
      return await work(await live());
    } catch (err) {
      if (err instanceof HarnessUnavailable) {
        throw new OrchestratorUnavailable({ why: err.why });
      }
      if (err instanceof HarnessRefused) {
        throw new OrchestratorRefused({ why: err.why, auth: err.auth });
      }
      throw err;
    }
  };

  /** Stop a child and carry on. A teardown that threw here would skip the
   *  flush that follows it, and the record is what the next boot reads. */
  const stopQuietly = async (agent: Harness): Promise<void> => {
    try {
      await agent.stop();
    } catch (err: unknown) {
      log.warn(
        { err },
        "kolu-server: the orchestrator's agent did not stop cleanly",
      );
    }
  };

  // The cell is NOT published here: this host may be constructed BEFORE
  // `surface.ts` has registered the cell writer, so a write at construction
  // would reach a seam with nothing behind it. The cell is SEEDED from
  // `state()` instead, and every later movement publishes through `publish`.

  return {
    state: () => state,
    watch: (sink) => {
      // Opening the transcript IS looking at the conversation: it is the edge
      // that reads the remembered record AND the edge that brings the agent
      // up, in that order, so the snapshot below already carries what a
      // restart kept.
      remembered();
      sinks.add(sink);
      sink(snapshot());
      // The failure is not thrown: a stream whose first frame already landed
      // must not then die because the subprocess could not start — `live()`
      // publishes the refusal into the cell, which is where a reader that is
      // already watching will see it.
      void live().catch((err: unknown) => {
        log.warn(
          { err },
          "kolu-server: the orchestrator could not be brought up",
        );
      });
      return () => {
        sinks.delete(sink);
      };
    },
    prompt: async (text, mentions, attachments) => {
      try {
        const sent = await ask((agent) =>
          agent.prompt(
            text,
            mentions.map((mention) => ({ ...mention })),
            // The files are already on disk — the prompt names them, and this
            // is where they are found and measured. A refused attachment
            // refuses the whole message rather than arriving as a second
            // sentence under a turn that already went out.
            namedAttachments(attachments),
          ),
        );
        // The harness minted the user row before it answered, and that row
        // NAMES these files: the transcript is what keeps them from here on,
        // so the upload's own protection is done.
        for (const one of attachments) unsent.delete(one.id);
        return sent;
      } catch (err) {
        // THE MESSAGE NEVER LANDED, so neither did the row that would have
        // named its files — the agent refused the picture, the cap refused
        // the set, the adapter was not there. Whatever this prompt named is
        // now bytes nothing will ever mention, and the window is wider than
        // it looks: the upload happened call by call, long before Send. They
        // go with the refusal. The composer keeps its chips — that is what
        // lets a person fix the message rather than retype it — so a second
        // press re-uploads from the browser's own copy rather than trusting
        // a file this host has already let go.
        for (const one of attachments) unsent.delete(one.id);
        sweepAttachments();
        throw err;
      }
    },
    // No `live()`: uploading a file must not spawn an agent. The bytes are
    // this server's own bookkeeping, and a person who pastes an image into a
    // panel they then close should not have started a Claude for it.
    attach: attachChunk,
    cancel: () => ask((agent) => agent.cancel()),
    answer: (askId, answers) => ask((agent) => agent.answer(askId, answers)),
    signIn: (method) => ask((agent) => agent.signIn(method)),
    signInInput: (text) => ask((agent) => agent.signInInput(text)),
    signInCancel: () => ask((agent) => agent.signInCancel()),
    setOption: (id, value) => ask((agent) => agent.setOption(id, value)),
    newSession: () => ask((agent) => agent.newSession()),
    dispose: async () => {
      disposed = true;
      sinks.clear();
      const pending = starting;
      const running = harness;
      harness = null;
      if (running !== null) await stopQuietly(running);
      else if (pending !== null) {
        // A bring-up IN FLIGHT is the orphan this arm exists for: the child is
        // spawned `detached`, so a teardown that only looked at `harness`
        // would leave an adapter — and its `claude`, and its MCP client —
        // running under a server that no longer exists. The stop is ISSUED
        // unconditionally, on a continuation of the same promise, so a harness
        // that arrives late is still stopped.
        //
        // What is bounded is how long the shutdown STANDS THERE for it. The
        // handle only exists once the whole open has landed, and an open that
        // is a `session/load` sits on the wire for the harness's own load
        // deadline — so an outright await makes a drain or an upgrade hang on
        // a conversation nobody is watching.
        const late = pending.then(stopQuietly, () => {});
        const deadline = Promise.withResolvers<void>();
        // Unref'd: a shutdown waiting on a child must not itself be the reason
        // this process stays up.
        setTimeout(deadline.resolve, STOP_IN_FLIGHT_MS).unref();
        await Promise.race([late, deadline.promise]);
      }
      // AFTER the stop, so whatever the stop itself wrote into the transcript
      // is in the file the next boot reads — and with the session the process
      // was in, because the stop's own final state is ignored above.
      flushPersist();
    },
  };
}
