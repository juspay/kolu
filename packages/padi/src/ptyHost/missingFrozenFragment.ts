import { ORPCError } from "@orpc/client";

/** The one structured signal that a live pre-UW5 Kaval has no frozen fragment. */
export function isMissingFrozenFragment(err: unknown): boolean {
  return (
    err instanceof ORPCError &&
    err.code === "NOT_FOUND" &&
    err.status === 404 &&
    err.defined === false
  );
}
