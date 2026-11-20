import { rmSync } from "node:fs";
import {
  DEFAULT_PADI_ROSTER,
  DEFAULT_PADI_VERSION,
  isPadiDeclaredError,
  KavalContractSkew,
  PADI_SURFACE_VERSION,
  type PadiIdentity,
  type PadiStatus,
  type PadiTerminal,
  type PadiWatchStatesInput,
  type padiSurface,
  ScratchWriteRejected,
} from "@kolu/padi-client/surface";
import {
  DEFAULT_AGENT_DISTRO_STATUS,
  EMPTY_AGENT_DISTRO_RECEIPT,
} from "@kolu/agent-distro/schema";
import { watchScopeOf } from "@kolu/padi-client/watchScope";
import { base64DecodedLength } from "@kolu/surface/frame-chunking";
import { derived, everyMsOr, source } from "@kolu/surface/reactor";
import {
  type ImplementSurfaceDeps,
  inMemoryStore,
  streamFromAbortableSource,
} from "@kolu/surface/server";
import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
import { isContractSkewError } from "@kolu/surface-daemon-supervisor";
import {
  DEFAULT_SCROLLBACK,
  UNKNOWN_HOST_LISTENERS,
} from "@kolu/terminal-vocab/schema";
import { terminalCaption } from "@kolu/terminal-vocab/terminalKey";
import { Effect } from "effect";
import {
  currentPtyHostIdentity,
  DEFAULT_MIRROR_SCROLLBACK,
  SNAPSHOT_SCROLLBACK,
} from "kaval";
import { worktreeCreate, worktreeRemove } from "kolu-git";
import type { Logger } from "pino";
import { createFinishQuiet, type FinishQuiet } from "./activity/finishQuiet.ts";
import { createLiveActivitySource } from "./activity/liveActivity.ts";
import { EMPTY_URGENCY } from "./activity/urgency.ts";
import { createEdgeMemory, type EdgeMemory } from "./attention/edgeMemory.ts";
import {
  agentDistroSettingStore,
  onAgentDistroReport,
  onAgentDistroSettingWrite,
} from "./agentDistro/agentDistro.ts";
import { agentModelLaunch, listAgentModels } from "./agentDistro/models.ts";
import { agentDistroBake } from "./agentDistro/bake.ts";
import { createEventSeq } from "./attention/eventSeq.ts";
import {
  createFleetGate,
  type FleetGate,
  setServingFleetGate,
} from "./attention/fleetGate.ts";
import {
  createSettleEvents,
  type SettleEventFeed,
} from "./attention/settleEvents.ts";
import {
  createStateWatchHub,
  type StateWatchHub,
} from "./attention/stateWatch.ts";
import { stateWatchSource } from "./attention/stateWatchStream.ts";
import {
  createWatchRegistry,
  type WatchRegistry,
} from "./attention/watchRegistry.ts";
import { specOf, watchFilterOf, watchSpecOf } from "./attention/watchSpec.ts";
import { branchPrStream } from "./branchPr.ts";
import type {
  EndpointGrid,
  TerminalAttachFrame,
  TerminalEndpoint,
} from "./endpoint.ts";
import { padiFsGitDeps } from "./fsGitDeps.ts";
import {
  HOST_INVENTORY_SAMPLE_INTERVAL_MS,
  samplePadiHostInventory,
} from "./hostInventory.ts";
import {
  MEMORY_SAMPLE_INTERVAL_MS,
  samplePadiMemory,
} from "./memorySampler.ts";
import type { PadiDiagnosticsHandle } from "./diagnostics/index.ts";
import { callScoped } from "./diagnostics/calls.ts";
import {
  newTerminalPolicyStore,
  resolveNewTerminalTheme,
} from "./newTerminalTheme.ts";
import { padiSurfaceCtx } from "./padiSurfaceCtx.ts";
import { readPreview } from "./preview.ts";
import {
  onDaemonStatusChange,
  readDaemonStatus,
  readDaemonStatuses,
} from "./ptyHost/daemonStatus.ts";
import { recycleLocalKaval } from "./ptyHost/restartLocal.ts";
import { pulseSource } from "./pulseSource.ts";
import { renderScreenImage } from "./screenImage.ts";
import { readScreenTail } from "./screenTextTail.ts";
import { onSavedSessionWrite } from "./session/autosaveGate.ts";
import {
  requirePadiActivityFeedStore,
  requirePadiSessionStore,
} from "./session/confStores.ts";
import { resumableTerminalIds } from "./session/resumable.ts";
import {
  forfeitSession,
  importSession,
  restoreSession,
} from "./session/sessionRestore.ts";
import {
  listPadiStateBackups,
  restorePadiStateBackup,
} from "./session/stateBackups.ts";
import {
  getActiveTerminal,
  getTerminal,
  registryMap,
  requireActiveTerminal,
  requireMutableTerminal,
  snapshotFor,
  terminalIds,
  terminalNotFound,
} from "./terminal-registry.ts";
import {
  discardLocalSleeping,
  wakeLocalTerminal,
} from "./terminalEndpoint/local.ts";
import { composePadiTerminal } from "./terminalEndpoint/metadata.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
import { appendTerminalFile, saveTerminalFile } from "./terminalScratch.ts";
import {
  createTerminal,
  killAllTerminals,
  killTerminal,
  setActiveTerminalId,
  setCanvasLayout,
  setRightPanelState,
  setSubPanelState,
  setTerminalIntent,
  setTerminalParent,
  setTerminalTheme,
  requireAttachableTerminal,
  restartTerminal,
  sleepTerminal,
} from "./terminals.ts";
import { unwrapGit } from "./terminalWorkspace/endpoint.ts";
import { exportTranscriptHtml } from "./transcript/transcript.ts";
import { rejectionFor } from "@kolu/padi-client/upload";

