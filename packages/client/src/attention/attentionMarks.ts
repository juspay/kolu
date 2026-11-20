import {
  emptyByClass,
  type HostAttentionFrame,
  hostActiveIds,
  frameClassOf,
  type TerminalAttention,
} from "@kolu/padi-client/attention";
import type { AttentionClass, TerminalId } from "kolu-common/surface";
import { createStore, produce } from "solid-js/store";

export interface HostMarks extends HostAttentionFrame {
  unseenFinished: number;
  live: boolean;
  reported: boolean;
}

function emptyMarks(): HostMarks {
  return {
    byClass: emptyByClass(),
    liveIds: [],
    unseenFinished: 0,
    live: false,
    reported: false,
  };
}

const NO_MARKS: HostMarks = emptyMarks();

const [marks, setMarks] = createStore<
  Record<string, Pick<HostMarks, "unseenFinished">>
>({});

export function writeHostMarks(
  encHost: string,
  value: Partial<Pick<HostMarks, "unseenFinished">> | undefined,
): void {
  if (value === undefined) {
    setMarks(produce((m) => delete m[encHost]));
    return;
  }
  setMarks(encHost, (prev) => ({
    ...(prev ?? { unseenFinished: 0 }),
    ...value,
  }));
}

export interface HostClassLeg {
  classOf: (id: TerminalId) => AttentionClass;
}

export interface HostLiveLeg {
  isLive: (id: TerminalId) => boolean;
  activeCount: () => number;
}

export type HostAttentionIndex = HostClassLeg & HostLiveLeg;

type HostFacts = () => Omit<HostMarks, "unseenFinished">;

const facts = new Map<string, HostFacts>();
const classLegs = new Map<string, HostClassLeg>();
const liveLegs = new Map<string, HostLiveLeg>();

export function registerHostAttention(
  encHost: string,
  host: { facts: HostFacts; index?: HostAttentionIndex; onDrop?: () => void },
): () => void {
  facts.set(encHost, host.facts);
  if (host.index !== undefined) {
    classLegs.set(encHost, host.index);
    liveLegs.set(encHost, host.index);
  }
  writeHostMarks(encHost, {});
  return () => {
    facts.delete(encHost);
    classLegs.delete(encHost);
    liveLegs.delete(encHost);
    writeHostMarks(encHost, undefined);
    host.onDrop?.();
  };
}

export function markedHosts(): readonly string[] {
  return Object.keys(marks);
}

function trackHostMembership(encHost: string): void {
  void marks[encHost];
}

export function hostFrame(encHost: string): HostMarks {
  trackHostMembership(encHost);
  const frame = facts.get(encHost)?.();
  return frame
    ? {
        get byClass() {
          return frame.byClass;
        },
        get liveIds() {
          return frame.liveIds;
        },
        get live() {
          return frame.live;
        },
        get reported() {
          return frame.reported;
        },
        get unseenFinished() {
          return marks[encHost]?.unseenFinished ?? 0;
        },
      }
    : NO_MARKS;
}

export function hostAsking(encHost: string): number {
  return hostAskingIds(encHost).length;
}

export function hostAskingIds(encHost: string): readonly TerminalId[] {
  return hostFrame(encHost).byClass.asking;
}

export function hostUnseenFinished(encHost: string): number {
  return marks[encHost]?.unseenFinished ?? 0;
}

export function hostMarks(encHost: string): {
  active: () => number;
  asking: () => number;
  unseenFinished: () => number;
} {
  return {
    active: () =>
      liveLegs.get(encHost)?.activeCount() ??
      hostActiveIds(hostFrame(encHost)).length,
    asking: () => hostAsking(encHost),
    unseenFinished: () => hostUnseenFinished(encHost),
  };
}

export function terminalAttention(
  encHost: string,
  id: TerminalId,
): TerminalAttention {
  const klass = terminalClass(encHost, id);
  const live = liveLegs.get(encHost);
  return {
    klass,
    live: live ? live.isLive(id) : hostFrame(encHost).liveIds.includes(id),
  };
}

export function terminalClass(encHost: string, id: TerminalId): AttentionClass {
  return (
    classLegs.get(encHost)?.classOf(id) ?? frameClassOf(hostFrame(encHost), id)
  );
}

export function liveAskingTotal(): number {
  let count = 0;
  for (const enc of Object.keys(marks)) {
    const m = hostFrame(enc);
    if (m.live) count += m.byClass.asking.length;
  }
  return count;
}
