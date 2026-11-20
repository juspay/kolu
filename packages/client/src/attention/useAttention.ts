import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  hostKeysEqual as sameHost,
} from "kolu-common/hostKey";
import {
  type AgentInfo,
  agentBucket,
  type TerminalId,
} from "kolu-common/surface";
import "kolu-common/test-hooks";
import { Effect, Semaphore } from "effect";
import type { NeedsYou } from "kolu-work";
import { createEffect, mapArray, onCleanup, untrack } from "solid-js";
import { match } from "ts-pattern";
import { notify } from "../attentionNotify";
import { hostLabel } from "../host/hostChipTone";
import { afterViewKnown, isNeedInView } from "../conductor/onScreen";
import {
  conductorAsks,
  useConductorBadge,
  useConductorFacts,
} from "../conductor/useConductorFacts";
import {
  enterConductorMode,
  conductorMode,
} from "../conductor/useConductorMode";
import { useMembership, useNeedsYou, useWorkMap } from "../conductor/useWorks";
import { showWork } from "../conductor/workListing";
import { drivenByConductor } from "../conductor/workReadings";
import { runAction } from "../runAction";
import type { TerminalSubject } from "../terminal/terminalSubject";
import { nextAfter } from "../ui/nextAfter";
import {
  activeHost,
  preferences,
  preferencesArrived,
  setActiveHost,
} from "../wire";
import { type AttentionChannel, createAttentionCore } from "./attentionCore";
import { createConductorBell } from "./conductorAsks";
import {
  hostAskingIds,
  hostFrame,
  liveAskingTotal,
  markedHosts,
  writeHostMarks,
} from "./attentionMarks";
import { registerAttentionJump } from "./attentionNav";
import { isTerminalWatched } from "./attentionWatched";
import { attentionRecordOf } from "./savedAttention";
import { useAttentionFacts } from "./useAttentionFacts";

export interface AttentionDeps {
  activeId: () => TerminalId | null;
  focusedId: () => TerminalId | null;
  activate: (id: TerminalId) => void;
  activeSubject: (id: TerminalId) => TerminalSubject;
  terminalIds: () => TerminalId[];
  activeAgentState: (id: TerminalId) => AgentInfo["state"] | undefined;
}

function playSound(): void {
  const audio = new Audio("/sounds/notification.mp3");
  audio.play().catch((err: unknown) => {
    // An autoplay-policy block (no user gesture yet) or an unsupported codec is
    // EXPECTED and benign — but surface it (never a silent collapse) so a broken
    // sound channel is distinguishable from success. `debug` keeps the expected
    // autoplay-block out of the warning stream while still being observable.
    console.debug("useAttention: notification sound did not play", err);
  });
}

function createSerialBadge(): (count: number) => void {
  const lane = Semaphore.makeUnsafe(1);
  let acked: number | undefined;
  return (count) => {
    runAction(
      "update app badge",
      Effect.suspend(() => {
        if (count === acked) return Effect.void;
        return Effect.tryPromise(() =>
          count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge(),
        ).pipe(Effect.tap(() => Effect.sync(() => (acked = count))));
      }).pipe(
        lane.withPermit,
        Effect.catch((err) =>
          Effect.sync(() => {
            console.warn("useAttention: app-badge write failed", err);
          }),
        ),
      ),
    );
  };
}

