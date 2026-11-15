/**
 * The DIAGNOSTIC half of the size instrument: what crossed the socket, and
 * when.
 *
 * `winsizeRecorder.ts` answers WHAT a program was told. When a scenario goes
 * red, the next question is WHY — which fact arrived after the pane's first
 * measurement and moved its box. The cheapest honest evidence for that is the
 * wire itself: every frame the page sends (the attach with its `resizeTo`, the
 * `lifecycle.resize` a settled publish fires) and a bounded summary of every
 * frame it receives (a terminal record arriving a beat late), each stamped
 * with the page's own clock.
 *
 * Installed with `addInitScript` rather than `evaluate`, because these
 * scenarios RELOAD: a patch applied to the live document is gone on the next
 * navigation, and the mount after a reload is exactly the moment under
 * measurement. `window.__wsSent` is the e2e harness's existing stash for
 * outgoing frames (`kolu-common/test-hooks`); entries here carry a
 * milliseconds-since-document-load prefix so a reader can line them up with
 * the record.
 *
 * Observation only: both patches forward to the original implementation
 * untouched, and nothing in this file is read unless a step asks for it.
 */

import type { Page } from "playwright";

/** How many frames each direction keeps. A reload loop can send thousands;
 *  the answer to "what moved the box" is in the last few hundred. */
const FRAME_CAP = 400;

/** How much of one frame is kept. A snapshot frame is megabytes and says
 *  nothing this probe is for; the head carries the tag and the ids. */
const FRAME_HEAD = 300;

/** Where INCOMING frames land. `__wsSent` is a declared test hook; its
 *  inbound sibling is not, and this file must not reach into the product's
 *  type surface to add one. */
const RECEIVED_KEY = "__koluWsReceived";

/** The patch itself, so the SAME code can be installed two ways: as an init
 *  script (every future document, which is what a reload lands in) and into
 *  the document that is already open (which is what a scenario without a
 *  reload measures). Running twice in one document is harmless — the second
 *  install wraps the first and both forward. */
const probeScript = (opts: { cap: number; head: number; key: string }) => {
  const { cap, head, key } = opts;
  // The e2e harness's own window, carrying a global this very function
  // installs two lines down. Unchecked by necessity: there is nothing to
  // validate yet at the moment of the write.
  const probed = window as unknown as Record<string, string[] | undefined>;
  const sent: string[] = [];
  const received: string[] = [];
  window.__wsSent = sent;
  probed[key] = received;
  const push = (into: string[], data: string) => {
    into.push(`${Math.round(performance.now())} ${data.slice(0, head)}`);
    if (into.length > cap) into.splice(0, into.length - cap);
  };

  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data === "string") push(sent, data);
    return origSend.call(this, data);
  };

  const NativeWebSocket = window.WebSocket;
  const Patched = function (url: string | URL, protocols?: string | string[]) {
    const socket = new NativeWebSocket(url, protocols);
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data === "string") push(received, event.data);
    });
    return socket;
  } as unknown as typeof WebSocket;
  Patched.prototype = NativeWebSocket.prototype;
  Object.defineProperties(Patched, {
    CONNECTING: { value: NativeWebSocket.CONNECTING },
    OPEN: { value: NativeWebSocket.OPEN },
    CLOSING: { value: NativeWebSocket.CLOSING },
    CLOSED: { value: NativeWebSocket.CLOSED },
  });
  window.WebSocket = Patched;
};

/** Install the probe for the rest of the page's life, reload included. */
export async function installResizeWireProbe(page: Page): Promise<void> {
  const opts = { cap: FRAME_CAP, head: FRAME_HEAD, key: RECEIVED_KEY };
  await page.addInitScript(probeScript, opts);
  await page.evaluate(probeScript, opts);
}

/** What the probe saw, filtered to the frames that move a grid.
 *
 *  Sent: anything naming `resizeTo` (an attach, which IS a write) or the
 *  `resize` procedure (a settled publish). Received: anything naming the
 *  terminal whose size moved — a record arrival is the candidate late input
 *  these scenarios are hunting. */
export async function readResizeWire(
  page: Page,
  terminalIds: readonly string[],
): Promise<{ sent: string[]; received: string[] }> {
  return page.evaluate(
    ({ ids, key }) => {
      // Same unchecked read as the install, for the same reason.
      const probed = window as unknown as Record<string, string[] | undefined>;
      return {
        sent: (window.__wsSent ?? []).filter(
          (frame) => frame.includes("resizeTo") || frame.includes("resize"),
        ),
        received: (probed[key] ?? []).filter((frame) =>
          ids.some((id) => frame.includes(id)),
        ),
      };
    },
    { ids: [...terminalIds], key: RECEIVED_KEY },
  );
}

/** The probe's reading as a quoted block for a failure message. */
export async function quoteResizeWire(
  page: Page,
  terminalIds: readonly string[],
): Promise<string> {
  const { sent, received } = await readResizeWire(page, terminalIds);
  const quote = (what: string, frames: string[]) =>
    frames.length === 0
      ? `  ${what}: (none)`
      : [`  ${what}:`, ...frames.slice(-12).map((f) => `    ${f}`)].join("\n");
  return [
    quote("sent (grid writes, ms since this document loaded)", sent),
    quote("received (frames naming these terminals)", received),
  ].join("\n");
}
