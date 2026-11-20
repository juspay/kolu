import type {
  AuthoredActiveTerminal,
  SavedActiveTerminal,
  SavedSleepingTerminal,
  TerminalInfo,
} from "@kolu/padi-client/surface";
import {
  createSubmitScanner,
  type SubmitScanner,
} from "@kolu/terminal-protocol";
import {
  AuthoredActiveSchema,
  AuthoredParkedSchema,
  AuthoredSleepingSchema,
  createAuthoredActive,
  LOCAL_LOCATION,
  PersistedSnapshotSchema,
  SavedActiveTerminalSchema,
  SavedSleepingTerminalSchema,
} from "@kolu/padi-client/surface";
import type { WireSchema } from "@kolu/surface/define";
import { type Channel, inMemoryChannel } from "@kolu/surface/server";
import type {
  TerminalEvent,
  TerminalGrid,
  TerminalId,
  TerminalPorts,
  TerminalSnapshot,
  TerminalState,
} from "@kolu/terminal-vocab/schema";
import { seedSnapshot, TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import {
  AGENT_SUBMIT_KEYS,
  resumeFormFor,
  willResume,
} from "kolu-agents/vocab";
import { Effect, Result, Schema, Stream } from "effect";
import type { ForegroundSample, PtyHostClient, PtyHostListEntry } from "kaval";
import type { SnapshotGrid } from "terminal-snapshot";
import { abortableDelay } from "../abortableDelay.ts";
import { trackRecentAgent, trackRecentRepo } from "../activity/activity.ts";
import {
  markAwaitingFirstRead,
  markFirstRead,
} from "../attention/fleetGate.ts";
import type {
  EndpointGrid,
  PtySpawnOpts,
  ScreenCellsExtent,
  TerminalAttachment,
  TerminalEndpoint,
  TerminalHandle,
  TerminalHistoryChunk,
} from "../endpoint.ts";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import {
  createPortSampler,
  type PortSampler,
  type PortScanTarget,
} from "../ports/index.ts";
import {
  agentDistroSettingStore,
  newTerminalLayer,
} from "../agentDistro/agentDistro.ts";
import { probeProfileInEffect } from "../agentDistro/inEffect.ts";
import { agentLayerOfRecord, withAgentLayer } from "../agentDistro/layer.ts";
import { buildTerminalSpawnInput, ptyHostClient } from "../ptyHost/index.ts";
import type { Logger } from "pino";
import { notifyDirty } from "../publisher.ts";
import {
  type ActiveTerminalProcess,
  claimActiveTerminal,
  drainTerminals,
  familyOf,
  getActiveTerminal,
  getTerminal,
  listTerminals,
  parkedTerminalIds,
  registerTerminal,
  type SleepingTerminalProcess,
  type TerminalProcess,
  terminalNotFound,
  unregisterTerminal,
} from "../terminal-registry.ts";
import {
  cleanupTerminalScratch,
  removeTerminalScratch,
} from "../terminalScratch.ts";
import { createTerminalWorkspaceEndpoint } from "../terminalWorkspace/endpoint.ts";
import {
  type AgentIdentityRef,
  type FoldCtx,
  fold,
  restoreTargetEqual,
  seedRecencyBaseline,
  stepRecencyBaseline,
} from "../terminalWorkspace/fold.ts";
import {
  type SensorSignals,
  startSensors,
} from "../terminalWorkspace/sensors.ts";
import {
  commitSnapshot,
  dropSnapshot,
  installSnapshot,
  publishTerminalState,
  updateMemory,
  writeProfileInEffect,
} from "./metadata.ts";
import {
  type OpenedAttach,
  reattachingDeltas,
  releaseOnAbort,
} from "./reattachingDeltas.ts";

export function unresumableAgentWatch(
  id: TerminalId,
  log: Pick<Logger, "warn">,
): {
  noteRawCommand(raw: string): void;
  check(state: TerminalState): void;
} {
  let lastRawCommand: string | undefined;
  let warned = false;
  return {
    noteRawCommand(raw) {
      lastRawCommand = raw;
    },
    check(state) {
      if (state.snapshot.agent === null) {
        warned = false;
        return;
      }
      if (state.restoreTarget.kind !== "exact" || warned) return;
      if (willResume(state.restoreTarget)) return;
      warned = true;
      log.warn(
        {
          terminal: id,
          agent: state.snapshot.agent.kind,
          reason: "no-resume-form",
          resumeRef: state.snapshot.agent.sessionId,
          lastRawCommand,
        },
        "agent detected but kolu cannot render a resume form for it — this terminal will not resume across restart",
      );
    },
  };
}

const decodePersistedSnapshot = Schema.decodeUnknownSync(
  PersistedSnapshotSchema,
);
const decodeAuthoredActive = Schema.decodeUnknownSync(AuthoredActiveSchema);
const decodeAuthoredSleeping = Schema.decodeUnknownSync(AuthoredSleepingSchema);
const decodeAuthoredParked = Schema.decodeUnknownSync(AuthoredParkedSchema);
const decodeTerminalId = Schema.decodeUnknownResult(TerminalIdSchema);
const decodeSavedActive = Schema.decodeUnknownResult(SavedActiveTerminalSchema);

function registerAndInstall(id: TerminalId, entry: TerminalProcess): void {
  registerTerminal(id, entry);
  installSnapshot(id);
}

const { fs: localFs, git: localGit } = createTerminalWorkspaceEndpoint(log);

export class TerminalSpawnRacedError extends Error {
  constructor() {
    super("terminal raced during spawn (killed/slept)");
    this.name = "TerminalSpawnRacedError";
  }
}

export class PtyHostTerminalProxy implements TerminalHandle {
  pid = 0;
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: unknown) => void;

  constructor(
    private readonly id: TerminalId,
    private readonly client: PtyHostClient,
    private readonly input: {
      readonly submits: SubmitScanner;
      readonly onSubmit: () => void;
    },
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => {});
  }

  markReady(pid: number): void {
    this.pid = pid;
    this.resolveReady();
  }

  markFailed(err: unknown): void {
    this.rejectReady(err);
  }

  write(data: string): void {
    const submits = this.input.submits(data);
    void this.ready
      .then(() =>
        runEndpointEdge(
          this.client.surface.terminal.write({ id: this.id, data }),
        ),
      )
      .then(() => {
        if (submits) this.input.onSubmit();
      })
      .catch((err) => log.error({ terminal: this.id, err }, "pty-host write"));
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.ready;
    const { ok } = await runEndpointEdge(
      this.client.surface.terminal.resize({
        id: this.id,
        cols,
        rows,
      }),
    );
    if (!ok)
      log.debug(
        { terminal: this.id, cols, rows },
        "resize dropped: pty already exited on kaval's side",
      );
  }

  async getScreenState(): Promise<string> {
    await this.ready;
    const { data } = await runEndpointEdge(
      this.client.surface.terminal.getScreenState({
        id: this.id,
      }),
    );
    return data;
  }

  async getScreenText(
    startLine?: number,
    endLine?: number,
    tailRows?: number,
  ): Promise<string> {
    await this.ready;
    const extent =
      tailRows !== undefined
        ? ({ kind: "tail", lines: tailRows } as const)
        : startLine === undefined && endLine === undefined
          ? ({ kind: "full" } as const)
          : ({
              kind: "range",
              ...(startLine !== undefined && { startLine }),
              ...(endLine !== undefined && { endLine }),
            } as const);
    const { text } = await runEndpointEdge(
      this.client.surface.terminal.getScreenText({
        id: this.id,
        extent,
      }),
    );
    return text;
  }

  async getScreenCells(extent: ScreenCellsExtent): Promise<SnapshotGrid> {
    await this.ready;
    return runEndpointEdge(
      this.client.surface.terminal.getScreenCells({ id: this.id, extent }),
    );
  }

  async getHistory(
    before: number | undefined,
    max: number,
    epoch?: number,
  ): Promise<TerminalHistoryChunk> {
    await this.ready;
    return runEndpointEdge(
      this.client.surface.terminal.getHistory({
        id: this.id,
        ...(before !== undefined && { before }),
        max,
        ...(epoch !== undefined && { epoch }),
      }),
    );
  }
}

