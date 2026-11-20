import type { NeedsYou } from "kolu-work";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

const inView = new Map<string, number>();

const observerLatch = {
  awaited: 0,
  waiting: new Set<() => void>(),

  expectReport(): void {
    observerLatch.awaited += 1;
  },

  report(): void {
    observerLatch.awaited -= 1;
    if (observerLatch.awaited > 0) return;
    const waiting = [...observerLatch.waiting];
    observerLatch.waiting.clear();
    for (const run of waiting) run();
  },

  whenReported(run: () => void): void {
    if (observerLatch.awaited === 0) run();
    else observerLatch.waiting.add(run);
  },

  forget(run: () => void): void {
    observerLatch.waiting.delete(run);
  },
};

export const cardOnScreenKey = (work: string): string => `card:${work}`;
export const askOnScreenKey = (ask: string): string => `ask:${ask}`;

export const isNeedInView = (item: NeedsYou): boolean =>
  document.hasFocus() &&
  (inView.get(
    item.why.why === "question"
      ? askOnScreenKey(item.why.ask)
      : cardOnScreenKey(item.work),
  ) ?? 0) > 0;

export function afterViewKnown(decide: () => void): () => void {
  let waiting = false;
  let frame: number | undefined;
  const run = (): void => {
    waiting = false;
    decide();
  };
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    observerLatch.forget(run);
  });
  return () => {
    if (waiting) return;
    if (!document.hasFocus()) {
      decide();
      return;
    }
    waiting = true;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      observerLatch.whenReported(run);
    });
  };
}

export function trackOnScreen(
  key: Accessor<string>,
  shown: Accessor<boolean>,
): (el: HTMLElement) => void {
  const [box, setBox] = createSignal<HTMLElement>();
  const [intersecting, setIntersecting] = createSignal(false);
  createEffect(() => {
    const el = box();
    if (el === undefined) return;
    let reported = false;
    const reportedOnce = (): void => {
      if (reported) return;
      reported = true;
      observerLatch.report();
    };
    observerLatch.expectReport();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setIntersecting(entry.isIntersecting);
      reportedOnce();
    });
    observer.observe(el);
    onCleanup(() => {
      observer.disconnect();
      reportedOnce();
    });
  });
  createEffect(() => {
    if (!intersecting() || !shown()) return;
    const at = key();
    inView.set(at, (inView.get(at) ?? 0) + 1);
    onCleanup(() => {
      const left = (inView.get(at) ?? 1) - 1;
      if (left > 0) inView.set(at, left);
      else inView.delete(at);
    });
  });
  return setBox;
}
