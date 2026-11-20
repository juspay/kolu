import { publisher } from "@kolu/padi/assembly";
import type { PadiProcessMemory } from "@kolu/padi-client/surface";
import {
  computed,
  derived,
  everyMsOr,
  scan,
  source,
} from "@kolu/surface/reactor";
import {
  type CellStore,
  confStore,
  type ImplementSurfaceDeps,
  inMemoryCollection,
  inMemoryStore,
  implementSurfacesOnPublisher,
  publisherChannel,
  type SurfaceHandlers,
} from "@kolu/surface/server";
import { surfaceAppServer } from "@kolu/surface-app/server";
import type {
  AgentDistroSetting,
  AgentProfiles,
} from "@kolu/agent-distro/schema";
import type { HostKey } from "kolu-common/hostKey";
import { agentDistroSettingOf } from "@kolu/agent-distro/status";
import { Effect } from "effect";
import type { RpcGroup } from "effect/rpc";
import type {
  AgentDistroListing,
  ForwardCreateInput,
  Forwards,
  KoluBuildInfo,
  KoluForward,
  NewTerminalPolicy,
  PadiLink,
  Preferences,
  ProcessStartedAt,
  ViewerMode,
} from "kolu-common/surface";
import {
  type DaemonInventory,
  DEFAULT_DAEMON_INVENTORY,
  type koluSurface,
  resolveNewTerminalPolicy,
  surfaces,
} from "kolu-common/surface";
import { koluWireGroup } from "kolu-common/surfacesWithPadi";
import type { MemberReading } from "kolu-common/works";
import { serverCommit, serverStartedAt, serverVersion } from "./hostname.ts";
import { log } from "./log.ts";
import {
  MEMORY_SAMPLE_INTERVAL_MS,
  sampleServerMemory,
} from "./memorySampler.ts";
import { DAEMON_INVENTORY_SAMPLE_INTERVAL_MS } from "./padi/daemonInventory.ts";
import { FORWARD_REAP_INTERVAL_MS } from "./portForward/forwards.ts";
import { conductorSurfaceMembers } from "kolu-conductor/surface";
import type { ConductorState, ConductorStoreKey } from "kolu-common/conductor";
import { ConductorRefused } from "kolu-common/conductorErrors";
import { recoverConductorStore } from "./conductorRecovery.ts";
import { type Work, type WorkMember, WorkRefusal } from "kolu-work";
import {
  liveServerConductor,
  setConductorCellWriter,
  setWorksCollectionWriters,
} from "./conductor/live.ts";
import { store } from "./state.ts";

export const servedGroup = koluWireGroup;

// biome-ignore lint/suspicious/noExplicitAny: `RpcGroup` is invariant in its element union, so no precisely-typed group is assignable to `RpcGroup<Rpc.Any>`.
export type ErasedRpcGroup = RpcGroup.RpcGroup<any>;

export interface ServedFragment {
  readonly group: ErasedRpcGroup;
  readonly handlers: SurfaceHandlers;
}

export function assembleServedHandlers(parts: {
  readonly kolu: ServedFragment;
  readonly padiMap: ServedFragment;
  readonly root: ServedFragment;
}): SurfaceHandlers {
  const handlers: SurfaceHandlers = Object.assign(
    Object.create(null) as SurfaceHandlers,
    parts.kolu.handlers,
    parts.padiMap.handlers,
    parts.root.handlers,
  );
  const bound = new Set(Object.keys(handlers));
  const advertised = new Set(servedGroup.requests.keys());
  const missing = [...advertised].filter((tag) => !bound.has(tag));
  const orphaned = [...bound].filter((tag) => !advertised.has(tag));
  if (missing.length > 0 || orphaned.length > 0) {
    throw new Error(
      `kolu-server: the served handler set does not match the served group — ` +
        `${missing.length} advertised tag(s) with no handler (${missing.slice(0, 8).join(", ")}` +
        `${missing.length > 8 ? ", …" : ""}), ` +
        `${orphaned.length} handler(s) at unminted tag(s) (${orphaned.slice(0, 8).join(", ")}` +
        `${orphaned.length > 8 ? ", …" : ""}).`,
    );
  }
  return handlers;
}

const preferencesStore: CellStore<Preferences> = confStore<Preferences>(
  store,
  "preferences",
);

const viewerModeStore: CellStore<ViewerMode> = confStore<ViewerMode>(
  store,
  "viewerMode",
);

export function currentNewTerminalPolicy(): NewTerminalPolicy {
  return resolveNewTerminalPolicy(
    preferencesStore.get(),
    viewerModeStore.get(),
  );
}

const agentProfilesStore: CellStore<AgentProfiles> =
  inMemoryStore<AgentProfiles>([]);

export function currentAgentDistroSetting(): AgentDistroSetting {
  return agentDistroSettingOf(preferencesStore.get().agentDistro);
}

