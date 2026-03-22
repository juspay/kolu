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

/** A required DOM element was missing (e.g. ghostty canvas). */
export class ElementNotFoundError extends Error {
  readonly code = "ELEMENT_NOT_FOUND" as const;

  constructor(selector: string, context?: string) {
    const msg = context
      ? `${selector} not found in ${context}`
      : `${selector} not found`;
    super(msg);
    this.name = "ElementNotFoundError";
  }
}
