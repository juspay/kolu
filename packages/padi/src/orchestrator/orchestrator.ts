/**
 * THIS HOST'S ONE CONVERSATION — padi's half of the Orchestrator.
 *
 * padi owns exactly one ACP conversation per state-root: it spawns the adapter,
 * holds the session, keeps the transcript, persists enough of it to come back,
 * and serves the whole of it as `padiSurface`'s `orchestrator` cell, the
 * `orchestratorTranscript` stream and the `orchestrator` procedures. Because
 * kolu-server re-serves `padiSurface` per host and every hop is spec-walked, a
 * remote host's orchestrator reaches a browser with no server code at all.
 *
 * ## Why padi and not kolu-server
 *
 * The conversation's hands are this host's terminals. Its MCP server is a
 * `kolu mcp` pointed at THIS padi's socket, its `cwd` is THIS host's `$HOME`,
 * and the agents it supervises are the PTYs this padi's kaval owns. Hosting it
 * anywhere else would mean a conversation reaching across a wire to touch the
 * one thing padi exists to own — and on a remote host there would be nothing
 * for it to reach with.
 *
 * ## It starts when somebody looks
 *
 * The adapter is a real Claude subprocess, and a padi on a box nobody has
 * opened should not be running one. So the conversation is brought up by the
 * first READER — the first transcript subscription or the first procedure call
 * — and then kept for the daemon's life. That is not a lazy-init convenience:
 * it is what makes a fleet of provisioned-but-idle hosts cost nothing, while a
 * host somebody actually opens has its conversation back (with `session/load`)
 * before they have finished reading the first screen.
 *
 * The persisted rows are served BEFORE the agent is up, which is why the
 * stream's first snapshot never waits on a handshake: a restart shows the
 * conversation you were in, and the live agent arrives underneath it.
 *
 * ## Absent is absent
 *
 * The ACP adapter is baked into kolu's closure (`KOLU_ACP_AGENT`), so its
 * absence is a broken build rather than a configuration a person chose. There
 * is no fallback path and no knob: the cell carries the integration's own
 * sentence and every procedure refuses with it.
 */

import { ORCHESTRATOR_ENGINE as ENGINE } from "kolu-agents/acp";
import type { NotHere } from "@kolu/acp/engine";
import {
  type Harness,
  HarnessRefused,
  HarnessUnavailable,
  startHarness,
  teachingLines,
} from "@kolu/acp-harness";
import { KOLU_MCP_ARGS, PADI_SOCKET_ENV } from "@kolu/detect";
import {
  DEFAULT_ORCHESTRATOR_STATE,
  type OrchestratorFrame,
  OrchestratorRefused,
  type OrchestratorRow,
  type OrchestratorState,
  OrchestratorUnavailable,
} from "@kolu/padi-client/surface";
import type { CellStore } from "@kolu/surface/server";
import type { Logger } from "pino";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { KOLU_MCP_BIN_ENV } from "./bake.ts";
import { persistedFrom, type PersistedOrchestrator } from "./persisted.ts";

/** What a reader of the transcript stream is handed, in order: one snapshot,
 *  then deltas, for as long as it is subscribed. */
export type OrchestratorFrameSink = (frame: OrchestratorFrame) => void;

export interface OrchestratorHost {
  /** The live cell value. Readable before the agent is up — it then says
   *  `offline` with the persisted model and fleet, which is the truth. */
  readonly state: () => OrchestratorState;
  /** Subscribe to the transcript. The sink is called SYNCHRONOUSLY with the
   *  snapshot before this returns, so a stream's first frame can never race
   *  the first delta. */
  readonly watch: (sink: OrchestratorFrameSink) => () => void;
  readonly prompt: (
    text: string,
    mentions: ReadonlyArray<{
      terminalId: string;
      name: string;
      intent: string | null;
      cwd: string | null;
    }>,
  ) => Promise<{ rowId: string }>;
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
  /** Daemon-lifetime teardown: stop the child, drop the readers. */
  readonly dispose: () => void;
}

