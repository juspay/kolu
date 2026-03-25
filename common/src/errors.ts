/**
 * Structured error types for kolu server↔client communication.
 *
 * Typed errors replace untyped string messages, making error handling
 * consistent and pattern-matchable.
 */

/** A requested terminal was not found in the registry. */
export class TerminalNotFoundError extends Error {
  readonly code = "TERMINAL_NOT_FOUND" as const;

  constructor(id: string) {
    super(`Terminal ${id} not found`);
    this.name = "TerminalNotFoundError";
  }
}
