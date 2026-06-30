/**
 * Bridge a `kaval` PTY-host client's raw tap streams onto the
 * `SensorSignals` the sensor set consumes — the connective tissue the
 * standalone `pulam` daemon needs and kolu-server does NOT.
 *
 * kolu-server builds the same four in-memory channels inline in its local
 * endpoint (`terminalEndpoint/local.ts`), feeding them from its *in-process*
 * pty-host. `pulam` instead *dials* kaval over a socket and feeds the channels
 * from the wire — identical sensor set, different transport. That single
 * difference is exactly why this bridge lives here (one copy, reused) rather
 * than being duplicated in the daemon: `startAwareness` is transport-agnostic,
 * and this is the one adapter that makes a remote/socket kaval look like the
 * local taps it expects.
 *
 * Pure plumbing: it subscribes each `ptyHostSurface` stream and republishes
 * onto the matching channel until `signal` aborts. It does NOT touch the
 * record or the sink — keeping the persisted-cwd write (a host concern) where
 * the host wants it (see `pulam`'s daemon, which adds it as its own channel
 * consumer, mirroring local.ts). The git→PR sensor-to-sensor wire is internal
 * to `startAwareness`, so it is not one of these channels.
 */

import { inMemoryChannel } from "@kolu/surface/server";
import type { ForegroundSample, PtyHostClient } from "kaval";
import type { Logger } from "pino";
import type { SensorSignals, CommandRunSample } from "./sensors.ts";
import type { TerminalId } from "./schema.ts";

/** Pump a kaval tap stream onto a channel until `signal` aborts. Fire-and-
 *  forget (the awaited iterator ends on abort); a non-abort error is surfaced
 *  through `onError` rather than swallowed — losing a tap silently degrades
 *  awareness (no git re-resolve on `cd`, a frozen foreground), so it must be
 *  visible. Post-abort rejection is expected end-of-life noise and dropped. */
function bridgeStream<T>(
  stream: Promise<AsyncIterable<T>>,
  signal: AbortSignal,
  onMsg: (msg: T) => void,
  onError: (err: unknown) => void,
): void {
  void (async () => {
    try {
      for await (const msg of await stream) {
        if (signal.aborted) break;
        onMsg(msg);
      }
    } catch (err) {
      if (!signal.aborted) onError(err);
    }
  })();
}

/** Build the four `SensorSignals` channels for terminal `id` from a dialed
 *  kaval client, wiring each `ptyHostSurface` tap stream onto its channel.
 *  Every subscription is bound to `signal`, so one `abort()` tears the whole
 *  bridge down. The caller owns the channels afterward — `startAwareness`
 *  consumes them, and a host that also persists cwd can add its own
 *  `signals.cwd.consume(...)` (the channels fan out to every subscriber). */
export function bridgeKavalTaps(
  client: PtyHostClient,
  id: TerminalId,
  signal: AbortSignal,
  log?: Logger,
): SensorSignals {
  const signals: SensorSignals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<CommandRunSample>(),
    foreground: inMemoryChannel<ForegroundSample>(),
  };
  const tapError =
    (channel: string) =>
    (err: unknown): void =>
      log?.error({ err, terminal: id, channel }, "kaval tap subscription lost");

  bridgeStream(
    client.surface.cwd.get({ id }, { signal }),
    signal,
    (m) => signals.cwd.publish(m.cwd),
    tapError("cwd"),
  );
  bridgeStream(
    client.surface.title.get({ id }, { signal }),
    signal,
    (m) => signals.title.publish(m.title),
    tapError("title"),
  );
  bridgeStream(
    client.surface.commandRun.get({ id }, { signal }),
    signal,
    (m) =>
      signals.commandRun.publish({
        command: m.command,
        replayed: m.replayed,
      }),
    tapError("commandRun"),
  );
  bridgeStream(
    client.surface.foreground.get({ id }, { signal }),
    signal,
    (m) =>
      signals.foreground.publish({
        process: m.process,
        foregroundPid: m.foregroundPid,
      }),
    tapError("foreground"),
  );
  return signals;
}
