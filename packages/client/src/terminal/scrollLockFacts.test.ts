// DOES THE SCROLL-TO-BOTTOM BUTTON TEAR?
//
// The button's props live in `<Terminal>`'s JSX effect, which also reads the
// pane's own store. The scroll lock's reactive mirrors move from inside the
// EFFECT PHASE — the write door buffers a chunk while the user holds a
// position in scrollback — so a store write that happens in the same turn as
// arriving output ran that one effect twice: once in the store's flush with
// the lock state stale, and again when the door's write landed
// (`EFFECT_RELAY_TEAR`, Solid grades it `warn` from the third sighting).
//
// This reproduces that pair against the REAL `createScrollLock`: a root signal
// standing in for the pane store, a consumer effect standing in for the JSX,
// and an output sink that writes through the lock's door from its apply arm.

import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { createScrollLock } from "@kolu/xterm-kit/solid";
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { createScrollLockFacts } from "./scrollLockFacts";

/** Enough xterm for the lock: a viewport that can move and a sink to write. */
function makeTerm() {
  const buf = { baseY: 0, viewportY: 0 };
  const handlers: ((y: number) => void)[] = [];
  const written: string[] = [];
  return {
    buf,
    written,
    fire() {
      for (const h of [...handlers]) h(buf.viewportY);
    },
    term: {
      buffer: { active: buf },
      onScroll(h: (y: number) => void) {
        handlers.push(h);
        return { dispose() {} };
      },
      write(data: string, cb?: () => void) {
        written.push(data);
        cb?.();
      },
      resize() {},
      scrollToBottom() {
        buf.viewportY = buf.baseY;
      },
    } as unknown as Terminal,
  };
}

describe("createScrollLockFacts", () => {
  it("shows the button one state per change when output arrives under a store write", () => {
    const m = makeTerm();
    let lock!: ReturnType<typeof createScrollLock>;
    const disposeLock = createRoot((d) => {
      lock = createScrollLock(() => true);
      lock.attachToTerminal(m.term);
      return d;
    });
    // Scroll up on a real user wheel: the lock engages and the door buffers.
    m.buf.baseY = 100;
    m.buf.viewportY = 100;
    m.fire();
    lock.armUserScrollIntent("wheel");
    m.buf.viewportY = 90;
    m.fire();
    expect(lock.isLocked()).toBe(true);

    // The pane store's length — the root write Solid traces the tear to.
    const [panes, setPanes] = createSignal(1);
    const frames: { panes: number; visible: boolean; active: boolean }[] = [];
    const disposeView = createRoot((d) => {
      const facts = createScrollLockFacts(() => ({ scrollLock: lock }));
      createEffect(
        () => ({
          panes: panes(),
          visible: facts().locked,
          active: facts().newOutput,
        }),
        (v) => {
          frames.push(v);
        },
        { name: "scrollToBottomButtonProps" },
      );
      // Terminal output reaches the lock's write door from an effect's apply
      // arm, which is where the door's mirror write lands.
      createEffect(
        () => panes(),
        (n) => {
          lock.writeData(m.term, `chunk${n}`);
        },
        { name: "terminalOutputSink" },
      );
      return d;
    });
    flush();
    for (let n = 2; n <= 5; n += 1) {
      setPanes(n);
      flush();
    }

    // ONE frame per store write. The two at `panes: 1` are the mount and the
    // first chunk turning `newOutput` on — two real states, in two flushes.
    // Reading the lock inline instead gave `[1, 1, 2, 2, 3, 3, 4, 4, 5, 5]`:
    // every store write painted once with the stale lock state and again
    // after the door's mirror write relayed it.
    expect(frames.map((f) => f.panes)).toEqual([1, 1, 2, 3, 4, 5]);
    // And it is the right state: locked with output held from the first chunk.
    expect(frames.at(-1)).toEqual({ panes: 5, visible: true, active: true });

    // Releasing flushes the held bytes and clears both facts in one frame.
    lock.reset();
    flush();
    expect(frames.at(-1)).toEqual({ panes: 5, visible: false, active: false });
    expect(m.written).toEqual(["chunk1chunk2chunk3chunk4chunk5"]);

    disposeView();
    disposeLock();
  });
});
