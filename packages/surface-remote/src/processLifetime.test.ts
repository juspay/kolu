/**
 * D1b RED pin (#1908) — lifetime OWNERSHIP at the fire-and-collect spawn seam.
 *
 * The field incident: a `nix-store --realise` ssh child (pid 76722) wedged ~10
 * minutes because NO layer owns its lifetime — `runProgress`/`runCapture`
 * (`process.ts:80-135`) spawn with no timeout, no AbortSignal, no kill path, and
 * resolve ONLY on the child's own `close`/`error`. A remote channel that dies
 * silently (the sshd was reachable, only the exec's channel was gone) leaves the
 * local child parked in `poll()` forever, and the run NEVER settles.
 *
 * These pins are the RED for D1b: `runProgress`/`runCapture` must take a REQUIRED
 * lifetime policy (a deadline / progress-liveness bound) so a caller cannot spawn
 * without deciding who kills a stuck child — and past that bound the run settles
 * with a KILL of the EXACT child (an `ExitResult` of `kind: "signal"`), not an
 * eternal await.
 *
 * `it.fails` per the repo's RED convention (see `canvasModeResolver.test.ts`'s
 * flipped Hole-B pin): the seam takes no policy today, so the child is never
 * killed and the run never settles within the bound — the body throws, and
 * `it.fails` is GREEN on the RED commit. Phase C adds the policy param and flips
 * each `it.fails` → `it`.
 *
 * NB the fixtures self-reap (`sleep 5`) rather than truly never closing: the
 * bound we assert (500ms) is far under 5s, so "did NOT settle within the bound"
 * is what the race captures today — while an unbounded run in production (a wedged
 * ssh channel) closes NEVER. The self-reap only keeps a today-unbounded run from
 * leaking a child forever inside the test worker; it does not weaken the pin.
 */
import { describe, expect, it } from "vitest";
import {
  type CaptureResult,
  type ExitResult,
  runCapture,
  runProgress,
} from "./process";

/** The lifetime policy the fire-and-collect seam MUST require (D1b) — a hard
 *  deadline for the bounded probe case. Declared here as the RED's TARGET
 *  signature; Phase C bakes it into `process.ts` (making it required so an
 *  unowned child is unspellable) and drops these local casts. */
type LifetimePolicy = { deadlineMs: number };
type BoundedRunProgress = (
  cmd: string,
  args: readonly string[],
  onProgress: (line: string) => void,
  env: Readonly<Record<string, string>> | undefined,
  policy: LifetimePolicy,
) => Promise<ExitResult>;
type BoundedRunCapture = (
  cmd: string,
  args: readonly string[],
  onProgress: (line: string) => void,
  policy: LifetimePolicy,
) => Promise<CaptureResult>;

// The seam takes no policy today; the casts let the RED spell the target call
// without a whole-package typecheck failure. Phase C replaces them with the real
// (policy-carrying) `runProgress`/`runCapture` and deletes these aliases.
const boundedRunProgress = runProgress as unknown as BoundedRunProgress;
const boundedRunCapture = runCapture as unknown as BoundedRunCapture;

/** Race a settling promise against a wall-clock ceiling so a today-unbounded run
 *  can't hang the suite: resolves `{ settled: true, res }` if the run settles
 *  first, `{ settled: false }` if the ceiling wins. */
async function settlesWithin<T>(
  run: Promise<T>,
  ceilingMs: number,
): Promise<{ settled: true; res: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout>;
  const ceiling = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), ceilingMs);
  });
  const settled = run.then((res) => ({ settled: true as const, res }));
  const out = await Promise.race([settled, ceiling]);
  clearTimeout(timer!);
  return out;
}

// A child that does not close on its own within the bound we assert (500ms ≪ 5s),
// so ONLY a lifetime policy can settle the run — the shape of the wedged ssh child.
const NEVER_CLOSES = ["-c", "sleep 5"] as const;

describe("D1b — the fire-and-collect seam owns its child's lifetime (#1908)", () => {
  it.fails("runProgress kills a child that never closes once its deadline elapses", async () => {
    const start = Date.now();
    const out = await settlesWithin(
      boundedRunProgress("sh", NEVER_CLOSES, () => {}, undefined, {
        deadlineMs: 500,
      }),
      3000,
    );
    // Today: no bound owns the child → the run never settles within the ceiling.
    expect(out.settled, "runProgress never settled — no lifetime bound").toBe(
      true,
    );
    if (out.settled) {
      // Settled by a KILL of the exact child, not the child's own exit.
      expect(out.res.ok).toBe(false);
      expect(out.res.kind).toBe("signal");
      expect(Date.now() - start).toBeLessThan(2000);
    }
  });

  it.fails("runCapture kills a child that never closes once its deadline elapses", async () => {
    const start = Date.now();
    const out = await settlesWithin(
      boundedRunCapture("sh", NEVER_CLOSES, () => {}, { deadlineMs: 500 }),
      3000,
    );
    expect(out.settled, "runCapture never settled — no lifetime bound").toBe(
      true,
    );
    if (out.settled) {
      expect(out.res.ok).toBe(false);
      expect(out.res.kind).toBe("signal");
      expect(Date.now() - start).toBeLessThan(2000);
    }
  });
});
