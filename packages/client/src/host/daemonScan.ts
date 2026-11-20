import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";
import { match } from "ts-pattern";
import type { PadiEntry } from "../kaval/useDaemonStatus";
import { HOST_DOWN_COPY } from "./hostDownCopy";

export type DaemonScan =
  | { kind: "live" }
  | { kind: "connecting" }
  | { kind: "no-frame" }
  | { kind: "failed"; cause: EntryFailedCause }
  | { kind: "no-host" }
  | { kind: "unobservable" };

export function daemonScanCause(
  entry: PadiEntry,
  { bindLive, framePresent }: { bindLive: boolean; framePresent: boolean },
): DaemonScan {
  return match(entry)
    .with({ kind: "connected" }, () => {
      if (!bindLive) return { kind: "connecting" } as const;
      if (!framePresent) return { kind: "no-frame" } as const;
      return { kind: "live" } as const;
    })
    .with({ kind: "warming" }, () => ({ kind: "connecting" }) as const)
    .with({ kind: "unobservable" }, () => ({ kind: "unobservable" }) as const)
    .with(
      { kind: "failed" },
      (e) => ({ kind: "failed", cause: e.failure.cause }) as const,
    )
    .with({ kind: "not-a-member" }, () => ({ kind: "no-host" }) as const)
    .exhaustive();
}

export function scanUnavailableText(
  scan: Exclude<DaemonScan, { kind: "live" }>,
): string {
  return match(scan)
    .with(
      { kind: "connecting" },
      () => "Daemon scan unavailable — padi is connecting.",
    )
    .with(
      { kind: "no-frame" },
      () =>
        "Daemon scan unavailable — the connected padi hasn't reported a scan yet.",
    )
    .with(
      { kind: "failed" },
      (s) => `Daemon scan unavailable — ${HOST_DOWN_COPY[s.cause].title}.`,
    )
    .with(
      { kind: "no-host" },
      () => "Daemon scan unavailable — no padi is bound to this host.",
    )
    .with(
      { kind: "unobservable" },
      () => "Daemon scan unavailable — this tab can't reach kolu right now.",
    )
    .exhaustive();
}
