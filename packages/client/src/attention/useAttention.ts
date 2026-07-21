/** `useAttention` — the ONE owner of kolu's attention model.
 *
 *  "Attention" is the single concept behind every way kolu reacts when an agent
 *  needs you: the sound + OS popup, the app-icon badge, the host-tab marks, and
 *  (through the terminal store) the dock unread. This module folds the rules that
 *  used to live in THREE places — `useTerminalAlerts` (active host only),
 *  `useHostAttention` (other hosts only), and the active-only unread ledger —
 *  into one place that applies the SAME rules on EVERY host.
 *
 *  The old split was by an accidental axis: whether you were looking at the host.
 *  Here that axis enters in exactly one spot — the `watched` predicate (a tile you
 *  are staring at is "seen"). Everything else is host-agnostic.
 *
 *  ── The rules ──────────────────────────────────────────────────────────────
 *  Two attention states, read cross-host off each host's tiny `urgency` cell
 *  (`{ awaitingIds, finishedIds }`, the deliberately-small member kept hot on
 *  every bound host — never a full terminals mirror):
 *    • ASKING (`awaiting_user`) — blocked on your input.
 *    • FINISHED (`waiting`) — just ended its turn.
 *  For each host we diff that cell frame-to-frame and, per terminal:
 *    • fire the loud channels (sound + OS popup) ONCE per attention episode, only
 *      if the terminal isn't currently `watched` and the pref allows it;
 *    • an escalation FINISHED→ASKING re-arms a fire (a real gate over an idle
 *      finish still chimes — #1177), while flap/settle jitter is collapsed by the
 *      per-terminal `latched` set, which clears only when the terminal LEAVES the
 *      attention class (its agent goes back to work);
 *    • the app badge sums ASKING across live hosts; the host-tab finished mark
 *      (rendered by the chips off the same cell) shows finished work on a host you
 *      aren't looking at.
 *
 *  Delivery (the actual sound + service-worker popup) is NOT owned here — it rides
 *  the shared `notify` seam (`../attentionNotify`) plus a local `playSound`, so
 *  this module only decides WHEN, never re-implements the platform landmines.
 *
 *  Owned-by-caller: constructed once under the app owner (it holds a keyArray of
 *  per-host roots disposed on host removal). See `App.tsx`. */

import type { PadiUrgency } from "@kolu/padi/surface";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import {
  type AgentInfo,
  agentBucket,
  type TerminalId,
} from "kolu-common/surface";
import "kolu-common/test-hooks";
import { createEffect, createMemo, mapArray, onCleanup } from "solid-js";
import {
  attentionTransitions,
  nextUnseenFinished,
} from "./attentionTransitions";
import { writeHostMarks } from "./attentionMarks";
import { createStore } from "solid-js/store";
import { match } from "ts-pattern";
import { notify } from "../attentionNotify";
import { hostLabel, sameHost } from "../host/hostChipTone";
import type { TerminalSubject } from "../terminal/terminalSubject";
import {
  activeHost,
  hostKeys,
  padiMap,
  preferences,
  setActiveHost,
} from "../wire";

/** What the active host can tell us about its terminals — the rich notification
 *  copy, the dock unread write, and the e2e simulate targets. Background hosts
 *  have none of this (we only mirror their `urgency` cell), so a background finish
 *  gets host-labeled copy and no dock mark — a CONTENT difference from data
 *  availability, never a RULE difference. */
export interface AttentionDeps {
  /** The active host's currently-focused tile (for the `watched` predicate). */
  activeId: () => TerminalId | null;
  /** Focus a terminal on the (post-switch) active host — the notification-click
   *  target, identical to the seam the old cross-host click used. */
  activate: (id: TerminalId) => void;
  /** Mark an active-host background tile unread (the dock corner badge). */
  markUnread: (id: TerminalId) => void;
  /** Rich subject (repo/branch label + description) for an active-host terminal. */
  activeSubject: (id: TerminalId) => TerminalSubject;
  /** The active host's terminal ids (for the e2e simulate hook only). */
  terminalIds: () => TerminalId[];
  /** The active host's live agent state for a terminal (simulate asking-ness). */
  activeAgentState: (id: TerminalId) => AgentInfo["state"] | undefined;
}

/** The per-host attention summary the badge folds over. */
interface HostAttention {
  asking: number;
  live: boolean;
}

function playSound(): void {
  const audio = new Audio("/sounds/notification.mp3");
  audio.play().catch(() => {
    // Autoplay policy or unsupported — swallow silently.
  });
}

