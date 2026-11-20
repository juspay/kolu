import { type ScopedByEntry, scopedByEntry } from "@kolu/surface-map/client";
import type { HostKey } from "kolu-common/hostKey";
import type { Accessor } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { groundedActiveHost, padiMap } from "../wire";
import { createCamera, type HostCamera } from "./createCamera";
import { createHostPrefs, type HostPrefs } from "./createHostPrefs";
import { createHostWire, type HostWire } from "./createHostWire";
import {
  createSessionRestore,
  type HostRestoreLatch,
} from "./createSessionRestore";
import { createViewState, type HostViewState } from "./createViewState";

export interface HostScope {
  view: HostViewState;
  prefs: HostPrefs;
  camera: HostCamera;
  restore: HostRestoreLatch;
  wire: HostWire;
}

const scopes: () => ScopedByEntry<HostKey, HostScope> = createSharedRoot(() =>
  scopedByEntry(padiMap, groundedActiveHost, (host: HostKey): HostScope => {
    const wire = createHostWire(host);
    return {
      view: createViewState(host, wire.placementOf),
      prefs: createHostPrefs(host),
      camera: createCamera(),
      restore: createSessionRestore(),
      wire,
    };
  }),
);

export const activeScope: Accessor<HostScope | undefined> = () =>
  scopes().active();

export function hostScopeOf(host: HostKey): HostScope | undefined {
  return scopes().get(host);
}
