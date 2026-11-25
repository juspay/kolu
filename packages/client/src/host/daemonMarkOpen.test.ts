/** The daemon mark's open/switch seam (`HostDaemonChips`'s two sub-chips).
 *
 *  The rule under test is a STANDING one — a shown panel describes the ACTIVE
 *  host — so it is a derivation, not a correction: the panel stops showing the
 *  instant the canvas moves off this host, in the same flush, and Solid's
 *  attribution tier (`@kolu/solid-test-setup` holds it open) fails the case if
 *  the hiding is ever done by an effect writing the flag it reads
 *  (`EFFECT_WRITES_OWN_SOURCE`: two flushes, the stale panel painted between
 *  them). */

import { type HostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { createRoot, flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { type DaemonMarkOpen, useDaemonMarkOpen } from "./daemonMarkOpen.ts";

const ZEST: HostKey = { kind: "remote", target: "zest" };

// The per-tab active host, as the seam reads and writes it. A plain signal is
// the whole of `wire.ts`'s contract here, and a mock keeps the module-singleton
// wire (sockets, the host map) out of a unit test.
const bag = vi.hoisted(() => ({
  activeHost: (): HostKey => ({ kind: "local" }),
  setActiveHost: (_h: HostKey): void => {},
}));
vi.mock("../wire", async () => {
  // `solid-js` inside the factory: a hoisted factory runs before this file's
  // own imports are evaluated, so it cannot close over them.
  const { createSignal } = await import("solid-js");
  const [active, setActive] = createSignal<HostKey>({ kind: "local" });
  bag.activeHost = active;
  bag.setActiveHost = (h) => setActive(h);
  return { activeHost: active, setActiveHost: (h: HostKey) => setActive(h) };
});

/** The seam under its own app-lifetime owner, driven from OUTSIDE it — a write
 *  made inside a root's body is an owned-scope write, which is a diagnostic of
 *  its own and not the shape a click or a membership frame has. */
function mount(host: HostKey): DaemonMarkOpen & { dispose: () => void } {
  let mark!: DaemonMarkOpen;
  let dispose!: () => void;
  createRoot((d) => {
    mark = useDaemonMarkOpen(host);
    dispose = d;
  });
  return { ...mark, dispose };
}

describe("useDaemonMarkOpen", () => {
  it("opens for an inactive host by switching the canvas to it first", () => {
    bag.setActiveHost(LOCAL_HOST);
    const mark = mount(ZEST);
    flush();
    expect(mark.open()).toBe(false);

    mark.openForHost();
    flush();
    expect(bag.activeHost()).toEqual(ZEST);
    expect(mark.open()).toBe(true);

    // Already active: the same seam toggles the panel shut.
    mark.openForHost();
    flush();
    expect(mark.open()).toBe(false);
    mark.dispose();
  });

  it("hides the panel when the active host moves off this host, in one flush", () => {
    bag.setActiveHost(ZEST);
    const mark = mount(ZEST);
    mark.openForHost();
    flush();
    expect(mark.open()).toBe(true);

    // wire.ts's departed-bounce moves the canvas to local with no outside
    // click. The panel must not paint a frame of the cross-host mix, so the
    // hiding is a derivation — and the setup's attribution tier fails this case
    // with EFFECT_WRITES_OWN_SOURCE if it is ever a correcting effect instead.
    bag.setActiveHost(LOCAL_HOST);
    flush();
    expect(mark.open()).toBe(false);

    // Switching back shows the panel the user opened: the same standing rule.
    bag.setActiveHost(ZEST);
    flush();
    expect(mark.open()).toBe(true);
    mark.dispose();
  });
});