if (DEFAULT_SCROLLBACK < DEFAULT_MIRROR_SCROLLBACK + SNAPSHOT_SCROLLBACK) {
  throw new Error(
    `scrollback-backfill headroom violated: client DEFAULT_SCROLLBACK (${DEFAULT_SCROLLBACK}) < mirror (${DEFAULT_MIRROR_SCROLLBACK}) + snapshot (${SNAPSHOT_SCROLLBACK}); the client buffer cannot hold the full reachable history`,
  );
}

type PadiDeps = ImplementSurfaceDeps<typeof padiSurface.spec>;

/** Bridge a procedure body: a DECLARED error (one the surface spec names, per
 *  `isPadiDeclaredError`) fails the effect so the client receives it; anything
 *  else is a defect and dies. */
function handleDeclared<A, E>(
  body: (signal: AbortSignal) => A | Promise<A>,
): Effect.Effect<A, E> {
  return callScoped(body, (attempt) =>
    Effect.catch(attempt, (err) =>
      isPadiDeclaredError(err)
        ? Effect.fail(err as E)
        : (Effect.die(err) as Effect.Effect<A, E>),
    ),
  );
}

/** {@link handleDeclared} for a body that is already an effect. */
function handleEffectDeclared<A, E>(
  body: Effect.Effect<A, unknown>,
): Effect.Effect<A, E> {
  return Effect.catch(body, (err) =>
    isPadiDeclaredError(err)
      ? Effect.fail(err as E)
      : (Effect.die(err) as Effect.Effect<A, E>),
  );
}

function pollRead<A>(program: Effect.Effect<A, unknown>): () => Promise<A> {
  return () => Effect.runPromise(program);
}

async function* attachFrames(
  id: string,
  resizeTo: EndpointGrid | undefined,
  signal: AbortSignal,
): AsyncGenerator<TerminalAttachFrame> {
  const entry = await requireAttachableTerminal(id);
  const { snapshot, topLine, reflowEpoch, grid, deltas } =
    await resolveTerminalEndpoint(entry.meta.location).attach(
      id,
      signal,
      resizeTo,
    );
  if (grid !== null) {
    yield { kind: "snapshot", data: snapshot, topLine, reflowEpoch, grid };
  }
  for await (const frame of deltas) yield frame;
}

const scopeRefused = (message: string, idField: "id" | "ids"): Error =>
  new Error(
    `${message} Omit \`${idField}\` to watch the whole fleet, or drop it from \`ignoreIds\`.`,
  );

let disposeStanding: (() => void) | undefined;

