/** Regression coverage for the agent-state transition diff in `useTerminalAlerts`.
 *
 *  The bug this pins (juspay/kolu — "zest re-notifies on every host switch"): the
 *  effect used to diff agent states POSITIONALLY by array index (`prevStates[i]`
 *  vs `states[i]`). But `deps.terminalIds()` is the ACTIVE host's window — a host
 *  switch swaps the whole list, and even within one host an insert/remove reorders
 *  it — so index `i` named a DIFFERENT terminal across two ticks. A terminal sitting
 *  in `awaiting_user` (e.g. `nixos-config` on zest) whose index-peer on the prior
 *  list was `thinking` read as a fresh entry into the notify class and re-fired.
 *  The fix keys the diff by `TerminalId` and scopes it to the active host, so only
 *  a terminal we were ALREADY tracking last tick on the same host can transition —
 *  a first-sighting (host switch, late metadata, or a session-imported id shared
 *  across hosts) has no prior state and is skipped. These tests fail on the
 *  positional diff and pass on the keyed, host-scoped one. */

import type { TerminalMetadata } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

const T = (s: string) => s as TerminalId;

// `useTerminalAlerts` reads `activeHost` / `preferences` from `../wire`; drive both
// through a hoisted bag so a test can flip the active host mid-run. Alerts are ON.
const h = vi.hoisted(() => ({
  activeHost: { kind: "local" } as
    | { kind: "local" }
    | { kind: "remote"; target: string },
  activityAlerts: true,
}));
vi.mock("../wire", () => ({
  activeHost: () => h.activeHost,
  preferences: () => ({ activityAlerts: h.activityAlerts }),
}));

// The one output seam — mock it so we assert "did we fire?" without touching the
// service worker or Audio. `useTerminalAlerts` calls `fireActivityAlert` for every
// terminal it decides to alert.
vi.mock("./useActivityAlerts", () => ({ fireActivityAlert: vi.fn() }));

import { useTerminalAlerts } from "./useTerminalAlerts";
import { fireActivityAlert } from "./useActivityAlerts";

const fired = vi.mocked(fireActivityAlert);

/** Flush SolidJS's queued reactive effects (they don't run synchronously inside
 *  `createRoot`; a signal/store write made after mount flushes on the next tick). */
const tick = () => new Promise((r) => setTimeout(r, 0));

type AgentState = "thinking" | "waiting" | "awaiting_user";
const meta = (state: AgentState): TerminalMetadata =>
  ({ state: "active", agent: { state } }) as unknown as TerminalMetadata;
/** A live terminal with NO detected agent — a plain shell, or an agent not yet
 *  detected. `activeArm(...)?.agent?.state` yields `undefined` for it. */
const shell = (): TerminalMetadata =>
  ({ state: "active" }) as unknown as TerminalMetadata;

/** Stand up the hook over a reactive terminal list + a `createStore`-backed
 *  metadata map (mirroring the app's fine-grained per-key metadata reactivity), and
 *  return the levers a test drives. `activeId` is null so every terminal is a
 *  background alert (no `document.hasFocus()` dependence). */
function harness() {
  const [ids, setIds] = createSignal<TerminalId[]>([]);
  const [store, setStore] = createStore<
    Record<string, TerminalMetadata | undefined>
  >({});
  // `useTerminalAlerts` installs a module-global `window.__koluSimulateAlert`;
  // snapshot it so the per-test teardown restores whatever was there before,
  // rather than leaving the last harness's closure globally reachable.
  const priorSimulate = window.__koluSimulateAlert;
  const dispose = createRoot((d) => {
    useTerminalAlerts({
      activeId: () => null,
      activate: vi.fn(),
      getMetadata: (id) => store[id],
      getSubject: () => ({ title: "t", description: "d" }),
      markUnread: vi.fn(),
      terminalIds: ids,
    });
    return d;
  });
  // Dispose the reactive root and restore the global at the end of THIS test, so
  // no test leaks its effect graph or its alert closure into the next one.
  onTestFinished(() => {
    dispose();
    window.__koluSimulateAlert = priorSimulate;
  });
  return { setIds, setStore };
}

