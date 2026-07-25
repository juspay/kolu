/**
 * The adapter process and the single ACP session it hosts.
 *
 * This is the volatility the proxy exists to absorb: an agent process that can
 * die mid-turn, keep streaming after it was told to stop, or need a permission
 * answered before it will move. Callers see one durable session — `prompt` and
 * `cancel` — and never learn that the process behind it was replaced.
 *
 * Nothing here is agent-specific. The command to spawn arrives as data.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  type AgentCapabilities,
  type ContentBlock,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  RequestError,
  type SessionNotification,
} from "@zed-industries/agent-client-protocol";
import type { ProxyEvent } from "./render.ts";

/**
 * How long a cancelled turn has to end on its own before the adapter is killed
 * and replaced. Some agents keep streaming after `session/cancel`; a cancel
 * that cannot be honoured must still end the turn, so the grace window expires
 * into a respawn rather than into a hang.
 */
export const CANCEL_GRACE_MS = 3000;

/**
 * How long the ACP handshake (`initialize` + `session/new`) may take before the
 * adapter is declared stuck. Both calls are local bookkeeping that finish in
 * well under a second on a healthy agent, so a minute of silence means the
 * process will never answer — and a proxy that waits forever for it is a hang
 * where a crash belongs.
 */
export const HANDSHAKE_TIMEOUT_MS = 60_000;

/** Reject if `work` has not settled within `ms`. */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} did not complete within ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kill the adapter's whole process group.
 *
 * An ACP adapter is a process *tree* — it runs the model's tools and any MCP
 * servers as its own children. Killing only the adapter leaves those orphaned,
 * and a proxy that respawns on every crash would leak a fresh set each time.
 * The children are reachable as a group because the adapter is spawned
 * `detached`, which makes it a group leader.
 */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone, or was never created (the child died between
    // spawn and here). Killing the process directly is then the whole job.
    try {
      child.kill(signal);
    } catch {
      // Nothing left to signal.
    }
  }
}

/** The adapter to run. `command` is resolved on PATH, exactly as typed. */
export interface AdapterSpec {
  command: string;
  args: string[];
  cwd: string;
}

type SessionUpdate = SessionNotification["update"];

interface PendingTurn {
  resolve: (response: PromptResponse) => void;
  reject: (error: unknown) => void;
}

export interface AdapterSessionOptions {
  spec: AdapterSpec;
  /** Transcript + lifecycle sink — the tile's view. */
  emit: (event: ProxyEvent) => void;
  /** Session updates, with the downstream session id already stripped. */
  onUpdate: (update: SessionUpdate) => void;
  /** The adapter could not be brought up. The proxy cannot serve without one. */
  onFatal: (error: unknown) => void;
}

export class AdapterSession {
  readonly #spec: AdapterSpec;
  readonly #emit: (event: ProxyEvent) => void;
  readonly #onUpdate: (update: SessionUpdate) => void;
  readonly #onFatal: (error: unknown) => void;

  #child: ChildProcess | null = null;
  #connection: ClientSideConnection | null = null;
  #sessionId: string | null = null;
  #agentCapabilities: AgentCapabilities = {};
  #pending: PendingTurn | null = null;
  #cancelState: "none" | "requested" | "killing" = "none";
  #graceTimer: NodeJS.Timeout | null = null;
  #stopped = false;

  constructor(options: AdapterSessionOptions) {
    this.#spec = options.spec;
    this.#emit = options.emit;
    this.#onUpdate = options.onUpdate;
    this.#onFatal = options.onFatal;
  }

  /** Spawn the adapter and complete the ACP handshake. Throws if either fails
   *  — a proxy with no adapter has nothing to serve. */
  async start(): Promise<void> {
    await this.#spawnAndHandshake();
  }

  /** What the adapter said it can do, as of the most recent handshake. */
  get agentCapabilities(): AgentCapabilities {
    return this.#agentCapabilities;
  }

  /** Send one turn. Rejects rather than queueing if a turn is already running:
   *  one session, one turn, and a caller that raced deserves to know. */
  async prompt(prompt: ContentBlock[]): Promise<PromptResponse> {
    if (this.#pending) {
      throw RequestError.invalidRequest({
        reason: "a turn is already in progress on this session",
      });
    }
    const connection = this.#connection;
    const sessionId = this.#sessionId;
    if (!connection || !sessionId) {
      throw RequestError.internalError({ reason: "the adapter is not ready" });
    }

    const turn = new Promise<PromptResponse>((resolve, reject) => {
      this.#pending = { resolve, reject };
    });
    connection.prompt({ sessionId, prompt }).then(
      (response) => this.#settle((pending) => pending.resolve(response)),
      (error) => this.#settle((pending) => pending.reject(error)),
    );
    return await turn;
  }

  /** Ask the adapter to end the current turn, and make sure it ends either
   *  way: if the grace window expires the adapter is killed and respawned, and
   *  the turn reports `cancelled`. */
  cancel(): void {
    this.#emit({ kind: "cancelRequested" });
    if (this.#connection && this.#sessionId) {
      void this.#connection.cancel({ sessionId: this.#sessionId });
    }
    if (!this.#pending || this.#cancelState !== "none") return;
    this.#cancelState = "requested";
    this.#graceTimer = setTimeout(() => {
      this.#emit({ kind: "cancelGraceExpired", graceMs: CANCEL_GRACE_MS });
      this.#cancelState = "killing";
      if (this.#child) killGroup(this.#child, "SIGKILL");
    }, CANCEL_GRACE_MS);
  }