type PadiProcedures = NonNullable<PadiDeps["procedures"]>;

function padiCells(deps: {
  commit: string;
  startedAt: number;
  lifetime: DaemonLifetimeInfo;
  stateRoot: string;
  fleetGate: FleetGate;
  finish: FinishQuiet;
  watchEdges: EdgeMemory;
  settleEvents: SettleEventFeed;
  stateWatch: StateWatchHub;
}): NonNullable<PadiDeps["cells"]> {
  const {
    commit,
    startedAt,
    lifetime,
    stateRoot,
    fleetGate,
    finish,
    watchEdges,
    settleEvents,
    stateWatch,
  } = deps;

  const identity = currentPtyHostIdentity();
  const status: PadiStatus = {
    ...(identity.staleKey ? { expectedKaval: identity } : {}),
  };
  const padiIdentity: PadiIdentity = {
    commit: commit || null,
    surfaceVersion: PADI_SURFACE_VERSION,
    startedAt,
    lifetime,
  };

  return {
    version: { store: inMemoryStore(DEFAULT_PADI_VERSION) },
    identity: { store: inMemoryStore(padiIdentity) },
    roster: { store: inMemoryStore(DEFAULT_PADI_ROSTER) },
    status: { store: inMemoryStore(status) },
    newTerminalPolicy: { store: newTerminalPolicyStore },
    agentDistro: {
      store: agentDistroSettingStore,
      onWrite: onAgentDistroSettingWrite,
    },
    agentDistroStatus: {
      store: inMemoryStore(DEFAULT_AGENT_DISTRO_STATUS),
    },
    agentDistroReceipt: {
      store: inMemoryStore(EMPTY_AGENT_DISTRO_RECEIPT),
    },
    hostListeners: { store: inMemoryStore(UNKNOWN_HOST_LISTENERS) },
    hostInventory: derived.cell(
      source({
        label: "hostInventory",
        read: pollRead(samplePadiHostInventory(stateRoot)),
        install: everyMsOr(
          HOST_INVENTORY_SAMPLE_INTERVAL_MS,
          onDaemonStatusChange,
        ),
      }),
    ),
    processMemory: derived.cell(
      source({
        label: "processMemory",
        read: pollRead(samplePadiMemory),
        install: everyMsOr(MEMORY_SAMPLE_INTERVAL_MS, onDaemonStatusChange),
      }),
    ),
    urgency: derived.cell(($) => {
      const terminals = $.terminals();
      if (!fleetGate.admit(terminals)) {
        return EMPTY_URGENCY;
      }
      const next = finish.project(terminals);
      watchEdges.observe(terminals);
      settleEvents.observe(next, terminals);
      stateWatch.observe(terminals);
      return next;
    }),
    session: {
      store: {
        get: () => {
          const s = requirePadiSessionStore().get();
          if (!s || s.terminals.length === 0) return null;
          return {
            ...s,
            resumableIds: resumableTerminalIds(s.terminals),
          };
        },
        set: (v) => {
          if (v === null) {
            requirePadiSessionStore().set(null);
            return;
          }
          (v as { resumableIds?: readonly string[] }).resumableIds =
            resumableTerminalIds(v.terminals);
          requirePadiSessionStore().set({
            terminals: v.terminals,
            activeTerminalId: v.activeTerminalId,
            savedAt: v.savedAt,
          });
        },
      },
      equals: (a, b) => {
        const disk = (s: typeof a) => {
          if (s === null) return null;
          const { resumableIds: _drop, ...rest } = s;
          return rest;
        };
        return JSON.stringify(disk(a)) === JSON.stringify(disk(b));
      },
      onWrite: (next) =>
        onSavedSessionWrite(requirePadiSessionStore().get(), next),
    },
    activityFeed: {
      store: {
        get: () => requirePadiActivityFeedStore().get(),
        set: (v) => requirePadiActivityFeedStore().set(v),
      },
    },
  };
}

