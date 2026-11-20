import type { UnaryEffect } from "@kolu/surface/client";
import type { WatchableWire } from "@kolu/surface/link";
import type { WireDiagnostics } from "@kolu/surface/links/websocket";
import type { SurfaceClient, SurfaceFace } from "@kolu/surface/solid";
import { connectSurfaces } from "@kolu/surface-app/solid";
import { connectSurfaceMap } from "@kolu/surface-map/client";
import {
  decodeHostKey,
  encodeHostKey,
  hostKeysInclude,
} from "kolu-common/hostKey";
import {
  type ClientErrorPolicy,
  DEFAULT_PREFERENCES,
  type Preferences,
  type PreferencesPatch,
  surfaces,
  type ViewerMode,
} from "kolu-common/surface";
import {
  type ConnectionInfo,
  type HostKey,
  LOCAL_HOST,
  type padiEntrySurface,
  koluNonSiblingGroups,
  padiHostMap,
} from "kolu-common/surfacesWithPadi";
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
} from "solid-js";
import { Effect } from "effect";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { groundActiveHost } from "./host/groundActive.ts";
import { hostReconcileTarget } from "./host/hostReconcile.ts";
import { orderHostKeys } from "./host/hostOrder.ts";
import { hostLabel } from "./host/hostChipTone.ts";
import { persistedPref } from "./persistedPref.ts";
import { rootProcedures } from "./rpc/rootProcedures.ts";
import { runAction } from "./runAction.ts";
import { recordProbeSettled, recordWireRetired } from "./wireProbes.ts";

export function interpretClientError(
  p: ClientErrorPolicy,
  err: Error,
  origin?: { key: HostKey },
): void {
  const originEnc = origin ? encodeHostKey(origin.key) : "";
  const id = `${p.kind}:${p.label}:${originEnc}`;
  const requireOrigin = (): HostKey => {
    if (!origin)
      throw new Error(
        `interpretClientError: ${p.kind} "${p.label}" reached with no origin — ` +
          "it is declared on a map-entry member; origin injection must have regressed.",
      );
    return origin.key;
  };
  match(p)
    .with({ kind: "toast" }, (t) => {
      toast.error(`${t.label} error: ${err.message}`, { id });
    })
    .with({ kind: "hostToast" }, (t) => {
      toast.error(
        `Host ${hostLabel(requireOrigin())} ${t.label} error: ${err.message}`,
        { id },
      );
    })
    .with({ kind: "scopedSub" }, (t) => {
      requireOrigin();
      const g = groundedActiveHost();
      const active = g !== null && encodeHostKey(g) === originEnc;
      if (active) toast.error(`${t.label}: ${err.message}`, { id });
      else
        console.error(
          `createHostWire: background ${t.label} for ${originEnc}: ${err.message}`,
        );
    })
    .exhaustive();
}

const conn = await connectSurfaces({
  surfaces,
  extraGroups: Object.values(koluNonSiblingGroups),
  onClientError: (p, e) => interpretClientError(p as ClientErrorPolicy, e),
  heartbeat: { onProbeSettled: recordProbeSettled },
  retired: recordWireRetired,
});
const { link } = conn;

export const wire: WatchableWire = link.wire;

export const wireDiagnostics: WireDiagnostics = link.diagnostics;

(window as Window & { __koluWire?: WatchableWire }).__koluWire = wire;

const clients = conn.clients;

export const app = clients.kolu;

export const surfaceApp = clients.surfaceApp;

export const appLifetimeSub = <T>(cell: { use: () => T }): T =>
  createRoot(() => cell.use());

export const padiMap = connectSurfaceMap(padiHostMap, conn.transport, {
  onClientError: (p, e, origin) =>
    interpretClientError(p as ClientErrorPolicy, e, origin),
});

export const [activeHost, setActiveHost] = persistedPref<HostKey>({
  name: "kolu-active-host",
  fallback: LOCAL_HOST,
  parse: (raw) => decodeHostKey(raw),
  serialize: encodeHostKey,
  storage: sessionStorage,
  onInvalid: (err, raw) =>
    console.warn(
      `[wire] stored active-host "${raw}" is invalid; resetting to the local default:`,
      err,
    ),
});