export function onForegroundTapError(id: TerminalId, err: unknown): void {
  log.error(
    { err, terminal: id },
    "pty-host foreground tap failed — keeping last foreground sample (blind)",
  );
  markFirstRead(id);
}

function runEndpointEdge<A>(
  program: Effect.Effect<A, unknown>,
  signal?: AbortSignal,
): Promise<A> {
  return Effect.runPromise(program, signal ? { signal } : undefined);
}

export function bridgeStream<T>(
  source: Stream.Stream<T, unknown>,
  signal: AbortSignal,
  onEvent: (value: T) => void,
  onError?: (err: unknown) => void,
): Promise<void> {
  return runEndpointEdge(
    Stream.runForEach(source, (value) =>
      Effect.sync(() => {
        try {
          onEvent(value);
        } catch (err) {
          log.error(
            { err },
            "pty-host tap onEvent threw (subscription kept alive)",
          );
        }
      }),
    ),
    signal,
  ).then(
    () => {},
    (err) => {
      if (signal.aborted) return;
      if (onError) {
        onError(err);
        return;
      }
      log.error({ err }, "pty-host tap subscription failed");
    },
  );
}

export const ACTIVITY_RESUBSCRIBE_DELAY_MS = 2_000;

export async function resubscribeStream<T>(opts: {
  signal: AbortSignal;
  delayMs: number;
  getStream: () => Stream.Stream<T, unknown>;
  onEvent: (value: T) => void;
  onStreamError?: (err: unknown) => void;
  onDrop: (err: unknown) => void;
}): Promise<void> {
  const { signal, delayMs, getStream, onEvent, onStreamError, onDrop } = opts;
  while (!signal.aborted) {
    try {
      await bridgeStream(getStream(), signal, onEvent, onStreamError);
    } catch (err) {
      if (signal.aborted) return;
      onDrop(err);
    }
    if (signal.aborted) return;
    await abortableDelay(delayMs, signal);
  }
}