function padiCollections(): NonNullable<PadiDeps["collections"]> {
  return {
    terminals: {
      readAll: () => registryMap<PadiTerminal>(composePadiTerminal),
      readOne: (key) => {
        const entry = getTerminal(key);
        return entry ? composePadiTerminal(entry) : undefined;
      },
      upsert: () => {},
      remove: () => {},
      materializeSiblingView: true,
    },

    daemonStatus: {
      readAll: () => readDaemonStatuses(),
      readOne: (key) => readDaemonStatus(key),
      upsert: () => {},
      remove: () => {},
    },
  };
}

function padiStreams(deps: {
  log: Logger;
  watchRegistry: WatchRegistry;
  stateWatch: StateWatchHub;
  fsGitStreams: Pick<
    NonNullable<PadiDeps["streams"]>,
    "subscribeRepoChange" | "subscribeFileChange"
  >;
}): NonNullable<PadiDeps["streams"]> {
  const { log, watchRegistry, stateWatch, fsGitStreams } = deps;
  return {
    activity: createLiveActivitySource(log),
    watchPulse: {
      source: (input: { name: string }) =>
        pulseSource(
          (onEvent) => watchRegistry.onPulse(input.name, onEvent),
          log,
          `watchPulse[${input.name}]`,
        ),
    },
    watchStates: {
      source: (input: PadiWatchStatesInput) => {
        const spec = watchSpecOf(input);
        if (spec.kind === "error") throw scopeRefused(spec.message, "id");
        return stateWatchSource(stateWatch, spec.value, log);
      },
    },
    ...fsGitStreams,
    pullRequest: {
      source: ({ repoPath, branch }) =>
        branchPrStream({ repoPath, branch }, log),
    },
    terminalAttach: {
      source: ({ id, resizeTo }) =>
        streamFromAbortableSource((signal) =>
          attachFrames(id, resizeTo, signal),
        ),
    },
  };
}

function padiEvents(): NonNullable<PadiDeps["events"]> {
  return {
    terminalExit: {
      source: (input, { bus }) =>
        streamFromAbortableSource((signal) =>
          (async function* exitFrames(): AsyncGenerator<number> {
            if (!getTerminal(input.id)) throw terminalNotFound(input.id);
            for await (const exitCode of bus.subscribe(signal)) {
              yield exitCode;
              return;
            }
          })(),
        ),
    },
  };
}

function watchProcedures(deps: {
  log: Logger;
  watchRegistry: WatchRegistry;
}): PadiProcedures["watch"] {
  const { log, watchRegistry } = deps;
  return {
    open: ({ input }) =>
      handleDeclared(() => {
        const filter = watchFilterOf(input);
        if (filter.kind === "error") {
          throw new Error(
            `standing subscription "${input.name}": ${filter.message}`,
          );
        }
        const filterValue = filter.value;
        const scope = watchScopeOf({
          ...(input.ids === undefined ? {} : { ids: input.ids }),
          ...(input.ignoreIds === undefined ? {} : { mute: input.ignoreIds }),
        });
        if (scope.kind === "error") {
          const refused = scopeRefused(scope.message, "ids");
          throw new Error(
            `standing subscription "${input.name}": ${refused.message}`,
          );
        }
        const { sub, reattached } = watchRegistry.open(input.name, {
          scope: scope.value,
          ...(filterValue === undefined ? {} : { filter: filterValue }),
        });
        log.info(
          {
            name: input.name,
            reattached,
            scope: input.ids === undefined ? "all" : input.ids.length,
            ...(filterValue === undefined
              ? {}
              : { ...filterValue, states: [...filterValue.states] }),
          },
          reattached
            ? "watch subscription re-attached"
            : "watch subscription opened",
        );
        return {
          name: sub.name,
          acknowledged: sub.acknowledged,
          reattached,
        };
      }),
    drain: ({ input }) =>
      handleDeclared(() => watchRegistry.drain(input.name, input.after)),
    close: ({ input }) =>
      handleDeclared(() => {
        watchRegistry.close(input.name);
        return {};
      }),
  };
}

