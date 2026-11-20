import type { SessionState } from "@kolu/surface-remote";

export const padiMemoryReadable = (session: {
  isDestroyed(): boolean;
  currentState(): SessionState<string>;
}): boolean =>
  !session.isDestroyed() && session.currentState().phase === "connected";
