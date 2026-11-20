import {
  type AttentionFrame,
  type AttentionTransitions,
  createAttentionTransitions,
  type TerminalId,
} from "kolu-common/surface";
import { nextUnseenFinished } from "./unseenFinished";

export interface AttentionMemory {
  readonly frame: AttentionFrame;
  readonly latched: readonly TerminalId[];
  readonly unseenFinished: readonly TerminalId[];
}

export type AttentionChannel = "loud" | "marks-only";

export interface AttentionHooks {
  alertsEnabled(): boolean;
  isActiveHost(encHost: string): boolean;
  isWatched(encHost: string, id: TerminalId): boolean;
  isDriven(encHost: string, id: TerminalId): boolean;
  deliver(
    encHost: string,
    id: TerminalId,
    asking: boolean,
    channel: AttentionChannel,
  ): void;
  writeMark(encHost: string, unseenFinished: number): void;
  clearUnread(encHost: string, id: TerminalId): void;
  resume(encHost: string): AttentionMemory | null;
  remember(encHost: string, memory: AttentionMemory): void;
}

export interface AttentionCore {
  observe(encHost: string, cur: AttentionFrame): void;
  forgetHost(encHost: string): void;
  markHostSeen(encHost: string): void;
}

export function createAttentionCore(hooks: AttentionHooks): AttentionCore {
  const transitionsByHost = new Map<string, AttentionTransitions>();
  const frameByHost = new Map<string, AttentionFrame>();
  const unseenByHost = new Map<string, Set<TerminalId>>();
  const latched = new Map<string, Set<TerminalId>>();
  const latchOf = (encHost: string): Set<TerminalId> => {
    let set = latched.get(encHost);
    if (!set) {
      set = new Set();
      latched.set(encHost, set);
    }
    return set;
  };

  const lastSaved = new Map<string, string>();
  const save = (encHost: string): void => {
    const frame = frameByHost.get(encHost);
    if (frame === undefined) return;
    const memory: AttentionMemory = {
      frame,
      latched: [...latchOf(encHost)],
      unseenFinished: [...(unseenByHost.get(encHost) ?? [])],
    };
    const serialized = JSON.stringify(memory);
    if (lastSaved.get(encHost) === serialized) return;
    lastSaved.set(encHost, serialized);
    hooks.remember(encHost, memory);
  };

  const resumeFrom = (
    encHost: string,
  ): { transitions: AttentionTransitions; resumed: boolean } => {
    const saved = hooks.resume(encHost);
    if (saved !== null) {
      latched.set(encHost, new Set(saved.latched));
      unseenByHost.set(encHost, new Set(saved.unseenFinished));
    }
    const transitions = createAttentionTransitions(saved?.frame ?? null);
    transitionsByHost.set(encHost, transitions);
    return { transitions, resumed: saved !== null };
  };

  const episodeEnded = (
    encHost: string,
    ended: readonly TerminalId[],
  ): void => {
    for (const id of ended) {
      latched.get(encHost)?.delete(id);
      hooks.clearUnread(encHost, id);
    }
  };

  const baselinePreLatch = (encHost: string, cur: AttentionFrame): void => {
    for (const id of cur.asking) latchOf(encHost).add(id);
  };

  const observe = (encHost: string, cur: AttentionFrame): void => {
    let transitions = transitionsByHost.get(encHost);
    let started: {
      transitions: AttentionTransitions;
      resumed: boolean;
    } | null = null;
    if (transitions === undefined) {
      started = resumeFrom(encHost);
      transitions = started.transitions;
    }
    const baseline = started !== null && !started.resumed;
    const resumed = started?.resumed ?? false;
    const { candidates, ended } = transitions.observe(cur);
    frameByHost.set(encHost, {
      asking: [...cur.asking],
      finished: [...cur.finished],
    });

    const unseen = nextUnseenFinished({
      unseen: unseenByHost.get(encHost) ?? new Set(),
      candidates,
      finishedIds: cur.finished,
      isActiveHost: hooks.isActiveHost(encHost),
    });
    unseenByHost.set(encHost, unseen);
    hooks.writeMark(encHost, unseen.size);

    episodeEnded(encHost, ended);

    if (baseline) baselinePreLatch(encHost, cur);

    for (const { id, asking } of candidates) {
      if (latched.get(encHost)?.has(id) ?? false) continue;
      const seen = hooks.isWatched(encHost, id);
      const alerted = hooks.alertsEnabled() && !seen;
      if (alerted)
        hooks.deliver(
          encHost,
          id,
          asking,
          !resumed && !hooks.isDriven(encHost, id) ? "loud" : "marks-only",
        );
      if (alerted || (asking && seen)) latchOf(encHost).add(id);
    }
    save(encHost);
  };

  const forgetHost = (encHost: string): void => {
    transitionsByHost.delete(encHost);
    frameByHost.delete(encHost);
    lastSaved.delete(encHost);
    unseenByHost.delete(encHost);
    latched.delete(encHost);
  };

  const markHostSeen = (encHost: string): void => {
    const set = unseenByHost.get(encHost);
    if (set && set.size > 0) {
      set.clear();
      hooks.writeMark(encHost, 0);
      save(encHost);
    }
  };

  return { observe, forgetHost, markHostSeen };
}