function lifecycleProcedures(log: Logger): PadiProcedures["lifecycle"] {
  return {
    create: ({ input }) =>
      handleDeclared(() => {
        if (input.placement.kind === "child-of")
          requireActiveTerminal(input.placement.parentId);
        const info = createTerminal(input.placement, input.cwd, {
          themeName:
            input.themeName ??
            (input.placement.kind === "toplevel"
              ? resolveNewTerminalTheme()
              : undefined),
          canvasLayout: input.canvasLayout,
          subPanel: input.subPanel,
          rightPanel: input.rightPanel,
          intent: input.intent,
        });
        return info;
      }),
    kill: ({ input }) =>
      handleDeclared(async () => {
        const info = await killTerminal(input.id);
        if (!info) throw terminalNotFound(input.id);
        return info;
      }),
    killAll: () => handleDeclared(() => killAllTerminals()),
    sleep: ({ input }) =>
      handleDeclared(() => {
        log.info({ terminal: input.id }, "sleep");
        return sleepTerminal(input.id);
      }),
    wake: ({ input }) =>
      handleDeclared(async () => {
        log.info({ terminal: input.id }, "wake");
        const info = await wakeLocalTerminal(input.id);
        if (!info) throw terminalNotFound(input.id);
        return info;
      }),
    restart: ({ input }) =>
      handleDeclared(async () => {
        log.info({ terminal: input.id }, "restart");
        const restarted = await restartTerminal(input.id);
        if (!restarted) throw terminalNotFound(input.id);
        const meta = getTerminal(input.id)?.meta;
        const agents = meta?.state === "active" ? meta.agents : undefined;
        return {
          ...restarted.info,
          ...(agents === undefined ? {} : { agents }),
          resumed: restarted.resumed,
        };
      }),
    discardSleeping: ({ input }) =>
      handleDeclared(() => {
        log.info({ terminal: input.id }, "discard sleeping");
        if (discardLocalSleeping(input.id) === "refused")
          throw terminalNotFound(input.id);
      }),
    resize: ({ input }) =>
      handleDeclared(async () => {
        const entry = getActiveTerminal(input.id);
        if (!entry) return;
        await entry.handle.resize(input.cols, input.rows);
        resolveTerminalEndpoint(entry.meta.location).noteGrid(input.id, {
          cols: input.cols,
          rows: input.rows,
        });
      }),
    sendInput: ({ input }) =>
      handleDeclared(() => {
        getActiveTerminal(input.id)?.handle.write(input.data);
      }),
    recycleKaval: () =>
      handleEffectDeclared(
        Effect.gen(function* () {
          yield* Effect.catch(recycleLocalKaval("Restart kaval"), (err) => {
            if (isContractSkewError(err)) {
              return Effect.fail(
                new KavalContractSkew({
                  daemonVersion: err.daemonVersion,
                  requiredVersion: err.requiredVersion,
                }),
              );
            }
            return Effect.fail(err);
          });
        }),
      ),
  };
}

function chromeProcedures(log: Logger): PadiProcedures["chrome"] {
  return {
    setTheme: ({ input }) =>
      handleDeclared(() => {
        requireMutableTerminal(input.id);
        log.info({ terminal: input.id, theme: input.themeName }, "set theme");
        setTerminalTheme(input.id, input.themeName);
      }),
    setIntent: ({ input }) =>
      handleDeclared(() => {
        requireMutableTerminal(input.id);
        log.info(
          { terminal: input.id, intentLength: input.intent.length },
          "set intent",
        );
        setTerminalIntent(input.id, input.intent);
      }),
    setParent: ({ input }) =>
      handleDeclared(() => {
        requireMutableTerminal(input.id);
        log.info(
          { terminal: input.id, parent: input.parentId },
          "set terminal parent",
        );
        setTerminalParent(input.id, input.parentId);
      }),
    setActive: ({ input }) =>
      handleDeclared(() => {
        setActiveTerminalId(input.id);
      }),
    setCanvasLayout: ({ input }) =>
      handleDeclared(() => {
        requireMutableTerminal(input.id);
        setCanvasLayout(input.id, input.layout);
      }),
    setSubPanel: ({ input }) =>
      handleDeclared(() => {
        requireMutableTerminal(input.id);
        setSubPanelState(input.id, {
          collapsed: input.collapsed,
          panelSize: input.panelSize,
        });
      }),
    setRightPanel: ({ input }) =>
      handleDeclared(() => {
        requireMutableTerminal(input.id);
        const { id: _id, ...state } = input;
        setRightPanelState(input.id, state);
      }),
  };
}