export function useAttention(deps: AttentionDeps): {
  simulateAlert: (options?: { target?: "active" | "inactive" }) => void;
} {
  const alertsEnabled = (): boolean => preferences().attentionAlerts;

  createEffect(() => {
    if (alertsEnabled()) void notify.requestPermission();
  });

  const isActiveHost = (host: HostKey): boolean => sameHost(host, activeHost());

  const watched = (host: HostKey, id: TerminalId): boolean =>
    isTerminalWatched(
      isActiveHost(host),
      id,
      deps.focusedId(),
      document.hasFocus(),
    );

  function deliver(
    host: HostKey,
    id: TerminalId,
    asking: boolean,
    channel: AttentionChannel,
  ): void {
    const encHost = encodeHostKey(host);
    const rich = isActiveHost(host) ? deps.activeSubject(id) : undefined;
    if (channel === "loud") {
      playSound();
      const title = rich
        ? asking
          ? `${rich.title} needs your input`
          : `${rich.title} finished`
        : asking
          ? `An agent needs your input on ${hostLabel(host)}`
          : `An agent finished on ${hostLabel(host)}`;
      void notify.show({
        tag: `${encHost}/${id}`,
        title,
        body: rich?.description,
        icon: "/favicon.svg",
        data: { kind: "terminal", host: encHost, terminalId: id },
      });
    }
    if (rich && id !== deps.focusedId())
      attentionRecordOf(encHost).markUnread(id);
  }

  const deliverNeeds = (
    items: ReadonlyArray<NeedsYou>,
    ownOpen: number | null,
  ): void => {
    try {
      playSound();
      for (const item of items)
        void notify.show({
          tag: `work:${item.key}`,
          title: item.title,
          body: item.wanted,
          icon: "/favicon.svg",
          data: {
            kind: "work",
            work: item.work,
            ask: item.why.why === "question" ? item.why.ask : null,
          },
        });
      if (ownOpen !== null)
        void notify.show({
          tag: "conductor",
          title: "The conductor needs you",
          body:
            ownOpen === 1
              ? "One question is waiting"
              : `${ownOpen} questions are waiting`,
          icon: "/favicon.svg",
          data: { kind: "conductor" },
        });
    } catch (err) {
      console.error("useAttention: conductor delivery failed", err);
    }
  };
  const conductorBell = createConductorBell({
    alertsEnabled,
    isItemWatched: isNeedInView,
    isConversationWatched: () => conductorMode() && document.hasFocus(),
    deliver: deliverNeeds,
  });
  const workMap = useWorkMap();
  const needs = useNeedsYou();
  const decide = afterViewKnown(() => conductorBell.settle());
  createEffect(() => {
    const asks = conductorAsks();
    if (asks === undefined) return;
    const heard = conductorBell.observe({
      ...asks,
      works: new Set(workMap().keys()),
      needs: needs(),
    });
    if (heard) decide();
  });

  const membership = useMembership();

  const core = createAttentionCore({
    alertsEnabled,
    isActiveHost: (encHost) => isActiveHost(decodeHostKey(encHost)),
    isWatched: (encHost, id) => watched(decodeHostKey(encHost), id),
    isDriven: (encHost, id) =>
      drivenByConductor(untrack(membership), encHost, id),
    deliver: (encHost, id, asking, channel) =>
      deliver(decodeHostKey(encHost), id, asking, channel),
    writeMark: (encHost, unseenFinished) =>
      writeHostMarks(encHost, { unseenFinished }),
    clearUnread: (encHost, id) => attentionRecordOf(encHost).clearUnread(id),
    resume: (encHost) => attentionRecordOf(encHost).memory(),
    remember: (encHost, memory) => attentionRecordOf(encHost).remember(memory),
  });

  useAttentionFacts();
  useConductorFacts();
  const conductorWaiting = useConductorBadge();

  const observers = mapArray(markedHosts, (encHost) => {
    createEffect(() => {
      const frame = hostFrame(encHost);
      if (!frame.reported) return;
      if (!preferencesArrived()) return;
      core.observe(encHost, frame.byClass);
    });
    onCleanup(() => core.forgetHost(encHost));
    return null;
  });
  createEffect(() => void observers());

  createEffect(() => core.markHostSeen(encodeHostKey(activeHost())));

  const paintBadge = createSerialBadge();
  createEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    if (!alertsEnabled()) {
      paintBadge(0);
      return;
    }
    paintBadge(liveAskingTotal() + conductorWaiting.waiting());
  });

  onCleanup(
    registerAttentionJump((encHost) => {
      const ids = hostAskingIds(encHost);
      if (ids.length === 0) return;
      setActiveHost(decodeHostKey(encHost));
      const next = nextAfter(ids, deps.activeId());
      if (next !== undefined) deps.activate(next);
    }),
  );

  onCleanup(
    notify.onClick((data) =>
      match(data)
        .with({ kind: "terminal" }, ({ host, terminalId }) => {
          setActiveHost(decodeHostKey(host));
          deps.activate(terminalId);
        })
        .with({ kind: "host" }, ({ host, id }) => {
          setActiveHost(decodeHostKey(host));
          deps.activate(id);
        })
        .with({ kind: "conductor" }, () => {
          enterConductorMode();
        })
        .with({ kind: "work" }, ({ work, ask }) => showWork(work, ask))
        .exhaustive(),
    ),
  );

  const simulateAlert = (options?: {
    target?: "active" | "inactive";
  }): void => {
    if (!alertsEnabled()) return;
    const active = deps.activeId();
    const ids =
      options?.target === "active"
        ? deps.terminalIds().filter((id) => id === active)
        : deps.terminalIds().filter((id) => id !== active);
    const pick = ids[Math.floor(Math.random() * ids.length)];
    if (pick === undefined) return;
    const state = deps.activeAgentState(pick);
    const asking = state !== undefined && agentBucket(state) === "awaiting";
    deliver(activeHost(), pick, asking, "loud");
  };
  window.__koluSimulateAlert = simulateAlert;

  return { simulateAlert };
}
