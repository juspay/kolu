/**
 * The adapter process and the single ACP session it hosts.
 *
 * This is the volatility the proxy exists to absorb: an agent process that can
 * die mid-turn, keep streaming after it was told to stop, or need a permission
 * answered before it will move. Callers see one durable session — `prompt` and
 * `cancel` — and never learn that the process behind it was replaced.
 *
 * Nothing here is agent-specific. The command to spawn arrives as data.
 *
 * **Generations are the spine.** Every spawn gets an identity, and everything
 * that depends on that process — its connection, its pending requests, its
 * grace timer, its frame handlers — is scoped to it. Two facts force this:
 *
 *  1. The ACP library never rejects an in-flight request when its stream ends
 *     (`Connection.#receive` breaks out of the read loop and releases the lock;
 *     `#pendingResponses` is left untouched). A dead child therefore looks
 *     exactly like a slow one, forever. So a generation carries a `dead`
 *     promise that rejects the moment its child exits, and every await on the
 *     library races it — the child's lifetime bounds the request's.
 *  2. A dead child's receive loop keeps running until EOF. Without an identity
 *     check its handlers would write frames into the session that replaced it.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  type AgentCapabilities,
  ClientSideConnection,
  type ContentBlock,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptResponse,
  RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@zed-industries/agent-client-protocol";
import { describeError } from "./errors.ts";
import type { ProxyEvent } from "./events.ts";

/**
 * How long a cancelled turn has to end on its own before the adapter is killed
 * and replaced. Some agents keep streaming after `session/cancel`; a cancel
 * that cannot be honoured must still end the turn, so the grace window expires
 * into a respawn rather than into a hang.
 */
export const CANCEL_GRACE_MS = 3000;

/**
 * A backstop for an adapter that is alive but mute during the handshake. It is
 * *not* how a dead adapter is detected — that is the generation's `dead`
 * promise, which fires immediately. A wall clock in that role once meant 60
 * seconds of dead air before a healthy respawned adapter was killed.
 */
export const HANDSHAKE_TIMEOUT_MS = 60_000;

/** Respawn pacing. An adapter that dies on boot must not be retried in a hot
 *  loop — unpaced, a `false` adapter respawned ~230 times a second. */
const RESPAWN_BASE_DELAY_MS = 250;
const RESPAWN_MAX_DELAY_MS = 5_000;
/** Consecutive failed generations before the proxy gives up and says so. */
const RESPAWN_FAILURE_LIMIT = 5;
/** How long a generation must survive to count as healthy, clearing the
 *  failure streak. Shorter than this and "it started" proves nothing. */
const HEALTHY_UPTIME_MS = 10_000;

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

/** One spawned adapter process and everything scoped to its lifetime. */
interface Generation {
  readonly id: number;
  readonly child: ChildProcess;
  readonly connection: ClientSideConnection;
  /** Rejects the instant this child exits. Raced against every library call so
   *  a dead process can never masquerade as a slow one. */
  readonly dead: Promise<never>;
  readonly died: (error: unknown) => void;
  sessionId: string | null;
  readyAt: number | null;
  /** Set once its end has been accounted for, so `error` + `exit` (which can
   *  both fire) settle the generation exactly once. */
  ended: boolean;
}

export interface AdapterSessionOptions {
  spec: AdapterSpec;
  /** Transcript + lifecycle sink — the tile's view. */
  emit: (event: ProxyEvent) => void;
  /** Session updates, with the downstream session id already stripped. */
  onUpdate: (update: SessionUpdate) => void;
  /** The adapter could not be kept up. The proxy cannot serve without one. */
  onFatal: (error: unknown) => void;
}

export class AdapterSession {
  readonly #spec: AdapterSpec;
  readonly #emit: (event: ProxyEvent) => void;
  readonly #onUpdate: (update: SessionUpdate) => void;
  readonly #onFatal: (error: unknown) => void;

  #current: Generation | null = null;
  #generations = 0;
  #agentCapabilities: AgentCapabilities = {};
  #pending: PendingTurn | null = null;
  #cancelState: "none" | "requested" | "killing" = "none";
  #graceTimer: NodeJS.Timeout | null = null;
  #respawnTimer: NodeJS.Timeout | null = null;
  #consecutiveFailures = 0;
  /** The first handshake belongs to `start()`'s caller, not to the respawn
   *  policy: a proxy whose adapter never came up should fail, not retry. */
  #starting = false;
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
    this.#starting = true;
    try {
      await this.#spawnAndHandshake();
    } finally {
      this.#starting = false;
    }
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
    const generation = this.#current;
    if (!generation?.sessionId) {
      throw RequestError.internalError({ reason: "the adapter is not ready" });
    }