beforeEach(() => {
  fired.mockClear();
  h.activeHost = { kind: "local" };
});

describe("useTerminalAlerts — agent-state transition diff", () => {
  it("fires when a tracked terminal really enters the notify class", async () => {
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking"), a2: meta("thinking") });
    setIds([T("a1"), T("a2")]);
    await tick(); // mount: prev is undefined, no fire

    setStore("a2", meta("awaiting_user")); // a genuine thinking → awaiting_user
    await tick();

    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0]?.[1]).toBe(T("a2"));
  });

  it("does NOT re-fire an already-awaiting terminal when switching hosts back to it", async () => {
    const { setStore, setIds } = harness();
    // Host A (local): two working terminals.
    setStore({ a1: meta("thinking"), a2: meta("thinking") });
    setIds([T("a1"), T("a2")]);
    await tick();

    // Switch to host B (zest): its `nixos-config` was ALREADY awaiting before the
    // switch. Positionally, nixos lands where host A's `thinking` a2 sat.
    h.activeHost = { kind: "remote", target: "zest" };
    setStore({ zb1: meta("thinking"), nixos: meta("awaiting_user") });
    setIds([T("zb1"), T("nixos")]);
    await tick();

    expect(fired).not.toHaveBeenCalled();
  });

  it("fires when a tracked terminal's agent appears already in the notify class", async () => {
    // A terminal we were ALREADY tracking last tick with no agent state (plain
    // shell / agent not yet detected) whose agent this tick appears straight in
    // `awaiting_user`. Membership (`has(id)`) distinguishes this from a first
    // sighting, so it must fire — `undefined` prev is not a first-sighting skip.
    const { setStore, setIds } = harness();
    setStore({ a1: shell() });
    setIds([T("a1")]);
    await tick();

    setStore("a1", meta("awaiting_user"));
    await tick();

    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0]?.[1]).toBe(T("a1"));
  });

  it("does NOT re-fire an awaiting terminal when a sibling above it is removed (index shift)", async () => {
    const { setStore, setIds } = harness();
    // `keep` is already awaiting at mount; `del` sits above it.
    setStore({ del: meta("thinking"), keep: meta("awaiting_user") });
    setIds([T("del"), T("keep")]);
    await tick(); // mount: no fire

    // Remove `del` — `keep` shifts from index 1 to index 0, where the prior tick's
    // state was `del`'s `thinking`. A positional diff reads a phantom transition.
    setIds([T("keep")]);
    await tick();

    expect(fired).not.toHaveBeenCalled();
  });

  it("does NOT fire when two hosts share a TerminalId (session import) and one is awaiting", async () => {
    // Session import/restore preserves a SLEEPING terminal's id, so the SAME
    // `TerminalId` can appear on two hosts. Membership (`has(id)`) alone would then
    // pair host B's non-notify state against host A's `awaiting_user` and manufacture
    // the exact phantom. The host gate in the diff must suppress this: a host switch
    // makes every terminal a first sighting regardless of id collision.
    const { setStore, setIds } = harness();
    // Host B (local): the shared id `dup` is a plain shell (agent not detected).
    setStore({ dup: shell() });
    setIds([T("dup")]);
    await tick();

    // Switch to host A (zest): the SAME id `dup` is a live agent already awaiting.
    h.activeHost = { kind: "remote", target: "zest" };
    setStore("dup", meta("awaiting_user"));
    setIds([T("dup")]);
    await tick();

    expect(fired).not.toHaveBeenCalled();
  });
});

