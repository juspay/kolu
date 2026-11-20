import { Cause, Effect, Exit, type Fiber } from "effect";
import { getOwner, onCleanup } from "solid-js";
import { toast } from "solid-sonner";

export type UiAction<A = unknown> = Effect.Effect<A, never>;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function fork<A>(label: string, action: UiAction<A>): Fiber.Fiber<A, never> {
  const fiber = Effect.runFork(action);
  fiber.addObserver((exit) => {
    if (Exit.isSuccess(exit)) return;
    if (Cause.hasInterruptsOnly(exit.cause)) return;
    const error = toError(Cause.squash(exit.cause));
    console.error(`[runAction] ${label} died:`, error);
    toast.error(`${label} failed unexpectedly: ${error.message}`);
  });
  return fiber;
}

export function runAction<A>(
  label: string,
  action: UiAction<A>,
): Fiber.Fiber<A, never> {
  return fork(label, action);
}

export function runOwnedAction<A>(
  label: string,
  action: UiAction<A>,
): Fiber.Fiber<A, never> {
  if (!getOwner()) {
    throw new Error(
      `runOwnedAction("${label}"): no reactive owner — the fiber would outlive ` +
        "everything that could stop it. Use runAction for a one-shot event edge.",
    );
  }
  const fiber = fork(label, action);
  onCleanup(() => {
    fiber.interruptUnsafe();
  });
  return fiber;
}

export function runActionPromise<A, E>(
  action: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  return Effect.runPromise(
    action,
    signal === undefined ? undefined : { signal },
  );
}