  /** Shut down for good: no respawn after this. */
  stop(): void {
    this.#stopped = true;
    this.#clearGrace();
    if (this.#child) killGroup(this.#child, "SIGTERM");
    this.#child = null;
  }

  async #spawnAndHandshake(): Promise<void> {
    const child = spawn(this.#spec.command, this.#spec.args, {
      cwd: this.#spec.cwd,
      // stderr is inherited rather than piped: the adapter's own logs belong in
      // the tile beside the transcript, and an unread pipe would eventually
      // block the adapter on a full buffer.
      stdio: ["pipe", "pipe", "inherit"],
      // Group leader, so a kill reaches the tools and MCP servers it spawned.
      detached: true,
    });
    const { stdin, stdout } = child;
    if (!stdin || !stdout) {
      throw new Error("the adapter was spawned without usable stdio pipes");
    }
    this.#child = child;

    // A spawn that never starts (a command not on PATH) surfaces here, and is
    // fatal: there is no adapter to serve.
    child.once("error", (error) => {
      if (this.#stopped) return;
      this.#onFatal(error);
    });
    child.once("exit", (code, signal) => this.#onExit(code, signal));

    this.#emit({
      kind: "adapterSpawned",
      command: this.#spec.command,
      args: this.#spec.args,
      pid: child.pid ?? -1,
    });

    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate: async (params: SessionNotification) => {
          this.#emit({ kind: "update", update: params.update });
          this.#onUpdate(params.update);
        },
        requestPermission: async (params: RequestPermissionRequest) =>
          this.#answerPermission(params),
      }),
      ndJsonStream(Writable.toWeb(stdin), Readable.toWeb(stdout)),
    );
    this.#connection = connection;

    try {
      await this.#handshake(connection);
    } catch (error) {
      // An adapter that cannot complete a handshake will not complete the next
      // one either, so this is terminal rather than something to respawn into
      // a loop. Stop first: the kill below would otherwise land in `#onExit`
      // and start exactly that loop.
      this.#stopped = true;
      killGroup(child, "SIGKILL");
      throw error;
    }
  }

  async #handshake(connection: ClientSideConnection): Promise<void> {
    const initialized = await withTimeout(
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        // No filesystem or terminal services are offered: the proxy is not an
        // editor, and an agent that needs to read or run something does it
        // through its own tools, on the host it is already running on.
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
        },
      }),
      HANDSHAKE_TIMEOUT_MS,
      "initialize",
    );
    this.#agentCapabilities = initialized.agentCapabilities ?? {};

    const session = await withTimeout(
      connection.newSession({ cwd: this.#spec.cwd, mcpServers: [] }),
      HANDSHAKE_TIMEOUT_MS,
      "session/new",
    );
    this.#sessionId = session.sessionId;
    this.#cancelState = "none";

    // Announced only once the session exists, so "ready" means promptable —
    // the signal a respawn is complete, not merely under way.
    this.#emit({
      kind: "adapterReady",
      agentName: this.#spec.command,
      protocolVersion: initialized.protocolVersion,
    });
  }

  /**
   * Until permissions are forwarded to whoever is driving the session, the
   * proxy answers them itself — with `allow_once` and nothing else. A request
   * that offers no `allow_once` cannot be answered under that policy, so it
   * fails loudly instead of being silently widened to `allow_always`.
   *
   * The option is found by `kind`, never by id or position: option ids are
   * vendor strings, and picking one by name is how a harness ends up choosing
   * `allow_always` because an agent reordered its list.
   *
   * This answers synchronously, which is why cancelling a turn here cannot
   * deadlock: no permission request is ever outstanding when `session/cancel`
   * arrives. Forwarding permissions to the thread (HX2) removes that property,
   * and at that point an in-flight request must be answered `cancelled` before
   * the cancel is sent, or the agent waits forever for a reply.
   */
  #answerPermission(
    params: RequestPermissionRequest,
  ): RequestPermissionResponse {
    const title = params.toolCall.title ?? params.toolCall.toolCallId;
    const option = params.options.find((o) => o.kind === "allow_once");
    if (!option) {
      this.#emit({ kind: "permissionUnanswerable", title });
      throw RequestError.internalError({
        reason:
          "the proxy answers permission requests with allow_once; this request offered no such option",
      });
    }
    this.#emit({
      kind: "permissionAutoAnswered",
      title,
      optionName: option.name,
    });
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  }

  #onExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#stopped) return;
    this.#emit({ kind: "adapterExited", code, signal });

    const killedForCancel = this.#cancelState === "killing";
    this.#clearGrace();
    this.#cancelState = "none";
    this.#connection = null;
    this.#sessionId = null;
    this.#child = null;

    this.#settle((pending) => {
      if (killedForCancel) pending.resolve({ stopReason: "cancelled" });
      else
        pending.reject(
          RequestError.internalError({
            reason: "the adapter exited while the turn was running",
          }),
        );
    });

    this.#emit({ kind: "adapterRespawning" });
    this.#spawnAndHandshake().catch((error) => this.#onFatal(error));
  }

  /** Settle the in-flight turn exactly once, whoever gets there first. */
  #settle(finish: (pending: PendingTurn) => void): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    this.#clearGrace();
    this.#cancelState = "none";
    finish(pending);
  }

  #clearGrace(): void {
    if (!this.#graceTimer) return;
    clearTimeout(this.#graceTimer);
    this.#graceTimer = null;
  }
}
