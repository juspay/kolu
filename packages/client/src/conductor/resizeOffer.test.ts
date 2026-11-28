/**
 * The one press is offered only once a mismatch has outlasted the pane's own
 * resize — so a desktop pane's first look and a window drag never make it
 * blink, while a size someone else holds, or a phone's, still gets it.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResizeOffer } from "./resizeOffer";

const SETTLE = 750;
const SMALL = { cols: 80, rows: 24 };
const BIG = { cols: 145, rows: 50 };

function harness(init: {
  real: TerminalGrid | null;
  asked: TerminalGrid | null;
}) {
  let real = init.real;
  let asked = init.asked;
  let offered = false;
  const offer = createResizeOffer({
    settleMs: SETTLE,
    show: (next) => {
      offered = next;
    },
  });
  const observe = () => offer.observe({ real, asked });
  observe();
  return {
    offered: () => offered,
    real(next: TerminalGrid | null) {
      real = next;
      observe();
    },
    asked(next: TerminalGrid | null) {
      asked = next;
      observe();
    },
    offer,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the Resize to fit offer", () => {
  it("is not offered inside the wait, and is once the mismatch outlasts it", () => {
    const h = harness({ real: SMALL, asked: BIG });
    vi.advanceTimersByTime(SETTLE - 1);
    expect(h.offered()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(h.offered()).toBe(true);
  });

  it("never blinks while the pane's own resize lands", () => {
    // A first look: the pane asks, and the record catches up inside the wait.
    const h = harness({ real: SMALL, asked: BIG });
    vi.advanceTimersByTime(300);
    h.real(BIG);
    vi.advanceTimersByTime(SETTLE * 4);
    expect(h.offered()).toBe(false);
  });

  it("starts the wait again when either size changes — a drag never shows it", () => {
    const h = harness({ real: SMALL, asked: BIG });
    for (const cols of [140, 135, 130, 125]) {
      vi.advanceTimersByTime(SETTLE - 100);
      h.asked({ cols, rows: 50 });
      expect(h.offered()).toBe(false);
    }
    vi.advanceTimersByTime(SETTLE - 100);
    h.real({ cols: 90, rows: 30 });
    vi.advanceTimersByTime(SETTLE - 1);
    expect(h.offered()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(h.offered()).toBe(true);
  });

  it("an unchanged pair, as new objects, keeps the wait it is in", () => {
    const h = harness({ real: SMALL, asked: BIG });
    vi.advanceTimersByTime(SETTLE - 100);
    h.real({ ...SMALL });
    h.asked({ ...BIG });
    vi.advanceTimersByTime(100);
    expect(h.offered()).toBe(true);
  });

  it("is withdrawn the moment the sizes agree, and never offered while they do", () => {
    const h = harness({ real: SMALL, asked: BIG });
    vi.advanceTimersByTime(SETTLE);
    expect(h.offered()).toBe(true);
    h.real(BIG);
    expect(h.offered()).toBe(false);
    vi.advanceTimersByTime(SETTLE * 4);
    expect(h.offered()).toBe(false);
  });

  it("offers nothing on a record that states no size, or before the pane has measured", () => {
    const noRecord = harness({ real: null, asked: BIG });
    const unmeasured = harness({ real: SMALL, asked: null });
    vi.advanceTimersByTime(SETTLE * 4);
    expect(noRecord.offered()).toBe(false);
    expect(unmeasured.offered()).toBe(false);
  });

  it("offers nothing after the pane is gone", () => {
    const h = harness({ real: SMALL, asked: BIG });
    h.offer.dispose();
    vi.advanceTimersByTime(SETTLE * 4);
    expect(h.offered()).toBe(false);
  });
});