function screenProcedures(): PadiProcedures["screen"] {
  return {
    state: ({ input }) =>
      handleDeclared(() =>
        requireActiveTerminal(input.id).handle.getScreenState(),
      ),
    text: ({ input }) =>
      handleDeclared(() => {
        const entry = requireActiveTerminal(input.id);
        const { tail } = input;
        if (tail === undefined) {
          return entry.handle.getScreenText(input.startLine, input.endLine);
        }
        return readScreenTail(
          (window) => entry.handle.getScreenText(undefined, undefined, window),
          tail,
          entry.snapshot.grid?.rows ?? 0,
        );
      }),
    history: ({ input }) =>
      handleDeclared(() =>
        requireActiveTerminal(input.id).handle.getHistory(
          input.before,
          input.max,
          input.epoch,
        ),
      ),
    image: ({ input }) =>
      handleDeclared(async () => {
        const entry = requireActiveTerminal(input.id);
        const grid = await entry.handle.getScreenCells(
          input.lines === undefined
            ? { kind: "viewport" }
            : { kind: "tail", lines: input.lines },
        );
        return renderScreenImage({
          grid,
          themeName: entry.meta.themeName,
          label: terminalCaption(entry.snapshot),
        });
      }),
  };
}

function fsProcedures(endpoint: TerminalEndpoint): PadiProcedures["fs"] {
  return {
    listAll: ({ input }) =>
      handleDeclared(() => endpoint.fs.listAll(input.repoPath)),
    listIgnored: ({ input }) =>
      handleDeclared(() => endpoint.fs.listIgnored(input.repoPath)),
    listDirectory: ({ input }) =>
      handleDeclared(() =>
        endpoint.fs.listDirectory(input.repoPath, input.dirPath),
      ),
    readFile: ({ input }) =>
      handleDeclared(() =>
        endpoint.fs.readFile(input.repoPath, input.filePath),
      ),
    filePreviewTag: ({ input }) =>
      handleDeclared((signal) =>
        endpoint.fs.filePreviewTag(input.repoPath, input.filePath, signal),
      ),
  };
}

function gitProcedures(
  endpoint: TerminalEndpoint,
  log: Logger,
): PadiProcedures["git"] {
  return {
    getStatus: ({ input }) =>
      handleDeclared(() => endpoint.git.getStatus(input.repoPath, input.mode)),
    getDiff: ({ input }) =>
      handleDeclared(() =>
        endpoint.git.getDiff(
          input.repoPath,
          input.filePath,
          input.mode,
          input.oldPath,
        ),
      ),
    worktreeCreate: ({ input }) =>
      handleDeclared(async () => {
        log.info({ repo: input.repoPath, name: input.name }, "worktree create");
        const result = unwrapGit(
          await worktreeCreate(input.repoPath, input.name, log),
        );
        log.info(
          {
            repo: input.repoPath,
            path: result.path,
            branch: result.branch,
          },
          "worktree created",
        );
        return result;
      }),
    worktreeRemove: ({ input }) =>
      handleDeclared(async () => {
        log.info({ worktree: input.worktreePath }, "worktree remove");
        unwrapGit(await worktreeRemove(input.worktreePath, log));
      }),
  };
}