// Reproduction pins for #1177 — "awaiting_user doesn't always chime". `waiting`
// and `awaiting_user` share one alert class (`alertClass` → "notify"), and
// `checkAgentFinished` fires only on ENTRY into that class (`notifies(prev)`
// false). So a real human gate landing over an ALREADY-`waiting` row
// (`waiting → awaiting_user`) is an intra-class move: the dock pip lights (it
// reads `agent.state` directly) but the sound/OS notification is swallowed.
// Intermittency is timing — whether the ~1s scrape catches the prompt before or
// after the JSONL settles the prior turn to `waiting`.
//
// Per #1690 the inherited root-cause is a HYPOTHESIS to reproduce, not a fact to
// extend: the RED pin below drives the exact transition through the live effect
// and shows the alert is empirically swallowed today. The three GREEN controls
// fence what the eventual fix must NOT break — today's `thinking → awaiting_user`
// chime, no double-fire on a `waiting` row that merely churns, and no re-fire on
// an `awaiting_user → waiting → awaiting_user` flap inside the scrape-settle
// window (the trap the naive "`prev !== 'awaiting_user'`" shape would fall into).
describe("useTerminalAlerts — #1177 awaiting_user chime", () => {
  // RED: a genuine human gate (AskUserQuestion / permission prompt) that lands
  // over an already-`waiting` row must chime. `it.fails` PINS the bug — the body
  // asserts the CORRECT behavior (fires once) and currently throws because the
  // shared-class entry gate suppresses it; flip `it.fails` → `it` when the fix
  // lands. `a1` is `waiting` at mount (a first sighting, so no chime for the
  // pre-existing state), then the prompt promotes it.
  it.fails("RED: fires on waiting → awaiting_user (a gate over an already-waiting row)", async () => {
    const { setStore, setIds } = harness();
    setStore({ a1: meta("waiting") });
    setIds([T("a1")]);
    await tick(); // mount: first sighting of `a1` at `waiting`, no chime

    setStore("a1", meta("awaiting_user")); // the human gate lands
    await tick();

    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0]?.[1]).toBe(T("a1"));
  });

  it("GREEN control: fires on thinking → awaiting_user (today's chime, must not regress)", async () => {
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();

    setStore("a1", meta("awaiting_user"));
    await tick();

    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0]?.[1]).toBe(T("a1"));
  });

  it("GREEN control: a waiting row does NOT re-fire when the effect re-runs for a sibling", async () => {
    // `a1` enters `waiting` (a legitimate turn-end chime, once). A SIBLING's
    // later transition re-runs the whole diff effect while `a1` stays `waiting` —
    // `a1` must not chime a second time. Pins that `waiting`-only churn (an effect
    // re-run with no real change for that row) never double-fires.
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking"), a2: meta("thinking") });
    setIds([T("a1"), T("a2")]);
    await tick();

    setStore("a1", meta("waiting")); // a1 turn-end: one chime
    await tick();
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0]?.[1]).toBe(T("a1"));

    setStore("a2", meta("awaiting_user")); // sibling transition re-runs the effect
    await tick();

    // a2 chimed; a1 (still `waiting`) did NOT re-fire.
    expect(fired).toHaveBeenCalledTimes(2);
    expect(fired.mock.calls[1]?.[1]).toBe(T("a2"));
  });

  it("GREEN control: an awaiting_user → waiting → awaiting_user flap chimes exactly ONCE", async () => {
    // The scrape-settle race: after a genuine `thinking → awaiting_user` chime,
    // the ~1s poll can briefly read the prior turn's `waiting` and then flap back
    // to `awaiting_user` as the JSONL settles. That re-entry must NOT re-chime.
    // This passes today (both flap legs are intra-class) and is the control the
    // naive "`prev !== 'awaiting_user'`" fix would BREAK — pinning that the fix
    // needs a flap-debounce, not a bare per-state entry rule.
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();

    setStore("a1", meta("awaiting_user")); // genuine gate: one chime
    await tick();
    expect(fired).toHaveBeenCalledTimes(1);

    setStore("a1", meta("waiting")); // scrape briefly settles to the prior turn
    await tick();
    setStore("a1", meta("awaiting_user")); // …then flaps back
    await tick();

    expect(fired).toHaveBeenCalledTimes(1); // still ONE — no flap re-chime
  });
});