    const turn = new Promise<PromptResponse>((resolve, reject) => {
      this.#pending = { resolve, reject };
    });
    this.#bind(
      generation,
      generation.connection.prompt({
        sessionId: generation.sessionId,
        prompt,
      }),
    ).then(
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
    const generation = this.#current;
    if (generation?.sessionId) {
      void generation.connection
        .cancel({ sessionId: generation.sessionId })
        .catch(() => {
          // The child is already gone; its exit is the authority on ending the
          // turn, and it is handled in #onExit.
        });
    }
    if (!this.#pending || this.#cancelState !== "none" || !generation) return;
    this.#cancelState = "requested";
    this.#graceTimer = setTimeout(() => {
      // Only the generation that was asked to stop may be killed for it.
      if (this.#current !== generation) return;
      this.#emit({ kind: "cancelGraceExpired", graceMs: CANCEL_GRACE_MS });
      this.#cancelState = "killing";
      this.#killGroup(generation.child, "SIGKILL");
    }, CANCEL_GRACE_MS);
  }

  /** Shut down for good: no respawn after this. */
  stop(): void {
    this.#stopped = true;
    this.#clearGrace();
    if (this.#respawnTimer) clearTimeout(this.#respawnTimer);
    this.#respawnTimer = null;
    const generation = this.#current;
    this.#current = null;
    // A caller waiting on a turn must hear that it will never finish — the
    // library will not tell them, and #onExit is disarmed by #stopped.
    this.#settle((pending) =>
      pending.reject(
        RequestError.internalError({ reason: "the proxy is shutting down" }),
      ),
    );
    if (generation) this.#killGroup(generation.child, "SIGTERM");
  }

  /**
   * Bound `work` to a generation's lifetime, so the death of its process ends
   * the wait. Without this every library call outlives its child forever.
   */
  async #bind<T>(generation: Generation, work: Promise<T>): Promise<T> {
    return await Promise.race([work, generation.dead]);
  }

  /** As `#bind`, plus a wall-clock backstop for a live-but-mute adapter. */
  async #bindWithTimeout<T>(
    generation: Generation,
    work: Promise<T>,
    what: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.#bind(generation, work),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${what} did not complete within ${HANDSHAKE_TIMEOUT_MS}ms`,
                ),
              ),
            HANDSHAKE_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
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

    let died: (error: unknown) => void = () => {};
    const dead = new Promise<never>((_resolve, reject) => {
      died = reject;
    });
    // Marked handled up front: nothing is racing it until the first library
    // call, and an unraced rejection would otherwise crash the process.
    dead.catch(() => {});

    const id = ++this.#generations;
    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate: async (params: SessionNotification) => {
          // A dead child's receive loop runs until EOF. Its frames belong to a
          // session that no longer exists and must not reach this one.
          if (this.#current?.id !== id) return;
          this.#emit({ kind: "update", update: params.update });
          this.#onUpdate(params.update);
        },
        requestPermission: async (params: RequestPermissionRequest) => {
          if (this.#current?.id !== id) {
            throw RequestError.internalError({
              reason: "this adapter generation has been replaced",
            });
          }
          return this.#answerPermission(params);
        },
      }),
      ndJsonStream(Writable.toWeb(stdin), Readable.toWeb(stdout)),
    );

    const generation: Generation = {
      id,
      child,
      connection,
      dead,
      died,
      sessionId: null,
      readyAt: null,
      ended: false,
    };
    this.#current = generation;

    // A spawn that never starts — a command not on PATH — emits `error` and
    // **never** `exit`. Both paths must reach the same accounting, or a
    // vanished adapter binary leaves the proxy alive, socket open, answering
    // every prompt "the adapter is not ready" with no retry and no give-up.
    child.once("error", (error) => this.#onExit(generation, null, null, error));
    child.once("exit", (code, signal) =>
      this.#onExit(generation, code, signal),
    );

    this.#emit({
      kind: "adapterSpawned",
      command: this.#spec.command,
      args: this.#spec.args,
      pid: child.pid ?? -1,
    });

    try {
      await this.#handshake(generation);
    } catch (error) {
      // Clean up *this* generation only. It may already have been replaced by a
      // respawn while this handshake was in flight, in which case the live one
      // must be left strictly alone.
      this.#killGroup(child, "SIGKILL");
      throw error;
    }
  }

  async #handshake(generation: Generation): Promise<void> {
    const initialized = await this.#bindWithTimeout(
      generation,
      generation.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        // No filesystem or terminal services are offered: the proxy is not an
        // editor, and an agent that needs to read or run something does it
        // through its own tools, on the host it is already running on.
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
        },
      }),
      "initialize",
    );

    const session = await this.#bindWithTimeout(
      generation,
      generation.connection.newSession({
        cwd: this.#spec.cwd,
        mcpServers: [],
      }),
      "session/new",
    );

    this.#agentCapabilities = initialized.agentCapabilities ?? {};
    generation.sessionId = session.sessionId;
    generation.readyAt = Date.now();
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

  /**
   * A generation has ended — by exiting, or by never starting at all. This is
   * the **sole** place a generation is accounted for and the next attempt
   * scheduled, so that both ways of dying are paced and capped identically.
   */
  #onExit(
    generation: Generation,
    code: number | null,
    signal: NodeJS.Signals | null,
    spawnError?: unknown,
  ): void {
    if (generation.ended) return;
    generation.ended = true;

    // Ends every await bound to this generation — including a handshake, which
    // the library would otherwise leave pending until the wall clock gave up.
    generation.died(
      spawnError ??
        RequestError.internalError({
          reason: `the adapter exited (${signal ? `signal ${signal}` : `code ${code}`})`,
        }),
    );
    // Stop the orphaned receive loop rather than let it drain to EOF.
    generation.child.stdout?.destroy();

    // A generation that is no longer current has already been accounted for;
    // its exit must not disturb the session that replaced it.
    if (this.#stopped || this.#current?.id !== generation.id) return;

    this.#emit(
      spawnError === undefined
        ? { kind: "adapterExited", code, signal }
        : { kind: "adapterFailedToStart", message: describeError(spawnError) },
    );
    const killedForCancel = this.#cancelState === "killing";
    this.#clearGrace();
    this.#cancelState = "none";
    this.#current = null;

    this.#settle((pending) => {
      if (killedForCancel) pending.resolve({ stopReason: "cancelled" });
      else
        pending.reject(
          RequestError.internalError({
            reason: "the adapter exited while the turn was running",
          }),
        );
    });

    // The first handshake is the caller's to fail; respawning underneath it
    // would race `start()` and hide the failure it is waiting to hear about.
    if (this.#starting) return;

    this.#scheduleRespawn(generation);
  }

  /**
   * Replace the adapter, paced. An adapter that dies immediately and forever
   * is a misconfiguration, and the honest response is to say so and stop — not
   * to fork a replacement as fast as the kernel allows.
   */
  #scheduleRespawn(previous: Generation): void {
    // Guarded on the timer alone. An earlier version also refused while a
    // respawn's own handshake was in flight — which is exactly when the
    // replacement can die, so the death that most needed rescheduling was the
    // one it silently dropped, leaving the proxy listening with no adapter and
    // no fatal report. Both lens reviews found that wedge independently.
    if (this.#respawnTimer) return;

    const survived =
      previous.readyAt !== null &&
      Date.now() - previous.readyAt >= HEALTHY_UPTIME_MS;
    if (survived) this.#consecutiveFailures = 0;
    this.#consecutiveFailures += 1;

    if (this.#consecutiveFailures > RESPAWN_FAILURE_LIMIT) {
      this.#onFatal(
        new Error(
          `the adapter failed ${this.#consecutiveFailures} times in a row without staying up; giving up`,
        ),
      );
      return;
    }

    const delayMs = Math.min(
      RESPAWN_BASE_DELAY_MS * 2 ** (this.#consecutiveFailures - 1),
      RESPAWN_MAX_DELAY_MS,
    );
    this.#emit({
      kind: "adapterRespawning",
      attempt: this.#consecutiveFailures,
      delayMs,
    });
    this.#respawnTimer = setTimeout(() => {
      this.#respawnTimer = null;
      // Someone already succeeded — a live generation needs no replacement.
      if (this.#stopped || this.#current) return;
      this.#spawnAndHandshake().catch((error) => {
        if (this.#stopped) return;
        // Reporting only. The generation's own end — its `exit`, or the `error`
        // of a spawn that never started — already scheduled the next attempt
        // through `#onExit`, which is the one place that decides.
        this.#emit({
          kind: "adapterFailedToStart",
          message: describeError(error),
        });
      });
    }, delayMs);
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

  /**
   * Kill the adapter's whole process group.
   *
   * An ACP adapter is a process *tree* — it runs the model's tools and any MCP
   * servers as its own children. Killing only the adapter leaves those
   * orphaned, and a proxy that respawns on every crash would leak a fresh set
   * each time. The children are reachable as a group because the adapter is
   * spawned `detached`, which makes it a group leader.
   */
  #killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    const pid = child.pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, signal);
    } catch (error) {
      // ESRCH means the group is already gone — the ordinary race between a
      // child exiting and us deciding to kill it. Anything else is a real
      // failure to signal, and gets said out loud rather than swallowed.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        this.#emit({
          kind: "turnFailed",
          message: `could not signal the adapter process group: ${describeError(error)}`,
        });
      }
    }
  }
}
