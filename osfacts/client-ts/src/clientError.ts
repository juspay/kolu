/**
 * The one error this client raises, in a module that imports nothing.
 *
 * It sits below both `client.ts` (the parser and the spawn twins) and
 * `childFailure.ts` (the child boundary), because both raise it and a class
 * defined in either one would make the pair a cycle — which this repo's lint
 * refuses, rightly: a cycle would mean neither module could be read as standing
 * on the other. `client.ts` re-exports it, so every consumer's import is
 * unchanged and the package still has exactly one public root.
 */

export class OsfactsClientError extends Error {
  constructor(
    readonly kind: "spawn" | "version" | "parse",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "OsfactsClientError";
  }
}
