import type { Terminal } from "@xterm/xterm";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderRecovery, WATCHDOG_DELAY_MS } from "./renderRecovery";

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
      r.noteData();
      focused = false;
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
      r.noteData();
      f.fireRender();
      vi.advanceTimersByTime(WATCHDOG_DELAY_MS);
      expect(f.refreshCalls).toHaveLength(0);
      dispose();
    });
  });

  it("does NOT force during healthy continuous output: a normal paint disarms the stale watchdog a later chunk would otherwise trip", () => {
    createRoot((dispose) => {
      const f = makeFakeTerm();
      const r = createRenderRecovery(f.term, () => true, {
        hasFocus: () => true,
      });
      r.noteData();
      vi.advanceTimersByTime(16);
      f.fireRender();
      vi.advanceTimersByTime(224);
      r.noteData();
      vi.advanceTimersByTime(20);
      expect(f.refreshCalls).toHaveLength(0);
      f.fireRender();
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
      expect(f.refreshCalls).toHaveLength(1);
      dispose();
    });
  });

  it("exposes render-pipeline probes (parked rAF, pause, sync-output, ms-since-paint)", () => {
    createRoot((dispose) => {
      const f = makeFakeTerm();
      const r = createRenderRecovery(f.term, () => true, {
        hasFocus: () => true,
      });

      expect(r.probes.msSinceLastPaint()).toBeNull();
      f.fireRender();
      vi.advanceTimersByTime(500);
      expect(r.probes.msSinceLastPaint()).toBe(500);

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

  it("reports renderDebouncerPending as null (unknown), not false, when _animationFrame was renamed away", () => {
    createRoot((dispose) => {
      const renamed = {
        rows: 24,
        onRender: () => ({ dispose() {} }),
        _core: { _renderService: { _renderDebouncer: {} } },
      } as unknown as Terminal;
      const r = createRenderRecovery(renamed, () => true, {
        hasFocus: () => true,
      });
      expect(r.probes.renderDebouncerPending()).toBeNull();
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
      expect(() => r.recover()).not.toThrow();
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
    r.noteData();
    expect(f.renderHandlerCount()).toBe(1);

    dispose();

    expect(f.renderHandlerCount()).toBe(0);
    vi.advanceTimersByTime(WATCHDOG_DELAY_MS * 2);
    expect(f.refreshCalls).toHaveLength(0);
  });
});
