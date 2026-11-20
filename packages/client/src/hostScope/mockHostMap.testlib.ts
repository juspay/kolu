import { Stream } from "effect";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import { type Accessor, createSignal, onCleanup } from "solid-js";
import { groundActiveHost } from "../host/groundActive";

const [members, setMembers] = createSignal<string[]>([]);

export interface WireLifecycle {
  opened: number;
  disposed: number;
}
const wireLog = new Map<string, WireLifecycle>();

export function wireLifecycle(host: HostKey): WireLifecycle {
  const k = encodeHostKey(host);
  let e = wireLog.get(k);
  if (!e) {
    e = { opened: 0, disposed: 0 };
    wireLog.set(k, e);
  }
  return e;
}

export function resetWireLog(): void {
  wireLog.clear();
}

function instrumentedSub(hostKey: string): Record<string, unknown> {
  wireLifecycle(decodeHostKey(hostKey)).opened++;
  onCleanup(() => {
    wireLifecycle(decodeHostKey(hostKey)).disposed++;
  });
  return {
    byKey: () => undefined,
    value: () => undefined,
    sub: () => () => {},
    pending: () => true,
    error: () => undefined,
    complete: () => false,
    keys: () => [],
  };
}

export const mockPadiMap = {
  entries: {
    use: () => ({
      keys: () => members().map(decodeHostKey),
      byKey: () => undefined,
    }),
  },
  codec: { encode: encodeHostKey, decode: decodeHostKey },
  live: () => true,
  entry: (host: HostKey) => {
    const k = encodeHostKey(host);
    const cell = { use: () => instrumentedSub(k) };
    const collection = {
      use: () => instrumentedSub(k),
      unenrolledKeys: () => idleKeysStream(),
    };
    return {
      cells: { session: cell, roster: cell, activityFeed: cell },
      collections: { terminals: collection, daemonStatus: collection },
      procedures: { chrome: { setActive: async () => {} } },
    };
  },
  useEntry: () => {
    throw new Error("mockPadiMap: useEntry() is unused by scopedByEntry");
  },
  dispose: () => {},
};

export const mockGroundedActiveHost = (active: Accessor<HostKey>) => () =>
  groundActiveHost(active(), mockPadiMap.entries.use().keys());

const idleKeysStream = (): Stream.Stream<never> => Stream.never;

export function addHost(host: HostKey): void {
  const k = encodeHostKey(host);
  setMembers((m) => (m.includes(k) ? m : [...m, k]));
}

export function removeHost(host: HostKey): void {
  const k = encodeHostKey(host);
  setMembers((m) => m.filter((x) => x !== k));
}

export function resetHosts(): void {
  setMembers([]);
}