export interface PadiRailState {
  link: PadiLink;
  padiStartedAt: number | null;
}

export interface KoluSurfaceDeps {
  readPadiMemory: () => Promise<PadiProcessMemory | null>;
  readDaemonInventory: () => Promise<DaemonInventory>;
  onState: (cb: (state: PadiRailState) => void) => () => void;
  forwards: {
    read: () => Promise<Forwards>;
    onChange: (tick: () => void) => () => void;
    create: (input: ForwardCreateInput) => Promise<KoluForward>;
    cancel: (key: string) => Promise<void>;
  };
  onPolicyInputsChanged: () => void;
  onAgentDistroChanged: () => void;
  deliverAgents: (host: HostKey | null) => void;
  agentDistroListing: AgentDistroListing;
}

export interface StoreCellWriters {
  setPreferences: (value: Preferences) => void;
  setViewerMode: (value: ViewerMode) => void;
}

function handOver(act: () => void): Effect.Effect<void, ConductorRefused> {
  return Effect.suspend(() => {
    try {
      act();
      return Effect.void;
    } catch (err) {
      return err instanceof WorkRefusal
        ? Effect.fail(new ConductorRefused({ why: err.message }))
        : Effect.die(err);
    }
  });
}

type KoluSurfaceSpecDeps = ImplementSurfaceDeps<typeof koluSurface.spec>;
type ConductorProcedures = Omit<
  NonNullable<KoluSurfaceSpecDeps["procedures"]>["conductor"],
  | "takeOver"
  | "handBack"
  | "stopWork"
  | "reopenWork"
  | "recoverStore"
  | "answerWork"
>;

function koluCells(
  deps: KoluSurfaceDeps,
  conductorState: ConductorState,
): KoluSurfaceSpecDeps["cells"] {
  const readDaemonInventoryTotal = async (): Promise<DaemonInventory> => {
    try {
      return await deps.readDaemonInventory();
    } catch (err) {
      log.error({ err }, "daemon-inventory sample failed");
      return DEFAULT_DAEMON_INVENTORY;
    }
  };

  const padiRail = scan<PadiRailState, PadiRailState>(
    source<PadiRailState>(deps.onState),
    { link: "connecting", padiStartedAt: null },
    (_prev, state) => state,
  );

  return {
    preferences: {
      store: preferencesStore,
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      onMutate: (patch) =>
        log.info(
          {
            keys: Object.keys(patch),
            rightPanel: patch.rightPanel
              ? Object.keys(patch.rightPanel)
              : undefined,
          },
          "preferences update",
        ),
      onWrite: () => {
        deps.onPolicyInputsChanged();
        deps.onAgentDistroChanged();
      },
    },
    agentDistroListing: { store: inMemoryStore(deps.agentDistroListing) },
    agentProfiles: { store: agentProfilesStore },
    viewerMode: {
      store: viewerModeStore,
      onWrite: () => deps.onPolicyInputsChanged(),
    },
    processMemory: derived.cell(
      source({
        label: "processMemory",
        read: () => sampleServerMemory(deps.readPadiMemory),
        install: everyMsOr(MEMORY_SAMPLE_INTERVAL_MS, deps.onState),
      }),
    ),
    padiLink: derived.cell(computed(() => padiRail.value.value.link)),
    processStartedAt: derived.cell(
      computed<ProcessStartedAt>(() => ({
        server: serverStartedAt,
        padi: padiRail.value.value.padiStartedAt,
      })),
    ),
    daemonInventory: derived.cell(
      source({
        label: "daemonInventory",
        read: readDaemonInventoryTotal,
        install: everyMsOr(DAEMON_INVENTORY_SAMPLE_INTERVAL_MS, deps.onState),
      }),
    ),
    forwards: derived.cell(
      source({
        label: "forwards",
        read: deps.forwards.read,
        install: everyMsOr(FORWARD_REAP_INTERVAL_MS, deps.forwards.onChange),
      }),
    ),
    conductor: { store: inMemoryStore(conductorState) },
  };
}

function koluCollections(): KoluSurfaceSpecDeps["collections"] {
  return {
    works: inMemoryCollection<string, Work>(),
    workMembers: inMemoryCollection<string, WorkMember>(),
    memberReadings: inMemoryCollection<string, MemberReading>(),
  };
}