function readScreenTextFor(id: TerminalId, tailLines: number): Promise<string> {
  const entry = getActiveTerminal(id);
  if (!entry) throw terminalNotFound(id);
  return entry.handle.getScreenText(undefined, undefined, tailLines);
}

function authoredFactsEqual(a: TerminalState, b: TerminalState): boolean {
  return (
    a.memory.lastActivityAt === b.memory.lastActivityAt &&
    a.memory.promptedAt === b.memory.promptedAt &&
    restoreTargetEqual(a.restoreTarget, b.restoreTarget)
  );
}

const PERSISTED_SNAPSHOT_KEYS = Object.keys(
  PersistedSnapshotSchema.fields,
) as (keyof TerminalSnapshot)[];

function restoreRelevantEqual(
  a: TerminalState,
  b: TerminalState,
  authoredEqual: boolean = authoredFactsEqual(a, b),
): boolean {
  return (
    authoredEqual &&
    PERSISTED_SNAPSHOT_KEYS.every((k) => a.snapshot[k] === b.snapshot[k])
  );
}

interface TerminalLifecycle {
  abort: AbortController;
  stopAwareness: () => void;
  rootPid: number;
  ports: Channel<TerminalPorts>;
  grid: Channel<TerminalGrid>;
  screenSettled: Channel<void>;
  submitted: Channel<void>;
}

function liveForeground(
  liveEntry: PtyHostListEntry,
): TerminalSnapshot["foreground"] {
  return liveEntry.foregroundProcess
    ? {
        name: liveEntry.foregroundProcess,
        title: liveEntry.title ?? null,
        shell: false,
      }
    : null;
}

function liveOverrides(
  liveAuthority: PtyHostListEntry,
): Pick<TerminalSnapshot, "cwd" | "foreground"> {
  return {
    cwd: liveAuthority.cwd,
    foreground: liveForeground(liveAuthority),
  };
}

export function adoptedSnapshot(
  savedRecord: SavedActiveTerminal,
  liveAuthority: PtyHostListEntry,
): TerminalSnapshot {
  return {
    ...seedSnapshot(liveAuthority.cwd),
    ...decodePersistedSnapshot(savedRecord),
    ...liveOverrides(liveAuthority),
  };
}

export function adoptedAuthored(
  record: SavedActiveTerminal,
): AuthoredActiveTerminal {
  return decodeAuthoredActive(record);
}

export function orphanSnapshot(liveEntry: PtyHostListEntry): TerminalSnapshot {
  return {
    ...seedSnapshot(liveEntry.cwd),
    foreground: liveForeground(liveEntry),
  };
}

class LocalTerminalEndpoint implements TerminalEndpoint {
  readonly fs = localFs;
  readonly git = localGit;

  private readonly lifecycles = new Map<TerminalId, TerminalLifecycle>();

  private portSampler: PortSampler | undefined;

  private ensurePortSampler(): PortSampler {
    if (this.portSampler !== undefined) return this.portSampler;
    const sampler = createPortSampler({
      targets: (): PortScanTarget[] =>
        [...this.lifecycles].map(([id, lc]) => ({ id, rootPid: lc.rootPid })),
      publish: (id, ports) => this.lifecycles.get(id)?.ports.publish(ports),
      rootPidOf: (id) => this.lifecycles.get(id)?.rootPid,
      publishHost: (listeners) =>
        padiSurfaceCtx.cells.hostListeners.set(listeners),
      log,
    });
    this.portSampler = sampler;
    return sampler;
  }

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const cwd = opts.cwd ?? "";
    const aw = seedSnapshot(cwd);

    const meta: AuthoredActiveTerminal = {
      ...createAuthoredActive(LOCAL_LOCATION),
    };
    if (opts.initialMetadata?.lastActivityAt !== undefined)
      meta.lastActivityAt = opts.initialMetadata.lastActivityAt;
    if (opts.initialMetadata?.promptedAt !== undefined)
      meta.promptedAt = opts.initialMetadata.promptedAt;
    if (opts.initialMetadata?.restoreTarget !== undefined)
      meta.restoreTarget = opts.initialMetadata.restoreTarget;
    if (opts.parentId) meta.parentId = opts.parentId;
    const initial = opts.initialMetadata;
    if (initial?.themeName) meta.themeName = initial.themeName;
    if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
    if (initial?.subPanel) meta.subPanel = initial.subPanel;
    if (initial?.rightPanel) meta.rightPanel = initial.rightPanel;
    if (initial?.intent) meta.intent = initial.intent;

