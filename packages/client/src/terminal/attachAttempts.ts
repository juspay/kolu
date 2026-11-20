export interface AttemptGate {
  /** Begin an attempt, superseding every earlier one. */
  open(): Attempt;
}

export interface Attempt {
  /** False once a later attempt has opened — this one's work must do nothing. */
  isCurrent(): boolean;
}

export function createAttemptGate(): AttemptGate {
  let live = 0;
  return {
    open(): Attempt {
      const mine = ++live;
      return { isCurrent: () => mine === live };
    },
  };
}

export function onlyWhenCurrent<A extends unknown[]>(
  attempt: Attempt,
  effect: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    if (attempt.isCurrent()) effect(...args);
  };
}
