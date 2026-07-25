/**
 * The mechanism for a `local` target: a plain TCP relay.
 *
 * A dev server bound to `127.0.0.1:5173` on this machine is invisible from
 * anywhere else — loopback never leaves the box. So we open a door on the
 * network side (`0.0.0.0:<port>`) and copy bytes between it and the loopback
 * listener. No ssh, no tunnel: same machine, two sockets.
 *
 * Every accepted connection is tracked so `close()` can DESTROY it. Closing a
 * `net.Server` only stops new connections — a browser holding a keep-alive
 * socket would keep talking to the dev server long after the row said the
 * forward was cancelled, and "cancel severs it" has to mean severed.
 */

import { connect, type Server, type Socket } from "node:net";
import { messageOf } from "./diagnostic.ts";
import type { ForwardReport, OpenedForward } from "./mechanism.ts";
import { LOOPBACK_ADDRESS, type LoopbackFamily } from "./target.ts";
import { openPreferringPort, PortUnavailableError } from "./portChoice.ts";

// The address a `local` target listens on is loopback by definition of the
// problem this solves — but WHICH loopback is the caller's to say, and it used
// to be hardcoded to `127.0.0.1`. A dev server on `[::1]:5173` then got a relay
// that bound, reported success, and refused every connection it accepted.

/** Relay `0.0.0.0:<local>` → `127.0.0.1:<port>`. Resolves once the door is
 *  open; rejects (never half-opens) if the bind fails. `report` carries what
 *  happens to it afterwards — `lost` when it is gone, `fault` when it broke
 *  and could not be cleaned up.
 *
 *  Unlike the ssh mechanism there is no "prefer the target's own number" here —
 *  that number is the ONE number this listener may never take. Both ends are on
 *  this machine, so binding `0.0.0.0:<port>` while relaying to
 *  `127.0.0.1:<port>` points the relay at ITSELF: every accepted connection
 *  dials back into the listener and accepts again, forever. Measured before this
 *  was closed: one connection opened ~29,000 file descriptors in 1.5 seconds.
 *
 *  What it DOES prefer is `lastLocalPort` — the number this same target answered
 *  on the last time it was open — so a dev server that restarts comes back at the
 *  URL you already have. Without it the kernel picks afresh every time, which for
 *  a relay is every time full stop (there is no target-number preference to fall
 *  back on), and a restart silently invalidated every link and bookmark. The
 *  self-pointing number is refused here rather than trusted not to arrive: the
 *  map cannot produce it, but the consequence if it ever did is a runaway.
 *
 *  `listen` is the seam the "what happens when the listener fails after it was
 *  up?" tests need, since that failure cannot be provoked through a real socket.
 *  Production passes node's own from `nativeMechanisms`, which is where the ssh
 *  mechanism is handed its real spawner too — the one module that knows what the
 *  real thing is. */
export function openRelay(opts: {
  port: number;
  report: ForwardReport;
  listen: (onConnection: (socket: Socket) => void) => Server;
  lastLocalPort: number | undefined;
  /** WHICH loopback the far end is on. Required — see {@link LoopbackFamily}. */
  loopback: LoopbackFamily;
}): Promise<OpenedForward> {
  const { port, lastLocalPort } = opts;
  if (lastLocalPort === port) {
    throw new Error(
      `port-forward: a relay for local port ${port} cannot listen on that same number — it would relay into itself.`,
    );
  }
  // No remembered port: straight to the kernel's choice, which is the relay's
  // only other option. With one: try it, and fall back the same way the ssh
  // mechanism does when its preferred number is taken.
  return lastLocalPort === undefined
    ? openRelayOn(opts, 0)
    : openPreferringPort({
        preferred: lastLocalPort,
        open: (localPort) => openRelayOn(opts, localPort),
      });
}

/** One relay attempt on ONE local port. `0` means "let the kernel choose", which
 *  is the no-preference path and has no pick-then-bind window at all. */
