import { probeSurfaceIdentity } from "@kolu/surface/identity";
import {
  createServerLifecycle,
  type ServerLifecycleEvent,
} from "@kolu/surface-app/solid";
import { createMemo } from "solid-js";
import { match } from "ts-pattern";
import { surfaceApp, wire } from "../wire";

export type WsStatus = "connecting" | "open" | "closed";
export type { ServerLifecycleEvent };

const { lifecycle, serverProcessId, status } = createServerLifecycle({
  wire,
  probe: () => probeSurfaceIdentity(surfaceApp.rpc),
  heartbeat: false,
  onProbeError: (err) => console.error("system/identity probe failed:", err),
});

export { lifecycle, serverProcessId, status };

const wsStatus = createMemo<WsStatus>(() =>
  match(lifecycle())
    .with({ kind: "connecting" }, () => "connecting" as const)
    .with({ kind: "disconnected" }, () => "closed" as const)
    .with({ kind: "restarted", transport: "closed" }, () => "closed" as const)
    .with({ kind: "restarted" }, () => "open" as const)
    .with({ kind: "connected" }, { kind: "reconnected" }, () => "open" as const)
    .exhaustive(),
);

export { wsStatus };