    return this.registerActiveAndSpawn(id, meta, aw, opts).info;
  }

  private registerActiveAndSpawn(
    id: TerminalId,
    meta: AuthoredActiveTerminal,
    snapshot: TerminalSnapshot,
    opts: PtySpawnOpts,
  ): { info: TerminalInfo; wired: Promise<boolean> } {
    const tlog = log.child({ terminal: id });
    const prior = getTerminal(id);
    const proxy = this.newProxy(id);
    const stamped = withAgentLayer(meta, newTerminalLayer());
    const entry: ActiveTerminalProcess = {
      info: { id, pid: 0 },
      meta: stamped,
      snapshot,
      handle: proxy,
    };
    registerAndInstall(id, entry);
    publishTerminalState(id);

    const wired = this.spawnAndWire(id, opts, proxy, entry, prior, tlog);
    return { info: entry.info, wired };
  }

  rewireSurvivingSensors(
    id: TerminalId,
    liveEntry: PtyHostListEntry,
  ): RewireOutcome {
    const entry = getTerminal(id);
    if (!entry) return "unknown";
    const tlog = log.child({ terminal: id });
    try {
      this.installSnapshotSensors(
        id,
        liveEntry.pid,
        liveEntry.cwd,
        liveEntry.commandRooted ?? false,
      );
    } catch (err) {
      tlog.error(
        { err, pid: liveEntry.pid },
        "sensor re-wiring failed after a link heal — the terminal is LIVE and keeps running; the heal reports incomplete and retries",
      );
      return "failed";
    }
    tlog.info({ pid: liveEntry.pid }, "re-wired a surviving PTY's sensors");
    return "rewired";
  }

  noteVanishedWhileBlind(id: TerminalId): void {
    if (!getTerminal(id)) return;
    log
      .child({ terminal: id })
      .info(
        {},
        "terminal exited while the link was down — dropping it now that the daemon no longer lists it",
      );
    this.handleExit(id, EXIT_CODE_UNOBSERVED);
  }

  adoptTerminal(
    id: TerminalId,
    authored: AuthoredActiveTerminal,
    snapshot: TerminalSnapshot,
    liveEntry: PtyHostListEntry,
  ): void {
    const tlog = log.child({ terminal: id });
    const proxy = this.newProxy(id);
    const entry: ActiveTerminalProcess = {
      info: { id, pid: liveEntry.pid },
      meta: authored,
      snapshot,
      handle: proxy,
    };
    markAwaitingFirstRead(id);
    registerAndInstall(id, entry);
    proxy.markReady(liveEntry.pid);
    try {
      this.installSnapshotSensors(
        id,
        liveEntry.pid,
        liveEntry.cwd,
        liveEntry.commandRooted ?? false,
      );
    } catch (err) {
      this.killHalfWiredPty(
        id,
        entry,
        undefined,
        tlog,
        err,
        "sensor wiring failed while adopting a surviving PTY; killing the orphan",
      );
      return;
    }
    tlog.info({ pid: liveEntry.pid }, "adopted surviving PTY");
  }

  private async spawnViaClient(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: PtyHostTerminalProxy,
    expected: ActiveTerminalProcess,
  ): Promise<{
    pid: number;
    cwd: string;
    env: Readonly<Record<string, string>>;
  } | null> {
    const { res, env } = await runEndpointEdge(
      Effect.flatMap(
        buildTerminalSpawnInput({
          id,
          cwd: opts.cwd,
          agents: agentLayerOfRecord(expected.meta),
        }),
        (input) =>
          Effect.map(ptyHostClient.surface.terminal.spawn(input), (res) => ({
            res,
            env: input.env,
          })),
      ),
    );
    if (getActiveTerminal(id) !== expected) {
      proxy.markFailed(new TerminalSpawnRacedError());
      try {
        await runEndpointEdge(ptyHostClient.surface.terminal.kill({ id }));
      } catch (err) {
        log
          .child({ terminal: id })
          .error({ err }, "pty-host kill of spawn-raced terminal failed");
      }
      return null;
    }
    return { pid: res.pid, cwd: res.cwd, env };
  }

  private recordProfileInEffect(
    id: TerminalId,
    entry: ActiveTerminalProcess,
    spawned: { cwd: string; env: Readonly<Record<string, string>> },
  ): void {
    const agents = entry.meta.agents;
    if (agents === undefined) return;
    void probeProfileInEffect({
      bundle: agents.bundle,
      cwd: spawned.cwd,
      env: spawned.env,
      terminal: id,
    }).then((effective) => {
      if (effective === undefined || getActiveTerminal(id) !== entry) return;
      writeProfileInEffect(entry, id, agents, effective);
    });
  }

  private async spawnAndWire(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: PtyHostTerminalProxy,
    entry: ActiveTerminalProcess,
    prior: TerminalProcess | undefined,
    tlog: typeof log,
  ): Promise<boolean> {
    let res: Awaited<ReturnType<typeof this.spawnViaClient>>;
    try {
      res = await this.spawnViaClient(id, opts, proxy, entry);
    } catch (err) {
      tlog.error({ err }, "pty-host terminal.spawn failed");
      proxy.markFailed(err);
      this.unwindSpawnShadow(id, entry, prior);
      return false;
    }
    if (!res) return false;

    proxy.markReady(res.pid);
    entry.info = { ...entry.info, pid: res.pid };
    commitSnapshot(id, { ...entry.snapshot, cwd: res.cwd });

    try {
      this.installSnapshotSensors(id, res.pid, res.cwd, false);
    } catch (err) {
      this.killHalfWiredPty(
        id,
        entry,
        prior,
        tlog,
        err,
        "pty-host sensor wiring failed after spawn; killing the orphaned PTY",
      );
      return false;
    }
    if (opts.resumeCommand) proxy.write(`${opts.resumeCommand}\r`);
    this.recordProfileInEffect(id, entry, res);
    tlog.info({ pid: res.pid, total: listTerminals().length }, "created");
    return true;
  }

  private unwindSpawnShadow(
    id: TerminalId,
    entry: ActiveTerminalProcess,
    prior: TerminalProcess | undefined,
  ): void {
    if (getTerminal(id) !== entry) return;
    if (prior?.meta.state === "sleeping") {
      registerAndInstall(id, prior);
      publishTerminalState(id);
      return;
    }
    this.finalizeRemoval(id);
  }

  private killHalfWiredPty(
    id: TerminalId,
    entry: ActiveTerminalProcess,
    prior: TerminalProcess | undefined,
    tlog: typeof log,
    err: unknown,
    reason: string,
  ): void {
    tlog.error({ err }, reason);
    this.teardownSensors(id);
    void runEndpointEdge(ptyHostClient.surface.terminal.kill({ id })).catch(
      (killErr) =>
        tlog.error({ err: killErr }, "kill of half-wired PTY failed"),
    );
    this.unwindSpawnShadow(id, entry, prior);
  }

  private installSnapshotSensors(
    id: TerminalId,
    pid: number,
    cwd: string,
    commandRooted: boolean,
  ): void {
    this.teardownSensors(id);
    const abort = new AbortController();
    const { signal } = abort;
    const signals: SensorSignals = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel<ForegroundSample>(),
      ports: inMemoryChannel<TerminalPorts>(),
      grid: inMemoryChannel<TerminalGrid>(),
      screenSettled: inMemoryChannel<void>(),
      submitted: inMemoryChannel<void>(),
    };
    this.ensurePortSampler();
    const seedEntry = getTerminal(id)!;
    let current: TerminalState = {
      snapshot: seedEntry.snapshot,
      memory: {
        lastActivityAt: seedEntry.meta.lastActivityAt,
        promptedAt: seedEntry.meta.promptedAt,
      },
      restoreTarget: seedEntry.meta.restoreTarget ?? { kind: "none" },
    };

    let recencyBaseline: AgentIdentityRef | null = seedRecencyBaseline(
      seedEntry.meta.restoreTarget,
    );
    const runStartedAt = Date.now();
    const unresumable = unresumableAgentWatch(id, log);

    const emit = (o: TerminalEvent): void => {
      const before = current;
      const step = stepRecencyBaseline(recencyBaseline, o);
      recencyBaseline = step.baseline;
      const ctx: FoldCtx = { live: step.live, at: Date.now(), runStartedAt };
      current = fold(current, o, ctx);
      if (o.kind === "git" && o.git.kind === "repo")
        trackRecentRepo(o.git.info.mainRepoRoot, o.git.info.repoName);
      if (
        o.kind === "agent" &&
        o.agent !== "unknown" &&
        o.agent.value !== null &&
        !restoreTargetEqual(before.restoreTarget, current.restoreTarget)
      ) {
        const prev = before.restoreTarget;
        const next = current.restoreTarget;
        const replacePlaceholder =
          prev.kind === "exact" &&
          next.kind === "exact" &&
          prev.agent.sessionId === next.agent.sessionId &&
          prev.argv.length === 0 &&
          next.argv.length > 0;
        trackRecentAgent(o.agent.value.info.kind, o.agent.value.argv, {
          replacePlaceholder,
        });
      }
      if (current === before) return;
      unresumable.check(current);
      if (current.snapshot !== before.snapshot)
        commitSnapshot(id, current.snapshot);
      const authoredEqual = authoredFactsEqual(before, current);
      if (!authoredEqual)
        updateMemory(id, current.memory, current.restoreTarget);
      if (!restoreRelevantEqual(before, current, authoredEqual)) notifyDirty();
    };

    void bridgeStream(ptyHostClient.surface.cwd.get({ id }), signal, (msg) =>
      signals.cwd.publish(msg.cwd),
    );
    void bridgeStream(ptyHostClient.surface.title.get({ id }), signal, (msg) =>
      signals.title.publish(msg.title),
    );
    void bridgeStream(
      ptyHostClient.surface.commandRun.get({ id }),
      signal,
      (msg) => {
        unresumable.noteRawCommand(msg);
        signals.commandRun.publish(msg);
      },
    );
    void bridgeStream(
      ptyHostClient.surface.foreground.get({ id }),
      signal,
      (msg) =>
        signals.foreground.publish({
          process: msg.process,
          foregroundPid: msg.foregroundPid,
        }),
      (err) => onForegroundTapError(id, err),
    );
    const stopAwareness = startSensors(
      id,
      {
        pid,
        cwd,
        commandRooted,
        signals,
        readScreenText: (tailLines) => readScreenTextFor(id, tailLines),
        log,
        onAgentsRead: () => markFirstRead(id),
      },
      emit,
    );

    void bridgeStream(
      ptyHostClient.surface.exit.get({ id }),
      signal,
      (msg) => this.handleExit(id, msg.exitCode),
      (err) => {
        log.error(
          { err, terminal: id },
          "pty-host exit tap failed (non-abort) — exit signal lost; terminal may be stale until R-3 wires re-subscribe",
        );
      },
    );

    this.lifecycles.set(id, {
      abort,
      stopAwareness,
      rootPid: pid,
      ports: signals.ports,
      grid: signals.grid,
      screenSettled: signals.screenSettled,
      submitted: signals.submitted,
    });
  }

  private teardownSensors(id: TerminalId): void {
    const lc = this.lifecycles.get(id);
    if (!lc) return;
    this.lifecycles.delete(id);
    lc.abort.abort();
    lc.stopAwareness();
  }

  private finalizeRemoval(id: TerminalId): void {
    unregisterTerminal(id);
    this.publishRemoval(id);
  }

  private publishRemoval(id: TerminalId): void {
    dropSnapshot(id);
    notifyDirty();
  }

  private handleExit(id: TerminalId, exitCode: number): void {
    const entry = getTerminal(id);
    if (!entry) return;
    log.child({ terminal: id }).info({ exitCode }, "exited");
    this.teardownSensors(id);
    cleanupTerminalScratch(id);
    padiSurfaceCtx.events.terminalExit.publish({ id }, exitCode);
    this.finalizeRemoval(id);
  }

  async killTerminal(id: TerminalId): Promise<TerminalInfo | undefined> {
    const entry = claimActiveTerminal(id);
    if (!entry) return undefined;
    const tlog = log.child({ terminal: id });
    tlog.info({ pid: entry.info.pid }, "killing");
    this.teardownSensors(id);
    this.publishRemoval(id);
    try {
      await runEndpointEdge(ptyHostClient.surface.terminal.kill({ id }));
    } catch (err) {
      tlog.error({ err }, "pty-host kill failed; already unregistered");
    }
    cleanupTerminalScratch(id);
    return entry.info;
  }

  beginSleep(id: TerminalId): boolean {
    const entry = getActiveTerminal(id);
    if (!entry) return false;
    this.teardownSensors(id);
    const sleeping: SleepingTerminalProcess = {
      info: { id, pid: 0 },
      meta: decodeAuthoredSleeping({
        ...entry.meta,
        state: "sleeping",
        sleptAt: Date.now(),
      }),
      snapshot: entry.snapshot,
    };
    registerTerminal(id, sleeping);
    publishTerminalState(id);
    log
      .child({ terminal: id })
      .info("flipped to sleeping (PTY pending release)");
    return true;
  }

  async releaseSleptPty(id: TerminalId): Promise<void> {
    const slept = getTerminal(id);
    try {
      await runEndpointEdge(ptyHostClient.surface.terminal.kill({ id }));
    } catch (err) {
      log
        .child({ terminal: id })
        .error(
          { err },
          "pty-host kill failed while sleeping; record is sleeping regardless",
        );
    }
    if (getTerminal(id) !== slept) {
      log
        .child({ terminal: id })
        .info(
          "slept terminal was re-activated mid-release; keeping its scratch",
        );
      return;
    }
    cleanupTerminalScratch(id);
  }

  wakeWith(
    id: TerminalId,
    opts: { resume: boolean },
  ):
    | { info: TerminalInfo; wired: Promise<boolean>; resumed: boolean }
    | undefined {
    const entry = getTerminal(id);
    if (!entry || entry.meta.state !== "sleeping") return undefined;
    const resumeCommand = opts.resume
      ? resumeFormFor(entry.meta.restoreTarget)
      : null;
    const wokenAwareness: TerminalSnapshot = seedSnapshot(entry.snapshot.cwd);
    const meta = decodeAuthoredActive({ ...entry.meta, state: "active" });
    log
      .child({ terminal: id })
      .info({ resuming: resumeCommand !== null }, "waking");
    return {
      ...this.registerActiveAndSpawn(id, meta, wokenAwareness, {
        cwd: wokenAwareness.cwd,
        parentId: meta.parentId,
        resumeCommand: resumeCommand ?? undefined,
      }),
      resumed: resumeCommand !== null,
    };
  }

  async restartSlept(
    id: TerminalId,
  ): Promise<{ info: TerminalInfo; resumed: boolean } | undefined> {
    const slept = getTerminal(id);
    if (slept === undefined || slept.meta.state !== "sleeping")
      throw new Error(`restart(${id}): expected a freshly slept record`);
    const tlog = log.child({ terminal: id });
    try {
      await runEndpointEdge(ptyHostClient.surface.terminal.kill({ id }));
    } catch (err) {
      const live = (
        await runEndpointEdge(ptyHostClient.surface.terminal.list({}))
      ).entries.find((e) => e.id === id);
      if (live !== undefined) {
        if (getTerminal(id) === slept) {
          this.adoptTerminal(
            id,
            decodeAuthoredActive({ ...slept.meta, state: "active" }),
            slept.snapshot,
            live,
          );
          publishTerminalState(id);
        }
        tlog.error({ err }, "restart: the old PTY would not stop; kept it");
        throw new Error(
          `the terminal's shell would not stop (${err instanceof Error ? err.message : String(err)}); it keeps running as it was`,
        );
      }
      tlog.warn({ err }, "restart: kill failed but the PTY is gone; going on");
    }
    const now = getTerminal(id);
    if (now !== slept)
      return now?.meta.state === "active"
        ? {
            info: now.info,
            resumed: willResume(slept.meta.restoreTarget),
          }
        : undefined;
    const resume = agentDistroSettingStore.get().enabled;
    tlog.info({ resume }, "restarting");
    const woken = this.wakeWith(id, { resume });
    if (woken === undefined) return undefined;
    if (!(await woken.wired))
      throw new Error(
        "the new shell did not start; the terminal is asleep — wake it to try again",
      );
    const info = getTerminal(id)?.info;
    return info === undefined ? undefined : { info, resumed: woken.resumed };
  }

  private discardHandleless(
    id: TerminalId,
    expectedState: "sleeping" | "parked",
  ): boolean {
    const entry = getTerminal(id);
    if (!entry || entry.meta.state !== expectedState) return false;
    cleanupTerminalScratch(id);
    this.finalizeRemoval(id);
    log.child({ terminal: id }).info(`discarded ${expectedState} terminal`);
    return true;
  }

  discardSleeping(id: TerminalId): boolean {
    return this.discardHandleless(id, "sleeping");
  }

  discardParked(id: TerminalId): boolean {
    return this.discardHandleless(id, "parked");
  }

  discardAllParked(): void {
    for (const id of parkedTerminalIds()) this.discardParked(id);
  }

  async killAllTerminals(): Promise<void> {
    const entries = drainTerminals();
    log.info({ count: entries.length }, "killing all terminals");
    for (const entry of entries) this.teardownSensors(entry.info.id);
    for (const entry of entries) dropSnapshot(entry.info.id);
    try {
      await runEndpointEdge(ptyHostClient.surface.terminal.killAll({}));
    } catch (err) {
      log.error({ err }, "pty-host killAll failed; already drained");
    }
    await Promise.all(
      entries.map((entry) => removeTerminalScratch(entry.info.id)),
    );
  }

  noteGrid(id: TerminalId, grid: EndpointGrid): void {
    this.lifecycles.get(id)?.grid.publish(grid);
  }

  noteScreenSettled(id: TerminalId): void {
    this.lifecycles.get(id)?.screenSettled.publish();
  }

  private newProxy(id: TerminalId): PtyHostTerminalProxy {
    return new PtyHostTerminalProxy(id, ptyHostClient, {
      submits: createSubmitScanner(AGENT_SUBMIT_KEYS),
      onSubmit: () => this.lifecycles.get(id)?.submitted.publish(),
    });
  }

  async attach(
    id: TerminalId,
    signal: AbortSignal | undefined,
    resizeTo?: EndpointGrid,
  ): Promise<TerminalAttachment> {
    await getActiveTerminal(id)?.handle.ready;
    const open = async (openAt?: EndpointGrid): Promise<OpenedAttach> => {
      const iter = Stream.toAsyncIterable(
        ptyHostClient.surface.terminalAttach.get(
          openAt === undefined ? { id } : { id, resizeTo: openAt },
        ),
      )[Symbol.asyncIterator]();
      releaseOnAbort(iter, signal);
      const first = await iter.next();
      if (first.done) {
        if (signal?.aborted)
          return { snapshot: "", topLine: 0, grid: null, iter };
        throw new Error(
          `attach(${id}): stream ended before its mandatory snapshot frame`,
        );
      }
      if (first.value.kind !== "snapshot") {
        throw new Error(
          `attach(${id}): expected a snapshot first frame, got "${first.value.kind}"`,
        );
      }
      this.noteGrid(id, first.value.grid);
      return {
        snapshot: first.value.data,
        topLine: first.value.topLine,
        reflowEpoch: first.value.reflowEpoch,
        grid: first.value.grid,
        iter,
      };
    };

    const initial = await open(resizeTo);
    return {
      snapshot: initial.snapshot,
      topLine: initial.topLine,
      reflowEpoch: initial.reflowEpoch,
      grid: initial.grid,
      deltas: reattachingDeltas(() => open(), initial.iter, { id, signal }),
    };
  }
}

