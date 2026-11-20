import type { Logger } from "../log.ts";

export const PADI_UNHANDLED_REJECTION_MARKER =
  "padi-unhandled-rejection-boundary";

export interface BoundaryFloat {
  reason: unknown;
  message: string;
}

let healthSink: ((float: BoundaryFloat) => void) | undefined;

export function registerBoundaryHealthSink(
  sink: ((float: BoundaryFloat) => void) | undefined,
): void {
  healthSink = sink;
}

let installed = false;

export function installUnhandledRejectionBoundary(log: Logger): void {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    log.error(
      {
        marker: PADI_UNHANDLED_REJECTION_MARKER,
        err: reason instanceof Error ? reason : undefined,
        reason: reason instanceof Error ? undefined : reason,
      },
      `${PADI_UNHANDLED_REJECTION_MARKER}: a background task floated a rejection — padi SURVIVES (loud backstop, not a fix). Hunt the missing source-level error boundary. reason=${message}`,
    );
    try {
      healthSink?.({ reason, message });
    } catch (sinkErr) {
      log.error(
        { marker: PADI_UNHANDLED_REJECTION_MARKER, err: sinkErr },
        `${PADI_UNHANDLED_REJECTION_MARKER}: health sink threw while reporting a float (ignored)`,
      );
    }
  });
}

export function __resetUnhandledRejectionBoundaryForTest(): void {
  installed = false;
  healthSink = undefined;
}