export function useAttention(deps: AttentionDeps): {
  simulateAlert: (options?: { target?: "active" | "inactive" }) => void;
} {
  const alertsEnabled = (): boolean => preferences().attentionAlerts;

  // Ask for OS-notification permission REACTIVELY off the same pref that gates
  // delivery — so turning attention on later still prompts, and re-runs are cheap
  // (`requestPermission` is idempotent).
  createEffect(() => {
    if (alertsEnabled()) void notify.requestPermission();
  });

  // The per-host summary the badge folds over. A host is removed from the store
  // when its root disposes (membership exit), so a departed host can never inflate
  // the badge.
  const [summary, setSummary] = createStore<Record<string, HostAttention>>({});

  // The fire-once latch, keyed `${encHost}/${id}` — cross-host by construction, so
  // a session-imported id that lives on two hosts can't share one episode. Cleared
  // when a terminal leaves the attention class (its agent goes back to work).
  const latched = new Set<string>();
  const keyOf = (encHost: string, id: TerminalId): string => `${encHost}/${id}`;

  // Per-host "unseen finished" ids — the quiet host-tab dot. A finished agent
  // idles in `waiting` forever, so this is the UNSEEN subset (see
  // `nextUnseenFinished`), not "has any finished agent": it accrues on a fresh
  // background finish and clears when you look at the host.
  const unseenFin = new Map<string, Set<TerminalId>>();

  const isActiveHost = (host: HostKey): boolean => sameHost(host, activeHost());

  // "Seen with your eyes": the active host's focused tile while kolu has focus. A
  // background host's terminal is never watched (it's off-screen), so the axis
  // that split the old modules reduces to this one predicate.
  const watched = (host: HostKey, id: TerminalId): boolean =>
    isActiveHost(host) && id === deps.activeId() && document.hasFocus();

  /** Actually reach the user for one terminal: sound + OS popup, plus the dock
   *  unread when it's an active-host background tile. The `WHEN` gate lives in the
   *  caller (`process`); this is the delivery, shared with the simulate hook. */
  function deliver(host: HostKey, id: TerminalId, asking: boolean): void {
    playSound();
    const encHost = encodeHostKey(host);
    const rich = isActiveHost(host) ? deps.activeSubject(id) : undefined;
    const title = rich
      ? asking
        ? `${rich.title} needs your input`
        : `${rich.title} finished`
      : asking
        ? `An agent needs your input on ${hostLabel(host)}`
        : `An agent finished on ${hostLabel(host)}`;
    void notify.show({
      tag: keyOf(encHost, id),
      title,
      body: rich?.description,
      icon: "/favicon.svg",
      data: { kind: "terminal", host: encHost, terminalId: id },
    });
    if (isActiveHost(host) && id !== deps.activeId()) deps.markUnread(id);
  }

  /** Diff one host's cell frame-to-frame and apply the rules. `prev === null` is
   *  the baseline (first frame), which never fires — attention is a TRANSITION,
   *  not a discovery. The WHICH-transitions decision is the pure `attentionTransitions`
   *  (unit-tested); this wraps it with the stateful latch / watched / deliver. */
  function process(
    host: HostKey,
    prev: PadiUrgency | null,
    cur: PadiUrgency,
  ): void {
    const encHost = encodeHostKey(host);
    const { candidates, ended } = attentionTransitions(prev, cur);

    // The quiet host-tab dot: fold this host's unseen-finished set and publish it.
    // Runs on EVERY frame (incl. baseline) so the dot tracks work back to zero,
    // never latches on. `nextUnseenFinished` owns the rule (unit-tested).
    const unseen = nextUnseenFinished(
      unseenFin.get(encHost) ?? new Set(),
      prev,
      cur,
      isActiveHost(host),
    );
    unseenFin.set(encHost, unseen);
    writeHostMarks(encHost, { unseenFinished: unseen.size });

    // Episode end: a terminal that left BOTH sets went back to work — clear its
    // latch so its NEXT finish/ask is a fresh episode that fires again.
    for (const id of ended) latched.delete(keyOf(encHost, id));
    if (prev === null) return; // baseline — record only, never fire.

    for (const { id, asking } of candidates) {
      const key = keyOf(encHost, id);
      if (latched.has(key)) continue;
      const seen = watched(host, id);
      const alerted = alertsEnabled() && !seen;
      if (alerted) deliver(host, id, asking);
      // Latch once the user has been MADE AWARE — by an actual alert, OR by looking
      // right at a live gate (eyes work with sound off). A `finished` seen while
      // watched is NOT latched, so a later real gate still fires (#1177).
      if (alerted || (asking && seen)) latched.add(key);
    }
  }

  // Eager per-host roots over the FULL member set (a background host is precisely
  // the one you must hear from), each disposed when its host leaves the pool.
  // Keyed on the ENCODED host string (a stable primitive) so `mapArray` gives one
  // retained owner per host, disposed on membership exit — not a fresh owner every
  // time `hostKeys()` re-decodes.
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost) => {
      const host = decodeHostKey(encHost);
      const entry = padiMap.entry(host);
      // Bare `.use()` — the `urgency` cell declares its own `onError` policy
      // (`hostToast`, host-prefixed) on the spec, so per SR11 the use-site carries
      // NO policy; the declared interpreter surfaces a per-host cell failure.
      const { value, sub } = entry.cells.urgency.use();
      // Live only when the link is up AND this cell's own sub is neither errored nor
      // ended — urgency is no `liveWhen` gate, so a stale value must read STALE (dim,
      // uncounted), never lie live.
      const live = createMemo(
        () =>
          entry.state().kind === "connected" &&
          !sub.error() &&
          !(sub.complete?.() ?? false),
      );

      // Transitions ride the reactive `value()` with a manually-tracked prev — so it
      // is independent of whether the cell's `updated` fires an initial frame: the
      // first DEFINED value is the baseline (no fire), every later change diffs. The
      // upstream `equals` (`urgencyEqual`) means `value()` only ticks on real change.
      let prev: PadiUrgency | null = null;
      createEffect(() => {
        const v = value();
        if (v === undefined) return; // no frame yet — the mirror is silent.
        process(host, prev, v);
        prev = v;
      });
      // Reflect this host's asking-count + liveness for the badge fold. Separate from
      // the transition effect so a link flap (live changes, value doesn't) still
      // repaints the badge, and a value change doesn't depend on `live`.
      createEffect(() => {
        const asking = value()?.awaitingIds.length ?? 0;
        setSummary(encHost, { asking, live: live() });
      });
      onCleanup(() => {
        for (const id of prev?.awaitingIds ?? []) {
          latched.delete(keyOf(encHost, id));
        }
        for (const id of prev?.finishedIds ?? []) {
          latched.delete(keyOf(encHost, id));
        }
        unseenFin.delete(encHost);
        setSummary(encHost, undefined as unknown as HostAttention);
        writeHostMarks(encHost, undefined);
      });
      return null;
    },
  );
  // Instantiate the roots (mapArray is lazy until read).
  createEffect(() => void roots());

  // Clear a host's unseen-finished dot the moment you switch TO it — "you looked".
  // `nextUnseenFinished` also zeroes it on any active-host cell tick, but a switch
  // with no accompanying cell change still needs this to clear the mark.
  createEffect(() => {
    const enc = encodeHostKey(activeHost());
    const set = unseenFin.get(enc);
    if (set && set.size > 0) {
      set.clear();
      writeHostMarks(enc, { unseenFinished: 0 });
    }
  });

  // App badge = Σ ASKING over LIVE hosts. A dead host's held count never inflates
  // it; the active host is live, so its asking agents are counted too. Serialised
  // through one tail so a rapid set→clear can't land out of order, and de-duped at
  // apply time against the last confirmed count.
  let acked: number | undefined;
  let badgeTail: Promise<unknown> = Promise.resolve();
  const paintBadge = (count: number): void => {
    badgeTail = badgeTail
      .then(async () => {
        if (count === acked) return;
        await (count > 0
          ? navigator.setAppBadge(count)
          : navigator.clearAppBadge());
        acked = count;
      })
      .catch((err) =>
        console.warn("useAttention: app-badge write failed", err),
      );
  };
  createEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    if (!alertsEnabled()) {
      paintBadge(0);
      return;
    }
    let count = 0;
    for (const enc of Object.keys(summary)) {
      const s = summary[enc];
      if (s?.live) count += s.asking;
    }
    paintBadge(count);
  });

  // The SINGLE notification-click router: switch to the originating host first (a
  // notification outlives the active-host selection), then focus. Both the current
  // `terminal` shape and any stale `host` shape route the same way.
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
        .exhaustive(),
    ),
  );

  // e2e bridge: fire an alert for a chosen active-host terminal, bypassing the
  // watched/latch gates so a scenario can assert delivery. Faithful to the retired
  // `useTerminalAlerts.simulateAlert` so existing agent-state scenarios pass.
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
    deliver(activeHost(), pick, asking);
  };
  window.__koluSimulateAlert = simulateAlert;

  return { simulateAlert };
}
