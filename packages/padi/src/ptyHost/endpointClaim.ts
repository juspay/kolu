import { Effect } from "effect";

let restarts = 0;

let heal: Promise<void> | undefined;

export const restartClaimed = (): boolean => restarts > 0;

export const healClaimed = (): boolean => heal !== undefined;

export function withRestartClaim<A, E>(
  restart: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.suspend(() => {
    restarts += 1;
    const pending = heal;
    return Effect.gen(function* () {
      if (pending !== undefined) yield* Effect.promise(() => pending);
      return yield* restart;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          restarts -= 1;
        }),
      ),
    );
  });
}

export async function withHealClaim<A>(run: () => Promise<A>): Promise<A> {
  let settle = (): void => {};
  heal = new Promise<void>((resolve) => {
    settle = resolve;
  });
  try {
    return await run();
  } finally {
    heal = undefined;
    settle();
  }
}

export function withConvergeClaim<A, E>(
  converge: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.suspend(() =>
    healClaimed() ? converge : withRestartClaim(converge),
  );
}

export function requireEndpointClaim(what: string): void {
  if (restarts === 0 && heal === undefined) {
    throw new Error(
      `${what} reached the endpoint with nobody holding the claim — every path that replaces this endpoint's daemon must run under a restart or heal claim`,
    );
  }
}
