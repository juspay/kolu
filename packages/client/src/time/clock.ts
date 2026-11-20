import { type Accessor, createSignal } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";

/** One shared app-lifetime reactive tick over a time source, at `intervalMs`
 *  cadence. Hidden tabs stop the interval; revealing the tab refreshes and
 *  resumes it. */
export const makeTickingClock = (
  read: () => number,
  intervalMs = 1_000,
): (() => Accessor<number>) =>
  createSharedRoot<Accessor<number>>(() => {
    const [now, setNow] = createSignal(read());
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      setNow(read());
      timer = setInterval(() => setNow(read()), intervalMs);
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    return now;
  });

/** `Date.now()` that advances every second. */
export const getClockNow = makeTickingClock(Date.now);

/** `performance.now()` that advances every second; the VALUE is monotonic. */
export const getMonotonicNow = makeTickingClock(() => performance.now());