const localEndpointImpl = new LocalTerminalEndpoint();
export const localTerminalEndpoint: TerminalEndpoint = localEndpointImpl;

export function beginSleepLocal(id: TerminalId): boolean {
  return localEndpointImpl.beginSleep(id);
}

export function releaseSleptLocalPty(id: TerminalId): Promise<void> {
  return localEndpointImpl.releaseSleptPty(id);
}

export async function wakeSubtreeLocal(id: TerminalId): Promise<void> {
  const blocked = new Set<TerminalId>();
  for (const member of familyOf(id)) {
    const parentId = getTerminal(member)?.meta.parentId;
    if (parentId !== undefined && blocked.has(parentId)) {
      blocked.add(member);
      continue;
    }
    const woken = localEndpointImpl.wakeWith(member, { resume: true });
    if (woken === undefined) continue;
    if (!(await woken.wired)) blocked.add(member);
  }
}

export async function wakeLocalTerminal(
  id: TerminalId,
): Promise<TerminalInfo | undefined> {
  if (getTerminal(id)?.meta.state !== "sleeping") return undefined;
  let top = id;
  for (;;) {
    const parentId = getTerminal(top)?.meta.parentId;
    if (parentId === undefined) break;
    if (getTerminal(parentId)?.meta.state !== "sleeping") break;
    top = parentId;
  }
  await wakeSubtreeLocal(top);
  return getTerminal(id)?.info;
}