export interface OrchestratorDeps {
  readonly log: Logger;
  /** `$HOME` of this padi's host — the directory the conversation works in,
   *  and what makes a stored session findable when it is resumed. */
  readonly home: string;
  /** This padi's served socket, stamped into the `kolu mcp` child's
   *  environment so the conversation's hands reach THIS padi flag-free. */
  readonly socketPath: () => string | null;
  readonly store: CellStore<PersistedOrchestrator>;
}

/** The sentence a build that lost its baked `kolu` says. It names the variable
 *  because the only person who can see this is somebody holding a kolu that
 *  was assembled wrong, and the variable is the whole of the lead. */
const NO_KOLU_BIN =
  "This kolu was built without KOLU_MCP_BIN, so the orchestrator has no way to hand its agent this host's terminals. The binary is baked by padi's own wrapper; a build that lost it is a packaging defect, not a setting.";

/** The sentence a padi that has not finished booting its socket says. It is a
 *  real window — the orchestrator can be reached the instant the surface
 *  serves, and `setPadiServeSocketPath` runs a few lines later — so it is
 *  stated rather than papered over with a retry loop that would hide a boot
 *  that genuinely never got there. */
const NO_SOCKET =
  "This padi has not published its socket yet, so the orchestrator cannot tell its agent where this host's terminals are. Try again once the daemon has finished starting.";

