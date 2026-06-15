import type { Terminal } from "@xterm/xterm";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderRecovery, WATCHDOG_DELAY_MS } from "./renderRecovery";

/** Minimal xterm stand-in exposing the private `_core._renderService` shape
 *  renderRecovery reaches through, plus a controllable `onRender` and the
 *  internal flags the probes read. `refreshRows` records its calls so a test
 *  can assert a forced SYNCHRONOUS repaint happened (sync === true). */
function makeFakeTerm() {
  const renderHandlers: (() => void)[] = [];
  const refreshCalls: { start: number; end: number; sync?: boolean }[] = [];
  let animationFrame: number | undefined;
  let paused = false;
  let sync = false;

  const term = {
    rows: 24,
    onRender(cb: () => void) {
      renderHandlers.push(cb);
      return {
        dispose() {
          const i = renderHandlers.indexOf(cb);
          if (i >= 0) renderHandlers.splice(i, 1);
        },
      };
    },
    _core: {
      _renderService: {
        refreshRows(start: number, end: number, s?: boolean) {
          refreshCalls.push({ start, end, sync: s });
        },
        _renderDebouncer: {
          get _animationFrame() {
            return animationFrame;
          },
        },
        get _isPaused() {
          return paused;
        },
      },
      _coreService: {
        decPrivateModes: {
          get synchronizedOutput() {
            return sync;
          },
        },
      },
    },
  };

  return {
    term: term as unknown as Terminal,
    fireRender: () => {
      for (const h of [...renderHandlers]) h();
    },
    renderHandlerCount: () => renderHandlers.length,
    refreshCalls,
    setAnimationFrame: (v: number | undefined) => {
      animationFrame = v;
    },
    setPaused: (v: boolean) => {
      paused = v;
    },
    setSync: (v: boolean) => {
      sync = v;
    },
  };
}

describe("renderRecovery", () => {
  beforeEach(() => {
    // Fake timers also fake Date.now, so the watchdog's setTimeout AND the
    // module's `now()` advance together under advanceTimersByTime.
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("watchdog forces a SYNCHRONOUS repaint when output arrived but no paint followed (focused, on-screen)", () => {
    createRoot((dispose) => {
      const f = makeFakeTerm();
      const r = createRenderRecovery(f.term, () => true, {
        hasFocus: () => true,
      });
      // Baseline paint at t=0, then data arrives later with no paint after it.
      f.fireRender();
      vi.advanceTimersByTime(1000);
      r.noteData();
      vi.advanceTimersByTime(WATCHDOG_DELAY_MS);

      expect(f.refreshCalls).toHaveLength(1);
      expect(f.refreshCalls[0]).toEqual({ start: 0, end: 23, sync: true });
      dispose();
    });
  });

  it("does NOT arm the watchdog while the document lacks focus (occluded — nobody's looking)", () => {
    createRoot((dispose) => {
      const f = makeFakeTerm();
      const r = createRenderRecovery(f.term, () => true, {
        hasFocus: () => false,
      });
      r.noteData();
      vi.advanceTimersByTime(WATCHDOG_DELAY_MS * 4);
      expect(f.refreshCalls).toHaveLength(0);
      dispose();
    });
  });

  it("does NOT force if focus is lost between arming and the watchdog firing", () => {
    createRoot((dispose) => {
      const f = makeFakeTerm();
      let focused = true;
      const r = createRenderRecovery(f.term, () => true, {
        hasFocus: () => focused,
      });
      f.fireRender();
      vi.advanceTimersByTime(1000);
      r.noteData(); // arms (focused)
      focused = false; // window goes away before the timer fires
      vi.advanceTimersByTime(WATCHDOG_DELAY_MS);
      expect(f.refreshCalls).toHaveLength(0);
      dispose();
    });
  });

  it("is a no-op when a paint kept up with the data (normal focused output)", () => {
    createRoot((dispose) => {
      const f = makeFakeTerm();
      const r = createRenderRecovery(f.term, () => true, {
        hasFocus: () => true,
      });
      vi.advanceTimersByTime(1000);
      r.noteData(); // lastDataAt = 1000
      f.fireRender(); // paint catches up: lastPaintAt = 1000
      vi.advanceTimersByTime(WATCHDOG_DELAY_MS);
      expect(f.refreshCalls).toHaveLength(0);
      dispose();
    });
  });

  it("recover() forces a sync repaint when on-screen, and is a no-op when off-screen", () => {
    createRoot((dispose) => {
      const f = makeFakeTerm();
      let onScreen = true;
      const r = createRenderRecovery(f.term, () => onScreen, {
        hasFocus: () => true,
      });

      r.recover();
      expect(f.refreshCalls).toHaveLength(1);
      expect(f.refreshCalls[0]?.sync).toBe(true);

      onScreen = false;
      r.recover();
      expect(f.refreshCalls).toHaveLength(1); // unchanged
      dispose();
    });
  });

  it("exposes render-pipeline probes (parked rAF, pause, sync-output, ms-since-paint)", () => {
    createRoot((dispose) => {
      const f = makeFakeTerm();
      const r = createRenderRecovery(f.term, () => true, {
        hasFocus: () => true,
      });

      // ms-since-paint reads 0 until the first paint, then tracks the clock.
      expect(r.probes.msSinceLastPaint()).toBe(0);
      f.fireRender();
      vi.advanceTimersByTime(500);
      expect(r.probes.msSinceLastPaint()).toBe(500);

      // Parked-rAF probe reflects the live debouncer handle.
      f.setAnimationFrame(undefined);
      expect(r.probes.renderDebouncerPending()).toBe(false);
      f.setAnimationFrame(7);
      expect(r.probes.renderDebouncerPending()).toBe(true);

      f.setPaused(true);
      expect(r.probes.isPaused()).toBe(true);

      f.setSync(true);
      expect(r.probes.synchronizedOutput()).toBe(true);
      dispose();
    });
  });

  it("degrades to null probes / no-op repaint when xterm's private shape is absent", () => {
    createRoot((dispose) => {
      const bare = {
        rows: 24,
        onRender: () => ({ dispose() {} }),
      } as unknown as Terminal;
      const r = createRenderRecovery(bare, () => true, {
        hasFocus: () => true,
      });

      expect(r.probes.renderDebouncerPending()).toBeNull();
      expect(r.probes.isPaused()).toBeNull();
      expect(r.probes.synchronizedOutput()).toBeNull();
      expect(() => r.recover()).not.toThrow(); // no refreshRows to call
      dispose();
    });
  });

  it("disposes its onRender subscription and clears a pending watchdog on owner dispose", () => {
    const f = makeFakeTerm();
    let r!: ReturnType<typeof createRenderRecovery>;
    const dispose = createRoot((d) => {
      r = createRenderRecovery(f.term, () => true, { hasFocus: () => true });
      return d;
    });
    f.fireRender();
    vi.advanceTimersByTime(1000);
    r.noteData(); // arms a watchdog
    expect(f.renderHandlerCount()).toBe(1);

    dispose(); // onCleanup: dispose onRender + disarm watchdog

    expect(f.renderHandlerCount()).toBe(0);
    vi.advanceTimersByTime(WATCHDOG_DELAY_MS * 2);
    expect(f.refreshCalls).toHaveLength(0); // the armed watchdog was cleared
  });
});