export function restartSleptLocal(
  id: TerminalId,
): Promise<{ info: TerminalInfo; resumed: boolean } | undefined> {
  return localEndpointImpl.restartSlept(id);
}

export type DiscardOutcome = "discarded" | "nothing" | "refused";

export function discardLocalSleeping(id: TerminalId): DiscardOutcome {
  if (getTerminal(id)?.meta.state !== "sleeping") return "nothing";
  const family = familyOf(id);
  if (family.some((member) => getTerminal(member)?.meta.state !== "sleeping"))
    return "refused";
  for (const member of family.reverse())
    localEndpointImpl.discardSleeping(member);
  return "discarded";
}

export function discardLocalParked(id: TerminalId): boolean {
  return localEndpointImpl.discardParked(id);
}

export function discardAllLocalParked(): void {
  localEndpointImpl.discardAllParked();
}

function seedHandlelessTerminal<Saved extends { id: string }>(
  record: Saved,
  {
    recordSchema,
    toEntry,
    label,
  }: {
    recordSchema: WireSchema<Saved>;
    toEntry: (
      parsed: Saved,
      base: { info: TerminalInfo; snapshot: TerminalSnapshot },
    ) => TerminalProcess;
    label: string;
  },
): boolean {
  const idParsed = decodeTerminalId(record.id);
  const recordParsed = Schema.decodeUnknownResult(recordSchema)(record);
  if (Result.isFailure(idParsed) || Result.isFailure(recordParsed)) {
    log.warn(
      { id: record.id },
      `dropping malformed record while seeding ${label} terminal`,
    );
    return false;
  }
  const id = idParsed.success;
  if (getTerminal(id)) return false;
  const parsed = recordParsed.success;
  const persisted = decodePersistedSnapshot(parsed);
  const snapshot: TerminalSnapshot = {
    ...seedSnapshot(persisted.cwd),
    ...persisted,
  };
  registerAndInstall(id, toEntry(parsed, { info: { id, pid: 0 }, snapshot }));
  return true;
}

