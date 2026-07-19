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
 *  return the levers a test drives. `activeId` defaults to null so every terminal is
 *  a background alert (delivery always succeeds, no `document.hasFocus()` dependence);
 *  `setActiveId` lets a test make a terminal the actively-watched one to exercise the
 *  visibility-suppression gate. */
function harness() {
  const [ids, setIds] = createSignal<TerminalId[]>([]);
  const [activeId, setActiveId] = createSignal<TerminalId | null>(null);
  const markUnread = vi.fn();
  const [store, setStore] = createStore<
    Record<string, TerminalMetadata | undefined>
  >({});
  // `useTerminalAlerts` installs a module-global `window.__koluSimulateAlert`;
  // snapshot it so the per-test teardown restores whatever was there before,
  // rather than leaving the last harness's closure globally reachable.
  const priorSimulate = window.__koluSimulateAlert;
  const dispose = createRoot((d) => {
    useTerminalAlerts({
      activeId,
      activate: vi.fn(),
      getMetadata: (id) => store[id],
      getSubject: () => ({ title: "t", description: "d" }),
      markUnread,
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
  return { setIds, setStore, setActiveId, markUnread };
}

beforeEach(() => {
  fired.mockClear();
  h.activeHost = { kind: "local" };
  h.activityAlerts = true;
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

// #1177 — "awaiting_user doesn't always chime". `waiting` and `awaiting_user`
// share one alert class (`alertClass` → "notify"), and the OLD `checkAgentFinished`
// fired only on ENTRY into that class — so a real human gate landing over an
// ALREADY-`waiting` row (`waiting → awaiting_user`) was an intra-class move: the
// dock pip lit (it reads `agent.state` directly) but the sound/OS notification was
// swallowed. Intermittency was timing — whether the ~1s scrape caught the prompt
// before or after the JSONL settled the prior turn to `waiting`.
//
// The fix (per #1690, mechanism reproduced then ratified): fire on class-entry OR
// an ESCALATION into the `awaiting` bucket, deduped by a per-terminal
// attention-EPISODE latch that resets ONLY on a work state (never on `waiting`).
// The work-state reset is the discriminator — a genuinely new gate always passes
// through work; scrape/JSONL settle jitter never does — so a gate over a waiting
// row chimes while flap/settle jitter collapses to a single chime.
describe("useTerminalAlerts — #1177 awaiting_user chime", () => {
  // Was the RED pin (`it.fails`); the fix flips it to `it`. A genuine human gate
  // (AskUserQuestion / permission prompt) landing over an already-`waiting` row
  // must chime. `a1` is `waiting` at mount (a first sighting at `waiting`, so it's
  // left UNLATCHED and no chime fires for the pre-existing state), then the prompt
  // promotes it — the escalation fires with the "needs input" copy.
  it("fires on waiting → awaiting_user (a gate over an already-waiting row)", async () => {
    const { setStore, setIds } = harness();
    setStore({ a1: meta("waiting") });
    setIds([T("a1")]);
    await tick(); // mount: first sighting of `a1` at `waiting`, no chime

    setStore("a1", meta("awaiting_user")); // the human gate lands
    await tick();

    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0]?.[1]).toBe(T("a1"));
    expect(fired.mock.calls[0]?.[3]).toBe(true); // "needs your input", not "finished"
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
    expect(fired.mock.calls[0]?.[3]).toBe(true); // awaiting → needs-input copy
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
    expect(fired.mock.calls[0]?.[3]).toBe(false); // turn-end → "finished" copy

    setStore("a2", meta("awaiting_user")); // sibling transition re-runs the effect
    await tick();

    // a2 chimed; a1 (still `waiting`) did NOT re-fire.
    expect(fired).toHaveBeenCalledTimes(2);
    expect(fired.mock.calls[1]?.[1]).toBe(T("a2"));
  });

  it("GREEN control: an awaiting_user → waiting → awaiting_user flap chimes exactly ONCE", async () => {
    // The scrape-settle race: after a genuine `thinking → awaiting_user` chime,
    // the ~1s poll can briefly read the prior turn's `waiting` and then flap back
    // to `awaiting_user` as the JSONL settles. The episode latch (unbroken by the
    // intra-class `waiting`) suppresses the re-entry.
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

  it("GREEN control: settle jitter thinking → waiting → awaiting_user chimes exactly ONCE", async () => {
    // A pending gate can read `thinking`, briefly settle to the prior turn's
    // `waiting`, then land on `awaiting_user` — one physical gate, three states.
    // The class-entry chime on `waiting` sets the episode latch; the escalation to
    // `awaiting_user` finds the latch set and does NOT double-fire. (A bare
    // `prev !== "awaiting_user"` trigger would fire twice here.)
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();

    setStore("a1", meta("waiting")); // stale read of the prior turn
    await tick();
    setStore("a1", meta("awaiting_user")); // the real gate settles in
    await tick();

    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("GREEN control: finish then RE-ENGAGE (thinking → waiting → thinking → awaiting_user) chimes TWICE", async () => {
    // The agent finishes (chime), the user comes back and prompts, the agent works
    // (a real work state RESETS the episode), then asks a question — a genuinely
    // new gate that MUST chime again. The work-state reset is what tells this apart
    // from settle jitter (which never passes through work).
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();

    setStore("a1", meta("waiting")); // finished: chime 1 ("finished")
    await tick();
    setStore("a1", meta("thinking")); // re-engaged: episode resets
    await tick();
    setStore("a1", meta("awaiting_user")); // new gate: chime 2 ("needs input")
    await tick();

    expect(fired).toHaveBeenCalledTimes(2);
    expect(fired.mock.calls[0]?.[3]).toBe(false); // finished
    expect(fired.mock.calls[1]?.[3]).toBe(true); // needs input
  });

  it("GREEN control: a steady-state awaiting terminal re-tracked after a host-switch-back does NOT re-chime", async () => {
    // `a1` chimes on host A. Switching away and back re-tracks it while it sits in
    // `awaiting_user`. The per-host latch clear pre-latches it as an already-awaiting
    // first sighting, and the transition trigger never fires on same-state
    // membership — so a subsequent same-host tick does not re-chime (the zest fix,
    // now guarded by the latch too).
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();
    setStore("a1", meta("awaiting_user")); // chime on host A
    await tick();
    expect(fired).toHaveBeenCalledTimes(1);

    // Switch to host B and back to A; `a1` stays `awaiting_user` throughout.
    h.activeHost = { kind: "remote", target: "zest" };
    setStore({ b1: meta("thinking") });
    setIds([T("b1")]);
    await tick();
    h.activeHost = { kind: "local" };
    setStore({ a1: meta("awaiting_user") });
    setIds([T("a1")]);
    await tick(); // host-switch-back: `a1` is a first sighting, pre-latched

    // A later same-host tick (a sibling appears) with `a1` still awaiting.
    setStore("a2", meta("thinking"));
    setIds([T("a1"), T("a2")]);
    await tick();

    expect(fired).toHaveBeenCalledTimes(1); // no re-chime for the re-tracked row
  });

  it("C1: a genuine gate after alerts are toggled off then on still fires (latch not frozen)", async () => {
    // Episode bookkeeping runs unconditionally; only emission is gated. So the
    // work-state reset happens even while alerts are off — a gate arriving after
    // re-enable is NOT swallowed by a frozen latch (that would reintroduce #1177
    // through the preference toggle).
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();

    setStore("a1", meta("awaiting_user")); // chime 1 (alerts on)
    await tick();
    expect(fired).toHaveBeenCalledTimes(1);

    h.activityAlerts = false;
    setStore("a1", meta("thinking")); // work state passes WHILE OFF → resets latch
    await tick();
    h.activityAlerts = true;
    setStore("a1", meta("awaiting_user")); // new gate after re-enable
    await tick();

    expect(fired).toHaveBeenCalledTimes(2); // fires — latch was reset unconditionally
    h.activityAlerts = true;
  });

  it("C2: an id removed then re-added at waiting is not swallowed by a ghost latch", async () => {
    // A latched id that leaves `terminalIds()` must be pruned from the latch, or a
    // same-host id reuse (drain/restore, sleep-wake re-seed) inherits the ghost and
    // its genuine gate is swallowed.
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();
    setStore("a1", meta("awaiting_user")); // chime, `a1` latched
    await tick();
    expect(fired).toHaveBeenCalledTimes(1);

    setIds([]); // `a1` leaves the tracked set → latch pruned
    await tick();

    setStore("a1", meta("waiting")); // re-added at `waiting` (first sighting, unlatched)
    setIds([T("a1")]);
    await tick();
    setStore("a1", meta("awaiting_user")); // a fresh gate
    await tick();

    expect(fired).toHaveBeenCalledTimes(2); // fires — no ghost latch
  });

  it("C3: an id first-sighted AT awaiting_user then settle-flapped does NOT chime a phantom", async () => {
    // A first sighting already inside the `awaiting` bucket is pre-latched, so a
    // settle-flap (`awaiting_user → waiting → awaiting_user`) around it can't
    // manufacture a chime the old entry rule never produced. (A first sighting at
    // `waiting` — the RED case above — is left unlatched, so genuine gates still fire.)
    const { setStore, setIds } = harness();
    setStore({ a1: meta("awaiting_user") }); // first sighting already awaiting
    setIds([T("a1")]);
    await tick();

    setStore("a1", meta("waiting")); // scrape jitter
    await tick();
    setStore("a1", meta("awaiting_user")); // flaps back
    await tick();

    expect(fired).not.toHaveBeenCalled(); // pre-latched → no phantom chime
  });

  it("C6c: a latched id, after a host switch, fires once on host B's own thinking → awaiting_user", async () => {
    // The per-host latch clear must not SUPPRESS a genuine gate on the new host: a
    // latch from host A can't cross to a same-id terminal on host B.
    const { setStore, setIds } = harness();
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();
    setStore("a1", meta("awaiting_user")); // chime on host A → `a1` latched
    await tick();
    expect(fired).toHaveBeenCalledTimes(1);

    h.activeHost = { kind: "remote", target: "zest" };
    setStore({ a1: meta("thinking") }); // SAME id on host B, working
    setIds([T("a1")]);
    await tick(); // host switch clears the latch
    setStore("a1", meta("awaiting_user")); // host B's own gate
    await tick();

    expect(fired).toHaveBeenCalledTimes(2); // fires exactly once on host B
    expect(fired.mock.calls[1]?.[1]).toBe(T("a1"));
  });

  it("codex-F1: a finish SUPPRESSED because the user is watching does NOT latch — a gate after they look away still chimes", async () => {
    // The visibility gate mirrors the pref gate: if the user is actively watching a
    // terminal (it's the active tile AND kolu is focused), a `thinking → waiting`
    // finish is deliberately NOT chimed. But it must ALSO not latch the episode — or
    // a genuine `waiting → awaiting_user` gate that lands AFTER the user looks away is
    // swallowed (the #1177 class, via the visibility gate rather than the class rule).
    // The latch tracks actual DELIVERY, not the decision to chime.
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    onTestFinished(() => focus.mockRestore());

    const { setStore, setIds, setActiveId, markUnread } = harness();
    setActiveId(T("a1")); // a1 is the actively-watched terminal (active + focused)
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();

    setStore("a1", meta("waiting")); // finishes while watched → suppressed, unlatched
    await tick();
    expect(fired).not.toHaveBeenCalled();
    expect(markUnread).not.toHaveBeenCalled(); // active tile is never marked unread

    setActiveId(T("a2")); // the user looks away → a1 is now a background terminal
    setStore("a1", meta("awaiting_user")); // a real gate lands over the waiting row
    await tick();

    // The gate is NOT swallowed by a phantom latch: it chimes exactly once, with the
    // needs-input copy, and marks the now-background terminal unread.
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0]?.[1]).toBe(T("a1"));
    expect(fired.mock.calls[0]?.[3]).toBe(true);
    expect(markUnread).toHaveBeenCalledWith(T("a1"));
  });

  it("codex-F2: a live gate SEEN while actively watched latches — a later settle-flap does NOT phantom-chime", async () => {
    // The mirror of codex-F1: when the suppressed candidate is itself a live gate
    // (`awaiting_user`), the actively-watching user has ALREADY SEEN it — their eyes
    // are the channel. So it must latch even though no external alert fired, or a
    // scrape-jitter flap (`awaiting_user → waiting → awaiting_user`) after they look
    // away re-chimes a gate they already saw. (A `waiting` finish seen while watched
    // still does NOT latch — that asymmetry is codex-F1 above.)
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    onTestFinished(() => focus.mockRestore());

    const { setStore, setIds, setActiveId } = harness();
    setActiveId(T("a1")); // a1 is the actively-watched terminal
    setStore({ a1: meta("thinking") });
    setIds([T("a1")]);
    await tick();

    setStore("a1", meta("awaiting_user")); // gate lands while watched → seen, no alert…
    await tick();
    expect(fired).not.toHaveBeenCalled(); // …but latched (their eyes saw it)

    setStore("a1", meta("waiting")); // scrape jitter drops to the prior turn
    await tick();
    setActiveId(T("a2")); // the user looks away
    setStore("a1", meta("awaiting_user")); // …and the gate flaps back
    await tick();

    expect(fired).not.toHaveBeenCalled(); // no phantom — the gate was already seen
  });
});
