/** Regression coverage for the agent-state transition diff in `useTerminalAlerts`.
 *
 *  The bug this pins (juspay/kolu — "zest re-notifies on every host switch"): the
 *  effect used to diff agent states POSITIONALLY by array index (`prevStates[i]`
 *  vs `states[i]`). But `deps.terminalIds()` is the ACTIVE host's window — a host
 *  switch swaps the whole list, and even within one host an insert/remove reorders
 *  it — so index `i` named a DIFFERENT terminal across two ticks. A terminal sitting
 *  in `awaiting_user` (e.g. `nixos-config` on zest) whose index-peer on the prior
 *  list was `thinking` read as a fresh entry into the notify class and re-fired.
 *  The fix keys the diff by `TerminalId`, so only a terminal we were ALREADY
 *  tracking last tick can transition — a first-sighting has no prior state and is
 *  skipped. These tests fail on the positional diff and pass on the keyed one. */

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

type AgentState = "thinking" | "awaiting_user" | "waiting";
const meta = (state: AgentState): TerminalMetadata =>
  ({ state: "active", agent: { state } }) as unknown as TerminalMetadata;

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
      getSubject: () => ({ title: "t", description: "d" }) as never,
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
  return { setIds, setStore, dispose };
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
    setStore({ a1: { state: "active" } as unknown as TerminalMetadata });
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
    setStore({ dup: { state: "active" } as unknown as TerminalMetadata });
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