export function seedSleepingTerminal(record: SavedSleepingTerminal): boolean {
  return seedHandlelessTerminal(record, {
    recordSchema: SavedSleepingTerminalSchema,
    toEntry: (parsed, base) => ({
      ...base,
      meta: decodeAuthoredSleeping(parsed),
    }),
    label: "sleeping",
  });
}

export function seedParkedTerminal(record: SavedActiveTerminal): boolean {
  return seedHandlelessTerminal(record, {
    recordSchema: SavedActiveTerminalSchema,
    toEntry: (parsed, base) => ({
      ...base,
      meta: decodeAuthoredParked({
        ...parsed,
        state: "parked",
        parkedAt: Date.now(),
      }),
    }),
    label: "parked",
  });
}

export type RewireOutcome = "rewired" | "unknown" | "failed";

const EXIT_CODE_UNOBSERVED = -1;

export function rewireLocalSurvivor(
  liveEntry: PtyHostListEntry,
): RewireOutcome {
  const idParsed = decodeTerminalId(liveEntry.id);
  if (Result.isFailure(idParsed)) return "unknown";
  return localEndpointImpl.rewireSurvivingSensors(idParsed.success, liveEntry);
}

export function dropVanishedTerminal(id: TerminalId): void {
  localEndpointImpl.noteVanishedWhileBlind(id);
}