function openRelayOn(
  opts: {
    port: number;
    report: ForwardReport;
    listen: (onConnection: (socket: Socket) => void) => Server;
    loopback: LoopbackFamily;
  },
  localPort: number,
): Promise<OpenedForward> {
  const { port, report } = opts;
  const dial = LOOPBACK_ADDRESS[opts.loopback];
  const live = new Set<Socket>();

  const server = opts.listen((inbound) => {
    const outbound = connect({ host: dial, port });
    live.add(inbound);
    live.add(outbound);
    // Either half ending or failing takes the pair down: a relay owns no
    // state of its own, so there is nothing to salvage from a half-open pipe.
    const drop = (): void => {
      live.delete(inbound);
      live.delete(outbound);
      inbound.destroy();
      outbound.destroy();
    };
    inbound.on("error", drop);
    outbound.on("error", drop);
    inbound.on("close", drop);
    outbound.on("close", drop);
    inbound.pipe(outbound);
    outbound.pipe(inbound);
  });

  /** The ONE way this relay goes down, whoever asks — `close()` or a listener
   *  that failed on its own. Three states, kept apart because conflating the
   *  first two is a race:
   *
   *   - `up`      — serving.
   *   - `closing` — a teardown is in flight; every later caller JOINS that same
   *                 promise instead of being told "already done" while the
   *                 server is still closing.
   *   - `down`    — the server is closed. Only a SUCCESSFUL close gets here; a
   *                 rejected one returns to `up` so a retry really retries.
   *
   *  A loss is announced exactly once, AFTER teardown, and never for a
   *  teardown we ordered ourselves. */
  let down = false;
  let inFlight: Promise<void> | undefined;

  const teardown = (): Promise<void> => {
    if (down) return Promise.resolve();
    if (inFlight !== undefined) return inFlight;
    const attempt = new Promise<void>((done, fail) => {
      for (const socket of live) socket.destroy();
      live.clear();
      if (!server.listening) {
        down = true;
        done();
        return;
      }
      server.close((err) => {
        if (err !== undefined) fail(err);
        else {
          down = true;
          done();
        }
      });
    });
    inFlight = attempt;
    // Clear the cache on the PROMISE, not inside the close callback: a
    // mechanism that fails synchronously would otherwise clear the slot before
    // the assignment above ran, and the failed attempt would be cached forever
    // — every retry handed the same old rejection. Identity-checked so a later
    // attempt's cache is never dropped by an earlier one's failure.
    attempt.catch(() => {
      if (inFlight === attempt) inFlight = undefined;
    });
    return attempt;
  };

  return new Promise((resolve, reject) => {
    // A bind that fails BECAUSE of the number gets the preference's retry; any
    // other bind failure is about the relay itself and travels straight out. The
    // kernel's own choice (`0`) can never be "in use", so this only ever fires on
    // a remembered number that has since been taken.
    const onListenError = (err: Error): void => {
      const code = (err as NodeJS.ErrnoException).code;
      reject(
        code === "EADDRINUSE" || code === "EACCES"
          ? new PortUnavailableError(localPort, err.message)
          : err,
      );
    };
    server.once("error", onListenError);
    server.listen({ host: "0.0.0.0", port: localPort }, () => {
      server.removeListener("error", onListenError);
      // Past the bind, a listener error is a LOSS, not a startup failure. Take
      // the relay down FIRST, then say so — once.
      server.on("error", (err) => {
        // Only an UNSOLICITED failure is a loss: if a teardown is already in
        // flight, whoever ordered it is the one being answered.
        if (down || inFlight !== undefined) return;
        const reason = `the local relay listener failed: ${err.message}`;
        // Tear down FIRST, and announce the loss ONLY once the relay really is
        // down. `onLost` is the definitive channel — it makes the owner drop
        // its only handle on this relay — so saying it after a FAILED teardown
        // would strand a listener that may still be reachable with nobody left
        // to close it. A failed teardown keeps the relay owned and retryable
        // instead; the next `close()` retries and surfaces the error.
        teardown().then(
          () => report.lost(reason),
          (closeError: unknown) =>
            // Could not clean up: the listener may still be reachable, so this
            // is NOT a loss (the owner would drop its only handle on it). It is
            // a fault — the row stays, and the trouble is passed on rather than
            // swallowed.
            report.fault(
              `${reason}, and closing it failed too: ${messageOf(closeError)}`,
            ),
        );
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        void teardown();
        reject(
          new Error(
            `port-forward: the relay listener has no TCP address (got ${JSON.stringify(address)}).`,
          ),
        );
        return;
      }
      resolve({ localPort: address.port, close: teardown });
    });
  });
}