export function startOrchestratorHost(
  deps: OrchestratorDeps,
): OrchestratorHost {
  const { log, home, socketPath, store } = deps;

  // What a restart starts from. Read ONCE: the record is this module's to
  // write from here on, and re-reading it would make the file the authority
  // over a live conversation that has moved past it.
  const remembered = store.get();

  let rows: ReadonlyArray<OrchestratorRow> =
    remembered.cwd === home ? remembered.rows : [];
  // A state-root whose `$HOME` moved cannot resume: a stored session id is
  // scoped to the directory it was opened in, and asking the agent for one it
  // cannot find is a refusal with nothing to do about it. Opening fresh is the
  // honest answer, and dropping the rows with it keeps the transcript from
  // claiming a conversation that is not coming back.
  const resume = remembered.cwd === home ? remembered.sessionId : null;

  /** What the integration says about being seated here — the adapter it would
   *  spawn, or the whole sentence a machine without it is owed. Asked ONCE, at
   *  boot: `KOLU_ACP_AGENT` is baked, so it cannot change under a running
   *  daemon, and re-probing per call would be pretending it could. */
  const seating = ENGINE.at({
    env: process.env,
    cwd: home,
    found: () => null,
  });
  const absent: NotHere | null = "why" in seating ? seating : null;

  let state: OrchestratorState = {
    ...DEFAULT_ORCHESTRATOR_STATE,
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
    sessionId: resume,
    fleet: remembered.fleet,
  };

  let seq = 0;
  const sinks = new Set<OrchestratorFrameSink>();
  let harness: Harness | null = null;
  let starting: Promise<Harness> | null = null;
  let disposed = false;

  const publishState = (): void => {
    padiSurfaceCtx.cells.orchestrator.set(state);
  };

  const remember = (): void => {
    store.set(persistedFrom(state, rows));
  };

  const snapshot = (): OrchestratorFrame => ({
    kind: "snapshot",
    seq,
    rows: [...rows],
  });

  /** One place where a conversation's movement reaches everybody: the rows we
   *  keep, the readers subscribed now, and the file a restart will read. */
  const applyRows = (change: {
    upserts: ReadonlyArray<OrchestratorRow>;
    removes: ReadonlyArray<string>;
    appends: ReadonlyArray<{ of: string; at: number; text: string }>;
  }): void => {
    seq += 1;
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of change.removes) byId.delete(id);
    for (const row of change.upserts) byId.set(row.id, row);
    for (const saying of change.appends) {
      const row = byId.get(saying.of);
      if (row !== undefined && "text" in row) {
        byId.set(saying.of, { ...row, text: row.text + saying.text });
      }
    }
    rows = [...byId.values()].sort((a, b) => a.seq - b.seq);
    const frame: OrchestratorFrame = {
      kind: "delta",
      seq,
      upserts: change.upserts,
      removes: change.removes,
      appends: change.appends,
    };
    for (const sink of sinks) sink(frame);
    remember();
  };

  /** The one stdio MCP server the session is handed. EXACTLY one, by design:
   *  the conversation's whole job is this host's terminals, and every other
   *  server on its wire is one the AGENT brought — which is what the roster
   *  strip's "plus the agent's own" says out loud. */
  const koluServer = (): {
    name: string;
    command: string;
    args: ReadonlyArray<string>;
    env: Record<string, string>;
  } => {
    const command = process.env[KOLU_MCP_BIN_ENV];
    if (command === undefined || command === "") {
      throw new OrchestratorUnavailable({ why: NO_KOLU_BIN });
    }
    const socket = socketPath();
    if (socket === null) throw new OrchestratorUnavailable({ why: NO_SOCKET });
    return {
      name: "kolu",
      command,
      args: [...KOLU_MCP_ARGS],
      env: { [PADI_SOCKET_ENV]: socket },
    };
  };

  /** Bring the conversation up, once, and hand back the same promise to every
   *  caller that arrives while it is in flight — so two readers opening at the
   *  same instant cannot spawn two adapters. */
  const live = async (): Promise<Harness> => {
    if (harness !== null) return harness;
    if (starting !== null) return starting;
    if (absent !== null) throw new OrchestratorUnavailable({ why: absent.why });
    if (disposed) {
      throw new OrchestratorUnavailable({
        why: "This padi is shutting down, so its orchestrator is no longer accepting work.",
      });
    }
    starting = startHarness({
      agentName: ENGINE.name,
      leg: ENGINE.leg,
      adapter: seating as Exclude<typeof seating, NotHere>,
      cwd: home,
      mcpServers: [koluServer()],
      teaching: teachingLines(home),
      log,
      resume,
      onChange: (change) => {
        if (change.kind === "state") {
          state = change.state;
          publishState();
          remember();
          return;
        }
        applyRows(change);
      },
    })
      .then((started) => {
        harness = started;
        return started;
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

  // The cell is NOT published here: `buildPadiSurfaceDeps` runs BEFORE
  // `daemonMain` sets padi's surface ctx, so a write at construction would
  // reach a proxy with nothing behind it. The cell is SEEDED from `state()`
  // instead, and every later movement publishes through the ctx.

  return {
    state: () => state,
    watch: (sink) => {
      sinks.add(sink);
      sink(snapshot());
      // Opening the transcript IS looking at the conversation, so it is what
      // brings the agent up. The failure is logged rather than thrown: a
      // stream whose first frame already landed must not then die because the
      // subprocess could not start — the cell says that, in the one place a
      // reader is already watching for it.
      void live().catch((err: unknown) => {
        log.warn({ err }, "padi: the orchestrator could not be brought up");
      });
      return () => {
        sinks.delete(sink);
      };
    },
    prompt: (text, mentions) =>
      ask((agent) =>
        agent.prompt(
          text,
          mentions.map((mention) => ({ ...mention })),
        ),
      ),
    cancel: () => ask((agent) => agent.cancel()),
    answer: (askId, answers) => ask((agent) => agent.answer(askId, answers)),
    signIn: (method) => ask((agent) => agent.signIn(method)),
    signInInput: (text) => ask((agent) => agent.signInInput(text)),
    signInCancel: () => ask((agent) => agent.signInCancel()),
    setOption: (id, value) => ask((agent) => agent.setOption(id, value)),
    newSession: () => ask((agent) => agent.newSession()),
    dispose: () => {
      disposed = true;
      sinks.clear();
      const running = harness;
      harness = null;
      void running?.stop().catch((err: unknown) => {
        log.warn(
          { err },
          "padi: the orchestrator's agent did not stop cleanly",
        );
      });
    },
  };
}