function koluProcedures(
  deps: KoluSurfaceDeps,
  conductorProcedures: ConductorProcedures,
): KoluSurfaceSpecDeps["procedures"] {
  return {
    forwards: {
      create: ({ input }) => Effect.promise(() => deps.forwards.create(input)),
      cancel: ({ input }) =>
        Effect.promise(() => deps.forwards.cancel(input.key)),
    },
    agentDistro: {
      deliver: ({ input }) => Effect.sync(() => deps.deliverAgents(input.host)),
    },
    conductor: {
      ...conductorProcedures,
      takeOver: ({ input }: { input: { terminal: string } }) =>
        handOver(() => liveServerConductor().takeOver(input.terminal)),
      handBack: ({ input }: { input: { terminal: string } }) =>
        handOver(() => liveServerConductor().handBack(input.terminal)),
      stopWork: ({ input }: { input: { work: string } }) =>
        handOver(() => liveServerConductor().stopWork(input.work, "you")),
      reopenWork: ({ input }: { input: { work: string } }) =>
        handOver(() => liveServerConductor().reopenWork(input.work)),
      recoverStore: ({
        input,
      }: {
        input: { key: ConductorStoreKey; how: "backup" | "empty" };
      }) =>
        Effect.suspend(() => {
          try {
            const host = liveServerConductor();
            return Effect.succeed(
              recoverConductorStore(input, {
                state: () => host.state(),
                reload: () => host.reloadRecords(),
              }),
            );
          } catch (err) {
            return err instanceof ConductorRefused
              ? Effect.fail(err)
              : Effect.die(err);
          }
        }),
      answerWork: ({
        input,
      }: {
        input: {
          work: string;
          ask: string;
          answers: Readonly<
            Record<
              string,
              ReadonlyArray<string> | string | { readonly typed: string }
            >
          > | null;
          from: "card" | "chat" | "reader" | "popout";
        };
      }) =>
        Effect.tryPromise({
          try: () =>
            liveServerConductor().answerWork({
              work: input.work,
              ask: input.ask,
              from: input.from,
              reply:
                input.answers === null
                  ? { kind: "declined" }
                  : {
                      kind: "answered",
                      values: new Map(
                        Object.entries(input.answers).map(
                          ([decision, sent]) => [
                            decision,
                            typeof sent === "string" ? [sent] : sent,
                          ],
                        ),
                      ),
                    },
            }),
          catch: (err: unknown) => err,
        }).pipe(
          Effect.catch((err: unknown) =>
            err instanceof WorkRefusal
              ? Effect.fail(new ConductorRefused({ why: err.message }))
              : Effect.die(err),
          ),
        ),
    },
  };
}

export function implementKoluSurface(deps: KoluSurfaceDeps) {
  const conductorMembers = conductorSurfaceMembers({
    host: liveServerConductor,
    log,
  });

  const koluDeps: KoluSurfaceSpecDeps = {
    cells: koluCells(deps, conductorMembers.state()),
    collections: koluCollections(),
    streams: {
      conductorTranscript: { source: () => conductorMembers.transcript() },
    },
    procedures: koluProcedures(deps, conductorMembers.procedures),
  };

  const koluSurfaces = implementSurfacesOnPublisher(
    surfaces,
    {
      channel: <T>(name: string) => publisherChannel<T>(publisher, name),

      onStreamReadError: (err, info) =>
        log.error(
          { err: err instanceof Error ? err.message : String(err), ...info },
          "stream snapshot read failed",
        ),
    },
    {
      surfaceApp: surfaceAppServer<KoluBuildInfo>({
        buildInfo: async () => ({ version: serverVersion }),
        commit: serverCommit,
        onError: (err) =>
          log.error(
            { err: err instanceof Error ? err.message : String(err) },
            "buildInfo version axis failed",
          ),
      }),

      kolu: koluDeps,
    },
  );

  setConductorCellWriter((state) => {
    koluSurfaces.ctx.kolu.cells.conductor.set(state);
  });
  setWorksCollectionWriters({
    work: (id, work) => {
      if (work === null) koluSurfaces.ctx.kolu.collections.works.remove(id);
      else koluSurfaces.ctx.kolu.collections.works.upsert(id, work);
    },
    member: (terminal, member) => {
      if (member === null)
        koluSurfaces.ctx.kolu.collections.workMembers.remove(terminal);
      else
        koluSurfaces.ctx.kolu.collections.workMembers.upsert(terminal, member);
    },
    reading: (terminal, reading) => {
      if (reading === null)
        koluSurfaces.ctx.kolu.collections.memberReadings.remove(terminal);
      else
        koluSurfaces.ctx.kolu.collections.memberReadings.upsert(
          terminal,
          reading,
        );
    },
  });

  koluSurfaces.done.catch((err) => {
    log.fatal({ err }, "kolu surface runtime faulted — unrecoverable");
    process.exit(1);
  });

  return {
    group: koluSurfaces.group,
    handlers: koluSurfaces.handlers,
    setAgentProfiles: (value: AgentProfiles) =>
      koluSurfaces.ctx.kolu.cells.agentProfiles.set(value),
    storeCellWriters: {
      setPreferences: (value) =>
        koluSurfaces.ctx.kolu.cells.preferences.set(value),
      setViewerMode: (value) =>
        koluSurfaces.ctx.kolu.cells.viewerMode.set(value),
    },
  } satisfies ServedFragment & {
    storeCellWriters: StoreCellWriters;
    setAgentProfiles: (value: AgentProfiles) => void;
  };
}