function scratchProcedures(): PadiProcedures["scratch"] {
  return {
    write: ({ input }) =>
      handleDeclared(() => {
        requireActiveTerminal(input.terminalId);
        const bytes = base64DecodedLength(input.data);
        if (input.appendTo === undefined) {
          const reason = rejectionFor(input.name, bytes);
          if (reason !== null) throw new ScratchWriteRejected({ reason });
          return {
            path: saveTerminalFile(input.terminalId, input.name, input.data),
          };
        }
        let appended: { path: string; totalBytes: number };
        try {
          appended = appendTerminalFile(
            input.terminalId,
            input.appendTo,
            input.data,
          );
        } catch (cause) {
          throw new ScratchWriteRejected({
            reason: `Upload chunk refused: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        }
        const reason = rejectionFor(input.name, appended.totalBytes);
        if (reason !== null) {
          rmSync(appended.path, { force: true });
          throw new ScratchWriteRejected({ reason });
        }
        return { path: appended.path };
      }),
  };
}

/** Assemble the FULL `padiSurface` server deps (minus `channel`) — every cell,
 *  collection, stream, event and procedure group the daemon serves. */
export function buildPadiSurfaceDeps(deps: {
  endpoint: TerminalEndpoint;
  log: Logger;
  startedAt: number;
  commit: string;
  lifetime: DaemonLifetimeInfo;
  stateRoot: string;
  diagnostics: PadiDiagnosticsHandle;
}): PadiDeps {
  const { endpoint, log, startedAt, commit, lifetime, stateRoot, diagnostics } =
    deps;
  agentDistroBake();
  const fsGit = padiFsGitDeps(endpoint, log);
  disposeStanding?.();
  disposeStanding = undefined;
  const finish = createFinishQuiet({
    log,
    onSettled: (id) => {
      const entry = getActiveTerminal(id);
      if (entry)
        resolveTerminalEndpoint(entry.meta.location).noteScreenSettled(id);
    },
  });

  const watchSeq = createEventSeq();
  const watchEdges = createEdgeMemory();
  const fleetGate = createFleetGate({
    publish: (roster) => {
      padiSurfaceCtx.cells.roster.set(roster);
    },
    census: terminalIds,
  });
  setServingFleetGate(fleetGate);
  const settleEvents = createSettleEvents({
    log,
    seq: watchSeq,
    edges: watchEdges,
  });
  const stateWatch = createStateWatchHub({
    log,
    seq: watchSeq,
    edges: watchEdges,
  });
  const watchRegistry = createWatchRegistry({
    log,
    daemonSeq: () => watchSeq.last(),
    subscribeStates: (filter, scope, emit, seed) =>
      stateWatch.subscribe(specOf(filter, scope), emit, seed),
  });
  const unsubscribeSettle = settleEvents.onFrame((events) =>
    watchRegistry.acceptSettle(events),
  );
  disposeStanding = () => {
    setServingFleetGate(null);
    fleetGate.dispose();
    unsubscribeSettle();
    watchRegistry.dispose();
    stateWatch.dispose();
    settleEvents.dispose();
    watchEdges.dispose();
    finish.dispose();
  };
  return {
    cells: padiCells({
      commit,
      startedAt,
      lifetime,
      stateRoot,
      fleetGate,
      finish,
      watchEdges,
      settleEvents,
      stateWatch,
    }),

    collections: padiCollections(),

    streams: padiStreams({
      log,
      watchRegistry,
      stateWatch,
      fsGitStreams: fsGit.streams,
    }),

    events: padiEvents(),

    procedures: diagnostics.timeProcedures({
      watch: watchProcedures({ log, watchRegistry }),
      lifecycle: lifecycleProcedures(log),

      chrome: chromeProcedures(log),

      screen: screenProcedures(),

      fs: fsProcedures(endpoint),

      git: gitProcedures(endpoint, log),

      scratch: scratchProcedures(),

      preview: {
        read: ({ input }) => readPreview(input),
        repoRootForTerminal: ({ input }) =>
          handleDeclared(() => {
            const git = snapshotFor(input.terminalId)?.git;
            return {
              repoRoot: git?.kind === "repo" ? git.info.repoRoot : null,
            };
          }),
      },

      transcript: {
        exportHtml: ({ input }) =>
          handleDeclared(() => exportTranscriptHtml(input)),
      },

      agentDistro: {
        report: ({ input }) => handleDeclared(() => onAgentDistroReport(input)),
        models: ({ input }) => handleEffectDeclared(listAgentModels(input)),
        launch: ({ input }) => handleDeclared(() => agentModelLaunch(input)),
      },
      session: {
        restore: ({ input }) => handleDeclared(() => restoreSession(input)),
        import: ({ input }) => handleDeclared(() => importSession(input)),
        forfeit: () => handleDeclared(() => forfeitSession(stateRoot)),
      },

      backups: {
        list: () => handleDeclared(() => listPadiStateBackups(stateRoot)),
        restore: ({ input }) =>
          handleDeclared(() => restorePadiStateBackup(stateRoot, input)),
      },

      diagnostics: {
        read: () => handleDeclared(() => diagnostics.read()),
      },
    }),
  };
}