export function adoptLocalTerminal(
  record: SavedActiveTerminal,
  liveEntry: PtyHostListEntry,
): boolean {
  const idParsed = decodeTerminalId(record.id);
  const recordParsed = decodeSavedActive(record);
  if (Result.isFailure(idParsed) || Result.isFailure(recordParsed)) {
    log.warn(
      { id: record.id },
      "saved record did not decode — adopting the surviving PTY as an orphan instead (it keeps its shell, not its saved chrome)",
    );
    return false;
  }
  const parsed = recordParsed.success;
  localEndpointImpl.adoptTerminal(
    idParsed.success,
    adoptedAuthored(parsed),
    adoptedSnapshot(parsed, liveEntry),
    liveEntry,
  );
  return true;
}

export function adoptLocalOrphan(
  id: TerminalId,
  liveEntry: PtyHostListEntry,
): void {
  localEndpointImpl.adoptTerminal(
    id,
    createAuthoredActive(LOCAL_LOCATION),
    orphanSnapshot(liveEntry),
    liveEntry,
  );
}

export function adoptLocalOrphanAndArmAutosave(
  id: TerminalId,
  liveEntry: PtyHostListEntry,
): void {
  adoptLocalOrphan(id, liveEntry);
  notifyDirty();
}

export function reapUnrepresentablePty(rawId: string): void {
  log.warn(
    { rawId },
    "live PTY id failed TerminalIdSchema — killing the unrepresentable PTY (fail-closed)",
  );
  void runEndpointEdge(
    ptyHostClient.surface.terminal.kill({ id: rawId }),
  ).catch((err) =>
    log.error(
      { err, rawId },
      "kill of unrepresentable PTY failed; it remains live on the daemon",
    ),
  );
}