export const client = rootProcedures(conn.transport.dispatch);

function unaryMember<I, O>(
  face: SurfaceFace,
  member: string,
  verb: string,
): UnaryEffect<I, O, never> {
  const ref = face.surface[member]?.[verb];
  if (typeof ref !== "function") {
    throw new Error(
      `wire: this surface carries no \`${member}.${verb}\` member — the face was built from the wrong surface.`,
    );
  }
  return ref as UnaryEffect<I, O, never>;
}

export const setViewerMode: UnaryEffect<ViewerMode, void, never> = unaryMember(
  app.rpc,
  "viewerMode",
  "set",
);

const appPreferences = createRoot(() => app.cells.preferences.use());

const membership = createRoot(() => {
  const members = padiMap.entries.use();
  if (process.env.NODE_ENV !== "production") {
    createEffect(() => {
      const keys = members.keys();
      if (keys.length > 0 && !hostKeysInclude([...keys], LOCAL_HOST)) {
        console.error(
          "[wire] INVARIANT VIOLATION: membership loaded but LOCAL_HOST is absent — the " +
            "local host is the unremovable seed and must always be a member. groundedActiveHost " +
            "will read null and the reconcile will not bounce local, so the per-host scope stays " +
            "undefined (blank canvas) with no other signal. This is a server-side pool bug.",
        );
      }
    });
  }
  const [pendingJoin, setPendingJoin] = createSignal<HostKey | null>(null);
  createEffect(() => {
    const action = hostReconcileTarget(
      members.keys(),
      activeHost(),
      pendingJoin(),
      LOCAL_HOST,
    );
    if (action === null) return;
    if (action.kind === "activate-joined") {
      setPendingJoin(null);
      setActiveHost(action.target);
      return;
    }
    const departed = activeHost();
    setActiveHost(action.target);
    toast.warning(
      `Host "${encodeHostKey(departed)}" left the pool — switched to the local host`,
    );
  });
  const hostKeys = createMemo(() =>
    orderHostKeys(
      [...members.keys()],
      (appPreferences.value() ?? DEFAULT_PREFERENCES).hostOrder,
    ),
  );
  return { requestActivateOnJoin: setPendingJoin, hostKeys };
});

const activeEntry = createRoot(() => {
  const active = padiMap.useEntry(activeHost);
  const connection = (): ConnectionInfo | undefined =>
    match(active.state())
      .with({ kind: "warming" }, { kind: "connected" }, (s) => s.connection)
      .with(
        { kind: "failed" },
        { kind: "unobservable" },
        { kind: "not-a-member" },
        () => undefined,
      )
      .exhaustive();
  return {
    connection,
    procedures: active.procedures,
    streams: active.streams,
  };
});

export const requestActivateOnJoin = membership.requestActivateOnJoin;

export const hostKeys: Accessor<HostKey[]> = membership.hostKeys;

export const groundedActiveHost: Accessor<HostKey | null> = createRoot(() =>
  createMemo(() => groundActiveHost(activeHost(), hostKeys())),
);

export const encActiveHost: Accessor<string> = createRoot(() =>
  createMemo(() => encodeHostKey(activeHost())),
);

export const activePadiRpc = activeEntry.procedures;

export function padiRpcOf(host: HostKey): PadiRpcFace {
  return padiMap.entry(host).procedures;
}

type PadiRpcFace = SurfaceClient<typeof padiEntrySurface.spec>["procedures"];

export const activePadiStreams = activeEntry.streams;

export const connectionInfo = (): ConnectionInfo | undefined =>
  activeEntry.connection();

export const preferencesArrived = (): boolean =>
  appPreferences.value() !== undefined;

export const preferences = (): Preferences =>
  appPreferences.value() ?? DEFAULT_PREFERENCES;

export function updatePreferences(
  patch: PreferencesPatch,
  opts?: { coalesce?: boolean },
): void {
  runAction(
    "save preferences",
    Effect.catch(appPreferences.patch(patch, opts), (err) =>
      Effect.sync(() =>
        toast.error(
          `Failed to save preferences: ${err instanceof Error ? err.message : String(err)}`,
        ),
      ),
    ),
  );
}
